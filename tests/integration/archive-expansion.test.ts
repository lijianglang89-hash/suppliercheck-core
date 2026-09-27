/**
 * ZIP 资料包展开（真实 Postgres + 真实压缩包）。
 *
 * 核心疑点（James 提的，逐条钉死）：
 *   1. 子文档是否正确继承 workspaceId —— 这是「压缩包能不能绕过工作区隔离」的命门；
 *   2. 包内个别条目解析失败，会不会污染整包状态；
 *   3. 危险条目（路径穿越 / 加密 / 嵌套 zip / 非白名单扩展名）是否被拒绝而不是入库。
 *
 * 夹具用 yazl 现场打包（仓库里已有该依赖），内容刻意混入：
 *   一个正常 PDF（应当被接受）、一个 .exe（非白名单）、一个嵌套 zip、一个路径穿越条目。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { crc32 } from "node:zlib";

import { and, eq } from "drizzle-orm";
import yazl from "yazl";
import { afterAll, describe, expect, it } from "vitest";

import { closeDatabase, getDb } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { createInspectionTransform } from "@/lib/documents/inspect-stream";
import { enqueueMany, expandArchiveDocument, storeUploadedFile } from "@/lib/documents/service";

import { cleanupUsers, createTestUser, createTestWorkspace } from "../helpers/fixtures";

const FIXTURE_PDF = path.resolve(process.cwd(), "tests/fixtures/supplier-package-zh.pdf");
const createdUserIds: string[] = [];

async function waitUntil(
  predicate: () => Promise<boolean>,
  { timeoutMs = 20000, intervalMs = 120 } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

/** 打一个「混入脏条目」的 zip，返回字节。 */
function buildMixedZip(pdfBytes: Buffer): Promise<Buffer> {
  const zip = new yazl.ZipFile();

  // 1) 正常条目（嵌套目录下）—— 应被接受
  zip.addBuffer(pdfBytes, "资质文件/营业执照.pdf");
  // 2) 非白名单扩展名 —— 应被拒绝
  zip.addBuffer(Buffer.from("MZ fake executable"), "资质文件/病毒.exe");
  // 3) 嵌套 zip —— 应被拒绝（不给「压缩包套压缩包」留递归风险）
  zip.addBuffer(Buffer.from("PK\x03\x04 fake"), "资质文件/内层.zip");
  zip.end();

  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on("error", reject);
  });
}

async function uploadZip(workspaceId: string, userId: string, zipBytes: Buffer) {
  const inspection = createInspectionTransform({ maxBytes: 25 * 1024 * 1024 });
  const stream = Readable.from([zipBytes]).pipe(inspection);

  return storeUploadedFile({
    workspaceId,
    userId,
    originalFilename: "供应商资料包.zip",
    safeFilename: "供应商资料包.zip",
    mimeType: "application/zip",
    stream,
    inspection,
  });
}

/**
 * 手工拼一个「存储方式（method 0）」的极简 zip，允许**任意条目名**。
 *
 * 为什么需要它：yazl 会校验条目名，`../` 和反斜杠变体都会被它自己拒掉
 * （invalid relative path）—— 用 yazl 根本造不出恶意包。
 * 但真实攻击者上传的可不是 yazl 打出来的包，而是这种手工构造的字节流。
 * 所以路径穿越这条防护必须用一个能写出任意名字的打包器来验证，
 * 否则「我们防住了」只是因为我们造不出攻击样本。
 */
function buildRawZip(entryName: string, data: Buffer): Buffer {
  const nameBuf = Buffer.from(entryName, "utf8");
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); // 签名
  local.writeUInt16LE(20, 4); // 解压所需版本
  local.writeUInt16LE(0, 6); // 通用位标记
  local.writeUInt16LE(0, 8); // 压缩方式：0 = 存储
  local.writeUInt16LE(0, 10); // 时间
  local.writeUInt16LE(0x21, 12); // 日期（1980-01-01）
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18); // 压缩后大小
  local.writeUInt32LE(data.length, 22); // 原始大小
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28); // 额外字段长度

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); // 中央目录签名
  central.writeUInt16LE(20, 4); // 创建版本
  central.writeUInt16LE(20, 6); // 解压所需版本
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0x21, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30); // 额外字段
  central.writeUInt16LE(0, 32); // 注释
  central.writeUInt16LE(0, 34); // 磁盘号
  central.writeUInt16LE(0, 36); // 内部属性
  central.writeUInt32LE(0, 38); // 外部属性
  central.writeUInt32LE(0, 42); // 本地头偏移

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // 结束记录签名
  end.writeUInt16LE(0, 4); // 磁盘号
  end.writeUInt16LE(0, 6); // 中央目录起始磁盘
  end.writeUInt16LE(1, 8); // 本磁盘条目数
  end.writeUInt16LE(1, 10); // 总条目数
  end.writeUInt32LE(central.length, 12); // 中央目录大小
  end.writeUInt32LE(local.length + nameBuf.length + data.length, 16); // 中央目录偏移
  end.writeUInt16LE(0, 20); // 注释长度

  return Buffer.concat([local, nameBuf, data, central, nameBuf, end]);
}

describe("ZIP 资料包展开", () => {
  afterAll(async () => {
    await cleanupUsers(createdUserIds);
    await closeDatabase();
  });

  it("★ 子文档继承 workspaceId 与 parentDocumentId，脏条目不入库", async () => {
    const user = await createTestUser("zip");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "压缩包工作区");

    const pdfBytes = await readFile(FIXTURE_PDF);
    const zipBytes = await buildMixedZip(pdfBytes);

    const parent = await uploadZip(workspace.id, user.id, zipBytes);
    expect(parent.mimeType).toBe("application/zip");

    const children = await expandArchiveDocument(parent);

    // 四个条目里只应接受一个：目录下的 PDF
    expect(children).toHaveLength(1);

    const [child] = children;
    expect(child?.workspaceId).toBe(workspace.id);
    expect(child?.parentDocumentId).toBe(parent.id);
    expect(child?.mimeType).toBe("application/pdf");
    expect(child?.safeFilename).toBe("营业执照.pdf");
    // 原始名保留目录线索，方便人回溯它来自包里的哪一层
    expect(child?.originalFilename).toContain("营业执照.pdf");
    expect(child?.status).toBe("UPLOADED");

    // 存储键绝不能带穿越片段，也不能带用户可控的原始文件名
    expect(child?.storagePath).not.toContain("..");
    expect(child?.storagePath).not.toContain("病毒");

    // 脏条目必须一条都没进库
    const db = getDb();
    const all = await db
      .select()
      .from(documents)
      .where(eq(documents.workspaceId, workspace.id));
    const names = all.map((row) => row.safeFilename);
    expect(names).not.toContain("病毒.exe");
    expect(names).not.toContain("内层.zip");
  });

  it("子文档可以被独立解析，且解析产物挂在同一个工作区", async () => {
    const user = await createTestUser("zipparse");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "压缩包解析工作区");

    const pdfBytes = await readFile(FIXTURE_PDF);
    const zipBytes = await buildMixedZip(pdfBytes);
    const parent = await uploadZip(workspace.id, user.id, zipBytes);
    const children = await expandArchiveDocument(parent);

    await enqueueMany(children.map((child) => child.id));

    const done = await waitUntil(async () => {
      const rows = await getDb()
        .select({ id: documents.id, status: documents.status })
        .from(documents)
        .where(eq(documents.workspaceId, workspace.id));
      const childRows = rows.filter((row) => row.id !== parent.id);
      return childRows.length > 0 && childRows.every((row) => row.status === "READY");
    });
    expect(done).toBe(true);
  });

  it("★ 另一个工作区查不到展开出的子文档", async () => {
    const userA = await createTestUser("zipA");
    const userB = await createTestUser("zipB");
    createdUserIds.push(userA.id, userB.id);
    const wsA = await createTestWorkspace(userA.id, "Z-A");
    const wsB = await createTestWorkspace(userB.id, "Z-B");

    const pdfBytes = await readFile(FIXTURE_PDF);
    const zipBytes = await buildMixedZip(pdfBytes);
    const parent = await uploadZip(wsA.id, userA.id, zipBytes);
    const children = await expandArchiveDocument(parent);
    expect(children.length).toBeGreaterThan(0);

    const childId = children[0]!.id;
    const leak = await getDb()
      .select()
      .from(documents)
      .where(and(eq(documents.workspaceId, wsB.id), eq(documents.id, childId)));
    expect(leak).toHaveLength(0);
  });

  /**
   * 实测行为（不是设计意图，是跑出来的事实）：
   * yauzl **读取端**就会拒绝 `../` 条目并抛错，错误冒泡到 `expandArchiveDocument`，
   * 由上传路由的 catch 转成错误响应 —— 不会崩，也确实一条子文档都没展开。
   *
   * ⚠️ 但这里暴露一个真实的状态残留，值得单独记一笔（尚未修，先钉住现状）：
   *   `storeUploadedFile` 在展开**之前**已把父文档落库，而 `enqueueMany` 在展开**之后**
   *   才执行。展开抛错 → 父文档留在库里、状态停在 `UPLOADED` / `PENDING`，
   *   且永远不会被解析入队 —— 界面上会留下一个不会自己消失的「待处理」死条目。
   *   要不要在展开失败时把它标成 FAILED 是产品决策，本测试先把现状固定住。
   */
  it("★ 手工构造的路径穿越条目被拒：不崩、不落子文档，但父文档会残留", async () => {
    const user = await createTestUser("ziptrav");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "穿越测试工作区");

    const pdfBytes = await readFile(FIXTURE_PDF);
    const malicious = buildRawZip("../../../../etc/passwd.pdf", pdfBytes);

    const parent = await uploadZip(workspace.id, user.id, malicious);

    await expect(expandArchiveDocument(parent)).rejects.toThrow();

    const rows = await getDb()
      .select()
      .from(documents)
      .where(eq(documents.workspaceId, workspace.id));

    // 一条子文档都没有 —— 穿越条目绝没被展开
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(parent.id);
    // 现状：父文档停在 UPLOADED，不会被自动解析（见上方说明）
    expect(rows[0]?.status).toBe("UPLOADED");
  });
});
