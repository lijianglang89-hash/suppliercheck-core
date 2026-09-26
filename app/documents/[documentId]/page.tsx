import Link from "next/link";
import { notFound } from "next/navigation";

import { assignDocumentSupplierAction } from "@/app/actions/suppliers";
import { AutoRefresh } from "@/components/documents/auto-refresh";
import { ReprocessButton } from "@/components/documents/reprocess-button";
import { SubmitButton } from "@/components/ui/submit-button";
import { requireUser, requireWorkspaceAccess } from "@/lib/auth/guards";
import { getEnv } from "@/lib/config/server-env";
import { findDocumentById, findDocumentText } from "@/lib/documents/repository";
import {
  STATUS_TONE_CLASS,
  documentStatusLabel,
  documentStatusTone,
  isPendingStatus,
  mimeTypeLabel,
  parserLabel,
} from "@/lib/documents/labels";
import { formatBytes, isUuid } from "@/lib/files";
import { getStorageProvider } from "@/lib/storage";
import { listWorkspaceSuppliers } from "@/lib/suppliers/repository";

export const dynamic = "force-dynamic";

const PREVIEW_CHARS = 5_000;

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  if (!isUuid(documentId)) notFound();

  const user = await requireUser();
  const document = await findDocumentById(documentId);
  if (!document) notFound();

  // 授权依据是数据库里这行的 workspaceId —— 不是 URL 里的任何东西。
  const { workspace: authorized } = await requireWorkspaceAccess(document.workspaceId, {
    minimumRole: "VIEWER",
  });
  void user;

  const [extraction, suppliers] = await Promise.all([
    findDocumentText(documentId),
    listWorkspaceSuppliers(authorized.id, { includeArchived: true }),
  ]);

  // 签名 URL 演示：仍然需要登录会话才能用（见 /api/files/signed 的说明）。
  const signedUrl = await getStorageProvider().getSignedUrl(document.storagePath, {
    expiresInSeconds: 300,
    downloadFilename: document.safeFilename,
  });

  const notes = Array.isArray(extraction?.notes) ? (extraction?.notes as string[]) : [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/documents" className="text-xs text-brand-700 hover:underline">
          ← 返回资料库
        </Link>
      </div>

      <header className="rounded-lg border border-ink-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight text-ink-900" title={document.originalFilename}>
              {document.safeFilename}
            </h1>
            <p className="mt-1 text-xs text-ink-500">
              {mimeTypeLabel(document.mimeType)} · {formatBytes(document.size)} · 上传于{" "}
              {document.createdAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
            </p>
          </div>
          <span
            className={`inline-block shrink-0 rounded px-2 py-0.5 text-xs font-medium ${STATUS_TONE_CLASS[documentStatusTone(document.status)]}`}
          >
            {documentStatusLabel(document.status)}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href={`/api/files/${document.id}`}
            className="rounded border border-ink-300 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
          >
            下载原件
          </a>
          <a
            href={`/api/files/${document.id}?disposition=inline`}
            className="rounded border border-ink-300 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
          >
            浏览器预览（PDF / 图片）
          </a>
          {document.status === "FAILED" && <ReprocessButton documentId={document.id} />}
          {(extraction?.charCount ?? 0) > 0 ? (
            <Link
              href={`/reviews?document=${document.id}${
                document.supplierId ? `&supplier=${document.supplierId}` : ""
              }`}
              className="rounded border border-transparent bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800"
            >
              用这份资料发起审核
            </Link>
          ) : null}
          <AutoRefresh active={isPendingStatus(document.status)} />
        </div>

        <p className="mt-3 break-all text-[11px] leading-relaxed text-ink-400">
          签名下载地址（5 分钟内有效，且仍需登录会话）：
          <br />
          {signedUrl}
        </p>
      </header>

      <section
        aria-labelledby="supplier-heading"
        className="rounded-lg border border-ink-200 bg-white px-5 py-4"
      >
        <h2 id="supplier-heading" className="text-sm font-semibold text-ink-900">
          归属供应商
        </h2>
        <p className="mt-1 text-xs text-ink-500">
          指定后，审核时会在「主体一致性」里核对这份资料上出现的主体名称。不指定也能审核。
        </p>

        {suppliers.length === 0 ? (
          <p className="mt-3 text-xs text-ink-500">
            还没有登记供应商。先到
            <Link href="/suppliers" className="mx-1 text-brand-700 hover:underline">
              供应商
            </Link>
            登记一个。
          </p>
        ) : (
          <form action={assignDocumentSupplierAction} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="documentId" value={document.id} />
            <div className="min-w-[240px]">
              <label htmlFor="supplierId" className="block text-xs font-medium text-ink-700">
                供应商
              </label>
              <select
                id="supplierId"
                name="supplierId"
                defaultValue={document.supplierId ?? ""}
                className="mt-1.5 block w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-600 focus:outline-none"
              >
                <option value="">不归属任何供应商</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                    {supplier.status !== "ACTIVE" ? "（已归档）" : ""}
                  </option>
                ))}
              </select>
            </div>
            <SubmitButton variant="secondary" pendingText="保存中…">
              保存归属
            </SubmitButton>
          </form>
        )}
      </section>

      <section className="rounded-lg border border-ink-200 bg-white">
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink-900">文本提取</h2>
          {extraction && (
            <span className="text-xs text-ink-500">
              {parserLabel(extraction.parserId)} · {extraction.charCount.toLocaleString("zh-CN")} 字
              {extraction.truncated ? " · 已截断" : ""}
            </span>
          )}
        </div>

        <div className="px-5 py-4">
          {!extraction ? (
            <p className="text-sm text-ink-500">
              {isPendingStatus(document.status)
                ? "正在解析，请稍候。"
                : "尚没有提取结果。"}
            </p>
          ) : (
            <>
              {notes.length > 0 && (
                <ul className="mb-3 list-disc space-y-1 pl-5 text-xs text-warning-600">
                  {notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}

              {extraction.text.length === 0 ? (
                <p className="text-sm text-ink-500">
                  该文件没有可提取的文本（详见上方说明）。文件原件已完整保存。
                </p>
              ) : (
                <>
                  <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-ink-100 bg-ink-50 p-4 text-xs leading-relaxed text-ink-800">
                    {extraction.text.slice(0, PREVIEW_CHARS)}
                    {extraction.text.length > PREVIEW_CHARS ? "\n\n……（预览仅显示前 5000 字）" : ""}
                  </pre>
                  <p className="mt-2 text-xs text-ink-500">
                    此处为只读预览。完整文本保存在数据库的 document_texts 表中，供后续审核问答使用。
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </section>

      <p className="text-[11px] text-ink-400">
        上传上限：{formatBytes(getEnv().MAX_UPLOAD_BYTES)}／文件。
      </p>
    </div>
  );
}
