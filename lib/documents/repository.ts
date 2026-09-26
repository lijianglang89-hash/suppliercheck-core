/**
 * 资料包数据访问层。
 *
 * 只做「一行 SQL 一件事」，不放业务判断 —— 状态迁移规则在 ./service.ts，
 * 这样数据库访问可以被集成测试单独覆盖，状态机也可以被单元测试单独覆盖。
 *
 * 两条贯穿全文件的多租户纪律：
 * 1. 所有按 id 的查询都不接受「调用方传入的 workspace_id」作为过滤条件，
 *    而是**查出来之后**用返回值里的 workspaceId 去授权（见 service 层）；
 * 2. 列清单类查询一律以 workspaceId 为首要过滤条件。
 */

import "server-only";

import { and, asc, count, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  documentProcessingJobs,
  documentTexts,
  documents,
  type DocumentRow,
  type DocumentTextRow,
} from "@/lib/db/schema";

/** 列表页用的扁平视图，一次查询拿全，避免 N+1。 */
export interface DocumentListRow {
  id: string;
  workspaceId: string;
  originalFilename: string;
  safeFilename: string;
  mimeType: string;
  extension: string;
  size: number;
  status: DocumentRow["status"];
  processingStatus: DocumentRow["processingStatus"];
  pageCount: number | null;
  parentDocumentId: string | null;
  supplierId: string | null;
  createdAt: Date;
  parserId: string | null;
  charCount: number | null;
  truncated: boolean | null;
  notes: unknown;
  structure: unknown;
}

export async function listWorkspaceDocuments(
  workspaceId: string,
  limit = 200,
): Promise<DocumentListRow[]> {
  const db = getDb();
  return db
    .select({
      id: documents.id,
      workspaceId: documents.workspaceId,
      originalFilename: documents.originalFilename,
      safeFilename: documents.safeFilename,
      mimeType: documents.mimeType,
      extension: documents.extension,
      size: documents.size,
      status: documents.status,
      processingStatus: documents.processingStatus,
      pageCount: documents.pageCount,
      parentDocumentId: documents.parentDocumentId,
      supplierId: documents.supplierId,
      createdAt: documents.createdAt,
      parserId: documentTexts.parserId,
      charCount: documentTexts.charCount,
      truncated: documentTexts.truncated,
      notes: documentTexts.notes,
      structure: documentTexts.structure,
    })
    .from(documents)
    .leftJoin(documentTexts, eq(documentTexts.documentId, documents.id))
    .where(and(eq(documents.workspaceId, workspaceId), isNull(documents.deletedAt)))
    .orderBy(desc(documents.createdAt))
    .limit(limit);
}

/** 文档 + 正文的合并视图。审核引擎只认这个形状，不直接接触存储层。 */
export interface DocumentWithTextRow {
  id: string;
  workspaceId: string;
  originalFilename: string;
  safeFilename: string;
  mimeType: string;
  status: DocumentRow["status"];
  pageCount: number | null;
  supplierId: string | null;
  parserId: string | null;
  text: string | null;
  charCount: number | null;
  truncated: boolean | null;
  notes: unknown;
}

/**
 * 按 id 批量取文档及其正文。
 *
 * `ids` 为空数组时返回空结果而**不是**全部文档 ——
 * 「没传筛选条件」被解释成「要全部数据」是权限事故的经典成因。
 */
export async function listDocumentsWithText(
  workspaceId: string,
  ids?: readonly string[],
): Promise<DocumentWithTextRow[]> {
  if (ids && ids.length === 0) return [];

  const db = getDb();
  const conditions = [eq(documents.workspaceId, workspaceId), isNull(documents.deletedAt)];
  if (ids && ids.length > 0) conditions.push(inArray(documents.id, [...ids]));

  return db
    .select({
      id: documents.id,
      workspaceId: documents.workspaceId,
      originalFilename: documents.originalFilename,
      safeFilename: documents.safeFilename,
      mimeType: documents.mimeType,
      status: documents.status,
      pageCount: documents.pageCount,
      supplierId: documents.supplierId,
      parserId: documentTexts.parserId,
      text: documentTexts.text,
      charCount: documentTexts.charCount,
      truncated: documentTexts.truncated,
      notes: documentTexts.notes,
    })
    .from(documents)
    .leftJoin(documentTexts, eq(documentTexts.documentId, documents.id))
    .where(and(...conditions))
    .orderBy(asc(documents.createdAt));
}

/** 把文档挂到某个供应商（或摘下）。supplierId 传 null 表示解除归属。 */
export async function setDocumentSupplier(
  documentId: string,
  supplierId: string | null,
): Promise<void> {
  const db = getDb();
  await db
    .update(documents)
    .set({ supplierId, updatedAt: new Date() })
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)));
}

/** 按供应商统计资料数量，供供应商列表页展示。 */
export async function countDocumentsBySupplier(workspaceId: string) {
  const db = getDb();
  return db
    .select({ supplierId: documents.supplierId, total: count() })
    .from(documents)
    .where(and(eq(documents.workspaceId, workspaceId), isNull(documents.deletedAt)))
    .groupBy(documents.supplierId);
}

export async function findDocumentById(documentId: string): Promise<DocumentRow | undefined> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
    .limit(1);
  return row;
}

export async function findDocumentByStoragePath(storagePath: string): Promise<DocumentRow | undefined> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.storagePath, storagePath), isNull(documents.deletedAt)))
    .limit(1);
  return row;
}

export async function findDocumentText(documentId: string): Promise<DocumentTextRow | undefined> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(documentTexts)
    .where(eq(documentTexts.documentId, documentId))
    .limit(1);
  return row;
}

export async function listChildDocuments(parentDocumentId: string): Promise<DocumentRow[]> {
  const db = getDb();
  return db
    .select()
    .from(documents)
    .where(and(eq(documents.parentDocumentId, parentDocumentId), isNull(documents.deletedAt)))
    .orderBy(asc(documents.createdAt));
}

export interface CreateDocumentInput {
  /**
   * 由调用方指定的文档 id。
   *
   * **必须传**：存储键 `workspaces/<ws>/documents/<documentId><ext>` 在落盘之前
   * 就已经算好了，而那时数据库还没生成 id。如果这里让数据库自己生成 id，
   * 磁盘上的 UUID 与 `documents.id` 就会是两个不同的值 —— 功能上能跑，
   * 但「按 id 去磁盘上找文件」这类排查会直接失效，且存储键的语义变成谎言。
   * 由调用方统一生成一次、两边共用，是唯一不会漂移的做法。
   */
  id: string;
  workspaceId: string;
  originalFilename: string;
  safeFilename: string;
  mimeType: string;
  extension: string;
  size: number;
  checksum: string;
  storagePath: string;
  createdBy: string;
  parentDocumentId?: string | null;
}

export async function createDocument(input: CreateDocumentInput): Promise<DocumentRow> {
  const db = getDb();
  const [row] = await db
    .insert(documents)
    .values({
      id: input.id,
      workspaceId: input.workspaceId,
      originalFilename: input.originalFilename,
      safeFilename: input.safeFilename,
      mimeType: input.mimeType,
      extension: input.extension,
      size: input.size,
      checksum: input.checksum,
      storagePath: input.storagePath,
      createdBy: input.createdBy,
      parentDocumentId: input.parentDocumentId ?? null,
      // 上传完成即 UPLOADED；解析状态由 service 层推进。
      status: "UPLOADED",
      processingStatus: "PENDING",
    })
    .returning();

  if (!row) throw new Error("写入文档记录失败。");
  return row;
}

/**
 * 原子认领一份文档去做解析。
 *
 * 返回 undefined 表示「不需要处理」，可能的三种情况：
 *   - 文档已 READY（重复触发不重复干活）；
 *   - 正有另一次执行在处理它（PROCESSING 且未超时）；
 *   - 文档已被删除。
 *
 * 用 `UPDATE ... WHERE ... RETURNING` 而不是「先查后写」，是因为后者在并发下
 * 会让两份文档被同一次点击重复解析 —— 对内存紧张的机器来说这是实打实的风险。
 */
export async function claimDocumentForProcessing(
  documentId: string,
  staleThresholdMs: number,
): Promise<DocumentRow | undefined> {
  const db = getDb();
  const staleBefore = new Date(Date.now() - staleThresholdMs);

  const [row] = await db
    .update(documents)
    .set({ status: "PROCESSING", processingStatus: "RUNNING", updatedAt: new Date() })
    .where(
      and(
        eq(documents.id, documentId),
        isNull(documents.deletedAt),
        or(
          inArray(documents.status, ["UPLOADED", "FAILED"]),
          and(eq(documents.status, "PROCESSING"), lt(documents.updatedAt, staleBefore)),
        ),
      ),
    )
    .returning();

  return row;
}

export async function markDocumentReady(documentId: string, pageCount: number | null): Promise<void> {
  const db = getDb();
  await db
    .update(documents)
    .set({
      status: "READY",
      processingStatus: "SUCCEEDED",
      pageCount,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, documentId));
}

export async function markDocumentFailed(documentId: string): Promise<void> {
  const db = getDb();
  await db
    .update(documents)
    .set({ status: "FAILED", processingStatus: "FAILED", updatedAt: new Date() })
    .where(eq(documents.id, documentId));
}

export interface UpsertDocumentTextInput {
  workspaceId: string;
  documentId: string;
  parserId: string;
  text: string;
  charCount: number;
  truncated: boolean;
  pageCount?: number | null;
  structure: Record<string, unknown>;
  notes: string[];
}

export async function upsertDocumentText(input: UpsertDocumentTextInput): Promise<void> {
  const db = getDb();
  const now = new Date();

  await db
    .insert(documentTexts)
    .values({
      workspaceId: input.workspaceId,
      documentId: input.documentId,
      parserId: input.parserId,
      text: input.text,
      charCount: input.charCount,
      truncated: input.truncated,
      pageCount: input.pageCount ?? null,
      structure: input.structure,
      notes: input.notes,
      extractedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: documentTexts.documentId,
      set: {
        parserId: input.parserId,
        text: input.text,
        charCount: input.charCount,
        truncated: input.truncated,
        pageCount: input.pageCount ?? null,
        structure: input.structure,
        notes: input.notes,
        extractedAt: now,
        updatedAt: now,
      },
    });
}

export interface StartJobInput {
  workspaceId: string;
  documentId: string;
  jobType: string;
}

export async function startJob(input: StartJobInput): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(documentProcessingJobs)
    .values({
      workspaceId: input.workspaceId,
      documentId: input.documentId,
      jobType: input.jobType,
      status: "RUNNING",
      attempt: 1,
      // 与审核任务同一条纪律：生命周期时间戳一律用数据库时钟（now()），
      // 避免「完成时间早于开始时间」这种由时钟漂移造成的假象。
      startedAt: sql`now()`,
    })
    .returning({ id: documentProcessingJobs.id });

  if (!row) throw new Error("创建处理任务失败。");
  return row.id;
}

export interface FinishJobInput {
  jobId: string;
  status: "SUCCEEDED" | "FAILED";
  errorCode?: string;
  errorMessage?: string;
}

export async function finishJob(input: FinishJobInput): Promise<void> {
  const db = getDb();
  await db
    .update(documentProcessingJobs)
    .set({
      status: input.status,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      finishedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(documentProcessingJobs.id, input.jobId));
}

/** 最近一次处理任务，用于把失败原因展示给使用者。 */
export async function findLatestJob(documentId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      id: documentProcessingJobs.id,
      status: documentProcessingJobs.status,
      errorCode: documentProcessingJobs.errorCode,
      errorMessage: documentProcessingJobs.errorMessage,
      jobType: documentProcessingJobs.jobType,
      createdAt: documentProcessingJobs.createdAt,
      finishedAt: documentProcessingJobs.finishedAt,
    })
    .from(documentProcessingJobs)
    .where(eq(documentProcessingJobs.documentId, documentId))
    .orderBy(desc(documentProcessingJobs.createdAt))
    .limit(1);
  return row;
}

/** 工作区维度统计，供列表页头部展示。 */
export async function countDocumentsByStatus(workspaceId: string) {
  const db = getDb();
  return db
    .select({ status: documents.status, total: count() })
    .from(documents)
    .where(and(eq(documents.workspaceId, workspaceId), isNull(documents.deletedAt)))
    .groupBy(documents.status);
}
