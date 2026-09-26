/**
 * 服务端环境变量入口。
 *
 * 拆成两层的原因（见 nextjs16-windows-scaffold 技能坑 5）：
 * - ./schema.ts 是纯函数，可被 Vitest 直接测试；
 * - 本文件带 "server-only"，任何非服务端引用都会在构建期报错。
 *
 * 读取是惰性的：只有第一次真正调用 getEnv() 时才校验，避免 `next build`
 * 在收集页面阶段因为缺少运行时密钥而失败。
 */
import "server-only";

import { parseServerEnv, type ServerEnv } from "./schema";

let cached: ServerEnv | undefined;

export function getEnv(): ServerEnv {
  if (cached === undefined) {
    cached = parseServerEnv(process.env as Record<string, string | undefined>);
  }
  return cached;
}

/** 仅供测试使用：清空缓存，让下一次 getEnv() 重新读取。 */
export function resetEnvCache(): void {
  cached = undefined;
}
