import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/shell";
import { getCurrentUser } from "@/lib/auth/guards";
import { ensureWorkspaceForUser } from "@/lib/auth/workspaces";

/**
 * 受保护页面的统一外壳。
 *
 * 六个业务路由（工作台 / 资料库 / 供应商 / 资料审核 / 审核报告 / 审核模板 / 设置）
 * 的保护方式必须**逐字相同**，否则迟早有一个新页面忘了挡 —— 而漏掉的那个
 * 恰恰是没人在测试里点到过的。把这段逻辑收在一处，各处 layout 只声明自己的回跳地址。
 *
 * ⚠️ 调用方必须 `export const dynamic = "force-dynamic"`：
 * 依赖会话的 layout 一旦被静态预渲染，构建期的重定向会被缓存下来，
 * 生产环境会把所有用户弹回登录页 —— 这类问题在 dev 模式下看不出来。
 */
export async function ProtectedShell({
  nextPath,
  children,
}: {
  /** 未登录时的回跳地址，例如 "/reviews"。 */
  nextPath: string;
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
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
