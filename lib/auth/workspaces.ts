import "server-only";

import { getDb } from "@/lib/db";
import { users, workspaceMembers, workspaces } from "@/lib/db/schema";
import { errors } from "@/lib/errors";
import { and, eq, isNull } from "drizzle-orm";

export interface ActiveWorkspace {
  id: string;
  name: string;
  slug: string;
  role: string;
}

/**
 * 取用户的默认工作区（列表中的第一个）。
 *
 * V0.1 只支持单工作区体验，但数据结构从第一天就是「一个用户多个工作区」，
 * 未来加工作区切换器时不需要改数据模型。
 *
 * 若用户意外没有任何工作区，就地补建一个，避免出现无法自助恢复的死角。
 * 注意：这是**用户自己的**工作区，创建者即是 OWNER，不涉及越权。
 */
export async function ensureWorkspaceForUser(userId: string): Promise<ActiveWorkspace> {
  const db = getDb();

  const existing = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, userId), isNull(workspaces.deletedAt)))
    .limit(1);

  const first = existing[0];
  if (first) {
    return { id: first.id, name: first.name, slug: first.slug, role: first.role };
  }

  const [owner] = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const displayName = owner?.displayName ?? "我的";

  return db.transaction(async (tx) => {
    const [workspace] = await tx
      .insert(workspaces)
      .values({
        name: `${displayName} 的工作区`,
        slug: `ws-${Math.random().toString(36).slice(2, 10)}`,
        ownerUserId: userId,
      })
      .returning({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug });

    if (!workspace) {
      throw errors.internal("补建默认工作区失败。");
    }

    await tx.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId,
      role: "OWNER",
    });

    return { id: workspace.id, name: workspace.name, slug: workspace.slug, role: "OWNER" };
  });
}
