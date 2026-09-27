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
import { Icon, type IconName } from "@/components/ui/icons";
import { SeverityBar } from "@/components/ui/severity-bar";

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

  // 四张卡的图标与底色语义：可审核/报告是「资产」用品牌蓝与绿，
  // 供应商是待办提醒（审核要用它核对主体），所以给琥珀 —— 颜色只在表达状态差异时使用。
  const stats: Array<{
    label: string;
    value: number;
    hint: string;
    href: string;
    icon: IconName;
    tone: string;
  }> = [
    {
      label: "已上传资料",
      value: documentTotal,
      hint: "份",
      href: "/documents",
      icon: "upload",
      tone: "bg-brand-50 text-brand-700",
    },
    {
      label: "已解析可审",
      value: readyDocuments,
      hint: "份",
      href: "/documents",
      icon: "check-circle",
      tone: "bg-emerald-50 text-success-600",
    },
    {
      label: "供应商",
      value: suppliers.length,
      hint: "家",
      href: "/suppliers",
      icon: "building",
      tone: "bg-amber-50 text-warning-600",
    },
    {
      label: "审核报告",
      value: readyRuns,
      hint: "份",
      href: "/reports",
      icon: "file-check",
      tone: "bg-brand-50 text-brand-700",
    },
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
          <Link key={stat.label} href={stat.href} className="card p-5 transition-colors hover:border-brand-300">
            <div className="flex items-center gap-2">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-md ${stat.tone}`}
                aria-hidden="true"
              >
                <Icon name={stat.icon} className="h-3.5 w-3.5" />
              </span>
              <p className="text-sm text-ink-500">{stat.label}</p>
            </div>
            <p className="mt-3 text-3xl font-semibold tabular-nums text-ink-900">
              {stat.value}
              <span className="ml-1 text-sm font-normal text-ink-400">{stat.hint}</span>
            </p>
          </Link>
        ))}
      </section>

      <FlowStepper
        readyDocuments={readyDocuments}
        suppliers={suppliers.length}
        readyRuns={readyRuns}
      />

      <section aria-labelledby="recent-heading" className="card">
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
                    <SeverityBar counts={counts} />
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

/**
 * 横向四步条 —— 替代原来整段「怎么用」文字。
 *
 * 每一步的副文案都是**当前工作区的真实数字**（就绪资料数、供应商数、报告数），
 * 不写任何演示数据；「登记供应商」是可选步骤，用琥珀色与必选步骤区分。
 * 步骤可点（标题即链接），用户从概览一步跳到对应页面。
 */
function FlowStepper({
  readyDocuments,
  suppliers,
  readyRuns,
}: {
  readyDocuments: number;
  suppliers: number;
  readyRuns: number;
}) {
  const steps = [
    {
      label: "上传资料",
      href: "/documents",
      hint: readyDocuments > 0 ? `已就绪 ${readyDocuments} 份` : "在资料库上传资料包",
      done: readyDocuments > 0,
      optional: false,
    },
    {
      label: "登记供应商",
      href: "/suppliers",
      hint: suppliers > 0 ? `${suppliers} 家已登记` : "可选项，用于核对主体一致性",
      done: suppliers > 0,
      optional: true,
    },
    {
      label: "发起审核",
      href: "/reviews",
      hint: readyRuns > 0 ? "规则引擎执行，通常几十秒" : "选择模板与资料发起",
      done: readyRuns > 0,
      optional: false,
    },
    {
      label: "查看结论",
      href: "/reports",
      hint: readyRuns > 0 ? `${readyRuns} 份报告` : "每条结论带原文摘录",
      done: readyRuns > 0,
      optional: false,
    },
  ];

  // 必选步骤里第一个未完成的 =「当前应该做的事」。
  const currentStep = steps.find((step) => !step.done && !step.optional);

  return (
    <section aria-label="使用流程" className="card px-5 py-4">
      <ol className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {steps.map((step, index) => {
          const isCurrent = step === currentStep;
          return (
            <li key={step.href} className="flex min-w-0 flex-1 items-center gap-2.5">
              {index > 0 ? (
                <Icon
                  name="arrow-right"
                  className="mx-1 hidden h-3.5 w-3.5 shrink-0 text-ink-300 sm:block"
                />
              ) : null}
              <Link href={step.href} className="flex min-w-0 items-center gap-2.5">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                    step.done
                      ? "bg-brand-700 text-white"
                      : step.optional
                        ? "border border-amber-200 bg-amber-50 text-warning-600"
                        : isCurrent
                          ? "border border-brand-300 bg-brand-50 text-brand-700"
                          : "border border-ink-200 bg-white text-ink-400"
                  }`}
                  aria-hidden="true"
                >
                  {step.done ? <Icon name="check" className="h-3 w-3" /> : index + 1}
                </span>
                <span className="min-w-0">
                  <span
                    className={`block truncate text-sm font-medium ${
                      isCurrent ? "text-ink-900" : "text-ink-700"
                    }`}
                  >
                    {step.label}
                    {step.optional ? <span className="ml-1 text-xs text-ink-400">（可选）</span> : null}
                  </span>
                  <span className="block truncate text-xs text-ink-500">{step.hint}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
