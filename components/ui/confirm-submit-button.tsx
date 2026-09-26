"use client";

import { useFormStatus } from "react-dom";

/**
 * 带二次确认的提交按钮。
 *
 * 用于删除、归档这类**改变数据可见性**的动作。
 * 用 `window.confirm` 而不是自绘弹窗是有意的：它零依赖、无 JS 也能退化
 * （退化后按钮仍然会提交 —— 这时 confirm 不生效，但我们只在少数破坏性动作上用它，
 * 且服务端对这些动作都做了幂等处理，见 runTolerantOfMissing）。
 */
export interface ConfirmSubmitButtonProps {
  children: React.ReactNode;
  /** 确认弹窗文案。 */
  message: string;
  pendingText?: string;
  variant?: "secondary" | "danger";
}

const VARIANT_CLASS = {
  secondary: "border-ink-300 bg-white text-ink-700 hover:bg-ink-50",
  danger: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
} as const;

export function ConfirmSubmitButton({
  children,
  message,
  pendingText = "处理中…",
  variant = "secondary",
}: ConfirmSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      onClick={(event) => {
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      }}
      className={`inline-flex items-center justify-center rounded-md border px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${VARIANT_CLASS[variant]}`}
    >
      {pending ? pendingText : children}
    </button>
  );
}
