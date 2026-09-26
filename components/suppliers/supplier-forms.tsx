"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/ui/submit-button";
import { FieldError, FormAlert } from "@/components/ui/form-alert";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/forms/form-state";

import { createSupplierAction, updateSupplierAction } from "@/app/actions/suppliers";

/**
 * 供应商表单。
 *
 * 两个模式（新建 / 编辑）共用同一份字段定义：分叉成两个组件的话，
 * 迟早会有一个字段只在一边被加上 —— 那种"编辑时能填、新建时不能填"的
 * 不一致是最难向用户解释的 bug。
 *
 * 统一社会信用代码必填性提醒只做提示不做强制：很多供应商只有简称或没拿到执照副本。
 * 但一旦填了，服务端会用 GB 32100 校验位拦一道（见 lib/suppliers/service.ts）。
 */

const inputClassName =
  "mt-1.5 block w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none";

export interface SupplierFormValues {
  name: string;
  unifiedSocialCreditCode: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  region: string;
  note: string;
}

export const BLANK_SUPPLIER_FORM: SupplierFormValues = {
  name: "",
  unifiedSocialCreditCode: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  region: "",
  note: "",
};

interface SupplierFormProps {
  mode: "create" | "edit";
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  initial?: SupplierFormValues;
  /** 编辑模式下必填：目标供应商 id。 */
  supplierId?: string;
  /** 编辑完成时用于折叠表单的回调（由页面控制显示）。 */
  onDone?: () => void;
}

export function SupplierForm({ mode, action, initial, supplierId }: SupplierFormProps) {
  const [state, formAction] = useActionState(action, EMPTY_FORM_STATE);
  const values = state.values ?? initial ?? BLANK_SUPPLIER_FORM;
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {supplierId ? <input type="hidden" name="supplierId" value={supplierId} /> : null}

      <FormAlert state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${mode}-name`} className="block text-sm font-medium text-ink-700">
            供应商名称 <span className="text-danger-600">*</span>
          </label>
          <input
            id={`${mode}-name`}
            name="name"
            required
            maxLength={120}
            defaultValue={values.name}
            className={inputClassName}
            placeholder="与营业执照一致的全称"
          />
          <FieldError message={errors.name} />
        </div>

        <div>
          <label htmlFor={`${mode}-uscc`} className="block text-sm font-medium text-ink-700">
            统一社会信用代码
          </label>
          <input
            id={`${mode}-uscc`}
            name="unifiedSocialCreditCode"
            maxLength={64}
            defaultValue={values.unifiedSocialCreditCode}
            className={`${inputClassName} font-mono`}
            placeholder="18 位，留空也可以"
          />
          <p className="mt-1 text-xs text-ink-400">填写后会按 GB 32100 校验第 18 位校验码。</p>
          <FieldError message={errors.unifiedSocialCreditCode} />
        </div>

        <div>
          <label htmlFor={`${mode}-contactName`} className="block text-sm font-medium text-ink-700">
            联系人
          </label>
          <input
            id={`${mode}-contactName`}
            name="contactName"
            maxLength={200}
            defaultValue={values.contactName}
            className={inputClassName}
          />
          <FieldError message={errors.contactName} />
        </div>

        <div>
          <label htmlFor={`${mode}-contactPhone`} className="block text-sm font-medium text-ink-700">
            联系电话
          </label>
          <input
            id={`${mode}-contactPhone`}
            name="contactPhone"
            maxLength={200}
            defaultValue={values.contactPhone}
            className={inputClassName}
          />
          <FieldError message={errors.contactPhone} />
        </div>

        <div>
          <label htmlFor={`${mode}-contactEmail`} className="block text-sm font-medium text-ink-700">
            联系邮箱
          </label>
          <input
            id={`${mode}-contactEmail`}
            name="contactEmail"
            type="email"
            maxLength={200}
            defaultValue={values.contactEmail}
            className={inputClassName}
          />
          <FieldError message={errors.contactEmail} />
        </div>

        <div>
          <label htmlFor={`${mode}-region`} className="block text-sm font-medium text-ink-700">
            所在地
          </label>
          <input
            id={`${mode}-region`}
            name="region"
            maxLength={200}
            defaultValue={values.region}
            className={inputClassName}
            placeholder="例如：广东省佛山市顺德区"
          />
          <FieldError message={errors.region} />
        </div>
      </div>

      <div>
        <label htmlFor={`${mode}-note`} className="block text-sm font-medium text-ink-700">
          备注
        </label>
        <textarea
          id={`${mode}-note`}
          name="note"
          rows={3}
          maxLength={1_000}
          defaultValue={values.note}
          className={inputClassName}
          placeholder="合作背景、注意事项等"
        />
        <FieldError message={errors.note} />
      </div>

      <SubmitButton>{mode === "create" ? "创建供应商" : "保存修改"}</SubmitButton>
    </form>
  );
}

export function SupplierCreateForm() {
  return <SupplierForm mode="create" action={createSupplierAction} initial={BLANK_SUPPLIER_FORM} />;
}

export function SupplierEditForm({
  supplierId,
  initial,
}: {
  supplierId: string;
  initial: SupplierFormValues;
}) {
  return (
    <SupplierForm mode="edit" action={updateSupplierAction} initial={initial} supplierId={supplierId} />
  );
}
