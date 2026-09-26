import { describe, expect, it } from "vitest";

import {
  decodeStorageKey,
  encodeStorageKey,
  signStorageKey,
  verifySignedKey,
} from "@/lib/storage/signature";

const SECRET = "k".repeat(40);
const KEY = "workspaces/3f2504e0-4f89-41d3-9a0c-0305e82c3301/documents/a.pdf";
const NOW = 1_700_000_000;

describe("存储签名", () => {
  it("签名后校验通过", () => {
    const expiresAt = NOW + 300;
    const signature = signStorageKey({ key: KEY, expiresAt, secret: SECRET });

    expect(verifySignedKey({ key: KEY, expiresAt, signature, secret: SECRET, now: NOW })).toEqual({
      valid: true,
    });
  });

  it("换一个 key 后原签名失效（防止拿签名访问其他文件）", () => {
    const expiresAt = NOW + 300;
    const signature = signStorageKey({ key: KEY, expiresAt, secret: SECRET });
    const otherKey = "workspaces/3f2504e0-4f89-41d3-9a0c-0305e82c3301/documents/b.pdf";

    expect(
      verifySignedKey({ key: otherKey, expiresAt, signature, secret: SECRET, now: NOW }),
    ).toEqual({ valid: false, reason: "signature_mismatch" });
  });

  it("延长有效期后原签名失效（防止无限期续用）", () => {
    const expiresAt = NOW + 300;
    const signature = signStorageKey({ key: KEY, expiresAt, secret: SECRET });

    expect(
      verifySignedKey({ key: KEY, expiresAt: NOW + 30_000, signature, secret: SECRET, now: NOW }),
    ).toEqual({ valid: false, reason: "signature_mismatch" });
  });

  it("过期后拒绝", () => {
    const expiresAt = NOW + 60;
    const signature = signStorageKey({ key: KEY, expiresAt, secret: SECRET });

    expect(
      verifySignedKey({ key: KEY, expiresAt, signature, secret: SECRET, now: NOW + 61 }),
    ).toEqual({ valid: false, reason: "expired" });
  });

  it("换密钥后拒绝", () => {
    const expiresAt = NOW + 300;
    const signature = signStorageKey({ key: KEY, expiresAt, secret: SECRET });

    expect(
      verifySignedKey({
        key: KEY,
        expiresAt,
        signature,
        secret: "another-secret",
        now: NOW,
      }),
    ).toEqual({ valid: false, reason: "signature_mismatch" });
  });

  it("签名或有效期缺失时判为 malformed", () => {
    expect(verifySignedKey({ key: KEY, expiresAt: NOW + 10, signature: "", secret: SECRET })).toEqual(
      { valid: false, reason: "malformed" },
    );
    expect(
      verifySignedKey({ key: KEY, expiresAt: Number.NaN, signature: "abc", secret: SECRET }),
    ).toEqual({ valid: false, reason: "malformed" });
  });
});

describe("存储键编解码", () => {
  it("往返一致，且编码结果不含斜杠", () => {
    const encoded = encodeStorageKey(KEY);
    expect(encoded).not.toContain("/");
    expect(decodeStorageKey(encoded)).toBe(KEY);
  });

  it("解码非法输入不会抛异常", () => {
    // Node 的 base64 解码是宽容的，不会抛错；这里确认调用方不需要额外 try/catch。
    expect(() => decodeStorageKey("!!!not-base64!!!")).not.toThrow();
    expect(() => decodeStorageKey("")).not.toThrow();
  });
});
