import { ProtectedShell } from "@/components/dashboard/protected-shell";

/**
 * 设置 路由的外壳。
 *
 * 保护逻辑与 app/dashboard/layout.tsx 完全一致（同一个组件），
 * 只有未登录时的回跳地址不同 —— 登录完要回到用户原来想去的那页。
 *
 * ⚠️ dynamic = "force-dynamic" 不能省：依赖会话的 layout 一旦被静态预渲染，
 * 构建期的重定向会被缓存下来，生产环境会把所有用户弹回登录页。
 */
export const dynamic = "force-dynamic";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedShell nextPath="/settings">{children}</ProtectedShell>;
}
