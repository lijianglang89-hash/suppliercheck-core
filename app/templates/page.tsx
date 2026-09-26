import Link from "next/link";

import { deleteTemplateAction, duplicateBuiltinTemplateAction } from "@/app/actions/templates";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  TemplateCreateForm,
  TemplateEditForm,
  type TemplateFormValues,
} from "@/components/templates/template-forms";
import { requireActionWorkspace } from "@/lib/auth/action-context";
import { BUILTIN_TEMPLATES } from "@/lib/templates/builtin";
import { serializeDocumentLines } from "@/lib/templates/config-form";
import { listAvailableTemplates, type ResolvedTemplate } from "@/lib/templates/service";
import { REVIEW_RULES } from "@/lib/reviews/rules";
import { ruleLabel } from "@/lib/reviews/labels";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "审核模板",
  description: "配置每次审核要检查哪些资料、启用哪些规则。",
};

export default async function TemplatesPage() {
  const { workspace } = await requireActionWorkspace("VIEWER");

  const all = await listAvailableTemplates(workspace.id);
  const custom = all.filter((template) => template.source === "custom");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">审核模板</h1>
        <p className="mt-1 text-sm text-ink-500">
          模板决定一次审核要检查什么：必备资料清单、启用哪些规则、证照到期提前多少天预警。
          内置模板是产品自带的，想改就复制一份到自己工作区。
        </p>
      </header>

      <section aria-labelledby="builtin-heading" className="space-y-3">
        <h2 id="builtin-heading" className="text-sm font-semibold text-ink-900">
          内置模板（{BUILTIN_TEMPLATES.length}）
        </h2>
        <ul className="space-y-3">
          {BUILTIN_TEMPLATES.map((template) => (
            <li key={template.key} className="rounded-lg border border-ink-200 bg-white px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-900">{template.name}</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-600">{template.description}</p>
                  <p className="mt-1.5 text-xs text-ink-500">
                    {template.config.requiredDocuments.length} 项资料
                    {" · "}
                    规则 {ruleCount(template.config.enabledRules.length)}
                    {" · "}
                    到期预警 {template.config.expiryWarningDays} 天
                  </p>
                </div>
                <form action={duplicateBuiltinTemplateAction} className="shrink-0">
                  <input type="hidden" name="builtinKey" value={template.key} />
                  <SubmitButton pendingText="复制中…">复制为自定义</SubmitButton>
                </form>
              </div>

              <details className="mt-2 border-t border-ink-100 pt-2">
                <summary className="cursor-pointer text-xs font-medium text-ink-600 hover:text-brand-700">
                  查看资料清单与规则
                </summary>
                <div className="mt-2 space-y-2 text-xs">
                  <ul className="space-y-1">
                    {template.config.requiredDocuments.map((doc) => (
                      <li key={doc.key} className="text-ink-600">
                        <span className="text-ink-400">{doc.required ? "必填" : "选填"}</span>
                        {" · "}
                        {doc.label}
                        <span className="text-ink-400">（{doc.keywords.join("、")}）</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-ink-500">
                    规则：
                    {(template.config.enabledRules.length > 0
                      ? template.config.enabledRules
                      : REVIEW_RULES.map((rule) => rule.id)
                    )
                      .map((ruleId) => ruleLabel(ruleId))
                      .join(" · ")}
                  </p>
                </div>
              </details>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="create-heading"
        className="rounded-lg border border-ink-200 bg-white p-5"
      >
        <h2 id="create-heading" className="text-sm font-semibold text-ink-900">
          新建自定义模板
        </h2>
        <div className="mt-4">
          <TemplateCreateForm />
        </div>
      </section>

      <section aria-labelledby="custom-heading" className="space-y-3">
        <h2 id="custom-heading" className="text-sm font-semibold text-ink-900">
          我的模板（{custom.length}）
        </h2>

        {custom.length === 0 ? (
          <p className="rounded-lg border border-ink-200 bg-white px-5 py-8 text-center text-sm text-ink-500">
            还没有自定义模板。可以直接用内置模板发起
            <Link href="/reviews" className="mx-1 text-brand-700 hover:underline">
              资料审核
            </Link>
            ，或复制一份内置模板再改。
          </p>
        ) : (
          <ul className="space-y-3">
            {custom.map((template) => (
              <CustomTemplateCard key={template.templateId ?? template.key} template={template} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CustomTemplateCard({ template }: { template: ResolvedTemplate }) {
  const values: TemplateFormValues = {
    name: template.name,
    description: template.description,
    expiryWarningDays: String(template.config.expiryWarningDays),
    documentLines: serializeDocumentLines(template.config.requiredDocuments),
    // 空集合在引擎里的语义是「全部执行」，界面上就按全选展示 —— 否则会出现
    // 「明明会执行，勾选项却一个都没勾」这种自相矛盾的显示。
    enabledRules:
      template.config.enabledRules.length > 0
        ? template.config.enabledRules
        : REVIEW_RULES.map((rule) => rule.id),
  };

  return (
    <li className="rounded-lg border border-ink-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink-900">{template.name}</p>
          {template.description ? (
            <p className="mt-1 text-xs leading-relaxed text-ink-600">{template.description}</p>
          ) : null}
          <p className="mt-1.5 text-xs text-ink-500">
            {template.config.requiredDocuments.length} 项资料
            {" · "}
            规则 {ruleCount(template.config.enabledRules.length)}
            {" · "}
            到期预警 {template.config.expiryWarningDays} 天
            {template.basedOnKey ? ` · 复制自 ${template.basedOnKey.replace(/^builtin:/, "内置模板 ")}` : ""}
          </p>
        </div>

        <form action={deleteTemplateAction} className="shrink-0">
          <input type="hidden" name="templateId" value={template.templateId ?? ""} />
          <ConfirmSubmitButton
            variant="danger"
            message={`删除模板「${template.name}」？已完成的审核不受影响 —— 报告里存的是发起时的模板快照。`}
          >
            删除
          </ConfirmSubmitButton>
        </form>
      </div>

      <details className="border-t border-ink-100">
        <summary className="cursor-pointer px-5 py-2 text-xs font-medium text-ink-600 hover:text-brand-700">
          编辑模板
        </summary>
        <div className="px-5 pb-4">
          <TemplateEditForm templateId={template.templateId ?? ""} initial={values} />
        </div>
      </details>
    </li>
  );
}

/** 空集合表示全部规则，显示上要如实反映这一点。 */
function ruleCount(count: number): string {
  return count > 0 ? `${count} 条` : `全部（${REVIEW_RULES.length} 条）`;
}
