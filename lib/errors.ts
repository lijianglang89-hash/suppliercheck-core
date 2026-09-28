/**
 * 统一错误模型。
 *
 * 设计目标（对应需求「三十、错误处理」）：
 * - 不吞错：每个错误都有 code + 类别 + 可诊断上下文。
 * - 面向用户：toUserMessage() 只返回安全的、可读的中文提示。
 * - 面向开发者：日志里保留完整原因链，但绝不包含密钥或文件内容。
 */

export const ERROR_CODES = {
  // 输入类
  VALIDATION_FAILED: "VALIDATION_FAILED",
  // 认证与授权类
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  // 资源类
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  // 频次类
  RATE_LIMITED: "RATE_LIMITED",
  // 文件类
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  UNSUPPORTED_MEDIA_TYPE: "UNSUPPORTED_MEDIA_TYPE",
  UNSAFE_FILE_NAME: "UNSAFE_FILE_NAME",
  // 基础设施类
  DATABASE_UNAVAILABLE: "DATABASE_UNAVAILABLE",
  STORAGE_UNAVAILABLE: "STORAGE_UNAVAILABLE",
  AI_PROVIDER_ERROR: "AI_PROVIDER_ERROR",
  CONFIGURATION_ERROR: "CONFIGURATION_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * 错误分类，决定 HTTP 状态码与日志级别。
 * 未认证（401）与已认证但无权限（403）必须分开：
 * 前者应引导用户登录，后者登录了也没用，混用会把用户带进死循环。
 */
export type ErrorCategory =
  | "input"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "infra"
  | "internal";

const CATEGORY_BY_CODE: Record<ErrorCode, ErrorCategory> = {
  VALIDATION_FAILED: "input",
  UNAUTHENTICATED: "unauthenticated",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not_found",
  CONFLICT: "conflict",
  RATE_LIMITED: "rate_limited",
  FILE_TOO_LARGE: "input",
  UNSUPPORTED_MEDIA_TYPE: "input",
  UNSAFE_FILE_NAME: "input",
  DATABASE_UNAVAILABLE: "infra",
  STORAGE_UNAVAILABLE: "infra",
  AI_PROVIDER_ERROR: "infra",
  CONFIGURATION_ERROR: "infra",
  INTERNAL_ERROR: "internal",
};

const HTTP_STATUS_BY_CATEGORY: Record<ErrorCategory, number> = {
  input: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  infra: 503,
  internal: 500,
};

/** 对用户展示的安全文案。刻意不包含任何内部细节。 */
const USER_MESSAGE_BY_CODE: Record<ErrorCode, string> = {
  VALIDATION_FAILED: "提交的内容不完整或格式不正确，请检查后重试。",
  UNAUTHENTICATED: "请先登录后再继续操作。",
  FORBIDDEN: "你没有访问该资源的权限。",
  NOT_FOUND: "没有找到对应的资源。",
  CONFLICT: "该资源已存在，请勿重复提交。",
  RATE_LIMITED: "操作过于频繁，请稍等片刻再试。",
  FILE_TOO_LARGE: "文件超出大小限制，请压缩后重新上传。",
  UNSUPPORTED_MEDIA_TYPE: "不支持该文件类型。",
  UNSAFE_FILE_NAME: "文件名包含非法字符，请重命名后重新上传。",
  DATABASE_UNAVAILABLE: "数据库暂时不可用，请稍后重试。",
  STORAGE_UNAVAILABLE: "文件存储暂时不可用，请稍后重试。",
  AI_PROVIDER_ERROR: "智能分析服务暂时不可用，请稍后重试。",
  CONFIGURATION_ERROR: "服务配置有误，请联系管理员。",
  INTERNAL_ERROR: "服务器处理失败，请稍后重试。",
};

export interface AppErrorOptions {
  /** 触发该错误的原始异常，仅用于日志。 */
  cause?: unknown;
  /** 面向开发者的补充上下文，会进日志但不会进响应体。 */
  details?: Record<string, unknown>;
  /** 请求或任务标识，便于串联日志。 */
  requestId?: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly category: ErrorCategory;
  readonly status: number;
  readonly details: Record<string, unknown>;
  readonly requestId?: string;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.category = CATEGORY_BY_CODE[code];
    this.status = HTTP_STATUS_BY_CATEGORY[this.category];
    this.details = options.details ?? {};
    this.requestId = options.requestId;
  }

  /** 面向用户的安全文案。 */
  toUserMessage(): string {
    return USER_MESSAGE_BY_CODE[this.code];
  }

  /** 面向 API 响应体的可序列化结构。 */
  toResponseBody(): { error: { code: ErrorCode; message: string; requestId?: string } } {
    return {
      error: {
        code: this.code,
        message: this.toUserMessage(),
        ...(this.requestId ? { requestId: this.requestId } : {}),
      },
    };
  }

  /** 面向日志的完整结构。 */
  toLogPayload(): Record<string, unknown> {
    return {
      code: this.code,
      category: this.category,
      status: this.status,
      message: this.message,
      details: this.details,
      requestId: this.requestId,
      cause: serializeCause(this.cause),
    };
  }
}

/** 把任意异常规整成 AppError，保证调用方永远拿到统一结构。 */
export function toAppError(error: unknown, options: AppErrorOptions = {}): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof Error) {
    return new AppError(ERROR_CODES.INTERNAL_ERROR, error.message, { ...options, cause: error });
  }
  return new AppError(ERROR_CODES.INTERNAL_ERROR, "未知错误", { ...options, cause: error });
}

function serializeCause(cause: unknown): Record<string, unknown> | undefined {
  if (cause === undefined || cause === null) return undefined;
  if (cause instanceof Error) {
    return { name: cause.name, message: cause.message, stack: cause.stack };
  }
  return { value: String(cause) };
}

/** 便捷构造函数：让业务代码读起来更短。 */
export const errors = {
  validation: (message: string, options?: AppErrorOptions) =>
    new AppError(ERROR_CODES.VALIDATION_FAILED, message, options),
  unauthenticated: (message = "未登录", options?: AppErrorOptions) =>
    new AppError(ERROR_CODES.UNAUTHENTICATED, message, options),
  forbidden: (message: string, options?: AppErrorOptions) =>
    new AppError(ERROR_CODES.FORBIDDEN, message, options),
  notFound: (message: string, options?: AppErrorOptions) =>
    new AppError(ERROR_CODES.NOT_FOUND, message, options),
  conflict: (message: string, options?: AppErrorOptions) =>
    new AppError(ERROR_CODES.CONFLICT, message, options),
  /**
   * 频次超限。details.retryAfterSeconds 会被 route-utils 转成 Retry-After 响应头。
   */
  rateLimited: (message: string, options?: AppErrorOptions) =>
    new AppError(ERROR_CODES.RATE_LIMITED, message, options),
  fileTooLarge: (message: string, options?: AppErrorOptions) =>
    new AppError(ERROR_CODES.FILE_TOO_LARGE, message, options),
  unsupportedMediaType: (message: string, options?: AppErrorOptions) =>
    new AppError(ERROR_CODES.UNSUPPORTED_MEDIA_TYPE, message, options),
  unsafeFileName: (message: string, options?: AppErrorOptions) =>
    new AppError(ERROR_CODES.UNSAFE_FILE_NAME, message, options),
  database: (message: string, options?: AppErrorOptions) =>
    new AppError(ERROR_CODES.DATABASE_UNAVAILABLE, message, options),
  storage: (message: string, options?: AppErrorOptions) =>
    new AppError(ERROR_CODES.STORAGE_UNAVAILABLE, message, options),
  ai: (message: string, options?: AppErrorOptions) =>
    new AppError(ERROR_CODES.AI_PROVIDER_ERROR, message, options),
  configuration: (message: string, options?: AppErrorOptions) =>
    new AppError(ERROR_CODES.CONFIGURATION_ERROR, message, options),
  internal: (message: string, options?: AppErrorOptions) =>
    new AppError(ERROR_CODES.INTERNAL_ERROR, message, options),
};
