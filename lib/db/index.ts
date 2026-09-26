/**
 * 数据库连接入口。
 *
 * 只使用标准 PostgreSQL 协议 + drizzle-orm/postgres-js 驱动，
 * 不依赖任何托管平台的 SDK，因此未来可直接把 DATABASE_URL 指向
 * 阿里云 RDS PostgreSQL 或自建实例，代码零改动。
 */
import "server-only";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getEnv } from "@/lib/config/server-env";
import { errors } from "@/lib/errors";
import { logger } from "@/lib/logger";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

let sqlClient: ReturnType<typeof postgres> | undefined;
let database: Database | undefined;

/** 是否处于测试环境（测试里用更小的连接池，避免连接数打满）。 */
function isTest(): boolean {
  return process.env.NODE_ENV === "test";
}

export function getSqlClient(): ReturnType<typeof postgres> {
  if (!sqlClient) {
    const env = getEnv();
    sqlClient = postgres(env.DATABASE_URL, {
      max: isTest() ? 2 : 10,
      idle_timeout: 20,
      connect_timeout: 10,
      // 应用层已经统一处理错误，这里不再额外打印 SQL 语句，避免日志泄露数据。
      onnotice: () => {},
    });
  }
  return sqlClient;
}

export function getDb(): Database {
  if (!database) {
    database = drizzle(getSqlClient(), { schema });
  }
  return database;
}

/** 打开连接并执行一次最小查询，用于健康检查。 */
export async function pingDatabase(): Promise<{ ok: true; latencyMs: number }> {
  const startedAt = Date.now();
  try {
    await getSqlClient()`select 1`;
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    logger.error("数据库连通性检查失败", { error: error as Error });
    throw errors.database("数据库连接失败", { cause: error });
  }
}

/** 优雅关闭连接池。测试收尾与进程退出时调用。 */
export async function closeDatabase(): Promise<void> {
  if (sqlClient) {
    await sqlClient.end({ timeout: 5 });
    sqlClient = undefined;
    database = undefined;
  }
}

export { schema };
