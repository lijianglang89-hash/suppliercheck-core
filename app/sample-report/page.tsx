import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ConversionCta } from "@/components/content/conversion-cta";
import { SiteBreadcrumb } from "@/components/site-breadcrumb";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import {
  DocumentPane,
  RuleEvidenceFinding,
  SeverityBadge,
  WorkspaceMetrics,
} from "@/components/landing/visuals";
import { SAMPLE_REPORT, type SampleFinding } from "@/lib/content/sample-report";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  SEVERITY_BADGE_CLASS,
  SEVERITY_DESCRIPTIONS,
  SEVERITY_LABELS,
  ruleLabel,
} from "@/lib/reviews/labels";
import { REVIEW_RULES } from "@/lib/reviews/rules";
import { SEVERITIES, SEVERITY_RANK } from "@/lib/reviews/types";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "企智审审核示例",
  description:
    "不用注册，按真实产品的流程走一遍：资料包 → 解析 → 15 条规则 → 审核摘要 → 逐条发现（RULE → EVIDENCE → FINDING）→ 人工复核。所有数据均为演示示例，由真实规则引擎生成。",
  alternates: { canonical: "/sample-report" },
  openGraph: {
    type: "article",
    url: "/sample-report",
    title: "企智审审核示例 · " + siteConfig.shortName,
    description:
      "按真实产品流程体验一遍供应商审核结果：资料、规则、发现、证据与人工复核一目了然。",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "企智审审核示例" }],
  },
};

const findingCount = SAMPLE_REPORT.findings.length;
const blockingCount = SAMPLE_REPORT.findings.filter(
  (finding) => finding.severity === "CRITICAL" || finding.severity === "HIGH",
).length;

const rulesByCategory = CATEGORY_ORDER.map((category) => ({
  category,
  rules: REVIEW_RULES.filter((rule) => rule.category === category),
})).filter((group) => group.rules.length > 0);

/**
 * 免登录审核示例 = 产品体验 walkthrough。
 *
 * 存在的理由：客户在上传自己的机密资料之前，唯一的疑虑是"查出来到底什么样"。
 * 这一页按真实产品的流程走一遍（资料包 → 解析 → 规则 → 摘要 → 逐条发现 → 人工复核），
 * 让访客感觉"我已提前体验了一遍企智审审核结果"。
 *
 * 与首页工作台、真实报告共用同一份 SAMPLE_REPORT，且被 tests/unit/sample-report.test.ts
 * 钉死在真实规则上（ruleId 必须存在、类别/严重级别必须等于规则定义）。
 * 核心交互是每条发现的 RULE → EVIDENCE → FINDING 三节点，让"可追溯"在页面上可逐项对上。
 */
export default function SampleReportPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main id="main" className="flex-1">
        <div className="mx-auto w-full max-w-4xl px-6 py-12 lg:py-16">
          <SiteBreadcrumb items={[{ label: "首页", href: "/" }, { label: "企智审审核示例" }]} />

          <header className="mt-5">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
              企智审审核示例 · 产品体验
            </span>
            <h1 className="mt-4 text-[clamp(1.75rem,3vw,2.35rem)] font-bold leading-[1.2] tracking-tight text-ink-900">
              提前体验一遍企智审审核结果
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-ink-600">
              不用注册。下面按真实产品的流程走一遍：资料包导入、自动解析、规则核对、结果摘要，
              再到逐条发现的「规则 → 证据 → 结论」。你看到的每一格，都是这个引擎真会输出的东西。
            </p>
            <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-6 text-amber-800">
              <span
                aria-hidden="true"
                className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
              />
              <span>
                <strong>演示数据 · 非真实客户项目</strong>
                ：以下资料、规则结论均为虚构示例，由真实规则引擎生成，不代表任何真实供应商审核结果。
              </span>
            </div>
          </header>

          <Step index={1} title="资料包" hint="一次导入供应商提供的多份资料">
            <DocumentPane files={SAMPLE_REPORT.documents} />
          </Step>

          <Step index={2} title="自动解析" hint="把可提取的正文送进规则引擎">
            <div className="card p-4">
              <p className="text-sm leading-6 text-ink-700">系统对资料包做一次解析，结果如下：</p>
              <ul className="mt-2 space-y-1">
                {SAMPLE_REPORT.coverageNotes.map((note) => (
                  <li key={note} className="text-xs leading-5 text-ink-600">
                    · {note}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs leading-5 text-ink-500">
                共提取 {SAMPLE_REPORT.readableDocumentCount} / {SAMPLE_REPORT.documentCount} 份资料、
                {" "}
                {SAMPLE_REPORT.totalCharacters.toLocaleString("zh-CN")} 字符正文参与核对。
              </p>
            </div>
          </Step>

          <Step
            index={3}
            title="15 条规则"
            hint={`本次执行 ${REVIEW_RULES.length} 条规则，按 5 类维度核对`}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {rulesByCategory.map(({ category, rules }) => (
                <div key={category} className="card-soft p-3">
                  <p className="text-xs font-semibold text-ink-900">{CATEGORY_LABELS[category]}</p>
                  <p className="mt-0.5 text-[11px] text-ink-500">{rules.length} 条规则</p>
                  <ul className="mt-2 space-y-1">
                    {rules.map((rule) => (
                      <li key={rule.id} className="text-[11px] leading-4 text-ink-600">
                        {rule.label}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Step>

          <Step index={4} title="审核摘要" hint="规则命中后的量化结果">
            <div className="overflow-hidden rounded-lg border border-ink-200 bg-white">
              <WorkspaceMetrics
                documentCount={SAMPLE_REPORT.documentCount}
                readableDocumentCount={SAMPLE_REPORT.readableDocumentCount}
                totalCharacters={SAMPLE_REPORT.totalCharacters}
                ruleCount={REVIEW_RULES.length}
                findingCount={findingCount}
                blockingCount={blockingCount}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {SEVERITIES.map((severity) => (
                <span
                  key={severity}
                  title={SEVERITY_DESCRIPTIONS[severity]}
                  className={`rounded px-2 py-0.5 text-xs font-medium ${SEVERITY_BADGE_CLASS[severity]}`}
                >
                  {SEVERITY_LABELS[severity]}{" "}
                  {SAMPLE_REPORT.findings.filter((finding) => finding.severity === severity).length}
                </span>
              ))}
            </div>
          </Step>

          <Step
            index={5}
            title="发现与证据"
            hint="每条发现都可追溯到：命中了哪条规则、依据哪段原文"
          >
            <div className="card-soft mb-4 p-3">
              <RuleEvidenceFinding />
            </div>
            <ol className="space-y-4">
              {[...SAMPLE_REPORT.findings]
                .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
                .map((finding) => (
                  <FindingChain key={finding.id} finding={finding} />
                ))}
            </ol>
          </Step>

          <Step index={6} title="最终人工复核" hint="判定权始终在人手里">
            <div className="card p-4 text-xs leading-6 text-ink-500">
              <p>
                以上由 {siteConfig.name} 按确定性规则生成；AI 复核未启用（当前为开发模拟 Provider，不产生真实判断）。
              </p>
              <p className="mt-1.5">
                报告本身不构成对供应商资质、信用或履约能力的保证。证照真伪请以发证机关的查询结果为准。
              </p>
              <p className="mt-1.5">
                证照到期预警阈值：{SAMPLE_REPORT.expiryWarningDays} 天（取自本次审核的模板快照）。
              </p>
              <p className="mt-1.5">
                示例主体「{SAMPLE_REPORT.supplierName}」为虚构名称，判定基准日固定为{" "}
                {SAMPLE_REPORT.baseDate}，不代表任何真实审核结果。
              </p>
            </div>
          </Step>

          <ConversionCta />

          <p className="mt-8 text-xs text-ink-400">
            真实报告支持用浏览器打印（Ctrl / Cmd + P）导出为 PDF。
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 子组件                                                              */
/* ------------------------------------------------------------------ */

function Step({
  index,
  title,
  hint,
  children,
}: {
  index: number;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-10 border-t border-ink-100 pt-8">
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
          {index}
        </span>
        <div>
          <h2 className="text-base font-semibold tracking-tight text-ink-900">{title}</h2>
          {hint && <p className="text-xs text-ink-500">{hint}</p>}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ChainArrow() {
  return (
    <span
      aria-hidden="true"
      className="hidden self-center px-1 text-base text-ink-300 lg:block"
    >
      →
    </span>
  );
}

/**
 * 一条发现的三节点呈现：RULE（命中规则）→ EVIDENCE（原文摘录）→ FINDING（判据与建议）。
 * 大屏三栏横排带箭头，窄屏自动竖排堆叠，阅读顺序即链路顺序。
 */
function FindingChain({ finding }: { finding: SampleFinding }) {
  return (
    <li className="overflow-hidden rounded-lg border border-ink-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-4 py-2.5">
        <SeverityBadge severity={finding.severity} />
        <span className="text-sm font-semibold text-ink-900">{finding.title}</span>
      </div>
      <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-stretch">
        <div className="flex-1 rounded-md border border-ink-200 bg-ink-50/60 p-3">
          <p className="font-mono text-[10px] font-semibold tracking-wide text-brand-700">RULE</p>
          <p className="mt-1 font-mono text-[11px] text-ink-700">{finding.ruleId}</p>
          <p className="mt-0.5 text-xs font-medium text-ink-900">{ruleLabel(finding.ruleId)}</p>
        </div>
        <ChainArrow />
        <div className="flex-1 rounded-md border border-ink-200 bg-ink-50/60 p-3">
          <p className="font-mono text-[10px] font-semibold tracking-wide text-ink-600">EVIDENCE</p>
          {finding.evidence ? (
            <p className="mt-1 font-mono text-[11px] leading-5 text-ink-700">
              原文摘录：{finding.evidence}
            </p>
          ) : (
            <p className="mt-1 text-[11px] leading-5 text-ink-500">
              {finding.documentLabel ? "该资料无文字层，无摘录可附" : "缺失类发现：资料包中没有对应文件"}
            </p>
          )}
          {finding.documentLabel && (
            <p className="mt-1.5 text-[10px] text-ink-400">所在资料：{finding.documentLabel}</p>
          )}
        </div>
        <ChainArrow />
        <div className="flex-1 rounded-md border border-ink-200 bg-white p-3">
          <p className="font-mono text-[10px] font-semibold tracking-wide text-ink-600">FINDING</p>
          <p className="mt-1 text-xs leading-5 text-ink-700">{finding.detail}</p>
          <p className="mt-1.5 text-[11px] leading-5 text-ink-600">建议：{finding.recommendation}</p>
        </div>
      </div>
    </li>
  );
}
