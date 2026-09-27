import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { closeDatabase, getDb, pingDatabase } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

import { cleanupUsers, createTestUser } from "../helpers/fixtures";

/**
 * 现有业务表（2026-09-28 实测核对后的清单，不再是「需求第八条」的照抄）。
 *
 * ⚠️ 原本这里列的是需求文档里的 12 张表，其中 7 张（questionnaires / questions /
 * evidence / answers / answer_reviews / audit_reports / exports）**从未有任何代码使用** ——
 * 它们唯一的使用者就是下面这条「表都存在」的断言，等于用测试给空壳发合格证。
 * 已随迁移删除（生产库实测 0 行，无数据损失）。
 *
 * 教训：把「需求列了」当成「已交付」写进断言，会让不存在的功能在 CI 里长期显示绿色。
 */
const EXPECTED_TABLES = [
  "users",
  "workspaces",
  "workspace_members",
  "documents",
  "document_processing_jobs",
  "suppliers",
  "review_templates",
  "review_runs",
  "review_findings",
] as const;

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
