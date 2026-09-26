import { NextResponse } from "next/server";

import { pingDatabase } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * 健康检查。
 *
 * 明确只输出「服务状态」与「数据库状态」两项：
 * 不返回数据库地址、环境变量、内部路径、版本号细节或任何服务器信息。
 * 数据库不可用时返回 503，便于反向代理与监控做判断。
 */
export async function GET() {
  let database: "ok" | "error" = "ok";
  let latencyMs: number | undefined;

  try {
    const result = await pingDatabase();
    latencyMs = result.latencyMs;
  } catch {
    // pingDatabase 内部已经记录过详细错误，这里只降级状态，不向调用方泄露原因。
    database = "error";
  }

  const healthy = database === "ok";

  if (!healthy) {
    logger.error("健康检查未通过", { check: "database" });
  }

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      database,
      ...(latencyMs !== undefined ? { databaseLatencyMs: latencyMs } : {}),
      checkedAt: new Date().toISOString(),
    },
    {
      status: healthy ? 200 : 503,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
