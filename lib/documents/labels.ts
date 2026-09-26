/**
 * 状态与文案映射。
 *
 * 单独抽出来的理由：界面上「已就绪」「解析失败」这类词是给使用者看的，
 * 而数据库里存的是 READY / FAILED 这类机器值。把映射集中在一处，
 * 可以保证后续所有页面（资料库、审核、报告）说的都是同一套词，
 * 也不会出现某个页面直接把 FAILED 印给用户看的尴尬。
 */

export type DocumentStatus = "UPLOADED" | "PROCESSING" | "READY" | "FAILED" | "DELETED";
export type JobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";

export type StatusTone = "neutral" | "progress" | "success" | "danger";

/** 文档状态的完整文案表。用 Record 而不是 switch，保证新增状态时**编译期**就会报缺项。 */
export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  UPLOADED: "已上传",
  PROCESSING: "解析中",
  READY: "可查看",
  FAILED: "解析失败",
  DELETED: "已删除",
};

const DOCUMENT_STATUS_TONES: Record<DocumentStatus, StatusTone> = {
  UPLOADED: "progress",
  PROCESSING: "progress",
  READY: "success",
  FAILED: "danger",
  DELETED: "neutral",
};

export function documentStatusLabel(status: string): string {
  return DOCUMENT_STATUS_LABELS[status as DocumentStatus] ?? status;
}

export function documentStatusTone(status: string): StatusTone {
  return DOCUMENT_STATUS_TONES[status as DocumentStatus] ?? "neutral";
}

export function jobStatusLabel(status: string): string {
  switch (status) {
    case "PENDING":
      return "待处理";
    case "RUNNING":
      return "处理中";
    case "SUCCEEDED":
      return "已完成";
    case "FAILED":
      return "失败";
    default:
      return status;
  }
}

/** 解析器标识 → 给使用者看的名字。 */
export function parserLabel(parserId: string): string {
  switch (parserId) {
    case "pdf":
      return "PDF 文本层";
    case "docx":
      return "Word 正文";
    case "xlsx":
      return "Excel 工作表";
    case "zip":
      return "压缩包清单";
    case "image-ocr-pending":
      return "图片（待接入 OCR）";
    case "unsupported":
      return "暂不支持的类型";
    default:
      return parserId;
  }
}

/** 文件类型的中文说明。 */
export function mimeTypeLabel(mimeType: string): string {
  switch (mimeType) {
    case "application/pdf":
      return "PDF";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "Word";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return "Excel";
    case "image/png":
      return "PNG 图片";
    case "image/jpeg":
      return "JPEG 图片";
    case "application/zip":
      return "压缩包";
    default:
      return mimeType;
  }
}

export const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  neutral: "bg-ink-100 text-ink-600",
  progress: "bg-brand-50 text-brand-700",
  success: "bg-ink-100 text-success-600",
  danger: "bg-ink-100 text-danger-600",
};

/** 尚未完成解析、值得继续轮询的状态。 */
export function isPendingStatus(status: string): boolean {
  return status === "UPLOADED" || status === "PROCESSING";
}
