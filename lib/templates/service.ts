/**
 * 审核模板服务。
 *
 * 把「内置模板（代码常量）」与「自定义模板（数据库行）」收敛成同一个形状 ——
 * `ResolvedTemplate`。调用方（审核任务、模板页、报告页）只认这一种类型，
 * 于是「内置还是自定义」这个差别不会渗透到业务逻辑里，
 * 将来把内置模板也搬到数据库时改动面为零。
 */
import "server-only";

import { errors } from "@/lib/errors";

import { BUILTIN_TEMPLATES, findBuiltinTemplate } from "./builtin";
import {
  findTemplateById,
  insertTemplate,
  listWorkspaceTemplates,
  softDeleteTemplate,
  updateTemplateRow,
} from "./repository";
import {
  builtinTemplateKey,
  isBuiltinTemplateKey,
  parseTemplateConfig,
  BUILTIN_TEMPLATE_PREFIX,
  type TemplateConfig,
} from "./types";

export interface ResolvedTemplate {
  key: string;
  name: string;
  description: string;
  config: TemplateConfig;
  source: "builtin" | "custom";
  /** 自定义模板才有。 */
  templateId?: string;
  basedOnKey?: string | null;
  updatedAt?: string;
}

/** 列出工作区可用的全部模板：内置在前，自定义在后。 */
export async function listAvailableTemplates(workspaceId: string): Promise<ResolvedTemplate[]> {
  const customs = await listWorkspaceTemplates(workspaceId);

  const builtins: ResolvedTemplate[] = BUILTIN_TEMPLATES.map((template) => ({
    key: builtinTemplateKey(template.key),
    name: template.name,
    description: template.description,
    config: parseTemplateConfig(template.config),
    source: "builtin" as const,
  }));

  const custom: ResolvedTemplate[] = customs.map((row) => ({
    key: row.id,
    name: row.name,
    description: row.description ?? "",
    config: parseTemplateConfig(row.config),
    source: "custom" as const,
    templateId: row.id,
    basedOnKey: row.basedOnKey,
    updatedAt: row.updatedAt.toISOString(),
  }));

  return [...builtins, ...custom];
}

/**
 * 解析模板标识。
 *
 * `builtin:<key>` 从代码常量取；其余一律当作自定义模板 id 到数据库查。
 * **自定义模板必须做工作区归属校验**：模板 id 会经由表单提交，
 * 直接 `findById` 再使用等于把别的租户的模板配置读进来（配置里含必备资料清单，
 * 属于业务信息，不是可以随便看的公开数据）。
 */
export async function resolveTemplate(
  workspaceId: string,
  templateKey: string,
): Promise<ResolvedTemplate> {
  if (isBuiltinTemplateKey(templateKey)) {
    const builtin = findBuiltinTemplate(templateKey.slice(BUILTIN_TEMPLATE_PREFIX.length));
    if (!builtin) {
      throw errors.notFound("没有找到对应的审核模板。");
    }
    return {
      key: templateKey,
      name: builtin.name,
      description: builtin.description,
      config: parseTemplateConfig(builtin.config),
      source: "builtin",
    };
  }

  const row = await findTemplateById(templateKey);
  if (!row || row.workspaceId !== workspaceId) {
    // 两种情况返回同一个错误：是否存在这个 id 本身也是不该泄露的信息。
    throw errors.notFound("没有找到对应的审核模板。");
  }

  return {
    key: row.id,
    name: row.name,
    description: row.description ?? "",
    config: parseTemplateConfig(row.config),
    source: "custom",
    templateId: row.id,
    basedOnKey: row.basedOnKey,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface SaveTemplateInput {
  workspaceId: string;
  userId: string;
  name: string;
  description: string | null;
  config: TemplateConfig;
  basedOnKey: string | null;
}

export async function createCustomTemplate(input: SaveTemplateInput): Promise<string> {
  const row = await insertTemplate({
    workspaceId: input.workspaceId,
    name: input.name,
    description: input.description,
    basedOnKey: input.basedOnKey,
    // 存的是**已校验过**的配置，不是原始表单 JSON。
    config: input.config as unknown as Record<string, unknown>,
    createdBy: input.userId,
  });
  return row.id;
}

/**
 * 更新自定义模板。
 *
 * 只允许改自定义模板：内置模板是代码常量，「编辑内置模板」在语义上只能是
 * 「另存一份副本」—— 页面上的入口也是这么做的（复制为自定义）。
 */
export async function updateCustomTemplate(
  workspaceId: string,
  templateId: string,
  input: { name: string; description: string | null; config: TemplateConfig },
): Promise<void> {
  const row = await findTemplateById(templateId);
  if (!row || row.workspaceId !== workspaceId) {
    throw errors.notFound("没有找到对应的审核模板。");
  }

  await updateTemplateRow(templateId, {
    name: input.name,
    description: input.description,
    config: input.config as unknown as Record<string, unknown>,
  });
}

export async function deleteCustomTemplate(
  workspaceId: string,
  templateId: string,
): Promise<void> {
  const row = await findTemplateById(templateId);
  if (!row || row.workspaceId !== workspaceId) {
    throw errors.notFound("没有找到对应的审核模板。");
  }
  await softDeleteTemplate(templateId);
}

