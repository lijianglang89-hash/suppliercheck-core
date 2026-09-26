/**
 * 会话令牌的纯逻辑部分（可单元测试）。
 *
 * 令牌格式：base64url(JSON payload) + "." + base64url(HMAC-SHA256)
 * 选择自包含签名令牌而不是服务端 session 表，是为了让 V0.1 的表结构
 * 严格贴合需求列出的 12 张表；未来需要「强制下线」能力时，
 * 可以在此之上叠加一层 session 版本号或黑名单。
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface SessionPayload {
  userId: string;
  /** 签发时间（秒）。 */
  issuedAt: number;
  /** 过期时间（秒）。 */
  expiresAt: number;
}

export const SESSION_DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 天

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function createSessionToken(params: {
  userId: string;
  secret: string;
  ttlSeconds?: number;
  now?: number;
}): string {
  const now = params.now ?? Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    userId: params.userId,
    issuedAt: now,
    expiresAt: now + (params.ttlSeconds ?? SESSION_DEFAULT_TTL_SECONDS),
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, params.secret)}`;
}

export type SessionVerification =
  | { valid: true; payload: SessionPayload }
  | { valid: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifySessionToken(
  token: string,
  secret: string,
  now?: number,
): SessionVerification {
  if (typeof token !== "string" || token.length === 0) {
    return { valid: false, reason: "malformed" };
  }

  const separatorIndex = token.lastIndexOf(".");
  if (separatorIndex <= 0 || separatorIndex === token.length - 1) {
    return { valid: false, reason: "malformed" };
  }

  const encoded = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);

  const expectedSignature = sign(encoded, secret);
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const actualBuffer = Buffer.from(signature, "utf8");
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    return { valid: false, reason: "bad_signature" };
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return { valid: false, reason: "malformed" };
  }

  if (
    typeof payload?.userId !== "string" ||
    !Number.isFinite(payload.issuedAt) ||
    !Number.isFinite(payload.expiresAt)
  ) {
    return { valid: false, reason: "malformed" };
  }

  const current = now ?? Math.floor(Date.now() / 1000);
  if (payload.expiresAt <= current) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, payload };
}
