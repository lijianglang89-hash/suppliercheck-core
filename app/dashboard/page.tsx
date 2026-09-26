import type { Metadata } from "next";
import { and, count, eq, isNull } from "drizzle-orm";

import { MOCK_DISCLAIMER } from "@/lib/ai";
import { requireUser, requireWorkspaceAccess } from "@/lib/auth/guards";
import { ensureWorkspaceForUser } from "@/lib/auth/workspaces";
import { getDb } from "@/lib/db";
import { auditReports, documents, questionnaires } from "@/lib/db/schema";

export const metadata: Metadata = {
  title: "工作台",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const active = await ensureWorkspaceForUser(user.id);

  // 所有工作区数据的读取都必须先过这道授权闸门。
  // 即使 workspaceId 来源于服务端查询结果也照走一遍 —— 保持唯一入口，将来才不会漏检。
  const context = await requireWorkspaceAccess(active.id);
  const workspaceId = context.workspace.id;

  const [documentCount, questionnaireCount, reportCount] = await Promise.all([
    countDocuments(workspaceId),
    countQuestionnaires(workspaceId),
    countReports(workspaceId),
  ]);

  const stats = [
    { label: "已上传资料", value: documentCount, hint: "份" },
    { label: "审核问卷", value: questionnaireCount, hint: "份" },
    { label: "审核报告", value: reportCount, hint: "份" },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">工作台</h1>
      <p className="mt-2 text-sm text-ink-600">
        {context.workspace.name} · 当前角色 {context.role}
      </p>

      <section aria-label="数据概览" className="mt-8 grid gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-ink-200 bg-white p-5">
            <p className="text-sm text-ink-500">{stat.label}</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums text-ink-900">
              {stat.value}
              <span className="ml-1 text-sm font-normal text-ink-400">{stat.hint}</span>
            </p>
          </div>
        ))}
      </section>

      <section
        aria-labelledby="get-started-heading"
        className="mt-8 rounded-lg border border-ink-200 bg-white p-6"
      >
        <h2 id="get-started-heading" className="text-base font-semibold text-ink-900">
          V0.1 已就绪的能力
        </h2>
        <ul className="mt-4 space-y-2 text-sm leading-6 text-ink-600">
          <li>· 账号体系与登录会话（HttpOnly 签名 Cookie）</li>
          <li>· 工作区隔离与多租户授权校验</li>
          <li>· 私有文件存储抽象（本地卷，不对外暴露 URL）</li>
          <li>· AI Provider 抽象层（当前为开发模拟实现）</li>
        </ul>

        <div className="mt-5 rounded-md border border-warning-600/30 bg-amber-50 px-4 py-3">
          <p className="text-sm text-warning-600">
            <span className="font-medium">开发模拟状态：</span>
            {MOCK_DISCLAIMER}
          </p>
        </div>

        <p className="mt-5 text-sm text-ink-500">
          下一步将为「供应商资料包文件处理引擎」：支持上传资料包、解析 PDF / Word / Excel /
          图片、登记文档处理任务。该能力尚未在本版本中开放。
        </p>
      </section>
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

async function countQuestionnaires(workspaceId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ value: count() })
    .from(questionnaires)
    .where(and(eq(questionnaires.workspaceId, workspaceId), isNull(questionnaires.deletedAt)));
  return row?.value ?? 0;
}

async function countReports(workspaceId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ value: count() })
    .from(auditReports)
    .where(eq(auditReports.workspaceId, workspaceId));
  return row?.value ?? 0;
}
