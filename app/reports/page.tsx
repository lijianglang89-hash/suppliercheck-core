import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icons";
import { SeverityBar } from "@/components/ui/severity-bar";
import { requireActionWorkspace } from "@/lib/auth/action-context";
import { SEVERITY_BADGE_CLASS, SEVERITY_LABELS } from "@/lib/reviews/labels";
import { countFindingsByRuns, listWorkspaceReviewRuns } from "@/lib/reviews/repository";
import { listWorkspaceSuppliers } from "@/lib/suppliers/repository";
import { SEVERITIES, type Severity } from "@/lib/reviews/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "审核报告",
  description: "查看已完成审核的结论报告。",
  robots: { index: false, follow: false },
};

export default async function ReportsPage() {
  const { workspace } = await requireActionWorkspace("VIEWER");

  const [runs, suppliers] = await Promise.all([
    listWorkspaceReviewRuns(workspace.id, { status: "READY", limit: 100 }),
    listWorkspaceSuppliers(workspace.id, { includeArchived: true }),
  ]);

  const findingCounts = await countFindingsByRuns(runs.map((run) => run.id));
  const countsByRun = new Map<string, Partial<Record<Severity, number>>>();
  for (const row of findingCounts) {
    const entry = countsByRun.get(row.reviewRunId) ?? {};
    entry[row.severity] = row.total;
    countsByRun.set(row.reviewRunId, entry);
  }

  const supplierNameById = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">审核报告</h1>
        <p className="mt-1 text-sm text-ink-500">
          只列出已完成的审核。执行中或失败的审核在
          <Link href="/reviews" className="mx-1 text-brand-700 hover:underline">
            资料审核
          </Link>
          查看。
        </p>
      </header>

      {runs.length === 0 ? (
        <EmptyState
          icon="file-check"
          title="还没有已完成的审核报告"
          hint="在资料审核里选择模板与资料发起一次审核，通常几十秒内出结论；执行中或失败的审核在资料审核页查看。"
        >
          <Link
            href="/reviews"
            className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800"
          >
            去发起审核
          </Link>
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {runs.map((run) => {
            const counts = countsByRun.get(run.id) ?? {};
            const blocking = (counts.CRITICAL ?? 0) + (counts.HIGH ?? 0);
            return (
              <li key={run.id} className="card px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/reports/${run.id}`}
                      className="flex items-center gap-1.5 truncate text-sm font-semibold text-brand-700 hover:underline"
                    >
                      <Icon name="file-check" className="h-4 w-4 shrink-0 text-brand-500" />
                      {run.name}
                    </Link>
                    <p className="mt-1 text-xs text-ink-500">
                      {run.templateName}
                      {" · "}
                      {run.supplierId
                        ? (supplierNameById.get(run.supplierId) ?? "主体已删除")
                        : "未关联供应商"}
                      {" · "}
                      完成于{" "}
                      {(run.finishedAt ?? run.updatedAt).toLocaleString("zh-CN", {
                        timeZone: "Asia/Shanghai",
                      })}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <SeverityBar counts={counts} />
                    {SEVERITIES.filter((severity) => (counts[severity] ?? 0) > 0).map((severity) => (
                      <span
                        key={severity}
                        className={`rounded px-2 py-0.5 text-xs font-medium ${SEVERITY_BADGE_CLASS[severity]}`}
                      >
                        {SEVERITY_LABELS[severity]} {counts[severity]}
                      </span>
                    ))}
                    {Object.keys(counts).length === 0 ? (
                      <span className="rounded bg-ink-100 px-2 py-0.5 text-xs font-medium text-success-600">
                        未发现问题
                      </span>
                    ) : null}
                  </div>
                </div>

                {blocking > 0 ? (
                  <p className="mt-3 flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-danger-600">
                    <Icon name="alert-triangle" className="h-3.5 w-3.5 shrink-0" />
                    存在 {blocking} 条阻断项，建议先让供应商补正资料再继续。
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-ink-400">
        报告页可用浏览器的打印功能导出为 PDF（Ctrl / Cmd + P），打印时会自动隐藏导航与操作按钮。
      </p>
    </div>
  );
}
