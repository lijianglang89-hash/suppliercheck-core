/**
 * 登录后跳转目标的校验（纯函数，可单测）。
 *
 * 目的：防止 open redirect —— 攻击者构造 /login?next=https://evil.com
 * 让用户在登录后被送到外部站点。
 */
const FALLBACK_PATH = "/dashboard";

export function resolveSafeRedirect(target: string | null | undefined, fallback = FALLBACK_PATH): string {
  if (!target || typeof target !== "string") return fallback;

  const trimmed = target.trim();
  if (trimmed.length === 0) return fallback;

  // 必须是站内绝对路径：以单个 "/" 开头。
  if (!trimmed.startsWith("/")) return fallback;
  // 排除协议相对 URL（//evil.com）与反斜杠变体（/\evil.com）。
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return fallback;
  // 排除控制字符与换行注入。
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return fallback;

  return trimmed;
}
