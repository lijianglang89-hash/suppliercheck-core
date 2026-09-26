/**
 * 结构化日志。
 *
 * 需求「二十九、日志」的落地约束：
 * - 生产环境不打印 secrets / API keys / 完整用户文件内容 / 完整企业资料；
 * - error 日志必须带 requestId 或 jobId，便于串联排查；
 * - 输出为单行 JSON，方便日后接入阿里云 SLS。
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** 命中即整值替换为 "[REDACTED]"，不会泄露长度或前缀。 */
const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|api[_-]?key|apikey|authorization|cookie|credential|private[_-]?key|session)/i;

/** 单条字符串字段的最大保留长度，超出即截断并标注，避免把文件正文写进日志。 */
const MAX_STRING_LENGTH = 300;
const MAX_DEPTH = 5;

function truncate(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}…[truncated ${value.length - MAX_STRING_LENGTH} chars]`;
}

/** 递归脱敏。对循环引用、超深结构、函数、Symbol 都做安全降级。 */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") return truncate(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return "[Function]";
  if (typeof value === "symbol") return value.toString();

  if (depth >= MAX_DEPTH) return "[MaxDepth]";

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: truncate(value.message), stack: value.stack };
  }
  if (value instanceof Uint8Array) {
    // 二进制内容一律不进日志，只记录长度。
    return `[Binary ${value.byteLength} bytes]`;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redact(item, depth + 1, seen));
  }

  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (seen.has(object)) return "[Circular]";
    seen.add(object);

    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(object)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redact(item, depth + 1, seen);
    }
    return output;
  }

  return String(value);
}

export interface LogContext {
  requestId?: string;
  jobId?: string;
  workspaceId?: string;
  userId?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(context: LogContext): Logger;
}

function resolveMinLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  return "info";
}

function write(level: LogLevel, message: string, context: LogContext): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[resolveMinLevel()]) return;

  const record = {
    level,
    time: new Date().toISOString(),
    message: truncate(message),
    ...(redact(context) as Record<string, unknown>),
  };

  const line = JSON.stringify(record);
  if (level === "error" || level === "warn") {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

function makeLogger(base: LogContext): Logger {
  return {
    debug: (message, context) => write("debug", message, { ...base, ...context }),
    info: (message, context) => write("info", message, { ...base, ...context }),
    warn: (message, context) => write("warn", message, { ...base, ...context }),
    error: (message, context) => write("error", message, { ...base, ...context }),
    child: (context) => makeLogger({ ...base, ...context }),
  };
}

export const logger: Logger = makeLogger({});
