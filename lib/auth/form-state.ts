/**
 * 认证表单的共享状态类型。
 * 单独成文件，避免 "use server" 模块导出非函数值。
 */
export interface AuthFormState {
  /** 整体错误（面向用户的安全文案）。 */
  error?: string;
  /** 字段级错误。 */
  fieldErrors?: Record<string, string>;
  /** 上一次提交的邮箱，用于回填，避免用户重打。 */
  email?: string;
}

export const EMPTY_AUTH_FORM_STATE: AuthFormState = {};
