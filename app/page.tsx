import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getSiteUrl, siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: `${siteConfig.name} · ${siteConfig.tagline}`,
  description: siteConfig.description,
  alternates: { canonical: "/" },
};

/** 产品能力。只写产品「设计上要做的事」，不写任何未验证的效果数字。 */
const CAPABILITIES: ReadonlyArray<{ title: string; detail: string }> = [
  {
    title: "文件识别",
    detail: "自动识别供应商资料包中的文件类型，涵盖 PDF、Word、Excel、图片与压缩包。",
  },
  {
    title: "关键信息提取",
    detail: "从各类资料中提取企业名称、统一社会信用代码、证照编号、有效期等关键字段。",
  },
  {
    title: "资料完整性检查",
    detail: "对照审核模板逐项检查资料是否齐全，直接列出缺什么。",
  },
  {
    title: "证照有效期核验",
    detail: "检查营业执照、资质证书等是否仍在有效期内，对临期证照提前预警。",
  },
  {
    title: "主体信息一致性核对",
    detail: "比对不同文件中的企业名称、统一社会信用代码等主体信息是否自洽。",
  },
  {
    title: "审核报告输出",
    detail: "把发现的问题汇总成结构化审核报告，便于内部评审与归档。",
  },
];

const WORKFLOW: ReadonlyArray<{ step: string; title: string; detail: string }> = [
  {
    step: "01",
    title: "上传资料包",
    detail: "把供应商提供的证照、资质、产品资料打包上传，无需手工整理。",
  },
  {
    step: "02",
    title: "自动识别与提取",
    detail: "系统识别文件类型并提取关键信息，人工只需要核对结果。",
  },
  {
    step: "03",
    title: "规则校验与一致性核对",
    detail: "按审核模板检查完整性、有效期与主体信息一致性，标记异常项。",
  },
  {
    step: "04",
    title: "输出审核报告",
    detail: "生成可交付的审核报告，附问题清单，支持后续人工复核。",
  },
];

const FAQS: ReadonlyArray<{ question: string; answer: string }> = [
  {
    question: "供应商智审是做什么的？",
    answer:
      "供应商智审（SupplierCheck）是一个在线工具：上传供应商资料包后，系统自动识别文件、提取关键信息，检查资料完整性、证照有效期以及主体信息与产品资质的一致性，最后生成审核报告。",
  },
  {
    question: "支持哪些文件格式？",
    answer:
      "产品设计支持 PDF、Word（DOCX）、Excel（XLSX）、图片（PNG / JPG）以及 ZIP 压缩包。V0.1 已建立文件类型校验与安全存储，实际的文档解析能力在后续版本接入。",
  },
  {
    question: "需要安装软件吗？",
    answer: "不需要。供应商智审是浏览器访问的在线服务，采购人员、供应链人员和供应商协作方都可以直接使用。",
  },
  {
    question: "上传的供应商资料安全吗？",
    answer:
      "资料保存在私有存储中，不会出现在公开网络上，也不会生成任何对外可访问的链接。所有数据按工作区隔离，服务端会校验访问者是否属于该工作区，浏览器传入的工作区编号不作为授权依据。",
  },
  {
    question: "现在可以免费使用吗？",
    answer:
      "V0.1 是开发版本。账号体系、工作区隔离、资料安全存储与页面框架已经就绪，核心的 AI 审核能力仍在开发中。正式开放体验后会在本页说明。",
  },
];

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
          description: "开发版本，正式定价尚未公布。",
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
        {/* Hero：一句话价值主张 + 主 CTA */}
        <section className="border-b border-ink-200 bg-white">
          <div className="mx-auto w-full max-w-6xl px-6 py-20 lg:py-24">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">
              {siteConfig.latinName}
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-ink-900 lg:text-5xl">
              {siteConfig.tagline}
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-ink-600">
              面向企业采购、供应链与中小企业的供应商资料审核工具。把散落在压缩包里的营业执照、资质证书和产品资料，
              整理成一份可直接评审的审核结论。
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/register"
                className="rounded-md bg-brand-700 px-6 py-3 text-sm font-medium text-white hover:bg-brand-800"
              >
                免费体验
              </Link>
              <Link
                href="/login"
                className="rounded-md border border-ink-300 bg-white px-6 py-3 text-sm font-medium text-ink-700 hover:bg-ink-50"
              >
                已有账号，登录
              </Link>
            </div>

            <p className="mt-5 text-xs text-ink-400">
              当前为 V0.1 开发版本 · 账号与工作区能力已可用，AI 审核能力开发中
            </p>
          </div>
        </section>

        {/* 产品能力 */}
        <section aria-labelledby="capabilities-heading" className="border-b border-ink-200">
          <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-20">
            <h2 id="capabilities-heading" className="text-2xl font-semibold tracking-tight text-ink-900">
              一次上传，审完这几件事
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-600">
              供应商资料审核中最耗时、最容易出错的判断，交给系统先做一遍。
            </p>

            <ul className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((item) => (
                <li key={item.title} className="border-t border-ink-200 pt-5">
                  <h3 className="text-base font-semibold text-ink-900">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-ink-600">{item.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 工作流程 */}
        <section aria-labelledby="workflow-heading" className="border-b border-ink-200 bg-white">
          <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-20">
            <h2 id="workflow-heading" className="text-2xl font-semibold tracking-tight text-ink-900">
              审核流程
            </h2>
            <ol className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
              {WORKFLOW.map((item) => (
                <li key={item.step}>
                  <span className="font-mono text-sm font-semibold text-brand-500">{item.step}</span>
                  <h3 className="mt-3 text-base font-semibold text-ink-900">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-ink-600">{item.detail}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* FAQ：静态渲染，非客户端状态，确保可被搜索引擎抓取 */}
        <section aria-labelledby="faq-heading" className="border-b border-ink-200">
          <div className="mx-auto w-full max-w-3xl px-6 py-16 lg:py-20">
            <h2 id="faq-heading" className="text-2xl font-semibold tracking-tight text-ink-900">
              常见问题
            </h2>
            <dl className="mt-10 space-y-8">
              {FAQS.map((item) => (
                <div key={item.question}>
                  <dt className="text-base font-semibold text-ink-900">{item.question}</dt>
                  <dd className="mt-2 text-sm leading-6 text-ink-600">{item.answer}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
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
