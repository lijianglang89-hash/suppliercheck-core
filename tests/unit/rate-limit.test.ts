/**
 * 滑动窗口限流器的单元测试（假时钟，全确定性）。
 *
 * 核心契约：
 * 1. 窗口内最多放行 max 次，第 max+1 次拒绝并给出 Retry-After；
 * 2. Retry-After = 最老一条记录走出窗口的秒数（向上取整，至少 1）；
 * 3. 窗口滑动：时间推过后额度如数恢复；
 * 4. 被拒绝的请求不占名额 —— 重试者按 Retry-After 节奏推进不会被越推越远；
 * 5. key 之间完全隔离；
 * 6. key 总数到达上限时驱逐最老的 key（防计数器本身被撑爆）。
 */
import { describe, expect, it } from "vitest";

import { createSlidingWindowLimiter } from "@/lib/rate-limit/limiter";

/** 可手动推进的假时钟。 */
function makeClock() {
  const state = { now: 0 };
  return {
    now: () => state.now,
    advance(ms: number) {
      state.now += ms;
    },
  };
}

describe("滑动窗口限流器", () => {
  it("窗口内放行 max 次，remaining 递减；第 max+1 次拒绝", () => {
    const limiter = createSlidingWindowLimiter({ windowMs: 60_000, max: 3 });

    expect(limiter.take("k")).toMatchObject({ allowed: true, remaining: 2 });
    expect(limiter.take("k")).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.take("k")).toMatchObject({ allowed: true, remaining: 0 });

    const denied = limiter.take("k");
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("Retry-After 精确到窗口剩余毫秒向上取整", () => {
    const clock = makeClock();
    const limiter = createSlidingWindowLimiter({ windowMs: 60_000, max: 2, now: clock.now });

    limiter.take("k"); // t=0 记录第一条
    clock.advance(1_000);
    limiter.take("k"); // t=1000 记录第二条
    clock.advance(1_000);

    const denied = limiter.take("k"); // t=2000
    // 最老记录在 t=0，走出窗口的时刻是 t=60000，还需等 58 秒。
    expect(denied).toMatchObject({ allowed: false, retryAfterSeconds: 58 });
  });

  it("窗口滑动：最老记录过期后额度恢复", () => {
    const clock = makeClock();
    const limiter = createSlidingWindowLimiter({ windowMs: 60_000, max: 2, now: clock.now });

    limiter.take("k");
    limiter.take("k");
    expect(limiter.take("k").allowed).toBe(false);

    clock.advance(60_001); // t=0 的记录已出窗
    expect(limiter.take("k")).toMatchObject({ allowed: true, remaining: 1 });
  });

  it("被拒绝的请求不占名额：按 Retry-After 等待后必然放行", () => {
    const clock = makeClock();
    const limiter = createSlidingWindowLimiter({ windowMs: 60_000, max: 1, now: clock.now });

    expect(limiter.take("k").allowed).toBe(true);

    // 在窗口内反复被拒 —— 这些尝试不消耗任何东西。
    for (let i = 0; i < 5; i += 1) {
      expect(limiter.take("k").allowed).toBe(false);
    }

    clock.advance(60_000); // 恰好走出窗口
    expect(limiter.take("k")).toMatchObject({ allowed: true, remaining: 0 });
  });

  it("key 之间完全隔离", () => {
    const limiter = createSlidingWindowLimiter({ windowMs: 60_000, max: 1 });

    expect(limiter.take("userA:wsA").allowed).toBe(true);
    expect(limiter.take("userA:wsA").allowed).toBe(false);

    // 别人的额度一丝一毫都不受影响。
    expect(limiter.take("userB:wsB")).toMatchObject({ allowed: true, remaining: 0 });
  });

  it("key 数到达上限时驱逐最老的 key（防御计数器本身被撑爆）", () => {
    const limiter = createSlidingWindowLimiter({ windowMs: 60_000, max: 1, maxKeys: 2 });

    limiter.take("first");
    limiter.take("second");
    expect(limiter.trackedKeys).toBe(2);

    limiter.take("third"); // first 被驱逐
    expect(limiter.trackedKeys).toBe(2);

    // first 重新变成全新 key（额度满血）—— 这正是驱逐的语义。
    expect(limiter.take("first")).toMatchObject({ allowed: true, remaining: 0 });
  });

  it("非法配置直接抛错（不留静默失效的限流器）", () => {
    expect(() => createSlidingWindowLimiter({ windowMs: 0, max: 10 })).toThrow();
    expect(() => createSlidingWindowLimiter({ windowMs: 60_000, max: 0 })).toThrow();
    expect(() => createSlidingWindowLimiter({ windowMs: 60_000, max: 1.5 })).toThrow();
  });
});
