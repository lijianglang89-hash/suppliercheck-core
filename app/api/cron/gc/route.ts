/**
 * 定时维护路由：GC（物理回收过期软删文档）+ 僵尸任务扫尾（sweep）。
 *
 * 这是全站唯一一个不依赖用户会话、而依赖共享密钥的路由。纪律：
 *
 * 1. **CRON_SECRET 未配置 = 功能整体停用**（404）。绝不允许「没配密钥就放行」——
 *    那等于把一个无人看管的批量删除端点挂上公网。
 * 2. 返回 404 而不是 401 来表达停用：不向探测者暴露这个端点的存在与形态。
 * 3. 密钥比较用 timingSafeEqual；长度不同时也跑一次比较，
 *    避免用响应耗时差异逐字节探出密钥长度。
 * 4. GET 与 POST 都接受 —— crontab + curl 用 GET 最省事，
 *    云函数定时任务常默认 POST，没必要让部署者二选一。
 *
 * sweep 的职责：把进程死亡（OOM / 重启）遗留的 PROCESSING / RUNNING 僵尸任务
 * 静默打回 FAILED（带「系统中断」文案），释放状态机让使用者可以重新发起。
 * 判定标尺与手动重跑的 stale claim 完全一致（见 lib/jobs/limits.ts）。
 *
 * 预期调用方式（外部定时器，按天一次）：
 *   curl -X POST https://<host>/api/cron/gc -H "Authorization: Bearer $CRON_SECRET"
 */
import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { getEnv } from "@/lib/config/server-env";
import { runDocumentGarbageCollection, sweepStuckDocuments } from "@/lib/documents/service";
import { logger } from "@/lib/logger";
import { sweepStuckReviewRuns } from "@/lib/reviews/service";

export const dynamic = "force-dynamic";

function isAuthorized(provided: string | null | undefined, secret: string): boolean {
  if (!provided) return false;
  const given = Buffer.from(provided, "utf8");
  const expected = Buffer.from(secret, "utf8");
  if (given.length !== expected.length) {
    // 长度不等时也要消耗一次真实的比较，让耗时形态与命中时一致。
    timingSafeEqual(expected, expected);
    return false;
  }
  return timingSafeEqual(given, expected);
}

async function handle(request: Request): Promise<NextResponse> {
  const env = getEnv();

  if (!env.CRON_SECRET) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "没有找到对应的资源。" } },
      { status: 404 },
    );
  }

  const header = request.headers.get("authorization");
  const provided = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length)
    : request.headers.get("x-cron-secret");

  if (!isAuthorized(provided, env.CRON_SECRET)) {
    logger.warn("GC 路由鉴权失败", { hasAuthorizationHeader: header !== null });
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "鉴权失败。" } },
      { status: 401 },
    );
  }

  const gc = await runDocumentGarbageCollection();
  // 扫尾串行跟在 GC 后面：同一批表、量级都极小，串行的确定性比并行省的那几毫秒值钱。
  const documentsSweep = await sweepStuckDocuments();
  const reviewRunsSwept = await sweepStuckReviewRuns();

  const sweep = {
    documents: documentsSweep.documents,
    jobs: documentsSweep.jobs,
    reviewRuns: reviewRunsSwept,
  };

  logger.info("定时维护完成", { ...gc, sweep });

  return NextResponse.json({ ok: true, ...gc, sweep });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
