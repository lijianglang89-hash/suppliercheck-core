import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LocalStorageProvider } from "@/lib/storage/providers/local";
import { verifySignedKey } from "@/lib/storage/signature";

const SECRET = "storage-test-secret-value-32-chars!!";
const WORKSPACE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const DOCUMENT_ID = "11111111-2222-4333-8444-555555555555";
const KEY = `workspaces/${WORKSPACE_ID}/documents/${DOCUMENT_ID}.pdf`;

let rootDir: string;
let storage: LocalStorageProvider;

beforeAll(async () => {
  rootDir = await mkdtemp(path.join(tmpdir(), "suppliercheck-storage-"));
  storage = new LocalStorageProvider({
    rootDir,
    secret: SECRET,
    appUrl: "http://localhost:3010",
  });
});

afterAll(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe("本地私有存储", () => {
  it("上传后可以读到，且摘要一致", async () => {
    const data = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x01, 0x02, 0x03]);

    const stored = await storage.upload({ key: KEY, data, contentType: "application/pdf" });
    expect(stored.size).toBe(data.byteLength);
    expect(stored.checksum).toMatch(/^[0-9a-f]{64}$/);

    await expect(storage.exists(KEY)).resolves.toBe(true);

    const readBack = await storage.download(KEY);
    expect(Array.from(readBack)).toEqual(Array.from(data));
  });

  it("文件确实落在私有根目录内，不在 public 下", async () => {
    const absolute = path.join(rootDir, KEY);
    const info = await stat(absolute);
    expect(info.isFile()).toBe(true);
    expect(absolute).not.toContain(`${path.sep}public${path.sep}`);
  });

  it("重复上传同一个 key 被拒绝（不静默覆盖）", async () => {
    await expect(storage.upload({ key: KEY, data: new Uint8Array([1, 2, 3]) })).rejects.toThrow(
      /已存在/,
    );
  });

  it("删除后 exists 返回 false，且再次删除不报错", async () => {
    await storage.delete(KEY);
    await expect(storage.exists(KEY)).resolves.toBe(false);
    await expect(storage.delete(KEY)).resolves.not.toThrow();
  });

  it("读取不存在的 key 抛出 NOT_FOUND 语义的错误", async () => {
    await expect(storage.download(KEY)).rejects.toThrow(/不存在/);
  });

  it("★ 路径穿越被拒绝", async () => {
    const attacks = [
      "../../../etc/passwd",
      "workspaces/../../etc/passwd",
      "/etc/passwd",
      "workspaces/3f2504e0-4f89-41d3-9a0c-0305e82c3301/../../../etc/passwd",
      "workspaces\\3f2504e0-4f89-41d3-9a0c-0305e82c3301\\a.pdf",
      "other/3f2504e0-4f89-41d3-9a0c-0305e82c3301/a.pdf",
    ];

    for (const attack of attacks) {
      await expect(storage.upload({ key: attack, data: new Uint8Array([1]) })).rejects.toThrow();
      await expect(storage.download(attack)).rejects.toThrow();
      await expect(storage.exists(attack)).rejects.toThrow();
    }
  });

  it("getSignedUrl 产出可校验的签名，且不暴露存储路径", async () => {
    const data = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    await storage.upload({ key: KEY, data });

    const url = new URL(await storage.getSignedUrl(KEY, { expiresInSeconds: 120 }));

    // 必须是签名下载路由，而不是按文档 id 授权的那个路由 —— 两者语义不同。
    expect(url.pathname.startsWith("/api/files/signed/")).toBe(true);
    expect(url.pathname).not.toContain("public");
    // 原始存储路径（含 workspaces/ 目录层级）不得以明文出现在 URL 里。
    expect(url.pathname).not.toContain("workspaces");
    expect(decodeURIComponent(url.pathname)).not.toContain("/documents/");

    const expiresAt = Number(url.searchParams.get("expires"));
    const signature = url.searchParams.get("signature") ?? "";
    expect(Number.isFinite(expiresAt)).toBe(true);

    // URL 里的是 base64url 编码后的 key，解码后应与原 key 一致
    const { decodeStorageKey } = await import("@/lib/storage/signature");
    const token = url.pathname.slice("/api/files/signed/".length);
    expect(decodeStorageKey(token)).toBe(KEY);

    expect(verifySignedKey({ key: KEY, expiresAt, signature, secret: SECRET })).toEqual({
      valid: true,
    });
  });

  it("非法有效期被拒绝", async () => {
    await expect(storage.getSignedUrl(KEY, { expiresInSeconds: 0 })).rejects.toThrow();
    await expect(storage.getSignedUrl(KEY, { expiresInSeconds: -1 })).rejects.toThrow();
  });
});
