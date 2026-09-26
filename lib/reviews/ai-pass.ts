/**
 * AI 复核（第二遍）。
 *
 * ## 为什么它默认是「未启用」而不是「已启用但没结果」
 *
 * 需求里有一条硬约束：**不要制造假 AI**。当前项目只注册了开发模拟 Provider，
 * 它的 `analyzeEvidence()` 永远返回空结论 + 免责声明 —— 它本来就不构成任何判断。
 *
 * 因此本模块在 Provider 是模拟实现时，直接返回 `enabled: false`，
 * 并把「为什么没有 AI 复核」写清楚。界面据此展示「AI 复核：未启用（原因）」，
 * 而不是渲染一段读起来像结论的糊话。
 *
 * 这个区别不是措辞讲究：把模拟结果摆在规则引擎的发现旁边，
 * 用户会默认两者可信度相当 —— 那是误导。
 *
 * ## 接入真实 Provider 后会发生什么
 *
 * 工厂返回非 mock 时，本模块会对固定的几个复核问题调用 `analyzeEvidence()`，
 * 把**有结论的**结果转成 source = AI 的发现（严重级别最高只到 MEDIUM ——
 * 模型结论不参与阻断判定）。空结论直接丢弃，绝不补一句"未发现异常"来充数。
 */
import { getAIProvider, MOCK_DISCLAIMER, type AIProvider } from "@/lib/ai";

import type { AiReviewOutcome, DraftFinding, ReviewDocumentInput } from "./types";

/** 单份资料送进模型的字符上限。模型不是硬盘，证据要挑要害给。 */
const MAX_CHARS_PER_DOCUMENT = 1_500;
/** 送进模型的证据总字符上限。 */
const MAX_TOTAL_EVIDENCE_CHARS = 12_000;

/**
 * 复核问题清单。
 *
 * 刻意只有三条，且都是**规则引擎结构上覆盖不到**的判断（需要跨段落语义理解）。
 * 凡是正则能查的（日期、校验位、金额）都不该交给模型 ——
 * 那些交给模型只会让结论从"可复现"退化成"每次都不同"。
 */
const REVIEW_QUESTIONS = [
  "这批资料在申报主体身份上是否存在规则检查未覆盖的矛盾或疑点？",
  "这批资料里是否有任何证据表明某项资质可能失效、被撤销或不适用于所述业务范围？",
  "这批资料是否存在明显的不一致（例如业务范围与产品、产能与订单量之间的矛盾）？",
] as const;

export interface AiReviewPassInput {
  documents: ReviewDocumentInput[];
  /** 供测试注入假 Provider。省略时使用全局工厂。 */
  provider?: AIProvider;
}

export async function runAiReviewPass(input: AiReviewPassInput): Promise<AiReviewOutcome> {
  const provider = input.provider ?? getAIProvider();
  const identity = { provider: provider.id, model: provider.model, mock: provider.isMock };

  if (provider.isMock) {
    return {
      ...identity,
      enabled: false,
      notes: [
        `AI 复核未启用：当前 AI Provider 是开发模拟实现（${provider.id} / ${provider.model}），` +
          "它不产生任何真实判断，因此没有可展示的复核结论。",
        MOCK_DISCLAIMER,
        "本报告的结论全部来自确定性规则引擎，可逐条追溯到原文与判定依据。",
      ],
      findings: [],
    };
  }

  const evidence = buildEvidence(input.documents);
  if (evidence.length === 0) {
    return {
      ...identity,
      enabled: true,
      notes: ["已调用 AI 复核，但本次没有可用的正文证据，未产生任何复核结论。"],
      findings: [],
    };
  }

  const findings: DraftFinding[] = [];
  const notes: string[] = [];

  for (const question of REVIEW_QUESTIONS) {
    try {
      const result = await provider.analyzeEvidence({ question, evidence });
      const conclusion = result.conclusion.trim();
      if (conclusion.length === 0) {
        notes.push(`复核问题「${question}」未返回结论，已如实记录为「无结论」。`);
        continue;
      }
      findings.push({
        ruleId: "AI_REVIEW",
        category: "AI",
        severity: "MEDIUM",
        title: `AI 复核：${question}`,
        detail: conclusion,
        recommendation: "以上为模型复核意见，不构成事实判定，请结合原始资料人工确认。",
        locator: {
          question,
          citations: result.citations,
          confidence: result.confidence,
          model: result.model,
        },
      });
    } catch (error) {
      notes.push(
        `复核问题「${question}」调用失败：${error instanceof Error ? error.message : "未知错误"}。`,
      );
    }
  }

  return { ...identity, enabled: true, notes, findings };
}

function buildEvidence(
  documents: ReviewDocumentInput[],
): Array<{ id: string; text: string; source: string }> {
  const evidence: Array<{ id: string; text: string; source: string }> = [];
  let budget = MAX_TOTAL_EVIDENCE_CHARS;

  for (const document of documents) {
    if (budget <= 0) break;
    if (document.status !== "READY" || document.charCount === 0) continue;

    const slice = document.text.slice(0, Math.min(MAX_CHARS_PER_DOCUMENT, budget));
    if (slice.trim().length === 0) continue;

    evidence.push({ id: document.id, text: slice, source: document.label });
    budget -= slice.length;
  }

  return evidence;
}
