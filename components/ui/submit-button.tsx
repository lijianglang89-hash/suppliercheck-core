"use client";

import { useFormStatus } from "react-dom";

/**
 * 提交按钮。
 *
 * 用 `useFormStatus()` 而不是把 pending 从 useActionState 传下来：
 * 这样按钮可以被放进任意深度的子组件里，而不必把 pending 一路 props 透传 ——
 * 更关键的是，它读的是**最近一层 form** 的提交状态，天然不会串台。
 */
export interface SubmitButtonProps {
  children: React.ReactNode;
  /** 提交中的文案。 */
  pendingText?: string;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
}

const VARIANT_CLASS: Record<NonNullable<SubmitButtonProps["variant"]>, string> = {
  primary: "border-transparent bg-brand-700 text-white hover:bg-brand-800",
  secondary: "border-ink-300 bg-white text-ink-700 hover:bg-ink-50",
  danger: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
};

export function SubmitButton({
  children,
  pendingText = "提交中…",
  variant = "primary",
  className,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={
        className ??
        `inline-flex items-center justify-center rounded-md border px-3 py-2 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-60 ${VARIANT_CLASS[variant]}`
      }
    >
      {pending ? pendingText : children}
    </button>
  );
}
