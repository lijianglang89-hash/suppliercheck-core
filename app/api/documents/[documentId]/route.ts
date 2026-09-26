/**
 * GET /api/documents/[documentId]
 *
 * 单份文档详情：元数据 + 提取摘要 + **正文预览**（默认前 2000 字）。
 *
 * 多租户铁律在这里的体现：**用文档自己的 workspaceId 去授权**，而不是用请求里带的
 * 参数。攻击者就算猜到了别人的 documentId，也会在成员校验这一步被挡下（403）。
 * 为了让「不存在」与「无权限」不泄露信息，两者对外都表现为查不到 —— 但内部日志会区分。
 */

import { errors } from "@/lib/errors";
import { errorResponse, jsonOk, newRequestId } from "@/lib/api/route-utils";
import { requireUser, requireWorkspaceAccess } from "@/lib/auth/guards";
import { isUuid } from "@/lib/files";
import { findDocumentById, findDocumentText } from "@/lib/documents/repository";
import { serializeDocument } from "@/lib/documents/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREVIEW_CHARS = 2_000;

export async function GET(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const requestId = newRequestId();

  try {
    // 先要会话，再碰数据库：避免「未登录」的响应因 id 是否存在而不同（可枚举信号）。
    await requireUser();

    const { documentId } = await context.params;
    if (!isUuid(documentId)) {
      throw errors.notFound("没有找到对应的文档。");
    }

    const document = await findDocumentById(documentId);
    if (!document) {
      throw errors.notFound("没有找到对应的文档。");
    }

    // 授权依据是数据库里这行记录的 workspaceId，不是任何来自客户端的东西。
    await requireWorkspaceAccess(document.workspaceId, { minimumRole: "VIEWER", requestId });

    const text = await findDocumentText(documentId);

    return jsonOk({
      document: serializeDocument(document),
      extraction: text
        ? {
            parserId: text.parserId,
            charCount: text.charCount,
            truncated: text.truncated,
            pageCount: text.pageCount,
            notes: Array.isArray(text.notes) ? text.notes : [],
            structure: text.structure,
            preview: text.text.slice(0, PREVIEW_CHARS),
            previewTruncated: text.text.length > PREVIEW_CHARS,
          }
        : null,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
