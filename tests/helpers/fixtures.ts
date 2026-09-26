import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { users, workspaceMembers, workspaces } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";

/** 集成测试用的唯一后缀，避免同一数据库上并行/重复运行互相干扰。 */
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export interface TestUser {
  id: string;
  email: string;
  displayName: string;
}

/** 直接写入数据库创建用户（绕过 Server Action，专注被测逻辑本身）。 */
export async function createTestUser(prefix = "user"): Promise<TestUser> {
  const db = getDb();
  const suffix = uniqueSuffix();
  const email = `${prefix}-${suffix}@example.test`;
  const displayName = `测试${prefix}`;

  const [user] = await db
    .insert(users)
    .values({
      email,
      passwordHash: await hashPassword(`test-password-${suffix}`),
      displayName,
    })
    .returning({ id: users.id, email: users.email, displayName: users.displayName });

  if (!user) throw new Error("创建测试用户失败");
  return user;
}

export interface TestWorkspace {
  id: string;
  name: string;
  slug: string;
}

/** 创建工作区并把 owner 写成指定用户。 */
export async function createTestWorkspace(ownerUserId: string, name = "测试工作区"): Promise<TestWorkspace> {
  const db = getDb();
  const suffix = uniqueSuffix();

  return db.transaction(async (tx) => {
    const [workspace] = await tx
      .insert(workspaces)
      .values({ name, slug: `test-${suffix}`, ownerUserId })
      .returning({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug });

    if (!workspace) throw new Error("创建测试工作区失败");

    await tx.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: ownerUserId,
      role: "OWNER",
    });

    return workspace;
  });
}

/** 把用户加入工作区，指定角色。 */
export async function addMember(
  workspaceId: string,
  userId: string,
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER",
): Promise<void> {
  const db = getDb();
  await db.insert(workspaceMembers).values({ workspaceId, userId, role });
}

/**
 * 清理测试数据。
 * 顺序很重要：workspaces.owner_user_id 是 ON DELETE RESTRICT，
 * 必须先删工作区（级联删除成员关系），再删用户。
 */
export async function cleanupUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const db = getDb();

  for (const userId of userIds) {
    await db.delete(workspaces).where(eq(workspaces.ownerUserId, userId));
    await db.delete(users).where(eq(users.id, userId));
  }
}
