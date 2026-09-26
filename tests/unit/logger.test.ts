import { describe, expect, it } from "vitest";

import { redact } from "@/lib/logger";

describe("日志脱敏", () => {
  it("敏感键名整值替换为 [REDACTED]", () => {
    const output = redact({
      email: "someone@example.com",
      password: "hunter2",
      apiKey: "sk-live-abcdef",
      SESSION_SECRET: "topsecret",
      authorization: "Bearer xyz",
    }) as Record<string, unknown>;

    expect(output.email).toBe("someone@example.com");
    expect(output.password).toBe("[REDACTED]");
    expect(output.apiKey).toBe("[REDACTED]");
    expect(output.SESSION_SECRET).toBe("[REDACTED]");
    expect(output.authorization).toBe("[REDACTED]");
  });

  it("嵌套结构也会被递归处理", () => {
    const output = redact({
      request: { headers: { cookie: "sc_session=abc" }, body: { note: "普通内容" } },
    }) as { request: { headers: { cookie: unknown }; body: { note: string } } };

    expect(output.request.headers.cookie).toBe("[REDACTED]");
    expect(output.request.body.note).toBe("普通内容");
  });

  it("超长字符串被截断（避免把文件正文写进日志）", () => {
    const long = "a".repeat(5000);
    const output = redact({ content: long }) as { content: string };

    expect(output.content.length).toBeLessThan(400);
    expect(output.content).toContain("[truncated");
  });

  it("二进制内容只记录长度", () => {
    const output = redact({ file: new Uint8Array(1024) }) as { file: string };
    expect(output.file).toBe("[Binary 1024 bytes]");
  });

  it("循环引用不会导致栈溢出", () => {
    const circular: Record<string, unknown> = { name: "root" };
    circular.self = circular;

    const output = redact(circular) as Record<string, unknown>;
    expect(output.name).toBe("root");
    expect(output.self).toBe("[Circular]");
  });

  it("超过深度限制的嵌套被截断标记", () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: "too deep" } } } } } } };
    const output = redact(deep);
    expect(JSON.stringify(output)).toContain("MaxDepth");
  });

  it("Error 对象被展开为可读结构", () => {
    const output = redact({ err: new Error("boom") }) as { err: { name: string; message: string } };
    expect(output.err.name).toBe("Error");
    expect(output.err.message).toBe("boom");
  });

  it("null / undefined / 基础类型原样保留", () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
  });
});
