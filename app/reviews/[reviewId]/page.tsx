import Link from "next/link";
import { notFound } from "next/navigation";

import { deleteReviewAction } from "@/app/actions/reviews";
import { AutoRefresh } from "@/components/documents/auto-refresh";
import { RerunReviewForm } from "@/components/reviews/create-review-form";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { requireActionWorkspace } from "@/lib/auth/action-context";
import { isUuid } from "@/lib/files";
import {
  CATEGORY_LABELS,
  SEVERITY_ACCENT_CLASS,
  SEVERITY_BADGE_CLASS,
  SEVERITY_LABELS,
  isRunPending,
  ruleLabel,
  runStatusClass,
  runStatusLabel,
} from "@/lib/reviews/labels";
import { findReviewRunById, listRunFindings } from "@/lib/reviews/repository";
import { listWorkspaceSuppliers } from "@/lib/suppliers/repository";
import { parseTemplateConfig } from "@/lib/templates/types";
import {
  SEVERITIES,
  type FindingCategory,
  type ReviewSummary,
  type Severity,
} from "@/lib/reviews/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "审核详情",
  robots: { index: false, follow: false },
};

export default async function ReviewDetailPage({
  params,
}: {
  params: Promise<{ reviewId: string }>;
}) {
  const { reviewId } = await params;
  if (!isUuid(reviewId)) notFound();

  const { workspace } = await requireActionWorkspace("VIEWER");
  const run = await findReviewRunById(reviewId);

  // 授权判据是数据库行里的 workspaceId —— 不是 URL 里的任何东西。
  if (!run || run.workspaceId !== workspace.id) notFound();

  const findings = await listRunFindings(run.id, workspace.id);
  const suppliers = await listWorkspaceSuppliers(workspace.id, { includeArchived: true });
  const supplierName = suppliers.find((supplier) => supplier.id === run.supplierId)?.name ?? null;

  const config = parseTemplateConfig(run.templateSnapshot);
  const summary = run.summary as Partial<ReviewSummary> | null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/reviews" className="text-xs text-brand-700 hover:underline">
          ← 返回资料审核
        </Link>
      </div>

      <header className="rounded-lg border border-ink-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight text-ink-900">{run.name}</h1>
            <p className="mt-1 text-xs text-ink-500">
              模板：{run.templateName}
              {" · "}
              主体：{run.supplierId ? (supplierName ?? "已删除") : "未关联"}
              {" · "}
              资料 {(run.documentIds as unknown[]).length} 份
              {" · "}
              发起于 {run.createdAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
            </p>
          </div>
          <span
            className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${runStatusClass(run.status)}`}
          >
            {runStatusLabel(run.status)}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <RerunReviewForm runId={run.id} />
          <form action={deleteReviewAction}>
            <input type="hidden" name="runId" value={run.id} />
            <ConfirmSubmitButton
              variant="danger"
              message="删除这次审核记录？它会一并移出审核报告列表，但资料本身不受影响。"
            >
              删除记录
            </ConfirmSubmitButton>
          </form>
          <Link
            href={`/reports/${run.id}`}
            className="rounded-md border border-ink-300 bg-white px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            查看报告
          </Link>
        </div>

        {isRunPending(run.status) ? <AutoRefresh active /> : null}
      </header>

      {run.status === "FAILED" ? (
        <section className="rounded-lg border border-red-200 bg-red-50 px-5 py-4">
          <h2 className="text-sm font-semibold text-danger-600">本次审核执行失败</h2>
          <p className="mt-1 text-sm text-ink-700">{run.errorMessage ?? "未记录具体原因。"}</p>
          <p className="mt-2 text-xs text-ink-500">
            错误代码：{run.errorCode ?? "未知"}。可以点击「重新运行审核」再试一次。
          </p>
        </section>
      ) : null}

      {run.engineMock ? (
        <EngineNotice provider={run.engineProvider} model={run.engineModel} />
      ) : null}

      {summary ? <SummarySection summary={summary} /> : null}

      {run.status === "READY" ? (
        <section aria-labelledby="findings-heading" className="space-y-3">
          <h2 id="findings-heading" className="text-sm font-semibold text-ink-900">
            审核发现（{findings.length}）
          </h2>

          {findings.length === 0 ? (
            <p className="rounded-lg border border-ink-200 bg-white px-5 py-8 text-center text-sm text-ink-500">
              本次审核没有发现问题。请先确认上面的覆盖度说明（查了多少资料）再下结论。
            </p>
          ) : (
            <ul className="space-y-3">
              {findings.map((finding) => (
                <li
                  key={finding.id}
                  className={`rounded-lg border border-ink-200 border-l-4 bg-white px-4 py-3 ${SEVERITY_ACCENT_CLASS[finding.severity]}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${SEVERITY_BADGE_CLASS[finding.severity]}`}
                    >
                      {SEVERITY_LABELS[finding.severity]}
                    </span>
                    <span className="text-xs text-ink-400">
                      {CATEGORY_LABELS[finding.category as FindingCategory] ?? finding.category}
                      {" · "}
                      {ruleLabel(finding.ruleId)}
                    </span>
                    {finding.documentLabel ? (
                      <span className="truncate text-xs text-ink-500">
                        资料：{finding.documentLabel}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-2 text-sm font-medium text-ink-900">{finding.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-700">{finding.detail}</p>

                  {finding.evidence ? (
                    <blockquote className="mt-2 border-l-2 border-ink-200 pl-3 text-xs leading-relaxed text-ink-500">
                      原文摘录：{finding.evidence}
                    </blockquote>
                  ) : null}

                  {finding.recommendation ? (
                    <p className="mt-2 text-xs text-ink-600">建议：{finding.recommendation}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="rounded-lg border border-ink-200 bg-white px-5 py-4 text-xs leading-relaxed text-ink-600">
        <h2 className="text-sm font-semibold text-ink-900">本次审核使用的模板配置</h2>
        <dl className="mt-2 grid gap-2 sm:grid-cols-2">
          <div>
            <dt className="text-ink-500">证照到期预警天数</dt>
            <dd className="text-ink-800">{config.expiryWarningDays} 天</dd>
          </div>
          <div>
            <dt className="text-ink-500">启用的规则</dt>
            <dd className="text-ink-800">
              {config.enabledRules.length === 0
                ? "全部内置规则"
                : `${config.enabledRules.length} 条`}
            </dd>
          </div>
        </dl>
        {config.requiredDocuments.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {config.requiredDocuments.map((item) => (
              <li key={item.key} className="text-ink-700">
                {item.required ? "必备" : "非必备"}：{item.label}
                <span className="text-ink-400">（关键词：{item.keywords.join(" / ")}）</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-ink-400">该模板未定义必备资料清单。</p>
        )}
        <p className="mt-3 text-ink-400">
          模板配置在发起审核时已快照保存，之后修改模板不会影响本次结论。
        </p>
      </section>
    </div>
  );
}

/** 引擎身份说明。mock 时必须显式说清楚，不能让用户误以为跑过模型推理。 */
function EngineNotice({ provider, model }: { provider: string; model: string }) {
  return (
    <section className="rounded-lg border border-warning-600/30 bg-amber-50 px-5 py-4">
      <p className="text-sm text-warning-600">
        <span className="font-medium">AI 复核未启用。</span>
        当前注册的 AI Provider 为开发模拟实现（{provider} / {model}），不产生任何真实判断。
        本页全部结论由确定性规则引擎产出，可逐条追溯到原文与判定依据。
      </p>
    </section>
  );
}

function SummarySection({ summary }: { summary: Partial<ReviewSummary> }) {
  const counts = summary.findingsBySeverity ?? ({} as Partial<Record<Severity, number>>);

  return (
    <section aria-labelledby="summary-heading" className="rounded-lg border border-ink-200 bg-white">
      <div className="border-b border-ink-100 px-5 py-3">
        <h2 id="summary-heading" className="text-sm font-semibold text-ink-900">
          本次审核概览
        </h2>
      </div>

      <dl className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-4">
        <Stat label="纳入资料" value={summary.documentCount ?? 0} suffix="份" />
        <Stat label="可读资料" value={summary.readableDocumentCount ?? 0} suffix="份" />
        <Stat label="执行规则" value={summary.executedRules?.length ?? 0} suffix="条" />
        <Stat label="发现问题" value={summary.findingCount ?? 0} suffix="条" />
      </dl>

      {summary.blockingCount !== undefined && summary.blockingCount > 0 ? (
        <p className="mx-5 mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger-600">
          存在 {summary.blockingCount} 条阻断项（严重 / 高），建议先让供应商补正资料再继续。
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-ink-100 px-5 py-3">
        {SEVERITIES.map((severity) => (
          <span
            key={severity}
            className={`rounded px-2 py-0.5 text-xs font-medium ${SEVERITY_BADGE_CLASS[severity]}`}
          >
            {SEVERITY_LABELS[severity]} {counts[severity] ?? 0}
          </span>
        ))}
      </div>

      {summary.coverageNotes && summary.coverageNotes.length > 0 ? (
        <div className="border-t border-ink-100 px-5 py-3">
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
  );
}

function Stat({ label, value, suffix }: { label: string; value: number; suffix: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink-900">
        {value}
        <span className="ml-1 text-xs font-normal text-ink-400">{suffix}</span>
      </dd>
    </div>
  );
}
