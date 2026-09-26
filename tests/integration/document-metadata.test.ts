import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { closeDatabase, getDb } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { buildStorageKey, sha256Hex, validateUpload } from "@/lib/files";

import { cleanupUsers, createTestUser, createTestWorkspace } from "../helpers/fixtures";

const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const createdUserIds: string[] = [];

describe("文档元数据落库", () => {
  afterAll(async () => {
    await cleanupUsers(createdUserIds);
    await closeDatabase();
  });

  it("校验通过的上传可以落库，并读回一致的元数据", async () => {
    const user = await createTestUser("doc");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "资料测试工作区");

    const metadata = validateUpload({
      filename: "../../营业执照（副本）.pdf",
      mimeType: "application/pdf",
      size: 2048,
      header: PDF_HEADER,
      maxBytes: 25 * 1024 * 1024,
    });

    const documentId = crypto.randomUUID();
    const storagePath = buildStorageKey({
      workspaceId: workspace.id,
      documentId,
      mimeType: metadata.mimeType,
    });

    const db = getDb();
    await db.insert(documents).values({
      id: documentId,
      workspaceId: workspace.id,
      originalFilename: metadata.originalFilename,
      safeFilename: metadata.safeFilename,
      mimeType: metadata.mimeType,
      extension: metadata.extension,
      size: metadata.size,
      checksum: sha256Hex(PDF_HEADER),
      storagePath,
      status: "UPLOADED",
      processingStatus: "PENDING",
      createdBy: user.id,
    });

    const [saved] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);

    expect(saved).toBeDefined();
    expect(saved?.safeFilename).toBe("营业执照（副本）.pdf");
    expect(saved?.originalFilename).toBe("../../营业执照（副本）.pdf");
    expect(saved?.extension).toBe(".pdf");
    expect(saved?.status).toBe("UPLOADED");
    expect(saved?.processingStatus).toBe("PENDING");
    expect(saved?.storagePath).toBe(storagePath);
    // 存储路径绝不能包含用户原始文件名，也不包含路径穿越片段
    expect(saved?.storagePath).not.toContain("..");
    expect(saved?.storagePath).not.toContain("营业执照");
  });

  it("★ 按 workspace 隔离查询：另一个工作区查不到这份文档", async () => {
    const userA = await createTestUser("ownerA");
    const userB = await createTestUser("ownerB");
    createdUserIds.push(userA.id, userB.id);

    const workspaceA = await createTestWorkspace(userA.id, "A 工作区");
    const workspaceB = await createTestWorkspace(userB.id, "B 工作区");

    const documentId = crypto.randomUUID();
    const db = getDb();

    await db.insert(documents).values({
      id: documentId,
      workspaceId: workspaceA.id,
      originalFilename: "a.pdf",
      safeFilename: "a.pdf",
      mimeType: "application/pdf",
      extension: ".pdf",
      size: 1024,
      checksum: sha256Hex(PDF_HEADER),
      storagePath: buildStorageKey({
        workspaceId: workspaceA.id,
        documentId,
        mimeType: "application/pdf",
      }),
      createdBy: userA.id,
    });

    // 用 B 的 workspaceId 查 —— 必须查不到
    const rowsForB = await db
      .select()
      .from(documents)
      .where(and(eq(documents.workspaceId, workspaceB.id), eq(documents.id, documentId)));

    expect(rowsForB).toHaveLength(0);

    // 用 A 的 workspaceId 查 —— 可以查到
    const rowsForA = await db
      .select()
      .from(documents)
      .where(and(eq(documents.workspaceId, workspaceA.id), eq(documents.id, documentId)));

    expect(rowsForA).toHaveLength(1);
  });

  it("删除文档时走软删除标记（deleted_at），硬数据保留", async () => {
    const user = await createTestUser("softdel");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id);

    const documentId = crypto.randomUUID();
    const db = getDb();

    await db.insert(documents).values({
      id: documentId,
      workspaceId: workspace.id,
      originalFilename: "b.pdf",
      safeFilename: "b.pdf",
      mimeType: "application/pdf",
      extension: ".pdf",
      size: 512,
      checksum: sha256Hex(PDF_HEADER),
      storagePath: buildStorageKey({
        workspaceId: workspace.id,
        documentId,
        mimeType: "application/pdf",
      }),
      createdBy: user.id,
    });

    await db
      .update(documents)
      .set({ status: "DELETED", deletedAt: new Date() })
      .where(eq(documents.id, documentId));

    const [saved] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    expect(saved?.status).toBe("DELETED");
    expect(saved?.deletedAt).toBeInstanceOf(Date);
  });
});
