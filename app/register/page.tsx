import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { registerAction } from "@/app/actions/auth";
import { AuthForm } from "@/components/auth/auth-form";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getCurrentUser } from "@/lib/auth/guards";
import { logger } from "@/lib/logger";
import { REVIEW_RULES } from "@/lib/reviews/rules";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "免费体验",
  description: "注册供应商智审账号，创建工作区并开始审核供应商资料。",
  alternates: { canonical: "/register" },
  /** 与 /login 同理：表单页不参与排名，去索引靠这里而不是 robots.txt。 */
  robots: { index: false, follow: true },
};

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  try {
    const user = await getCurrentUser();
    if (user) redirect("/dashboard");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    logger.warn("注册页会话检查失败，降级为展示注册表单", { error: error as Error });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">免费体验</h1>
        <p className="mt-2 text-sm text-ink-600">
          创建账号后会自动为你建立一个工作区，资料按工作区隔离存放。
        </p>

        <div className="mt-8 card p-6">
          <AuthForm mode="register" action={registerAction} />
        </div>

        <p className="mt-6 text-xs leading-5 text-ink-500">
          当前为 V{siteConfig.version}：上传资料后即可发起审核，结论由 {REVIEW_RULES.length}{" "}
          条确定性规则产出，可逐条追溯。
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}

function isRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}
