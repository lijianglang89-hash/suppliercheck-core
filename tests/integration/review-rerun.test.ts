/**
 * 二次审核 / 重跑（真实 Postgres）。
 *
 * 核心疑点（James 提的）：
 *   1. 重跑时旧的 review_findings 是否被**原子替换**；
 *   2. 正文更新后，重跑能否**感知到变化**并给出新结论。
 *
 * 验证手法：先跑一次拿到基线结论，然后**直接改 document_texts 的正文**
 * （模拟「供应商补交了资料 / 修正了代码」），再触发 rerunReview，
 * 断言旧结论被清空、新结论精准覆盖 —— 而不是新旧叠加。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { closeDatabase, getDb } from "@/lib/db";
import { documentTexts, documents, reviewFindings, reviewRuns } from "@/lib/db/schema";
import { createInspectionTransform } from "@/lib/documents/inspect-stream";
import { enqueueDocumentProcessing, storeUploadedFile } from "@/lib/documents/service";
import { createReviewRunAndEnqueue, rerunReview } from "@/lib/reviews/service";

import { cleanupUsers, createTestUser, createTestWorkspace } from "../helpers/fixtures";

const FIXTURE = path.resolve(process.cwd(), "tests/fixtures/supplier-package-zh.pdf");
const createdUserIds: string[] = [];

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

/** 上传夹具并等到解析完成，返回 documentId。 */
async function uploadAndParse(workspaceId: string, userId: string): Promise<string> {
  const bytes = await readFile(FIXTURE);
  const inspection = createInspectionTransform({ maxBytes: 25 * 1024 * 1024 });
  const stream = Readable.from([bytes]).pipe(inspection);

  const doc = await storeUploadedFile({
    workspaceId,
    userId,
    originalFilename: "供应商准入资料包-示例.pdf",
    safeFilename: "供应商准入资料包-示例.pdf",
    mimeType: "application/pdf",
    stream,
    inspection,
  });

  await enqueueDocumentProcessing(doc.id);
  const ready = await waitUntil(async () => {
    const [row] = await getDb()
      .select({ status: documents.status })
      .from(documents)
      .where(eq(documents.id, doc.id))
      .limit(1);
    return row?.status === "READY";
  });
  if (!ready) throw new Error("文档解析未在超时前完成");
  return doc.id;
}

async function findingsOf(runId: string) {
  return getDb().select().from(reviewFindings).where(eq(reviewFindings.reviewRunId, runId));
}

async function waitRunDone(runId: string): Promise<boolean> {
  return waitUntil(async () => {
    const [row] = await getDb()
      .select({ status: reviewRuns.status })
      .from(reviewRuns)
      .where(eq(reviewRuns.id, runId))
      .limit(1);
    return row?.status === "READY";
  });
}

describe("重跑审核", () => {
  afterAll(async () => {
    await cleanupUsers(createdUserIds);
    await closeDatabase();
  });

  it("★ 正文更新后重跑：旧结论被原子替换，不是叠加", async () => {
    const user = await createTestUser("rerun");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "重跑工作区");

    const documentId = await uploadAndParse(workspace.id, user.id);

    const run = await createReviewRunAndEnqueue({
      workspaceId: workspace.id,
      userId: user.id,
      templateKey: "builtin:supplier-onboarding",
      documentIds: [documentId],
      supplierId: null,
      name: null,
    });
    expect(await waitRunDone(run.id)).toBe(true);

    const first = await findingsOf(run.id);
    const firstRuleIds = first.map((f) => f.ruleId).sort();
    expect(firstRuleIds).toContain("USCC_INVALID");
    expect(firstRuleIds).toContain("REQUIRED_DOCUMENT_MISSING");
    const firstCount = first.length;

    // —— 模拟「供应商补了资料、修正了代码」：直接把正文改掉 ——
    const [textRow] = await getDb()
      .select()
      .from(documentTexts)
      .where(eq(documentTexts.documentId, documentId))
      .limit(1);

    const corrected = (textRow?.text ?? "")
      // 修正统一社会信用代码校验位（引擎算出应为 P）
      .replace("91440606MA0000000X", "91440606MA0000000P")
      // 补上缺失的两类必备资料关键词
      .concat("\n开户许可证：开户银行 示例银行佛山分行，银行账号 4444 0000 0000 0000\n")
      .concat("纳税人资格：一般纳税人资格证明\n");

    await getDb()
      .update(documentTexts)
      .set({ text: corrected, charCount: corrected.length })
      .where(eq(documentTexts.documentId, documentId));

    const requeued = await rerunReview(run.id);
    expect(requeued.queued).toBe(true);

    expect(await waitRunDone(run.id)).toBe(true);

    const second = await findingsOf(run.id);
    const secondRuleIds = second.map((f) => f.ruleId).sort();

    // 修正过的代码不该再报校验失败；补上的资料不该再报缺失
    expect(secondRuleIds).not.toContain("USCC_INVALID");
    expect(secondRuleIds.filter((id) => id === "REQUIRED_DOCUMENT_MISSING")).toHaveLength(0);
    // 必须是**替换**而非叠加：条数不能比原来多
    expect(second.length).toBeLessThan(firstCount);
    // 每一条都还挂在同一个 run 与 workspace 上
    for (const f of second) {
      expect(f.reviewRunId).toBe(run.id);
      expect(f.workspaceId).toBe(workspace.id);
    }
  });

  it("重跑对已完成的 run 可以再次认领（不会被 already_running 挡住）", async () => {
    const user = await createTestUser("rerun2");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "重跑工作区2");

    const documentId = await uploadAndParse(workspace.id, user.id);
    const run = await createReviewRunAndEnqueue({
      workspaceId: workspace.id,
      userId: user.id,
      templateKey: "builtin:supplier-onboarding",
      documentIds: [documentId],
      supplierId: null,
      name: null,
    });
    expect(await waitRunDone(run.id)).toBe(true);

    // 已完成（READY）的 run 必须还能被重新认领 —— claimReviewRun 允许 READY
    const again = await rerunReview(run.id);
    expect(again.queued).toBe(true);
    expect(await waitRunDone(run.id)).toBe(true);

    const [snapshot] = await getDb()
      .select()
      .from(reviewRuns)
      .where(eq(reviewRuns.id, run.id))
      .limit(1);
    expect(snapshot?.status).toBe("READY");
    expect(snapshot?.errorCode).toBeNull();
  });
});
