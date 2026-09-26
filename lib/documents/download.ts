/**
 * 受控文件下载响应。
 *
 * 两条独立路径（见 app/api/files/）共用这里的构造逻辑，保证响应头完全一致：
 *   - `/api/files/[documentId]`     —— 会话授权（登录 + 工作区成员）
 *   - `/api/files/signed/[token]`   —— 签名 + 会话双授权
 *
 * 安全默认值：
 * - 一律 `attachment`，除非显式请求 `inline` **且** 类型属于可安全内联的白名单
 *   （pdf / png / jpeg）。docx / xlsx / zip 永远不允许内联 —— 浏览器对这类
 *   容器的内联行为没有统一保证，还可能触发扩展程序。
 * - `X-Content-Type-Options: nosniff`：防止浏览器把内容当别的东西执行。
 * - `Cache-Control: private, no-store`：带授权的响应绝不允许被中间层缓存。
 * - `Content-Disposition` 同时给 ASCII 回退名与 RFC 5987 编码名，
 *   中文文件名在旧客户端也不会乱码或截断。
 */

import { Readable } from "node:stream";

import { errors } from "@/lib/errors";
import { getStorageProvider } from "@/lib/storage";

/** 允许 `?disposition=inline` 的类型白名单。 */
const INLINE_SAFE_MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);

export interface DownloadTarget {
  mimeType: string;
  safeFilename: string;
  size: number;
  storagePath: string;
}

export interface DownloadResponseOptions {
  /** 使用者请求的内联预览。仅在类型安全时生效。 */
  requestInline?: boolean;
  /** 覆盖下载文件名（例如签名 URL 上传来的 filename 参数）。 */
  downloadFilename?: string;
}

export async function buildDownloadResponse(
  target: DownloadTarget,
  options: DownloadResponseOptions = {},
): Promise<Response> {
  const storage = getStorageProvider();
  const stream = await storage.downloadStream(target.storagePath);

  const inline = Boolean(options.requestInline) && INLINE_SAFE_MIME_TYPES.has(target.mimeType);
  const filename = sanitizeForHeader(options.downloadFilename ?? target.safeFilename);

  if (!filename) {
    throw errors.unsafeFileName("文件名不合法。");
  }

  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status: 200,
    headers: {
      "Content-Type": target.mimeType,
      "Content-Length": String(target.size),
      "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", filename),
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * 构造 Content-Disposition。
 *
 * ASCII 回退名把非 ASCII 字符换成下划线（而不是删掉，避免文件名只剩扩展名）；
 * 真正的名字放在 `filename*=UTF-8''...` 里，现代浏览器优先用它。
 */
export function contentDisposition(kind: "inline" | "attachment", filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "download";
  const encoded = encodeURIComponent(filename);
  return `${kind}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

/** 响应头里不允许出现换行与控制字符，这里做最后一道清洗。 */
function sanitizeForHeader(value: string): string {
  return value
    // 控制字符是**刻意**要匹配的（防响应头注入），不是笔误。
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "_")
    .trim()
    .slice(0, 180);
}
