"use client";

/**
 * 设置页的三张表单。
 *
 * 三张表单各自独立而不是合成一个「保存全部」：改密码失败不该连带把昵称改回去，
 * 而「一个按钮三个后端动作」必然要做成要么全成要么全败 —— 那是把简单问题做成分布式事务。
 *
 * 密码字段一律不回填（见 FormState.values 的注释），因此这里读 initial 而不是 state.values。
 */
import { useActionState } from "react";

import {
  changePasswordAction,
  renameWorkspaceAction,
  updateProfileAction,
} from "@/app/actions/settings";
import { FieldError, FormAlert } from "@/components/ui/form-alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { EMPTY_FORM_STATE } from "@/lib/forms/form-state";

const inputClassName =
  "mt-1.5 block w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none";

/* ------------------------------- 工作区 ------------------------------- */

export function WorkspaceNameForm({
  initialName,
  canEdit,
}: {
  initialName: string;
  canEdit: boolean;
}) {
  const [state, formAction] = useActionState(renameWorkspaceAction, EMPTY_FORM_STATE);

  if (!canEdit) {
    return (
      <div>
        <p className="text-sm font-medium text-ink-700">工作区名称</p>
        <p className="mt-1.5 text-sm text-ink-600">{initialName}</p>
        <p className="mt-1.5 text-xs text-ink-400">
          只有管理员可以修改工作区名称。你当前的角色是成员或只读成员。
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <div className="max-w-sm">
        <label htmlFor="workspace-name" className="block text-sm font-medium text-ink-700">
          工作区名称
        </label>
        <input
          id="workspace-name"
          name="name"
          required
          maxLength={80}
          defaultValue={state.values?.name ?? initialName}
          className={inputClassName}
        />
        <p className="mt-1 text-xs text-ink-400">显示在侧栏顶部，也在审核报告页脚出现。</p>
        <FieldError message={state.fieldErrors?.name} />
      </div>
      <SubmitButton pendingText="保存中…">保存名称</SubmitButton>
    </form>
  );
}

/* -------------------------------- 账号 -------------------------------- */

export function ProfileForm({ initialDisplayName }: { initialDisplayName: string }) {
  const [state, formAction] = useActionState(updateProfileAction, EMPTY_FORM_STATE);

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <div className="max-w-sm">
        <label htmlFor="display-name" className="block text-sm font-medium text-ink-700">
          称呼
        </label>
        <input
          id="display-name"
          name="displayName"
          required
          maxLength={60}
          defaultValue={state.values?.displayName ?? initialDisplayName}
          className={inputClassName}
        />
        <FieldError message={state.fieldErrors?.displayName} />
      </div>
      <SubmitButton pendingText="保存中…">保存资料</SubmitButton>
    </form>
  );
}

/* -------------------------------- 密码 -------------------------------- */

export function PasswordForm() {
  const [state, formAction] = useActionState(changePasswordAction, EMPTY_FORM_STATE);

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <FormAlert state={state} />

      <div className="grid max-w-lg gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="current-password" className="block text-sm font-medium text-ink-700">
            当前密码
          </label>
          <input
            id="current-password"
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
            className={inputClassName}
          />
          <FieldError message={state.fieldErrors?.currentPassword} />
        </div>

        <div>
          <label htmlFor="new-password" className="block text-sm font-medium text-ink-700">
            新密码
          </label>
          <input
            id="new-password"
            name="newPassword"
            type="password"
            required
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            className={inputClassName}
          />
          <p className="mt-1 text-xs text-ink-400">至少 8 位，不能与当前密码相同。</p>
          <FieldError message={state.fieldErrors?.newPassword} />
        </div>

        <div>
          <label htmlFor="confirm-password" className="block text-sm font-medium text-ink-700">
            确认新密码
          </label>
          <input
            id="confirm-password"
            name="confirmPassword"
            type="password"
            required
            autoComplete="new-password"
            className={inputClassName}
          />
          <FieldError message={state.fieldErrors?.confirmPassword} />
        </div>
      </div>

      <SubmitButton pendingText="更新中…">修改密码</SubmitButton>
      <p className="text-xs text-ink-400">修改成功后，其他设备上的登录会话仍然有效。</p>
    </form>
  );
}
