/**
 * 审核域的文案与配色映射。
 *
 * 与 `lib/documents/labels.ts` 同一套思路：数据库里存机器值，界面上说人话。
 * 集中在一处，保证列表页、详情页、报告页说的是同一组词。
 *
 * 用 `Record<联合类型, T>` 而不是 switch/if：新增一个严重级别时，
 * **编译期**就会在缺项处报错，而不是等到某个页面渲染出空白标签。
 */
import { RULE_BY_ID } from "./rules";
import type { FindingCategory, FindingSource, RuleId, Severity } from "./types";

/* ------------------------------- 严重级别 ------------------------------- */

export const SEVERITY_LABELS: Record<Severity, string> = {
  CRITICAL: "严重",
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
  INFO: "提示",
};

/**
 * 严重级别的完整解释。
 *
 * 不是装饰：用户看到「严重」必须能立刻知道它意味着什么，
 * 否则所有级别在他眼里都会退化成同一个词 ——「红色」。
 */
export const SEVERITY_DESCRIPTIONS: Record<Severity, string> = {
  CRITICAL: "存在阻断性问题（如证照已过期），不应在未解决前通过审核。",
  HIGH: "存在明确缺陷，需要供应商补充或更正后才能通过。",
  MEDIUM: "存在疑点，需要人工确认后才能定性。",
  LOW: "提示性信息，不构成阻断，建议留意。",
  INFO: "覆盖度或流程说明，供参考。",
};

/** 徽标配色。语义色用 Tailwind 默认调色板，避免与品牌色令牌互相干扰。 */
export const SEVERITY_BADGE_CLASS: Record<Severity, string> = {
  CRITICAL: "bg-red-50 text-red-700 border border-red-200",
  HIGH: "bg-orange-50 text-orange-700 border border-orange-200",
  MEDIUM: "bg-amber-50 text-amber-800 border border-amber-200",
  LOW: "bg-sky-50 text-sky-700 border border-sky-200",
  INFO: "bg-ink-100 text-ink-600 border border-ink-200",
};

/** 发现卡片的左边框配色，用于报告页快速扫读。 */
export const SEVERITY_ACCENT_CLASS: Record<Severity, string> = {
  CRITICAL: "border-l-red-500",
  HIGH: "border-l-orange-500",
  MEDIUM: "border-l-amber-500",
  LOW: "border-l-sky-500",
  INFO: "border-l-ink-300",
};

/* --------------------------------- 类别 --------------------------------- */

export const CATEGORY_LABELS: Record<FindingCategory, string> = {
  COMPLETENESS: "资料完整性",
  READABILITY: "正文可用性",
  ENTITY: "主体与身份",
  VALIDITY: "证照有效期",
  CONSISTENCY: "数据一致性",
  AI: "AI 复核",
};

export const CATEGORY_ORDER: readonly FindingCategory[] = [
  "COMPLETENESS",
  "ENTITY",
  "VALIDITY",
  "CONSISTENCY",
  "READABILITY",
  "AI",
];

/* --------------------------------- 来源 --------------------------------- */

export const SOURCE_LABELS: Record<FindingSource, string> = {
  RULE: "规则引擎",
  AI: "AI 复核",
};

/* ------------------------------- 任务状态 ------------------------------- */

export type ReviewRunStatus = "QUEUED" | "RUNNING" | "READY" | "FAILED";

export const RUN_STATUS_LABELS: Record<ReviewRunStatus, string> = {
  QUEUED: "排队中",
  RUNNING: "审核中",
  READY: "已完成",
  FAILED: "执行失败",
};

export const RUN_STATUS_CLASS: Record<ReviewRunStatus, string> = {
  QUEUED: "bg-brand-50 text-brand-700 border border-brand-200",
  RUNNING: "bg-brand-50 text-brand-700 border border-brand-200",
  READY: "bg-ink-100 text-success-600 border border-ink-200",
  FAILED: "bg-ink-100 text-danger-600 border border-ink-200",
};

export function runStatusLabel(status: string): string {
  return RUN_STATUS_LABELS[status as ReviewRunStatus] ?? status;
}

export function runStatusClass(status: string): string {
  return RUN_STATUS_CLASS[status as ReviewRunStatus] ?? RUN_STATUS_CLASS.QUEUED;
}

/** 处于进行中的状态：页面据此决定要不要轮询刷新。 */
export function isRunPending(status: string): boolean {
  return status === "QUEUED" || status === "RUNNING";
}

/* --------------------------------- 规则 --------------------------------- */

export function ruleLabel(ruleId: string): string {
  return RULE_BY_ID.get(ruleId as RuleId)?.label ?? ruleId;
}

export function ruleDescription(ruleId: string): string {
  return RULE_BY_ID.get(ruleId as RuleId)?.description ?? "";
}

/* ------------------------------- 供应商状态 ------------------------------ */

export const SUPPLIER_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "合作中",
  ARCHIVED: "已归档",
};
