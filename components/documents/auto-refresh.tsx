"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 解析 / 审核状态轮询。
 *
 * 为什么需要它：解析与审核是异步的，响应只保证「已受理」。没有轮询的话，
 * 使用者会一直看到「解析中」直到手动刷新 —— 那是界面在撒谎。
 *
 * 为什么用指数退避而不是固定间隔：`router.refresh()` 是**整页 RSC 刷新**
 * （重跑页面组件 + 列表查询），比普通 API 轮询贵。固定 2.5 秒打满全程，
 * 既浪费服务器，总覆盖又只有 100 秒 —— 审核在串行队列里排队时常常超过它，
 * 结果是刷新停了、任务还在跑，使用者被迫手动刷新。
 *
 * 退避曲线一举两得：前几十秒保持灵敏（解析/审核大概率在这段时间完成），
 * 随后频次断崖式下降，总覆盖窗口拉长到 10 分钟量级 ——
 * 请求更少、跟进更久，不是 trade-off，是同一刀的两面。
 *
 * Jitter（±15%）：多个浏览器标签页几乎同时打开时，退避会把它们的刷新
 * 时间聚在一起；每 tick 随机抖动一次，避免刷新请求整齐地同时到达。
 *
 * 三处克制：
 * - 只在**确实有未完成文档/任务**时才启动定时器（`active` 为 false 时不刷新）；
 * - 曲线上限封顶，不会涨到不可理喻的间隔；
 * - 到达次数上限后自动停下并告知使用者，绝不无休止地刷新。
 */

/** 初始刷新间隔：保持「刚提交完」阶段的灵敏。 */
export const DEFAULT_INTERVAL_MS = 2_500;
/** 退避上限：再久也至少每 30 秒看一眼。 */
export const DEFAULT_MAX_INTERVAL_MS = 30_000;
/** 最多刷新次数。24 次 × 退避曲线 ≈ 10 分钟总覆盖（旧固定方案 40 次只有 100 秒）。 */
export const DEFAULT_MAX_TICKS = 24;

/**
 * 第 `tick` 次刷新前的等待时长：每 tick 翻倍，封顶于 `capMs`。
 *
 * 序列（默认值）：2.5s → 5s → 10s → 20s → 30s → 30s → …
 * 导出为纯函数是为了让单测钉死曲线契约（初始灵敏、单调不减、封顶、总覆盖），
 * 组件与测试共用同一实现 —— 改曲线必须连测试一起改。
 */
export function refreshIntervalMs(
  tick: number,
  baseMs: number = DEFAULT_INTERVAL_MS,
  capMs: number = DEFAULT_MAX_INTERVAL_MS,
): number {
  const backoff = baseMs * 2 ** Math.max(0, Math.floor(tick));
  return Math.min(capMs, backoff);
}

export interface AutoRefreshProps {
  /** 页面上是否存在处于 UPLOADED / PROCESSING 的文档（或 RUNNING 的审核）。 */
  active: boolean;
  /** 初始刷新间隔（退避起点）。 */
  intervalMs?: number;
  /** 退避上限。 */
  maxIntervalMs?: number;
  /** 最多刷新多少次后停止。 */
  maxTicks?: number;
}

export function AutoRefresh({
  active,
  intervalMs = DEFAULT_INTERVAL_MS,
  maxIntervalMs = DEFAULT_MAX_INTERVAL_MS,
  maxTicks = DEFAULT_MAX_TICKS,
}: AutoRefreshProps) {
  const router = useRouter();
  const [ticks, setTicks] = useState(0);
  const [lastActive, setLastActive] = useState(active);

  /**
   * 状态变化后重新开始计数，让新上传的文件同样能被跟进。
   *
   * 这里刻意**不用 useEffect + setTicks(0)**：那会在 effect 里同步 setState，
   * 触发一次多余的级联渲染。React 官方推荐在渲染期间比较并直接调整状态 ——
   * React 会立即用新状态重跑本次渲染，不提交中间结果。
   */
  if (lastActive !== active) {
    setLastActive(active);
    setTicks(0);
  }

  useEffect(() => {
    if (!active) return;
    if (ticks >= maxTicks) return;

    const interval = refreshIntervalMs(ticks, intervalMs, maxIntervalMs);
    // ±15% 抖动：多标签页同时打开时避免刷新请求聚集在同一时刻。
    const jittered = Math.round(interval * (1 + (Math.random() * 0.3 - 0.15)));

    const timer = setTimeout(() => {
      setTicks((value) => value + 1);
      router.refresh();
    }, jittered);

    return () => clearTimeout(timer);
  }, [active, intervalMs, maxIntervalMs, maxTicks, router, ticks]);

  if (!active) return null;

  return (
    <p className="text-xs text-ink-500" role="status" aria-live="polite">
      有任务正在进行，页面会自动刷新
      {ticks >= maxTicks ? "（已停止自动刷新，请手动刷新页面）" : ""}
    </p>
  );
}
