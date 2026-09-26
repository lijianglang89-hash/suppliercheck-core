/**
 * 服务端授权守卫（需求「十、严格的多租户安全原则」）。
 *
 * 铁律：浏览器提交的 workspace_id **永远不能**作为授权依据。
 * 每一个需要访问工作区数据的入口，都必须经过 requireWorkspaceAccess()。
 *
 * 本文件负责「取当前用户」这一层（依赖 next/headers）；
 * 真正的成员关系判定在 ./workspace-access.ts，那里是纯数据库逻辑，
 * 因此可以被集成测试直接覆盖。两层分工，判定标准只有一份。
 */
import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { users, workspaceMembers, workspaces, type User, type WorkspaceRole } from "@/lib/db/schema";
import { errors } from "@/lib/errors";

import { readSession } from "./session";
import { assertWorkspaceMembership } from "./workspace-access";

export interface WorkspaceContext {
  user: User;
  workspace: { id: string; name: string; slug: string };
  role: WorkspaceRole;
}

export interface RequireWorkspaceOptions {
  /** 要求的最低角色，默认 MEMBER（可读可写）。 */
  minimumRole?: WorkspaceRole;
  /** 请求标识，用于把授权失败关联到具体请求日志。 */
  requestId?: string;
}

/** 取当前登录用户。未登录返回 undefined。 */
export async function getCurrentUser(): Promise<User | undefined> {
  const session = await readSession();
  if (!session) return undefined;

  const db = getDb();
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, session.userId), isNull(users.deletedAt)))
    .limit(1);

  if (!user || user.status !== "ACTIVE") return undefined;
  return user;
}

/** 要求已登录，否则抛出 UNAUTHENTICATED（401）。 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    throw errors.unauthenticated("请先登录。");
  }
  return user;
}

/**
 * 核心授权入口：确认登录 + 校验工作区成员关系与角色。
 * 任一步不满足都抛出 401 / 403，绝不返回任何数据。
 */
export async function requireWorkspaceAccess(
  workspaceId: string,
  options: RequireWorkspaceOptions = {},
): Promise<WorkspaceContext> {
  const user = await requireUser();

  const { workspace, role } = await assertWorkspaceMembership({
    userId: user.id,
    workspaceId,
    minimumRole: options.minimumRole,
    requestId: options.requestId,
  });

  return { user, workspace, role };
}

/** 列出当前用户可访问的全部工作区。 */
export async function listUserWorkspaces(userId: string) {
  const db = getDb();
  return db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, userId), isNull(workspaces.deletedAt)));
}

export { roleAtLeast } from "./workspace-access";
