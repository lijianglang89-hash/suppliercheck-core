/**
 * 开发用 Mock AI Provider。
 *
 * 行为准则（需求「十六、不要制造假 AI」）：
 * - 绝不伪造「看起来像真实分析」的内容。所有返回值都带 mock: true。
 * - 无法诚实地产出结构化结果时，**宁可抛错也不编造**。
 *   调用方若确实需要结构化结果，必须显式提供 fixture（测试里这样做）。
 * - 不调用网络、不需要 API Key，因此 V0.1 可以在零配置下启动。
 */
import { errors } from "@/lib/errors";
import type {
  AIProvider,
  AnalyzeEvidenceInput,
  AnalyzeEvidenceResult,
  ClassifyInput,
  ClassifyResult,
  ExtractEntitiesInput,
  ExtractEntitiesResult,
  GenerateStructuredOutputInput,
  GenerateStructuredOutputResult,
  GenerateTextInput,
  GenerateTextResult,
} from "../types";

export const MOCK_PROVIDER_ID = "mock";
export const MOCK_MODEL_ID = "mock-development";

/** UI 上统一使用的演示模式提示文案。 */
export const MOCK_DISCLAIMER = "开发模拟结果：尚未接入真实 AI 模型，此结果不构成任何审核结论。";

export interface MockAIProviderOptions {
  /**
   * 结构化输出的预置数据。
   * key 为请求 prompt，value 为将被 schema 校验的原始数据。
   * 没有命中时抛错，避免返回编造内容。
   */
  structuredFixtures?: Record<string, unknown>;
}

export class MockAIProvider implements AIProvider {
  readonly id = MOCK_PROVIDER_ID;
  readonly model = MOCK_MODEL_ID;
  readonly isMock = true;

  private readonly fixtures: Record<string, unknown>;

  constructor(options: MockAIProviderOptions = {}) {
    this.fixtures = options.structuredFixtures ?? {};
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    void input;
    return {
      provider: this.id,
      model: this.model,
      mock: true,
      text: `[开发占位] ${MOCK_DISCLAIMER}`,
    };
  }

  async generateStructuredOutput<T>(
    input: GenerateStructuredOutputInput<T>,
  ): Promise<GenerateStructuredOutputResult<T>> {
    const fixture = this.fixtures[input.prompt];

    if (fixture === undefined) {
      throw errors.ai(
        "MockAIProvider 拒绝为该请求生成结构化输出：未提供 fixture，编造数据会误导用户。",
        {
          details: {
            hint: "请在构造 MockAIProvider 时通过 structuredFixtures 传入预期数据，或接入真实 AI Provider。",
          },
        },
      );
    }

    const parsed = input.schema.safeParse(fixture);
    if (!parsed.success) {
      throw errors.ai("MockAIProvider 提供的 fixture 不符合目标 schema。", {
        details: { issues: parsed.error.issues.map((issue) => issue.message) },
      });
    }

    return { provider: this.id, model: this.model, mock: true, data: parsed.data };
  }

  async classify(input: ClassifyInput): Promise<ClassifyResult> {
    void input;
    // 不做任何猜测：固定落到最后一个标签（契约上以 "Other" 收尾），置信度为 0。
    return {
      provider: this.id,
      model: this.model,
      mock: true,
      label: "Other",
      confidence: 0,
    };
  }

  async extractEntities(input: ExtractEntitiesInput): Promise<ExtractEntitiesResult> {
    void input;
    // 空数组是诚实的：没有真实模型就不假装抽到了实体。
    return { provider: this.id, model: this.model, mock: true, entities: [] };
  }

  async analyzeEvidence(input: AnalyzeEvidenceInput): Promise<AnalyzeEvidenceResult> {
    void input;
    return {
      provider: this.id,
      model: this.model,
      mock: true,
      conclusion: "",
      confidence: 0,
      citations: [],
      notes: MOCK_DISCLAIMER,
    };
  }
}
