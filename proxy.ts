import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";

/**
 * 应用区入口的乐观校验（Next 16 用 proxy.ts 取代 middleware.ts）。
 *
 * 职责边界非常重要：
 * - 这里**只**做「有没有会话 Cookie」的粗筛，避免未登录用户看到应用外壳；
 * - 真实的身份与工作区授权**一律**在页面 / Server Action 里通过
 *   requireUser() / requireWorkspaceAccess() 完成；
 * - proxy 中不做数据库查询，也不作为安全边界。
 *
 * 因此即使绕过本文件，也无法读到任何他人数据。
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  if (hasSessionCookie) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  const target = `${pathname}${search}`;
  if (target !== "/dashboard") {
    loginUrl.searchParams.set("next", target);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  /**
   * 只覆盖需要登录的应用区。刻意不匹配 /api、/og、/sitemap.xml、robots.txt，
   * 也排除所有静态资源，避免无谓开销。
   */
  matcher: [
    "/dashboard/:path*",
    "/suppliers/:path*",
    "/reviews/:path*",
    "/reports/:path*",
    "/templates/:path*",
    "/settings/:path*",
  ],
};
