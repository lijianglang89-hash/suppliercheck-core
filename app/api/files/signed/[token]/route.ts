/**
 * GET /api/files/signed/[token]?expires=&signature=&filename=
 *
 * 签名下载。与 `/api/files/[documentId]` 的区别只有一点：多一道签名与有效期校验。
 *
 * ⚠️ 这里是**双授权**，不是「有签名就放行」：
 *   1. 签名必须匹配 (storageKey, expiresAt) 且未过期（HMAC-SHA256 + timingSafeEqual）；
 *   2. 仍然要求登录会话 + 该 storageKey 所属工作区的成员资格。
 *
 * 为什么第 2 步不省掉 —— 签名 URL 一旦被转发就给出去了一次数据访问机会，
 * 而「供应商安全问卷」「资质证书」这类资料往往本身就带保密义务。
 * 多要一次会话，代价是签名 URL 不能直接喂给 wget/Nginx X-Accel；
 * 换来的是「任何泄露的 URL 都必须在有效会话下才能用」。这个取舍是清醒的。
 *
 * token 是存储键的 base64url 编码 —— 存储键本身已经过 assertSafeStorageKey，
 * 因此不存在借用签名 URL 做路径穿越的空间。
 */

import { errors } from "@/lib/errors";
import { errorResponse, newRequestId } from "@/lib/api/route-utils";
import { requireUser, requireWorkspaceAccess } from "@/lib/auth/guards";
import { buildDownloadResponse } from "@/lib/documents/download";
import { findDocumentByStoragePath } from "@/lib/documents/repository";
import { assertSafeStorageKey, isUuid } from "@/lib/files";
import { logger } from "@/lib/logger";
import { getEnv } from "@/lib/config/server-env";
import { decodeStorageKey, verifySignedKey } from "@/lib/storage/signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const requestId = newRequestId();

  try {
    // 先要会话，再验签名：未登录时一律 401，不去区分「签名对不对」。
    await requireUser();

    const { token } = await context.params;
    const url = new URL(request.url);

    const key = decodeStorageKey(token);
    if (!key) {
      throw errors.forbidden("下载链接无效。");
    }
    // 即使签名合法，key 本身也必须合法 —— 防线不因为「有签名」而降低。
    assertSafeStorageKey(key);

    const expiresAt = Number.parseInt(url.searchParams.get("expires") ?? "", 10);
    const signature = url.searchParams.get("signature") ?? "";

    const verification = verifySignedKey({
      key,
      expiresAt,
      signature,
      secret: getEnv().SESSION_SECRET,
    });
    if (!verification.valid) {
      logger.warn("签名下载被拒绝", { requestId, reason: verification.reason });
      throw errors.forbidden("下载链接已失效，请重新获取。");
    }

    const workspaceId = workspaceIdFromStorageKey(key);
    // 第二道授权：签名之外，仍要有有效会话且属于该工作区。
    await requireWorkspaceAccess(workspaceId, { minimumRole: "VIEWER", requestId });

    // 只允许下载「数据库里确实登记过」的文件：避免签名 URL 成为读取任意存储键的后门。
    const document = await findDocumentByStoragePath(key);
    if (!document) {
      throw errors.notFound("没有找到对应的文件。");
    }

    const requestedFilename = url.searchParams.get("filename");

    return await buildDownloadResponse(
      {
        mimeType: document.mimeType,
        safeFilename: document.safeFilename,
        size: document.size,
        storagePath: document.storagePath,
      },
      {
        requestInline: url.searchParams.get("disposition")?.toLowerCase() === "inline",
        ...(requestedFilename ? { downloadFilename: requestedFilename } : {}),
      },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

/**
 * 从存储键里取出 workspaceId。
 *
 * 键的结构由 buildStorageKey() 固定为 `workspaces/<uuid>/documents/<uuid><ext>`，
 * assertSafeStorageKey 已经保证第二段是合法 UUID。
 */
function workspaceIdFromStorageKey(key: string): string {
  const workspaceId = key.split("/")[1];
  if (!workspaceId || !isUuid(workspaceId)) {
    throw errors.forbidden("下载链接无效。");
  }
  return workspaceId;
}
