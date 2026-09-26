import { describe, expect, it } from "vitest";

import {
  SESSION_DEFAULT_TTL_SECONDS,
  createSessionToken,
  verifySessionToken,
} from "@/lib/auth/session-token";

const SECRET = "s".repeat(48);
const NOW = 1_700_000_000;

describe("会话令牌", () => {
  it("签发后可以验证，并还原出 userId", () => {
    const token = createSessionToken({ userId: "user-1", secret: SECRET, now: NOW });
    const result = verifySessionToken(token, SECRET, NOW + 10);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.userId).toBe("user-1");
      expect(result.payload.expiresAt).toBe(NOW + SESSION_DEFAULT_TTL_SECONDS);
    }
  });

  it("使用不同密钥签发的令牌无法通过验证", () => {
    const token = createSessionToken({ userId: "user-1", secret: SECRET, now: NOW });
    const result = verifySessionToken(token, "another-secret-value-32-chars-long!!", NOW + 10);

    expect(result).toEqual({ valid: false, reason: "bad_signature" });
  });

  it("载荷被篡改后签名校验失败", () => {
    const token = createSessionToken({ userId: "user-1", secret: SECRET, now: NOW });
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ userId: "attacker", issuedAt: NOW, expiresAt: NOW + 9999 }),
    ).toString("base64url");

    const result = verifySessionToken(`${forged}.${signature}`, SECRET, NOW + 10);
    expect(result).toEqual({ valid: false, reason: "bad_signature" });
    expect(payload).toBeTruthy();
  });

  it("过期令牌被拒绝", () => {
    const token = createSessionToken({ userId: "user-1", secret: SECRET, ttlSeconds: 60, now: NOW });
    const result = verifySessionToken(token, SECRET, NOW + 61);

    expect(result).toEqual({ valid: false, reason: "expired" });
  });

  it("结构非法的令牌被拒绝", () => {
    for (const bad of ["", "no-dot", ".onlysignature", "onlypayload."]) {
      const result = verifySessionToken(bad, SECRET, NOW);
      expect(result.valid).toBe(false);
    }
  });

  it("签名部分长度与期望不一致时不会抛异常", () => {
    const token = createSessionToken({ userId: "user-1", secret: SECRET, now: NOW });
    const [payload] = token.split(".");
    const result = verifySessionToken(`${payload}.short`, SECRET, NOW + 1);

    expect(result).toEqual({ valid: false, reason: "bad_signature" });
  });
});
