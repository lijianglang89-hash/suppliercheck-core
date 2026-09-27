"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * 入场动效（Scroll Reveal）：元素滚入视口时轻微上浮并淡入。
 *
 * 为什么自己做而不用动画库：整个站点需要的只是这一种
 * `opacity-0 translate-y-4 → opacity-100 translate-y-0` 的 700ms 过渡，
 * 引一个库为这一个动效不值；而且这里用 IntersectionObserver + disconnect，
 * 元素只播一次、播完零开销（不会持续占用观察者）。
 *
 * 可达性：`motion-reduce:` 变体在 prefers-reduced-motion 下直接禁用过渡 ——
 * 有前庭敏感的用户不该被迫看动效。
 */
export function Reveal({
  children,
  className = "",
  delayMs = 0,
}: {
  children: ReactNode;
  className?: string;
  /** 级联延迟（毫秒）。同一区块内的多个元素错开入场，比齐刷刷一起动更有层次。 */
  delayMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={delayMs > 0 ? { transitionDelay: `${delayMs}ms` } : undefined}
      className={`transition-all duration-700 ease-out motion-reduce:transition-none motion-reduce:transform-none ${
        visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      } ${className}`}
    >
      {children}
    </div>
  );
}
