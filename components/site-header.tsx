import Link from "next/link";

import { LogoLockup } from "@/components/brand/logo";
import { siteConfig } from "@/lib/site";

/**
 * 全站公共头部。
 *
 * 三条纪律：
 *
 * 1. **只链真实存在的锚点与页面。** 这里每一个 href 都能在 `app/` 里找到对应路由，
 *    或在首页找到对应 `id`。营销站最贵的错误就是导航里挂着空路由 ——
 *    用户点进去是 404 或空白，比"少一个入口"伤得多。
 * 2. **锚点用原生 `<a>`，路由用 `<Link>`。** 锚点是同页跳转，走客户端路由没有意义，
 *    还会让浏览器丢掉平滑滚动。
 * 3. **品牌位带全称。** 简称「企智审」便于记忆，全称「企业供应商智能审核平台」
 *    保证这个搜索词在每一个公开页面上都真实出现过（SEO 与 GEO 都要求实体名称稳定）。
 */
const NAV_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/#scenarios", label: "业务场景" },
  { href: "/#rules", label: "审核规则" },
  { href: "/sample-report", label: "示例报告" },
  { href: "/templates", label: "资料核验清单" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-ink-200 bg-white/95 backdrop-blur print:hidden">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center"
          aria-label={`${siteConfig.name} 首页`}
          title={siteConfig.name}
        >
          <LogoLockup />
        </Link>

        <nav aria-label="主导航" className="flex items-center gap-1 sm:gap-2">
          {/*
            中段导航在 <lg 收起：窄屏上「四条内容入口 + 登录 + 注册」会挤成三行，
            而窄屏用户的转化路径本来就是「看首屏 → 点免费体验」。
            收起不是删掉 —— 页脚里这些入口全部还在。
          */}
          {NAV_LINKS.map((link) =>
            link.href.startsWith("/#") ? (
              <a
                key={link.href}
                href={link.href.slice(1)}
                className="hidden rounded-md px-3 py-2 text-sm font-medium text-ink-600 transition-colors hover:text-ink-900 lg:block"
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                className="hidden rounded-md px-3 py-2 text-sm font-medium text-ink-600 transition-colors hover:text-ink-900 lg:block"
              >
                {link.label}
              </Link>
            ),
          )}
          <Link
            href="/login"
            className="rounded-md px-3 py-2 text-sm font-medium text-ink-600 transition-colors hover:text-ink-900"
          >
            登录
          </Link>
          <Link
            href="/register"
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            免费体验
          </Link>
        </nav>
      </div>
    </header>
  );
}
