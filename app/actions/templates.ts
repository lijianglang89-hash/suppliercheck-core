"use server";

/**
 * 审核模板相关 Server Action。
 *
 * 内置模板是代码常量，因此**不提供"编辑内置模板"**这个动作 ——
 * 想改内置模板的语义只能是「复制一份到自己工作区再改」，页面上的入口也是这么写的。
 * 这不是偷懒：内置模板是所有用户共用的产品定义，允许就地修改会让升级变成数据迁移。
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireActionWorkspace, runIdempotentDelete } from "@/lib/auth/action-context";
import { toAppError } from "@/lib/errors";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/forms/form-state";
import { logger } from "@/lib/logger";
import { parseDocumentLines } from "@/lib/templates/config-form";
import { findBuiltinTemplate } from "@/lib/templates/builtin";
import { findTemplateById } from "@/lib/templates/repository";
import {
  createCustomTemplate,
  deleteCustomTemplate,
  updateCustomTemplate,
} from "@/lib/templates/service";
import { templateConfigSchema } from "@/lib/templates/types";

const templateFormSchema = z.object({
  name: z.string().trim().min(1, "请填写模板名称").max(64, "模板名称最多 64 个字符"),
  description: z.string().trim().max(500, "说明最多 500 个字符"),
  expiryWarningDays: z.coerce
    .number()
    .int("预警天数必须是整数")
    .min(1, "预警天数至少 1 天")
    .max(730, "预警天数最多 730 天"),
  documentLines: z.string().max(8_000),
  enabledRules: z.array(z.string().trim().max(64)),
});

interface TemplateFormRaw {
  name: string;
  description: string;
  expiryWarningDays: string;
  documentLines: string;
  enabledRules: string[];
}

function readTemplateForm(formData: FormData): TemplateFormRaw {
  return {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    expiryWarningDays: String(formData.get("expiryWarningDays") ?? "90"),
    documentLines: String(formData.get("documentLines") ?? ""),
    enabledRules: formData.getAll("enabledRules").map(String),
  };
}

/**
 * 失败时把用户填的内容回填回去。
 *
 * 必备资料清单是一个大文本框，清空它等于让人重做一遍 —— 这是表单最容易被骂的体验。
 * enabledRules 是数组，而 FormState.values 是扁平的字符串映射，
 * 因此以逗号分隔的串过这个通道，前端再拆回来（见 components/templates/template-forms.tsx）。
 */
function formError(raw: TemplateFormRaw, error: string): FormState {
  return {
    status: "error",
    error,
    values: {
      name: raw.name,
      description: raw.description,
      expiryWarningDays: raw.expiryWarningDays,
      documentLines: raw.documentLines,
      enabledRules: raw.enabledRules.join(","),
    },
  };
}

/** 把表单内容折成可落库的模板配置。解析错误以 AppError 抛出，由调用方统一翻译。 */
function buildConfig(parsed: z.infer<typeof templateFormSchema>) {
  const { items, errors } = parseDocumentLines(parsed.documentLines);
  if (errors.length > 0) {
    // 只回前 3 条 —— 一次报 20 条只会让人放弃。
    throw new Error(`必备资料清单有误：${errors.slice(0, 3).join("；")}`);
  }

  const config = templateConfigSchema.safeParse({
    requiredDocuments: items,
    expiryWarningDays: parsed.expiryWarningDays,
    enabledRules: parsed.enabledRules,
  });

  if (!config.success) {
    throw new Error(`模板配置不合法：${config.error.issues[0]?.message ?? "未知原因"}`);
  }
  return config.data;
}

/* --------------------------------- 新建 --------------------------------- */

export async function createTemplateAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = readTemplateForm(formData);
  const parsed = templateFormSchema.safeParse(raw);
  if (!parsed.success) {
    return formError(raw, parsed.error.issues[0]?.message ?? "请检查表单内容。");
  }

  try {
    const { workspace, user } = await requireActionWorkspace("MEMBER");
    const config = buildConfig(parsed.data);
    await createCustomTemplate({
      workspaceId: workspace.id,
      userId: user.id,
      name: parsed.data.name,
      description: parsed.data.description.length > 0 ? parsed.data.description : null,
      basedOnKey: null,
      config,
    });
  } catch (error) {
    const appError = toAppError(error);
    logger.warn("创建审核模板失败", { code: appError.code });
    return formError(raw, appError.message);
  }

  revalidatePath("/templates");
  revalidatePath("/reviews");
  return {
    ...EMPTY_FORM_STATE,
    status: "success",
    success: `已创建模板「${parsed.data.name}」。`,
  };
}

/* --------------------------------- 更新 --------------------------------- */

export async function updateTemplateAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const templateId = String(formData.get("templateId") ?? "");
  const raw = readTemplateForm(formData);
  const parsed = templateFormSchema.safeParse(raw);
  if (!parsed.success) {
    return formError(raw, parsed.error.issues[0]?.message ?? "请检查表单内容。");
  }

  try {
    const { workspace } = await requireActionWorkspace("MEMBER");
    const config = buildConfig(parsed.data);
    await updateCustomTemplate(workspace.id, templateId, {
      name: parsed.data.name,
      description: parsed.data.description.length > 0 ? parsed.data.description : null,
      config,
    });
  } catch (error) {
    const appError = toAppError(error);
    logger.warn("更新审核模板失败", { code: appError.code, templateId });
    return formError(raw, appError.message);
  }

  revalidatePath("/templates");
  revalidatePath("/reviews");
  return { ...EMPTY_FORM_STATE, status: "success", success: "已保存模板。" };
}

/* ------------------------------ 复制内置模板 ------------------------------ */

export async function duplicateBuiltinTemplateAction(formData: FormData): Promise<void> {
  const builtinKey = String(formData.get("builtinKey") ?? "");
  const builtin = findBuiltinTemplate(builtinKey);
  if (!builtin) {
    throw toAppError(new Error("没有找到对应的内置模板。"));
  }

  const { workspace, user } = await requireActionWorkspace("MEMBER");
  await createCustomTemplate({
    workspaceId: workspace.id,
    userId: user.id,
    name: `${builtin.name}（副本）`,
    description: builtin.description,
    basedOnKey: `builtin:${builtinKey}`,
    config: builtin.config,
  });

  revalidatePath("/templates");
  revalidatePath("/reviews");
}

/* --------------------------------- 删除 --------------------------------- */

export async function deleteTemplateAction(formData: FormData): Promise<void> {
  const templateId = String(formData.get("templateId") ?? "");
  const { workspace } = await requireActionWorkspace("MEMBER");

  const template = await findTemplateById(templateId);
  if (!template || template.workspaceId !== workspace.id) {
    throw toAppError(new Error("没有找到对应的审核模板。"));
  }

  await runIdempotentDelete(() => deleteCustomTemplate(workspace.id, templateId), {
    templateId,
    operation: "delete",
  });

  revalidatePath("/templates");
  revalidatePath("/reviews");
}
