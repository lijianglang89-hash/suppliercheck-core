/**
 * zip 读取底座（yauzl v3）。
 *
 * XLSX / DOCX / 上传的 .zip 三种格式本质都是 zip 容器，因此共用一个打开器，
 * 避免每个解析器各写一套、各自踩坑。
 *
 * yauzl 的关键特性正好对上内存红线：它按需打开单个条目（openReadStream），
 * 不需要把压缩包整体读进内存，也不像 jszip 那样为每个条目建 JS 对象。
 *
 * ⚠️ yauzl v3 与 v2 的用法差异（踩过一次，记下来）：
 *   v2 用 `zipfile.readEntry()` + `entry.autodrain()` 手动推进；
 *   v3 的 `eachEntry()` 异步迭代器**自动推进与排空**，`autodrain()` 已被移除。
 *   在 v3 里对跳过的条目写 `continue` 就够了，再调 autodrain 会直接类型报错。
 *   另外 v3 的 `autoClose` 默认为 true：`break` 跳出循环时 zip 会自动关闭，
 *   因此 finally 里的 close 必须容错。
 *
 * ⚠️ yauzl 只能按**路径**打开（需要随机访问中央目录），所以这些格式在当前
 * 本地磁盘存储下可用；未来切到对象存储时，需要先落到临时文件，届时本文件是
 * 唯一要改的地方。
 */

import { openPromise, type Entry, type ZipFile } from "yauzl";

import { AppError, errors } from "@/lib/errors";
import { logger } from "@/lib/logger";

/** 供日志与错误信息使用的稳定标识。 */
export const ZIP_OPEN_ERROR_MESSAGE = "无法读取文档容器（支持 .docx / .xlsx / .zip）。";

export interface OpenZipOptions {
  /** 是否按需读取条目（默认 true，配合 eachEntry 使用）。 */
  lazyEntries?: boolean;
}

/**
 * 打开一个 zip 容器。
 *
 * `validateEntrySizes: true` 让 yauzl 在读取条目时校验压缩前后大小是否与中央目录
 * 一致 —— 这是压缩炸弹与损坏包的第一道闸门。
 */
export async function openZip(path: string, options: OpenZipOptions = {}): Promise<ZipFile> {
  let zip: ZipFile;
  try {
    zip = await openPromise(path, {
      lazyEntries: options.lazyEntries ?? true,
      decodeStrings: true,
      validateEntrySizes: true,
    });
  } catch (error) {
    throw errors.validation(ZIP_OPEN_ERROR_MESSAGE, { cause: error, details: { path } });
  }

  /**
   * ZipFile 是 EventEmitter。读取条目流的过程中出现 I/O 问题时它会 emit("error")，
   * 而**没有监听者的 'error' 事件会直接让 Node 进程崩溃** —— 一个损坏的
   * 上传文件就能打挂整个服务。这里挂一个记录型监听器把这个风险消掉。
   */
  zip.on("error", (error: Error) => {
    logger.warn("zip 读取期间发生错误", { message: error.message });
  });

  return zip;
}

/** 取条目路径的最后一段，用于展示与扩展名判断。 */
export function entryBasename(fileName: string): string {
  const normalized = fileName.replace(/\\/g, "/");
  return normalized.split("/").pop() ?? "";
}

/**
 * 迭代 zip 条目的唯一入口。
 *
 * 存在的理由：yauzl 在中央目录里发现非法条目名（`..`、反斜杠、绝对路径）或
 * 大小声明与实际不符时，会**在迭代过程中**抛出并自动关闭整个 ZipFile。
 * 如果让这个原始 Error 冒到上层，一个恶意压缩包就会变成 500「服务器错误」——
 * 既误导使用者，也污染错误分类。
 *
 * 这里统一翻译成「输入不合法」（400），并把 yauzl 的原始信息保留在日志里。
 * 顺带说明一个安全事实：**路径穿越在 yauzl 这一层就已经被拒绝了**，
 * archive.ts 里的条目标名校验是第二道防线，不是唯一防线。
 */
export async function* iterateZipEntries(zip: ZipFile): AsyncGenerator<Entry> {
  try {
    for await (const entry of zip.eachEntry()) {
      yield entry;
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw errors.validation("压缩包结构不合法或已损坏，无法读取。", { cause: error });
  }
}

/** 判断条目是否为目录（zip 里的目录条目以 / 结尾）。 */
export function isDirectoryEntry(entry: Entry): boolean {
  return entry.fileName.endsWith("/");
}

/**
 * 幂等关闭。
 *
 * v3 的 eachEntry 在 `break` 时会自动关闭 zip，因此 finally 里的关闭很可能
 * 作用在一个已关闭的对象上。失败无需上报 —— 调用方关心的是「不再持有句柄」，
 * 而这时句柄早已释放。
 */
export function closeZipQuietly(zip: ZipFile): void {
  try {
    zip.close();
  } catch {
    // 已关闭 / 已析构：无需处理。
  }
}
