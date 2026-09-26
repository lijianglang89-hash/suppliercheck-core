/**
 * 会话读写（依赖 next/headers，只能在服务端运行时使用）。
 * 纯签名逻辑在 ./session-token.ts，便于单元测试。
 */
import "server-only";

import { cookies } from "next/headers";

import { getEnv } from "@/lib/config/server-env";

import { SESSION_COOKIE_NAME } from "./constants";
import {
  SESSION_DEFAULT_TTL_SECONDS,
  createSessionToken,
  verifySessionToken,
  type SessionPayload,
} from "./session-token";

export { SESSION_COOKIE_NAME };

/** 读取并校验当前会话。无效或过期一律返回 undefined，不抛错。 */
export async function readSession(): Promise<SessionPayload | undefined> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return undefined;

  const result = verifySessionToken(token, getEnv().SESSION_SECRET);
  return result.valid ? result.payload : undefined;
}

/** 建立会话：写入 HttpOnly + SameSite=Lax 的签名 Cookie。 */
export async function establishSession(userId: string): Promise<void> {
  const env = getEnv();
  const token = createSessionToken({ userId, secret: env.SESSION_SECRET });

  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DEFAULT_TTL_SECONDS,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}

export type { SessionPayload } from "./session-token";
