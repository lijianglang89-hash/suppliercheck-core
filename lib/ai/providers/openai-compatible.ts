/**
 * OpenAI-compatible 真实 AI Provider（DeepSeek / 百炼-Qwen / Kimi 通吃）。
 *
 * ## 面向失效的弹性骨架
 *
 * 真实模型服务的故障形态是有限的、可枚举的，本实现的处置策略逐一对应：
 *
 * | 故障形态                     | 处置                                           |
 * |------------------------------|------------------------------------------------|
 * | 429 / 5xx / 网络错误 / 超时  | 指数退避重试（尊重 Retry-After，±15% Jitter）  |
 * | 4xx（鉴权 / 参数 / 配额尽）  | **不重试** —— 重试只会原样再失败一次          |
 * | 输出不是合法 JSON            | 视为该次尝试失败，进入重试                     |
 * | 输出不符合 Zod schema        | 视为该次尝试失败，进入重试                     |
 * | 重试耗尽                     | 抛 AI_PROVIDER_ERROR（含末次失败摘要），绝不静默 |
 *
 * 结构化输出走 `response_format: json_object` + 本地 Zod 校验 ——
 * schema 是接口契约（见 types.ts），模型输出不合格就重试，绝不把未校验的
 * 数据当作结论交给上层。
 *
 * ## 可注入点（全部有默认值，生产零配置）
 *
 * `fetchImpl` / `retryBaseDelayMs` / `timeoutMs` 均可注入 ——
 * 故障注入测试据此用假 fetch 钉死重试与兜底契约，不碰真实网络。
 *
 * ## 纪律
 *
 * 本类就位**不等于**启用 AI。启用需要显式配置 AI_PROVIDER="openai-compatible"
 * 与 AI_API_KEY；在那之前 getAIProvider() 永远返回 Mock，
 * ai-pass 依旧如实报告「AI 复核未启用」。
 */
import { z } from "zod";

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

export const OPENAI_COMPATIBLE_PROVIDER_ID = "openai-compatible";
/** 默认指向 DeepSeek（James 选型：正式环境 DeepSeek 优先，百炼-Qwen 为备选）。 */
export const DEFAULT_OPENAI_BASE_URL = "https://api.deepseek.com/v1";
export const DEFAULT_OPENAI_MODEL = "deepseek-chat";

export interface OpenAICompatibleProviderOptions {
  apiKey: string;
  /** 模型名，如 deepseek-chat / qwen-plus。 */
  model?: string;
  /** OpenAI 兼容端点（不含 /chat/completions 尾巴）。 */
  baseUrl?: string;
  /** 单次 HTTP 请求超时。 */
  timeoutMs?: number;
  /** 单次逻辑调用（含重试）的最大请求次数。 */
  maxAttempts?: number;
  /** 重试退避基数（毫秒）。测试注入 0 以保持确定性。 */
  retryBaseDelayMs?: number;
  /** HTTP 客户端注入点。测试用假 fetch 模拟 429 / 5xx / 超时。 */
  fetchImpl?: typeof fetch;
}

interface ChatOptions {
  system?: string;
  prompt: string;
  /** 要求模型只输出 JSON 对象（OpenAI-compatible 的 response_format）。 */
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly id = OPENAI_COMPATIBLE_PROVIDER_ID;
  readonly model: string;
  readonly isMock = false;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAICompatibleProviderOptions) {
    if (!options.apiKey || options.apiKey.trim().length === 0) {
      throw errors.configuration("OpenAI-compatible Provider 需要 AI_API_KEY。");
    }

    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_OPENAI_MODEL;
    this.baseUrl = (options.baseUrl ?? DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.retryBaseDelayMs = Math.max(0, options.retryBaseDelayMs ?? 500);
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const text = await this.chat({
      system: input.system,
      prompt: input.prompt,
      temperature: input.temperature,
      maxTokens: input.maxOutputTokens,
    });
    return { provider: this.id, model: this.model, mock: false, text };
  }

  async generateStructuredOutput<T>(
    input: GenerateStructuredOutputInput<T>,
  ): Promise<GenerateStructuredOutputResult<T>> {
    const data = await this.chatStructured<T>({
      system: input.system,
      prompt: input.prompt,
      schema: input.schema,
      temperature: input.temperature,
    });
    return { provider: this.id, model: this.model, mock: false, data };
  }

  async classify(input: ClassifyInput): Promise<ClassifyResult> {
    // label 被钉死在候选集合里：模型给出集合外的标签视同本次失败并重试。
    const schema = z.object({
      label: z.enum(input.labels as unknown as [string, ...string[]]),
      confidence: z.number().min(0).max(1).optional(),
    });

    const data = await this.chatStructured({
      system: input.instructions ?? "你是严谨的文本分类器。只输出 JSON，不要输出任何其他文字。",
      prompt: [
        `从以下候选标签中选出最匹配的一个：${input.labels.join("、")}。`,
        `文本：\n${input.text}`,
        '只输出 JSON：{"label": "<候选标签>", "confidence": <0~1>}',
      ].join("\n"),
      schema,
      temperature: 0,
    });

    return {
      provider: this.id,
      model: this.model,
      mock: false,
      label: data.label,
      confidence: data.confidence ?? 0,
    };
  }

  async extractEntities(input: ExtractEntitiesInput): Promise<ExtractEntitiesResult> {
    const schema = z.object({
      entities: z.array(
        z.object({
          type: z.string(),
          value: z.string().min(1),
          confidence: z.number().min(0).max(1).optional(),
        }),
      ),
    });

    const data = await this.chatStructured({
      system: "你是信息抽取器。只输出 JSON，不要输出任何其他文字。",
      prompt: [
        `从文本中抽取以下类型的实体：${input.entityTypes.join("、")}。`,
        `文本：\n${input.text}`,
        '只输出 JSON：{"entities": [{"type": "...", "value": "...", "confidence": <0~1>}]}',
        "没有抽到就输出空数组，绝不编造。",
      ].join("\n"),
      schema,
      temperature: 0,
    });

    // 模型可能返回目标类型之外的实体：过滤而不是报错（类型外信息不采纳，也不阻断）。
    const allowed = new Set(input.entityTypes);
    return {
      provider: this.id,
      model: this.model,
      mock: false,
      entities: data.entities
        .filter((entity) => allowed.has(entity.type))
        .map((entity) => ({
          type: entity.type,
          value: entity.value,
          confidence: entity.confidence ?? 0,
        })),
    };
  }

  async analyzeEvidence(input: AnalyzeEvidenceInput): Promise<AnalyzeEvidenceResult> {
    const schema = z.object({
      conclusion: z.string(),
      confidence: z.number().min(0).max(1).optional(),
      citations: z.array(z.string()).optional(),
      notes: z.string().optional(),
    });

    const evidenceText = input.evidence
      .map((candidate) => `[${candidate.id}] ${candidate.text}`)
      .join("\n\n");

    const data = await this.chatStructured({
      system:
        "你是供应商资质材料的复核分析员。基于给定证据回答问题，" +
        "只输出 JSON，不要输出任何其他文字。证据里没有的结论不要编。",
      prompt: [
        `问题：${input.question}`,
        `证据（方括号内是证据 id，引用时必须使用这些 id）：\n${evidenceText}`,
        '只输出 JSON：{"conclusion": "<结论，没有就给空字符串>", "confidence": <0~1>, "citations": ["<证据id>"], "notes": "<可选说明>"}',
      ].join("\n"),
      schema,
      temperature: 0,
    });

    // citations 只保留真实存在的证据 id：模型幻觉出的引用一律剔除。
    const knownIds = new Set(input.evidence.map((candidate) => candidate.id));
    return {
      provider: this.id,
      model: this.model,
      mock: false,
      conclusion: data.conclusion,
      confidence: data.confidence ?? 0,
      citations: (data.citations ?? []).filter((id) => knownIds.has(id)),
      notes: data.notes,
    };
  }

  /* ---------------------------------------------------------------- */

  /** 单条消息体的弹性 chat：返回模型输出文本。重试与兜底策略见文件头。 */
  private async chat(options: ChatOptions): Promise<string> {
    let lastFailure = "";

    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      if (attempt > 0) {
        await this.sleep(this.backoffDelayMs(attempt, lastFailure));
      }

      try {
        return await this.chatOnce(options);
      } catch (error) {
        const failure = toFailure(error);
        if (!failure.retryable) {
          throw errors.ai(`AI 服务拒绝了请求：${failure.summary}`, {
            details: { attempt: attempt + 1 },
          });
        }
        lastFailure = failure.summary;
      }
    }

    throw errors.ai(`AI 服务连续 ${this.maxAttempts} 次调用失败：${lastFailure}`, {
      details: { attempts: this.maxAttempts },
    });
  }

  /** 结构化输出：JSON 模式 + Zod 校验。校验失败视同本次尝试失败（进入重试）。 */
  private async chatStructured<T>(options: {
    system?: string;
    prompt: string;
    schema: z.ZodType<T>;
    temperature?: number;
  }): Promise<T> {
    // 给模型的结构说明由 Zod schema 自动生成 —— schema 是唯一事实源，
    // prompt 里的说明与本地校验永远不会漂移。
    const schemaHint = describeSchema(options.schema);
    const promptWithOptions = [
      options.prompt,
      `输出必须严格符合以下 JSON Schema：\n${schemaHint}`,
    ].join("\n");

    let lastFailure = "";

    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      if (attempt > 0) {
        await this.sleep(this.backoffDelayMs(attempt, lastFailure));
      }

      try {
        const text = await this.chatOnce({ ...options, prompt: promptWithOptions, jsonMode: true });
        const parsed = options.schema.safeParse(parseJsonLoose(text));
        if (!parsed.success) {
          lastFailure = `输出不符合约定结构：${parsed.error.issues
            .slice(0, 3)
            .map((issue) => `${issue.path.join(".") || "root"} ${issue.message}`)
            .join("；")}`;
          continue;
        }
        return parsed.data;
      } catch (error) {
        const failure = toFailure(error);
        if (!failure.retryable) {
          throw errors.ai(`AI 服务拒绝了请求：${failure.summary}`, {
            details: { attempt: attempt + 1 },
          });
        }
        lastFailure = failure.summary;
      }
    }

    throw errors.ai(`AI 服务连续 ${this.maxAttempts} 次未能给出符合约定结构的输出：${lastFailure}`, {
      details: { attempts: this.maxAttempts },
    });
  }

  private async chatOnce(options: ChatOptions): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            ...(options.system ? [{ role: "system", content: options.system }] : []),
            { role: "user", content: options.prompt },
          ],
          ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
          ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
          ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = (await response.text().catch(() => "")).slice(0, 300);
        const retryable = response.status === 429 || response.status >= 500;
        throw new HttpFailure(response.status, body, retryable, response.headers.get("retry-after"));
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        // 服务端 200 但响应形状不对：服务端异常的一种，归入可重试。
        throw new NonRetryableAwareFailure("响应缺少 choices[0].message.content", true);
      }
      return content;
    } catch (error) {
      if (error instanceof HttpFailure || error instanceof NonRetryableAwareFailure) throw error;
      // fetch 的网络错误与超时 AbortError 都长这样：瞬时故障，可重试。
      throw new NonRetryableAwareFailure(error instanceof Error ? error.message : String(error), true);
    } finally {
      clearTimeout(timer);
    }
  }

  /** 重试等待：优先尊重 Retry-After，否则指数退避，一律加 ±15% Jitter。 */
  private backoffDelayMs(attempt: number, lastFailure: string): number {
    const retryAfterMatch = /retry[- ]after[:\s]*(\d+)/i.exec(lastFailure);
    if (retryAfterMatch) {
      const seconds = Number(retryAfterMatch[1]);
      if (Number.isFinite(seconds) && seconds > 0 && seconds <= 60) {
        return seconds * 1000;
      }
    }
    const base = this.retryBaseDelayMs * 2 ** (attempt - 1);
    return Math.round(base * (1 + (Math.random() * 0.3 - 0.15)));
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/* ------------------------------------------------------------------ */

class HttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly retryable: boolean,
    readonly retryAfter: string | null,
  ) {
    super(`HTTP ${status}${body ? `：${body}` : ""}${retryAfter ? `（Retry-After: ${retryAfter}）` : ""}`);
  }
}

class NonRetryableAwareFailure extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

function toFailure(error: unknown): { retryable: boolean; summary: string } {
  if (error instanceof HttpFailure) {
    const summary = error.retryAfter
      ? `${error.message}`
      : error.message;
    return { retryable: error.retryable, summary };
  }
  if (error instanceof NonRetryableAwareFailure) {
    return { retryable: error.retryable, summary: error.message };
  }
  return { retryable: false, summary: error instanceof Error ? error.message : String(error) };
}

/** 宽松 JSON 解析：剥掉偶发的 ```json 围栏再 parse。 */
function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new NonRetryableAwareFailure("输出不是合法 JSON", true);
  }
}

/** 把 Zod schema 转成给模型看的结构说明（zod v4 原生支持 JSON Schema）。 */
function describeSchema<T>(schema: z.ZodType<T>): string {
  try {
    return JSON.stringify(z.toJSONSchema(schema, { io: "output" }));
  } catch {
    return "（结构说明生成失败，请按提示中的字段示例输出）";
  }
}
