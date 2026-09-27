import type { Metadata } from "next";
import Link from "next/link";

import { ReviewWorkspacePreview } from "@/components/landing/visuals";
import { ContentHubSection } from "@/components/landing/content-hub-section";
import { ReportSection } from "@/components/landing/report-section";
import {
  BeforeAfterSection,
  BoundarySection,
  CapabilitiesSection,
  FinalCtaSection,
  MetricsSection,
  RulesSection,
  SecuritySection,
  WorkflowSection,
} from "@/components/landing/sections";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SAMPLE_REPORT } from "@/lib/content/sample-report";
import { ALLOWED_MIME_TYPES } from "@/lib/files";
import { REVIEW_RULES } from "@/lib/reviews/rules";
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
      `由 ${REVIEW_RULES.length} 条确定性规则逐条核对得出，每条发现都标注规则、所在文件与原文摘录。同一份资料跑两次结果一致。当前未启用模型复核，因此不会出现无法复算的判断。`,
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
      `可以。当前版本已可跑完整链路：上传 → 解析 → 规则审核 → 报告。审核结论由 ${REVIEW_RULES.length} 条确定性规则产出（可复算、可追溯），不是模型猜测。正式定价尚未公布。`,
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
          Hero：40 / 60 非对称分栏。

          左侧只做一件事 —— 用体量压住全场（大字号 + 品牌色高亮 + 主次双 CTA）。
          右侧是一整块**真实审核工作台**：主体 / 状态 / 真实数字 / 发现清单 / 原文摘录。

          ⭐ 这一版的取舍：首屏的主角必须是软件本身，不是装饰。
          因此删掉了一切"破形浮层"和点阵地基 —— 它们曾经让页面显得精致，
          但也让产品界面被缩小、被推远。现在右栏 60% 全是界面。
        */}
        <section className="overflow-x-clip border-b border-ink-200 bg-white">
          {/*
            Hero 刻意比下方区块宽一档（max-w-7xl vs 全站 max-w-6xl）：
            实测过 max-w-6xl 的 40/60 分栏 —— 工作台只有 646px，占视口 44.9%，
            「UI 太小」的问题并没有真正解决。放宽到 7xl + 5/7 分栏后右栏约 780px，
            占视口 54%，界面终于成为首屏主角。
            py 从 32 收到 24：这一屏的留白要让位给界面，不是让位给空气。
          */}
          <div className="mx-auto w-full max-w-7xl px-6 py-16 lg:py-24">
            <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-10">
              {/* 左：40% */}
              <div className="lg:col-span-5">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">
                  {siteConfig.latinName}
                </p>
                {/*
                  标题刻意不写「交给 AI」。
                  审核结论由 REVIEW_RULES.length 条确定性规则产出（页面上按实际条数渲染），不是模型判断 ——
                  写成 AI 就是把规则包装成它自己不是的东西（docs/DESIGN.md §0 硬规则 1）。

                  字重只用 bold：实测（Windows Chrome + 雅黑，canvas 像素计量）
                  400/500 与 600/700/800/900 只有两档渲染结果 —— 900 既不会更粗，
                  也不会「合成描边糊成一团」（早前文档这么写过，是错的），只是被映射成 Bold。
                  体量全部靠字号 + 收紧行高 + 品牌色高亮（见 docs/BRAND.md §4.1）。
                */}
                {/*
                  字号用 clamp 随视口缩放 + nowrap 保持整行不断：
                  40% 栏宽装不下固定大字号，硬拆行（「审核」被劈开）比小一号难看得多。
                */}
                <h1 className="mt-5 text-[clamp(2.25rem,4.2vw,3.2rem)] font-bold leading-[1.15] tracking-tight text-ink-900 sm:whitespace-nowrap">
                  供应商资料审核，
                  <br className="hidden sm:block" />
                  <span className="text-brand-700">不用再逐份翻文件</span>
                </h1>
                {/*
                  副标题只回答三件事：传什么、系统做什么、最后拿到什么。
                  「确定性审核规则」这个词不能省 —— 它是本产品与"AI 帮你看看"的分界线。
                */}
                <p className="mt-6 text-base leading-7 text-ink-600">
                  上传一份供应商 PDF 或 ZIP 资料包，系统自动展开压缩包、提取正文，
                  执行 {REVIEW_RULES.length} 条确定性审核规则，把需要关注的问题集中列出来。
                </p>

                <div className="mt-9 flex flex-wrap items-center gap-3">
                  <Link
                    href="/register"
                    className="rounded-md bg-brand-700 px-7 py-3.5 text-base font-medium text-white shadow-sm transition-colors hover:bg-brand-800"
                  >
                    开始审核
                  </Link>
                  <a
                    href="#workflow"
                    className="group flex items-center gap-1.5 rounded-md border border-ink-300 px-5 py-3.5 text-sm font-medium text-ink-700 transition-colors hover:border-brand-300 hover:text-brand-700"
                  >
                    查看审核流程
                    <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
                      →
                    </span>
                  </a>
                </div>

                {/* 信任带上移：不单独占一条区块，直接压在 CTA 下面当转化背书 */}
                <div className="mt-6">
                  <p className="text-xs leading-6 text-ink-400">
                    已无缝支持：
                    {Object.values(ALLOWED_MIME_TYPES)
                      .map((extension) => extension.replace(".", "").toUpperCase())
                      .join(" · ")}
                  </p>
                  <p className="mt-1 text-xs leading-6 text-ink-400 opacity-70">
                    私有存储 · 无公开链接 · 工作区隔离 · 不用于任何对外展示
                  </p>
                </div>

                <p className="mt-6 text-xs text-ink-500">
                  V{siteConfig.version} · {REVIEW_RULES.length}{" "}
                  条审核规则已上线，可跑完整审核并输出报告；模型复核尚未启用
                </p>
              </div>

              {/* 右：60% —— 一整块真实工作台，不再用浮动小卡片当装饰 */}
              <div className="lg:col-span-7">
                {/*
                  为什么把两个"破形浮层"整个删掉：
                  它们是装饰，而装饰在这里是负资产 —— 首屏右栏的任务是
                  「让人 5 秒内看清这个系统长什么样」，任何抢走视线的东西都在削弱它。
                  同时删掉的还有点阵地基：界面本身的信息密度已经足够，
                  再多一层纹理只会让它看起来像一张海报。

                  ⭐ 这里的每一条发现都来自 SAMPLE_REPORT —— 与 /sample-report 同一份数据，
                  且被单测钉死在真实规则上。也就是说首屏不是"画出来的界面"。
                */}
                <ReviewWorkspacePreview limit={6} />

                <Link
                  href="/sample-report"
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:text-brand-800"
                >
                  查看完整示例报告（{SAMPLE_REPORT.findings.length} 条发现，含证据与建议）
                  <span aria-hidden="true">→</span>
                </Link>
              </div>
            </div>
          </div>
        </section>

        <MetricsSection />
        <WorkflowSection />
        <ReportSection />
        <CapabilitiesSection />
        <RulesSection />
        <BoundarySection />
        <BeforeAfterSection />
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

        {/* 内容页导流：把首页权重导向 /templates，同时给访客一个"不注册也能拿走"的出口 */}
        <ContentHubSection />

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
