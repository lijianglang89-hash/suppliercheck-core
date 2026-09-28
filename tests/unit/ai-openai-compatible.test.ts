/**
 * OpenAI-compatible Provider 的故障注入契约测试。
 *
 * 真实模型服务的故障形态有限且可枚举，本文件逐一注入并钉死处置策略：
 *
 *   200 + 合法输出        → 原样返回，meta 带 mock:false
 *   429 / 5xx             → 指数退避重试，恢复后成功（验证请求次数）
 *   连续 5xx 直至耗尽     → AI_PROVIDER_ERROR，不静默
 *   4xx                   → 不重试（重试只会原样再失败），单次请求即抛
 *   非 JSON / 不合 schema → 视为该次尝试失败，重试耗尽后 AI_PROVIDER_ERROR
 *   网络挂起              → 超时中断后按可重试处置
 *   citations 幻觉        → 只保留真实存在的证据 id
 *
 * 全程不碰真实网络：fetchImpl / retryBaseDelayMs / timeoutMs 全部注入。
 * 这些是**测试夹具**，不是假 AI —— AI_PROVIDER=mock 的默认值不变。
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ERROR_CODES } from "@/lib/errors";
import {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  OpenAICompatibleProvider,
} from "@/lib/ai/providers/openai-compatible";
import { AppError } from "@/lib/errors";

type FetchCall = { url: string; init: RequestInit };

/** 依次吐出预设响应的假 fetch，并记录每次调用。 */
function makeFetch(
  responses: Array<{ status: number; body?: string; headers?: Record<string, string> } | { hang: true }>,
): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let index = 0;
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const spec = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if ("hang" in spec) {
      return new Promise<Response>((_resolve, reject) => {
        const signal = (init as RequestInit).signal as AbortSignal;
        signal.addEventListener("abort", () =>
          reject(new DOMException("This operation was aborted", "AbortError")),
        );
      });
    }
    return new Response(spec.body ?? "", {
      status: spec.status,
      headers: spec.headers,
    });
  }) as typeof fetch;
  return { fetch: impl, calls };
}

function okChat(content: unknown): { status: number; body: string } {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  return { status: 200, body: JSON.stringify({ choices: [{ message: { content: text } }] }) };
}

function makeProvider(fetchImpl: typeof fetch, overrides = {}) {
  return new OpenAICompatibleProvider({
    apiKey: "sk-test",
    retryBaseDelayMs: 0,
    ...overrides,
    fetchImpl,
  });
}

const lastUserPrompt = (call: FetchCall): string => {
  const body = JSON.parse(String(call.init.body)) as { messages: Array<{ role: string; content: string }> };
  return body.messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
};

describe("OpenAI-compatible Provider 故障注入契约", () => {
  it("200 + 合法输出：generateText 原样返回，meta 为真实模型（mock:false）", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([okChat("你好，世界")]);
    const provider = makeProvider(fetchImpl);

    const result = await provider.generateText({ prompt: "打个招呼" });

    expect(result.text).toBe("你好，世界");
    expect(result.provider).toBe("openai-compatible");
    expect(result.model).toBe(DEFAULT_OPENAI_MODEL);
    expect(result.mock).toBe(false);
    // 默认端点与请求形态
    expect(calls[0]?.url).toBe(`${DEFAULT_OPENAI_BASE_URL}/chat/completions`);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test");
  });

  it("429 两次后恢复：重试成功，共请求 3 次", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      { status: 429, body: "rate limited", headers: { "retry-after": "0" } },
      { status: 429, body: "rate limited" },
      okChat("恢复后的回答"),
    ]);
    const provider = makeProvider(fetchImpl);

    const result = await provider.generateText({ prompt: "hi" });

    expect(result.text).toBe("恢复后的回答");
    expect(calls.length).toBe(3);
  });

  it("连续 5xx 耗尽重试：抛 AI_PROVIDER_ERROR，不静默、不返回编造内容", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      { status: 503, body: "upstream unavailable" },
    ]);
    const provider = makeProvider(fetchImpl);

    const error = await provider.generateText({ prompt: "hi" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ERROR_CODES.AI_PROVIDER_ERROR);
    expect(calls.length).toBe(3); // maxAttempts 默认 3
    expect((error as AppError).message).toContain("连续 3 次");
  });

  it("4xx 不重试：单次请求即抛（重试只会原样再失败）", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([
      { status: 401, body: "invalid api key" },
    ]);
    const provider = makeProvider(fetchImpl);

    await expect(provider.generateText({ prompt: "hi" })).rejects.toThrow(/HTTP 401/);
    expect(calls.length).toBe(1);
  });

  it("结构化输出：JSON 模式开启、Zod 校验通过后返回强类型数据", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([okChat('{"label": "Other", "confidence": 0.4}')]);
    const provider = makeProvider(fetchImpl);

    const result = await provider.generateStructuredOutput({
      prompt: "分类这段话",
      schema: z.object({ label: z.string(), confidence: z.number().optional() }),
    });

    expect(result.data.label).toBe("Other");
    expect(result.data.confidence).toBe(0.4);
    // JSON 模式 + schema 说明必须进 prompt（说明与校验同源，不会漂移）
    const body = JSON.parse(String(calls[0]?.init.body)) as { response_format?: unknown };
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(lastUserPrompt(calls[0]!)).toContain("JSON Schema");
  });

  it("输出不是合法 JSON：进入重试；耗尽后抛 AI_PROVIDER_ERROR", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([okChat("这不是 JSON，是模型的废话")]);
    const provider = makeProvider(fetchImpl);

    const error = await provider
      .generateStructuredOutput({ prompt: "p", schema: z.object({ a: z.string() }) })
      .catch((e: unknown) => e);

    expect((error as AppError).code).toBe(ERROR_CODES.AI_PROVIDER_ERROR);
    expect(calls.length).toBe(3);
  });

  it("输出不符合 schema：重试耗尽后抛错，错误里带 Zod 摘要", async () => {
    const { fetch: fetchImpl } = makeFetch([okChat('{"wrong": "shape"}')]);
    const provider = makeProvider(fetchImpl);

    const error = await provider
      .generateStructuredOutput({ prompt: "p", schema: z.object({ must: z.string() }) })
      .catch((e: unknown) => e);

    expect((error as AppError).code).toBe(ERROR_CODES.AI_PROVIDER_ERROR);
    expect((error as AppError).message).toContain("约定结构");
  });

  it("网络挂起：超时中断后按可重试处置（三次挂起 → AI_PROVIDER_ERROR）", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([{ hang: true }]);
    const provider = makeProvider(fetchImpl, { timeoutMs: 20 });

    const error = await provider.generateText({ prompt: "hi" }).catch((e: unknown) => e);

    expect((error as AppError).code).toBe(ERROR_CODES.AI_PROVIDER_ERROR);
    expect(calls.length).toBe(3);
  });

  it("analyzeEvidence：citations 里的幻觉 id 被剔除，字段缺失时 confidence 如实落 0", async () => {
    const { fetch: fetchImpl } = makeFetch([
      okChat({
        conclusion: "存在矛盾",
        citations: ["ev-1", "ev-hallucinated"],
        // confidence 故意缺失
      }),
    ]);
    const provider = makeProvider(fetchImpl);

    const result = await provider.analyzeEvidence({
      question: "有没有矛盾？",
      evidence: [
        { id: "ev-1", text: "证据一" },
        { id: "ev-2", text: "证据二" },
      ],
    });

    expect(result.conclusion).toBe("存在矛盾");
    expect(result.citations).toEqual(["ev-1"]);
    expect(result.confidence).toBe(0);
  });

  it("classify：候选集合外的 label 视为失败并重试，耗尽后抛错", async () => {
    const { fetch: fetchImpl, calls } = makeFetch([okChat('{"label": "不在候选里"}')]);
    const provider = makeProvider(fetchImpl);

    const error = await provider
      .classify({ text: "文本", labels: ["A", "B"] })
      .catch((e: unknown) => e);

    expect((error as AppError).code).toBe(ERROR_CODES.AI_PROVIDER_ERROR);
    expect(calls.length).toBe(3);
  });
});
