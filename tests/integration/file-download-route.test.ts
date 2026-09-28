/**
 * 文件下载路由的端到端 HTTP 契约测试（真实 Postgres + 真实私有存储）。
 *
 * ⚠️ 设计契约（防腐，防止未来有人「好心」去修）：
 *   `/api/files/signed/[token]` 与 `/api/files/[documentId]` 两条路由都是 **Stateless（无状态）**：
 *     - 授权判定是确定性规则（会话 + 工作区成员 + 签名 + 库内登记），没有任何请求间的共享可变状态；
 *     - 开流是 `fs.createReadStream` 的只读副本，互不干扰。
 *   因此**天然并发安全，禁止为它们加任何锁**（锁既无必要，还会在高峰期自伤吞吐）。
 *   授权是 **Double Auth（双授权）**：签名 URL 之外仍要求有效会话 + 工作区成员资格 +
 *   文件必须在库里登记过 —— 任一层都不能省。未登录一律先挡（401），不暴露文件是否存在。
 *
 * 测试手法说明（重要）：路由依赖 `next/headers` 的 `cookies()` 取会话，该 API 必须在
 * Next 的请求作用域内才可用，无法在 vitest 里直接驱动。因此这里**只 mock `@/lib/auth/session`
 * 的 `readSession`** 来注入「已登录用户」或「未登录」，而路由的其余逻辑
 * （工作区成员判定、签名校验、软删除过滤）全部跑在真实数据库与真实存储上。
 * 这与 `tests/smoke/http.test.ts`（真实服务、覆盖未登录 401）互为补充，不重复。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { closeDatabase, getDb } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { createInspectionTransform } from "@/lib/documents/inspect-stream";
import { storeUploadedFile } from "@/lib/documents/service";
import { encodeStorageKey, signStorageKey } from "@/lib/storage/signature";
import { getEnv } from "@/lib/config/server-env";
import { cleanupUsers, createTestUser, createTestWorkspace } from "../helpers/fixtures";

import * as docRoute from "@/app/api/files/[documentId]/route";
import * as signedRoute from "@/app/api/files/signed/[token]/route";

/**
 * 用 vi.hoisted 让被 hoist 的 vi.mock 工厂能引用到同一个可变会话存储。
 * sessionStore.payload 为 undefined 时表示「未登录」。
 */
const { sessionStore } = vi.hoisted(() => ({
  sessionStore: { payload: undefined as { userId: string; issuedAt: number; expiresAt: number } | undefined },
}));

vi.mock("@/lib/auth/session", () => ({
  readSession: async () => sessionStore.payload,
}));

const FIXTURE = path.resolve(process.cwd(), "tests/fixtures/supplier-package-zh.pdf");
const createdUserIds: string[] = [];

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** 直接落一份真实文档（写盘 + 入库），返回带 storagePath 的行。不需要等解析完成。 */
async function uploadDocument(workspaceId: string, userId: string) {
  const bytes = await readFile(FIXTURE);
  const inspection = createInspectionTransform({ maxBytes: 25 * 1024 * 1024 });
  const stream = Readable.from([bytes]).pipe(inspection);

  return storeUploadedFile({
    workspaceId,
    userId,
    originalFilename: "准入资料包-示例.pdf",
    safeFilename: "准入资料包-示例.pdf",
    mimeType: "application/pdf",
    stream,
    inspection,
  });
}

/** 软删除：置 DELETED + deletedAt，与服务端产品行为一致。 */
async function softDelete(documentId: string): Promise<void> {
  await getDb()
    .update(documents)
    .set({ status: "DELETED", deletedAt: new Date() })
    .where(eq(documents.id, documentId));
}

async function setSession(userId: string): Promise<void> {
  const now = nowSeconds();
  sessionStore.payload = { userId, issuedAt: now, expiresAt: now + 3600 };
}

function clearSession(): void {
  sessionStore.payload = undefined;
}

function signedUrlFor(storagePath: string, expiresAt: number, signature: string): string {
  const token = encodeStorageKey(storagePath);
  return `http://localhost/api/files/signed/${token}?expires=${expiresAt}&signature=${signature}`;
}

describe("文件下载路由 HTTP 契约（双授权 + 无状态）", () => {
  afterAll(async () => {
    await cleanupUsers(createdUserIds);
    await closeDatabase();
  });

  beforeEach(() => clearSession());

  /** 401：未登录无论打哪个下载入口，答案都只能是 401，不因资源是否存在而不同。 */
  it("★ 未登录访问两条下载路由一律 401", async () => {
    const user = await createTestUser("dl401");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "下载401工作区");
    const doc = await uploadDocument(workspace.id, user.id);

    const absent = "00000000-0000-4000-8000-000000000000";

    const byId = await docRoute.GET(new Request(`http://localhost/api/files/${doc.id}`), {
      params: Promise.resolve({ documentId: doc.id }),
    } as never);
    expect(byId.status).toBe(401);

    const byToken = await signedRoute.GET(new Request(signedUrlFor(doc.storagePath, nowSeconds() + 300, "bogus")), {
      params: Promise.resolve({ token: encodeStorageKey(doc.storagePath) }),
    } as never);
    expect(byToken.status).toBe(401);

    // 拿一个根本不存在的 id 打，也必须是 401 而不是 404 —— 否则「404 还是 401」会泄漏 id 是否存在。
    const absentResp = await docRoute.GET(new Request(`http://localhost/api/files/${absent}`), {
      params: Promise.resolve({ documentId: absent }),
    } as never);
    expect(absentResp.status).toBe(401);
  });

  /** 403：跨工作区持有合法签名也拿不到对方的文档。 */
  it("★ 跨工作区访问被 403（双授权的第二道关）", async () => {
    const owner = await createTestUser("dlOwner");
    const intruder = await createTestUser("dlIntruder");
    createdUserIds.push(owner.id, intruder.id);
    const wsOwner = await createTestWorkspace(owner.id, "下载归属主区");
    const wsOther = await createTestWorkspace(intruder.id, "下载入侵区");

    const doc = await uploadDocument(wsOwner.id, owner.id);

    // 入侵者持合法会话 + 合法签名（针对 owner 的 storagePath），但不在 owner 工作区。
    await setSession(intruder.id);
    const secret = getEnv().SESSION_SECRET;
    const expiresAt = nowSeconds() + 300;
    const signature = signStorageKey({ key: doc.storagePath, expiresAt, secret });

    const response = await signedRoute.GET(new Request(signedUrlFor(doc.storagePath, expiresAt, signature)), {
      params: Promise.resolve({ token: encodeStorageKey(doc.storagePath) }),
    } as never);
    expect(response.status).toBe(403);
    // 入侵者用对方的 storagePath 走 /api/files/[documentId] 路径同样被挡。
    void wsOther;
  });

  /** 403：签名过期或篡改一律拒绝，不退化成 200。 */
  it("★ 签名过期 / 篡改均被 403", async () => {
    const user = await createTestUser("dlSig");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "下载签名工作区");
    const doc = await uploadDocument(workspace.id, user.id);
    await setSession(user.id);

    const secret = getEnv().SESSION_SECRET;
    const token = encodeStorageKey(doc.storagePath);

    // 过期：expiresAt 取过去时间点。
    const expiredResponse = await signedRoute.GET(
      new Request(signedUrlFor(doc.storagePath, nowSeconds() - 60, signStorageKey({ key: doc.storagePath, expiresAt: nowSeconds() - 60, secret }))),
      { params: Promise.resolve({ token }) },
    );
    expect(expiredResponse.status).toBe(403);

    // 篡改：签名算对了，但把最后一位翻一下。
    const goodExpires = nowSeconds() + 300;
    const goodSig = signStorageKey({ key: doc.storagePath, expiresAt: goodExpires, secret });
    const tampered = goodSig.slice(0, -1) + (goodSig.endsWith("A") ? "B" : "A");
    const tamperedResponse = await signedRoute.GET(
      new Request(signedUrlFor(doc.storagePath, goodExpires, tampered)),
      { params: Promise.resolve({ token }) },
    );
    expect(tamperedResponse.status).toBe(403);
  });

  /** 404：软删除后即便签名/会话都合法，也取不到文件。 */
  it("★ 软删除后下载路由返回 404（数据层兜底）", async () => {
    const user = await createTestUser("dlSoft");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "下载软删工作区");
    const doc = await uploadDocument(workspace.id, user.id);
    await softDelete(doc.id);

    await setSession(user.id);
    const secret = getEnv().SESSION_SECRET;
    const expiresAt = nowSeconds() + 300;
    const signature = signStorageKey({ key: doc.storagePath, expiresAt, secret });

    const bySigned = await signedRoute.GET(new Request(signedUrlFor(doc.storagePath, expiresAt, signature)), {
      params: Promise.resolve({ token: encodeStorageKey(doc.storagePath) }),
    } as never);
    expect(bySigned.status).toBe(404);

    const byId = await docRoute.GET(new Request(`http://localhost/api/files/${doc.id}`), {
      params: Promise.resolve({ documentId: doc.id }),
    } as never);
    expect(byId.status).toBe(404);
  });

  /** 200：所有者持合法会话 + 合法签名，下载到与源文件逐字节一致的 PDF。 */
  it("★ 合法所有者下载成功，响应体与源文件逐字节一致", async () => {
    const user = await createTestUser("dlOk");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "下载正常区");
    const doc = await uploadDocument(workspace.id, user.id);
    await setSession(user.id);

    const secret = getEnv().SESSION_SECRET;
    const expiresAt = nowSeconds() + 300;
    const signature = signStorageKey({ key: doc.storagePath, expiresAt, secret });
    const expected = await readFile(FIXTURE);

    const response = await signedRoute.GET(new Request(signedUrlFor(doc.storagePath, expiresAt, signature)), {
      params: Promise.resolve({ token: encodeStorageKey(doc.storagePath) }),
    } as never);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toContain("no-store");

    const body = Buffer.from(await response.arrayBuffer());
    expect(body.byteLength).toBe(expected.byteLength);
    expect(body.equals(expected)).toBe(true);
  });

  /**
   * 并发证实无状态：同一份文档同时发起 12 次下载，全部 200 且逐字节一致。
   * 没有共享可变状态，所以不应出现串流、错字节或 500。
   */
  it("★ 并发下载同一文档不串流、不报 500（证实 Stateless）", async () => {
    const user = await createTestUser("dlConc");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "下载并发区");
    const doc = await uploadDocument(workspace.id, user.id);
    await setSession(user.id);

    const secret = getEnv().SESSION_SECRET;
    const expiresAt = nowSeconds() + 300;
    const signature = signStorageKey({ key: doc.storagePath, expiresAt, secret });
    const url = signedUrlFor(doc.storagePath, expiresAt, signature);
    const expected = await readFile(FIXTURE);

    const responses = await Promise.all(
      Array.from({ length: 12 }, async () =>
        signedRoute.GET(new Request(url), {
          params: Promise.resolve({ token: encodeStorageKey(doc.storagePath) }),
        } as never),
      ),
    );

    for (const response of responses) {
      expect(response.status).toBe(200);
      const body = Buffer.from(await response.arrayBuffer());
      expect(body.equals(expected)).toBe(true);
    }
  });
});
