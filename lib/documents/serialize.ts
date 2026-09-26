/**
 * 文档记录的对外表示（API 响应体）。
 *
 * 集中在一个文件的原因：**存储路径绝不出现在任何响应里**。
 * 只要这个映射函数只有一份，就不可能有某条路由不小心把 `storage_path` 漏给前端
 * —— 那是把私有目录结构直接交出去。下载一律走 /api/files/，不靠路径。
 */

import type { DocumentRow } from "@/lib/db/schema";

import type { DocumentListRow } from "./repository";

export interface DocumentDto {
  id: string;
  workspaceId: string;
  originalFilename: string;
  safeFilename: string;
  mimeType: string;
  extension: string;
  size: number;
  status: string;
  processingStatus: string;
  pageCount: number | null;
  parentDocumentId: string | null;
  supplierId: string | null;
  createdAt: string;
  /** 以下字段仅列表接口返回。 */
  extraction?: {
    parserId: string;
    charCount: number;
    truncated: boolean;
    notes: string[];
    sheetNames: string[];
  };
}

export function serializeDocument(document: DocumentRow): DocumentDto {
  return {
    id: document.id,
    workspaceId: document.workspaceId,
    originalFilename: document.originalFilename,
    safeFilename: document.safeFilename,
    mimeType: document.mimeType,
    extension: document.extension,
    size: document.size,
    status: document.status,
    processingStatus: document.processingStatus,
    pageCount: document.pageCount,
    parentDocumentId: document.parentDocumentId,
    supplierId: document.supplierId,
    createdAt: document.createdAt.toISOString(),
  };
}

export function serializeListRow(row: DocumentListRow): DocumentDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    originalFilename: row.originalFilename,
    safeFilename: row.safeFilename,
    mimeType: row.mimeType,
    extension: row.extension,
    size: row.size,
    status: row.status,
    processingStatus: row.processingStatus,
    pageCount: row.pageCount,
    parentDocumentId: row.parentDocumentId,
    supplierId: row.supplierId,
    createdAt: row.createdAt.toISOString(),
    ...(row.parserId
      ? {
          extraction: {
            parserId: row.parserId,
            charCount: row.charCount ?? 0,
            truncated: row.truncated ?? false,
            notes: toStringArray(row.notes),
            sheetNames: toStringArray(
              (row.structure as { sheetNames?: unknown } | null)?.sheetNames,
            ),
          },
        }
      : {}),
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
