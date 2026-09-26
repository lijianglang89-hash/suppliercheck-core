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
  finishJob,
  markDocumentFailed,
  markDocumentReady,
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

  const plan = await planZipExtraction(localPath);
  if (plan.accepted.length === 0) return [];

  const jobId = await startJob({
    workspaceId: parent.workspaceId,
    documentId: parent.id,
    jobType: UNZIP_JOB_TYPE,
  });

  const children: DocumentRow[] = [];

  try {
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
export async function enqueueDocumentProcessing(documentId: string): Promise<EnqueueResult> {
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
  void runExclusive(() => runProcessing(claimed)).catch((error: unknown) => {
    logger.error("解析任务异常退出", { documentId, error });
  });

  return { queued: true };
}

/** 批量触发，供上传路由使用。 */
export async function enqueueMany(documentIds: readonly string[]): Promise<void> {
  for (const documentId of documentIds) {
    try {
      await enqueueDocumentProcessing(documentId);
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
async function runProcessing(document: DocumentRow): Promise<void> {
  const jobId = await startJob({
    workspaceId: document.workspaceId,
    documentId: document.id,
    jobType: EXTRACT_TEXT_JOB_TYPE,
  });

  const log = logger.child({ jobId, workspaceId: document.workspaceId, documentId: document.id });

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
