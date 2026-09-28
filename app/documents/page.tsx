import Link from "next/link";

import { AutoRefresh } from "@/components/documents/auto-refresh";
import { ReprocessButton } from "@/components/documents/reprocess-button";
import { DocumentUploader } from "@/components/documents/uploader";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon, type IconName } from "@/components/ui/icons";
import { deleteDocumentAction, restoreDocumentAction } from "@/app/actions/documents";
import { requireUser, requireWorkspaceAccess } from "@/lib/auth/guards";
import { ensureWorkspaceForUser } from "@/lib/auth/workspaces";
import { getEnv } from "@/lib/config/server-env";
import { listSoftDeletedDocuments, listWorkspaceDocuments } from "@/lib/documents/repository";
import {
  STATUS_TONE_CLASS,
  documentStatusLabel,
  documentStatusTone,
  isPendingStatus,
  mimeTypeLabel,
  parserLabel,
} from "@/lib/documents/labels";
import { formatBytes } from "@/lib/files";
import { MAX_DOCUMENTS_PER_RUN } from "@/lib/reviews/limits";
import { listWorkspaceSuppliers } from "@/lib/suppliers/repository";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "资料库",
  description: "上传并查看供应商资料包的解析状态与文本提取结果。",
};

export default async function DocumentsPage() {
  const user = await requireUser();
  const workspace = await ensureWorkspaceForUser(user.id);

  // 即使 workspaceId 来自服务端（会话推导），也照常走一次成员校验 ——
  // 授权路径只有一条，才不会有人不小心绕过它。
  const { workspace: authorized } = await requireWorkspaceAccess(workspace.id, {
    minimumRole: "VIEWER",
  });

  const [rows, deletedRows, suppliers] = await Promise.all([
    listWorkspaceDocuments(authorized.id),
    listSoftDeletedDocuments(authorized.id),
    listWorkspaceSuppliers(authorized.id, { includeArchived: true }),
  ]);
  const env = getEnv();

  const supplierNameById = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));

  const counts = {
    total: rows.length,
    ready: rows.filter((row) => row.status === "READY").length,
    failed: rows.filter((row) => row.status === "FAILED").length,
    pending: rows.filter((row) => isPendingStatus(row.status)).length,
  };

  // 「已解析」= 状态 READY 且确实提取到了正文。只按状态算会把「PDF 没有文本层」
  // 这类零字符的结果也算进来，于是用户点进去发现这份资料根本没参与审核。
  const readyIds = rows
    .filter((row) => row.status === "READY" && (row.charCount ?? 0) > 0)
    .map((row) => row.id);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">资料库</h1>
          <p className="mt-1 text-sm text-ink-500">
            上传供应商资料包，系统会在后台提取纯文本，为后续审核问答做准备。
          </p>
        </div>
        <AutoRefresh active={counts.pending > 0} />
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="资料总数" value={counts.total} icon="file" />
        <Stat label="可查看" value={counts.ready} icon="check-circle" tone="text-success-600 bg-emerald-50" />
        <Stat label="解析中" value={counts.pending} icon="clock" tone="text-brand-700 bg-brand-50" />
        <Stat label="解析失败" value={counts.failed} icon="alert-triangle" tone="text-danger-600 bg-red-50" />
      </dl>

      <DocumentUploader workspaceId={authorized.id} maxBytes={env.MAX_UPLOAD_BYTES} />

      {/*
        上传之后必须有下一步。
        「上传成功」不是终点，用户真正的目标是拿到审核结论 ——
        只有一个上传框的页面等于把人丢在半路。
      */}
      <section className="rounded-lg border border-brand-200 bg-brand-50 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-900">下一步：发起审核</h2>
            <p className="mt-1 text-xs text-ink-600">
              {readyIds.length > 0
                ? `当前有 ${readyIds.length} 份资料已提取到正文，可以立即发起审核。`
                : "还没有已解析完成的资料。解析通常需要几秒，完成后这里会出现入口。"}
            </p>
          </div>
          {readyIds.length > 0 ? (
            <div className="flex items-center gap-2">
              <Link
                href="/reviews"
                className="rounded-md border border-ink-300 bg-white px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
              >
                自行选择资料
              </Link>
              <Link
                href={`/reviews?${readyIds
                  .slice(0, MAX_DOCUMENTS_PER_RUN)
                  .map((id) => `document=${id}`)
                  .join("&")}`}
                className="rounded-md border border-transparent bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800"
              >
                审核已解析的 {Math.min(readyIds.length, MAX_DOCUMENTS_PER_RUN)} 份
              </Link>
            </div>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="list-heading" className="card">
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
          <h2 id="list-heading" className="text-sm font-semibold text-ink-900">
            已上传资料
          </h2>
          <span className="text-xs text-ink-500">最多显示 200 条</span>
        </div>

        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon="upload"
              title="还没有资料"
              hint="使用上方的上传区域添加供应商资料包；解析完成后即可发起审核。"
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-5 py-2 font-medium">文件名</th>
                  <th className="px-3 py-2 font-medium">归属供应商</th>
                  <th className="px-3 py-2 font-medium">类型</th>
                  <th className="px-3 py-2 font-medium">大小</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">提取结果</th>
                  <th className="px-5 py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const notes = Array.isArray(row.notes) ? (row.notes as string[]) : [];
                  return (
                    <tr key={row.id} className="border-b border-ink-100 last:border-b-0 align-top">
                      <td className="max-w-[280px] px-5 py-3">
                        <Link
                          href={`/documents/${row.id}`}
                          className="block truncate font-medium text-brand-700 hover:underline"
                          title={row.originalFilename}
                        >
                          {row.safeFilename}
                        </Link>
                        {row.parentDocumentId && (
                          <span className="mt-0.5 block text-xs text-ink-400">
                            来自压缩包 · {row.originalFilename}
                          </span>
                        )}
                      </td>
                      <td className="max-w-[160px] px-3 py-3 text-xs text-ink-600">
                        {row.supplierId ? (
                          <Link
                            href={`/suppliers`}
                            className="block truncate hover:text-brand-700"
                            title={supplierNameById.get(row.supplierId) ?? ""}
                          >
                            {supplierNameById.get(row.supplierId) ?? "主体已删除"}
                          </Link>
                        ) : (
                          <span className="text-ink-400">未归属</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span className="flex items-center gap-1.5 text-ink-600">
                          <Icon name={mimeTypeIcon(row.mimeType)} className="h-3.5 w-3.5 text-ink-400" />
                          {mimeTypeLabel(row.mimeType)}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-ink-600">{formatBytes(row.size)}</td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_TONE_CLASS[documentStatusTone(row.status)]}`}
                        >
                          {documentStatusLabel(row.status)}
                        </span>
                      </td>
                      <td className="max-w-[240px] px-3 py-3 text-xs text-ink-600">
                        {row.parserId ? (
                          <>
                            <span className="block">
                              {parserLabel(row.parserId)} · {(row.charCount ?? 0).toLocaleString("zh-CN")} 字
                              {row.truncated ? "（已截断）" : ""}
                            </span>
                            {notes.length > 0 && (
                              <span className="mt-0.5 block text-ink-400">{notes[0]}</span>
                            )}
                          </>
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <a
                            href={`/api/files/${row.id}`}
                            className="rounded border border-ink-300 bg-white px-2 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50"
                          >
                            下载
                          </a>
                          {row.status === "READY" && (row.charCount ?? 0) > 0 ? (
                            <Link
                              href={`/reviews?document=${row.id}${
                                row.supplierId ? `&supplier=${row.supplierId}` : ""
                              }`}
                              className="rounded border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100"
                            >
                              发起审核
                            </Link>
                          ) : null}
                          {row.status === "FAILED" && <ReprocessButton documentId={row.id} />}
                          <form action={deleteDocumentAction}>
                            <input type="hidden" name="documentId" value={row.id} />
                            <ConfirmSubmitButton
                              variant="danger"
                              message="确定删除这份资料吗？30 天内可以在页面下方恢复，超过 30 天将被彻底清除。"
                            >
                              删除
                            </ConfirmSubmitButton>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/*
        回收站：软删 30 天内可恢复，超过窗口由 /api/cron/gc 彻底清除。
        只在确实有软删行时渲染 —— 平时这个区块不存在，不打扰正常流程。
      */}
      {deletedRows.length > 0 && (
        <section aria-labelledby="trash-heading" className="card">
          <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
            <div>
              <h2 id="trash-heading" className="text-sm font-semibold text-ink-900">
                已删除资料
              </h2>
              <p className="mt-0.5 text-xs text-ink-500">
                删除的资料在这里保留 30 天，可随时恢复；超过 30 天将被彻底清除，无法找回。
              </p>
            </div>
            <span className="text-xs text-ink-500">最多显示 50 条</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-5 py-2 font-medium">文件名</th>
                  <th className="px-3 py-2 font-medium">类型</th>
                  <th className="px-3 py-2 font-medium">大小</th>
                  <th className="px-3 py-2 font-medium">删除时间</th>
                  <th className="px-5 py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {deletedRows.map((row) => (
                  <tr key={row.id} className="border-b border-ink-100 last:border-b-0 align-top">
                    <td className="max-w-[280px] px-5 py-3">
                      <span className="block truncate font-medium text-ink-700" title={row.originalFilename}>
                        {row.safeFilename}
                      </span>
                      {row.parentDocumentId && (
                        <span className="mt-0.5 block text-xs text-ink-400">来自压缩包</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-ink-600">{mimeTypeLabel(row.mimeType)}</td>
                    <td className="px-3 py-3 text-ink-600">{formatBytes(row.size)}</td>
                    <td className="px-3 py-3 text-xs text-ink-600">
                      {row.deletedAt?.toLocaleString("zh-CN", { hour12: false })}
                    </td>
                    <td className="px-5 py-3">
                      <form action={restoreDocumentAction}>
                        <input type="hidden" name="documentId" value={row.id} />
                        <ConfirmSubmitButton message={`确定恢复「${row.safeFilename}」吗？`}>
                          恢复
                        </ConfirmSubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card rounded-lg px-5 py-4 text-xs leading-relaxed text-ink-600">
        <h2 className="text-sm font-semibold text-ink-900">关于解析能力的说明</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>所有文件存放在私有目录，只能通过登录后的授权接口下载，不产生任何公开链接。</li>
          <li>PDF 仅提取文本层；扫描件没有文本层时不会伪造内容，会在列表中如实标注。</li>
          <li>图片暂不支持本地 OCR，待接入外部识别服务；文件仍完整保存、可下载预览。</li>
          <li>为控制内存占用，单份文档的提取文本有长度上限，超出部分会被截断并标注。</li>
        </ul>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  tone = "text-brand-700 bg-brand-50",
}: {
  label: string;
  value: number;
  icon: IconName;
  tone?: string;
}) {
  return (
    <div className="card px-4 py-3">
      <dt className="flex items-center gap-1.5 text-xs text-ink-500">
        <span className={`flex h-5 w-5 items-center justify-center rounded ${tone}`} aria-hidden="true">
          <Icon name={icon} className="h-3 w-3" />
        </span>
        {label}
      </dt>
      <dd className="mt-1.5 text-lg font-semibold text-ink-900">{value}</dd>
    </div>
  );
}

/** 文件类型 → 图标。图片和压缩包有专属图标，其余一律通用文件。 */
function mimeTypeIcon(mimeType: string): IconName {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/zip") return "archive";
  return "file";
}
