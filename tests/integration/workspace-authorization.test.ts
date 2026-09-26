import { afterAll, describe, expect, it } from "vitest";

import { checkWorkspaceMembership } from "@/lib/auth/workspace-access";
import { closeDatabase } from "@/lib/db";

import { addMember, cleanupUsers, createTestUser, createTestWorkspace } from "../helpers/fixtures";

const createdUserIds: string[] = [];

describe("工作区授权（多租户核心安全边界）", () => {
  afterAll(async () => {
    await cleanupUsers(createdUserIds);
    await closeDatabase();
  });

  it("成员可以访问自己所在的工作区", async () => {
    const user = await createTestUser("owner");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id);

    const result = await checkWorkspaceMembership({ userId: user.id, workspaceId: workspace.id });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workspace.id).toBe(workspace.id);
      expect(result.role).toBe("OWNER");
    }
  });

  it("★ 用户 A 拿用户 B 的 workspaceId 访问会被拒绝（越权防护）", async () => {
    const userA = await createTestUser("a");
    const userB = await createTestUser("b");
    createdUserIds.push(userA.id, userB.id);

    await createTestWorkspace(userA.id, "A 的工作区");
    const workspaceB = await createTestWorkspace(userB.id, "B 的工作区");

    // A 从未加入 B 的工作区，但拿到了它的 id
    const result = await checkWorkspaceMembership({
      userId: userA.id,
      workspaceId: workspaceB.id,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_a_member");
    }
  });

  it("被显式加入后即可访问（成员关系是唯一授权来源）", async () => {
    const owner = await createTestUser("owner2");
    const collaborator = await createTestUser("collab");
    createdUserIds.push(owner.id, collaborator.id);

    const workspace = await createTestWorkspace(owner.id);

    const before = await checkWorkspaceMembership({
      userId: collaborator.id,
      workspaceId: workspace.id,
    });
    expect(before.ok).toBe(false);

    await addMember(workspace.id, collaborator.id, "MEMBER");

    const after = await checkWorkspaceMembership({
      userId: collaborator.id,
      workspaceId: workspace.id,
    });
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.role).toBe("MEMBER");
  });

  it("角色不足时被拒绝（VIEWER 无法满足 ADMIN 要求）", async () => {
    const owner = await createTestUser("owner3");
    const viewer = await createTestUser("viewer");
    createdUserIds.push(owner.id, viewer.id);

    const workspace = await createTestWorkspace(owner.id);
    await addMember(workspace.id, viewer.id, "VIEWER");

    const asViewer = await checkWorkspaceMembership({
      userId: viewer.id,
      workspaceId: workspace.id,
      minimumRole: "VIEWER",
    });
    expect(asViewer.ok).toBe(true);

    const asAdmin = await checkWorkspaceMembership({
      userId: viewer.id,
      workspaceId: workspace.id,
      minimumRole: "ADMIN",
    });
    expect(asAdmin.ok).toBe(false);
    if (!asAdmin.ok) expect(asAdmin.reason).toBe("insufficient_role");
  });

  it("不存在的 workspaceId 同样返回 not_a_member（不泄露存在性）", async () => {
    const user = await createTestUser("ghost");
    createdUserIds.push(user.id);

    const result = await checkWorkspaceMembership({
      userId: user.id,
      workspaceId: "00000000-0000-4000-8000-000000000000",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_a_member");
  });

  it("非 UUID 形态的 workspaceId 在查库前就被挡下", async () => {
    const user = await createTestUser("badsyntax");
    createdUserIds.push(user.id);

    for (const bad of ["", "1", "' or 1=1 --", "../../etc", "abc"]) {
      const result = await checkWorkspaceMembership({ userId: user.id, workspaceId: bad });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("workspace_missing");
    }
  });

  it("同一用户不能被重复加入同一工作区（唯一约束）", async () => {
    const owner = await createTestUser("owner4");
    createdUserIds.push(owner.id);
    const workspace = await createTestWorkspace(owner.id);

    await expect(addMember(workspace.id, owner.id, "MEMBER")).rejects.toThrow();
  });
});
