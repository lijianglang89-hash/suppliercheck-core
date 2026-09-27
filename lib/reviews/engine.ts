/**
 * 审核引擎编排层。
 *
 * 职责边界（刻意保持极窄）：
 *   规则选择 → 逐条执行 → 排序 → 生成摘要 → 追加 AI 复核
 *
 * 它**不碰数据库、不碰 HTTP、不读系统时钟**（`now` 由调用方传入）。
 * 这样同一个引擎既能被服务层调用，也能在单元测试里用一个固定日期跑出确定结果 ——
 * 「有效期是否已过期」这类断言如果读系统时钟，测试就会在某一天突然变红。
 */
import type { AIProvider } from "@/lib/ai";
import type { TemplateConfig } from "@/lib/templates/types";

import { runAiReviewPass } from "./ai-pass";
import {
  MAX_FINDINGS_PER_DOCUMENT,
  REVIEW_RULES,
  type SubjectType,
  selectRules,
} from "./rules";
import {
  emptySeverityCounts,
  isBlocking,
  SEVERITY_RANK,
  type DraftFinding,
  type EngineOutcome,
  type ReviewDocumentInput,
  type ReviewSummary,
  type RuleId,
  type Severity,
} from "./types";

/** 低于这个字符数视为「没有可用正文」，与 rules.ts 的判据保持一致。 */
const MIN_READABLE_CHARS = 30;

export interface RunReviewEngineInput {
  documents: ReviewDocumentInput[];
  config: TemplateConfig;
  /** 关联供应商名称；未关联传 null。 */
  supplierName?: string | null;
  /** 申报主体的统一社会信用代码；未登记传 null。用于多主体判定的降噪。 */
  supplierUscc?: string | null;
  /**
   * 申报主体的类型。未登记或用户没选时传 **null**。
   *
   * ⚠️ null 有明确含义：系统不知道。**不要**在调用方兜底成 "ENTERPRISE" ——
   * 那等于替用户声明主体是企业，而 USCC 类规则的严厉程度取决于这个声明。
   * 规则侧对 null 的处理是降级成「提示」，既不冤枉也不漏掉。
   */
  supplierSubjectType?: SubjectType | null;
  /** 判定基准时刻。必传 —— 见文件头说明。 */
  now: Date;
  /** 落库发现数上限。超出时裁剪并**在摘要里如实说明**，绝不静默丢弃。 */
  maxFindings?: number;
  /** 供测试注入假 Provider。 */
  provider?: AIProvider;
}

export async function runReviewEngine(input: RunReviewEngineInput): Promise<EngineOutcome> {
  const { executed, skipped } = selectRules(input.config);

  const context = {
    documents: input.documents,
    config: input.config,
    supplierName: input.supplierName ?? null,
    supplierUscc: input.supplierUscc ?? null,
    supplierSubjectType: input.supplierSubjectType ?? null,
    now: input.now,
  };

  // 逐条规则跑，单条规则抛错不影响其他规则 —— 一条正则写崩不该让整次审核变 FAILED。
  const ruleFindings: DraftFinding[] = [];
  const failedRules: RuleId[] = [];
  for (const rule of executed) {
    try {
      ruleFindings.push(...rule.evaluate(context));
    } catch {
      failedRules.push(rule.id);
    }
  }

  const ai = await runAiReviewPass({
    documents: input.documents,
    ...(input.provider ? { provider: input.provider } : {}),
  });

  const sorted = sortFindings([...ruleFindings, ...ai.findings]);
  const { findings, truncationNote } = applyFindingCap(sorted, input.maxFindings);

  return {
    findings,
    summary: buildSummary({
      documents: input.documents,
      executed: executed.map((rule) => rule.id),
      skipped: skipped.map((rule) => rule.id),
      failedRules,
      findings,
      aiNotes: truncationNote ? [...ai.notes, truncationNote] : ai.notes,
      now: input.now,
    }),
    ai,
  };
}

/**
 * 发现数上限。
 *
 * 超限时**先截断再如实告知**，而不是截断后假装这就是全部。
 * 「报告只显示了前 500 条」与「只有 500 条问题」是两件完全不同的事，
 * 后者会让使用者以为已经看全了。
 */
function applyFindingCap(
  findings: DraftFinding[],
  maxFindings: number | undefined,
): { findings: DraftFinding[]; truncationNote: string | null } {
  if (maxFindings === undefined || findings.length <= maxFindings) {
    return { findings, truncationNote: null };
  }

  const kept = findings.slice(0, maxFindings);
  const dropped = findings.length - kept.length;
  return {
    findings: kept,
    truncationNote: `本次共产生 ${findings.length} 条发现，已按严重级别保留前 ${maxFindings} 条，其余 ${dropped} 条未展示。`,
  };
}

/**
 * 排序：严重级别降序 → 同级别按规则注册顺序 → 再按资料名。
 *
 * 最后一级按资料名（而不是随机）是必要的：报告要能两次打开长得一样，
 * 否则"上次看到的问题在哪"就无从谈起。
 */
function sortFindings(findings: DraftFinding[]): DraftFinding[] {
  const ruleOrder = new Map<RuleId, number>(REVIEW_RULES.map((rule, index) => [rule.id, index]));

  return [...findings].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (bySeverity !== 0) return bySeverity;

    const byRule =
      (ruleOrder.get(a.ruleId) ?? Number.MAX_SAFE_INTEGER) -
      (ruleOrder.get(b.ruleId) ?? Number.MAX_SAFE_INTEGER);
    if (byRule !== 0) return byRule;

    return (a.documentLabel ?? "").localeCompare(b.documentLabel ?? "", "zh-CN");
  });
}

interface BuildSummaryInput {
  documents: ReviewDocumentInput[];
  executed: RuleId[];
  skipped: RuleId[];
  failedRules: RuleId[];
  findings: DraftFinding[];
  aiNotes: string[];
  now: Date;
}

function buildSummary(input: BuildSummaryInput): ReviewSummary {
  const findingsBySeverity = emptySeverityCounts();
  for (const finding of input.findings) {
    findingsBySeverity[finding.severity as Severity] += 1;
  }

  const blockingCount = input.findings.filter((finding) => isBlocking(finding.severity)).length;

  const readable = input.documents.filter(
    (document) => document.status === "READY" && document.charCount >= MIN_READABLE_CHARS,
  );

  const coverageNotes = buildCoverageNotes(input, readable.length);

  return {
    documentCount: input.documents.length,
    readableDocumentCount: readable.length,
    totalCharacters: readable.reduce((sum, document) => sum + document.charCount, 0),
    executedRules: input.executed,
    skippedRules: input.skipped,
    findingCount: input.findings.length,
    findingsBySeverity,
    blockingCount,
    coverageNotes,
    generatedAt: input.now.toISOString(),
  };
}

/**
 * 覆盖度说明。
 *
 * 存在的唯一理由：让使用者一眼看出「这次结论是在多少资料上得出来的」。
 * 一份只覆盖了 3/10 份资料的报告如果看起来和全覆盖的报告一模一样，
 * 那它就是在误导 —— 这类"沉默的失真"比报错危险得多。
 */
function buildCoverageNotes(input: BuildSummaryInput, readableCount: number): string[] {
  const notes: string[] = [];

  if (input.documents.length === 0) {
    notes.push("本次审核没有选中任何资料，所有规则都在空集合上执行，结论没有实际意义。");
    return notes;
  }

  const notReady = input.documents.filter((document) => document.status !== "READY").length;
  if (notReady > 0) {
    notes.push(`有 ${notReady} 份资料尚未完成解析，未参与本次审核。`);
  }

  const unreadable = input.documents.filter(
    (document) =>
      document.status === "READY" &&
      (document.parserId === null || document.charCount < MIN_READABLE_CHARS),
  ).length;
  if (unreadable > 0) {
    notes.push(`有 ${unreadable} 份资料未提取到可用正文（如扫描件），未参与本次审核。`);
  }

  const truncated = input.documents.filter(
    (document) => document.status === "READY" && document.truncated,
  ).length;
  if (truncated > 0) {
    notes.push(`有 ${truncated} 份资料正文超出提取上限，超出部分未参与本次审核。`);
  }

  if (readableCount === 0) {
    notes.push("没有任何资料产生可用正文，本次审核实质上什么也没有检查。");
  }

  if (input.failedRules.length > 0) {
    notes.push(`有 ${input.failedRules.length} 条规则执行异常已跳过：${input.failedRules.join("、")}。`);
  }

  if (input.skipped.length > 0) {
    notes.push(`本次审核按模板配置跳过了 ${input.skipped.length} 条规则。`);
  }

  /**
   * AI 的说明并入覆盖度说明：Summary 是**持久化**的结论摘要，
   * 单独存一个 ai 字段的话，任何只读 summary 的消费者（导出、对比、快照）
   * 都会得出「这份报告有 AI 参与」的错误印象。这条由单测钉住，不能去掉。
   *
   * ⚠️ 副作用：报告页同时渲染「覆盖度说明」与「AI 复核说明」时会出现重复文案，
   * 因此页面侧必须去重 —— 去重的责任在**展示层**，这里不能少写。
   */
  notes.push(...input.aiNotes);

  return notes;
}

/** 每份资料的发现上限（用于服务层落库前的兜底裁剪）。 */
export { MAX_FINDINGS_PER_DOCUMENT };
