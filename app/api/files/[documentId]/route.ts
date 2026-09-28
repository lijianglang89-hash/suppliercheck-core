/**
 * GET /api/files/[documentId]?disposition=inline|attachment
 *
 * 受授权下载与预览。**零信任多租户，没有例外。**
 *
 * 授权链路（每一步都不可跳过）：
 *   1. 必须有有效会话 —— 未登录 401，而不是「文件存在就给你」；
 *   2. 按 documentId 查库，**用查出来的 workspaceId** 校验成员关系 —— 403；
 *   3. 校验通过才从私有存储开流。
 *
 * 刻意不做的事：不信任任何来自浏览器的 workspace_id；不因为「URL 里带了正确 id」
 * 就放行；不把存储路径暴露给前端（下载只认 documentId）。
 *
 * ⚠️ 设计契约（防腐，勿改）：本路由与 `/api/files/signed/[token]` 同为 **Stateless（无状态）**，
 * 无共享可变状态、开流只读磁盘，天然并发安全；**禁止加锁**。授权是「会话 + 工作区成员」的
 * 双授权（签名路由再叠加一层签名），未登录一律先挡（401），绝不因资源是否存在给出不同响应。
 */

import { errors } from "@/lib/errors";
import { errorResponse, newRequestId } from "@/lib/api/route-utils";
import { requireUser, requireWorkspaceAccess } from "@/lib/auth/guards";
import { buildDownloadResponse } from "@/lib/documents/download";
import { findDocumentById } from "@/lib/documents/repository";
import { isUuid } from "@/lib/files";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const requestId = newRequestId();

  try {
    /**
     * 顺序很关键：**先要会话，再碰数据库**。
     *
     * 如果反过来（先查库、后发现没权限），未登录的响应就会因为
     * 「这个 documentId 到底存不存在」而不同（404 vs 401）——
     * 那本身就是一个可以用来枚举 id 的信号。
     * 先挡会话，未登录的答案就永远是同一个 401。
     */
    await requireUser();

    const { documentId } = await context.params;
    if (!isUuid(documentId)) {
      throw errors.notFound("没有找到对应的文件。");
    }

    const document = await findDocumentById(documentId);
    if (!document) {
      throw errors.notFound("没有找到对应的文件。");
    }

    // ↓ 这一行就是「浏览器传什么都不能作为授权依据」的落点。
    await requireWorkspaceAccess(document.workspaceId, { minimumRole: "VIEWER", requestId });

    const requestInline =
      new URL(request.url).searchParams.get("disposition")?.toLowerCase() === "inline";

    return await buildDownloadResponse(
      {
        mimeType: document.mimeType,
        safeFilename: document.safeFilename,
        size: document.size,
        storagePath: document.storagePath,
      },
      { requestInline },
    );
  } catch (error) {
    // 403 会在这里被记录为 warn，且**不会**告诉调用方「这个 id 存在只是你没权限」以外的信息。
    if (error instanceof Error && /没有找到对应的文件/.test(error.message)) {
      logger.debug("下载目标不存在", { requestId });
    }
    return errorResponse(error, requestId);
  }
}
