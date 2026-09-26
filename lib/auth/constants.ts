/**
 * 认证相关常量。
 * 单独成文件是因为 proxy.ts 需要读取 Cookie 名，而 proxy 运行在受限环境，
 * 不应该引入带 "server-only" 的会话模块。
 */
export const SESSION_COOKIE_NAME = "sc_session" as const;
