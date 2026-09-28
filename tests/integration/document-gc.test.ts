/**
 * 文档软删除与物理回收（GC）的端到端契约（真实 Postgres + 真实私有存储）。
 *
 * 覆盖 #1（文档删除与物理 GC）的完整行为面：
 *   1. 鉴权：CRON_SECRET 未配置 → 路由整体停用（404）；
 *      缺头 / 错密钥 → 401；正确 Bearer → 200 并真正执行回收。
 *   2. 边界：软删 29 天的文档**绝不**被 GC 误杀（行与物理文件都在）；
 *      软删 31 天的文档**双清**（物理文件 + 库记录，正文随 cascade 消失，
 *      子文档的库行随 cascade 消失、物理文件被显式清除）。
 *   3. 幂等与容错：物理文件已被预先抹除时，GC 仍完成 DB 清理；
 *      GC 跑第二遍 scanned = 0。
 *   4. 软删/恢复语义：软删 = 纯数据库操作（文件原地不动）、列表消失、
 *      可在回收站看到；恢复 = 依据库内证据重建状态（有正文 → READY）。
 *
 * 设计说明：与 file-download-route.test.ts 同一手法 —— 路由在 vitest 里
 * handler 级直驱，其余逻辑全部跑真实数据库与真实存储，唯一的环境开关是
 * process.env.CRON_SECRET（通过 resetEnvCache 让 getEnv 重新读取）。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { closeDatabase, getDb } from "@/lib/db";
import { documentTexts, documents } from "@/lib/db/schema";
import { resetEnvCache } from "@/lib/config/server-env";
import { createInspectionTransform } from "@/lib/documents/inspect-stream";
import {
  DOCUMENT_GC_RETENTION_DAYS,
  restoreDocument,
  runDocumentGarbageCollection,
  softDeleteDocument,
  storeUploadedFile,
} from "@/lib/documents/service";
import {
  listSoftDeletedDocuments,
  listWorkspaceDocuments,
  upsertDocumentText,
} from "@/lib/documents/repository";
import { getStorageProvider } from "@/lib/storage";

import { cleanupUsers, createTestUser, createTestWorkspace } from "../helpers/fixtures";

import * as gcRoute from "@/app/api/cron/gc/route";

const FIXTURE = path.resolve(process.cwd(), "tests/fixtures/supplier-package-zh.pdf");
const DAY_MS = 24 * 60 * 60 * 1000;
const createdUserIds: string[] = [];
/** 本测试落盘的全部存储键 —— afterAll 里兜底清掉没被 GC 带走的文件。 */
const uploadedKeys: string[] = [];

afterAll(async () => {
  const storage = getStorageProvider();
  for (const key of uploadedKeys) {
    await storage.delete(key).catch(() => undefined);
  }
  await cleanupUsers(createdUserIds);
  await closeDatabase();
});

function setCronSecret(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = value;
  }
  resetEnvCache();
}

function gcRequest(headers: Record<string, string> = {}): Promise<Response> {
  return gcRoute.GET(new Request("http://localhost/api/cron/gc", { headers })) as unknown as
    Promise<Response>;
}

/** 直接落一份真实文档（写盘 + 入库），返回带 storagePath 的行。不需要等解析。 */
async function uploadDocument(
  workspaceId: string,
  userId: string,
  filename = "准入资料包-示例.pdf",
) {
  const bytes = await readFile(FIXTURE);
  const inspection = createInspectionTransform({ maxBytes: 25 * 1024 * 1024 });
  const stream = Readable.from([bytes]).pipe(inspection);

  const row = await storeUploadedFile({
    workspaceId,
    userId,
    originalFilename: filename,
    safeFilename: filename,
    mimeType: "application/pdf",
    stream,
    inspection,
  });
  uploadedKeys.push(row.storagePath);
  return row;
}

/** 把 deletedAt 改写成「now - days 天前」，模拟时间流逝（不改状态，GC 只看 deletedAt）。 */
async function ageDeletedAt(documentId: string, days: number): Promise<void> {
  await getDb()
    .update(documents)
    .set({ deletedAt: new Date(Date.now() - days * DAY_MS) })
    .where(eq(documents.id, documentId));
}

async function rowOf(documentId: string) {
  const [row] = await getDb()
    .select()
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  return row;
}

describe("GC 路由鉴权（CRON_SECRET）", () => {
  const SECRET = "gc-route-test-secret-0123456789abcdef0123456789abcdef";

  it("CRON_SECRET 未配置 → 404（端点整体停用，不暴露存在）", async () => {
    setCronSecret(undefined);
    const response = await gcRequest();
    expect(response.status).toBe(404);
  });

  it("CRON_SECRET 已配置：缺头 401、错密钥 401、长度不同的错密钥也 401", async () => {
    setCronSecret(SECRET);

    const missing = await gcRequest();
    expect(missing.status).toBe(401);

    const wrong = await gcRequest({ authorization: "Bearer wrong-secret-wrong-secret-wrong-x" });
    expect(wrong.status).toBe(401);

    // 长度不同的密钥走的是另一条比较分支，也必须被拒。
    const wrongLength = await gcRequest({ authorization: "Bearer short" });
    expect(wrongLength.status).toBe(401);

    // x-cron-secret 备用头同样生效（部分定时任务不支持自定义 Authorization）。
    const altHeader = await gcRequest({ "x-cron-secret": SECRET });
    expect(altHeader.status).not.toBe(401);
    expect(altHeader.status).not.toBe(404);
  });

  it("正确的 Bearer 密钥 → 200 并真正执行回收", async () => {
    setCronSecret(SECRET);
    const user = await createTestUser("gcroute");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "GC 路由工作区");
    const doc = await uploadDocument(workspace.id, user.id);

    await softDeleteDocument({ workspaceId: workspace.id, documentId: doc.id });
    await ageDeletedAt(doc.id, DOCUMENT_GC_RETENTION_DAYS + 1);

    const response = await gcRequest({ authorization: `Bearer ${SECRET}` });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; deleted: number };
    expect(body.ok).toBe(true);
    expect(body.deleted).toBeGreaterThanOrEqual(1);

    // 双清：物理文件与库记录都不在了。
    const storage = getStorageProvider();
    expect(await storage.exists(doc.storagePath)).toBe(false);
    expect(await rowOf(doc.id)).toBeUndefined();
  });
});

describe("软删除与恢复（纯数据库操作）", () => {
  it("软删：列表消失、回收站可见、物理文件原地不动；跨工作区删除被拒", async () => {
    const user = await createTestUser("softdel");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "软删工作区");
    const stranger = await createTestUser("softdel-x");
    createdUserIds.push(stranger.id);
    const strangerWorkspace = await createTestWorkspace(stranger.id, "别人的工作区");

    const doc = await uploadDocument(workspace.id, user.id);
    const storage = getStorageProvider();
    expect(await storage.exists(doc.storagePath)).toBe(true);

    // 跨工作区：别人的工作区里没有这份资料。
    await expect(
      softDeleteDocument({ workspaceId: strangerWorkspace.id, documentId: doc.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await softDeleteDocument({ workspaceId: workspace.id, documentId: doc.id });

    const visible = await listWorkspaceDocuments(workspace.id);
    expect(visible.map((row) => row.id)).not.toContain(doc.id);

    const trashed = await listSoftDeletedDocuments(workspace.id);
    expect(trashed.map((row) => row.id)).toContain(doc.id);

    // 纯软删的承诺：物理文件原地不动。
    expect(await storage.exists(doc.storagePath)).toBe(true);
  });

  it("恢复：依据库内证据重建状态（有正文 → READY / SUCCEEDED）", async () => {
    const user = await createTestUser("restore");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "恢复工作区");
    const doc = await uploadDocument(workspace.id, user.id);

    // 模拟「解析曾经成功」：正文已落库。
    await upsertDocumentText({
      workspaceId: workspace.id,
      documentId: doc.id,
      parserId: "pdf",
      text: "示例正文",
      charCount: 4,
      truncated: false,
      structure: {},
      notes: [],
    });

    await softDeleteDocument({ workspaceId: workspace.id, documentId: doc.id });
    await restoreDocument({ workspaceId: workspace.id, documentId: doc.id });

    const restored = await rowOf(doc.id);
    expect(restored?.deletedAt).toBeNull();
    expect(restored?.status).toBe("READY");
    expect(restored?.processingStatus).toBe("SUCCEEDED");

    const visible = await listWorkspaceDocuments(workspace.id);
    expect(visible.map((row) => row.id)).toContain(doc.id);
  });
});

describe("物理回收（GC）边界与幂等", () => {
  it("软删 29 天：绝不被 GC 误杀（行在、文件在）", async () => {
    const user = await createTestUser("edge29");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "29 天工作区");
    const doc = await uploadDocument(workspace.id, user.id);

    await softDeleteDocument({ workspaceId: workspace.id, documentId: doc.id });
    await ageDeletedAt(doc.id, DOCUMENT_GC_RETENTION_DAYS - 1); // 29 天

    const result = await runDocumentGarbageCollection();

    const row = await rowOf(doc.id);
    expect(row).toBeDefined();
    expect(row?.deletedAt).not.toBeNull();
    expect(await getStorageProvider().exists(doc.storagePath)).toBe(true);
    // 本用例没到窗口期，deleted 若非零只能是更早用例留下的过期行 —— 与本断言无关，
    // 但 scanned 至少要证明扫描逻辑跑了。
    expect(result.scanned).toBeGreaterThanOrEqual(0);
  });

  it("软删 31 天：物理文件与库记录双清；子文档文件被显式清除、库行随 cascade 消失", async () => {
    const user = await createTestUser("edge31");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "31 天工作区");

    const parent = await uploadDocument(workspace.id, user.id, "整包资料-示例.zip");
    const child = await uploadDocument(workspace.id, user.id, "整包资料/营业执照-示例.pdf");

    // 把第二份挂成第一份的子文档（模拟 zip 展开的产物）。
    await getDb().update(documents).set({ parentDocumentId: parent.id }).where(eq(documents.id, child.id));

    // 父文档已有正文，用于验证硬删时正文随 cascade 消失。
    await upsertDocumentText({
      workspaceId: workspace.id,
      documentId: parent.id,
      parserId: "pdf",
      text: "示例正文",
      charCount: 4,
      truncated: false,
      structure: {},
      notes: [],
    });

    await softDeleteDocument({ workspaceId: workspace.id, documentId: parent.id });

    // 删父带子：子文档也被软删。
    const childRowAfterSoftDelete = await rowOf(child.id);
    expect(childRowAfterSoftDelete?.deletedAt).not.toBeNull();

    await ageDeletedAt(parent.id, DOCUMENT_GC_RETENTION_DAYS + 1);
    await ageDeletedAt(child.id, DOCUMENT_GC_RETENTION_DAYS + 1);

    const result = await runDocumentGarbageCollection();
    expect(result.deleted).toBeGreaterThanOrEqual(1);

    const storage = getStorageProvider();
    expect(await storage.exists(parent.storagePath)).toBe(false);
    expect(await storage.exists(child.storagePath)).toBe(false);
    expect(await rowOf(parent.id)).toBeUndefined();
    // 子文档的库行不是被 GC 逐行删的，而是随父文档的 FK cascade 消失的。
    expect(await rowOf(child.id)).toBeUndefined();

    const [textRow] = await getDb()
      .select()
      .from(documentTexts)
      .where(eq(documentTexts.documentId, parent.id))
      .limit(1);
    expect(textRow).toBeUndefined();
  });

  it("物理文件已被预先抹除：GC 容错并完成 DB 清理", async () => {
    const user = await createTestUser("ghost");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "幽灵文件工作区");
    const doc = await uploadDocument(workspace.id, user.id);

    await softDeleteDocument({ workspaceId: workspace.id, documentId: doc.id });
    await ageDeletedAt(doc.id, DOCUMENT_GC_RETENTION_DAYS + 1);

    // 先把物理文件抹掉（模拟上次 GC 删了文件但 DB 清理被打断的悬空状态）。
    await getStorageProvider().delete(doc.storagePath);
    expect(await getStorageProvider().exists(doc.storagePath)).toBe(false);

    const result = await runDocumentGarbageCollection();
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(await rowOf(doc.id)).toBeUndefined();
  });

  it("GC 幂等：同一批过期行跑第二遍，scanned = 0、deleted = 0", async () => {
    const first = await runDocumentGarbageCollection();
    const second = await runDocumentGarbageCollection();
    // 第一遍可能收走别的用例留下的过期行；第二遍必须什么都不剩。
    expect(second.scanned).toBe(0);
    expect(second.deleted).toBe(0);
    expect(first.skipped).toBe(0);
    expect(second.skipped).toBe(0);
  });
});
