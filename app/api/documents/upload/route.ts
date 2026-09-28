/**
 * POST /api/documents/upload?workspaceId=<uuid>
 *
 * 单文件流式上传。设计要点：
 *
 * 1. **先授权，后收字节。** workspaceId 走查询串而不是表单字段，就是为了在读取请求体
 *    之前就能完成「登录 + 工作区成员校验」，未授权时一个字节都不落盘。
 *    （表单字段要等 multipart 解析到那一段才知道内容，那时文件往往已经在写了。）
 * 2. **绝不把文件读进内存。** 字节从请求流 → 检查层 → 私有存储，全程管道直通。
 * 3. **一次请求一个文件。** 多文件由客户端分批发；这样单次请求的峰值内存与磁盘占用
 *    都是可预测的，出问题时也容易定位是哪一份。
 */

import { errors } from "@/lib/errors";
import { newRequestId, errorResponse, jsonOk } from "@/lib/api/route-utils";
import { requireUser, requireWorkspaceAccess } from "@/lib/auth/guards";
import { getEnv } from "@/lib/config/server-env";
import { expandArchiveDocument, enqueueMany, storeUploadedFile } from "@/lib/documents/service";
import { receiveSingleFile } from "@/lib/documents/multipart";
import { serializeDocument } from "@/lib/documents/serialize";
import type { DocumentRow } from "@/lib/db/schema";
import { enforceRateLimit } from "@/lib/rate-limit/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();

  try {
    const user = await requireUser();

    const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
    // 关键：workspaceId 来自浏览器，只作为「要往哪个工作区写」的意图，
    // 是否允许写由服务端回库核对成员关系决定。无权 → 403，不会继续读请求体。
    const { workspace } = await requireWorkspaceAccess(workspaceId, {
      minimumRole: "MEMBER",
      requestId,
    });

    // 授权之后、收字节之前：被限流拒绝时一个字节都不落盘。
    // key = 用户+工作区 —— 限的是「一个身份在一个工作区里的上传速率」。
    enforceRateLimit("upload", `${user.id}:${workspace.id}`);

    const env = getEnv();
    let created: DocumentRow | undefined;

    await receiveSingleFile(
      request,
      {
        async consume(info, stream, inspection) {
          created = await storeUploadedFile({
            workspaceId: workspace.id,
            userId: user.id,
            originalFilename: info.filename,
            safeFilename: info.safeFilename,
            mimeType: info.mimeType,
            stream,
            inspection,
          });
        },
      },
      { maxBytes: env.MAX_UPLOAD_BYTES },
    );

    if (!created) {
      throw errors.internal("上传未产出文档记录。");
    }

    // 压缩包：把包内可处理条目展开成独立子文档（子文档各自有完整解析状态）。
    const children =
      created.mimeType === "application/zip" ? await expandArchiveDocument(created) : [];

    // 触发解析。enqueueMany 只做「原子认领 + 入队」，不等待解析完成，
    // 所以响应不会被解析阻塞；但状态在响应前已经翻到 PROCESSING，界面能立刻看到。
    await enqueueMany([created.id, ...children.map((child) => child.id)]);

    return jsonOk(
      {
        document: serializeDocument(created),
        children: children.map(serializeDocument),
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
