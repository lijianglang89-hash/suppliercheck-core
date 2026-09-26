/**
 * 供应商服务层。
 *
 * 唯一一条业务判断放在这里：**统一社会信用代码在写入前必须校验位正确**。
 *
 * 为什么值得拦一道：统一社会信用代码是后续所有主体比对的锚点。
 * 一个校验位错误的代码进了库，之后每一次「主体是否一致」的比对都会以它为基准，
 * 错误会被放大到整份报告。这个字段可以留空（资料还没到手时不该逼用户编一个），
 * 但只要填了就必须是对的。
 */
import "server-only";

import { errors } from "@/lib/errors";
import { isUuid } from "@/lib/files";

import { validateUscc } from "@/lib/reviews/extract";

import {
  findSupplierById,
  insertSupplier,
  isUniqueViolation,
  setSupplierStatus,
  softDeleteSupplier,
  updateSupplier,
} from "./repository";

export interface SupplierInput {
  name: string;
  unifiedSocialCreditCode?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  region?: string | null;
  note?: string | null;
}

export interface NormalizedSupplierInput {
  name: string;
  unifiedSocialCreditCode: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  region: string | null;
  note: string | null;
}

const MAX_NAME_CHARS = 120;
const MAX_FIELD_CHARS = 200;
const MAX_NOTE_CHARS = 1_000;

/** 校验 + 归一化。空字符串一律折成 null，避免库里同时存在 '' 与 NULL 两种「空」。 */
export function normalizeSupplierInput(input: SupplierInput): NormalizedSupplierInput {
  const name = (input.name ?? "").trim();
  if (name.length === 0) {
    throw errors.validation("供应商名称不能为空。");
  }
  if (name.length > MAX_NAME_CHARS) {
    throw errors.validation(`供应商名称不能超过 ${MAX_NAME_CHARS} 个字符。`);
  }

  const uscc = (input.unifiedSocialCreditCode ?? "").trim().toUpperCase();
  if (uscc.length > 0) {
    const validation = validateUscc(uscc);
    if (!validation.valid) {
      throw errors.validation(
        `统一社会信用代码「${uscc}」校验未通过：${validation.reason}。请核对营业执照原件；若暂时没有，可以留空。`,
      );
    }
  }

  const trimToNull = (value: string | null | undefined, max: number, label: string): string | null => {
    const text = (value ?? "").trim();
    if (text.length === 0) return null;
    if (text.length > max) {
      throw errors.validation(`${label}不能超过 ${max} 个字符。`);
    }
    return text;
  };

  return {
    name,
    unifiedSocialCreditCode: uscc.length > 0 ? uscc : null,
    contactName: trimToNull(input.contactName, MAX_FIELD_CHARS, "联系人"),
    contactPhone: trimToNull(input.contactPhone, MAX_FIELD_CHARS, "联系电话"),
    contactEmail: trimToNull(input.contactEmail, MAX_FIELD_CHARS, "联系邮箱"),
    region: trimToNull(input.region, MAX_FIELD_CHARS, "所在地"),
    note: trimToNull(input.note, MAX_NOTE_CHARS, "备注"),
  };
}

export async function createSupplier(params: {
  workspaceId: string;
  userId: string;
  input: SupplierInput;
}): Promise<string> {
  const normalized = normalizeSupplierInput(params.input);

  try {
    const row = await insertSupplier({
      workspaceId: params.workspaceId,
      createdBy: params.userId,
      ...normalized,
    });
    return row.id;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw errors.conflict(`已存在同名供应商「${normalized.name}」，请勿重复创建。`);
    }
    throw error;
  }
}

export async function updateSupplierById(params: {
  workspaceId: string;
  supplierId: string;
  input: SupplierInput;
}): Promise<void> {
  if (!isUuid(params.supplierId)) {
    throw errors.notFound("没有找到对应的供应商。");
  }
  const existing = await findSupplierById(params.supplierId);
  if (!existing || existing.workspaceId !== params.workspaceId) {
    throw errors.notFound("没有找到对应的供应商。");
  }

  const normalized = normalizeSupplierInput(params.input);

  try {
    await updateSupplier(params.supplierId, normalized);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw errors.conflict(`已存在同名供应商「${normalized.name}」，请换一个名称。`);
    }
    throw error;
  }
}

export async function archiveSupplier(params: {
  workspaceId: string;
  supplierId: string;
}): Promise<void> {
  await assertSupplierInWorkspace(params.workspaceId, params.supplierId);
  await setSupplierStatus(params.supplierId, "ARCHIVED");
}

export async function restoreSupplier(params: {
  workspaceId: string;
  supplierId: string;
}): Promise<void> {
  await assertSupplierInWorkspace(params.workspaceId, params.supplierId);
  await setSupplierStatus(params.supplierId, "ACTIVE");
}

export async function deleteSupplier(params: {
  workspaceId: string;
  supplierId: string;
}): Promise<void> {
  await assertSupplierInWorkspace(params.workspaceId, params.supplierId);
  await softDeleteSupplier(params.supplierId);
}

async function assertSupplierInWorkspace(workspaceId: string, supplierId: string): Promise<void> {
  if (!isUuid(supplierId)) {
    throw errors.notFound("没有找到对应的供应商。");
  }
  const existing = await findSupplierById(supplierId);
  if (!existing || existing.workspaceId !== workspaceId) {
    throw errors.notFound("没有找到对应的供应商。");
  }
}
