/**
 * AutoRefresh 退避曲线的契约测试。
 *
 * `router.refresh()` 是整页 RSC 刷新，成本高 —— 曲线的目标：
 *   1. 初始灵敏（刚提交完的任务在秒级可见）；
 *   2. 单调不减且封顶（频次断崖式下降，但不会涨到不可理喻）；
 *   3. 总覆盖窗口远超旧固定方案（审核排队 + 执行可能超过 100 秒）；
 *   4. 请求总数下降（同一覆盖窗口内刷新次数少于旧的 40 次）。
 *
 * 组件与测试共用同一个 refreshIntervalMs 实现 —— 改曲线必须连这里的断言一起改。
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_INTERVAL_MS,
  DEFAULT_MAX_INTERVAL_MS,
  DEFAULT_MAX_TICKS,
  refreshIntervalMs,
} from "@/components/documents/auto-refresh";

describe("AutoRefresh 退避曲线", () => {
  it("初始间隔保持灵敏（2.5 秒）", () => {
    expect(refreshIntervalMs(0)).toBe(2_500);
  });

  it("曲线单调不减且封顶于 30 秒", () => {
    let previous = 0;
    for (let tick = 0; tick < 30; tick += 1) {
      const interval = refreshIntervalMs(tick);
      expect(interval, `tick=${tick} 应单调不减`).toBeGreaterThanOrEqual(previous);
      expect(interval).toBeLessThanOrEqual(DEFAULT_MAX_INTERVAL_MS);
      previous = interval;
    }
    // 封顶后不再增长
    expect(refreshIntervalMs(10)).toBe(DEFAULT_MAX_INTERVAL_MS);
    expect(refreshIntervalMs(100)).toBe(DEFAULT_MAX_INTERVAL_MS);
  });

  it("负数 / 非整数 tick 不产生负值或异常（防御 Jitter 之外的误用）", () => {
    expect(refreshIntervalMs(-3)).toBe(DEFAULT_INTERVAL_MS);
    expect(refreshIntervalMs(1.5)).toBe(DEFAULT_INTERVAL_MS * 2);
  });

  it("总覆盖窗口 ≥ 5 分钟（旧固定方案 40×2.5s 只有 100 秒，审核排队常超过它）", () => {
    let total = 0;
    for (let tick = 0; tick < DEFAULT_MAX_TICKS; tick += 1) {
      total += refreshIntervalMs(tick);
    }
    expect(total).toBeGreaterThanOrEqual(300_000);
  });

  it("同一覆盖下刷新次数更省：24 次（旧方案 40 次）覆盖更久", () => {
    expect(DEFAULT_MAX_TICKS).toBeLessThan(40);

    // 与旧方案等请求次数（40 次）的退避覆盖，必须远超旧的 100 秒。
    let totalFor40Ticks = 0;
    for (let tick = 0; tick < 40; tick += 1) {
      totalFor40Ticks += refreshIntervalMs(tick);
    }
    expect(totalFor40Ticks).toBeGreaterThan(400_000);
  });
});
