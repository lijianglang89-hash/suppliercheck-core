import type { Metadata } from "next";
import Link from "next/link";

import { FileStack, FlowArrow, ResultPanel } from "@/components/landing/visuals";
import { ReportSection } from "@/components/landing/report-section";
import {
  BeforeAfterSection,
  CapabilitiesSection,
  FinalCtaSection,
  MetricsSection,
  SecuritySection,
  WorkflowSection,
} from "@/components/landing/sections";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getSiteUrl, siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: `${siteConfig.shortName}｜${siteConfig.name}`,
  description: siteConfig.description,
  alternates: { canonical: "/" },
};

const FAQS: ReadonlyArray<{ question: string; answer: string }> = [
  {
    question: "供应商智审是做什么的？",
    answer:
      "供应商智审（SupplierCheck）是一个在线工具：上传供应商资料包后，系统自动识别文件、提取关键信息，检查资料完整性、证照有效期以及主体信息与产品资质的一致性，最后生成审核报告。",
  },
  {
    question: "支持哪些文件格式？",
    answer:
      "已支持 PDF、Word（DOCX）、Excel（XLSX）、图片（PNG / JPG）以及 ZIP 压缩包：上传后自动提取正文，再交给审核引擎逐条核对。",
  },
  {
    question: "审核结论是怎么得出的？",
    answer:
      "由 15 条确定性规则逐条核对得出，每条发现都标注规则、所在文件与原文摘录。同一份资料跑两次结果一致。当前未启用模型复核，因此不会出现无法复算的判断。",
  },
  {
    question: "系统会替我判断供应商是否合格吗？",
    answer:
      "不会。系统只负责找出可疑点并给出证据，是否合格由审核员决定。涉及资质挂靠、母子公司协同这类情况，系统会提示人工核实而不下结论。",
  },
  {
    question: "上传的供应商资料安全吗？",
    answer:
      "资料保存在私有存储中，不会出现在公开网络上，也不会生成任何对外可访问的链接。所有数据按工作区隔离，服务端会校验访问者是否属于该工作区，浏览器传入的工作区编号不作为授权依据。",
  },
  {
    question: "现在可以免费使用吗？",
    answer:
      "可以。当前版本已可跑完整链路：上传 → 解析 → 规则审核 → 报告。审核结论由 15 条确定性规则产出（可复算、可追溯），不是模型猜测。正式定价尚未公布。",
  },
];

const HERO_FILES = [
  { name: "营业执照", ext: "pdf" },
  { name: "ISO9001 证书", ext: "pdf" },
  { name: "检测报告", ext: "pdf" },
  { name: "报价单", ext: "xlsx" },
] as const;

const HERO_ROWS = [
  { label: "ISO9001 证书", status: "warn", note: "42 天后到期" },
  { label: "开户资料", status: "warn", note: "主体名称不一致" },
  { label: "检测报告", status: "fail", note: "资料包中未找到" },
] as const;

export default function HomePage() {
  const siteUrl = getSiteUrl();

  /**
   * 结构化数据。字段全部来自本页可见内容，
   * 不声明任何未经证实的评分、认证或用户规模。
   */
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: siteConfig.name,
        alternateName: siteConfig.latinName,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description: siteConfig.description,
        inLanguage: siteConfig.locale,
        url: siteUrl,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "CNY",
          description: "当前可免费使用，正式定价尚未公布。",
        },
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQS.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      },
    ],
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main id="main" className="flex-1">
        {/*
          Hero：左文右产品视觉。
          右侧刻意放"文件 → 核对 → 结果"这条链，而不是概念插画或图库照片 ——
          这个产品最有力的证据就是它自己的界面（见 docs/DESIGN.md §4）。
        */}
        <section className="border-b border-ink-200 bg-white">
          <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-24">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">
                  {siteConfig.latinName}
                </p>
                {/*
                  标题刻意不写「交给 AI」。
                  审核结论由 15 条确定性规则产出，不是模型判断 ——
                  写成 AI 就是把规则包装成它自己不是的东西（docs/DESIGN.md §0 硬规则 1）。
                  「不用再逐份翻文件」说的是真实痛点，也是系统真能办到的事。
                */}
                <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-ink-900 lg:text-5xl">
                  供应商资料审核，
                  <br className="hidden sm:block" />
                  不用再逐份翻文件
                </h1>
                <p className="mt-6 text-base leading-7 text-ink-600">
                  上传营业执照、认证证书、检测报告、报价单等资料，自动发现缺失、过期和信息不一致问题，
                  输出一份可逐条追溯的审核报告。
                </p>

                <div className="mt-9 flex flex-wrap items-center gap-3">
                  <Link
                    href="/register"
                    className="rounded-md bg-brand-700 px-6 py-3 text-sm font-medium text-white hover:bg-brand-800"
                  >
                    免费开始审核
                  </Link>
                  <Link
                    href="/login"
                    className="rounded-md border border-ink-300 bg-white px-6 py-3 text-sm font-medium text-ink-700 hover:bg-ink-50"
                  >
                    已有账号，登录
                  </Link>
                </div>

                <p className="mt-5 text-xs text-ink-500">
                  V0.3 · 15 条审核规则已上线，可跑完整审核并输出报告；模型复核尚未启用
                </p>
              </div>

              <div className="rounded-lg border border-ink-200 bg-brand-mist p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-semibold text-ink-900">资料包</p>
                  <span className="rounded bg-white px-1.5 py-0.5 text-[11px] text-ink-500">
                    示例数据
                  </span>
                </div>
                <div className="mt-3">
                  <FileStack files={HERO_FILES} />
                </div>
                <FlowArrow />
                <p className="mb-2 text-center text-[11px] text-ink-400">15 条规则逐条核对</p>
                <ResultPanel summary={{ pass: 14, warn: 3, fail: 1 }} rows={HERO_ROWS} />
              </div>
            </div>
          </div>
        </section>

        <MetricsSection />
        <BeforeAfterSection />
        <ReportSection />
        <CapabilitiesSection />
        <WorkflowSection />
        <SecuritySection />

        {/* FAQ：用 <details> 折叠，内容仍在 HTML 里，不损害 SEO 与 GEO。 */}
        <section aria-labelledby="faq-heading" className="bg-white">
          <div className="mx-auto w-full max-w-3xl px-6 py-16 lg:py-20">
            <h2 id="faq-heading" className="text-2xl font-semibold tracking-tight text-ink-900">
              常见问题
            </h2>
            <div className="mt-8 divide-y divide-ink-200 border-y border-ink-200">
              {FAQS.map((item) => (
                <details key={item.question} className="group py-4">
                  <summary className="flex cursor-pointer items-center justify-between gap-4 text-base font-semibold text-ink-900">
                    {item.question}
                    <span
                      aria-hidden="true"
                      className="shrink-0 text-ink-400 transition-transform group-open:rotate-45"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </span>
                  </summary>
                  <p className="mt-3 text-sm leading-6 text-ink-600">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <FinalCtaSection />
      </main>

      <SiteFooter />

      <script
        type="application/ld+json"
        // JSON.stringify 结果已由 React 转义，这里只承载本页可见的事实性内容。
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
    </div>
  );
}
