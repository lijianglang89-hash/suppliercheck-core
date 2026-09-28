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
 * ⚠️ **初始状态必须是「可见」，JS 水合后才把视口外的元素藏起来。**
 * 曾经初始值是 `opacity-0`：禁用 JS 的访问者（以及不执行交互的抓取器）
 * 拿到的 HTML 里这些区块永久隐形 —— 内容在 DOM 里却看不见，等于没写。
 * 改成「SSR 可见 → 水合时只藏首屏之外的元素」后：
 *   - 无 JS：全部内容照常可见；
 *   - 有 JS：首屏之下的元素照常播入场动画（本站所有 Reveal 都在首屏之下，
 *     hero 不包 Reveal，所以这个改动没有可感知的视觉差异）。
 *
 * 可达性：`motion-reduce:` 变体在 prefers-reduced-motion 下直接禁用过渡。
 * 注意 Tailwind v4 的 `translate-y-*` 走 CSS `translate` 属性而不是 `transform`，
 * 所以必须用 `motion-reduce:translate-none` —— `transform-none` 管不到它（实测踩过）。
 */
export function Reveal({
  children,
  className = "",
  delayMs = 0,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  /** 级联延迟（毫秒）。同一区块内的多个元素错开入场，比齐刷刷一起动更有层次。 */
  delayMs?: number;
  /**
   * 渲染成什么标签。**在列表里必须传 `as="li"`。**
   *
   * 默认渲染 `<div>`，于是 `<ul>{items.map(() => <Reveal><li>…</li></Reveal>)}</ul>`
   * 会产出 `<ul><div><li>` —— 非法嵌套：浏览器照样渲染，所以没人会发现，
   * 但列表语义已经断了（读屏软件不再按「N 项中的第 M 项」报读）。
   * 这种错在视觉复查里永远查不出来，只能从用法上堵住。
   */
  as?: "div" | "li";
}) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 首帧已在视口内的元素保持可见、不参与入场（避免水合闪烁）。
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) return;
    setVisible(false);
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
    <Tag
      ref={ref as never}
      style={delayMs > 0 ? { transitionDelay: `${delayMs}ms` } : undefined}
      className={`transition-all duration-700 ease-out motion-reduce:transition-none motion-reduce:translate-none ${
        visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      } ${className}`}
    >
      {children}
    </Tag>
  );
}
