"use client";

import { usePathname } from "next/navigation";

import { NAV_SECTIONS } from "@/lib/navigation";

/**
 * 侧边栏导航。
 *
 * 单独做成客户端组件的原因只有一个：需要 `usePathname()` 来标记当前页。
 * V0.1 里这段逻辑写死了 `/dashboard`，加了资料库之后必须按路径高亮，
 * 否则用户在 /documents 上看到的是工作台被选中。
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
              const active = item.available && isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  {item.available ? (
                    <a
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={
                        active
                          ? "block rounded-md bg-brand-50 px-2 py-1.5 text-sm font-medium text-brand-700"
                          : "block rounded-md px-2 py-1.5 text-sm font-medium text-ink-800 hover:bg-ink-100"
                      }
                    >
                      {item.label}
                    </a>
                  ) : (
                    <span
                      aria-disabled="true"
                      className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-ink-400"
                    >
                      {item.label}
                      <span className="text-[10px] uppercase tracking-wide">即将开放</span>
                    </span>
                  )}
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
