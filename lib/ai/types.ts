/**
 * AI 能力抽象层 · 类型定义
 *
 * 存在意义（需求「五、未来 AI 架构必须从第一天抽象」）：
 * 业务代码永远不应该直接 import 某个厂商 SDK，也不应该硬编码模型名。
 * 所有 AI 调用都必须经过 AIProvider 接口，未来才能在
 * 百炼 / Qwen、OpenAI、DeepSeek、Kimi 等 OpenAI-compatible 服务之间切换。
 *
 * 重要设计约束（需求「十六、不要制造假 AI」）：
 * 每个返回值都带 `mock` 标记。Mock 结果必须在 UI 上明确标注为开发模拟，
 * 不允许让用户误以为完成了真实模型推理。
 */
import type { ZodType } from "zod";

export interface AIUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/** 所有 AI 调用共有的来源元信息。 */
export interface AIResultMeta {
  /** 供应商标识，例如 "mock" / "openai-compatible"。 */
  provider: string;
  /** 实际使用的模型名。mock 下为 "mock-development"。 */
  model: string;
  /** true 表示这是开发用 Mock 结果，不是真实模型推理。 */
  mock: boolean;
  usage?: AIUsage;
}

/* ------------------------------ 文本生成 ------------------------------ */

export interface GenerateTextInput {
  prompt: string;
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface GenerateTextResult extends AIResultMeta {
  text: string;
}

/* --------------------------- 结构化输出生成 --------------------------- */

export interface GenerateStructuredOutputInput<T> {
  prompt: string;
  system?: string;
  /** 期望的输出结构。Provider 负责让模型产出并校验符合该 schema 的数据。 */
  schema: ZodType<T>;
  temperature?: number;
}

export interface GenerateStructuredOutputResult<T> extends AIResultMeta {
  data: T;
}

/* -------------------------------- 分类 -------------------------------- */

export interface ClassifyInput {
  text: string;
  /** 候选标签集合。返回的 label 必须属于该集合。 */
  labels: readonly string[];
  instructions?: string;
}

export interface ClassifyResult extends AIResultMeta {
  label: string;
  /** 0 ~ 1。Mock 下恒为 0，因为不构成任何真实判断。 */
  confidence: number;
}

/* ------------------------------ 实体抽取 ------------------------------ */

export interface ExtractEntitiesInput {
  text: string;
  /** 需要抽取的实体类型，例如 ["company_name", "certificate_no", "expiry_date"]。 */
  entityTypes: readonly string[];
}

export interface ExtractedEntity {
  type: string;
  value: string;
  confidence: number;
  start?: number;
  end?: number;
}

export interface ExtractEntitiesResult extends AIResultMeta {
  entities: ExtractedEntity[];
}

/* ------------------------------ 证据分析 ------------------------------ */

export interface EvidenceCandidate {
  id: string;
  text: string;
  source?: string;
}

export interface AnalyzeEvidenceInput {
  question: string;
  evidence: readonly EvidenceCandidate[];
}

export interface AnalyzeEvidenceResult extends AIResultMeta {
  conclusion: string;
  confidence: number;
  /** 支撑该结论的证据 id 列表。 */
  citations: string[];
  notes?: string;
}

/* ------------------------------- 接口 -------------------------------- */

export interface AIProvider {
  readonly id: string;
  readonly model: string;
  /** 供上层判断是否需要展示「演示模式」提示。 */
  readonly isMock: boolean;

  generateText(input: GenerateTextInput): Promise<GenerateTextResult>;

  generateStructuredOutput<T>(
    input: GenerateStructuredOutputInput<T>,
  ): Promise<GenerateStructuredOutputResult<T>>;

  classify(input: ClassifyInput): Promise<ClassifyResult>;

  extractEntities(input: ExtractEntitiesInput): Promise<ExtractEntitiesResult>;

  analyzeEvidence(input: AnalyzeEvidenceInput): Promise<AnalyzeEvidenceResult>;
}
