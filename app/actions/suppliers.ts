"use server";

/**
 * 供应商相关 Server Action。
 *
 * 安全要点（与 auth.ts 同一条纪律）：
 * Server Action 等价于公开 POST 端点 —— 这里的每个字段都必须当作不可信输入，
 * 每一个 id 都必须回库确认属于当前工作区。
 *
 * 另一个刻意的设计：**失败时回填用户填过的内容**。
 * 把用户刚敲的 8 个字段清空，是表单最招骂的体验；而这些内容本来就在他自己的会话里，
 * 回填不增加任何泄露面。
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireActionWorkspace, runIdempotentDelete } from "@/lib/auth/action-context";
import { setDocumentSupplier } from "@/lib/documents/repository";
import { findDocumentById } from "@/lib/documents/repository";
import { errors, toAppError } from "@/lib/errors";
import { EMPTY_FORM_STATE, fieldErrorsFromIssues, type FormState } from "@/lib/forms/form-state";
import { logger } from "@/lib/logger";
import { findSupplierById } from "@/lib/suppliers/repository";
import {
  archiveSupplier,
  createSupplier,
  deleteSupplier,
  restoreSupplier,
  updateSupplierById,
} from "@/lib/suppliers/service";

const supplierFieldsSchema = z.object({
  name: z.string().trim().min(1, "请填写供应商名称").max(120, "名称最多 120 个字符"),
  unifiedSocialCreditCode: z.string().trim().max(64).optional().default(""),
  contactName: z.string().trim().max(200).optional().default(""),
  contactPhone: z.string().trim().max(200).optional().default(""),
  contactEmail: z.string().trim().max(200).optional().default(""),
  region: z.string().trim().max(200).optional().default(""),
  note: z.string().trim().max(1_000, "备注最多 1000 个字符").optional().default(""),
});

function readSupplierFields(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    unifiedSocialCreditCode: String(formData.get("unifiedSocialCreditCode") ?? ""),
    contactName: String(formData.get("contactName") ?? ""),
    contactPhone: String(formData.get("contactPhone") ?? ""),
    contactEmail: String(formData.get("contactEmail") ?? ""),
    region: String(formData.get("region") ?? ""),
    note: String(formData.get("note") ?? ""),
  };
}

/** 邮箱字段不是必填，但填了就得像个邮箱 —— 否则它只会在未来某天静默失败。 */
function validateOptionalEmail(raw: string): string | undefined {
  if (raw.length === 0) return undefined;
  const parsed = z.string().email("邮箱格式不正确").safeParse(raw);
  return parsed.success ? undefined : parsed.error.issues[0]?.message;
}

/* --------------------------------- 新建 --------------------------------- */

export async function createSupplierAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = readSupplierFields(formData);

  const parsed = supplierFieldsSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      error: "请检查表单内容。",
      fieldErrors: fieldErrorsFromIssues(parsed.error.issues),
      values: raw,
    };
  }

  const emailError = validateOptionalEmail(parsed.data.contactEmail);
  if (emailError) {
    return { status: "error", error: "请检查表单内容。", fieldErrors: { contactEmail: emailError }, values: raw };
  }

  try {
    const { workspace, user } = await requireActionWorkspace("MEMBER");
    await createSupplier({ workspaceId: workspace.id, userId: user.id, input: parsed.data });
    revalidatePath("/suppliers");
    revalidatePath("/dashboard");
    revalidatePath("/reviews");
    logger.info("已创建供应商", { workspaceId: workspace.id });
    return { ...EMPTY_FORM_STATE, status: "success", success: `已创建供应商「${parsed.data.name}」。` };
  } catch (error) {
    const appError = toAppError(error);
    logger.warn("创建供应商失败", { code: appError.code });
    return { status: "error", error: appError.toUserMessage(), values: raw };
  }
}

/* --------------------------------- 更新 --------------------------------- */

export async function updateSupplierAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const supplierId = String(formData.get("supplierId") ?? "");
  const raw = readSupplierFields(formData);

  const parsed = supplierFieldsSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      error: "请检查表单内容。",
      fieldErrors: fieldErrorsFromIssues(parsed.error.issues),
      values: raw,
    };
  }

  const emailError = validateOptionalEmail(parsed.data.contactEmail);
  if (emailError) {
    return { status: "error", error: "请检查表单内容。", fieldErrors: { contactEmail: emailError }, values: raw };
  }

  try {
    const { workspace } = await requireActionWorkspace("MEMBER");
    await updateSupplierById({ workspaceId: workspace.id, supplierId, input: parsed.data });
    revalidatePath("/suppliers");
    logger.info("已更新供应商", { workspaceId: workspace.id, supplierId });
    return { ...EMPTY_FORM_STATE, status: "success", success: "已保存修改。" };
  } catch (error) {
    const appError = toAppError(error);
    logger.warn("更新供应商失败", { code: appError.code, supplierId });
    return { status: "error", error: appError.toUserMessage(), values: raw };
  }
}

/* ------------------------------ 归档 / 恢复 ------------------------------ */

/**
 * 归档 / 恢复**不走** `runIdempotentDelete`。
 *
 * 这两个动作会改变记录内容，不是删除。目标被并发删掉时如果静默跳过，
 * 用户点了「归档」、页面刷新、供应商还在列表里 —— 他只会认为系统坏了。
 * 更新类动作必须要么成功要么报错，没有第三种结果。
 */

export async function archiveSupplierAction(formData: FormData): Promise<void> {
  const supplierId = String(formData.get("supplierId") ?? "");
  const { workspace } = await requireActionWorkspace("MEMBER");
  await archiveSupplier({ workspaceId: workspace.id, supplierId });
  revalidatePath("/suppliers");
  revalidatePath("/reviews");
}

export async function restoreSupplierAction(formData: FormData): Promise<void> {
  const supplierId = String(formData.get("supplierId") ?? "");
  const { workspace } = await requireActionWorkspace("MEMBER");
  await restoreSupplier({ workspaceId: workspace.id, supplierId });
  revalidatePath("/suppliers");
}

/**
 * 删除供应商（软删除）。
 *
 * 这是**唯一一个会改变列表可见性的破坏性动作**，因此它排在表单最右侧、
 * 用次要按钮样式，并要求在界面上先看到二次确认文案（前端 confirm）。
 * 不做物理删除：历史审核任务还指着他。
 */
export async function deleteSupplierAction(formData: FormData): Promise<void> {
  const supplierId = String(formData.get("supplierId") ?? "");
  const { workspace } = await requireActionWorkspace("MEMBER");
  await runIdempotentDelete(
    () => deleteSupplier({ workspaceId: workspace.id, supplierId }),
    { supplierId, operation: "delete" },
  );
  revalidatePath("/suppliers");
  revalidatePath("/dashboard");
}

/* --------------------------- 资料归属供应商 --------------------------- */

/** 把一份资料挂到某个供应商（或解除归属）。 */
export async function assignDocumentSupplierAction(formData: FormData): Promise<void> {
  const documentId = String(formData.get("documentId") ?? "");
  const rawSupplierId = String(formData.get("supplierId") ?? "");

  const { workspace } = await requireActionWorkspace("MEMBER");

  // 授权判据：文档必须属于当前工作区。
  const document = await findDocumentById(documentId);
  if (!document || document.workspaceId !== workspace.id) {
    throw errors.notFound("没有找到对应的资料。");
  }

  let supplierId: string | null = null;
  if (rawSupplierId.length > 0) {
    const supplier = await findSupplierById(rawSupplierId);
    if (!supplier || supplier.workspaceId !== workspace.id) {
      throw errors.notFound("没有找到对应的供应商。");
    }
    supplierId = supplier.id;
  }

  await setDocumentSupplier(document.id, supplierId);
  revalidatePath("/documents");
  revalidatePath(`/documents/${document.id}`);
  revalidatePath("/suppliers");
}
