/**
 * 审核工作流端到端（真实 Postgres）。
 *
 * 覆盖此前**完全没有被自动化验证过**的一条链路：
 *   上传落库 → 解析状态机（UPLOADED → PROCESSING → READY）→ 发起审核 → 结论落库
 *
 * 为什么必须补：
 *   - tests/unit/reviews-real-pdf.test.ts 验证的是「引擎在真实文档上算得对」，
 *     但它绕过数据库和服务层，证明不了**这一整条业务流真的跑得通**；
 *   - tests/manual/e2e-review-run.test.ts 是 describe.skip，依赖「库里已有的资料」，
 *     等于 CI 里没有覆盖；
 *   - 既有的 tests/integration/* 都是直接 db.insert 造数据，不走服务层。
 *
 * ⚠️ two个刻意的设计：
 *   1. 全程用真实的中文 PDF 夹具，不是合成字节 —— 合成数据证明不了真实链路；
 *   2. 状态迁移靠**轮询**而不是 sleep：解析/审核都是「入队即返回」，
 *      固定 sleep 会在慢机器上假红、在快机器上浪费时间。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { closeDatabase, getDb } from "@/lib/db";
import { documentTexts, documents, reviewFindings, reviewRuns } from "@/lib/db/schema";
import { createInspectionTransform } from "@/lib/documents/inspect-stream";
import { enqueueDocumentProcessing, storeUploadedFile } from "@/lib/documents/service";
import { createReviewRunAndEnqueue } from "@/lib/reviews/service";

import { cleanupUsers, createTestUser, createTestWorkspace } from "../helpers/fixtures";

const FIXTURE = path.resolve(process.cwd(), "tests/fixtures/supplier-package-zh.pdf");
const MOJIBAKE_PATTERN = /[\uFFFD]|â€|Ã[\u0080-\u00BF]|ä¸|å[¼¾]/;

const createdUserIds: string[] = [];

/** 轮询直到条件成立或超时。返回 false 表示超时（让断言自己报错，比抛异常信息量大）。 */
async function waitUntil(
  predicate: () => Promise<boolean>,
  { timeoutMs = 20000, intervalMs = 120 } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function uploadFixture(workspaceId: string, userId: string) {
  const bytes = await readFile(FIXTURE);
  const inspection = createInspectionTransform({ maxBytes: 25 * 1024 * 1024 });
  const stream = Readable.from([bytes]).pipe(inspection);

  return storeUploadedFile({
    workspaceId,
    userId,
    originalFilename: "供应商准入资料包-示例.pdf",
    safeFilename: "供应商准入资料包-示例.pdf",
    mimeType: "application/pdf",
    stream,
    inspection,
  });
}

describe("审核工作流端到端（真实数据库）", () => {
  afterAll(async () => {
    await cleanupUsers(createdUserIds);
    await closeDatabase();
  });

  it("上传 → 解析 → 状态机走完 → 正文落库", async () => {
    const user = await createTestUser("pipe");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "流水线工作区");

    const doc = await uploadFixture(workspace.id, user.id);
    expect(doc.status).toBe("UPLOADED");
    expect(doc.workspaceId).toBe(workspace.id);

    const queued = await enqueueDocumentProcessing(doc.id);
    expect(queued.queued).toBe(true);

    const ready = await waitUntil(async () => {
      const [row] = await getDb()
        .select({ status: documents.status })
        .from(documents)
        .where(eq(documents.id, doc.id))
        .limit(1);
      return row?.status === "READY";
    });
    expect(ready).toBe(true);

    const [textRow] = await getDb()
      .select()
      .from(documentTexts)
      .where(eq(documentTexts.documentId, doc.id))
      .limit(1);

    expect(textRow).toBeDefined();
    expect(textRow?.parserId).toBe("pdf");
    expect(textRow?.charCount).toBeGreaterThan(1000);
    expect(textRow?.truncated).toBe(false);
    // 正文必须挂在**同一个工作区**下 —— 否则隔离就是假的
    expect(textRow?.workspaceId).toBe(workspace.id);
    expect(MOJIBAKE_PATTERN.test(textRow?.text ?? "")).toBe(false);
    expect(textRow?.text).toContain("91440606MA0000000X");
  });

  it("重复触发解析不会重复干活（状态机幂等）", async () => {
    const user = await createTestUser("idem");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "幂等工作区");

    const doc = await uploadFixture(workspace.id, user.id);
    await enqueueDocumentProcessing(doc.id);
    await waitUntil(async () => {
      const [row] = await getDb()
        .select({ status: documents.status })
        .from(documents)
        .where(eq(documents.id, doc.id))
        .limit(1);
      return row?.status === "READY";
    });

    const second = await enqueueDocumentProcessing(doc.id);
    expect(second.queued).toBe(false);
    expect(second.reason).toBe("already_ready");
  });

  it("发起审核 → 结论持久化 → 可按工作区追溯", async () => {
    const user = await createTestUser("run");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "审核工作区");

    const doc = await uploadFixture(workspace.id, user.id);
    await enqueueDocumentProcessing(doc.id);
    const parsed = await waitUntil(async () => {
      const [row] = await getDb()
        .select({ status: documents.status })
        .from(documents)
        .where(eq(documents.id, doc.id))
        .limit(1);
      return row?.status === "READY";
    });
    expect(parsed).toBe(true);

    const run = await createReviewRunAndEnqueue({
      workspaceId: workspace.id,
      userId: user.id,
      templateKey: "builtin:supplier-onboarding",
      documentIds: [doc.id],
      supplierId: null,
      name: null,
    });
    expect(run.status).toBe("QUEUED");

    const done = await waitUntil(async () => {
      const [row] = await getDb()
        .select({ status: reviewRuns.status })
        .from(reviewRuns)
        .where(eq(reviewRuns.id, run.id))
        .limit(1);
      return row?.status === "READY";
    });
    expect(done).toBe(true);

    const findings = await getDb()
      .select()
      .from(reviewFindings)
      .where(eq(reviewFindings.reviewRunId, run.id));

    // 与 tests/unit/reviews-real-pdf.test.ts 的引擎结论对得上才算真打通
    // （那条测的是引擎，这条测的是「引擎的结论真的进了库」）
    const ruleIds = findings.map((f) => f.ruleId).sort();
    expect(ruleIds).toContain("USCC_INVALID");
    expect(ruleIds).toContain("REQUIRED_DOCUMENT_MISSING");
    expect(findings.length).toBeGreaterThanOrEqual(3);

    for (const f of findings) {
      expect(f.workspaceId).toBe(workspace.id);
      expect(f.reviewRunId).toBe(run.id);
    }

    // 发现必须能追溯到具体资料
    const withDoc = findings.filter((f) => f.documentId);
    expect(withDoc.length).toBeGreaterThan(0);

    const [snapshot] = await getDb()
      .select()
      .from(reviewRuns)
      .where(eq(reviewRuns.id, run.id))
      .limit(1);
    expect(snapshot?.status).toBe("READY");
    expect(snapshot?.errorCode).toBeNull();
  });

  it("★ 另一个工作区查不到这次审核与它的发现", async () => {
    const userA = await createTestUser("isoA");
    const userB = await createTestUser("isoB");
    createdUserIds.push(userA.id, userB.id);
    const wsA = await createTestWorkspace(userA.id, "A 区");
    const wsB = await createTestWorkspace(userB.id, "B 区");

    const doc = await uploadFixture(wsA.id, userA.id);
    await enqueueDocumentProcessing(doc.id);
    await waitUntil(async () => {
      const [row] = await getDb()
        .select({ status: documents.status })
        .from(documents)
        .where(eq(documents.id, doc.id))
        .limit(1);
      return row?.status === "READY";
    });

    const run = await createReviewRunAndEnqueue({
      workspaceId: wsA.id,
      userId: userA.id,
      templateKey: "builtin:supplier-onboarding",
      documentIds: [doc.id],
      supplierId: null,
      name: null,
    });
    await waitUntil(async () => {
      const [row] = await getDb()
        .select({ status: reviewRuns.status })
        .from(reviewRuns)
        .where(eq(reviewRuns.id, run.id))
        .limit(1);
      return row?.status === "READY";
    });

    // 用 B 的 workspaceId 查 —— 一条都不该有
    const leak = await getDb()
      .select()
      .from(reviewFindings)
      .where(
        and(eq(reviewFindings.workspaceId, wsB.id), eq(reviewFindings.reviewRunId, run.id)),
      );
    expect(leak).toHaveLength(0);

    const leakRuns = await getDb()
      .select()
      .from(reviewRuns)
      .where(and(eq(reviewRuns.workspaceId, wsB.id), eq(reviewRuns.id, run.id)));
    expect(leakRuns).toHaveLength(0);
  });

  /**
   * ★ READY 门禁（探针 #2 修复的回归钉）：解析未完成的资料不能被拉进审核。
   *
   * 引擎对文本缺失的资料是宽容的（只记 note 不报错），但宽容产出的是
   * 「看起来跑完、实际什么都没查」的幽灵报告 —— 门禁在创建时就把这条路堵死。
   * 三个非就绪状态各验一次；软删除资料走的是另一条 notFound 分支
   * （document-access-boundary.test.ts 已钉），这里不重复。
   */
  it("★ UPLOADED / PROCESSING / FAILED 的资料发起审核一律被 409 拒绝", async () => {
    const user = await createTestUser("gate");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "门禁工作区");

    for (const status of ["UPLOADED", "PROCESSING", "FAILED"] as const) {
      const doc = await uploadFixture(workspace.id, user.id);
      if (status !== "UPLOADED") {
        await getDb().update(documents).set({ status }).where(eq(documents.id, doc.id));
      }

      await expect(
        createReviewRunAndEnqueue({
          workspaceId: workspace.id,
          userId: user.id,
          templateKey: "builtin:supplier-onboarding",
          documentIds: [doc.id],
          supplierId: null,
          name: null,
        }),
      ).rejects.toThrow(/尚未完成解析/);
    }

    // 门禁拦下的请求不能留下任何 run —— 连「建了再失败」都不允许
    const runs = await getDb()
      .select()
      .from(reviewRuns)
      .where(eq(reviewRuns.workspaceId, workspace.id));
    expect(runs).toHaveLength(0);
  });
});
