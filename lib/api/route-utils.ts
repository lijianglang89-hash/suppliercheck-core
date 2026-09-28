/**
 * 路由层公共工具。
 *
 * 目的只有一个：让每个 API 路由的错误处理长得一样，且**不会漏**。
 * 需求禁止 `catch { return null }` 这类吞错写法，因此统一在这里做三件事：
 *   1. 把任意异常规整成 AppError（分类 + HTTP 状态 + 安全文案）；
 *   2. 5xx 记 error 日志、4xx 记 warn 日志（含 requestId 便于串联）；
 *   3. 响应体只含 code / message / requestId —— 绝不回传堆栈、路径或数据库细节。
 */

import { NextResponse } from "next/server";

import { toAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/** 生成一个请求标识。不引入额外依赖，够用来串联日志即可。 */
export function newRequestId(): string {
  return `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function errorResponse(error: unknown, requestId?: string): NextResponse {
  const appError = toAppError(error, { requestId });
  const context = { requestId, code: appError.code, status: appError.status };

  if (appError.status >= 500) {
    logger.error("接口处理失败", { ...context, error: appError.message, details: appError.details });
  } else {
    logger.warn("接口拒绝请求", context);
  }

  const headers: Record<string, string> = { "Cache-Control": "no-store, max-age=0" };

  // 限流拒绝时带上 Retry-After：让客户端（和人）知道什么时候可以再来，
  // 而不是对着 429 干等。标准头，网关与浏览器都认。
  const retryAfter = appError.details.retryAfterSeconds;
  if (appError.status === 429 && typeof retryAfter === "number") {
    headers["Retry-After"] = String(Math.max(1, Math.ceil(retryAfter)));
  }

  return NextResponse.json(appError.toResponseBody(), {
    status: appError.status,
    headers,
  });
}

/** 成功响应：统一禁缓存，避免任何带授权的响应被中间层缓存。 */
export function jsonOk(body: unknown, init?: { status?: number }): NextResponse {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

/** 只接受 JSON 请求体，解析失败即 400（不把解析异常抛给上层）。 */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return {};
  }
  try {
    const parsed: unknown = await request.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}
