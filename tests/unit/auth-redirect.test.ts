import { describe, expect, it } from "vitest";

import { resolveSafeRedirect } from "@/lib/auth/redirect";

describe("resolveSafeRedirect", () => {
  it("放行站内绝对路径", () => {
    expect(resolveSafeRedirect("/dashboard")).toBe("/dashboard");
    expect(resolveSafeRedirect("/reports?page=2")).toBe("/reports?page=2");
  });

  it("拦截绝对 URL（open redirect）", () => {
    expect(resolveSafeRedirect("https://evil.example.com")).toBe("/dashboard");
    expect(resolveSafeRedirect("http://evil.example.com/phish")).toBe("/dashboard");
  });

  it("拦截协议相对 URL", () => {
    expect(resolveSafeRedirect("//evil.example.com")).toBe("/dashboard");
    expect(resolveSafeRedirect("/\\evil.example.com")).toBe("/dashboard");
  });

  it("拦截含控制字符的注入尝试", () => {
    expect(resolveSafeRedirect("/dash\nboard")).toBe("/dashboard");
    expect(resolveSafeRedirect("/path\u0000x")).toBe("/dashboard");
  });

  it("空值与非法类型回落到默认路径", () => {
    expect(resolveSafeRedirect(undefined)).toBe("/dashboard");
    expect(resolveSafeRedirect(null)).toBe("/dashboard");
    expect(resolveSafeRedirect("")).toBe("/dashboard");
    expect(resolveSafeRedirect("   ")).toBe("/dashboard");
    expect(resolveSafeRedirect("dashboard")).toBe("/dashboard");
  });

  it("支持自定义回退路径", () => {
    expect(resolveSafeRedirect("https://evil.com", "/login")).toBe("/login");
  });
});
