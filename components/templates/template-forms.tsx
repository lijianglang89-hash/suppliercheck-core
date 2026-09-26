"use client";

/**
 * 审核模板表单。
 *
 * 两个模式（新建 / 编辑）共用同一份字段定义，理由与供应商表单一致：
 * 分叉成两个组件，迟早会有一个字段只在一边被加上。
 *
 * 规则勾选项直接读 `REVIEW_RULES`（代码常量），不从页面传下来 ——
 * 「系统里有哪些规则」只有一份事实来源，页面多传一次就多一次不同步的机会。
 *
 * 勾选项的默认值 = 全部勾上。空集合在引擎里的语义是「全部执行」
 * （见 selectRules），所以这里刻意让「什么都不勾」不可能发生：
 * 用户看到的是明确的清单，而不是一个含义会随实现变化的空集。
 */
import { useActionState } from "react";

import { FieldError, FormAlert } from "@/components/ui/form-alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { createTemplateAction, updateTemplateAction } from "@/app/actions/templates";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/forms/form-state";
import { REVIEW_RULES } from "@/lib/reviews/rules";
import { CATEGORY_LABELS } from "@/lib/reviews/labels";
import { DOCUMENT_LINE_EXAMPLE } from "@/lib/templates/config-form";

const inputClassName =
  "mt-1.5 block w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none";

export interface TemplateFormValues {
  name: string;
  description: string;
  expiryWarningDays: string;
  documentLines: string;
  enabledRules: string[];
}

export const BLANK_TEMPLATE_FORM: TemplateFormValues = {
  name: "",
  description: "",
  expiryWarningDays: "90",
  documentLines: DOCUMENT_LINE_EXAMPLE,
  enabledRules: REVIEW_RULES.map((rule) => rule.id),
};

interface TemplateFormProps {
  mode: "create" | "edit";
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  initial: TemplateFormValues;
  templateId?: string;
}

export function TemplateForm({ mode, action, initial, templateId }: TemplateFormProps) {
  const [state, formAction] = useActionState(action, EMPTY_FORM_STATE);
  const errors = state.fieldErrors ?? {};

  // 提交失败时服务端会把原值回填 —— 必备资料清单动辄十几行，清掉它是没法接受的。
  // enabledRules 是数组，只能以逗号分隔的字符串过这个通道（FormState.values 是扁平的）。
  const values = {
    name: state.values?.name ?? initial.name,
    description: state.values?.description ?? initial.description,
    expiryWarningDays: state.values?.expiryWarningDays ?? initial.expiryWarningDays,
    documentLines: state.values?.documentLines ?? initial.documentLines,
  };
  const enabled = new Set(
    state.values?.enabledRules
      ? state.values.enabledRules.split(",").filter(Boolean)
      : initial.enabledRules,
  );

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {templateId ? <input type="hidden" name="templateId" value={templateId} /> : null}

      <FormAlert state={state} />

      <div className="grid gap-4 sm:grid-cols-[2fr,1fr]">
        <div>
          <label htmlFor={`${mode}-name`} className="block text-sm font-medium text-ink-700">
            模板名称 <span className="text-danger-600">*</span>
          </label>
          <input
            id={`${mode}-name`}
            name="name"
            required
            maxLength={64}
            defaultValue={values.name}
            className={inputClassName}
            placeholder="例如：海外供应商准入审核"
          />
          <FieldError message={errors.name} />
        </div>

        <div>
          <label htmlFor={`${mode}-expiry`} className="block text-sm font-medium text-ink-700">
            有效期预警天数
          </label>
          <input
            id={`${mode}-expiry`}
            name="expiryWarningDays"
            type="number"
            min={1}
            max={730}
            defaultValue={values.expiryWarningDays}
            className={inputClassName}
          />
          <p className="mt-1 text-xs text-ink-400">距到期多少天内标为「临近到期」，1–730 天。</p>
          <FieldError message={errors.expiryWarningDays} />
        </div>
      </div>

      <div>
        <label htmlFor={`${mode}-description`} className="block text-sm font-medium text-ink-700">
          模板说明
        </label>
        <textarea
          id={`${mode}-description`}
          name="description"
          rows={2}
          maxLength={500}
          defaultValue={values.description}
          className={inputClassName}
          placeholder="这个模板用来核对什么、适用哪个环节"
        />
        <FieldError message={errors.description} />
      </div>

      <div>
        <label htmlFor={`${mode}-documentLines`} className="block text-sm font-medium text-ink-700">
          必备资料清单 <span className="text-danger-600">*</span>
        </label>
        <textarea
          id={`${mode}-documentLines`}
          name="documentLines"
          rows={8}
          maxLength={8_000}
          defaultValue={values.documentLines}
          className={`${inputClassName} font-mono text-xs leading-relaxed`}
        />
        <p className="mt-1 text-xs text-ink-400">
          每行一条：<code>名称 | 关键词（逗号分隔） | 必填 或 选填</code>，
          <code>#</code> 开头为注释。关键词用于判定该资料是否已提供。
        </p>
        <FieldError message={errors.documentLines} />
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-ink-700">启用的审核规则</legend>
        <p className="mt-1 text-xs text-ink-400">
          规则清单即系统实际会执行的检查项；不勾的规则不会出现在结论里。
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {REVIEW_RULES.map((rule) => (
            <label
              key={rule.id}
              className="flex cursor-pointer items-start gap-2 rounded-md border border-ink-200 bg-white px-3 py-2 text-xs hover:border-brand-300"
            >
              <input
                type="checkbox"
                name="enabledRules"
                value={rule.id}
                defaultChecked={enabled.has(rule.id)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-brand-600"
              />
              <span>
                <span className="block font-medium text-ink-800">{rule.label}</span>
                <span className="mt-0.5 block text-ink-500">{rule.description}</span>
                <span className="mt-0.5 block text-ink-400">
                  {CATEGORY_LABELS[rule.category] ?? rule.category}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <SubmitButton>{mode === "create" ? "创建模板" : "保存修改"}</SubmitButton>
    </form>
  );
}

export function TemplateCreateForm() {
  return <TemplateForm mode="create" action={createTemplateAction} initial={BLANK_TEMPLATE_FORM} />;
}

export function TemplateEditForm({
  templateId,
  initial,
}: {
  templateId: string;
  initial: TemplateFormValues;
}) {
  return (
    <TemplateForm mode="edit" action={updateTemplateAction} initial={initial} templateId={templateId} />
  );
}
