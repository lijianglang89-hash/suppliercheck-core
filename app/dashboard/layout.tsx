import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/shell";
import { getCurrentUser } from "@/lib/auth/guards";
import { ensureWorkspaceForUser } from "@/lib/auth/workspaces";

/**
 * 显式声明按请求渲染。
 * 依赖会话的 layout 如果被静态预渲染，构建时的重定向会被缓存下来，
 * 导致生产环境下所有用户都被弹回登录页 —— 这类问题在 dev 模式下看不出来。
 */
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/dashboard");
  }

  const workspace = await ensureWorkspaceForUser(user.id);

  return (
    <DashboardShell
      user={{ displayName: user.displayName, email: user.email }}
      workspace={{ name: workspace.name, role: workspace.role }}
    >
      {children}
    </DashboardShell>
  );
}
