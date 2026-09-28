/**
 * POST /api/documents/[documentId]/process
 *
 * 重新触发解析。用于两种场景：
 *   1. 上一次解析失败（例如 PDF 损坏），使用者想再试一次；
 *   2. 进程重启导致状态卡在 PROCESSING —— 认领逻辑对「超过阈值仍停留在 RUNNING」
 *      的文档视为僵死，允许重新认领（见 repository.claimDocumentForProcessing）。
 *
 * 幂等：已经 READY 的文档不会重复解析，返回 200 并说明原因，而不是报错。
 */

import { errors } from "@/lib/errors";
import { errorResponse, jsonOk, resolveRequestId } from "@/lib/api/route-utils";
import { requireUser, requireWorkspaceAccess } from "@/lib/auth/guards";
import { isUuid } from "@/lib/files";
import { findDocumentById } from "@/lib/documents/repository";
import { enqueueDocumentProcessing } from "@/lib/documents/service";
import { serializeDocument } from "@/lib/documents/serialize";
import { enforceRateLimit } from "@/lib/rate-limit/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    // 先要会话，再碰数据库：避免「未登录」的响应因 id 是否存在而不同（可枚举信号）。
    const user = await requireUser();

    const { documentId } = await context.params;
    if (!isUuid(documentId)) {
      throw errors.notFound("没有找到对应的文档。");
    }

    const document = await findDocumentById(documentId);
    if (!document) {
      throw errors.notFound("没有找到对应的文档。");
    }

    // 重新解析是「写」操作，要求 MEMBER 及以上，只读成员不能触发。
    await requireWorkspaceAccess(document.workspaceId, { minimumRole: "MEMBER", requestId });

    // 授权之后、入队之前：重新解析与上传共用同一条串行队列，频次必须受控。
    enforceRateLimit("reprocess", `${user.id}:${document.workspaceId}`);

    const result = await enqueueDocumentProcessing(documentId, { requestId });
    const refreshed = (await findDocumentById(documentId)) ?? document;

    return jsonOk(
      {
        queued: result.queued,
        ...(result.reason ? { reason: result.reason } : {}),
        document: serializeDocument(refreshed),
      },
      { requestId },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
