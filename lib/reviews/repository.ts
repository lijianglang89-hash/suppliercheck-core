/**
 * 审核域数据访问层。
 *
 * 与 `lib/documents/repository.ts` 同一条纪律：只做「一行 SQL 一件事」，
 * 业务判断留在 service 层。所有按 id 的查询都**不接受调用方传入的 workspace_id
 * 作为过滤条件** —— 查出来之后由 service 层用返回值里的 workspaceId 去授权，
 * 保证授权判据只有一个来源。
 */
import "server-only";

import { and, count, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  reviewFindings,
  reviewRuns,
  type NewReviewFinding,
  type ReviewFinding,
  type ReviewRun,
} from "@/lib/db/schema";

/* ------------------------------------------------------------------ */
/* 审核任务                                                            */
/* ------------------------------------------------------------------ */

export interface CreateReviewRunInput {
  workspaceId: string;
  name: string;
  supplierId: string | null;
  templateName: string;
  templateKey: string;
  templateSnapshot: Record<string, unknown>;
  documentIds: string[];
  engineProvider: string;
  engineModel: string;
  engineMock: boolean;
  createdBy: string;
}

export async function createReviewRun(input: CreateReviewRunInput): Promise<ReviewRun> {
  const db = getDb();
  const [row] = await db
    .insert(reviewRuns)
    .values({ ...input, status: "QUEUED" })
    .returning();
  if (!row) throw new Error("创建审核任务失败。");
  return row;
}

export async function findReviewRunById(runId: string): Promise<ReviewRun | undefined> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(reviewRuns)
    .where(and(eq(reviewRuns.id, runId), isNull(reviewRuns.deletedAt)))
    .limit(1);
  return row;
}

/**
 * 原子认领一次审核任务。
 *
 * 与文档解析用同一套模式（`UPDATE ... WHERE ... RETURNING`）而不是「先查后写」：
 * 后者在用户连点两次「重新运行」时会让同一次审核跑两遍，
 * 把发现重复写进库里 —— 报告里就会出现一模一样的条目出现两次。
 *
 * 超时阈值的作用：进程重启会让任务永远停在 RUNNING，必须有办法重新认领。
 */
export async function claimReviewRun(
  runId: string,
  staleThresholdMs: number,
): Promise<ReviewRun | undefined> {
  const db = getDb();
  const staleBefore = new Date(Date.now() - staleThresholdMs);

  const [row] = await db
    .update(reviewRuns)
    /*
     * 生命周期时间戳一律用**数据库时钟**（now()），不用 new Date()。
     *
     * 原因很具体：createdAt 是数据库默认值，如果 startedAt / finishedAt 用应用时钟，
     * 两个时钟差 1 秒就会出现「完成时间早于发起时间」的报告 ——
     * 用户看到的第一反应是这条结论不可信，而它其实只是时钟漂移。
     * 同一条记录的时间戳必须来自同一个时钟。
     */
    .set({ status: "RUNNING", startedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(reviewRuns.id, runId),
        isNull(reviewRuns.deletedAt),
        or(
          inArray(reviewRuns.status, ["QUEUED", "FAILED", "READY"]),
          and(eq(reviewRuns.status, "RUNNING"), lt(reviewRuns.updatedAt, staleBefore)),
        ),
      ),
    )
    .returning();

  return row;
}

export async function markReviewRunReady(
  runId: string,
  summary: Record<string, unknown>,
  ai: { enabled: boolean; notes: string[] },
  engine: { provider: string; model: string; mock: boolean },
): Promise<void> {
  const db = getDb();
  await db
    .update(reviewRuns)
    .set({
      status: "READY",
      summary,
      aiEnabled: ai.enabled,
      aiNotes: ai.notes,
      /*
       * 引擎身份在**执行完成时**回写，而不是只在创建时记录。
       * 原因：任务可能在创建后几分钟才真正跑（串行队列），中间有人改了 AI_PROVIDER 配置，
       * 那么真正产出这份报告的就不是创建时那个引擎。记录"是谁产的"必须记准。
       */
      engineProvider: engine.provider,
      engineModel: engine.model,
      engineMock: engine.mock,
      errorCode: null,
      errorMessage: null,
      finishedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(reviewRuns.id, runId));
}

export async function markReviewRunFailed(
  runId: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(reviewRuns)
    .set({
      status: "FAILED",
      errorCode,
      errorMessage,
      finishedAt: sql`now()`,
      updatedAt: new Date(),
    })
    .where(eq(reviewRuns.id, runId));
}

/**
 * 把「僵死」的审核任务批量打回 FAILED，返回被收走的 run id。
 *
 * 判定与 claimReviewRun 的 stale 重认领**同一把标尺**（status=RUNNING 且
 * updatedAt 早于阈值）。正常运行被 withTimeout(REVIEW_TIMEOUT_MS=60s) 硬性兜底，
 * RUNNING 超过 5 分钟只可能是进程死亡（OOM / 容器重启 / kill）。
 * 条件 UPDATE 保证幂等且不误杀健康任务。
 */
export async function failStaleRunningReviewRuns(
  staleBefore: Date,
  errorCode: string,
  errorMessage: string,
): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .update(reviewRuns)
    .set({
      status: "FAILED",
      errorCode,
      errorMessage,
      finishedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(reviewRuns.status, "RUNNING"),
        isNull(reviewRuns.deletedAt),
        lt(reviewRuns.updatedAt, staleBefore),
      ),
    )
    .returning({ id: reviewRuns.id });
  return rows.map((row) => row.id);
}

export async function softDeleteReviewRun(runId: string): Promise<void> {
  const db = getDb();
  await db
    .update(reviewRuns)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(reviewRuns.id, runId));
}

export async function listWorkspaceReviewRuns(
  workspaceId: string,
  options: { limit?: number; status?: ReviewRun["status"] } = {},
): Promise<ReviewRun[]> {
  const db = getDb();
  const conditions = [eq(reviewRuns.workspaceId, workspaceId), isNull(reviewRuns.deletedAt)];
  if (options.status) conditions.push(eq(reviewRuns.status, options.status));

  return db
    .select()
    .from(reviewRuns)
    .where(and(...conditions))
    .orderBy(desc(reviewRuns.createdAt))
    .limit(options.limit ?? 100);
}

export async function countReviewRunsByStatus(workspaceId: string) {
  const db = getDb();
  return db
    .select({ status: reviewRuns.status, total: count() })
    .from(reviewRuns)
    .where(and(eq(reviewRuns.workspaceId, workspaceId), isNull(reviewRuns.deletedAt)))
    .groupBy(reviewRuns.status);
}

/* ------------------------------------------------------------------ */
/* 审核发现                                                            */
/* ------------------------------------------------------------------ */

/**
 * 覆盖写入一次审核的全部发现。
 *
 * 先删后插，在同一事务里。原因：一次审核的发现是**整体**，
 * 不是可以增量合并的东西。重新运行一次审核后如果旧发现还留着，
 * 报告会混入上一轮的结论 —— 那种报告比没有报告更糟。
 */
export async function replaceRunFindings(
  runId: string,
  workspaceId: string,
  findings: NewReviewFinding[],
): Promise<void> {
  const db = getDb();

  await db.transaction(async (tx) => {
    await tx.delete(reviewFindings).where(eq(reviewFindings.reviewRunId, runId));
    if (findings.length === 0) return;

    // 分批插入：一次 INSERT 里塞进上千行参数会让 postgres.js 生成超长语句。
    // 500 是在「语句长度」与「往返次数」之间取的平衡：100 批会让一份上千条发现的
    // 报告多出十次往返，事务持有时间也跟着变长。
    const CHUNK = 500;
    for (let index = 0; index < findings.length; index += CHUNK) {
      const chunk = findings.slice(index, index + CHUNK).map((finding) => ({
        ...finding,
        workspaceId,
        reviewRunId: runId,
      }));
      await tx.insert(reviewFindings).values(chunk);
    }
  });
}

/**
 * 报告页与详情页用的排序。
 *
 * ⚠️ 严重级别必须**降序**（desc）。Postgres 的 enum 排序按声明顺序，
 * 而本项目的声明顺序是 INFO → LOW → MEDIUM → HIGH → CRITICAL，
 * 直接 `orderBy(severity)`（升序）会把「严重」排在最后 —— 报告一打开先看到提示、
 * 最后才看到阻断项，这跟任何人的阅读预期都是反的。
 *
 * 后续排序键的作用是**结果可复现**：同级别内按插入顺序（createdAt），
 * 再用 ruleId 与 title 兜住时间戳相同的情况（批量插入同一毫秒很常见）。
 * 没有稳定次序的话，同一份报告两次打开顺序不同，"上次看到的那条去哪了"就无从谈起。
 */
export async function listRunFindings(
  runId: string,
  /**
   * 工作区 id。**必传，不接受省略。**
   *
   * 调用方（页面）已经在调用前用 run.workspaceId 做了归属校验，所以这里再加一道
   * 看起来是多余的。但「按 id 查明细」是最容易被复制粘贴到新调用点的一类查询，
   * 而漏掉一次就是跨租户读数据 —— 把过滤条件写进查询本身，
   * 那个未来的调用点就算忘了校验也读不到别人的数据。
   * 纵深防御的第二道闸门不该依赖第一道永远正确。
   */
  workspaceId: string,
): Promise<ReviewFinding[]> {
  const db = getDb();
  return db
    .select()
    .from(reviewFindings)
    .where(and(eq(reviewFindings.reviewRunId, runId), eq(reviewFindings.workspaceId, workspaceId)))
    .orderBy(
      desc(reviewFindings.severity),
      reviewFindings.createdAt,
      reviewFindings.ruleId,
      reviewFindings.title,
    );
}

/** 一次拿多个任务的发现数量，用于列表页显示，避免 N+1。 */
export async function countFindingsByRuns(runIds: string[]) {
  if (runIds.length === 0) return [];
  const db = getDb();
  return db
    .select({
      reviewRunId: reviewFindings.reviewRunId,
      severity: reviewFindings.severity,
      total: count(),
    })
    .from(reviewFindings)
    .where(inArray(reviewFindings.reviewRunId, runIds))
    .groupBy(reviewFindings.reviewRunId, reviewFindings.severity);
}
