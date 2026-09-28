/**
 * 请求标识（trace id）生成与解析。
 *
 * 刻意与 next/server 解耦：纯逻辑、零依赖，可在 Route Handler、Server Action
 * 与测试里共用，而不必因此把 NextResponse 拖进 Server Action 模块。
 */

/** 生成一个请求标识。不引入额外依赖，够用来串联日志即可。 */
export function newRequestId(): string {
  return `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 解析本次请求使用的 requestId。
 *
 * 优先复用上游（网关 / 反向代理 / 前端）已经传来的 `X-Request-Id`，
 * 这样一次跨服务的调用能串成同一条 trace；上游没给才现场生成。
 *
 * 安全：只接受「不含空白与控制字符、长度 ≤128」的可打印 ASCII，
 * 避免把换行/控制符写进响应头或日志（头注入 / 日志拆行）。
 * 不合规的一律当作「没给」，重新生成。
 */
const REQUEST_ID_SAFE = /^[\x21-\x7e]{1,128}$/;

export function resolveRequestId(incoming?: string | null): string {
  const value = incoming?.trim() ?? "";
  if (REQUEST_ID_SAFE.test(value)) return value;
  return newRequestId();
}
