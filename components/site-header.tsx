import Link from "next/link";

import { LogoLockup } from "@/components/brand/logo";
import { siteConfig } from "@/lib/site";

/**
 * 全站公共头部。
 * 用真实的 <nav> + <a>/<Link>，保证爬虫可以顺着链接发现公开页面。
 */
export function SiteHeader() {
  return (
    <header className="border-b border-ink-200 bg-white">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        {/*
          品牌用简称，全称留给 SEO 与正式描述（见 docs/DESIGN.md §1）。
          全称 10 个字，放在 Logo 位会挤掉整条导航；简称更容易形成品牌记忆。
          全称并没有消失 —— aria-label、title、footer、SEO 里都还在。
        */}
        <Link
          href="/"
          className="flex items-center"
          aria-label={`${siteConfig.name} 首页`}
          title={siteConfig.name}
        >
          <LogoLockup />
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
