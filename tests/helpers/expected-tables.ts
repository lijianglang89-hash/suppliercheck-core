/**
 * 期望的业务表清单 —— **唯一事实源**。
 *
 * 背景（2026-09-28 实测核对后固化，0.4.17 迁移落地）：
 * 原本 database.test.ts 里列的是需求文档的 12 张表，其中 7 张
 * （questionnaires / questions / evidence / answers / answer_reviews /
 * audit_reports / exports）**从未有任何代码使用** —— 它们唯一的使用者就是
 * 「表都存在」那条断言，等于用测试给空壳发合格证。已随迁移 0004 删除
 * （生产库实测 0 行，无数据损失）。
 *
 * 教训：把「需求列了」当成「已交付」写进断言，会让不存在的功能在 CI 里长期显示绿色。
 *
 * 消费方：
 *   - tests/integration/database.test.ts —— 单向断言（期望表都存在）；
 *   - tests/integration/migration-regression.test.ts —— 集合相等断言（探针 #3）。
 * 两处必须共用本清单；要加表，先写服务层，再改这里，顺序不能反。
 */
export const EXPECTED_TABLES = [
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

/**
 * 允许出现在 public schema 的**基础设施表**白名单。
 *
 * Drizzle 的迁移记账表落在哪个 schema / 叫什么名字随版本与迁移路径有差异
 * （`drizzle_migrations` 或 `__drizzle_migrations` 都见过）。它不是业务表，
 * 不进 EXPECTED_TABLES，但也绝不能被当成「孤儿表回潮」误杀 ——
 * 两个命名变体都预置在这里；实际不存在的白名单项无副作用。
 * 若集合相等断言报出别的基础设施表名，先把它的来历查清楚，再有意识地加进来。
 */
export const KNOWN_INFRA_TABLES = ["drizzle_migrations", "__drizzle_migrations"] as const;
