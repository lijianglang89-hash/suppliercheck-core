import type { Metadata } from "next";
import Link from "next/link";

import { SiteBreadcrumb } from "@/components/site-breadcrumb";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Icon } from "@/components/ui/icons";
import { CHECKLIST_TEMPLATES } from "@/lib/content/checklist-templates";
import { REVIEW_RULES } from "@/lib/reviews/rules";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "资料核验清单",
  description:
    "可直接在供应商准入、资质年审、比价环节使用的资料核验清单：收哪些资料、每项怎么验、常见问题怎么定性，每条都对应一条可执行的核对规则。",
  alternates: { canonical: "/templates" },
};

/**
 * 模板中心（公开内容页的索引）。
 *
 * ⚠️ 这里只列**真实存在的内容页**。清单数量由数据模块决定，不写死 ——
 * 加一篇内容 = 在 lib/content/checklist-templates.ts 加一条，索引、sitemap、
 * JSON-LD 自动跟上，不会出现「索引里有、点进去 404」这种断链。
 */
export default function TemplatesIndexPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main id="main" className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-6 py-12 lg:py-16">
          <SiteBreadcrumb items={[{ label: "首页", href: "/" }, { label: "资料核验清单" }]} />

          <h1 className="mt-5 text-[clamp(1.75rem,3.2vw,2.5rem)] font-bold leading-[1.2] tracking-tight text-ink-900">
            资料核验清单
          </h1>
          <p className="mt-4 text-sm leading-7 text-ink-600">
            每一份清单都写明：要收哪些资料、每项验到什么程度、验出问题怎么定性。
            清单里的核对规则与 {siteConfig.shortName} 实际执行的 {REVIEW_RULES.length}{" "}
            条规则是同一份定义 —— 看完清单就知道系统会查什么。
          </p>

          <ul className="mt-10 space-y-4">
            {CHECKLIST_TEMPLATES.map((template) => (
              <li key={template.slug}>
                <Link
                  href={`/templates/${template.slug}`}
                  className="card block p-6 transition hover:border-brand-300 hover:shadow-[0_8px_24px_rgba(23,44,70,0.08)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold text-ink-900">{template.title}</h2>
                      <p className="mt-2 text-sm leading-6 text-ink-600">{template.summary}</p>
                      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
                        <span>{template.audience}</span>
                        <span>·</span>
                        <span>{template.items.length} 项资料</span>
                        <span>·</span>
                        <span>更新于 {template.updatedAt}</span>
                      </p>
                    </div>
                    <Icon
                      name="arrow-right"
                      className="mt-1 h-4 w-4 shrink-0 text-brand-700"
                      aria-hidden="true"
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
