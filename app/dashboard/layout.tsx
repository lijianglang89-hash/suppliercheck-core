import { ProtectedShell } from "@/components/dashboard/protected-shell";

/**
 * 工作台外壳。
 *
 * 与其余六个业务路由共用同一个受保护外壳（见 components/dashboard/protected-shell.tsx），
 * 这样「会话校验 + 工作区成员校验」只有一份实现 —— 分叉出去的那一份迟早会被漏改。
 */
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedShell nextPath="/dashboard">{children}</ProtectedShell>;
}
