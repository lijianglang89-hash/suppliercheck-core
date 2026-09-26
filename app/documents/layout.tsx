import { ProtectedShell } from "@/components/dashboard/protected-shell";

/**
 * 资料库外壳。与工作台共用同一份保护逻辑，只有回跳地址不同。
 */
export const dynamic = "force-dynamic";

export default async function DocumentsLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedShell nextPath="/documents">{children}</ProtectedShell>;
}
