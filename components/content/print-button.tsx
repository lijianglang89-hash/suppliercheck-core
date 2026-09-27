"use client";

import { Icon } from "@/components/ui/icons";

/**
 * 打印本页。
 *
 * 为什么提供打印而不是"下载 PDF"：PDF 要额外生成一份文件，
 * 一旦内容更新而文件没重新生成，下载到的就是过期版本 —— 等于用一个死文件冒充资产。
 * 打印用的是当前页面的 DOM，永远不会和内容脱节（打印样式见 globals.css @media print）。
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
