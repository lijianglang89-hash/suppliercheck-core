"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 解析状态轮询。
 *
 * 为什么需要它：解析是异步的，上传响应只保证「已受理」。没有轮询的话，
 * 使用者会一直看到「解析中」直到手动刷新 —— 那是界面在撒谎。
 *
 * 两处克制：
 * - 只在**确实有未完成文档**时才启动定时器（`active` 为 false 时完全不刷新）；
 * - 连续刷新若干次后自动停下，避免页面被长期开着时无休止地打数据库。
 */
export interface AutoRefreshProps {
  /** 页面上是否存在处于 UPLOADED / PROCESSING 的文档。 */
  active: boolean;
  intervalMs?: number;
  /** 最多刷新多少次后停止。 */
  maxTicks?: number;
}

export function AutoRefresh({ active, intervalMs = 2500, maxTicks = 40 }: AutoRefreshProps) {
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

    const timer = setTimeout(() => {
      setTicks((value) => value + 1);
      router.refresh();
    }, intervalMs);

    return () => clearTimeout(timer);
  }, [active, intervalMs, maxTicks, router, ticks]);

  if (!active) return null;

  return (
    <p className="text-xs text-ink-500" role="status" aria-live="polite">
      有资料正在解析，页面会自动刷新
      {ticks >= maxTicks ? "（已停止自动刷新，请手动刷新页面）" : ""}
    </p>
  );
}
