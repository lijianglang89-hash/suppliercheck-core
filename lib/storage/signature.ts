/**
 * 存储访问签名。
 *
 * 纯函数实现，不读取环境变量、不 import server-only，因此可以被单元测试直接覆盖。
 * 契约：签名绑定 (key, expiresAt) 两个维度 —— 换 key 或延期都会导致校验失败。
 */
import { createHmac, timingSafeEqual } from "node:crypto";

function deriveKey(secret: string): Buffer {
  return Buffer.from(`suppliercheck:storage:${secret}`, "utf8");
}

export function signStorageKey(params: {
  key: string;
  expiresAt: number;
  secret: string;
}): string {
  return createHmac("sha256", deriveKey(params.secret))
    .update(`${params.key}:${params.expiresAt}`)
    .digest("base64url");
}

export interface VerifySignedKeyInput {
  key: string;
  expiresAt: number;
  signature: string;
  secret: string;
  /** 当前时间（秒），便于测试注入。 */
  now?: number;
}

export type SignedKeyVerification =
  | { valid: true }
  | { valid: false; reason: "expired" | "malformed" | "signature_mismatch" };

export function verifySignedKey(input: VerifySignedKeyInput): SignedKeyVerification {
  if (!input.signature || !Number.isFinite(input.expiresAt)) {
    return { valid: false, reason: "malformed" };
  }

  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (input.expiresAt <= now) {
    return { valid: false, reason: "expired" };
  }

  const expected = signStorageKey({
    key: input.key,
    expiresAt: input.expiresAt,
    secret: input.secret,
  });

  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(input.signature, "utf8");
  if (expectedBuffer.length !== actualBuffer.length) {
    return { valid: false, reason: "signature_mismatch" };
  }
  if (!timingSafeEqual(expectedBuffer, actualBuffer)) {
    return { valid: false, reason: "signature_mismatch" };
  }

  return { valid: true };
}

/** 存储键 → URL 安全的路径段（避免斜杠被当作路径分隔符）。 */
export function encodeStorageKey(key: string): string {
  return Buffer.from(key, "utf8").toString("base64url");
}

export function decodeStorageKey(encoded: string): string | undefined {
  try {
    return Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return undefined;
  }
}
