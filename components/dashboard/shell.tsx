import { logoutAction } from "@/app/actions/auth";
import { NavLinks } from "@/components/dashboard/nav-links";

interface DashboardShellProps {
  user: { displayName: string; email: string };
  workspace: { name: string; role: string };
  children: React.ReactNode;
}

/**
 * 应用外壳：左侧导航 + 顶部信息条。
 *
 * 导航项按 available 标记区分「可用」与「即将开放」，不伪造可用功能。
 * 当前页高亮交给 NavLinks（客户端组件，需要 usePathname）。
 */
export function DashboardShell({ user, workspace, children }: DashboardShellProps) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="border-b border-ink-200 bg-white lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex h-16 items-center border-b border-ink-100 px-5">
          <span className="text-base font-semibold tracking-tight text-ink-900">供应商智审</span>
        </div>

        <div className="px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wider text-ink-400">工作区</p>
          <p className="mt-1 truncate text-sm font-medium text-ink-800" title={workspace.name}>
            {workspace.name}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">角色：{roleLabel(workspace.role)}</p>
        </div>

        <NavLinks />
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-ink-200 bg-white px-6">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink-800">{user.displayName}</p>
            <p className="truncate text-xs text-ink-500">{user.email}</p>
          </div>

          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-md border border-ink-300 bg-white px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-50"
            >
              退出登录
            </button>
          </form>
        </header>

        <main id="main" className="flex-1 px-6 py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function roleLabel(role: string): string {
  switch (role) {
    case "OWNER":
      return "所有者";
    case "ADMIN":
      return "管理员";
    case "MEMBER":
      return "成员";
    case "VIEWER":
      return "只读";
    default:
      return role;
  }
}
