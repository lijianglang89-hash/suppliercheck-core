import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("密码哈希", () => {
  it("哈希后可以用正确密码验证通过", async () => {
    const stored = await hashPassword("correct horse battery");
    await expect(verifyPassword("correct horse battery", stored)).resolves.toBe(true);
  });

  it("错误密码验证失败", async () => {
    const stored = await hashPassword("correct horse battery");
    await expect(verifyPassword("wrong password", stored)).resolves.toBe(false);
  });

  it("同一密码两次哈希结果不同（盐随机）", async () => {
    const a = await hashPassword("same-password-123");
    const b = await hashPassword("same-password-123");
    expect(a).not.toBe(b);
    // 但两者都能验证通过
    await expect(verifyPassword("same-password-123", a)).resolves.toBe(true);
    await expect(verifyPassword("same-password-123", b)).resolves.toBe(true);
  });

  it("哈希串不包含明文密码", async () => {
    const stored = await hashPassword("plaintext-secret");
    expect(stored).not.toContain("plaintext-secret");
    expect(stored.startsWith("scrypt$")).toBe(true);
  });

  it("拒绝过短的密码", async () => {
    await expect(hashPassword("short")).rejects.toThrow();
  });

  it("对结构损坏的存储串返回 false 而不是抛异常", async () => {
    for (const broken of ["", "not-a-hash", "scrypt$1$2$3$4", "bcrypt$16384$8$1$aaaa$bbbb"]) {
      await expect(verifyPassword("whatever", broken)).resolves.toBe(false);
    }
  });
});
