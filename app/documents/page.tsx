import Link from "next/link";

import { AutoRefresh } from "@/components/documents/auto-refresh";
import { ReprocessButton } from "@/components/documents/reprocess-button";
import { DocumentUploader } from "@/components/documents/uploader";
import { requireUser, requireWorkspaceAccess } from "@/lib/auth/guards";
import { ensureWorkspaceForUser } from "@/lib/auth/workspaces";
import { getEnv } from "@/lib/config/server-env";
import { listWorkspaceDocuments } from "@/lib/documents/repository";
import {
  STATUS_TONE_CLASS,
  documentStatusLabel,
  documentStatusTone,
  isPendingStatus,
  mimeTypeLabel,
  parserLabel,
} from "@/lib/documents/labels";
import { formatBytes } from "@/lib/files";

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

  const rows = await listWorkspaceDocuments(authorized.id);
  const env = getEnv();

  const counts = {
    total: rows.length,
    ready: rows.filter((row) => row.status === "READY").length,
    failed: rows.filter((row) => row.status === "FAILED").length,
    pending: rows.filter((row) => isPendingStatus(row.status)).length,
  };

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
        <Stat label="资料总数" value={counts.total} />
        <Stat label="可查看" value={counts.ready} />
        <Stat label="解析中" value={counts.pending} />
        <Stat label="解析失败" value={counts.failed} />
      </dl>

      <DocumentUploader workspaceId={authorized.id} maxBytes={env.MAX_UPLOAD_BYTES} />

      <section aria-labelledby="list-heading" className="rounded-lg border border-ink-200 bg-white">
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
          <h2 id="list-heading" className="text-sm font-semibold text-ink-900">
            已上传资料
          </h2>
          <span className="text-xs text-ink-500">最多显示 200 条</span>
        </div>

        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-500">
            还没有资料。请使用上方的上传区域添加供应商资料包。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-5 py-2 font-medium">文件名</th>
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
                      <td className="px-3 py-3 text-ink-600">{mimeTypeLabel(row.mimeType)}</td>
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
                          {row.status === "FAILED" && <ReprocessButton documentId={row.id} />}
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

      <section className="rounded-lg border border-ink-200 bg-white px-5 py-4 text-xs leading-relaxed text-ink-600">
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white px-4 py-3">
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-ink-900">{value}</dd>
    </div>
  );
}
