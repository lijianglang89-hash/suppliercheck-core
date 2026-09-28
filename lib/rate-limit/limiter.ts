/**
 * 进程内滑动窗口限流器。
 *
 * 为什么是内存、为什么不是 Redis：
 * 生产是**单容器单进程**部署（docker-compose 只有一个 app），进程内计数器
 * 就是全局真相。引入外部限流存储在这台 ~1.5GB 可用内存的 ECS 上是负资产 ——
 * 多一次网络往返、多一个要运维的组件，换不来任何单机场景下的正确性。
 * 若未来横向扩到多实例，本文件整体替换成集中式实现即可，调用方接口不变。
 *
 * 为什么是滑动窗口而不是固定窗口：
 * 固定窗口在窗口边界允许 2 倍突发（上一窗口末尾 + 下一窗口开头），
 * 而我们要保护的恰恰是「连续高频」这个形态。滑动窗口按时间戳精确计数，
 * 没有边界突口。
 *
 * 内存纪律：
 * - 每个 key 只存窗口内的秒级时间戳，过期即剪枝，空 key 即删除；
 * - key 总数有硬上限（maxKeys），超限按插入顺序驱逐最老的 —— 防御
 *   「攻击者构造海量 key 把计数器本身撑爆」这种以子之矛攻子之盾的打法。
 *
 * 取号的语义（刻意为之）：
 * **被拒绝的请求不占用名额。** take() 只在放行时记录时间戳 ——
 * 限流的目的是限制「成功消耗资源的操作速率」，而不是惩罚重试本身；
 * 这让客户端可以按 Retry-After 的节奏重试而不会越试越远。
 */
export interface SlidingWindowLimiterOptions {
  /** 窗口长度（毫秒）。 */
  windowMs: number;
  /** 窗口内允许的最大操作数。 */
  max: number;
  /**
   * key 数量上限。超过后按插入顺序驱逐最老的 key。
   * 正常业务 key = 用户+工作区，数量有限；这个上限纯粹是防御性兜底。
   */
  maxKeys?: number;
  /** 时钟注入点。生产用 Date.now，测试注入假时钟获得确定性。 */
  now?: () => number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** 放行时：本窗口还剩多少次。拒绝时为 0。 */
  remaining: number;
  /** 拒绝时：建议等待秒数（向上取整，至少 1）。放行时为 0。 */
  retryAfterSeconds: number;
}

const DEFAULT_MAX_KEYS = 10_000;

export interface SlidingWindowLimiter {
  /** 对 key 取一个名额。返回放行/拒绝判定。 */
  take(key: string): RateLimitDecision;
  /** 诊断用：当前跟踪的 key 数。 */
  readonly trackedKeys: number;
}

export function createSlidingWindowLimiter(
  options: SlidingWindowLimiterOptions,
): SlidingWindowLimiter {
  const windowMs = options.windowMs;
  const max = options.max;
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  const now = options.now ?? (() => Date.now());

  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("windowMs 必须是正数。");
  }
  if (!Number.isInteger(max) || max <= 0) {
    throw new Error("max 必须是正整数。");
  }

  // Map 的迭代顺序 = 插入顺序，正好用来做「驱逐最老 key」。
  const buckets = new Map<string, number[]>();

  return {
    take(key: string): RateLimitDecision {
      const current = now();
      const windowStart = current - windowMs;

      // 达到 key 上限时先驱逐最老的，保证本次写入一定有位置。
      if (!buckets.has(key) && buckets.size >= maxKeys) {
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) {
          buckets.delete(oldest);
        }
      }

      const timestamps = (buckets.get(key) ?? []).filter((t) => t > windowStart);

      if (timestamps.length >= max) {
        // 最老一条记录走出窗口的时刻，就是本 key 重新可用的时候。
        const retryAfterMs = timestamps[0] + windowMs - current;
        const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
        // 拒绝不记录时间戳（见文件头「取号的语义」），但要刷新插入顺序，
        // 让活跃 key 排在驱逐队列的后面。
        buckets.delete(key);
        buckets.set(key, timestamps);
        return { allowed: false, remaining: 0, retryAfterSeconds };
      }

      timestamps.push(current);
      buckets.delete(key);
      buckets.set(key, timestamps);

      return {
        allowed: true,
        remaining: max - timestamps.length,
        retryAfterSeconds: 0,
      };
    },

    get trackedKeys(): number {
      return buckets.size;
    },
  };
}
