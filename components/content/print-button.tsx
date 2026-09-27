"use client";

import { Icon } from "@/components/ui/icons";

/**
 * 打印本页。
 *
 * 为什么提供打印而不是"下载 PDF"：PDF 要额外生成一份文件，
 * 一旦内容更新而文件没重新生成，下载到的就是过期版本 —— 等于用一个死文件冒充资产。
 * 打印用的是当前页面的 DOM，永远不会和内容脱节。
 *
 * 打印排版的真实位置（2026-09-28 实测后修正这句注释 —— 它曾经指向一个并不存在的
 * globals.css @media print 块）：
 *   - 页眉 / 页脚 / CTA / 按钮自身：各元素上的 `print:hidden` 工具类；
 *   - 分页保护（标题不孤悬页尾、单条发现不被拦腰截断）：
 *     报告条目 `<li>` 上的 `break-inside-avoid` 与分组标题上的 `break-after-avoid`
 *     （sample-report 与 reports/[reviewId] 两处同构）。
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center justify-center gap-2 rounded-md border border-ink-200 bg-white px-4 py-2.5 text-sm font-medium text-ink-700 transition hover:border-brand-300 hover:text-brand-800"
    >
      <Icon name="printer" className="h-4 w-4" aria-hidden="true" />
      打印本页
    </button>
  );
}
