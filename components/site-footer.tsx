import Link from "next/link";

import { siteConfig } from "@/lib/site";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-ink-200 bg-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-start sm:justify-between">
        <div>
          {/* 页脚同时给出品牌名与全称：品牌在上面，全称作为正式产品名紧随其后。 */}
          <p className="text-sm font-semibold text-ink-800">
            {siteConfig.shortName}
            <span className="ml-2 text-xs font-medium uppercase tracking-widest text-ink-400">
              {siteConfig.latinName}
            </span>
          </p>
          <p className="mt-1 text-xs text-ink-500">{siteConfig.name}</p>
          <p className="mt-2 max-w-md text-sm leading-6 text-ink-500">{siteConfig.tagline}</p>
        </div>

        <nav aria-label="页脚导航" className="flex flex-col gap-2 text-sm">
          <Link href="/" className="text-ink-600 hover:text-ink-900">
            产品首页
          </Link>
          <Link href="/login" className="text-ink-600 hover:text-ink-900">
            登录
          </Link>
          <Link href="/register" className="text-ink-600 hover:text-ink-900">
            免费体验
          </Link>
        </nav>
      </div>

      <div className="border-t border-ink-100">
        <div className="mx-auto w-full max-w-6xl px-6 py-4">
          <p className="text-xs text-ink-400">
            © {year} {siteConfig.name}（{siteConfig.latinName}）· V0.3
          </p>
        </div>
      </div>
    </footer>
  );
}
