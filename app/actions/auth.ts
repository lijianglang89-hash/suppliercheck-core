"use server";

/**
 * 认证相关 Server Action。
 *
 * 安全要点：
 * 1. Server Action 等价于公开 POST 端点 —— 这里的每个入参都必须当作不可信输入校验。
 * 2. 登录失败时不区分「邮箱不存在」与「密码错误」，避免账号枚举。
 * 3. redirect 目标一律经过 resolveSafeRedirect 校验，防 open redirect。
 */
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";

import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { resolveSafeRedirect } from "@/lib/auth/redirect";
import { clearSession, establishSession, readSession } from "@/lib/auth/session";
import type { AuthFormState } from "@/lib/auth/form-state";
import { getDb } from "@/lib/db";
import { users, workspaceMembers, workspaces } from "@/lib/db/schema";
import { errors, toAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/* ------------------------------- 校验 Schema ------------------------------- */

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "请输入有效的邮箱地址");

const passwordSchema = z
  .string()
  .min(8, "密码至少 8 位")
  .max(128, "密码最多 128 位");

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1, "请填写称呼").max(60),
  workspaceName: z.string().trim().min(1).max(80).optional(),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "请输入密码"),
  next: z.string().optional(),
});

function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}

/**
 * 由邮箱派生工作区 slug。
 * 只保留小写字母数字与连字符，再拼上随机后缀保证唯一。
 */
function slugFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "workspace";
  const base = local
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base || "workspace"}-${suffix}`;
}

/* --------------------------------- 注册 --------------------------------- */

export async function registerAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const raw = {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    displayName: String(formData.get("displayName") ?? ""),
    workspaceName: String(formData.get("workspaceName") ?? "") || undefined,
  };

  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error), email: raw.email };
  }

  const { email, password, displayName, workspaceName } = parsed.data;
  const db = getDb();

  try {
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing) {
      return { error: "该邮箱已注册，请直接登录。", email };
    }

    const passwordHash = await hashPassword(password);

    // 用户、工作区、成员关系三者在同一事务中创建，避免出现「有用户无工作区」的中间态。
    const createdUserId = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email, passwordHash, displayName })
        .returning({ id: users.id });

      if (!user) throw errors.internal("创建用户失败。");

      const [workspace] = await tx
        .insert(workspaces)
        .values({
          name: workspaceName?.trim() || `${displayName} 的工作区`,
          slug: slugFromEmail(email),
          ownerUserId: user.id,
        })
        .returning({ id: workspaces.id });

      if (!workspace) throw errors.internal("创建工作区失败。");

      await tx.insert(workspaceMembers).values({
        workspaceId: workspace.id,
        userId: user.id,
        role: "OWNER",
      });

      return user.id;
    });

    await establishSession(createdUserId);
    logger.info("新用户注册成功", { userId: createdUserId });
  } catch (error) {
    const appError = toAppError(error);
    logger.error("注册失败", { ...appError.toLogPayload() });
    return { error: appError.toUserMessage(), email };
  }

  redirect("/dashboard");
}

/* --------------------------------- 登录 --------------------------------- */

export async function loginAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const raw = {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    next: String(formData.get("next") ?? "") || undefined,
  };

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error), email: raw.email };
  }

  const { email, password, next } = parsed.data;
  const db = getDb();

  try {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    // 无论用户是否存在，都执行一次等价的密码校验开销，弱化时序差异。
    const storedHash = user?.passwordHash ?? "$scrypt$0$0$0$invalid$invalid";
    const passwordOk = await verifyPassword(password, storedHash);

    if (!user || !passwordOk || user.status !== "ACTIVE") {
      logger.warn("登录失败", { email, requestId: undefined });
      return { error: "邮箱或密码不正确。", email };
    }

    await establishSession(user.id);
    logger.info("用户登录成功", { userId: user.id });
  } catch (error) {
    const appError = toAppError(error);
    logger.error("登录异常", { ...appError.toLogPayload() });
    return { error: appError.toUserMessage(), email };
  }

  redirect(resolveSafeRedirect(next));
}

/* --------------------------------- 登出 --------------------------------- */

export async function logoutAction(): Promise<void> {
  const session = await readSession();
  await clearSession();
  if (session) {
    logger.info("用户登出", { userId: session.userId });
  }
  redirect("/");
}
