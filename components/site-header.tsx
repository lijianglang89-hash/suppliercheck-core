import Link from "next/link";

import { siteConfig } from "@/lib/site";

/**
 * 全站公共头部。
 * 用真实的 <nav> + <a>/<Link>，保证爬虫可以顺着链接发现公开页面。
 */
export function SiteHeader() {
  return (
    <header className="border-b border-ink-200 bg-white">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-baseline gap-2" aria-label={`${siteConfig.name} 首页`}>
          <span className="text-lg font-semibold tracking-tight text-ink-900">{siteConfig.name}</span>
          <span className="hidden text-xs font-medium uppercase tracking-widest text-ink-400 sm:inline">
            {siteConfig.latinName}
          </span>
        </Link>

        <nav aria-label="主导航" className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/login"
            className="rounded-md px-3 py-2 text-sm font-medium text-ink-600 hover:text-ink-900"
          >
            登录
          </Link>
          <Link
            href="/register"
            className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800"
          >
            免费体验
          </Link>
        </nav>
      </div>
    </header>
  );
}
