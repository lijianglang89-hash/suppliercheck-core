/**
 * 手工端到端：用库里已有的资料跑一次真实审核，并把结论打印出来。
 *
 * 不是回归测试（因此默认 skip，见 describe.skip）：它连真实数据库、
 * 依赖库里已有的资料，用途是**人工确认整条链路能跑通** ——
 * 从「资料已解析」到「报告里出现逐条发现」，包括队列、落库、发现替换。
 *
 * 跑法（需先建好 SSH 隧道）：
 *   npx vitest run tests/manual/e2e-review-run.test.ts --reporter=verbose
 */
import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { ensureWorkspaceForUser } from "@/lib/auth/workspaces";
import { getDb } from "@/lib/db";
import { documents, users } from "@/lib/db/schema";
import { findReviewRunById, listRunFindings } from "@/lib/reviews/repository";
import { createReviewRunAndEnqueue } from "@/lib/reviews/service";

describe.skip("端到端：发起一次审核", () => {
  it(
    "跑完并产出发现",
    async () => {
      const db = getDb();
      const [user] = await db.select().from(users).orderBy(asc(users.createdAt)).limit(1);
      const workspace = await ensureWorkspaceForUser(user!.id);

      const rows = await db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.workspaceId, workspace.id))
        .limit(5);

      expect(rows.length).toBeGreaterThan(0);

      const run = await createReviewRunAndEnqueue({
        workspaceId: workspace.id,
        userId: user!.id,
        templateKey: "builtin:supplier-onboarding",
        documentIds: rows.map((row) => row.id),
        supplierId: null,
        name: null,
      });

      let current = run;
      for (let i = 0; i < 60 && current.status !== "READY" && current.status !== "FAILED"; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const next = await findReviewRunById(run.id);
        if (next) current = next;
      }

       
      console.log("状态：", current.status);
       
      console.log("摘要：", JSON.stringify(current.summary));

      const findings = await listRunFindings(run.id, workspace.id);
      for (const finding of findings) {
         
        console.log(` [${finding.severity}/${finding.category}] ${finding.title}`);
      }

      expect(current.status).toBe("READY");
    },
    120_000,
  );
});
