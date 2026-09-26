import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "页面不存在（404）",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-20">
        <p className="text-sm font-medium text-brand-600">404</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink-900">页面不存在</h1>
        <p className="mt-4 text-base leading-7 text-ink-600">
          你访问的地址可能已经变更或从未存在。可以返回首页，或直接进入登录页。
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/"
            className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800"
          >
            返回首页
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-ink-300 bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            前往登录
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
