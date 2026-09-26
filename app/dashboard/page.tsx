import type { Metadata } from "next";
import Link from "next/link";
import { and, count, eq, isNull } from "drizzle-orm";

import { MOCK_DISCLAIMER, MOCK_PROVIDER_ID } from "@/lib/ai";
import { requireActionWorkspace } from "@/lib/auth/action-context";
import { getEnv } from "@/lib/config/server-env";
import { getDb } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { listWorkspaceDocuments } from "@/lib/documents/repository";
import { runStatusClass, runStatusLabel, SEVERITY_LABELS } from "@/lib/reviews/labels";
import {
  countFindingsByRuns,
  countReviewRunsByStatus,
  listWorkspaceReviewRuns,
} from "@/lib/reviews/repository";
import { listWorkspaceSuppliers } from "@/lib/suppliers/repository";
import { SEVERITIES } from "@/lib/reviews/types";

export const metadata: Metadata = {
  title: "工作台",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { workspace, role } = await requireActionWorkspace("VIEWER");
  const env = getEnv();

  const [documents, suppliers, runs, documentTotal] = await Promise.all([
    listWorkspaceDocuments(workspace.id),
    listWorkspaceSuppliers(workspace.id),
    listWorkspaceReviewRuns(workspace.id, { limit: 5 }),
    countDocuments(workspace.id),
  ]);

  const findingCounts = await countFindingsByRuns(runs.map((run) => run.id));
  const countsByRun = new Map<string, Partial<Record<string, number>>>();
  for (const row of findingCounts) {
    const entry = countsByRun.get(row.reviewRunId) ?? {};
    entry[row.severity] = row.total;
    countsByRun.set(row.reviewRunId, entry);
  }

  const readyDocuments = documents.filter((row) => row.status === "READY").length;
  const readyRuns = await countReadyRuns(workspace.id);

  const stats = [
    { label: "已上传资料", value: documentTotal, hint: "份", href: "/documents" },
    { label: "已解析可审", value: readyDocuments, hint: "份", href: "/documents" },
    { label: "供应商", value: suppliers.length, hint: "家", href: "/suppliers" },
    { label: "审核报告", value: readyRuns, hint: "份", href: "/reports" },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">工作台</h1>
        <p className="mt-2 text-sm text-ink-600">
          {workspace.name} · 当前角色 {role}
        </p>
      </header>

      <section aria-label="数据概览" className="grid gap-4 sm:grid-cols-4">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="rounded-lg border border-ink-200 bg-white p-5 hover:border-brand-300"
          >
            <p className="text-sm text-ink-500">{stat.label}</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums text-ink-900">
              {stat.value}
              <span className="ml-1 text-sm font-normal text-ink-400">{stat.hint}</span>
            </p>
          </Link>
        ))}
      </section>

      <section
        aria-labelledby="flow-heading"
        className="rounded-lg border border-ink-200 bg-white p-6"
      >
        <h2 id="flow-heading" className="text-base font-semibold text-ink-900">
          怎么用
        </h2>
        <ol className="mt-4 space-y-3 text-sm leading-6 text-ink-600">
          <li>
            <span className="font-medium text-ink-800">1. 上传资料</span> —— 在
            <Link href="/documents" className="mx-1 text-brand-700 hover:underline">
              资料库
            </Link>
            上传供应商资料包（PDF / Word / Excel / 图片 / zip），系统后台提取正文。
          </li>
          <li>
            <span className="font-medium text-ink-800">2. 登记供应商（可选）</span> —— 在
            <Link href="/suppliers" className="mx-1 text-brand-700 hover:underline">
              供应商
            </Link>
            登记主体名称与统一社会信用代码，审核时会核对资料里的主体是否一致。
          </li>
          <li>
            <span className="font-medium text-ink-800">3. 发起审核</span> —— 在
            <Link href="/reviews" className="mx-1 text-brand-700 hover:underline">
              资料审核
            </Link>
            选择模板与资料，一次审核通常几十秒内完成。
          </li>
          <li>
            <span className="font-medium text-ink-800">4. 看结论</span> —— 在
            <Link href="/reports" className="mx-1 text-brand-700 hover:underline">
              审核报告
            </Link>
            查看逐条发现；每条结论都带原文摘录，可回原文核对。
          </li>
        </ol>
      </section>

      <section aria-labelledby="recent-heading" className="rounded-lg border border-ink-200 bg-white">
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
          <h2 id="recent-heading" className="text-sm font-semibold text-ink-900">
            最近审核
          </h2>
          <Link href="/reviews" className="text-xs text-brand-700 hover:underline">
            全部记录
          </Link>
        </div>

        {runs.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-500">
            还没有发起过审核。先到
            <Link href="/documents" className="mx-1 text-brand-700 hover:underline">
              资料库
            </Link>
            上传资料，再到
            <Link href="/reviews" className="mx-1 text-brand-700 hover:underline">
              资料审核
            </Link>
            发起。
          </p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {runs.map((run) => {
              const counts = countsByRun.get(run.id) ?? {};
              return (
                <li key={run.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <Link
                      href={`/reviews/${run.id}`}
                      className="block truncate text-sm font-medium text-brand-700 hover:underline"
                    >
                      {run.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {run.templateName} · {(run.documentIds as unknown[]).length} 份资料
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="flex flex-wrap gap-x-2 text-xs text-ink-600">
                      {SEVERITIES.filter((severity) => (counts[severity] ?? 0) > 0).map((severity) => (
                        <span key={severity}>
                          {SEVERITY_LABELS[severity]} {counts[severity]}
                        </span>
                      ))}
                    </span>
                    <span
                      className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${runStatusClass(run.status)}`}
                    >
                      {runStatusLabel(run.status)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {env.AI_PROVIDER === MOCK_PROVIDER_ID ? (
        <div className="rounded-md border border-warning-600/30 bg-amber-50 px-4 py-3">
          <p className="text-sm text-warning-600">
            <span className="font-medium">AI 复核未启用：</span>
            {MOCK_DISCLAIMER}
            当前所有审核结论均由确定性规则引擎产出，不含任何模型推测。
          </p>
        </div>
      ) : null}
    </div>
  );
}

async function countDocuments(workspaceId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ value: count() })
    .from(documents)
    .where(and(eq(documents.workspaceId, workspaceId), isNull(documents.deletedAt)));
  return row?.value ?? 0;
}

async function countReadyRuns(workspaceId: string): Promise<number> {
  const rows = await countReviewRunsByStatus(workspaceId);
  return rows.find((row) => row.status === "READY")?.total ?? 0;
}
