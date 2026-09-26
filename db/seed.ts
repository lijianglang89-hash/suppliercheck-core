/**
 * 可选种子数据。
 *
 * 设计原则（需求「十六、不要制造假 AI」）：
 * 默认**什么都不创建**。数据库结构本身不需要种子数据就能工作。
 *
 * 只有在显式传入 --demo 时，才创建一个明确标注为 DEMO 的账号，
 * 且邮箱域名使用 example.test（RFC 6761 保留域名，永远不会真实投递），
 * 显示名统一带 [DEMO] 前缀 —— 让人一眼能看出这是测试数据，不是真实客户。
 *
 * 用法：
 *   npm run db:seed           # 无操作，仅打印提示
 *   npm run db:seed -- --demo  # 创建演示账号
 */
import "dotenv/config";

import { closeDatabase, getDb } from "../lib/db";
import { users, workspaceMembers, workspaces } from "../lib/db/schema";
import { hashPassword } from "../lib/auth/password";

const DEMO_EMAIL = "demo@example.test";
const DEMO_PASSWORD = "demo-password-1234";
const DEMO_DISPLAY_NAME = "[DEMO] 演示账号";

async function seedDemo() {
  const db = getDb();

  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) {
    console.log("数据库中已存在用户，跳过演示数据创建。");
    return;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const userId = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ email: DEMO_EMAIL, passwordHash, displayName: DEMO_DISPLAY_NAME })
      .returning({ id: users.id });

    if (!user) throw new Error("创建演示用户失败");

    const [workspace] = await tx
      .insert(workspaces)
      .values({
        name: "[DEMO] 演示工作区",
        slug: "demo-workspace",
        ownerUserId: user.id,
      })
      .returning({ id: workspaces.id });

    if (!workspace) throw new Error("创建演示工作区失败");

    await tx.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: user.id,
      role: "OWNER",
    });

    return user.id;
  });

  console.log("已创建演示账号：");
  console.log(`  邮箱：${DEMO_EMAIL}`);
  console.log(`  密码：${DEMO_PASSWORD}`);
  console.log(`  用户：${userId}`);
  console.log("⚠️ 这是测试数据，请勿用于生产环境。");
}

async function main() {
  const withDemo = process.argv.includes("--demo");

  if (!withDemo) {
    console.log("未指定 --demo，不创建任何数据。");
    console.log("数据库结构已由迁移脚本建立，无需种子数据即可运行。");
    return;
  }

  await seedDemo();
}

main()
  .catch((error) => {
    console.error("种子脚本执行失败：", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
