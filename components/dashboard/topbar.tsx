"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon } from "@/components/ui/icons";
import { NAV_SECTIONS } from "@/lib/navigation";

/**
 * 顶栏左半区：面包屑 + 全局主行动按钮。
 *
 * 顶栏是每个页面最值钱的一条横带 —— 之前只放了用户名和退出登录，
 * 现在面包屑回答「我在哪」，主行动按钮回答「我下一步去哪」。
 * 用户的完整路径是 上传 → 发起审核 → 看报告，两个按钮按当前页面
 * 智能出现：已经在 /documents 就不再显示「上传资料」。
 *
 * 客户端组件的唯一原因：需要 `usePathname()`。
 */
const TITLE_BY_PREFIX: ReadonlyMap<string, string> = new Map(
  NAV_SECTIONS.flatMap((section) => section.items).map((item) => [item.href, item.label]),
);

export function Topbar({ workspaceName }: { workspaceName: string }) {
  const pathname = usePathname() ?? "";

  const segments = pathname.split("/").filter(Boolean);
  const sectionHref = segments.length > 0 ? `/${segments[0]}` : "";
  const sectionTitle = TITLE_BY_PREFIX.get(sectionHref) ?? "";
  const isDetail = segments.length > 1;

  return (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
      <nav aria-label="所在位置" className="flex min-w-0 items-center gap-1.5 text-sm">
        <span className="truncate text-ink-400">{workspaceName}</span>
        {sectionTitle ? (
          <>
            <span className="text-ink-300">/</span>
            <span className={isDetail ? "truncate text-ink-400" : "truncate font-medium text-ink-800"}>
              {sectionTitle}
            </span>
          </>
        ) : null}
        {isDetail ? (
          <>
            <span className="text-ink-300">/</span>
            <span className="truncate font-medium text-ink-800">详情</span>
          </>
        ) : null}
      </nav>

      <div className="flex shrink-0 items-center gap-2">
        {showUpload(pathname) ? (
          <Link
            href="/documents"
            className="flex items-center gap-1.5 rounded-md border border-ink-300 bg-white px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            <Icon name="upload" className="h-4 w-4" />
            上传资料
          </Link>
        ) : null}
        {showReview(pathname) ? (
          <Link
            href="/reviews"
            className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800"
          >
            <Icon name="clipboard" className="h-4 w-4" />
            发起审核
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** 当前位置是否还应该显示「上传资料」入口。 */
function showUpload(pathname: string): boolean {
  if (pathname.startsWith("/documents") || pathname.startsWith("/reviews")) return false;
  // 报告与详情页是「看结果」的场景，主行动是回去核对，不是再传文件。
  if (pathname.startsWith("/reports") || pathname.startsWith("/settings")) return false;
  return true;
}

/** 当前位置是否还应该显示「发起审核」入口。 */
function showReview(pathname: string): boolean {
  return !pathname.startsWith("/reviews") && !pathname.startsWith("/settings");
}
