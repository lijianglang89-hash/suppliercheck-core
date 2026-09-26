/**
 * 工作区授权的核心逻辑（纯数据库，不依赖 next/headers）。
 *
 * 为什么单独拆出来：
 * 1. 授权是本产品最重要的安全边界，必须能被集成测试直接、反复地验证；
 * 2. 上层 requireWorkspaceAccess() 只是「取当前用户 + 调本函数」，
 *    逻辑唯一，不会出现两套判定标准。
 */
import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { workspaceMembers, workspaces, type WorkspaceRole } from "@/lib/db/schema";
import { errors } from "@/lib/errors";
import { logger } from "@/lib/logger";

export type AuthorizationFailure = "not_a_member" | "insufficient_role" | "workspace_missing";

export type MembershipCheck =
  | {
      ok: true;
      workspace: { id: string; name: string; slug: string };
      role: WorkspaceRole;
    }
  | {
      ok: false;
      reason: AuthorizationFailure;
    };

const ROLE_RANK: Record<WorkspaceRole, number> = {
  VIEWER: 10,
  MEMBER: 20,
  ADMIN: 30,
  OWNER: 40,
};

export function roleAtLeast(role: WorkspaceRole, minimum: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** UUID 形态检查。不符合时连数据库都不查。 */
export function looksLikeUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * 判断某用户是否属于某工作区、且角色是否达标。
 *
 * 这是「浏览器传入的 workspace_id 不可信」这条规则的执行点：
 * 无论 workspaceId 从哪来，都必须回到 workspace_members 表核对。
 */
export async function checkWorkspaceMembership(params: {
  userId: string;
  workspaceId: string;
  minimumRole?: WorkspaceRole;
}): Promise<MembershipCheck> {
  const { userId, workspaceId, minimumRole = "MEMBER" } = params;

  if (!looksLikeUuid(workspaceId)) {
    return { ok: false, reason: "workspace_missing" };
  }

  const db = getDb();
  const [row] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.workspaceId, workspaceId),
        isNull(workspaces.deletedAt),
      ),
    )
    .limit(1);

  if (!row) {
    return { ok: false, reason: "not_a_member" };
  }

  if (!roleAtLeast(row.role, minimumRole)) {
    return { ok: false, reason: "insufficient_role" };
  }

  return {
    ok: true,
    workspace: { id: row.id, name: row.name, slug: row.slug },
    role: row.role,
  };
}

/** 断言版：校验失败时抛出带正确状态码的 AppError。 */
export async function assertWorkspaceMembership(params: {
  userId: string;
  workspaceId: string;
  minimumRole?: WorkspaceRole;
  requestId?: string;
}) {
  const result = await checkWorkspaceMembership(params);

  if (!result.ok) {
    if (result.reason === "workspace_missing") {
      throw errors.validation("workspaceId 格式不正确。", { requestId: params.requestId });
    }

    // 刻意不区分「不存在」与「无权访问」，避免被用来探测他人工作区是否存在。
    logger.warn("工作区授权失败", {
      userId: params.userId,
      workspaceId: params.workspaceId,
      reason: result.reason,
      requestId: params.requestId,
    });
    throw errors.forbidden(
      result.reason === "insufficient_role" ? "当前角色无权执行该操作。" : "你没有访问该工作区的权限。",
      { requestId: params.requestId },
    );
  }

  return { workspace: result.workspace, role: result.role };
}
