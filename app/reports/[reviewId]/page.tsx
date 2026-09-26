import Link from "next/link";
import { notFound } from "next/navigation";

import { requireActionWorkspace } from "@/lib/auth/action-context";
import { isUuid } from "@/lib/files";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  SEVERITY_ACCENT_CLASS,
  SEVERITY_BADGE_CLASS,
  SEVERITY_DESCRIPTIONS,
  SEVERITY_LABELS,
  ruleLabel,
} from "@/lib/reviews/labels";
import { findReviewRunById, listRunFindings } from "@/lib/reviews/repository";
import { listWorkspaceSuppliers } from "@/lib/suppliers/repository";
import { parseTemplateConfig } from "@/lib/templates/types";
import { siteConfig } from "@/lib/site";
import { SEVERITIES, type ReviewSummary } from "@/lib/reviews/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "审核报告",
  robots: { index: false, follow: false },
};

/**
 * 审核报告。
 *
 * 与 `/reviews/[reviewId]` 展示同一份数据，但布局针对**打印与转交**优化：
 * 顶部是可脱离屏幕阅读的元信息块，正文按类别分组（同一类问题放在一起便于跟供应商沟通），
 * 操作按钮都标了 `print:hidden`。
 *
 * 刻意的取舍：不生成 PDF 文件。生成 PDF 需要引入渲染依赖、占用内存、
 * 还要处理导出任务的生命周期；而"用浏览器打印成 PDF"零成本、零维护，
 * 且用户拿到的文件里带着可复制的文字。**先做真正能用起来的那一条。**
 */
export default async function ReportPage({
  params,
}: {
  params: Promise<{ reviewId: string }>;
}) {
  const { reviewId } = await params;
  if (!isUuid(reviewId)) notFound();

  const { workspace } = await requireActionWorkspace("VIEWER");
  const run = await findReviewRunById(reviewId);
  if (!run || run.workspaceId !== workspace.id) notFound();

  // 只有已完成的审核才有报告。执行中的审核去 /reviews 看进度。
  if (run.status !== "READY") {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Link href="/reviews" className="text-xs text-brand-700 hover:underline">
          ← 返回资料审核
        </Link>
        <p className="rounded-lg border border-ink-200 bg-white px-5 py-10 text-center text-sm text-ink-500">
          该审核尚未完成，暂时没有报告。
        </p>
      </div>
    );
  }

  const findings = await listRunFindings(run.id, workspace.id);
  const suppliers = await listWorkspaceSuppliers(workspace.id, { includeArchived: true });
  const supplier = suppliers.find((item) => item.id === run.supplierId) ?? null;
  const config = parseTemplateConfig(run.templateSnapshot);
  const summary = run.summary as Partial<ReviewSummary> | null;

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: findings.filter((finding) => finding.category === category),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="print:hidden">
        <Link href="/reports" className="text-xs text-brand-700 hover:underline">
          ← 返回审核报告
        </Link>
      </div>

      <article className="rounded-lg border border-ink-200 bg-white px-8 py-7">
        <header className="border-b border-ink-200 pb-5">
          <p className="text-xs uppercase tracking-wider text-ink-400">
            {siteConfig.name} · 审核报告
          </p>
          <h1 className="mt-2 text-xl font-semibold tracking-tight text-ink-900">{run.name}</h1>
          <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Meta label="审核主体" value={supplier?.name ?? "未关联供应商"} />
            <Meta
              label="统一社会信用代码"
              value={supplier?.unifiedSocialCreditCode ?? "未登记"}
              mono
            />
            <Meta label="审核模板" value={run.templateName} />
            <Meta label="纳入资料" value={`${(run.documentIds as unknown[]).length} 份`} />
            <Meta
              label="发起时间"
              value={run.createdAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
            />
            <Meta
              label="完成时间"
              value={(run.finishedAt ?? run.updatedAt).toLocaleString("zh-CN", {
                timeZone: "Asia/Shanghai",
              })}
            />
            <Meta label="执行引擎" value={`${run.engineProvider} / ${run.engineModel}`} />
            <Meta
              label="AI 复核"
              value={run.aiEnabled ? "已启用" : "未启用（开发模拟 Provider）"}
            />
          </dl>
        </header>

        {summary ? (
          <section className="border-b border-ink-200 py-5">
            <h2 className="text-sm font-semibold text-ink-900">结论概览</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-700">
              本次共执行 {summary.executedRules?.length ?? 0} 条规则，覆盖{" "}
              {summary.readableDocumentCount ?? 0} / {summary.documentCount ?? 0} 份资料
              （参与匹配的正文合计 {(summary.totalCharacters ?? 0).toLocaleString("zh-CN")} 字符），
              发现 {summary.findingCount ?? 0} 条问题，其中阻断项 {summary.blockingCount ?? 0} 条。
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              {SEVERITIES.map((severity) => (
                <span
                  key={severity}
                  title={SEVERITY_DESCRIPTIONS[severity]}
                  className={`rounded px-2 py-0.5 text-xs font-medium ${SEVERITY_BADGE_CLASS[severity]}`}
                >
                  {SEVERITY_LABELS[severity]} {summary.findingsBySeverity?.[severity] ?? 0}
                </span>
              ))}
            </div>

            {summary.coverageNotes && summary.coverageNotes.length > 0 ? (
              <div className="mt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-400">
                  覆盖度说明
                </h3>
                <ul className="mt-1 space-y-1">
                  {summary.coverageNotes.map((note) => (
                    <li key={note} className="text-xs leading-relaxed text-ink-600">
                      · {note}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        {/*
          AI 复核说明区块。
          ⚠️ 必须去重：lib/reviews/engine.ts 会把 ai.notes 并进 summary.coverageNotes
          （summary 是持久化摘要，那里必须写明 AI 是否参与，单测钉着），
          于是「覆盖度说明」里已经有这批文案了。不去重的话页面上会连着出现
          六行完全一样的话 —— 实测报告页就是这样，读起来像系统坏了。
        */}
        {(() => {
          const aiNotes = Array.isArray(run.aiNotes) ? (run.aiNotes as string[]) : [];
          const alreadyInCoverage = new Set(summary?.coverageNotes ?? []);
          const unique = aiNotes.filter((note) => !alreadyInCoverage.has(note));
          if (unique.length === 0) return null;
          return (
            <section className="border-b border-ink-200 py-5">
              <h2 className="text-sm font-semibold text-ink-900">AI 复核说明</h2>
              <ul className="mt-2 space-y-1">
                {unique.map((note) => (
                  <li key={note} className="text-xs leading-relaxed text-ink-600">
                    · {note}
                  </li>
                ))}
              </ul>
            </section>
          );
        })()}

        {grouped.length === 0 ? (
          <section className="py-8">
            <p className="text-sm text-ink-700">
              本次审核没有发现任何问题。请结合上面的覆盖度说明确认资料覆盖完整后再下结论 ——
              「没发现问题」与「查过了没问题」不是一回事。
            </p>
          </section>
        ) : (
          grouped.map((group) => (
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
                      <span className="text-xs font-medium text-ink-400">
                        {index + 1}.
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${SEVERITY_BADGE_CLASS[finding.severity]}`}
                      >
                        {SEVERITY_LABELS[finding.severity]}
                      </span>
                      <span className="text-xs text-ink-400">{ruleLabel(finding.ruleId)}</span>
                      {finding.documentLabel ? (
                        <span className="text-xs text-ink-500">
                          资料：{finding.documentLabel}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1.5 text-sm font-medium text-ink-900">{finding.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-ink-700">{finding.detail}</p>
                    {finding.evidence ? (
                      <p className="mt-1.5 text-xs leading-relaxed text-ink-500">
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
          ))
        )}

        <footer className="mt-6 border-t border-ink-200 pt-4 text-xs leading-relaxed text-ink-500">
          <p>
            本报告由 {siteConfig.name}（{siteConfig.latinName}）自动生成。
            全部结论来自确定性规则引擎
            {run.engineMock ? "；AI 复核未启用（当前为开发模拟 Provider，不产生真实判断）" : "，并经 AI 复核"}。
          </p>
          <p className="mt-1">
            报告本身不构成对供应商资质、信用或履约能力的保证。证照真伪请以发证机关的查询结果为准。
          </p>
          <p className="mt-1">证照到期预警阈值：{config.expiryWarningDays} 天（取自本次审核的模板快照）。</p>
        </footer>
      </article>

      <p className="print:hidden text-xs text-ink-400">
        提示：用浏览器的打印功能（Ctrl / Cmd + P）可把本报告导出为 PDF。
      </p>
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className={`mt-0.5 truncate text-ink-800 ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
