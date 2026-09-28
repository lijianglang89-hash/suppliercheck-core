/**
 * 跨租户访问契约（HTTP 路由 + Server Action + 页面路径，真实 Postgres）。
 *
 * 背景：`findDocumentById` 等 id-only 取数是**文档化契约** —— repository 只按 id 查，
 * 归属校验由每个调用点自行完成（见 document-access-boundary.test.ts 头注释）。
 * 审计（2026-09-29）确认全部调用点都带了归属校验、零漏点；本文件把其中
 * 尚未被测试钉死的三条路径钉成回归锚点，防止未来重构时被无声踩掉：
 *
 *   1. GET /api/documents/[documentId] —— A 的会话打 B 的文档 → 403；
 *   2. POST /api/documents/[documentId]/process —— A 触发 B 文档重解析 → 403，
 *      且 B 的文档状态分毫未动（授权在认领之前，一个字节都不消耗）；
 *   3. rerunReviewAction —— A 重跑 B 的审核任务 → 表单错误，run 状态不变；
 *   4. 审核详情页（/reviews/[reviewId]）—— A 打开 B 的 runId → notFound()；
 *   5. 对照组：B 访问自己的资源一切正常（证明拒绝的是「越权」而不是「坏了」）。
 *
 * 手法与 rate-limit-contract.test.ts 相同：只 mock 会话读取（readSession），
 * 授权链（工作区成员判定）、路由 handler、Action、页面组件全部跑真实代码。
 * 页面组件直接以函数调用（RSC 组件即异步函数），notFound() 以抛错形式被捕获断言。
 */
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

const { sessionStore } = vi.hoisted(() => ({
  sessionStore: { payload: undefined as { userId: string; issuedAt: number; expiresAt: number } | undefined },
}));

vi.mock("@/lib/auth/session", () => ({
  readSession: async () => sessionStore.payload,
}));

import ReviewDetailPage from "@/app/reviews/[reviewId]/page";
import { rerunReviewAction } from "@/app/actions/reviews";
import { closeDatabase, getDb } from "@/lib/db";
import { documents, reviewRuns } from "@/lib/db/schema";
import { errorResponse, newRequestId } from "@/lib/api/route-utils";
import { errors } from "@/lib/errors";
import { createDocument } from "@/lib/documents/repository";
import { createReviewRun } from "@/lib/reviews/repository";
import { drainQueue } from "@/lib/jobs/serial-queue";
import { newId } from "@/lib/files";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/forms/form-state";

import { cleanupUsers, createTestUser, createTestWorkspace } from "../helpers/fixtures";

import * as detailRoute from "@/app/api/documents/[documentId]/route";
import * as processRoute from "@/app/api/documents/[documentId]/process/route";

const createdUserIds: string[] = [];

function setSession(userId: string | undefined): void {
  if (!userId) {
    sessionStore.payload = undefined;
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  sessionStore.payload = { userId, issuedAt: now, expiresAt: now + 3600 };
}

/** 直接落一行文档记录（不写物理文件 —— 授权断言不关心解析成败）。 */
async function seedDocument(workspaceId: string, userId: string) {
  return createDocument({
    id: newId(),
    workspaceId,
    originalFilename: "跨租户-示例.pdf",
    safeFilename: "跨租户-示例.pdf",
    mimeType: "application/pdf",
    extension: ".pdf",
    size: 1024,
    checksum: "test-checksum",
    storagePath: `workspaces/${workspaceId}/documents/${newId()}.pdf`,
    createdBy: userId,
  });
}

/** 直接落一行审核任务（QUEUED；授权断言不关心审核执行）。 */
async function seedReviewRun(workspaceId: string, userId: string, documentId: string) {
  return createReviewRun({
    workspaceId,
    name: "跨租户审计任务",
    supplierId: null,
    templateName: "供应商准入审核",
    templateKey: "builtin:supplier-onboarding",
    templateSnapshot: {},
    documentIds: [documentId],
    engineProvider: "mock",
    engineModel: "mock",
    engineMock: true,
    createdBy: userId,
  });
}

describe("跨租户访问契约（IDOR 防线锚点）", () => {
  const ctx: {
    userA?: { id: string };
    userB?: { id: string };
    wsA?: { id: string };
    wsB?: { id: string };
    docB?: Awaited<ReturnType<typeof seedDocument>>;
    docA?: Awaited<ReturnType<typeof seedDocument>>;
    runB?: Awaited<ReturnType<typeof seedReviewRun>>;
  } = {};

  afterAll(async () => {
    await cleanupUsers(createdUserIds);
    await closeDatabase();
  });

  it("★ A 的会话访问 B 的文档详情 → 403（授权在「按 id 取行」之后立即生效）", async () => {
    const userA = await createTestUser("xt-a");
    const userB = await createTestUser("xt-b");
    createdUserIds.push(userA.id, userB.id);
    ctx.userA = userA;
    ctx.userB = userB;
    ctx.wsA = await createTestWorkspace(userA.id, "跨租户 A 区");
    ctx.wsB = await createTestWorkspace(userB.id, "跨租户 B 区");
    ctx.docA = await seedDocument(ctx.wsA.id, userA.id);
    ctx.docB = await seedDocument(ctx.wsB.id, userB.id);
    ctx.runB = await seedReviewRun(ctx.wsB.id, userB.id, ctx.docB.id);

    setSession(userA.id);
    const response = (await detailRoute.GET(
      new Request(`http://localhost/api/documents/${ctx.docB.id}`),
      { params: Promise.resolve({ documentId: ctx.docB.id }) },
    )) as unknown as Response;

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
    // 错误响应绝不携带 B 的任何文档数据
    expect(JSON.stringify(body)).not.toContain("跨租户-示例.pdf");
  });

  it("★ A 触发 B 文档重解析 → 403，且 B 的文档状态分毫未动", async () => {
    setSession(ctx.userA!.id);
    const response = (await processRoute.POST(
      new Request(`http://localhost/api/documents/${ctx.docB!.id}/process`, { method: "POST" }),
      { params: Promise.resolve({ documentId: ctx.docB!.id }) },
    )) as unknown as Response;

    expect(response.status).toBe(403);

    // 授权在认领之前：B 的文档不得被翻成 PROCESSING，更不得入队。
    const [row] = await getDb()
      .select({ status: documents.status })
      .from(documents)
      .where(eq(documents.id, ctx.docB!.id))
      .limit(1);
    expect(row?.status).toBe("UPLOADED");
  });

  it("★ A 重跑 B 的审核任务 → 表单错误「没有找到」，run 状态不变", async () => {
    setSession(ctx.userA!.id);
    const formData = new FormData();
    formData.set("runId", ctx.runB!.id);

    const state = (await rerunReviewAction(EMPTY_FORM_STATE, formData)) as FormState;

    expect(state.status).toBe("error");
    expect(state.error).toContain("没有找到对应的审核任务");

    // B 的任务既没有被认领也没有被标记失败 —— 状态分毫未动。
    const [row] = await getDb()
      .select({ status: reviewRuns.status })
      .from(reviewRuns)
      .where(eq(reviewRuns.id, ctx.runB!.id))
      .limit(1);
    expect(row?.status).toBe("QUEUED");
  });

  it("★ A 打开 B 的审核详情页 → notFound（页面路径的授权判据是库里的 workspaceId）", async () => {
    setSession(ctx.userA!.id);
    try {
      await ReviewDetailPage({ params: Promise.resolve({ reviewId: ctx.runB!.id }) });
      throw new Error("页面应当 notFound，却正常渲染了 —— 越权漏洞！");
    } catch (error) {
      const sig = `${(error as Error).message}|${(error as { digest?: string }).digest ?? ""}`;
      // notFound() 以 NEXT_HTTP_ERROR_FALLBACK;404 形态抛出
      expect(sig).toMatch(/404/);
    }
  });

  it("对照组：B 访问自己的文档 / 任务 / 页面全部正常（拒绝的是越权，不是坏了）", async () => {
    setSession(ctx.userB!.id);

    // 自己的文档详情 → 200
    const detail = (await detailRoute.GET(
      new Request(`http://localhost/api/documents/${ctx.docB!.id}`),
      { params: Promise.resolve({ documentId: ctx.docB!.id }) },
    )) as unknown as Response;
    expect(detail.status).toBe(200);

    // 自己的详情页 → 正常渲染（不抛 notFound）
    const rendered = await ReviewDetailPage({
      params: Promise.resolve({ reviewId: ctx.runB!.id }),
    });
    expect(rendered).toBeTruthy();

    // 自己的任务重跑 → 表单成功（真实入队；随后等队列排空，别把任务带进 closeDatabase）
    const formData = new FormData();
    formData.set("runId", ctx.runB!.id);
    const state = (await rerunReviewAction(EMPTY_FORM_STATE, formData)) as FormState;
    expect(state.status).toBe("success");
    await drainQueue();

    // 顺手钉一个已知契约：未登录一律 401，且不因 id 是否存在而不同
    setSession(undefined);
    const anonymous = (await detailRoute.GET(
      new Request(`http://localhost/api/documents/${ctx.docB!.id}`),
      { params: Promise.resolve({ documentId: ctx.docB!.id }) },
    )) as unknown as Response;
    expect(anonymous.status).toBe(401);
  });

  it("防退化锚点：errorResponse 对越权拒绝也回写 X-Request-Id（#2 链路契约不被越权路径破坏）", () => {
    // 直接驱动 errorResponse：403 分支也要带 trace 头（与成功响应一致）。
    const requestId = newRequestId();
    const response = errorResponse(errors.forbidden("探针：越权拒绝"), requestId);
    expect(response.status).toBe(403);
    expect(response.headers.get("x-request-id")).toBe(requestId);
  });
});
