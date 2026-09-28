"use server";

/**
 * 审核任务相关 Server Action。
 *
 * 三个动作的入参全部来自浏览器，**每一个 id 都要回库确认归属**：
 * - `templateKey`：可能是别人工作区的自定义模板 id；
 * - `supplierId`：可能是别人工作区的供应商；
 * - `documentIds[]`：可能是别人工作区的资料（这是最危险的一项 ——
 *   不校验的话，任何人都能拿别人的资料生成一份报告，把正文摘录读走）。
 * 校验集中在 createReviewRunAndEnqueue 内部完成，这里不重复实现一遍。
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireActionWorkspace, runIdempotentDelete } from "@/lib/auth/action-context";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/forms/form-state";
import { toAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { newRequestId } from "@/lib/ids";
import { MAX_RUN_NAME_CHARS } from "@/lib/reviews/limits";
import { enforceRateLimit } from "@/lib/rate-limit/policy";
import { findReviewRunById, softDeleteReviewRun } from "@/lib/reviews/repository";
import { createReviewRunAndEnqueue, enqueueReviewRun } from "@/lib/reviews/service";

const createSchema = z.object({
  templateKey: z.string().trim().min(1, "请选择审核模板").max(64),
  name: z.string().trim().max(MAX_RUN_NAME_CHARS, `名称最多 ${MAX_RUN_NAME_CHARS} 个字符`),
  supplierId: z.string().trim().max(64),
  documentIds: z.array(z.string().trim().min(1).max(64)).min(1, "请至少勾选一份资料"),
});

/**
 * 创建一次审核并跳转到结果页。
 *
 * ⚠️ `redirect()` 必须在 try 之外调用：它靠抛出一个特殊错误来工作，
 * 放在 catch 里会被当成普通异常吞掉，届时用户会看到"表单没反应"。
 */
export async function createReviewAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createSchema.safeParse({
    templateKey: String(formData.get("templateKey") ?? ""),
    name: String(formData.get("name") ?? ""),
    supplierId: String(formData.get("supplierId") ?? ""),
    documentIds: formData.getAll("documentIds").map(String),
  });

  if (!parsed.success) {
    return {
      status: "error",
      error: parsed.error.issues[0]?.message ?? "请检查表单内容。",
    };
  }

  let runId: string;
  try {
    const { workspace, user } = await requireActionWorkspace("MEMBER");
    // 审核是最重的一档资源消耗（引擎 + 串行队列 + 全量结论落库）。
    // 授权之后、落库之前；超限时 RATE_LIMITED 的用户文案会出现在表单错误里。
    enforceRateLimit("review", `${user.id}:${workspace.id}`);
    // 本次请求的唯一 trace id：穿透到后台审核任务的日志上下文，
    // 让「发起审核」这一动作能从日志反查到具体的异步执行。
    const requestId = newRequestId();
    const run = await createReviewRunAndEnqueue(
      {
        workspaceId: workspace.id,
        userId: user.id,
        templateKey: parsed.data.templateKey,
        supplierId: parsed.data.supplierId.length > 0 ? parsed.data.supplierId : null,
        documentIds: parsed.data.documentIds,
        name: parsed.data.name.length > 0 ? parsed.data.name : null,
      },
      { requestId },
    );
    runId = run.id;
    logger.info("已创建审核任务", { reviewRunId: runId, workspaceId: workspace.id, requestId });
  } catch (error) {
    const appError = toAppError(error);
    logger.warn("创建审核任务失败", { code: appError.code });
    return { status: "error", error: appError.toUserMessage() };
  }

  revalidatePath("/reviews");
  revalidatePath("/reports");
  revalidatePath("/dashboard");
  redirect(`/reviews/${runId}`);
}

/** 重新运行一次审核（资料补齐后再跑一次，或失败后重试）。 */
export async function rerunReviewAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const runId = String(formData.get("runId") ?? "");

  let message: string;
  try {
    const { workspace, user } = await requireActionWorkspace("MEMBER");
    // rerun 与新建共用同一档限额：两者消耗的资源本质相同（串行队列里的引擎任务）。
    enforceRateLimit("review", `${user.id}:${workspace.id}`);
    const run = await findReviewRunById(runId);
    if (!run || run.workspaceId !== workspace.id) {
      return { status: "error", error: "没有找到对应的审核任务。" };
    }

    // 本次请求的 trace id：穿透到后台审核任务日志（同新建路径）。
    const requestId = newRequestId();
    const result = await enqueueReviewRun(runId, { requestId });
    logger.info("已提交重新审核", { reviewRunId: runId, workspaceId: workspace.id, requestId });
    message =
      result.queued === false && result.reason === "already_running"
        ? "该审核任务正在执行中，无需重复提交。"
        : "已提交，正在重新审核。";
  } catch (error) {
    const appError = toAppError(error);
    logger.warn("重新运行审核失败", { code: appError.code, runId });
    return { status: "error", error: appError.toUserMessage() };
  }

  revalidatePath(`/reviews/${runId}`);
  revalidatePath("/reviews");
  revalidatePath("/reports");
  return { ...EMPTY_FORM_STATE, status: "success", success: message };
}

/** 删除审核任务（软删除）。 */
export async function deleteReviewAction(formData: FormData): Promise<void> {
  const runId = String(formData.get("runId") ?? "");
  const { workspace } = await requireActionWorkspace("MEMBER");

  const run = await findReviewRunById(runId);
  if (!run || run.workspaceId !== workspace.id) {
    throw toAppError(new Error("没有找到对应的审核任务。"));
  }

  await runIdempotentDelete(() => softDeleteReviewRun(runId), {
    runId,
    operation: "delete",
  });

  revalidatePath("/reviews");
  revalidatePath("/reports");
  revalidatePath("/dashboard");
}
