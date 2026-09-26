/**
 * 文件安全工具集（需求「十一、文件安全」）。
 *
 * 这里集中处理所有「不信任用户输入」的逻辑：
 * - 文件名清洗：剥离路径分隔符、控制字符、保留名、超长名；
 * - 扩展名不信任：存储用的扩展名由 MIME 白名单反查得出；
 * - 魔数嗅探：不只看 Content-Type，真实字节必须与声明类型一致；
 * - 存储键生成：一律 UUID，杜绝路径穿越与文件名注入。
 */
import { createHash, randomUUID } from "node:crypto";

import { errors } from "@/lib/errors";

/** 允许上传的 MIME 白名单。扩展名由这里反查，不读用户提供的扩展名。 */
export const ALLOWED_MIME_TYPES: Readonly<Record<string, string>> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "application/zip": ".zip",
};

export const ALLOWED_MIME_TYPE_LIST = Object.keys(ALLOWED_MIME_TYPES);

/**
 * 扩展名 → MIME 的反向表。
 *
 * 用途只有一个：zip 包内条目没有 Content-Type 可信任（压缩包不会为每个条目带类型），
 * 只能按扩展名猜测。猜出来后仍然要走**同一份白名单**，猜不出或不在白名单里的条目直接跳过，
 * 不给「压缩包绕过类型校验」留口子。
 */
export const EXTENSION_TO_MIME: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(ALLOWED_MIME_TYPES).map(([mime, extension]) => [extension, mime]),
  ),
);

/** 按扩展名猜 MIME；不在白名单内返回 undefined（调用方应据此拒绝）。 */
export function resolveMimeForExtension(filename: string): string | undefined {
  const extension = extractExtension(filename);
  return extension ? EXTENSION_TO_MIME[extension] : undefined;
}

/** 文件名的最大长度（字符）。超出会被截断保留后缀。 */
const MAX_FILENAME_LENGTH = 120;

/** Windows 保留设备名，出现在文件名中会导致不可预期的行为。 */
const WINDOWS_RESERVED_NAMES =
  /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

/** 文件名中不允许出现的字符：路径分隔符、控制字符、路径穿越序列。 */
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

/**
 * 清洗文件名，返回可安全展示与记录的版本。
 * 注意：清洗结果**只用于展示与审计**，绝不用于拼接存储路径。
 */
export function sanitizeFilename(input: string): string {
  const trimmed = (input ?? "").trim();
  if (trimmed.length === 0) {
    throw errors.unsafeFileName("文件名为空。");
  }

  // 只取最后一段，丢掉任何目录成分（防 .zip 里带 ../../ 的情况）。
  const basename = trimmed.split(/[\\/]/).pop() ?? "";

  const cleaned = basename
    .replace(ILLEGAL_FILENAME_CHARS, "_")
    .replace(/\.{2,}/g, ".") // 干掉 .. 序列
    .replace(/^\.+/, "") // 不允许以点开头
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length === 0 || cleaned === "." || cleaned === "..") {
    throw errors.unsafeFileName("文件名清洗后为空。");
  }

  if (WINDOWS_RESERVED_NAMES.test(cleaned)) {
    return `_${cleaned}`;
  }

  if (cleaned.length <= MAX_FILENAME_LENGTH) {
    return cleaned;
  }

  // 超长时保留尾部（通常包含扩展名）。
  return cleaned.slice(cleaned.length - MAX_FILENAME_LENGTH);
}

/** 从清洗后的文件名里取扩展名（小写，含点）。仅用于信息记录。 */
export function extractExtension(filename: string): string {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(filename);
  return match ? `.${match[1].toLowerCase()}` : "";
}

/**
 * 校验 MIME 是否在白名单内，并返回该 MIME 对应的规范扩展名。
 * 用户声明的扩展名一律忽略。
 */
export function resolveExtensionForMime(mimeType: string): string {
  const normalized = (mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const extension = ALLOWED_MIME_TYPES[normalized];
  if (!extension) {
    throw errors.unsupportedMediaType(`不支持的文件类型：${normalized || "(空)"}`);
  }
  return extension;
}

/* ------------------------------ 魔数嗅探 ------------------------------ */

export type FileSignature = "pdf" | "png" | "jpeg" | "zip" | "unknown";

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

/**
 * 依据文件头字节判断真实类型。
 * 只看前若干字节，不读取整个文件，因此可以安全地用在流式上传的第一个 chunk 上。
 */
export function sniffFileSignature(header: Uint8Array): FileSignature {
  if (startsWith(header, [0x25, 0x50, 0x44, 0x46])) return "pdf"; // %PDF
  if (startsWith(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(header, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(header, [0x50, 0x4b, 0x03, 0x04])) return "zip"; // docx/xlsx/zip 同族
  if (startsWith(header, [0x50, 0x4b, 0x05, 0x06])) return "zip"; // 空 zip
  return "unknown";
}

/** 声明 MIME 与真实签名是否匹配。docx / xlsx 本质是 zip 容器。 */
export function signatureMatchesMime(signature: FileSignature, mimeType: string): boolean {
  const normalized = (mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  switch (signature) {
    case "pdf":
      return normalized === "application/pdf";
    case "png":
      return normalized === "image/png";
    case "jpeg":
      return normalized === "image/jpeg";
    case "zip":
      return (
        normalized === "application/zip" ||
        normalized === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        normalized === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
    default:
      return false;
  }
}

/* --------------------------- 存储键与路径 --------------------------- */

/**
 * 生成存储键。结构：workspaces/{workspaceId}/documents/{documentId}{ext}
 *
 * - workspaceId 与 documentId 都是服务端生成的 UUID，天然不含路径字符；
 * - 扩展名来自 MIME 白名单反查，不来自用户输入。
 */
export function buildStorageKey(params: {
  workspaceId: string;
  documentId: string;
  mimeType: string;
}): string {
  assertUuid(params.workspaceId, "workspaceId");
  assertUuid(params.documentId, "documentId");
  const extension = resolveExtensionForMime(params.mimeType);
  return `workspaces/${params.workspaceId}/documents/${params.documentId}${extension}`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function assertUuid(value: string, label: string): void {
  if (!isUuid(value)) {
    throw errors.validation(`${label} 必须是 UUID。`, { details: { [label]: value } });
  }
}

/**
 * 路径穿越防线。任何来自外部或数据库的存储键，在使用前都必须过这一关：
 * - 只允许 workspaces/<uuid>/... 形态；
 * - 禁止绝对路径、反斜杠、空字节、以及任何 .. 片段。
 */
export function assertSafeStorageKey(key: string): void {
  if (!key || typeof key !== "string") {
    throw errors.unsafeFileName("存储键为空。");
  }
  if (key.includes("\u0000")) {
    throw errors.unsafeFileName("存储键包含空字节。");
  }
  if (key.startsWith("/") || key.startsWith("\\") || /^[A-Za-z]:/.test(key)) {
    throw errors.unsafeFileName("存储键不允许是绝对路径。");
  }
  if (key.includes("\\")) {
    throw errors.unsafeFileName("存储键不允许包含反斜杠。");
  }
  const segments = key.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw errors.unsafeFileName("存储键包含非法的路径片段。");
  }
  // 首段固定为 workspaces，第二段必须是 UUID。
  if (segments[0] !== "workspaces") {
    throw errors.unsafeFileName("存储键必须以 workspaces/ 开头。");
  }
  const workspaceId = segments[1];
  if (!workspaceId || !isUuid(workspaceId)) {
    throw errors.unsafeFileName("存储键中的 workspace 段必须是 UUID。");
  }
}

/* ------------------------------- 校验 ------------------------------- */

export interface UploadValidationInput {
  filename: string;
  mimeType: string;
  size: number;
  header: Uint8Array;
  maxBytes: number;
}

export interface ValidatedUpload {
  originalFilename: string;
  safeFilename: string;
  mimeType: string;
  extension: string;
  size: number;
}

/**
 * 上传前置校验：大小 → 类型 → 文件名 → 魔数，四关都过才放行。
 * 任一步失败都会抛出带明确 code 的 AppError，由上层转成用户可读提示。
 */
export function validateUpload(input: UploadValidationInput): ValidatedUpload {
  if (!Number.isFinite(input.size) || input.size <= 0) {
    throw errors.validation("文件内容为空。");
  }
  if (input.size > input.maxBytes) {
    throw errors.fileTooLarge(
      `文件大小 ${formatBytes(input.size)} 超出上限 ${formatBytes(input.maxBytes)}。`,
    );
  }

  const mimeType = (input.mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const extension = resolveExtensionForMime(mimeType);

  const safeFilename = sanitizeFilename(input.filename);

  const signature = sniffFileSignature(input.header);
  if (!signatureMatchesMime(signature, mimeType)) {
    throw errors.unsupportedMediaType(
      `文件真实内容与声明的类型不一致（声明 ${mimeType}，实际 ${signature}）。`,
    );
  }

  return {
    originalFilename: input.filename,
    safeFilename,
    mimeType,
    extension,
    size: input.size,
  };
}

/** 计算 SHA-256 摘要（十六进制）。 */
export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** 生成一个新的文档 id（UUID v4）。 */
export function newId(): string {
  return randomUUID();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
