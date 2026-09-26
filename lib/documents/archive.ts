/**
 * zip 包的「先规划、再解压」两步式处理。
 *
 * 为什么分两步：压缩炸弹的全部套路都藏在中央目录的元数据里 —— 一个 4 KB 的压缩包
 * 可以声称解压出 10 GB。因此必须**先只看元数据做判断**，把不接受的条目挡在解压之前，
 * 而不是边解压边发现。
 *
 * 七道闸门（全部在 ./limits.ts 里可调）：
 *   1. 条目数量上限；
 *   2. 单条目解压后大小上限；
 *   3. 整包解压后总大小上限；
 *   4. 压缩比上限（> 200:1 视为炸弹）；
 *   5. 禁止嵌套 zip（递归解压是炸弹最常见的放大器）；
 *   6. 禁止加密条目（无法校验内容）；
 *   7. 条目类型必须在同一份 MIME 白名单内；条目名必须能安全清洗（防路径穿越）。
 *
 * 另外，规划阶段的上限只是「基于元数据的声明值」。真正的防线在解压时：
 * 调用方必须把每条流接进 InspectionTransform，用**实际字节数**再卡一次。
 * 元数据是可以撒谎的，字节数不会。
 */

import type { Readable } from "node:stream";

import { errors } from "@/lib/errors";
import { resolveMimeForExtension, sanitizeFilename } from "@/lib/files";

import {
  ZIP_MAX_COMPRESSION_RATIO,
  ZIP_MAX_ENTRIES,
  ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES,
  ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES,
} from "./limits";
import {
  closeZipQuietly,
  entryBasename,
  isDirectoryEntry,
  iterateZipEntries,
  openZip,
} from "./zip";

/** 只支持 store(0) 与 deflate(8)—— 其余压缩方法 Node 无法解。 */
const SUPPORTED_COMPRESSION_METHODS = new Set([0, 8]);

export interface ZipEntryPlan {
  /** zip 内的原始条目路径（可能含目录层级）。 */
  entryName: string;
  /** 清洗后的文件名，仅用于展示与落库。 */
  safeFilename: string;
  mimeType: string;
  uncompressedSize: number;
  compressedSize: number;
}

export interface ZipRejection {
  entryName: string;
  /** 面向使用者的中文原因。 */
  reason: string;
}

export interface ZipPlan {
  /** 整包条目总数（含被拒绝的）。 */
  entryCount: number;
  accepted: ZipEntryPlan[];
  rejected: ZipRejection[];
  /** 已接受条目的声明解压总大小。 */
  acceptedBytes: number;
  /** 是否因为触顶而停止接受后续条目。 */
  truncated: boolean;
}

/**
 * 只读元数据，产出解压计划。不写任何文件、不解压任何内容。
 * 条目数或整包体积直接越界时抛错（整包拒绝），单条目越界时记入 rejected（局部跳过）。
 */
export async function planZipExtraction(path: string): Promise<ZipPlan> {
  const zip = await openZip(path);
  const accepted: ZipEntryPlan[] = [];
  const rejected: ZipRejection[] = [];
  let entryCount = 0;
  let acceptedBytes = 0;
  let truncated = false;

  try {
    if (zip.entryCount > ZIP_MAX_ENTRIES * 4) {
      // 连拒绝列表都不必建 —— 这类包基本可以断定不是正常的资料包。
      throw errors.validation(
        `压缩包条目过多（${zip.entryCount} 个），已拒绝处理。单个压缩包最多 ${ZIP_MAX_ENTRIES} 个文件。`,
      );
    }

    for await (const entry of iterateZipEntries(zip)) {
      entryCount += 1;

      if (isDirectoryEntry(entry)) continue;

      const reject = (reason: string) => rejected.push({ entryName: entry.fileName, reason });

      if (accepted.length >= ZIP_MAX_ENTRIES) {
        truncated = true;
        continue;
      }

      // 路径穿越：条目名里带 .. 或反斜杠一律拒绝（清洗函数也会兜底，这里是显式拒绝）。
      if (entry.fileName.includes("..") || entry.fileName.includes("\\")) {
        reject("文件名包含非法路径片段");
        continue;
      }

      if (entry.isEncrypted()) {
        reject("条目已加密，无法读取");
        continue;
      }

      if (!SUPPORTED_COMPRESSION_METHODS.has(entry.compressionMethod)) {
        reject("使用了不支持的压缩方式");
        continue;
      }

      const baseName = entryBasename(entry.fileName);

      let safeFilename: string;
      try {
        safeFilename = sanitizeFilename(baseName);
      } catch {
        reject("文件名不合法");
        continue;
      }

      const mimeType = resolveMimeForExtension(safeFilename);
      if (!mimeType) {
        reject("文件类型不在支持范围内");
        continue;
      }

      if (mimeType === "application/zip") {
        reject("不支持嵌套压缩包");
        continue;
      }

      if (entry.uncompressedSize === 0) {
        reject("文件内容为空");
        continue;
      }

      if (entry.uncompressedSize > ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES) {
        reject("单个文件解压后超出上限");
        continue;
      }

      if (
        entry.compressedSize > 0 &&
        entry.uncompressedSize / entry.compressedSize > ZIP_MAX_COMPRESSION_RATIO
      ) {
        reject("压缩比异常，疑似压缩炸弹");
        continue;
      }

      if (acceptedBytes + entry.uncompressedSize > ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES) {
        reject("整包解压后总量超出上限");
        truncated = true;
        continue;
      }

      accepted.push({
        entryName: entry.fileName,
        safeFilename,
        mimeType,
        uncompressedSize: entry.uncompressedSize,
        compressedSize: entry.compressedSize,
      });
      acceptedBytes += entry.uncompressedSize;
    }
  } finally {
    closeZipQuietly(zip);
  }

  return { entryCount, accepted, rejected, acceptedBytes, truncated };
}

/**
 * 按计划逐条解压，把每条流交给调用方消费。
 *
 * 严格串行：一次只开一条条目流，避免 N 条解压流同时占内存。
 * 调用方负责在某条处理失败时抛错 —— 抛错会中止后续条目，已完成的条目由调用方自行回滚。
 */
export async function extractZipEntries(
  path: string,
  plans: readonly ZipEntryPlan[],
  onEntry: (plan: ZipEntryPlan, stream: Readable) => Promise<void>,
): Promise<void> {
  if (plans.length === 0) return;

  const byName = new Map(plans.map((plan) => [plan.entryName, plan]));
  const remaining = new Set(byName.keys());

  const zip = await openZip(path);
  try {
    for await (const entry of iterateZipEntries(zip)) {
      const plan = byName.get(entry.fileName);
      if (!plan) {
        continue;
      }

      const stream = await zip.openReadStreamPromise(entry);
      try {
        await onEntry(plan, stream);
      } finally {
        remaining.delete(entry.fileName);
      }

      if (remaining.size === 0) break;
    }
  } finally {
    closeZipQuietly(zip);
  }

  if (remaining.size > 0) {
    throw errors.validation("压缩包内容与索引不一致，已中止处理。", {
      details: { missingEntries: [...remaining].slice(0, 5) },
    });
  }
}
