/**
 * 迁移回归：执行全部 Drizzle 迁移后的 public 物理表集合，必须与
 * EXPECTED_TABLES **完全相等**（探针 #3 / 孤儿表防回潮）。
 *
 * 为什么单向断言不够：database.test.ts 的「业务表全部存在」只守了
 * 期望 ⊆ 实际 —— 0.4.17 之前那 7 张零使用的孤儿表正是靠它长期绿灯的
 * （多出来的表没有任何断言会红）。本探针补上反方向：**实际 ⊆ 期望 ∪ 基础设施白名单**。
 *
 * 与既有集成测试的区别：本探针在 beforeAll 里**自己执行 migrate()**
 * （drizzle journal 幂等，已应用的迁移自动跳过），因此：
 *   - 全新库（CI 的 Service Container）→ 从零建到期望结构，直接检验
 *     「迁移文件 → 物理结构」这条映射本身；
 *   - 已迁移的库（本地 dev DB）→ 零副作用，直接进入断言。
 * 前置条件与其它集成测试一致：DATABASE_URL 指向一个可写的 PostgreSQL。
 */
import path from "node:path";

import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase, getDb } from "@/lib/db";

import { EXPECTED_TABLES, KNOWN_INFRA_TABLES } from "../helpers/expected-tables";

const ROOT = process.cwd();

describe("迁移回归：物理表集合 === 实测清单", () => {
  beforeAll(async () => {
    // 幂等迁移：journal 里已记录的条目会被跳过。
    // 用意是让「迁移文件 → 物理结构」这条映射本身被 CI 检验，
    // 而不是依赖「某个环境碰巧被手工迁移过」。
    await migrate(getDb(), { migrationsFolder: path.resolve(ROOT, "db/migrations") });
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("★ public schema 表集合与 EXPECTED_TABLES 完全相等（多一张少一张都红）", async () => {
    const db = getDb();
    const result = await db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const actual = new Set(
      Array.from(result as Iterable<{ table_name: string }>).map((row) => row.table_name),
    );

    const missing = EXPECTED_TABLES.filter((table) => !actual.has(table));
    const allowed = new Set<string>([...EXPECTED_TABLES, ...KNOWN_INFRA_TABLES]);
    const unexpected = [...actual].filter((table) => !allowed.has(table));

    expect(missing, "执行迁移后缺少业务表 —— 检查 db/migrations 是否完整").toEqual([]);

    expect(
      unexpected,
      "public schema 出现了清单之外的新表 —— 这正是 0.4.17 之前 7 张孤儿表" +
        "（questionnaires/questions/evidence/answers/answer_reviews/audit_reports/exports）" +
        "的回潮形态。处置只有两条：真实现（先有服务层，再更新 helpers/expected-tables.ts），" +
        "或随迁移删除。不许只建表不留使用方；若是新的基础设施表，查清来历后加进 " +
        "KNOWN_INFRA_TABLES 白名单。",
    ).toEqual([]);
  });
});
