import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/shell";
import { getCurrentUser } from "@/lib/auth/guards";
import { ensureWorkspaceForUser } from "@/lib/auth/workspaces";

/**
 * 与 dashboard 完全一致的保护方式：
 * 依赖会话的 layout 一旦被静态预渲染，构建期的重定向会被缓存下来，
 * 生产环境会把所有用户弹回登录页 —— 这类问题在 dev 模式下看不出来。
 */
export const dynamic = "force-dynamic";

export default async function DocumentsLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/documents");
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
