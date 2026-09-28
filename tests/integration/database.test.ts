import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { closeDatabase, getDb, pingDatabase } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

import { cleanupUsers, createTestUser } from "../helpers/fixtures";
// 表清单的唯一事实源在 helpers/expected-tables.ts（0.4.17 起：实测清单，不是需求照抄；
// 7 张零使用的孤儿表已随迁移删除）。本文件只做「期望表都存在」的单向断言；
// 反方向（多出来的表）由 migration-regression.test.ts 的集合相等断言守住。
import { EXPECTED_TABLES } from "../helpers/expected-tables";

const createdUserIds: string[] = [];

describe("数据库连接与结构", () => {
  afterAll(async () => {
    await cleanupUsers(createdUserIds);
    await closeDatabase();
  });

  it("可以建立连接（health check 依赖的能力）", async () => {
    const result = await pingDatabase();
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("业务表全部存在", async () => {
    const db = getDb();
    const result = await db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );

    const names = Array.from(result as Iterable<{ table_name: string }>).map((row) => row.table_name);

    for (const table of EXPECTED_TABLES) {
      expect(names, `缺少表 ${table}`).toContain(table);
    }
  });

  it("用户表有邮箱唯一索引", async () => {
    const db = getDb();
    const result = await db.execute(
      sql`select indexname from pg_indexes where tablename = 'users'`,
    );
    const indexes = Array.from(result as Iterable<{ indexname: string }>).map((row) => row.indexname);

    expect(indexes).toContain("users_email_unique");
  });

  it("每个业务表都带 workspace_id（多租户隔离前提）", async () => {
    const db = getDb();
    const result = await db.execute(
      sql`select table_name from information_schema.columns
          where table_schema = 'public' and column_name = 'workspace_id'`,
    );
    const withWorkspaceId = new Set(
      Array.from(result as Iterable<{ table_name: string }>).map((row) => row.table_name),
    );

    const requireWorkspaceId = EXPECTED_TABLES.filter(
      (table) => table !== "users" && table !== "workspaces",
    );
    for (const table of requireWorkspaceId) {
      expect(withWorkspaceId.has(table), `${table} 缺少 workspace_id`).toBe(true);
    }
  });

  it("可以创建用户并读回", async () => {
    const created = await createTestUser("db");
    createdUserIds.push(created.id);

    const db = getDb();
    const [found] = await db.select().from(users).where(eq(users.id, created.id)).limit(1);

    expect(found).toBeDefined();
    expect(found?.email).toBe(created.email);
    // 密码必须是哈希，不能是明文
    expect(found?.passwordHash.startsWith("scrypt$")).toBe(true);
  });

  it("邮箱唯一约束生效（重复注册被拒绝）", async () => {
    const created = await createTestUser("dup");
    createdUserIds.push(created.id);

    const db = getDb();
    await expect(
      db.insert(users).values({
        email: created.email,
        passwordHash: "scrypt$1$1$1$aaaa$bbbb",
        displayName: "重复用户",
      }),
    ).rejects.toThrow();
  });
});
