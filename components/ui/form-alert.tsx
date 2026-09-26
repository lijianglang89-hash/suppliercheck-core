import type { FormState } from "@/lib/forms/form-state";

/**
 * 表单反馈条。
 *
 * 刻意只有一个组件：所有业务表单的错误/成功提示都必须长得一样、
 * 都必须带 `role="alert"` —— 屏幕阅读器用户与视力用户应当同时拿到信息。
 * 让每个表单各自写一遍，迟早有一个忘掉 aria 属性。
 */
export function FormAlert({ state }: { state: FormState }) {
  if (state.status === "idle") return null;

  if (state.status === "error" && state.error) {
    return (
      <p
        role="alert"
        aria-live="polite"
        className="rounded-md border border-danger-600/30 bg-red-50 px-3 py-2 text-sm text-danger-600"
      >
        {state.error}
      </p>
    );
  }

  if (state.status === "success" && state.success) {
    return (
      <p
        role="status"
        aria-live="polite"
        className="rounded-md border border-ink-200 bg-ink-50 px-3 py-2 text-sm text-success-600"
      >
        {state.success}
      </p>
    );
  }

  return null;
}

/** 字段级错误提示。与 FormAlert 分开，因为它的位置必须紧跟输入框。 */
export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-danger-600">{message}</p>;
}
