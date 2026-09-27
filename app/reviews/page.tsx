import Link from "next/link";

import { CreateReviewForm, type DocumentOption } from "@/components/reviews/create-review-form";
import { AutoRefresh } from "@/components/documents/auto-refresh";
import { requireActionWorkspace } from "@/lib/auth/action-context";
import { listWorkspaceDocuments } from "@/lib/documents/repository";
import { documentStatusLabel } from "@/lib/documents/labels";
import { formatBytes } from "@/lib/files";
import { MAX_DOCUMENTS_PER_RUN } from "@/lib/reviews/limits";
import {
  SEVERITY_LABELS,
  isRunPending,
  runStatusClass,
  runStatusLabel,
} from "@/lib/reviews/labels";
import { countFindingsByRuns, listWorkspaceReviewRuns } from "@/lib/reviews/repository";
import { listWorkspaceSuppliers } from "@/lib/suppliers/repository";
import { listAvailableTemplates } from "@/lib/templates/service";
import { SEVERITIES, type Severity } from "@/lib/reviews/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "资料审核",
  description: "选择审核模板与资料包，发起一次供应商资料审核。",
};

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace } = await requireActionWorkspace("VIEWER");
  const params = await searchParams;

  const [templates, suppliers, documents, runs] = await Promise.all([
    listAvailableTemplates(workspace.id),
    listWorkspaceSuppliers(workspace.id),
    listWorkspaceDocuments(workspace.id),
    listWorkspaceReviewRuns(workspace.id, { limit: 30 }),
  ]);

  const findingCounts = await countFindingsByRuns(runs.map((run) => run.id));
  const countsByRun = new Map<string, Partial<Record<Severity, number>>>();
  for (const row of findingCounts) {
    const entry = countsByRun.get(row.reviewRunId) ?? {};
    entry[row.severity] = row.total;
    countsByRun.set(row.reviewRunId, entry);
  }

  const supplierNameById = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));

  // 审核只能基于已登记的资料；前端不选，但列表里要把所有资料都列出来供勾选。
  const documentOptions: DocumentOption[] = documents.map((row) => ({
    id: row.id,
    label: row.safeFilename,
    safeFilename: row.safeFilename,
    status: row.status,
    statusLabel: documentStatusLabel(row.status),
    charCount: row.charCount,
    parserId: row.parserId,
    supplierId: row.supplierId,
  }));

  const pendingRuns = runs.filter((run) => isRunPending(run.status)).length;

  /**
   * 从资料库带过来的预选。
   *
   * URL 里的 id 只被当作「界面初始值」使用 —— 不在列表里的 id 直接丢弃，
   * 真正的归属校验在服务端（createReviewRunAndEnqueue 会逐条回库确认）。
   * 这里过滤只是为了不让一个不存在的 id 撑起「已选择 1 份」的假象。
   */
  const knownIds = new Set(documents.map((row) => row.id));
  const initialDocumentIds = toStringArray(params.document).filter((id) => knownIds.has(id));
  const initialSupplierId =
    typeof params.supplier === "string" && suppliers.some((row) => row.id === params.supplier)
      ? params.supplier
      : "";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">资料审核</h1>
          <p className="mt-1 text-sm text-ink-500">
            选择审核模板与资料包，发起一次审核。审核由确定性规则引擎执行，每条结论都能追溯到原文。
          </p>
        </div>
        <AutoRefresh active={pendingRuns > 0} />
      </header>

      <section
        aria-labelledby="create-review-heading"
        className="card p-5"
      >
        <h2 id="create-review-heading" className="text-sm font-semibold text-ink-900">
          发起一次审核
        </h2>
        <div className="mt-4">
          <CreateReviewForm
            templates={templates.map((template) => ({
              key: template.key,
              name: template.name,
              description: template.description,
              source: template.source,
            }))}
            suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }))}
            documents={documentOptions}
            maxDocuments={MAX_DOCUMENTS_PER_RUN}
            initialDocumentIds={initialDocumentIds}
            initialSupplierId={initialSupplierId}
          />
        </div>
      </section>

      <section aria-labelledby="run-list-heading" className="card">
        <div className="border-b border-ink-100 px-5 py-3">
          <h2 id="run-list-heading" className="text-sm font-semibold text-ink-900">
            审核记录
          </h2>
          <p className="mt-0.5 text-xs text-ink-500">
            最多显示最近 30 条；已完成的审核可在
            <Link href="/reports" className="mx-1 text-brand-700 hover:underline">
              审核报告
            </Link>
            查看完整结论。
          </p>
        </div>

        {runs.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-500">
            还没有发起过审核。
          </p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {runs.map((run) => {
              const counts = countsByRun.get(run.id) ?? {};
              return (
                <li key={run.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/reviews/${run.id}`}
                        className="block truncate text-sm font-medium text-brand-700 hover:underline"
                      >
                        {run.name}
                      </Link>
                      <p className="mt-0.5 text-xs text-ink-500">
                        {run.templateName}
                        {" · "}
                        {run.supplierId
                          ? (supplierNameById.get(run.supplierId) ?? "主体已删除")
                          : "未关联供应商"}
                        {" · "}
                        {(run.documentIds as unknown[]).length} 份资料
                        {" · "}
                        {run.createdAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${runStatusClass(run.status)}`}
                    >
                      {runStatusLabel(run.status)}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    {SEVERITIES.filter((severity) => (counts[severity] ?? 0) > 0).map((severity) => (
                      <span key={severity} className="text-ink-600">
                        {SEVERITY_LABELS[severity]} {counts[severity]}
                      </span>
                    ))}
                    {Object.keys(counts).length === 0 && run.status === "READY" ? (
                      <span className="text-success-600">未发现问题</span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card px-5 py-4 text-xs leading-relaxed text-ink-600">
        <h2 className="text-sm font-semibold text-ink-900">关于审核能力的说明</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            审核全部由确定性规则执行：必备资料是否出现、证照有效期是否过期、
            统一社会信用代码校验位是否正确、金额大小写是否一致。同样的资料必然得到同样的结论。
          </li>
          <li>
            系统不会为了让报告「好看」而补结论。解析不出日期的条目会被标为「无法判定」，
            而不是按发证日期推算出一个到期日。
          </li>
          <li>
            未提取到正文的扫描件不参与审核，并会在结论里明确列出 —— 覆盖了多少资料，报告里写得清清楚楚。
          </li>
          <li>
            图片附件目前需要人工查看原文件；共 {formatBytes(documents.reduce((sum, row) => sum + row.size, 0))} 的资料存放在私有目录，
            只能通过登录后的授权接口下载。
          </li>
        </ul>
      </section>
    </div>
  );
}

/** 查询参数可能是单值也可能是重复键的数组，统一折成字符串数组。 */
function toStringArray(value: string | string[] | undefined): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value;
  return [];
}
