/**
 * Vitest 全局前置。
 *
 * 按优先级加载环境文件：.env.test > .env.local > .env
 * 已存在的环境变量不会被覆盖，因此 CI 里通过环境注入的值优先级最高。
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { config } from "dotenv";

// @types/node 把 NODE_ENV 声明为只读，这里通过中转断言赋值。
const mutableEnv = process.env as unknown as Record<string, string | undefined>;
mutableEnv.NODE_ENV = "test";

for (const file of [".env.test", ".env.local", ".env"]) {
  const fullPath = path.resolve(process.cwd(), file);
  if (existsSync(fullPath)) {
    config({ path: fullPath, override: false, quiet: true });
  }
}

// 测试环境下的日志噪声控制：除非显式指定，否则只输出 warn 以上。
if (!process.env.LOG_LEVEL) {
  process.env.LOG_LEVEL = "warn";
}
