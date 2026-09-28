/**
 * GET /api/documents?workspaceId=<uuid>
 *
 * 列出当前工作区的资料包。只返回元数据与提取摘要，**不返回正文**
 * —— 正文按文档单独取，避免列表接口一次性把几十万字带出去。
 */

import { errorResponse, jsonOk, newRequestId } from "@/lib/api/route-utils";
import { requireWorkspaceAccess } from "@/lib/auth/guards";
import { listWorkspaceDocuments } from "@/lib/documents/repository";
import { serializeListRow } from "@/lib/documents/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const requestId = newRequestId();

  try {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
    // 传入的 workspaceId 只表示「想看哪个工作区」，能不能看由服务端判定。
    const { workspace } = await requireWorkspaceAccess(workspaceId, {
      minimumRole: "VIEWER",
      requestId,
    });

    const rows = await listWorkspaceDocuments(workspace.id);

    return jsonOk(
      {
        documents: rows.map(serializeListRow),
        count: rows.length,
      },
      { requestId },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
