import type { Metadata } from "next";

import { ConversionCta } from "@/components/content/conversion-cta";
import { SiteBreadcrumb } from "@/components/site-breadcrumb";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SAMPLE_REPORT } from "@/lib/content/sample-report";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  SEVERITY_ACCENT_CLASS,
  SEVERITY_BADGE_CLASS,
  SEVERITY_DESCRIPTIONS,
  SEVERITY_LABELS,
  ruleLabel,
} from "@/lib/reviews/labels";
import { REVIEW_RULES } from "@/lib/reviews/rules";
import { SEVERITIES } from "@/lib/reviews/types";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "示例审核报告",
  description:
    "不用注册就能看到一份完整的供应商资料审核报告：15 条规则逐条核对的结果、每条发现的严重级别、所在文件与原文摘录，以及系统给不出结论时如何如实标注。",
  alternates: { canonical: "/sample-report" },
  openGraph: {
    type: "article",
    url: "/sample-report",
    title: "示例审核报告 · " + siteConfig.shortName,
    description:
      "不用注册就能看到一份完整的供应商资料审核报告：逐条核对的结果、严重级别、所在文件与原文摘录。",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "示例审核报告" }],
  },
};

/**
 * 免登录示例报告。
 *
 * 存在的理由：客户在上传自己的机密资料之前，唯一的疑虑是"查出来到底什么样"。
 * 这一页把报告原样摊开 —— 而不是再写一遍价值主张。
 *
 * DOM 与 `/reports/[reviewId]` 的真实报告**同构**（元信息 → 结论概览 → 按类别分组 → 声明），
 * 连严重度徽章、类别分组顺序、页脚声明都复用同一套组件与映射。
 * 否则示例就变成了"另一套更好看的设计"，客户注册后看到真报告会觉得被换了一款产品。
 */
export default function SampleReportPage() {
  const report = SAMPLE_REPORT;

  const findingsBySeverity = SEVERITIES.map((severity) => ({
    severity,
    count: report.findings.filter((finding) => finding.severity === severity).length,
  }));
  const findingCount = report.findings.length;
  const blockingCount = report.findings.filter(
    (finding) => finding.severity === "CRITICAL" || finding.severity === "HIGH",
  ).length;

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: report.findings.filter((finding) => finding.category === category),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main id="main" className="flex-1">
        <div className="mx-auto w-full max-w-4xl px-6 py-12 lg:py-16">
          <SiteBreadcrumb items={[{ label: "首页", href: "/" }, { label: "示例审核报告" }]} />

          <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-[clamp(1.75rem,3vw,2.35rem)] font-bold leading-[1.2] tracking-tight text-ink-900">
                示例审核报告
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-ink-600">
                下面这份报告与你在 {siteConfig.shortName} 里跑完一次审核看到的完全同构：
                同一套 {REVIEW_RULES.length} 条规则、同一套严重级别、同样的原文摘录与建议。
                不用注册，先看清楚再决定。
              </p>
            </div>
            <span className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
              示例数据 · 真实规则驱动
            </span>
          </div>

          <article className="card mt-8 px-6 py-7 sm:px-8">
            <header className="border-b border-ink-200 pb-5">
              <p className="text-xs uppercase tracking-wider text-ink-400">
                {siteConfig.name} · 审核报告（示例）
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink-900">
                {report.supplierName} · 供应商准入审核
              </h2>
              <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <Meta label="审核主体" value={report.supplierName} />
                <Meta label="审核模板" value={report.templateName} />
                <Meta label="纳入资料" value={`${report.documentCount} 份`} />
                <Meta
                  label="判定基准日"
                  value={`${report.baseDate}（示例固定值）`}
                />
                <Meta label="执行规则" value={`${REVIEW_RULES.length} 条`} />
                <Meta label="AI 复核" value="未启用（开发模拟 Provider）" />
              </dl>
            </header>

            <section className="border-b border-ink-200 py-5">
              <h2 className="text-sm font-semibold text-ink-900">结论概览</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-700">
                本次共执行 {REVIEW_RULES.length} 条规则，覆盖 {report.readableDocumentCount} /{" "}
                {report.documentCount} 份资料（参与匹配的正文合计{" "}
                {report.totalCharacters.toLocaleString("zh-CN")} 字符），发现 {findingCount}{" "}
                条问题，其中阻断项 {blockingCount} 条。
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                {findingsBySeverity.map(({ severity, count }) => (
                  <span
                    key={severity}
                    title={SEVERITY_DESCRIPTIONS[severity]}
                    className={`rounded px-2 py-0.5 text-xs font-medium ${SEVERITY_BADGE_CLASS[severity]}`}
                  >
                    {SEVERITY_LABELS[severity]} {count}
                  </span>
                ))}
              </div>

              <div className="mt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-400">
                  覆盖度说明
                </h3>
                <ul className="mt-1 space-y-1">
                  {report.coverageNotes.map((note) => (
                    <li key={note} className="text-xs leading-relaxed text-ink-600">
                      · {note}
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            {grouped.map((group) => (
              <section key={group.category} className="border-b border-ink-200 py-5 last:border-b-0">
                <h2 className="text-sm font-semibold text-ink-900">
                  {CATEGORY_LABELS[group.category]}
                  <span className="ml-2 text-xs font-normal text-ink-400">
                    {group.items.length} 条
                  </span>
                </h2>

                <ol className="mt-3 space-y-4">
                  {group.items.map((finding, index) => (
                    <li
                      key={finding.id}
                      className={`border-l-4 pl-4 ${SEVERITY_ACCENT_CLASS[finding.severity]}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-ink-400">{index + 1}.</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-medium ${SEVERITY_BADGE_CLASS[finding.severity]}`}
                        >
                          {SEVERITY_LABELS[finding.severity]}
                        </span>
                        <span className="text-xs text-ink-400">{ruleLabel(finding.ruleId)}</span>
                        {finding.documentLabel ? (
                          <span className="text-xs text-ink-500">资料：{finding.documentLabel}</span>
                        ) : null}
                      </div>
                      <p className="mt-1.5 text-sm font-medium text-ink-900">{finding.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-ink-700">{finding.detail}</p>
                      {finding.evidence ? (
                        <p className="mt-1.5 rounded border border-ink-200 bg-ink-50 px-2.5 py-2 font-mono text-xs leading-relaxed text-ink-600">
                          原文摘录：{finding.evidence}
                        </p>
                      ) : null}
                      {finding.recommendation ? (
                        <p className="mt-1.5 text-xs text-ink-600">建议：{finding.recommendation}</p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>
            ))}

            <footer className="mt-6 border-t border-ink-200 pt-4 text-xs leading-relaxed text-ink-500">
              <p>
                以上由 {siteConfig.name}（{siteConfig.latinName}）按确定性规则生成；AI
                复核未启用（当前为开发模拟 Provider，不产生真实判断）。
              </p>
              <p className="mt-1">
                报告本身不构成对供应商资质、信用或履约能力的保证。证照真伪请以发证机关的查询结果为准。
              </p>
              <p className="mt-1">
                证照到期预警阈值：{report.expiryWarningDays} 天（取自本次审核的模板快照）。
              </p>
              <p className="mt-1">
                示例主体「{report.supplierName}」为虚构名称，判定基准日固定为 {report.baseDate}，
                不代表任何真实审核结果。
              </p>
            </footer>
          </article>

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

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="mt-0.5 truncate text-ink-800">{value}</dd>
    </div>
  );
}
