/**
 * AI Provider 工厂。
 *
 * 业务代码只调用 getAIProvider()，不关心背后是哪家模型。
 * V0.1 只注册 Mock；接入真实模型时在 PROVIDER_FACTORIES 里加一项即可，
 * 调用方代码零改动。
 */
import { getEnv } from "@/lib/config/server-env";
import { errors } from "@/lib/errors";

import { MockAIProvider } from "./providers/mock";
import { OpenAICompatibleProvider } from "./providers/openai-compatible";
import type { AIProvider } from "./types";

type ProviderFactory = (options: { apiKey?: string; model?: string; baseUrl?: string }) => AIProvider;

/**
 * provider id 已在 lib/config/schema.ts 的 AI_PROVIDER_IDS 里注册。
 * 新增供应商时：加 id → 加工厂函数，调用方代码零改动。
 */
const PROVIDER_FACTORIES: Partial<Record<string, ProviderFactory>> = {
  mock: () => new MockAIProvider(),
  "openai-compatible": (options) => {
    if (!options.apiKey || options.apiKey.trim().length === 0) {
      throw errors.configuration(
        'AI_PROVIDER="openai-compatible" 需要配置 AI_API_KEY（以及建议配置 AI_MODEL / AI_BASE_URL）。',
      );
    }
    return new OpenAICompatibleProvider({
      apiKey: options.apiKey,
      model: options.model,
      baseUrl: options.baseUrl,
    });
  },
};

let cached: AIProvider | undefined;

export function getAIProvider(): AIProvider {
  if (cached) return cached;

  const env = getEnv();
  const factory = PROVIDER_FACTORIES[env.AI_PROVIDER];

  if (!factory) {
    throw errors.configuration(`AI_PROVIDER="${env.AI_PROVIDER}" 尚未实现对应 Provider。`, {
      details: { supported: Object.keys(PROVIDER_FACTORIES) },
    });
  }

  cached = factory({
    apiKey: env.AI_API_KEY,
    model: env.AI_MODEL,
    baseUrl: env.AI_BASE_URL,
  });
  return cached;
}

/** 仅供测试使用。 */
export function resetAIProviderCache(): void {
  cached = undefined;
}

export type { AIProvider } from "./types";
export {
  MOCK_DISCLAIMER,
  MOCK_MODEL_ID,
  MOCK_PROVIDER_ID,
  MockAIProvider,
} from "./providers/mock";
