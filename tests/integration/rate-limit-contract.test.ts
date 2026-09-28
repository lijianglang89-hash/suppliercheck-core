/**
 * 限流门禁的 HTTP 契约（真实 Postgres + 真实路由 handler）。
 *
 * 覆盖两个层面：
 * 1. **分级额度真实生效**：POST /api/documents/[documentId]/process 在窗口内放行
 *    policy.max 次，之后一律 429 + Retry-After + RATE_LIMITED 错误码；
 * 2. **按 key 隔离**：另一个用户/工作区有独立额度，互不牵连。
 *
 * 测试手法与 file-download-route.test.ts 相同：只 mock 会话读取，
 * 授权（工作区成员判定）、限流计数、响应头全部跑真实代码。
 * Server Action（创建/重跑审核）走同一把 enforceRateLimit，
 * 差别只在「429 变成表单错误文案」，不重复架测试。
 *
 * 为什么选 process 路由做契约载体：它无请求体、授权链完整、且是
 * 真实重资源入口（入串行解析队列）—— 四道门禁里最容易确定性驱动的。
 * 其余三个入口（upload / createReview / rerunReview）接入方式完全同构，
 * 由单元测试 + enforceRateLimit 的单行调用保证。
 *
 * 副作用说明：每次放行都会真实触发一次解析入队；测试文档没有物理文件，
 * 解析会快速失败并标 FAILED —— 状态机自己闭环，不影响限流断言。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sessionStore } = vi.hoisted(() => ({
  sessionStore: { payload: undefined as { userId: string; issuedAt: number; expiresAt: number } | undefined },
}));

vi.mock("@/lib/auth/session", () => ({
  readSession: async () => sessionStore.payload,
}));

import { closeDatabase } from "@/lib/db";
import { createDocument } from "@/lib/documents/repository";
import { RATE_LIMIT_POLICIES, resetRateLimiters } from "@/lib/rate-limit/policy";
import { newId } from "@/lib/files";

import { cleanupUsers, createTestUser, createTestWorkspace } from "../helpers/fixtures";

import * as processRoute from "@/app/api/documents/[documentId]/process/route";

const createdUserIds: string[] = [];
const MAX = RATE_LIMIT_POLICIES.reprocess.max;

function setSession(userId: string): void {
  const now = Math.floor(Date.now() / 1000);
  sessionStore.payload = { userId, issuedAt: now, expiresAt: now + 3600 };
}

/** 直接落一行文档记录（不写物理文件 —— 解析会失败，但限流断言不关心）。 */
async function seedDocument(workspaceId: string, userId: string) {
  return createDocument({
    id: newId(),
    workspaceId,
    originalFilename: "重解析-示例.pdf",
    safeFilename: "重解析-示例.pdf",
    mimeType: "application/pdf",
    extension: ".pdf",
    size: 1024,
    checksum: "test-checksum",
    storagePath: `workspaces/${workspaceId}/documents/${newId()}.pdf`,
    createdBy: userId,
  });
}

async function callProcess(documentId: string): Promise<Response> {
  return processRoute.POST(
    new Request(`http://localhost/api/documents/${documentId}/process`, { method: "POST" }),
    { params: Promise.resolve({ documentId }) },
  ) as unknown as Promise<Response>;
}

describe("限流门禁 HTTP 契约（429）", () => {
  afterAll(async () => {
    await cleanupUsers(createdUserIds);
    await closeDatabase();
  });

  beforeEach(() => {
    resetRateLimiters();
  });

  it("窗口内放行 policy.max 次，之后 429 + Retry-After + RATE_LIMITED", async () => {
    const user = await createTestUser("rl");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "限流工作区");
    const doc = await seedDocument(workspace.id, user.id);
    setSession(user.id);

    // 前 max 次全部放行（额度内）。
    for (let i = 0; i < MAX; i += 1) {
      const response = await callProcess(doc.id);
      expect(response.status, `第 ${i + 1} 次应当放行`).toBe(200);
    }

    // 第 max+1 次：429，带标准 Retry-After 头与统一错误码。
    const denied = await callProcess(doc.id);
    expect(denied.status).toBe(429);
    const retryAfter = Number(denied.headers.get("retry-after"));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);

    const body = (await denied.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("额度按 user:workspace 隔离 —— 别人的窗口不受我刷屏影响", async () => {
    const userA = await createTestUser("rl-a");
    const userB = await createTestUser("rl-b");
    createdUserIds.push(userA.id, userB.id);
    const wsA = await createTestWorkspace(userA.id, "限流 A 区");
    const wsB = await createTestWorkspace(userB.id, "限流 B 区");
    const docA = await seedDocument(wsA.id, userA.id);
    const docB = await seedDocument(wsB.id, userB.id);

    setSession(userA.id);
    for (let i = 0; i < MAX; i += 1) {
      await callProcess(docA.id);
    }
    const deniedA = await callProcess(docA.id);
    expect(deniedA.status).toBe(429);

    // B 是完全独立的 key：第一次请求照样放行。
    setSession(userB.id);
    const firstB = await callProcess(docB.id);
    expect(firstB.status).toBe(200);
  });

  it("未登录请求走 401，不消耗任何人的限流名额", async () => {
    const user = await createTestUser("rl-anon");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "匿名探测工作区");
    const doc = await seedDocument(workspace.id, user.id);

    sessionStore.payload = undefined;
    const anonymous = await callProcess(doc.id);
    expect(anonymous.status).toBe(401);

    // 登录后第一次请求必须仍是满额放行 —— 匿名探测没有污染窗口。
    setSession(user.id);
    const first = await callProcess(doc.id);
    expect(first.status).toBe(200);
  });

  it("策略常量是测试断言的同一事实源", () => {
    expect(MAX).toBe(20);
    expect(RATE_LIMIT_POLICIES.upload.max).toBe(30);
    expect(RATE_LIMIT_POLICIES.review.max).toBe(10);
    // 防御性检查：所有窗口都是 60 秒（改窗口必须连这条一起改）。
    expect(RATE_LIMIT_POLICIES.upload.windowMs).toBe(60_000);
    expect(RATE_LIMIT_POLICIES.reprocess.windowMs).toBe(60_000);
    expect(RATE_LIMIT_POLICIES.review.windowMs).toBe(60_000);
  });
});
