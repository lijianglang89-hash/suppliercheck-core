/**
 * 环境变量 Schema 与纯校验逻辑。
 *
 * 本文件不 import "server-only"，也不读取 process.env —— 它只接受一个普通对象，
 * 因此可以在单元测试里直接调用。真正的环境读取在 ./server-env.ts。
 */
import { z } from "zod";

/** 已接入的 AI 供应商标识。V0.1 只实现 mock。 */
export const AI_PROVIDER_IDS = ["mock", "openai-compatible"] as const;
export type AIProviderId = (typeof AI_PROVIDER_IDS)[number];

/** 存储后端标识。V0.1 只实现 local。 */
export const STORAGE_PROVIDER_IDS = ["local", "oss"] as const;
export type StorageProviderId = (typeof STORAGE_PROVIDER_IDS)[number];

const MEGABYTE = 1024 * 1024;

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /** 对外可访问的站点根地址，用于 canonical / OG / sitemap 的绝对 URL。 */
  APP_URL: z.string().url().default("http://localhost:3010"),

  /** PostgreSQL 连接串。业务代码只依赖标准 PostgreSQL，不绑定任何托管供应商。 */
  DATABASE_URL: z.string().min(1, "DATABASE_URL 不能为空"),

  /** 会话 Cookie 的 HMAC 签名密钥，至少 32 字符。 */
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET 至少需要 32 个字符"),

  AI_PROVIDER: z.enum(AI_PROVIDER_IDS).default("mock"),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  /** OpenAI 兼容协议的 base url，未来切换百炼 / DeepSeek / Kimi 时使用。 */
  AI_BASE_URL: z.string().url().optional(),

  STORAGE_PROVIDER: z.enum(STORAGE_PROVIDER_IDS).default("local"),
  /** 私有存储根目录。绝不能位于 public/ 下。 */
  STORAGE_PATH: z.string().min(1).default("./data/uploads"),

  /** 单个上传文件的大小上限（字节）。 */
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(25 * MEGABYTE),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  /** 结构化日志之外的额外开关：把未捕获异常打到 stdout。 */
  LOG_PRETTY: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`环境变量校验失败：\n- ${issues.join("\n- ")}`);
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

/**
 * 校验原始环境变量对象。校验失败时一次性抛出全部问题（而不是只报第一个），
 * 方便部署时一轮改完。
 */
export function parseServerEnv(raw: Record<string, string | undefined>): ServerEnv {
  // 把空字符串视作「未设置」，避免 .env 里 `AI_API_KEY=` 被当成有效值。
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    normalized[key] = value === "" ? undefined : value;
  }

  const parsed = serverEnvSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new EnvValidationError(
      parsed.error.issues.map((issue) => {
        const path = issue.path.join(".") || "(root)";
        return `${path}: ${issue.message}`;
      }),
    );
  }

  // 交叉字段校验：接真实模型时必须有密钥与模型名。
  const crossIssues: string[] = [];
  if (parsed.data.AI_PROVIDER !== "mock") {
    if (!parsed.data.AI_API_KEY) {
      crossIssues.push(`AI_API_KEY: AI_PROVIDER=${parsed.data.AI_PROVIDER} 时必须提供`);
    }
    if (!parsed.data.AI_MODEL) {
      crossIssues.push(`AI_MODEL: AI_PROVIDER=${parsed.data.AI_PROVIDER} 时必须提供`);
    }
  }
  if (parsed.data.STORAGE_PROVIDER === "oss") {
    crossIssues.push("STORAGE_PROVIDER: V0.1 尚未实现 oss，请保持 local");
  }
  if (crossIssues.length > 0) {
    throw new EnvValidationError(crossIssues);
  }

  return parsed.data;
}

/**
 * 判断某个环境变量名是否属于「敏感字段」。日志脱敏时使用。
 */
export function isSensitiveEnvKey(key: string): boolean {
  return /(SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE|CREDENTIAL)/i.test(key);
}
