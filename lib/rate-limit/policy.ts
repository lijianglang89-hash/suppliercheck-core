/**
 * 限流策略：哪个入口、限多严、按什么键。
 *
 * 只保护**重资源写动作**（吃磁盘 IO / 解析内存 / 串行队列的四个入口），
 * 查询类读接口刻意不限 —— 它们单次成本极低且有索引覆盖，限流只会
 * 伤害正常翻页/刷新，换不来任何资源保护。
 *
 * 限额依据（写死在代码里而不是环境变量）：
 * - upload    30 次/分：多文件上传是一次拖拽分批发多个请求（见上传路由设计），
 *             30 保证「一次拖拽十几个文件」的合法操作顺畅，同时把
 *             攻击者的持续写入压在可承受范围（30 × 50MB 上限/分）；
 * - reprocess 20 次/分：重新解析走同一条串行队列，频次上限保护队列不被刷满；
 * - review    10 次/分：审核是最重的一档（引擎 + AI 占位 + 全量结论落库），
 *             正常人一分钟内发起 10 次审核只可能是脚本。
 *
 * key = `userId:workspaceId`：限的是「一个身份在一个工作区里的操作速率」，
 * 不同工作区互不影响（多工作区用户各自有完整额度）。
 */
import { errors } from "@/lib/errors";
import { logger } from "@/lib/logger";

import { createSlidingWindowLimiter, type SlidingWindowLimiter } from "./limiter";

export type RateLimitGroup = "upload" | "reprocess" | "review";

interface GroupPolicy {
  windowMs: number;
  max: number;
}

const WINDOW_MS = 60_000;

const POLICIES: Record<RateLimitGroup, GroupPolicy> = {
  upload: { windowMs: WINDOW_MS, max: 30 },
  reprocess: { windowMs: WINDOW_MS, max: 20 },
  review: { windowMs: WINDOW_MS, max: 10 },
};

/** 只读暴露给测试与诊断（契约测试按它断言次数，不许硬编码）。 */
export const RATE_LIMIT_POLICIES: Readonly<Record<RateLimitGroup, Readonly<GroupPolicy>>> =
  POLICIES;

const limiters = new Map<RateLimitGroup, SlidingWindowLimiter>();

function getLimiter(group: RateLimitGroup): SlidingWindowLimiter {
  let limiter = limiters.get(group);
  if (!limiter) {
    const policy = POLICIES[group];
    limiter = createSlidingWindowLimiter({ windowMs: policy.windowMs, max: policy.max });
    limiters.set(group, limiter);
  }
  return limiter;
}

/**
 * 取一个名额；被拒时抛 RATE_LIMITED（→ HTTP 429 / 表单错误文案）。
 *
 * 调用点纪律：**必须放在授权判定之后**。未登录/越权请求走 401/403，
 * 不消耗任何限流名额，也不让攻击者用伪造身份污染真实用户的窗口。
 */
export function enforceRateLimit(group: RateLimitGroup, key: string): void {
  const decision = getLimiter(group).take(key);

  if (decision.allowed) {
    return;
  }

  logger.warn("触发限流", {
    group,
    key,
    retryAfterSeconds: decision.retryAfterSeconds,
  });

  throw errors.rateLimited("操作过于频繁，请稍等片刻再试。", {
    details: { retryAfterSeconds: decision.retryAfterSeconds },
  });
}

/** 仅供测试：清空全部计数器，让每个用例拿到干净的窗口。 */
export function resetRateLimiters(): void {
  limiters.clear();
}
