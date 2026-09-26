"use server";

/**
 * 设置页 Server Action。
 *
 * 三条共同的纪律：
 * 1. 修改密码必须**先验旧密码**，且失败文案与「邮箱不存在」不区分 —— 防账号枚举。
 * 2. 新密码必须走与注册时同一个哈希实现，不能自己拼一套。
 * 3. 改完立刻 `revalidatePath("/settings")`，否则界面显示的是上一版的值，
 *    用户会误以为没保存成功而再点一次。
 */
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { requireActionWorkspace } from "@/lib/auth/action-context";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { renameWorkspace } from "@/lib/auth/workspaces";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { toAppError } from "@/lib/errors";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/forms/form-state";
import { logger } from "@/lib/logger";

const workspaceSchema = z.object({
  name: z.string().trim().min(1, "请填写工作区名称").max(80, "工作区名称最多 80 个字符"),
});

const profileSchema = z.object({
  displayName: z.string().trim().min(1, "请填写称呼").max(60, "称呼最多 60 个字符"),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "请输入当前密码"),
    newPassword: z.string().min(8, "新密码至少 8 位").max(128, "新密码最多 128 位"),
    confirmPassword: z.string().min(1, "请再次输入新密码"),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: "两次输入的新密码不一致",
    path: ["confirmPassword"],
  });

/* -------------------------------- 工作区 -------------------------------- */

export async function renameWorkspaceAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = workspaceSchema.safeParse({ name: String(formData.get("name") ?? "") });
  if (!parsed.success) {
    return { status: "error", error: parsed.error.issues[0]?.message ?? "请检查输入。" };
  }

  try {
    // 重命名是工作区级别的改动，要求 ADMIN 及以上（OWNER 满足该级别）。
    const { workspace } = await requireActionWorkspace("ADMIN");
    await renameWorkspace(workspace.id, parsed.data.name);
    logger.info("已重命名工作区", { workspaceId: workspace.id });
  } catch (error) {
    const appError = toAppError(error);
    logger.warn("重命名工作区失败", { code: appError.code });
    return { status: "error", error: appError.toUserMessage() };
  }

  // 侧栏顶部会显示工作区名，整棵仪表盘的布局都要重新取数。
  revalidatePath("/", "layout");
  return { ...EMPTY_FORM_STATE, status: "success", success: "已更新工作区名称。" };
}

/* --------------------------------- 账号 --------------------------------- */

export async function updateProfileAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = profileSchema.safeParse({
    displayName: String(formData.get("displayName") ?? ""),
  });
  if (!parsed.success) {
    return { status: "error", error: parsed.error.issues[0]?.message ?? "请检查输入。" };
  }

  try {
    const { user } = await requireActionWorkspace("MEMBER");
    const db = getDb();
    await db
      .update(users)
      .set({ displayName: parsed.data.displayName, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    logger.info("已更新用户资料", { userId: user.id });
  } catch (error) {
    const appError = toAppError(error);
    logger.warn("更新用户资料失败", { code: appError.code });
    return { status: "error", error: appError.toUserMessage() };
  }

  revalidatePath("/", "layout");
  return { ...EMPTY_FORM_STATE, status: "success", success: "已保存账号资料。" };
}

export async function changePasswordAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = passwordSchema.safeParse({
    currentPassword: String(formData.get("currentPassword") ?? ""),
    newPassword: String(formData.get("newPassword") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  });
  if (!parsed.success) {
    return { status: "error", error: parsed.error.issues[0]?.message ?? "请检查输入。" };
  }

  try {
    const { user } = await requireActionWorkspace("MEMBER");
    const ok = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
    if (!ok) {
      return { status: "error", error: "当前密码不正确。" };
    }
    if (parsed.data.currentPassword === parsed.data.newPassword) {
      return { status: "error", error: "新密码不能与当前密码相同。" };
    }

    const db = getDb();
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(parsed.data.newPassword), updatedAt: new Date() })
      .where(eq(users.id, user.id));

    logger.info("已修改密码", { userId: user.id });
  } catch (error) {
    const appError = toAppError(error);
    logger.warn("修改密码失败", { code: appError.code });
    return { status: "error", error: appError.toUserMessage() };
  }

  return { ...EMPTY_FORM_STATE, status: "success", success: "密码已更新。" };
}
