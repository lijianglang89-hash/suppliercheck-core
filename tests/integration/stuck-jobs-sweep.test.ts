/**
 * 僵尸任务自动扫尾（sweep）的集成验证（真实 Postgres）。
 *
 * 物理事实：单容器下 OOM / 重启会让文档停在 PROCESSING、审核停在 RUNNING，
 * 无人写终态，界面永远转圈。sweep（挂在 /api/cron/gc 上）把它们精准打回
 * FAILED 并带上「系统中断」文案，释放状态机。
 *
 * 三组必须同时成立的断言：
 *   1. 僵尸任务（超阈值的 PROCESSING / RUNNING）→ 被打回 FAILED + 文案；
 *   2. 健康任务（同状态、未超阈值）→ 分毫不动（不误杀）；
 *   3. 被收走的任务 → 用户可以立即重新认领重跑（与手动 stale claim 同一通路）。
 *
 * 阈值与判定标尺复用 lib/jobs/limits 的既有常量 —— sweep 与手动重跑
 * 是同一把尺子的两个触发方式，测试从常量取值，不许再抄一份数字。
 */
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { closeDatabase, getDb } from "@/lib/db";
import { documentProcessingJobs, documents, reviewRuns } from "@/lib/db/schema";
import { ERROR_CODES } from "@/lib/errors";
import { STALE_JOB_THRESHOLD_MS, STUCK_JOB_ERROR_MESSAGE } from "@/lib/jobs/limits";
import { REVIEW_STALE_THRESHOLD_MS } from "@/lib/reviews/limits";
import { enqueueDocumentProcessing, sweepStuckDocuments } from "@/lib/documents/service";
import { createDocument, startJob } from "@/lib/documents/repository";
import { enqueueReviewRun, sweepStuckReviewRuns } from "@/lib/reviews/service";
import { createReviewRun } from "@/lib/reviews/repository";
import { drainQueue } from "@/lib/jobs/serial-queue";
import { newId } from "@/lib/files";

import { cleanupUsers, createTestUser, createTestWorkspace } from "../helpers/fixtures";

const createdUserIds: string[] = [];

/** 把一行的 updatedAt 回拨到指定分钟之前（制造「僵尸」形态）。 */
async function backdateUpdatedAt(
  table: typeof documents | typeof reviewRuns,
  id: string,
  minutesAgo: number,
): Promise<void> {
  await getDb()
    .update(table)
    .set({ updatedAt: new Date(Date.now() - minutesAgo * 60 * 1000) })
    .where(eq(table.id, id));
}

describe("僵尸任务自动扫尾（sweep）", () => {
  afterAll(async () => {
    await cleanupUsers(createdUserIds);
    await closeDatabase();
  });

  it("★ 僵尸解析任务被打回 FAILED + 文案；健康任务不动；收走后可立即重跑", async () => {
    const user = await createTestUser("sweep");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "扫尾工作区");

    const thresholdMin = Math.ceil(STALE_JOB_THRESHOLD_MS / 60000); // 从常量取值，不抄数字
    const zombie = await createDocument({
      id: newId(),
      workspaceId: workspace.id,
      originalFilename: "僵尸-示例.pdf",
      safeFilename: "僵尸-示例.pdf",
      mimeType: "application/pdf",
      extension: ".pdf",
      size: 1024,
      checksum: "c1",
      storagePath: `workspaces/${workspace.id}/documents/${newId()}.pdf`,
      createdBy: user.id,
    });
    const fresh = await createDocument({
      id: newId(),
      workspaceId: workspace.id,
      originalFilename: "健康-示例.pdf",
      safeFilename: "健康-示例.pdf",
      mimeType: "application/pdf",
      extension: ".pdf",
      size: 1024,
      checksum: "c2",
      storagePath: `workspaces/${workspace.id}/documents/${newId()}.pdf`,
      createdBy: user.id,
    });

    // 摆成僵尸形态：PROCESSING + 超阈值；任务行 RUNNING 且同样超阈值。
    for (const doc of [zombie, fresh]) {
      await getDb()
        .update(documents)
        .set({ status: "PROCESSING", processingStatus: "RUNNING" })
        .where(eq(documents.id, doc.id));
    }
    const zombieJobId = await startJob({ workspaceId: workspace.id, documentId: zombie.id, jobType: "EXTRACT_TEXT" });
    await getDb()
      .update(documentProcessingJobs)
      .set({ startedAt: new Date(Date.now() - (thresholdMin + 1) * 60 * 1000) })
      .where(eq(documentProcessingJobs.id, zombieJobId));
    await backdateUpdatedAt(documents, zombie.id, thresholdMin + 1);
    // 健康文档保持 updatedAt = 现在（不回拨）。

    const result = await sweepStuckDocuments();
    expect(result.documents).toBeGreaterThanOrEqual(1);
    expect(result.jobs).toBeGreaterThanOrEqual(1);

    // 僵尸：FAILED
    const [zombieRow] = await getDb().select().from(documents).where(eq(documents.id, zombie.id)).limit(1);
    expect(zombieRow?.status).toBe("FAILED");
    expect(zombieRow?.processingStatus).toBe("FAILED");

    // 任务行：FAILED + 明确文案（使用者知道发生了什么、该做什么）
    const [jobRow] = await getDb()
      .select()
      .from(documentProcessingJobs)
      .where(eq(documentProcessingJobs.id, zombieJobId))
      .limit(1);
    expect(jobRow?.status).toBe("FAILED");
    expect(jobRow?.errorCode).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(jobRow?.errorMessage).toBe(STUCK_JOB_ERROR_MESSAGE);

    // 健康：分毫不动（不误杀 —— 这是 sweep 的生命线）
    const [freshRow] = await getDb().select().from(documents).where(eq(documents.id, fresh.id)).limit(1);
    expect(freshRow?.status).toBe("PROCESSING");

    // 收走之后：允许重新认领重跑（与手动 stale claim 同一通路）
    const rerun = await enqueueDocumentProcessing(zombie.id);
    expect(rerun.queued).toBe(true);
    await drainQueue(); // 重跑会真实执行并失败（无物理文件）——让状态机自己闭环
  });

  it("★ 僵尸审核任务被打回 FAILED + 文案；健康审核不动；收走后可立即重跑", async () => {
    const user = await createTestUser("sweep-run");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "审核扫尾工作区");

    const doc = await createDocument({
      id: newId(),
      workspaceId: workspace.id,
      originalFilename: "审核扫尾-示例.pdf",
      safeFilename: "审核扫尾-示例.pdf",
      mimeType: "application/pdf",
      extension: ".pdf",
      size: 1024,
      checksum: "c3",
      storagePath: `workspaces/${workspace.id}/documents/${newId()}.pdf`,
      createdBy: user.id,
    });

    const runInput = {
      workspaceId: workspace.id,
      name: "扫尾审核",
      supplierId: null,
      templateName: "供应商准入审核",
      templateKey: "builtin:supplier-onboarding",
      templateSnapshot: {},
      documentIds: [doc.id],
      engineProvider: "mock",
      engineModel: "mock",
      engineMock: true,
      createdBy: user.id,
    };
    const zombieRun = await createReviewRun(runInput);
    const freshRun = await createReviewRun(runInput);

    // 摆成僵尸形态：RUNNING + 超阈值（审核侧阈值 5 分钟，常量见 reviews/limits）。
    const staleMin = Math.ceil(REVIEW_STALE_THRESHOLD_MS / 60000);
    for (const run of [zombieRun, freshRun]) {
      await getDb().update(reviewRuns).set({ status: "RUNNING" }).where(eq(reviewRuns.id, run.id));
    }
    await backdateUpdatedAt(reviewRuns, zombieRun.id, staleMin + 1);

    const swept = await sweepStuckReviewRuns();
    expect(swept).toBeGreaterThanOrEqual(1);

    const [zombieRow] = await getDb().select().from(reviewRuns).where(eq(reviewRuns.id, zombieRun.id)).limit(1);
    expect(zombieRow?.status).toBe("FAILED");
    expect(zombieRow?.errorCode).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(zombieRow?.errorMessage).toBe(STUCK_JOB_ERROR_MESSAGE);
    expect(zombieRow?.finishedAt).not.toBeNull();

    // 健康审核：分毫不动
    const [freshRow] = await getDb().select().from(reviewRuns).where(eq(reviewRuns.id, freshRun.id)).limit(1);
    expect(freshRow?.status).toBe("RUNNING");

    // 收走之后：允许重新认领重跑
    const rerun = await enqueueReviewRun(zombieRun.id);
    expect(rerun.queued).toBe(true);
    await drainQueue();
  });

  it("★ UPLOADED 文档与 QUEUED 审核不是僵尸 —— sweep 不碰它们", async () => {
    const user = await createTestUser("sweep-skip");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "扫尾豁免工作区");

    const doc = await createDocument({
      id: newId(),
      workspaceId: workspace.id,
      originalFilename: "未入队-示例.pdf",
      safeFilename: "未入队-示例.pdf",
      mimeType: "application/pdf",
      extension: ".pdf",
      size: 1024,
      checksum: "c4",
      storagePath: `workspaces/${workspace.id}/documents/${newId()}.pdf`,
      createdBy: user.id,
    });
    const run = await createReviewRun({
      workspaceId: workspace.id,
      name: "排队中审核",
      supplierId: null,
      templateName: "供应商准入审核",
      templateKey: "builtin:supplier-onboarding",
      templateSnapshot: {},
      documentIds: [doc.id],
      engineProvider: "mock",
      engineModel: "mock",
      engineMock: true,
      createdBy: user.id,
    });

    // 即使时间戳早已超阈值，状态本身不在扫尾范围（UPLOADED/QUEUED 可被用户直接重跑）。
    await backdateUpdatedAt(documents, doc.id, 60);
    await backdateUpdatedAt(reviewRuns, run.id, 60);

    await sweepStuckDocuments();
    await sweepStuckReviewRuns();

    const [docRow] = await getDb().select({ status: documents.status }).from(documents).where(eq(documents.id, doc.id)).limit(1);
    expect(docRow?.status).toBe("UPLOADED");
    const [runRow] = await getDb().select({ status: reviewRuns.status }).from(reviewRuns).where(eq(reviewRuns.id, run.id)).limit(1);
    expect(runRow?.status).toBe("QUEUED");
  });
});
