/**
 * 业务表单的共享状态类型。
 *
 * 与 `lib/auth/form-state.ts` 分开而不是合并：认证表单关心的是「邮箱回填 + 全局错误」，
 * 业务表单还需要「成功提示」与多字段回填。硬塞进一个类型只会让两边都带着用不到的字段。
 *
 * ⚠️ 单独成文件是硬要求：Server Action 模块带 `"use server"`，
 * 那里**只能导出异步函数**，导出一个常量会在构建期直接报错。
 */
export interface FormState {
  status: "idle" | "success" | "error";
  /** 面向用户的安全错误文案（不含内部细节）。 */
  error?: string;
  /** 成功提示。 */
  success?: string;
  /** 字段级错误。 */
  fieldErrors?: Record<string, string>;
  /**
   * 回填值。
   *
   * 存在的理由很具体：提交失败后把用户填的内容清空，是表单最容易被骂的体验。
   * 值只在**服务端校验通过前**回传，不含任何敏感字段（密码类字段一律不回填）。
   */
  values?: Record<string, string>;
}

export const EMPTY_FORM_STATE: FormState = { status: "idle" };

/** 把 zod 的 issues 折成「字段 → 第一条错误」的映射。 */
export function fieldErrorsFromIssues(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map((segment) => String(segment)).join(".") || "_";
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}
