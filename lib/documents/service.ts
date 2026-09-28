/**
 * 资料包处理引擎 · 编排层。
 *
 * 这里只做三件事，且顺序固定：
 *   落盘（流式）→ 入库（UPLOADED）→ 排队解析（PROCESSING → READY / FAILED）
 *
 * 三条不能破的规矩：
 *
 * 1. **先落盘，再入库。** 反过来的话，一旦落盘失败数据库里就会留下指向空文件的记录，
 *    而使用者看到的是「文件已上传」。
 *
 * 2. **状态只由这一层推进。** 路由层不许直接改 documents.status ——
 *    否则状态机会被绕开，出现「READY 但没有文本」这种自相矛盾的行。
 *
 * 3. **绝不伪造解析成功。** 解析器的产出原样落库，包括 truncated 与 notes。
 *    空文本 + 有说明 = 诚实；空文本 + 显示「已解析」= 欺骗。
 */

import "server-only";

import type { Readable } from "node:stream";

import { errors, toAppError } from "@/lib/errors";
import {
  buildStorageKey,
  isUuid,
  newId,
  resolveExtensionForMime,
  signatureMatchesMime,
  sniffFileSignature,
} from "@/lib/files";
import { logger } from "@/lib/logger";
import { getStorageProvider } from "@/lib/storage";

import type { DocumentRow } from "@/lib/db/schema";

import { MAX_ERROR_MESSAGE_CHARS, PARSE_TIMEOUT_MS, STALE_JOB_THRESHOLD_MS } from "./limits";
import type { InspectionTransform } from "./inspect-stream";
import { selectParser } from "./parsers/registry";
import type { ParseSource } from "./parsers/types";
import { extractZipEntries, planZipExtraction } from "./archive";
import { runExclusive, withTimeout } from "./queue";
import {
  claimDocumentForProcessing,
  createDocument,
  findDocumentById,
  findDocumentByIdIncludingDeleted,
  findDocumentText,
  findLatestJob,
  finishJob,
  hardDeleteDocument,
  listChildDocumentsIncludingDeleted,
  listExpiredSoftDeletedDocuments,
  markDocumentFailed,
  markDocumentReady,
  restoreDocumentRow,
  softDeleteChildDocuments,
  softDeleteDocumentRow,
  startJob,
  upsertDocumentText,
} from "./repository";

const EXTRACT_TEXT_JOB_TYPE = "EXTRACT_TEXT";
const UNZIP_JOB_TYPE = "EXPAND_ARCHIVE";

/* ------------------------------------------------------------------ */
/* 1. 落盘                                                             */
/* ------------------------------------------------------------------ */

export interface StoreUploadedFileInput {
  workspaceId: string;
  userId: string;
  /** 原始文件名（仅记录，不参与路径拼接）。 */
  originalFilename: string;
  /** 清洗后的文件名。 */
  safeFilename: string;
  mimeType: string;
  /** 已接上检查层的字节流。 */
  stream: Readable;
  /** 与 stream 配套的检查器，用于在写完后取文件头。 */
  inspection: InspectionTransform;
  parentDocumentId?: string | null;
}

/**
 * 把一次上传落盘并登记成文档记录。
 *
 * 校验时序（刻意如此）：
 *   1. 写盘前：MIME 白名单 + 文件名清洗（由 multipart 层完成）；
 *   2. 写盘后、入库前：**魔数比对** —— 这是唯一能识破「把 .exe 改名成 .pdf」的关卡。
 *      若不符，先把已落盘的文件删掉，再抛错，绝不留下孤儿文件。
 */
export async function storeUploadedFile(input: StoreUploadedFileInput): Promise<DocumentRow> {
  if (!isUuid(input.workspaceId)) {
    throw errors.validation("workspaceId 必须是 UUID。");
  }

  const documentId = newId();
  const storageKey = buildStorageKey({
    workspaceId: input.workspaceId,
    documentId,
    mimeType: input.mimeType,
  });

  const storage = getStorageProvider();

  const stored = await storage.uploadStream({
    key: storageKey,
    stream: input.stream,
    contentType: input.mimeType,
  });

  try {
    const header = input.inspection.getHeader();
    const signature = sniffFileSignature(header);
    if (!signatureMatchesMime(signature, input.mimeType)) {
      throw errors.unsupportedMediaType(
        `文件真实内容与声明的类型不一致（声明 ${input.mimeType}，实际 ${signature}）。`,
      );
    }

    // 交叉校验：存储层统计的实际字节数必须与流经检查层的字节数一致。
    // 不一致说明管道中途有东西丢了，宁可直接失败也不要存一份残缺文件。
    if (stored.size !== input.inspection.size) {
      throw errors.storage("写入字节数与接收字节数不一致，已中止。", {
        details: { stored: stored.size, received: input.inspection.size },
      });
    }

    return await createDocument({
      // 与上面 buildStorageKey 用的是**同一个** documentId，两者绝不能各生成一个。
      id: documentId,
      workspaceId: input.workspaceId,
      originalFilename: input.originalFilename || input.safeFilename,
      safeFilename: input.safeFilename,
      mimeType: input.mimeType,
      extension: resolveExtensionForMime(input.mimeType),
      size: stored.size,
      checksum: stored.checksum,
      storagePath: storageKey,
      createdBy: input.userId,
      parentDocumentId: input.parentDocumentId ?? null,
    });
  } catch (error) {
    // 入库失败或校验失败：把刚落盘的文件删掉，保持「库里有记录 ⇔ 磁盘上有文件」。
    await storage.delete(storageKey).catch((cleanupError: unknown) => {
      logger.error("清理未登记的上传文件失败", { documentId, cleanupError });
    });
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* 2. 压缩包展开                                                       */
/* ------------------------------------------------------------------ */

/** 上传 .zip 后，把包内每个可处理条目展开成独立子文档。 */
export async function expandArchiveDocument(parent: DocumentRow): Promise<DocumentRow[]> {
  const storage = getStorageProvider();
  const localPath = storage.localPathFor?.(parent.storagePath);

  if (!localPath) {
    // 换对象存储后需要先落临时文件才能展开；当前如实跳过，不让上传整体失败。
    return [];
  }

  /*
   * ⚠️ 规划（planZipExtraction）必须和展开一起包在 try 里。
   *
   * 曾经它单独在 try 之外：包结构不合法时它抛错，catch 接不到，错误一路冒泡到上传路由。
   * 结果是「父文档已落库、但 enqueueMany 从未执行」—— 状态永远停在 UPLOADED，
   * 界面上留下一个不会自己消失、永远转圈的幽灵任务。这是标准的客诉制造机。
   *
   * 修法：任何一步失败都把**父文档扭成 FAILED**（并记录原因），让状态机闭环。
   * 已经展开出来的子文档仍然返回 —— 它们是完整可用的资料，没理由跟着陪葬。
   */
  let plan: Awaited<ReturnType<typeof planZipExtraction>>;
  const jobId = await startJob({
    workspaceId: parent.workspaceId,
    documentId: parent.id,
    jobType: UNZIP_JOB_TYPE,
  });

  const children: DocumentRow[] = [];

  try {
    plan = await planZipExtraction(localPath);
    if (plan.accepted.length === 0) {
      await finishJob({ jobId, status: "SUCCEEDED" });
      return [];
    }

    await extractZipEntries(localPath, plan.accepted, async (entryPlan, stream) => {
      const childId = newId();
      const childKey = buildStorageKey({
        workspaceId: parent.workspaceId,
        documentId: childId,
        mimeType: entryPlan.mimeType,
      });

      // 逐条串行解压：一次只有一条条目流在内存/磁盘管道里。
      // maxBytes 用条目声明的解压大小 —— 元数据可以撒谎，所以由存储层按**实际字节**再卡一次。
      const stored = await storage.uploadStream({
        key: childKey,
        stream,
        contentType: entryPlan.mimeType,
        maxBytes: entryPlan.uncompressedSize,
      });

      children.push(
        await createDocument({
          // 同上：子文档的 id 必须与磁盘上那份文件的存储键一致。
          id: childId,
          workspaceId: parent.workspaceId,
          originalFilename: `${parent.safeFilename}/${entryPlan.entryName}`,
          safeFilename: entryPlan.safeFilename,
          mimeType: entryPlan.mimeType,
          extension: resolveExtensionForMime(entryPlan.mimeType),
          size: stored.size,
          checksum: stored.checksum,
          storagePath: childKey,
          createdBy: parent.createdBy,
          parentDocumentId: parent.id,
        }),
      );
    });

    await finishJob({ jobId, status: "SUCCEEDED" });
  } catch (error) {
    const appError = toAppError(error);

    // 关键兜底：父文档必须离开 UPLOADED，否则它会永远卡在「待处理」。
    await markDocumentFailed(parent.id).catch((markError: unknown) => {
      logger.error("标记压缩包展开失败状态时出错", { documentId: parent.id, markError });
    });

    await finishJob({
      jobId,
      status: "FAILED",
      errorCode: appError.code,
      errorMessage: appError.message.slice(0, MAX_ERROR_MESSAGE_CHARS),
    });
    logger.error("展开压缩包失败", {
      jobId,
      documentId: parent.id,
      code: appError.code,
      error: appError.message,
    });
    // 已经展开的子文档保留：它们是完整、可用的资料，没理由扔掉。
  }

  return children;
}

/* ------------------------------------------------------------------ */
/* 3. 状态机                                                           */
/* ------------------------------------------------------------------ */

export interface EnqueueResult {
  queued: boolean;
  reason?: "already_ready" | "already_processing" | "not_found";
}

/**
 * 触发一次解析。
 *
 * 关键在「认领」：状态先原子地翻到 PROCESSING，再进串行队列。
 * 这样同一次点击重复到达、或者使用者连点两次，也只有一次会真正干活。
 */
export async function enqueueDocumentProcessing(
  documentId: string,
  opts?: { requestId?: string },
): Promise<EnqueueResult> {
  if (!isUuid(documentId)) return { queued: false, reason: "not_found" };

  const claimed = await claimDocumentForProcessing(documentId, STALE_JOB_THRESHOLD_MS);
  if (!claimed) {
    const existing = await findDocumentById(documentId);
    if (!existing) return { queued: false, reason: "not_found" };
    return {
      queued: false,
      reason: existing.status === "READY" ? "already_ready" : "already_processing",
    };
  }

  // 不 await：调用方（after()）只负责排队，解析本身在串行队列里慢慢跑。
  // requestId 随任务闭包一起透传进 runProcessing，穿透「入队即返回」的异步边界，
  // 确保后台任务的每一条日志都能回溯到触发它的那次 HTTP 请求。
  void runExclusive(() => runProcessing(claimed, { requestId: opts?.requestId })).catch(
    (error: unknown) => {
      logger.error("解析任务异常退出", { documentId, error });
    },
  );

  return { queued: true };
}

/** 批量触发，供上传路由使用。 */
export async function enqueueMany(
  documentIds: readonly string[],
  opts?: { requestId?: string },
): Promise<void> {
  for (const documentId of documentIds) {
    try {
      await enqueueDocumentProcessing(documentId, { requestId: opts?.requestId });
    } catch (error) {
      logger.error("触发解析失败", { documentId, error });
    }
  }
}

/**
 * 真正干活的地方。**必须在串行队列中运行**（见 ./queue.ts 的内存说明）。
 *
 * 状态迁移：
 *   PROCESSING/RUNNING（认领时已置）
 *     → 成功：READY/SUCCEEDED + 写入 document_texts
 *     → 失败：FAILED/FAILED + 记录安全化的错误信息
 */
async function runProcessing(
  document: DocumentRow,
  opts?: { requestId?: string },
): Promise<void> {
  const jobId = await startJob({
    workspaceId: document.workspaceId,
    documentId: document.id,
    jobType: EXTRACT_TEXT_JOB_TYPE,
  });

  // 把入口请求带来的 requestId 合并进本任务的日志上下文，
  // 于是「开始解析 / 解析完成 / 解析失败」每条日志都带着它 ——
  // 一条后台任务可以从日志直接反查回触发的那次 HTTP 请求。
  const log = logger.child({
    ...(opts?.requestId ? { requestId: opts.requestId } : {}),
    jobId,
    workspaceId: document.workspaceId,
    documentId: document.id,
  });

  try {
    const parser = selectParser(document.mimeType);
    const source = buildParseSource(document);

    log.info("开始解析文档", { parserId: parser.id, mimeType: document.mimeType, size: document.size });

    const outcome = await withTimeout(
      parser.parse(source),
      PARSE_TIMEOUT_MS,
      () => errors.storage(`文档解析超时（${PARSE_TIMEOUT_MS} 毫秒）。`),
    );

    await upsertDocumentText({
      workspaceId: document.workspaceId,
      documentId: document.id,
      parserId: outcome.parserId,
      text: outcome.text,
      charCount: outcome.charCount,
      truncated: outcome.truncated,
      pageCount: outcome.pageCount ?? null,
      structure: {
        ...outcome.meta,
        ...(outcome.sheetNames ? { sheetNames: outcome.sheetNames } : {}),
      },
      notes: outcome.notes,
    });

    await markDocumentReady(document.id, outcome.pageCount ?? null);
    await finishJob({ jobId, status: "SUCCEEDED" });

    log.info("文档解析完成", {
      parserId: outcome.parserId,
      charCount: outcome.charCount,
      truncated: outcome.truncated,
    });
  } catch (error) {
    const appError = toAppError(error);

    await markDocumentFailed(document.id).catch((markError: unknown) => {
      log.error("标记解析失败状态时出错", { markError });
    });
    await finishJob({
      jobId,
      status: "FAILED",
      errorCode: appError.code,
      errorMessage: appError.message.slice(0, MAX_ERROR_MESSAGE_CHARS),
    }).catch(() => undefined);

    log.error("文档解析失败", { code: appError.code, error: appError.message });
  }
}

/** 把数据库记录 + 存储提供者拼成解析器能用的输入。 */
function buildParseSource(document: DocumentRow): ParseSource {
  const storage = getStorageProvider();
  const localPath = storage.localPathFor?.(document.storagePath);

  return {
    mimeType: document.mimeType,
    size: document.size,
    originalFilename: document.originalFilename,
    ...(localPath ? { localPath } : {}),
    openStream: () => storage.downloadStream(document.storagePath),
    readAll: () => storage.download(document.storagePath),
  };
}

/* ------------------------------------------------------------------ */
/* 4. 软删除与物理回收（GC）                                            */
/* ------------------------------------------------------------------ */

/**
 * 软删除的保留窗口（天）。过了这个窗口的软删行由 GC 彻底清除。
 * 这是产品承诺过的数字（界面文案「30 天内可恢复」），改动必须连 UI 文案一起改。
 */
export const DOCUMENT_GC_RETENTION_DAYS = 30;

/**
 * 软删除一份资料（纯数据库操作，**绝不**触碰物理文件）。
 *
 * 语义：「删除」的粒度是**整个资料包** —— 删父文档（压缩包）时，包内展开出的
 * 子文档一并软删。子文档是从父包派生的副本，父包都不要了却把碎片留在列表里，
 * 使用者只会困惑。反过来，单独删一个子文档不动父文档和兄弟。
 *
 * 30 天内可通过 restoreDocument 恢复；30 天后由 runDocumentGarbageCollection
 * 彻底清除（物理文件 + 数据库记录）。
 */
export async function softDeleteDocument(params: {
  workspaceId: string;
  documentId: string;
}): Promise<void> {
  if (!isUuid(params.documentId)) {
    throw errors.notFound("没有找到对应的资料。");
  }

  // findDocumentById 过滤掉软删行 —— 重复删除因此表现为 NOT_FOUND，
  // 调用方（runIdempotentDelete）把这种情况当幂等成功处理。
  const existing = await findDocumentById(params.documentId);
  if (!existing || existing.workspaceId !== params.workspaceId) {
    throw errors.notFound("没有找到对应的资料。");
  }

  await softDeleteDocumentRow(existing.id);
  // 子文档跟着走（只连带直接子级；嵌套 zip 在上传时就被拒绝，不存在孙子级）。
  await softDeleteChildDocuments(existing.id);
}

/**
 * 恢复一份软删资料。状态**依据库内证据重建**，而不是凭空猜：
 *   - document_texts 里正文还在 → 解析曾经成功 → READY / SUCCEEDED；
 *   - 最近一次处理任务 FAILED → 解析失败 → FAILED / FAILED（恢复后 ReprocessButton 回来）；
 *   - 其余（还没轮到解析就被删了）→ UPLOADED / PENDING。
 *
 * 恢复父文档时连同其全部软删子文档一起恢复 —— 软删把整包带出列表，
 * 恢复就该把整包带回来。
 */
export async function restoreDocument(params: {
  workspaceId: string;
  documentId: string;
}): Promise<void> {
  if (!isUuid(params.documentId)) {
    throw errors.notFound("没有找到对应的资料。");
  }

  // 恢复路径必须用包含软删行的查询 —— findDocumentById 会把目标滤掉。
  const existing = await findDocumentByIdIncludingDeleted(params.documentId);
  if (!existing || existing.workspaceId !== params.workspaceId) {
    throw errors.notFound("没有找到对应的资料。");
  }
  if (existing.deletedAt === null) {
    throw errors.validation("该资料未被删除，无需恢复。");
  }

  await restoreDocumentRow(existing.id, ...(await reconstructStatus(existing.id)));

  if (existing.parentDocumentId === null) {
    const children = await listChildDocumentsIncludingDeleted(existing.id);
    for (const child of children) {
      await restoreDocumentRow(child.id, ...(await reconstructStatus(child.id)));
    }
  }
}

/** 从正文与任务记录里重建一份文档的生命周期状态。 */
async function reconstructStatus(
  documentId: string,
): Promise<[DocumentRow["status"], DocumentRow["processingStatus"]]> {
  const [text, job] = await Promise.all([findDocumentText(documentId), findLatestJob(documentId)]);
  if (text) return ["READY", "SUCCEEDED"];
  if (job?.status === "FAILED") return ["FAILED", "FAILED"];
  return ["UPLOADED", "PENDING"];
}

export interface GarbageCollectionResult {
  /** 扫描到的过期软删行数。 */
  scanned: number;
  /** 完成「物理文件 + 数据库记录」双清的行数。 */
  deleted: number;
  /** 物理删除失败被跳过、留待下次重试的行数。 */
  skipped: number;
}

/**
 * 物理回收：把软删超过 DOCUMENT_GC_RETENTION_DAYS 天的资料彻底清除。
 *
 * 顺序纪律（对应「物理文件确认移除后再执行 DB DELETE」）：
 *   1. storage.delete(物理文件) —— 本地实现的 rm 带 force，文件已不存在**不算错误**，
 *      所以这一步 resolve 就意味着「文件已确认不在磁盘上」；
 *   2. 子文档的物理文件一并删 —— 父文档硬删时 FK cascade 会带走子文档的库行，
 *      但物理文件不受 FK 约束，不在这里显式删就会留下查不到主的孤儿文件；
 *   3. hardDeleteDocument —— cascade 清掉正文、任务记录与子行；review_findings
 *      被 set null，审核报告完好。
 *
 * 容错：任何一步物理删除失败（真实 IO 故障，不是「文件已不在」）就跳过这一行、
 * 计入 skipped，下次运行重试。部分文件已删的情况天然幂等 —— 已删的文件
 * 下次 storage.delete 照样 resolve。宁可让记录多留 30 天，也不制造
 * 「库行没了、磁盘上还有一份查不到主的文件」的悬空状态。
 *
 * 触发：/api/cron/gc（CRON_SECRET 鉴权），由外部定时器按天调用。
 */
export async function runDocumentGarbageCollection(options?: {
  now?: Date;
}): Promise<GarbageCollectionResult> {
  const now = options?.now ?? new Date();
  const cutoff = new Date(now.getTime() - DOCUMENT_GC_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const rows = await listExpiredSoftDeletedDocuments(cutoff);
  const storage = getStorageProvider();

  let deleted = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      await storage.delete(row.storagePath);

      const children = await listChildDocumentsIncludingDeleted(row.id);
      for (const child of children) {
        await storage.delete(child.storagePath);
      }

      await hardDeleteDocument(row.id);
      deleted += 1;
      logger.info("GC 已彻底清除过期软删文档", {
        documentId: row.id,
        workspaceId: row.workspaceId,
        childCount: children.length,
      });
    } catch (error) {
      skipped += 1;
      logger.error("GC 清除文档失败，留待下次重试", {
        documentId: row.id,
        storagePath: row.storagePath,
        error,
      });
    }
  }

  return { scanned: rows.length, deleted, skipped };
}
