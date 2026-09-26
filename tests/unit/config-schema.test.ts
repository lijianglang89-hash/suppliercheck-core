import { describe, expect, it } from "vitest";

import {
  DEFAULT_STORAGE_PATH,
  EnvValidationError,
  isSensitiveEnvKey,
  parseServerEnv,
} from "@/lib/config/schema";
import { DEFAULT_MAX_UPLOAD_BYTES } from "@/lib/documents/limits";

/** 一份最小可用的合法环境。 */
function validEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "test",
    APP_URL: "http://localhost:3010",
    DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/db",
    SESSION_SECRET: "x".repeat(32),
    ...overrides,
  };
}

describe("parseServerEnv", () => {
  it("接受最小合法配置并填充默认值", () => {
    const env = parseServerEnv(validEnv());

    expect(env.APP_URL).toBe("http://localhost:3010");
    expect(env.AI_PROVIDER).toBe("mock");
    expect(env.STORAGE_PROVIDER).toBe("local");
    expect(env.STORAGE_PATH).toBe(DEFAULT_STORAGE_PATH);
    // 引用常量而不是硬编码数字：默认值只允许有**一个**事实来源，
    // 否则改了 limits 忘了改测试（或反之）会让测试变成假证据。
    expect(env.MAX_UPLOAD_BYTES).toBe(DEFAULT_MAX_UPLOAD_BYTES);
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("缺少 DATABASE_URL 时抛出 EnvValidationError", () => {
    expect(() => parseServerEnv(validEnv({ DATABASE_URL: undefined }))).toThrow(EnvValidationError);
  });

  it("SESSION_SECRET 短于 32 字符时拒绝启动", () => {
    try {
      parseServerEnv(validEnv({ SESSION_SECRET: "short" }));
      expect.unreachable("应当抛出 EnvValidationError");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).issues.join()).toContain("SESSION_SECRET");
    }
  });

  it("把空字符串视作未设置，而不是有效值", () => {
    // AI_PROVIDER 为空时应回落到默认值 mock，而不是解析失败
    const env = parseServerEnv(validEnv({ AI_PROVIDER: "" }));
    expect(env.AI_PROVIDER).toBe("mock");
  });

  it("选择 non-mock Provider 但缺少密钥时拒绝启动", () => {
    try {
      parseServerEnv(
        validEnv({
          AI_PROVIDER: "openai-compatible",
          AI_API_KEY: "",
          AI_MODEL: "",
        }),
      );
      expect.unreachable("应当抛出 EnvValidationError");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const issues = (error as EnvValidationError).issues.join();
      expect(issues).toContain("AI_API_KEY");
      expect(issues).toContain("AI_MODEL");
    }
  });

  it("选择 non-mock Provider 且填齐密钥时通过", () => {
    const env = parseServerEnv(
      validEnv({
        AI_PROVIDER: "openai-compatible",
        AI_API_KEY: "sk-test",
        AI_MODEL: "qwen-plus",
      }),
    );
    expect(env.AI_PROVIDER).toBe("openai-compatible");
    expect(env.AI_MODEL).toBe("qwen-plus");
  });

  it("V0.1 尚未实现的 oss 存储被明确拒绝（而不是静默降级）", () => {
    expect(() => parseServerEnv(validEnv({ STORAGE_PROVIDER: "oss" }))).toThrow(EnvValidationError);
  });

  it("生产环境拒绝相对的 STORAGE_PATH（standalone 会切工作目录，文件会丢进镜像层）", () => {
    // 实测踩过：standalone 的 server.js 把 cwd 切到 .next/standalone，
    // 相对的 ./storage/uploads 就落到了镜像内部 —— 容器重建即丢，且毫无报错。
    try {
      parseServerEnv(validEnv({ NODE_ENV: "production", STORAGE_PATH: "./storage/uploads" }));
      expect.unreachable("应当抛出 EnvValidationError");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).issues.join()).toContain("STORAGE_PATH");
    }
  });

  it("生产环境接受绝对路径的 STORAGE_PATH（Linux 与 Windows 两种写法）", () => {
    for (const storagePath of ["/storage/uploads", "G:/供应商智审/storage/uploads"]) {
      const env = parseServerEnv(validEnv({ NODE_ENV: "production", STORAGE_PATH: storagePath }));
      expect(env.STORAGE_PATH).toBe(storagePath);
    }
  });

  it("一次性报出全部问题，方便部署时一轮改完", () => {
    try {
      parseServerEnv({ DATABASE_URL: undefined, SESSION_SECRET: "no" });
      expect.unreachable("应当抛出 EnvValidationError");
    } catch (error) {
      const issues = (error as EnvValidationError).issues;
      expect(issues.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("isSensitiveEnvKey", () => {
  it("识别常见敏感键名", () => {
    for (const key of ["DATABASE_URL_PASSWORD", "SESSION_SECRET", "AI_API_KEY", "ALIPAY_PRIVATE_KEY"]) {
      expect(isSensitiveEnvKey(key)).toBe(true);
    }
  });

  it("不误伤普通键名", () => {
    for (const key of ["APP_URL", "LOG_LEVEL", "STORAGE_PATH"]) {
      expect(isSensitiveEnvKey(key)).toBe(false);
    }
  });
});
