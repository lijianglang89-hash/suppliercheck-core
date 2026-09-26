import { existsSync } from "node:fs";
import path from "node:path";

import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// 与 tests/setup.ts 保持一致的加载顺序：.env.local 优先于 .env。
// 真实 secrets 不会进入 Git（.env* 已被忽略）。
for (const file of [".env.local", ".env"]) {
  const fullPath = path.resolve(process.cwd(), file);
  if (existsSync(fullPath)) {
    loadEnv({ path: fullPath, override: false, quiet: true });
  }
}

/**
 * Drizzle Kit 配置。
 *
 * 迁移产物（SQL 文件）纳入版本控制，这样任何环境都能用同一套 SQL 建库，
 * 不依赖某个平台的控制台操作，也不绑定任何托管供应商。
 */
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "缺少 DATABASE_URL。请先复制 .env.example 为 .env.local 并填写数据库连接串。",
  );
}

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true,
});
