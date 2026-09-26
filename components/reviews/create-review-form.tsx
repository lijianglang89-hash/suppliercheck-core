"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/ui/submit-button";
import { FormAlert } from "@/components/ui/form-alert";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/forms/form-state";

import { createReviewAction } from "@/app/actions/reviews";

/**
 * 发起审核的表单。
 *
 * 资料勾选放在客户端做计数与「全选」是必要的：一次审核纳入多少份资料
 * 直接决定结论覆盖了多少证据，用户必须在提交前能看清这个数字。
 *
 * 两条刻意的限制：
 * - 未解析完成的资料**允许勾选**，但会被明确标注。禁止勾选的话，用户会以为
 *   系统漏掉了这份文件；允许勾选但不标注，则会让人以为它参与了审核 ——
 *   所以标注是必须的（审核结果里也会有对应的「未参与审核」发现）。
 * - 上限由服务端再判一次（MAX_DOCUMENTS_PER_RUN），这里的计数只是即时反馈。
 */

export interface TemplateOption {
  key: string;
  name: string;
  description: string;
  source: "builtin" | "custom";
}

export interface SupplierOption {
  id: string;
  name: string;
}

export interface DocumentOption {
  id: string;
  label: string;
  safeFilename: string;
  status: string;
  statusLabel: string;
  charCount: number | null;
  parserId: string | null;
  supplierId: string | null;
}

interface CreateReviewFormProps {
  templates: TemplateOption[];
  suppliers: SupplierOption[];
  documents: DocumentOption[];
  maxDocuments: number;
  /**
   * 预选中的资料。
   *
   * 存在的理由很具体：用户从资料库点「发起审核」进来时，勾好的应该是他刚看的那份，
   * 而不是让他面对三十个复选框重新找一遍。值来自 URL，因此**只用于初始化界面**，
   * 真正的归属校验在服务端再做一遍（见 lib/reviews/service.ts）。
   */
  initialDocumentIds?: string[];
  initialSupplierId?: string;
}

export function CreateReviewForm({
  templates,
  suppliers,
  documents,
  maxDocuments,
  initialDocumentIds = [],
  initialSupplierId = "",
}: CreateReviewFormProps) {
  const [state, formAction] = useActionState(createReviewAction, EMPTY_FORM_STATE);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialDocumentIds.filter((id) => documents.some((row) => row.id === id))),
  );

  function toggle(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const readyCount = documents.filter(
    (document) => document.status === "READY" && (document.charCount ?? 0) > 0,
  ).length;

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormAlert state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="templateKey" className="block text-sm font-medium text-ink-700">
            审核模板 <span className="text-danger-600">*</span>
          </label>
          <select
            id="templateKey"
            name="templateKey"
            required
            defaultValue={templates[0]?.key ?? ""}
            className="mt-1.5 block w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-600 focus:outline-none"
          >
            {templates.map((template) => (
              <option key={template.key} value={template.key}>
                {template.name}
                {template.source === "builtin" ? "（内置）" : "（自定义）"}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink-400">
            {templates[0]?.description ?? "还没有可用模板，请先到审核模板页面创建。"}
          </p>
        </div>

        <div>
          <label htmlFor="supplierId" className="block text-sm font-medium text-ink-700">
            关联供应商
          </label>
          <select
            id="supplierId"
            name="supplierId"
            defaultValue={initialSupplierId}
            className="mt-1.5 block w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-600 focus:outline-none"
          >
            <option value="">不关联</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink-400">
            关联后会额外检查「资料里是否出现该主体名称」。
          </p>
        </div>
      </div>

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-ink-700">
          本次审核名称
        </label>
        <input
          id="name"
          name="name"
          maxLength={120}
          className="mt-1.5 block w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none"
          placeholder="留空则按「主体 · 模板 · 时间」自动生成"
        />
      </div>

      <fieldset className="rounded-md border border-ink-200">
        <legend className="px-2 text-sm font-medium text-ink-700">选择资料</legend>

        {documents.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-ink-500">
            资料库里还没有资料。请先到
            <Link href="/documents" className="mx-1 text-brand-700 hover:underline">
              资料库
            </Link>
            上传供应商资料包。
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-2">
              <p className="text-xs text-ink-500">
                共 {documents.length} 份，其中 {readyCount} 份已提取到正文
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelected(new Set(documents.map((document) => document.id)))}
                  className="rounded border border-ink-300 bg-white px-2 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50"
                >
                  全选
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSelected(
                      new Set(
                        documents
                          .filter((document) => document.status === "READY")
                          .map((document) => document.id),
                      ),
                    )
                  }
                  className="rounded border border-ink-300 bg-white px-2 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50"
                >
                  只选已解析
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="rounded border border-ink-300 bg-white px-2 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50"
                >
                  清空
                </button>
              </div>
            </div>

            <ul className="max-h-72 divide-y divide-ink-100 overflow-y-auto">
              {documents.map((document) => {
                const usable = document.status === "READY" && (document.charCount ?? 0) > 0;
                return (
                  <li key={document.id} className="flex items-start gap-3 px-4 py-2">
                    <input
                      type="checkbox"
                      id={`document-${document.id}`}
                      name="documentIds"
                      value={document.id}
                      checked={selected.has(document.id)}
                      onChange={() => toggle(document.id)}
                      className="mt-1 h-4 w-4 rounded border-ink-300 text-brand-700"
                    />
                    <label
                      htmlFor={`document-${document.id}`}
                      className="min-w-0 flex-1 cursor-pointer text-sm"
                    >
                      <span className="block truncate text-ink-800">{document.safeFilename}</span>
                      <span className="mt-0.5 block text-xs text-ink-500">
                        {document.statusLabel}
                        {document.charCount !== null ? ` · ${document.charCount.toLocaleString("zh-CN")} 字` : ""}
                        {!usable ? (
                          <span className="ml-1 text-warning-600">· 未参与审核（无可用正文）</span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            <div className="border-t border-ink-100 px-4 py-2">
              <p className="text-xs text-ink-600">
                已选择 <span className="font-semibold tabular-nums">{selected.size}</span> 份
                {selected.size > maxDocuments ? (
                  <span className="ml-1 text-danger-600">
                    （单次最多 {maxDocuments} 份，请减少到 {maxDocuments} 份以内）
                  </span>
                ) : null}
              </p>
            </div>
          </>
        )}
      </fieldset>

      <SubmitButton pendingText="正在发起审核…">开始审核</SubmitButton>
    </form>
  );
}

/** 重新运行按钮。独立成组件是为了拿到提交状态并回显服务端给的消息。 */
export function RerunReviewForm({ runId }: { runId: string }) {
  const [state, formAction] = useActionState(rerunActionFor(runId), EMPTY_FORM_STATE);

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <SubmitButton variant="secondary" pendingText="提交中…">
        重新运行审核
      </SubmitButton>
      <FormAlert state={state} />
    </form>
  );
}

/**
 * 用闭包把 runId 绑到 action 上，而不是塞一个隐藏 input ——
 * 隐藏 input 的值仍然来自浏览器，而 bind 的参数在服务端序列化时签名校验更强。
 * 二者都需要服务端再次校验归属（action 内部已做），但 bind 少一个可被篡改的字段。
 */
function rerunActionFor(runId: string) {
  return async function boundRerun(_prevState: FormState, formData: FormData): Promise<FormState> {
    formData.set("runId", runId);
    const { rerunReviewAction } = await import("@/app/actions/reviews");
    return rerunReviewAction(_prevState, formData);
  };
}
