/**
 * 供应商数据访问层。
 *
 * 一个刻意的取舍：**同名冲突交给数据库唯一索引去判**，而不是先 SELECT 再 INSERT。
 * 先查后写在并发下必然漏（两个请求同时查到"不存在"），
 * 而 `suppliers_workspace_name_unique` 是部分唯一索引（只约束未删除的行），
 * 报错后再翻译成用户能看懂的提示，才是不会漏的做法。
 */
import "server-only";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { suppliers, type NewSupplier, type Supplier } from "@/lib/db/schema";
import type { SubjectType } from "@/lib/reviews/rules";

export async function listWorkspaceSuppliers(
  workspaceId: string,
  options: { includeArchived?: boolean } = {},
): Promise<Supplier[]> {
  const db = getDb();
  const conditions = [eq(suppliers.workspaceId, workspaceId), isNull(suppliers.deletedAt)];
  if (!options.includeArchived) conditions.push(eq(suppliers.status, "ACTIVE"));

  return db
    .select()
    .from(suppliers)
    .where(and(...conditions))
    .orderBy(asc(suppliers.name));
}

export async function findSupplierById(supplierId: string): Promise<Supplier | undefined> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), isNull(suppliers.deletedAt)))
    .limit(1);
  return row;
}

/** 列出给定 id 中确实属于该工作区的供应商 —— 授权判据只有这一份。 */
export async function findSuppliersByIds(
  workspaceId: string,
  ids: readonly string[],
): Promise<Supplier[]> {
  if (ids.length === 0) return [];
  const db = getDb();
  return db
    .select()
    .from(suppliers)
    .where(
      and(
        eq(suppliers.workspaceId, workspaceId),
        inArray(suppliers.id, [...ids]),
        isNull(suppliers.deletedAt),
      ),
    );
}

export async function insertSupplier(input: NewSupplier): Promise<Supplier> {
  const db = getDb();
  const [row] = await db.insert(suppliers).values(input).returning();
  if (!row) throw new Error("创建供应商失败。");
  return row;
}

export interface UpdateSupplierInput {
  name: string;
  subjectType: SubjectType | null;
  unifiedSocialCreditCode: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  region: string | null;
  note: string | null;
}

export async function updateSupplier(
  supplierId: string,
  input: UpdateSupplierInput,
): Promise<void> {
  const db = getDb();
  await db
    .update(suppliers)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(suppliers.id, supplierId), isNull(suppliers.deletedAt)));
}

export async function setSupplierStatus(
  supplierId: string,
  status: Supplier["status"],
): Promise<void> {
  const db = getDb();
  await db
    .update(suppliers)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(suppliers.id, supplierId), isNull(suppliers.deletedAt)));
}

/**
 * 软删除。
 * 供应商一旦被审核任务引用过就是历史事实的一部分，物理删除会让历史报告失去主体。
 */
export async function softDeleteSupplier(supplierId: string): Promise<void> {
  const db = getDb();
  await db
    .update(suppliers)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(suppliers.id, supplierId));
}

/** Postgres 唯一约束冲突（23505）。用于把数据库错误翻译成人话。 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
