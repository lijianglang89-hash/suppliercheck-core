/**
 * 审核模板数据访问层。
 *
 * 模板虽然服务于审核，但它的**生命周期与审计无关**（审核任务靠 templateSnapshot 自持），
 * 因此放在 templates 域而不是 reviews 域。跨域引用时方向永远是从 reviews 指向 templates，
 * 反过来会让「审核」与「模板」互相依赖，形成无法单独测试的环。
 */
import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { reviewTemplates, type ReviewTemplateRow } from "@/lib/db/schema";

export async function listWorkspaceTemplates(workspaceId: string): Promise<ReviewTemplateRow[]> {
  const db = getDb();
  return db
    .select()
    .from(reviewTemplates)
    .where(and(eq(reviewTemplates.workspaceId, workspaceId), isNull(reviewTemplates.deletedAt)))
    .orderBy(desc(reviewTemplates.createdAt));
}

export async function findTemplateById(templateId: string): Promise<ReviewTemplateRow | undefined> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(reviewTemplates)
    .where(and(eq(reviewTemplates.id, templateId), isNull(reviewTemplates.deletedAt)))
    .limit(1);
  return row;
}

export interface CreateTemplateRowInput {
  workspaceId: string;
  name: string;
  description: string | null;
  basedOnKey: string | null;
  config: Record<string, unknown>;
  createdBy: string;
}

export async function insertTemplate(input: CreateTemplateRowInput): Promise<ReviewTemplateRow> {
  const db = getDb();
  const [row] = await db.insert(reviewTemplates).values(input).returning();
  if (!row) throw new Error("创建审核模板失败。");
  return row;
}

export interface UpdateTemplateRowInput {
  name: string;
  description: string | null;
  config: Record<string, unknown>;
}

export async function updateTemplateRow(
  templateId: string,
  input: UpdateTemplateRowInput,
): Promise<void> {
  const db = getDb();
  await db
    .update(reviewTemplates)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(reviewTemplates.id, templateId), isNull(reviewTemplates.deletedAt)));
}

/** 软删除。被审核任务引用过的模板不该真的消失，否则历史报告会失去可解释性。 */
export async function softDeleteTemplate(templateId: string): Promise<void> {
  const db = getDb();
  await db
    .update(reviewTemplates)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(reviewTemplates.id, templateId));
}
