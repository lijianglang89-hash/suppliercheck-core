/**
 * 流式接收 multipart 上传。
 *
 * 需求原文：「严禁文件直接存入内存 buffer 导致 OOM，必须采用流式写入或临时文件直接转移」。
 *
 * 本模块的做法：
 *   - 用 busboy 解析 multipart，文件部分**以流的形式**交给调用方，全程不拼 Buffer；
 *   - 每个文件流先接一层 InspectionTransform（取文件头 + 增量 SHA-256 + 卡大小上限），
 *     再由调用方直接写进私有存储 —— 一个字节都不落地到内存里等待；
 *   - 一次请求只接受一个文件（limits.files = 1）。这不是功能缺失，是把
 *     「一次请求的峰值内存/磁盘」压在可预测范围内，多文件由客户端并发/串行发多次请求。
 *
 * 校验顺序刻意是「先便宜后昂贵」：
 *   1. 声明类型（MIME 白名单）→ 不合法直接不写一个字节；
 *   2. 文件名清洗 → 同上；
 *   3. 真实字节流的魔数 → 在写入过程中就拿到文件头，落盘后立刻比对，不符即删除。
 */

import { Readable } from "node:stream";

import busboy from "busboy";

import { errors, toAppError, type AppError } from "@/lib/errors";
import { resolveExtensionForMime, sanitizeFilename } from "@/lib/files";

import {
  ABSOLUTE_MAX_UPLOAD_BYTES,
  DEFAULT_MAX_UPLOAD_BYTES,
  MAX_FILES_PER_REQUEST,
  MAX_FORM_FIELD_BYTES,
  MAX_FORM_FIELDS,
} from "./limits";
import { InspectionTransform } from "./inspect-stream";

export interface MultipartFileInfo {
  /** 表单字段名。 */
  fieldName: string;
  /** 原始文件名（未清洗）。 */
  filename: string;
  /** 清洗后的安全文件名。 */
  safeFilename: string;
  /** 规范化后的 MIME（已在白名单内）。 */
  mimeType: string;
  /** 由 MIME 反查出的扩展名。 */
  extension: string;
}

export interface MultipartSink {
  /**
   * 拿到已接上检查层的字节流。调用方应把 `stream` 写进存储；
   * `inspection` 在写完（或出错）后可读，用于取实际 size / checksum / 文件头。
   *
   * 注意：类型与文件名的校验在调用本方法**之前**就已完成（见 handleFile），
   * 因此走到这里意味着「声明层面已经合法」，剩下的真伪校验由调用方在流结束后做。
   */
  consume(
    info: MultipartFileInfo,
    stream: Readable,
    inspection: InspectionTransform,
  ): Promise<void>;
}

export interface ParseMultipartOptions {
  /** 单文件大小上限。会被硬上限夹紧。 */
  maxBytes?: number;
}

/**
 * 解析一次「单文件 multipart」请求。
 *
 * 返回即表示文件已被 `sink.consume` 处理完毕；任何校验失败都以 AppError 抛出。
 */
export async function receiveSingleFile(
  request: Request,
  sink: MultipartSink,
  options: ParseMultipartOptions = {},
): Promise<void> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    throw errors.validation("请求格式不正确，需要使用表单文件上传。");
  }
  if (!request.body) {
    throw errors.validation("请求体为空。");
  }

  const maxBytes = clampMaxBytes(options.maxBytes);

  const body = request.body as unknown as Parameters<typeof Readable.fromWeb>[0];
  const nodeStream = Readable.fromWeb(body);

  const bb = busboy({
    headers: { "content-type": contentType },
    /**
     * ⚠️ `defParamCharset: "utf8"` 不是可选项，是**必须**的。
     *
     * busboy 默认按 latin1 解码 Content-Disposition 里的 filename。而浏览器发出的是
     * 原始 UTF-8 字节，于是「供应商资质证明.pdf」会被解成
     * 「ä¾›åº”å•†èµ„è´¨è¯æ˜Ž.pdf」这种乱码 —— 中文供应商资料是本产品的主场景，
     * 名字一乱，界面、审计、导出的文件名全部不可用。
     * 这个 bug 是在端到端验收里发现的（单元测试直接构造 info 对象，绕过了解码环节）。
     */
    defParamCharset: "utf8",
    limits: {
      fileSize: maxBytes,
      files: MAX_FILES_PER_REQUEST,
      fields: MAX_FORM_FIELDS,
      fieldSize: MAX_FORM_FIELD_BYTES,
      parts: MAX_FILES_PER_REQUEST + MAX_FORM_FIELDS,
    },
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let sawFile = false;
    let working = 0;

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      nodeStream.destroy();
      reject(toAppError(error));
    };

    const succeed = () => {
      if (settled || working > 0) return;
      settled = true;
      resolve();
    };

    bb.on("file", (fieldName, fileStream, info) => {
      sawFile = true;
      working += 1;

      void handleFile(fieldName, fileStream, info)
        .then(() => {
          working -= 1;
          succeed();
        })
        .catch((error: unknown) => {
          working -= 1;
          fileStream.destroy();
          fail(error);
        });
    });

    bb.on("filesLimit", () => {
      fail(errors.validation("一次只能上传一个文件，请分批上传。"));
    });

    bb.on("fieldsLimit", () => {
      fail(errors.validation("表单字段过多。"));
    });

    bb.on("error", (error: unknown) => {
      fail(error);
    });

    bb.on("close", () => {
      if (!sawFile) {
        fail(errors.validation("请求中没有找到文件。"));
        return;
      }
      succeed();
    });

    nodeStream.on("error", (error: unknown) => {
      fail(error);
    });

    nodeStream.pipe(bb);
  });

  async function handleFile(
    fieldName: string,
    fileStream: Readable,
    info: { filename: string; mimeType: string; encoding: string },
  ): Promise<void> {
    // ---- 第 1 关：声明类型必须在白名单内（此举在写盘前完成） ----
    const declaredMime = (info.mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    const extension = resolveExtensionForMime(declaredMime);

    // ---- 第 2 关：文件名清洗 ----
    const safeFilename = sanitizeFilename(info.filename ?? "");

    const fileInfo: MultipartFileInfo = {
      fieldName,
      filename: info.filename ?? "",
      safeFilename,
      mimeType: declaredMime,
      extension,
    };

    const inspection = new InspectionTransform({ maxBytes });
    // busboy 在触顶时不会报错，只会截断并 emit('limit')：
    // 必须显式把「被截断」当成失败，否则会存下一个静默残缺的文件。
    const limitReached = new Promise<never>((_resolve, reject) => {
      fileStream.once("limit", () => {
        reject(errors.fileTooLarge(`文件超出大小上限（${maxBytes} 字节）。`));
      });
    });

    await Promise.race([
      sink.consume(fileInfo, fileStream.pipe(inspection), inspection),
      limitReached,
    ]);
  }
}

function clampMaxBytes(requested: number | undefined): number {
  const candidate = requested ?? DEFAULT_MAX_UPLOAD_BYTES;
  if (!Number.isFinite(candidate) || candidate <= 0) return DEFAULT_MAX_UPLOAD_BYTES;
  return Math.min(Math.floor(candidate), ABSOLUTE_MAX_UPLOAD_BYTES);
}

/** 供路由层统一处理错误的辅助函数。 */
export function asAppError(error: unknown): AppError {
  return toAppError(error);
}
