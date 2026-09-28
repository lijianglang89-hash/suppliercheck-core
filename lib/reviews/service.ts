/**
 * 审核服务层（编排 + 状态机）。
 *
 * 与 `lib/documents/service.ts` 同构，同样守三条规矩：
 *
 * 1. **认领后再跑。** 状态先原子地翻到 RUNNING，再进串行队列。
 *    连点两次「重新运行」只有一次会真正干活，否则发现会被写两遍。
 *
 * 2. **状态只由这一层推进。** 路由 / Server Action 一律不许直接改 review_runs.status。
 *
 * 3. **绝不伪造审核结论。** 一条发现都没有 ≠ 审核通过 ——
 *    摘要里必须带上覆盖度说明（查了几份、几份没读到正文、跑了几条规则）。
 *    一份只读了 1/10 份资料的报告，如果长得和全覆盖的报告一样，那它就是在撒谎。
 *
 * 另外这里承担**跨租户的最后一道闸门**：documentIds / supplierId / templateKey
 * 全部来自浏览器，每一个都必须回库确认属于当前工作区。任何一个漏检，
 * 攻击者就能用别人的资料生成一份报告，或读到别人的模板配置。
 */
import "server-only";

import { ERROR_CODES, errors, toAppError } from "@/lib/errors";
import { isUuid } from "@/lib/files";
import { getAIProvider } from "@/lib/ai";
import { logger } from "@/lib/logger";
import { MAX_ERROR_MESSAGE_CHARS, STUCK_JOB_ERROR_MESSAGE } from "@/lib/jobs/limits";
import { runExclusive, withTimeout } from "@/lib/jobs/serial-queue";
import { listDocumentsWithText, type DocumentWithTextRow } from "@/lib/documents/repository";
import { findSuppliersByIds } from "@/lib/suppliers/repository";
import { resolveTemplate } from "@/lib/templates/service";
import { parseTemplateConfig } from "@/lib/templates/types";

import { runReviewEngine } from "./engine";
import type { SubjectType } from "./rules";
import {
  MAX_DOCUMENTS_PER_RUN,
  MAX_RUN_NAME_CHARS,
  MAX_TOTAL_REVIEW_CHARS,
  MAX_REVIEW_FINDINGS,
  REVIEW_STALE_THRESHOLD_MS,
  REVIEW_TIMEOUT_MS,
} from "./limits";
import {
  claimReviewRun,
  createReviewRun,
  failStaleRunningReviewRuns,
  findReviewRunById,
  markReviewRunFailed,
  markReviewRunReady,
  replaceRunFindings,
} from "./repository";
import type { ReviewDocumentInput } from "./types";
import type { NewReviewFinding, ReviewRun } from "@/lib/db/schema";

/* ------------------------------------------------------------------ */
/* 创建                                                               */
/* ------------------------------------------------------------------ */

export interface CreateReviewRunParams {
  workspaceId: string;
  userId: string;
  templateKey: string;
  supplierId?: string | null;
  documentIds: readonly string[];
  name?: string | null;
}

export async function createReviewRunAndEnqueue(
  params: CreateReviewRunParams,
  opts?: { requestId?: string },
): Promise<ReviewRun> {
  if (!isUuid(params.workspaceId)) {
    throw errors.validation("workspaceId 必须是 UUID。");
  }

  const documentIds = dedupeUuids(params.documentIds);
  if (documentIds.length === 0) {
    throw errors.validation("请至少选择一份资料再开始审核。");
  }
  if (documentIds.length > MAX_DOCUMENTS_PER_RUN) {
    throw errors.validation(
      `一次审核最多纳入 ${MAX_DOCUMENTS_PER_RUN} 份资料，请减少选择范围后重试。`,
    );
  }

  // 模板：内置从代码常量取，自定义必须属于本工作区（resolveTemplate 内部校验）。
  const template = await resolveTemplate(params.workspaceId, params.templateKey);

  // 供应商：必须属于本工作区。不属于就当作不存在，不区分「不存在」与「别人的」。
  let supplierName: string | null = null;
  const supplierId = params.supplierId && isUuid(params.supplierId) ? params.supplierId : null;
  if (supplierId) {
    const [supplier] = await findSuppliersByIds(params.workspaceId, [supplierId]);
    if (!supplier) {
      throw errors.notFound("没有找到对应的供应商。");
    }
    supplierName = supplier.name;
  }

  // 资料：逐个回库确认归属。数量对不上就报 404，不回传「哪几个不属于你」。
  const rows = await listDocumentsWithText(params.workspaceId, documentIds);
  if (rows.length !== documentIds.length) {
    throw errors.notFound("部分资料不存在或不属于当前工作区，请刷新页面后重试。");
  }

  // ★ READY 门禁：只允许对「解析完成」的资料发起审核。
  // 引擎对文本缺失的资料是宽容的（engine 会记「N 份资料尚未完成解析，未参与本次审核」），
  // 但宽容在这里是错的：对 UPLOADED/PROCESSING/FAILED 的资料发起审核，
  // 产出的是一份看起来跑完、实际什么都没查的「幽灵报告」——
  // 与其让使用者拿到误导性结论，不如在这一步就明确拒绝，等解析完成。
  const notReady = rows.filter((row) => row.status !== "READY");
  if (notReady.length > 0) {
    throw errors.conflict("部分资料尚未完成解析（或解析失败），请等资料就绪后再发起审核。");
  }

  const provider = getAIProvider();
  const name = buildRunName(params.name, supplierName, template.name, rows);

  const run = await createReviewRun({
    workspaceId: params.workspaceId,
    name,
    supplierId,
    templateName: template.name,
    templateKey: template.key,
    templateSnapshot: {
      // 存的是**已校验**的配置对象，不是表单原文。
      ...(template.config as unknown as Record<string, unknown>),
      __source: template.source,
    },
    documentIds,
    engineProvider: provider.id,
    engineModel: provider.model,
    engineMock: provider.isMock,
    createdBy: params.userId,
  });

  await enqueueReviewRun(run.id, { requestId: opts?.requestId });
  logger.info("已创建审核任务", {
    reviewRunId: run.id,
    workspaceId: params.workspaceId,
    templateKey: template.key,
    documentCount: documentIds.length,
  });

  return run;
}

function dedupeUuids(values: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value === "string" && isUuid(value)) seen.add(value);
  }
  return [...seen];
}

/**
 * 审核记录的显示名。
 *
 * 「未命名主体」曾经是所有未关联供应商的审核的默认名 —— 实测跑到第三轮时，
 * 列表里已经是**三条一模一样的「未命名主体 · 供应商准入审核」**，
 * 除了时间戳没有任何东西能把它们区分开。这是列表最难用的地方。
 *
 * 回退顺序：用户填的名称 → 关联供应商名 → **资料文件名**（去掉扩展名）。
 * 文件名至少是用户自己认得的东西，而且此时已经确定可用（rows 刚回库校验过归属）。
 *
 * 刻意**不从正文里抽公司名放在这里**：那要等审核跑完才知道，
 * 而这条记录在「审核中」状态下就要能被人认出来。
 */
function buildRunName(
  requested: string | null | undefined,
  supplierName: string | null,
  templateName: string,
  rows: readonly Pick<DocumentWithTextRow, "originalFilename">[] = [],
): string {
  const trimmed = (requested ?? "").trim();
  if (trimmed.length > 0) {
    return trimmed.slice(0, MAX_RUN_NAME_CHARS);
  }
  const fallbackFilename = rows[0]?.originalFilename?.replace(/\.[^.]+$/, "").trim();
  const fallbackSubject = fallbackFilename
    ? rows.length > 1
      ? `${fallbackFilename} 等 ${rows.length} 份`
      : fallbackFilename
    : null;
  const subject = supplierName ?? fallbackSubject ?? "未命名主体";
  const stamp = new Date().toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${subject} · ${templateName} · ${stamp}`.slice(0, MAX_RUN_NAME_CHARS);
}

/* ------------------------------------------------------------------ */
/* 触发                                                               */
/* ------------------------------------------------------------------ */

export interface EnqueueReviewResult {
  queued: boolean;
  reason?: "not_found" | "already_running";
}

/**
 * 触发一次审核（或重新运行）。
 *
 * 允许重新认领 READY 的任务 —— 「重新运行」是明确的产品语义：
 * 资料补齐了就想再跑一次。findings 会被整体替换（见 replaceRunFindings），
 * 因此不会出现新旧结论混在一起。
 */
export async function enqueueReviewRun(
  runId: string,
  opts?: { requestId?: string },
): Promise<EnqueueReviewResult> {
  if (!isUuid(runId)) return { queued: false, reason: "not_found" };

  const claimed = await claimReviewRun(runId, REVIEW_STALE_THRESHOLD_MS);
  if (!claimed) {
    const existing = await findReviewRunById(runId);
    if (!existing) return { queued: false, reason: "not_found" };
    return { queued: false, reason: "already_running" };
  }

  // 不 await：调用方只负责排队，审核本身在串行队列里跑。
  // requestId 随闭包透传进 executeReviewRun，穿透异步边界，
  // 让后台审核任务的日志也能回溯到触发它的那次请求（HTTP 或 Server Action）。
  void runExclusive(() => executeReviewRun(claimed, { requestId: opts?.requestId })).catch(
    (error: unknown) => {
      logger.error("审核任务异常退出", { reviewRunId: runId, error });
    },
  );

  return { queued: true };
}

/* ------------------------------------------------------------------ */
/* 执行                                                               */
/* ------------------------------------------------------------------ */

/** 真正干活的地方。**必须在串行队列中运行**（与文档解析共用同一条队列，见 lib/jobs）。 */
export async function executeReviewRun(
  run: ReviewRun,
  opts?: { requestId?: string },
): Promise<void> {
  // 把入口请求带来的 requestId 合并进本任务的日志上下文，
  // 于是审核「开始 / 完成 / 失败」的每条日志都能回溯到触发它的那次请求。
  const log = logger.child({
    ...(opts?.requestId ? { requestId: opts.requestId } : {}),
    reviewRunId: run.id,
    workspaceId: run.workspaceId,
  });

  try {
    const documentIds = toStringArray(run.documentIds);
    const rows = await listDocumentsWithText(run.workspaceId, documentIds);
    const { documents, coverageNotes } = buildDocumentInputs(rows);

    const supplier = await loadSupplierContext(run.workspaceId, run.supplierId);
    const config = parseTemplateConfig(run.templateSnapshot);
    const provider = getAIProvider();

    const outcome = await withTimeout(
      runReviewEngine({
        documents,
        config,
        supplierName: supplier.name,
        supplierUscc: supplier.uscc,
        supplierSubjectType: supplier.subjectType,
        now: new Date(),
        maxFindings: MAX_REVIEW_FINDINGS,
      }),
      REVIEW_TIMEOUT_MS,
      () => errors.internal(`审核执行超时（${REVIEW_TIMEOUT_MS} 毫秒），已中止。`),
    );

    const findings: NewReviewFinding[] = outcome.findings.map((finding) => ({
      workspaceId: run.workspaceId,
      reviewRunId: run.id,
      ruleId: finding.ruleId,
      category: finding.category,
      severity: finding.severity,
      source: finding.category === "AI" ? "AI" : "RULE",
      title: finding.title,
      detail: finding.detail,
      recommendation: finding.recommendation ?? null,
      documentId: finding.documentId ?? null,
      documentLabel: finding.documentLabel ?? null,
      evidence: finding.evidence ?? null,
      locator: finding.locator ?? {},
    }));

    await replaceRunFindings(run.id, run.workspaceId, findings);

    await markReviewRunReady(
      run.id,
      {
        ...outcome.summary,
        // 引擎不知道这次到底取到了哪些文档，覆盖度说明由服务层补齐后合并。
        coverageNotes: [...coverageNotes, ...outcome.summary.coverageNotes],
      } as unknown as Record<string, unknown>,
      { enabled: outcome.ai.enabled, notes: outcome.ai.notes },
      { provider: provider.id, model: provider.model, mock: provider.isMock },
    );

    log.info("审核完成", {
      findingCount: outcome.findings.length,
      blockingCount: outcome.summary.blockingCount,
      documentCount: outcome.summary.documentCount,
      readableDocumentCount: outcome.summary.readableDocumentCount,
    });
  } catch (error) {
    const appError = toAppError(error);
    await markReviewRunFailed(
      run.id,
      appError.code,
      appError.message.slice(0, MAX_ERROR_MESSAGE_CHARS),
    ).catch((markError: unknown) => {
      log.error("标记审核失败状态时出错", { markError });
    });
    log.error("审核执行失败", { code: appError.code, error: appError.message });
  }
}

/** 允许重新运行一个已完成任务（供服务端调用，不做授权 —— 授权在调用方）。 */
export async function rerunReview(runId: string): Promise<EnqueueReviewResult> {
  return enqueueReviewRun(runId);
}

/* ------------------------------------------------------------------ */
/* 僵尸任务扫尾（sweep）                                                */
/* ------------------------------------------------------------------ */

/**
 * 把僵死的审核任务静默收尾：RUNNING → FAILED（带「系统中断」文案）。
 *
 * 物理事实：进程被 OOM / 重启杀掉时，已认领（RUNNING）的任务永远不会有人来
 * 写终态，使用者的界面就永远转圈。claimReviewRun 的 stale 重认领允许**手动**
 * 重跑抢回，本函数是同一把标尺下的**自动**收尾（触发：/api/cron/gc）。
 *
 * 判定安全性：单次执行被 withTimeout(REVIEW_TIMEOUT_MS=60s) 硬性兜底，
 * RUNNING 超过 5 分钟只可能是进程死亡；良性竞态的分析见
 * documents/service.sweepStuckDocuments（同一套论证，阈值更宽裕）。
 * QUEUED 不在扫尾范围：任务尚未开跑，且用户随时可以手动重跑（claim 认 QUEUED）。
 */
export async function sweepStuckReviewRuns(options?: { now?: Date }): Promise<number> {
  const now = options?.now ?? new Date();
  const staleBefore = new Date(now.getTime() - REVIEW_STALE_THRESHOLD_MS);

  const runIds = await failStaleRunningReviewRuns(
    staleBefore,
    ERROR_CODES.INTERNAL_ERROR,
    STUCK_JOB_ERROR_MESSAGE,
  );

  if (runIds.length > 0) {
    logger.warn("扫尾：僵死审核任务已打回 FAILED", { reviewRunIds: runIds });
  }

  return runIds.length;
}

/* ------------------------------------------------------------------ */
/* 输入装配                                                           */
/* ------------------------------------------------------------------ */

interface BuildDocumentInputsResult {
  documents: ReviewDocumentInput[];
  /** 服务层特有的覆盖度说明（引擎看不到的部分）。 */
  coverageNotes: string[];
}

/**
 * 把数据库行拼成引擎输入，并施加**总字符预算**。
 *
 * 预算用尽时后续文档被截断并把 truncated 置为 true —— 于是规则会如实报出
 * 「正文超出提取上限」而不是静默少看内容。这里刻意不复用文档解析时的
 * `truncated`（那是提取器的事实），而是产生一个新的、属于本次审核的覆盖度事实。
 */
function buildDocumentInputs(rows: DocumentWithTextRow[]): BuildDocumentInputsResult {
  const documents: ReviewDocumentInput[] = [];
  const coverageNotes: string[] = [];
  let budget = MAX_TOTAL_REVIEW_CHARS;
  let budgetExhausted = 0;

  for (const row of rows) {
    const fullText = row.text ?? "";
    const originalTruncated = row.truncated ?? false;
    let text = fullText;
    let truncated = originalTruncated;

    if (text.length > budget) {
      text = text.slice(0, Math.max(0, budget));
      truncated = true;
      budgetExhausted += 1;
    }
    budget -= text.length;

    documents.push({
      id: row.id,
      label: row.safeFilename,
      originalFilename: row.originalFilename,
      mimeType: row.mimeType,
      status: row.status,
      parserId: row.parserId,
      text,
      charCount: text.length,
      truncated,
      pageCount: row.pageCount,
      notes: toStringArray(row.notes),
    });
  }

  if (budgetExhausted > 0) {
    coverageNotes.push(
      `有 ${budgetExhausted} 份资料因超出本次审核的正文预算被截断，超出部分未参与审核。`,
    );
  }

  const missing = rows.length;
  if (missing === 0) {
    coverageNotes.push("本次审核没有取到任何资料记录（可能已被删除）。");
  }

  return { documents, coverageNotes };
}

/**
 * 取出申报主体的名称与信用代码。
 *
 * 两个都取而不是只取名称：「出现多个主体代码」这条规则要靠申报主体的代码
 * 才能区分「资料里混进了别人」和「资料里本来就有第三方机构的代码」——
 * 后者在中国的检测报告、验资报告里几乎必然出现，按前者处理就是高频误报。
 */
async function loadSupplierContext(
  workspaceId: string,
  supplierId: string | null,
): Promise<{ name: string | null; uscc: string | null; subjectType: SubjectType | null }> {
  if (!supplierId) return { name: null, uscc: null, subjectType: null };
  const [supplier] = await findSuppliersByIds(workspaceId, [supplierId]);
  if (!supplier) return { name: null, uscc: null, subjectType: null };
  return {
    name: supplier.name,
    uscc: supplier.unifiedSocialCreditCode ?? null,
    // 用户没选就是 null。刻意不兜底成 "ENTERPRISE"：规则会因此降级成提示，
    // 这比替用户声明"这是企业"然后冤枉一份自然人资料要好。
    subjectType: supplier.subjectType ?? null,
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
