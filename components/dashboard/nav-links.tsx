"use client";

import { usePathname } from "next/navigation";

import { Icon } from "@/components/ui/icons";
import { NAV_SECTIONS } from "@/lib/navigation";

/**
 * 侧边栏导航。
 *
 * 做成客户端组件的唯一原因：需要 `usePathname()` 来标记当前页。
 * 这一点在加了多个顶级路由之后变得必要 —— 写死 `/dashboard` 会让用户在
 * /reviews 上看到「工作台」被高亮。
 *
 * 这里不再有「即将开放」的禁用项：导航只列真实可用的页面（理由见 lib/navigation.ts）。
 */
export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav aria-label="应用导航" className="px-3 pb-4">
      {NAV_SECTIONS.map((section) => (
        <div key={section.label} className="mt-3">
          <p className="px-2 text-xs font-medium uppercase tracking-wider text-ink-400">
            {section.label}
          </p>
          <ul className="mt-1 space-y-0.5">
            {section.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <a
                    href={item.href}
                    title={item.hint}
                    aria-current={active ? "page" : undefined}
                    className={
                      active
                        ? "flex items-center gap-2 rounded-md bg-brand-50 px-2 py-1.5 text-sm font-medium text-brand-700"
                        : "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-ink-800 hover:bg-ink-100"
                    }
                  >
                    <Icon
                      name={item.icon}
                      className={active ? "h-4 w-4 text-brand-600" : "h-4 w-4 text-ink-400"}
                    />
                    {item.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}
