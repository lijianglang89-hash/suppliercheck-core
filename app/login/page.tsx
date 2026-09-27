import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { loginAction } from "@/app/actions/auth";
import { AuthForm } from "@/components/auth/auth-form";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getCurrentUser } from "@/lib/auth/guards";
import { resolveSafeRedirect } from "@/lib/auth/redirect";
import { logger } from "@/lib/logger";

export const metadata: Metadata = {
  title: "登录",
  description: "登录供应商智审，管理你的供应商资料审核工作区。",
  alternates: { canonical: "/login" },
  /**
   * 登录页不参与搜索排名：页面只有一个表单，对搜索用户没有价值，
   * 让它进索引只会稀释站内质量信号。
   * follow 保留 —— 万一有外部链接指向这里，权重仍应流向站内其他页面。
   * 注意不能用 robots.txt 的 Disallow 代替，原因见 app/robots.ts。
   */
  robots: { index: false, follow: true },
};

/** 读取会话与数据库，必须按请求渲染。 */
export const dynamic = "force-dynamic";

export default async function LoginPage(props: PageProps<"/login">) {
  const searchParams = await props.searchParams;
  const nextParam = typeof searchParams.next === "string" ? searchParams.next : undefined;
  const nextPath = resolveSafeRedirect(nextParam);

  /**
   * 已登录用户直接进入目标页。
   * 这里刻意做降级处理：数据库暂时不可用时，登录页本身仍应能展示，
   * 让用户在提交时看到明确错误，而不是整页 500。异常依然会进日志。
   */
  try {
    const user = await getCurrentUser();
    if (user) redirect(nextPath);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    logger.warn("登录页会话检查失败，降级为展示登录表单", { error: error as Error });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">登录</h1>
        <p className="mt-2 text-sm text-ink-600">使用邮箱和密码登录你的供应商智审账号。</p>

        <div className="mt-8 card p-6">
          <AuthForm mode="login" action={loginAction} nextPath={nextParam ? nextPath : undefined} />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

/**
 * next/navigation 的 redirect() 通过抛异常实现，必须原样透传，
 * 否则会被上面的 catch 当成普通错误吞掉。
 */
function isRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}
