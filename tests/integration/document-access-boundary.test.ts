/**
 * 文档访问的越权与软删除边界（真实 Postgres）。
 *
 * 摸底结论先说清楚，避免重复劳动：
 *   - `/api/files/[documentId]` 与 `/api/files/signed/[token]` 的**授权链路本身是对的**：
 *     先要会话（避免 id 枚举），再按**查出来的** workspaceId 走 requireWorkspaceAccess，
 *     最后才开流；签名是 HMAC-SHA256 + timingSafeEqual 且绑定 (key, expiresAt)，
 *     过期 / 换 key / 延期续用全部拒绝（tests/unit/storage-signature.test.ts 已覆盖 8 项）。
 *   - 所以这里补的是**数据层**那条更底线的边界：软删除之后，这些取数入口还能不能
 *     把文档翻出来。路由再严，如果 repository 会返回已删除的行，一样是越权。
 *
 * 顺带钉死一个容易踩的契约：
 *   `findDocumentById` **只按 id 查、不按 workspace 过滤**（调用方必须自己校验归属）。
 *   这不是缺陷，但任何新调用点都必须跟一次工作区校验，否则就是越权口子。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { closeDatabase, getDb } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { createInspectionTransform } from "@/lib/documents/inspect-stream";
import {
  findDocumentById,
  findDocumentByStoragePath,
  listDocumentsWithText,
} from "@/lib/documents/repository";
import { enqueueDocumentProcessing, storeUploadedFile } from "@/lib/documents/service";
import { createReviewRunAndEnqueue } from "@/lib/reviews/service";

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

/** 软删除：置 DELETED 状态并打 deletedAt（与产品行为一致，硬数据保留）。 */
async function softDelete(documentId: string): Promise<void> {
  await getDb()
    .update(documents)
    .set({ status: "DELETED", deletedAt: new Date() })
    .where(eq(documents.id, documentId));
}

describe("文档访问边界：软删除与跨工作区", () => {
  afterAll(async () => {
    await cleanupUsers(createdUserIds);
    await closeDatabase();
  });

  it("★ 软删除后所有下载入口都取不到这份文档", async () => {
    const user = await createTestUser("softdel");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "软删除工作区");

    const documentId = await uploadAndParse(workspace.id, user.id);
    expect(await findDocumentById(documentId)).toBeDefined();

    await softDelete(documentId);

    // 按 id 查 —— 取不到（下载路由就是靠它拿文档的）
    expect(await findDocumentById(documentId)).toBeUndefined();

    // 按存储路径查 —— 也取不到（签名下载路由靠它把 key 反查成文档）
    const [row] = await getDb()
      .select({ storagePath: documents.storagePath })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    expect(await findDocumentByStoragePath(row!.storagePath)).toBeUndefined();
  });

  it("★ 软删除的资料不再进入审核输入", async () => {
    const user = await createTestUser("softdel2");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "软删除审核工作区");

    const documentId = await uploadAndParse(workspace.id, user.id);
    await softDelete(documentId);

    const rows = await listDocumentsWithText(workspace.id, [documentId]);
    expect(rows).toHaveLength(0);

    /*
     * 实测行为（比预期更严，按实测写断言）：
     * 服务层**在创建阶段就直接拒绝**用已删除的资料发起审核 ——
     * 抛「部分资料不存在或不属于当前工作区」，而不是先建 run 再产出空结论。
     * 这样前端拿到的是一个清晰的错误，而不是一份看起来跑过、其实什么都没查的报告。
     */
    await expect(
      createReviewRunAndEnqueue({
        workspaceId: workspace.id,
        userId: user.id,
        templateKey: "builtin:supplier-onboarding",
        documentIds: [documentId],
        supplierId: null,
        name: null,
      }),
    ).rejects.toThrow(/不存在或不属于当前工作区/);
  });

  it("★ 跨工作区取不到对方的文档（取数层隔离）", async () => {
    const userA = await createTestUser("accA");
    const userB = await createTestUser("accB");
    createdUserIds.push(userA.id, userB.id);
    const wsA = await createTestWorkspace(userA.id, "A 区");
    const wsB = await createTestWorkspace(userB.id, "B 区");

    const documentId = await uploadAndParse(wsA.id, userA.id);

    // 用 B 的 workspaceId 去列 —— 必须是空的
    const rowsForB = await listDocumentsWithText(wsB.id, [documentId]);
    expect(rowsForB).toHaveLength(0);

    // 用 A 的可以列出来
    const rowsForA = await listDocumentsWithText(wsA.id, [documentId]);
    expect(rowsForA).toHaveLength(1);
  });

  it("契约记录：findDocumentById 不按工作区过滤，调用方必须自己校验归属", async () => {
    const userA = await createTestUser("contractA");
    const userB = await createTestUser("contractB");
    createdUserIds.push(userA.id, userB.id);
    const wsA = await createTestWorkspace(userA.id, "契约 A 区");
    await createTestWorkspace(userB.id, "契约 B 区");

    const documentId = await uploadAndParse(wsA.id, userA.id);

    // 故意用「只按 id 查」的入口：它确实能取到（不按 workspace 过滤是刻意设计）。
    // 这行的存在是为了让后来的改动者看见：调用它之后**必须**跟着一次工作区校验，
    // 否则就是一个越权口子。路由里是
    // requireWorkspaceAccess(document.workspaceId, ...) —— 用的是查出来的值，不是浏览器传的。
    const doc = await findDocumentById(documentId);
    expect(doc).toBeDefined();
    expect(doc?.workspaceId).toBe(wsA.id);
  });
});
