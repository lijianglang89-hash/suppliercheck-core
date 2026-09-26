/**
 * 审核模板的配置结构与校验。
 *
 * 模板决定了「这次审核要检查什么」。它被序列化成 jsonb 存进数据库，
 * 因此必须是**可安全反序列化的**：每次从库里读出来都要过一遍 zod，
 * 而不是 `as TemplateConfig`。模板是用户可编辑的，直接断言等于把
 * 任意 JSON 当成可信结构用 —— 一个手滑写进字符串的字段就能让审核整轮崩掉。
 */
import { z } from "zod";

/** 必备资料条目：命中任一关键词即视为「已提供」。 */
export const requiredDocumentSpecSchema = z.object({
  /** 稳定标识，用于报告里指代这一类资料。 */
  key: z.string().min(1).max(64),
  /** 展示名，例如「营业执照」。 */
  label: z.string().min(1).max(64),
  /**
   * 命中关键词。判定方式是「文档正文里是否出现」——
   * 刻意保持这么朴素：关键词匹配是可解释的，出了误判用户能一眼看懂为什么。
   */
  keywords: z.array(z.string().min(1).max(64)).min(1).max(20),
  /** false 表示「最好有」；缺失时降级为 INFO 而不是 HIGH。 */
  required: z.boolean().default(true),
});

export type RequiredDocumentSpec = z.infer<typeof requiredDocumentSpecSchema>;

/** 审核模板配置。 */
export const templateConfigSchema = z.object({
  requiredDocuments: z.array(requiredDocumentSpecSchema).max(40).default([]),
  /**
   * 证照到期预警天数。距到期日小于等于该天数即报「即将到期」。
   * 下限 1、上限 730：配 0 会让预警功能静默失效，配 3650 等于天天告警。
   */
  expiryWarningDays: z.coerce.number().int().min(1).max(730).default(90),
  /** 启用的规则 id 集合。留空表示"全部内置规则"。 */
  enabledRules: z.array(z.string().min(1).max(64)).max(60).default([]),
});

export type TemplateConfig = z.infer<typeof templateConfigSchema>;

/** 把任意来源的 JSON 安全地解析成模板配置；失败时回退到全默认值。 */
export function parseTemplateConfig(value: unknown): TemplateConfig {
  const parsed = templateConfigSchema.safeParse(value ?? {});
  if (!parsed.success) {
    // 回退而不是抛错：一份坏掉的模板不该让整个列表页 500。
    // 但必须留下痕迹 —— 静默回退等于让用户以为模板生效了。
    return templateConfigSchema.parse({});
  }
  return parsed.data;
}

/** 模板的唯一标识。内置模板用 `builtin:<key>`，自定义模板用其 uuid。 */
export const BUILTIN_TEMPLATE_PREFIX = "builtin:";

export function builtinTemplateKey(key: string): string {
  return `${BUILTIN_TEMPLATE_PREFIX}${key}`;
}

export function isBuiltinTemplateKey(key: string): boolean {
  return key.startsWith(BUILTIN_TEMPLATE_PREFIX);
}
