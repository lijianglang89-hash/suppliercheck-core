import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ConversionCta } from "@/components/content/conversion-cta";
import { PrintButton } from "@/components/content/print-button";
import { SiteBreadcrumb } from "@/components/site-breadcrumb";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Icon } from "@/components/ui/icons";
import { CHECKLIST_TEMPLATES, findChecklistTemplate } from "@/lib/content/checklist-templates";
import { BUILTIN_TEMPLATES } from "@/lib/templates/builtin";
import { CATEGORY_LABELS, CATEGORY_ORDER, SEVERITY_BADGE_CLASS, SEVERITY_LABELS } from "@/lib/reviews/labels";
import { REVIEW_RULES } from "@/lib/reviews/rules";
import { getSiteUrl, siteConfig } from "@/lib/site";

export function generateStaticParams() {
  return CHECKLIST_TEMPLATES.map((template) => ({ slug: template.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const template = findChecklistTemplate(slug);
  if (!template) return {};

  const canonical = `/templates/${template.slug}`;
  return {
    title: template.title,
    description: template.summary,
    // ⚠️ canonical 必须指向自身。内容页一旦指向首页，等于告诉搜索引擎
    // 「这页是首页的副本」，自己把自己降权。
    alternates: { canonical },
    openGraph: {
      type: "article",
      url: canonical,
      title: template.title,
      description: template.summary,
      publishedTime: template.updatedAt,
      modifiedTime: template.updatedAt,
      images: [{ url: "/og-image.png", width: 1200, height: 630, alt: template.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: template.title,
      description: template.summary,
      images: ["/og-image.png"],
    },
  };
}

export default async function ChecklistTemplatePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const template = findChecklistTemplate(slug);
  if (!template) notFound();

  const siteUrl = getSiteUrl();
  const pageUrl = new URL(`/templates/${template.slug}`, siteUrl).toString();

  /*
   * 结构化数据：Article + BreadcrumbList。
   *
   * 刻意**不做** HowTo / FAQPage：
   * Google 对这两类的要求是「标注的每一步/每一问必须在页面上真实可见」，
   * 而我们只有 Article 与面包屑能一一对应 DOM，硬套 HowTo 属于结构化数据作弊，
   * 轻则不展现、重则整站降权。宁可少标一类，也不标没影的东西。
   */
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: template.title,
        description: template.summary,
        inLanguage: "zh-CN",
        datePublished: template.updatedAt,
        dateModified: template.updatedAt,
        mainEntityOfPage: { "@type": "WebPage", "@id": pageUrl },
        author: { "@type": "Organization", name: siteConfig.name, url: siteUrl },
        publisher: {
          "@type": "Organization",
          name: siteConfig.name,
          url: siteUrl,
          logo: { "@type": "ImageObject", url: new URL("/icon-512.png", siteUrl).toString() },
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "首页", item: siteUrl },
          { "@type": "ListItem", position: 2, name: "资料核验清单", item: new URL("/templates", siteUrl).toString() },
          { "@type": "ListItem", position: 3, name: template.title, item: pageUrl },
        ],
      },
    ],
  };

  const requiredCount = template.items.filter((item) => item.required).length;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main id="main" className="flex-1">
        <article className="mx-auto w-full max-w-3xl px-6 py-12 lg:py-16">
          <SiteBreadcrumb
            items={[
              { label: "首页", href: "/" },
              { label: "资料核验清单", href: "/templates" },
              { label: template.title },
            ]}
          />

          {/* ---------------- Hero：标题 + 摘要 + 两个真实动作 ---------------- */}
          <header className="mt-5">
            <h1 className="text-[clamp(1.75rem,3.2vw,2.6rem)] font-bold leading-[1.2] tracking-tight text-ink-900">
              {template.title}
            </h1>
            <p className="mt-4 text-sm leading-7 text-ink-600">{template.summary}</p>

            <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
              <span>{template.audience}</span>
              <span>·</span>
              <span>
                {template.items.length} 项资料（必备 {requiredCount}）
              </span>
              <span>·</span>
              <span>更新于 {template.updatedAt}</span>
            </p>

            {/*
              下载按钮指向**真实存在的 CSV**（由同一份数据生成，见 checklist.csv/route.ts）。
              绝不放一个"下载 PDF"的假按钮：点了没反应或下到空文件，比没有按钮更伤信任。
            */}
            <div className="mt-7 flex flex-wrap items-center gap-3 print:hidden">
              <a
                href={`/templates/${template.slug}/checklist.csv`}
                download
                className="inline-flex items-center justify-center gap-2 rounded-md bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-800"
              >
                <Icon name="download" className="h-4 w-4" aria-hidden="true" />
                下载清单（CSV，Excel 可打开）
              </a>
              <PrintButton />
            </div>
          </header>

          {/* ---------------- 开篇 ---------------- */}
          <section className="mt-10 space-y-3">
            {template.intro.map((paragraph) => (
              <p key={paragraph} className="text-sm leading-7 text-ink-700">
                {paragraph}
              </p>
            ))}
          </section>

          {/* ---------------- 清单正文：SEO 抓取的核心文本 ---------------- */}
          <div className="mt-12 space-y-10">
            {template.items.map((item, index) => (
              <section key={item.key} aria-labelledby={`item-${item.key}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <h2
                    id={`item-${item.key}`}
                    className="text-lg font-semibold tracking-tight text-ink-900"
                  >
                    {index + 1}. {item.name}
                  </h2>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                      item.required
                        ? "bg-brand-50 text-brand-700"
                        : "bg-ink-100 text-ink-600"
                    }`}
                  >
                    {item.required ? "必备" : "选备"}
                  </span>
                </div>

                <p className="mt-2 text-sm leading-7 text-ink-700">{item.why}</p>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="card-soft p-4">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-800">
                      <Icon name="check" className="h-3.5 w-3.5 text-brand-700" aria-hidden="true" />
                      查验要点
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {item.check.map((point) => (
                        <li key={point} className="text-xs leading-6 text-ink-700">
                          {point}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="card-soft p-4">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-800">
                      <Icon
                        name="alert-triangle"
                        className="h-3.5 w-3.5 text-warning-600"
                        aria-hidden="true"
                      />
                      常见雷区
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {item.pitfalls.map((point) => (
                        <li key={point} className="text-xs leading-6 text-ink-700">
                          {point}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-400">
                  <span>对应规则：</span>
                  {item.ruleIds.map((ruleId) => (
                    <span
                      key={ruleId}
                      className="rounded bg-ink-100 px-1.5 py-0.5 text-ink-600"
                    >
                      {ruleLabelOf(ruleId)}
                    </span>
                  ))}
                </p>
              </section>
            ))}
          </div>

          {/* ---------------- 全部核对规则（来自代码，不复制文案） ---------------- */}
          <section aria-labelledby="rules-heading" className="mt-14">
            <h2
              id="rules-heading"
              className="text-lg font-semibold tracking-tight text-ink-900"
            >
              {REVIEW_RULES.length} 条核对规则
            </h2>
            <p className="mt-2 text-sm leading-7 text-ink-600">
              以下是 {siteConfig.shortName} 实际执行的全部规则，按检查维度分组；
              上面的每一项资料都会落到其中一条或几条上。
            </p>

            <div className="mt-6 space-y-6">
              {CATEGORY_ORDER.map((category) => {
                const rules = REVIEW_RULES.filter((rule) => rule.category === category);
                if (rules.length === 0) return null;
                return (
                  <div key={category}>
                    <h3 className="text-sm font-semibold text-ink-800">
                      {CATEGORY_LABELS[category]}
                    </h3>
                    <ul className="mt-2 divide-y divide-ink-100 border-y border-ink-100">
                      {rules.map((rule) => (
                        <li key={rule.id} className="py-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-ink-900">{rule.label}</span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${SEVERITY_BADGE_CLASS[rule.defaultSeverity]}`}
                            >
                              {SEVERITY_LABELS[rule.defaultSeverity]}
                            </span>
                          </div>
                          <p className="mt-1 text-xs leading-6 text-ink-600">{rule.description}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ---------------- 定性原则 ---------------- */}
          <section aria-labelledby="closing-heading" className="mt-14">
            <h2 id="closing-heading" className="text-lg font-semibold tracking-tight text-ink-900">
              验出问题怎么定性
            </h2>
            <div className="mt-4 space-y-3">
              {template.closing.map((paragraph) => (
                <p
                  key={paragraph}
                  className="border-l-2 border-brand-300 pl-3 text-sm leading-7 text-ink-700"
                >
                  {paragraph}
                </p>
              ))}
            </div>

            <p className="mt-6 text-xs leading-6 text-ink-500">
              这份清单对应产品内置的「{builtinTemplateName(template.builtinTemplateKey)}」审核模板，
              在 {siteConfig.shortName} 里选择该模板发起审核即按上述范围执行。
            </p>
          </section>

          <ConversionCta />

          <p className="mt-8 text-xs text-ink-400">
            其他清单：
            <Link href="/templates" className="ml-1 text-brand-700 hover:underline">
              资料核验清单
            </Link>
          </p>
        </article>
      </main>
      <SiteFooter />

      {/*
        结构化数据只能这样注入。内容全部来自本仓库常量（无外部输入），
        不存在把用户输入拼进 <script> 的注入面。
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </div>
  );
}

/** 规则标签从代码取，页面不复制一份文案（改名会同步）。 */
function ruleLabelOf(ruleId: string): string {
  return REVIEW_RULES.find((rule) => rule.id === ruleId)?.label ?? ruleId;
}

/** 内置模板名同样从代码取；key 写错时直接把 key 显示出来，便于发现而不是静默空白。 */
function builtinTemplateName(key: string): string {
  return BUILTIN_TEMPLATES.find((template) => template.key === key)?.name ?? key;
}
