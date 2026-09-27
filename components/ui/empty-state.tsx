import type { ReactNode } from "react";

import { Icon, type IconName } from "@/components/ui/icons";

/**
 * 空状态基座：图标 + 一句话 + 可选的行动按钮。
 *
 * 一行灰字的空状态等于把人丢在半路 —— 用户第一次打开某个空列表时，
 * 这个位置必须回答两件事：这里将来会有什么（title）、
 * 现在能做什么（children 里的按钮/链接）。
 */
export function EmptyState({
  icon = "inbox",
  title,
  hint,
  children,
}: {
  icon?: IconName;
  title: string;
  hint?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-ink-300 bg-white px-6 py-10 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-ink-100 text-ink-400">
        <Icon name={icon} className="h-5 w-5" />
      </div>
      <p className="mt-3 text-sm font-medium text-ink-800">{title}</p>
      {hint ? (
        <div className="mx-auto mt-1 max-w-md text-sm leading-6 text-ink-500">{hint}</div>
      ) : null}
      {children ? <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div> : null}
    </div>
  );
}
