/**
 * 审核域的类型定义。
 *
 * 一个贯穿全文件的取舍：**规则标识（ruleId）与类别（category）用字符串联合类型，
 * 不用数据库枚举**。原因是规则集会持续增长 —— 加一条规则如果是「一次迁移」，
 * 那实际效果就是没人愿意加规则。反之 severity / source 是稳定的封闭集合，
 * 它们直接驱动界面排序与「是否存在阻断项」，用枚举才有意义（见 db/schema.ts）。
 */

/* ------------------------------------------------------------------ */
/* 严重级别                                                            */
/* ------------------------------------------------------------------ */

/**
 * 从高到低排列。顺序即界面排序权重，不要随意调整 ——
 * 数组下标会被当作 rank 使用（见 SEVERITY_RANK）。
 */
export const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  INFO: 0,
};

/** 阻断项：存在这些级别时，界面必须给出「不建议直接通过」的明确提示。 */
export const BLOCKING_SEVERITIES: readonly Severity[] = ["CRITICAL", "HIGH"];

export function isBlocking(severity: Severity): boolean {
  return BLOCKING_SEVERITIES.includes(severity);
}

export function emptySeverityCounts(): Record<Severity, number> {
  return { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
}

/* ------------------------------------------------------------------ */
/* 规则                                                                */
/* ------------------------------------------------------------------ */

export const RULE_IDS = [
  "REQUIRED_DOCUMENT_MISSING",
  "OPTIONAL_DOCUMENT_MISSING",
  "DOCUMENT_UNREADABLE",
  "DOCUMENT_NOT_READY",
  "DOCUMENT_TEXT_TRUNCATED",
  "USCC_MISSING",
  "USCC_INVALID",
  "USCC_MULTIPLE",
  "COMPANY_NAME_CONFLICT",
  "SUPPLIER_NAME_NOT_FOUND",
  "CERTIFICATE_EXPIRED",
  "CERTIFICATE_EXPIRING_SOON",
  "CERTIFICATE_EXPIRY_UNKNOWN",
  "AMOUNT_MISMATCH",
  "PLACEHOLDER_CONTENT",
  /**
   * AI 复核产出的发现。
   *
   * 它不是一条**可配置的规则**，因此不出现在 lib/reviews/rules.ts 的 REVIEW_RULES 里，
   * 也不出现在模板页的勾选项里 —— 只有接入真实 Provider 后才会产生这类发现。
   * 放进这里只是为了给「发现」一个统一的来源标识，让界面与报表能一致地分类。
   */
  "AI_REVIEW",
] as const;

export type RuleId = (typeof RULE_IDS)[number];

/** 发现类别，决定界面上的分组标题。 */
export const FINDING_CATEGORIES = [
  "COMPLETENESS",
  "READABILITY",
  "ENTITY",
  "VALIDITY",
  "CONSISTENCY",
  "AI",
] as const;

export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

/** 发现的来源。与数据库枚举 review_finding_source 一一对应。 */
export type FindingSource = "RULE" | "AI";

/* ------------------------------------------------------------------ */
/* 引擎输入与输出                                                      */
/* ------------------------------------------------------------------ */

/** 文档在审核引擎眼里的样子：只剩「正文 + 可用性元数据」。 */
export interface ReviewDocumentInput {
  id: string;
  /** 展示名（safeFilename）。 */
  label: string;
  originalFilename: string;
  mimeType: string;
  status: string;
  /** 实际执行提取的解析器；null 表示从未成功提取过。 */
  parserId: string | null;
  text: string;
  charCount: number;
  truncated: boolean;
  pageCount: number | null;
  notes: string[];
}

/** 一条待落库的发现。id / workspaceId / reviewRunId 由持久化层补。 */
export interface DraftFinding {
  ruleId: RuleId;
  category: FindingCategory;
  severity: Severity;
  title: string;
  detail: string;
  recommendation?: string;
  documentId?: string;
  documentLabel?: string;
  /** 原文摘录。**必须是被截断的短片段**，不允许把整份文件塞进来。 */
  evidence?: string;
  locator?: Record<string, unknown>;
}

/** 运行摘要。统计口径写在这里，界面只读不算。 */
export interface ReviewSummary {
  /** 本次纳入审核的文档份数。 */
  documentCount: number;
  /** 其中真正读到正文的份数。 */
  readableDocumentCount: number;
  /** 参与匹配的正文字符总数（截断后的实际值）。 */
  totalCharacters: number;
  /** 实际执行的规则 id 列表。 */
  executedRules: RuleId[];
  /** 模板要求但未启用的规则（因为不在 enabledRules 里）。 */
  skippedRules: RuleId[];
  findingCount: number;
  findingsBySeverity: Record<Severity, number>;
  /** CRITICAL + HIGH 的总数。 */
  blockingCount: number;
  /** 覆盖度说明：哪些资料没能参与审核、原因是什么。 */
  coverageNotes: string[];
  /** 生成摘要的时刻（ISO 字符串，便于直接落 jsonb）。 */
  generatedAt: string;
}

/** 引擎输出的完整结果。 */
export interface EngineOutcome {
  findings: DraftFinding[];
  summary: ReviewSummary;
  ai: AiReviewOutcome;
}

/**
 * AI 复核的结果。
 *
 * `enabled === false` 是**正常状态**，不是错误：当前只注册了开发模拟 Provider，
 * 而模拟 Provider 不构成任何审核结论。此时必须如实记录「没跑」，
 * 而不是产出一段读起来像结论的糊话。
 */
export interface AiReviewOutcome {
  enabled: boolean;
  provider: string;
  model: string;
  mock: boolean;
  /** 面向使用者的说明（例如「尚未接入真实 AI 模型」）。 */
  notes: string[];
  findings: DraftFinding[];
}
