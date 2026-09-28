"use server";

/**
 * 资料相关 Server Action（删除 / 恢复）。
 *
 * 安全纪律与 suppliers.ts 相同：Server Action 等价于公开 POST 端点，
 * 每个 id 都必须回库确认属于当前工作区（授权判定在 service 层完成）。
 *
 * 删除与恢复的语义分野（与 suppliers.ts 的归档/恢复同一条纪律）：
 * - **删除**走 `runIdempotentDelete`：目标被并发删掉时静默成功 ——
 *   用户在另一个标签页刚删过，这边再点一次删除，正确行为就是什么都不做；
 * - **恢复**是更新类动作，必须要么成功要么报错 —— 静默跳过会让用户以为系统坏了。
 */
import { revalidatePath } from "next/cache";

import { requireActionWorkspace, runIdempotentDelete } from "@/lib/auth/action-context";
import { restoreDocument, softDeleteDocument } from "@/lib/documents/service";
import { logger } from "@/lib/logger";

/** 软删除资料（保留 30 天恢复窗口，不触碰物理文件）。 */
export async function deleteDocumentAction(formData: FormData): Promise<void> {
  const documentId = String(formData.get("documentId") ?? "");
  const { workspace } = await requireActionWorkspace("MEMBER");

  await runIdempotentDelete(
    () => softDeleteDocument({ workspaceId: workspace.id, documentId }),
    { documentId, operation: "delete-document" },
  );

  revalidatePath("/documents");
  revalidatePath("/dashboard");
  logger.info("已软删除资料", { workspaceId: workspace.id, documentId });
}

/** 从回收站恢复资料（连同同一资料包内被连带软删的子文档一起）。 */
export async function restoreDocumentAction(formData: FormData): Promise<void> {
  const documentId = String(formData.get("documentId") ?? "");
  const { workspace } = await requireActionWorkspace("MEMBER");

  await restoreDocument({ workspaceId: workspace.id, documentId });

  revalidatePath("/documents");
  logger.info("已恢复资料", { workspaceId: workspace.id, documentId });
}
