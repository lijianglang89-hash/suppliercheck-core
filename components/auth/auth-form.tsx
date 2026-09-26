"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { AuthFormState } from "@/lib/auth/form-state";
import { EMPTY_AUTH_FORM_STATE } from "@/lib/auth/form-state";

type AuthAction = (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;

interface AuthFormProps {
  mode: "login" | "register";
  action: AuthAction;
  /** 登录成功后要跳回的站内路径（注册页不适用）。 */
  nextPath?: string;
}

const inputClassName =
  "mt-1.5 block w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none";

export function AuthForm({ mode, action, nextPath }: AuthFormProps) {
  const [state, formAction, pending] = useActionState(action, EMPTY_AUTH_FORM_STATE);
  const isRegister = mode === "register";

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {nextPath ? <input type="hidden" name="next" value={nextPath} /> : null}

      {state.error ? (
        <p
          role="alert"
          aria-live="polite"
          className="rounded-md border border-danger-600/30 bg-red-50 px-3 py-2 text-sm text-danger-600"
        >
          {state.error}
        </p>
      ) : null}

      {isRegister ? (
        <div>
          <label htmlFor="displayName" className="block text-sm font-medium text-ink-700">
            称呼
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            autoComplete="name"
            required
            maxLength={60}
            className={inputClassName}
            placeholder="例如：张采购"
          />
          {state.fieldErrors?.displayName ? (
            <p className="mt-1 text-xs text-danger-600">{state.fieldErrors.displayName}</p>
          ) : null}
        </div>
      ) : null}

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-ink-700">
          邮箱
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email ?? ""}
          className={inputClassName}
          placeholder="you@company.com"
        />
        {state.fieldErrors?.email ? (
          <p className="mt-1 text-xs text-danger-600">{state.fieldErrors.email}</p>
        ) : null}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-ink-700">
          密码
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={isRegister ? "new-password" : "current-password"}
          required
          minLength={isRegister ? 8 : undefined}
          maxLength={128}
          className={inputClassName}
          placeholder={isRegister ? "至少 8 位" : "请输入密码"}
        />
        {state.fieldErrors?.password ? (
          <p className="mt-1 text-xs text-danger-600">{state.fieldErrors.password}</p>
        ) : null}
      </div>

      {isRegister ? (
        <div>
          <label htmlFor="workspaceName" className="block text-sm font-medium text-ink-700">
            工作区名称 <span className="font-normal text-ink-400">（可选）</span>
          </label>
          <input
            id="workspaceName"
            name="workspaceName"
            type="text"
            maxLength={80}
            className={inputClassName}
            placeholder="例如：采购部资料审核"
          />
          <p className="mt-1 text-xs text-ink-500">
            工作区是资料隔离单位。资料只对工作区成员可见，可留空由系统自动命名。
          </p>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-brand-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "提交中…" : isRegister ? "创建账号" : "登录"}
      </button>

      <p className="text-center text-sm text-ink-500">
        {isRegister ? (
          <>
            已有账号？{" "}
            <Link href="/login" className="font-medium text-brand-700 hover:underline">
              去登录
            </Link>
          </>
        ) : (
          <>
            还没有账号？{" "}
            <Link href="/register" className="font-medium text-brand-700 hover:underline">
              免费体验
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
