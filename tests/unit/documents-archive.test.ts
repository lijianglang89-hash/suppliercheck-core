/**
 * 压缩包安全闸门测试。
 *
 * 这部分是全引擎风险最高的一处：zip 是**唯一**能让「上传 4 KB 却要求解压 10 GB」
 * 的格式。因此测试重点不在「能不能解压」，而在「拦不拦得住」。
 */

import { rm } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { extractZipEntries, planZipExtraction } from "@/lib/documents/archive";
import { ZIP_MAX_ENTRIES } from "@/lib/documents/limits";
import { entryBasename } from "@/lib/documents/zip";
import { ERROR_CODES, type AppError } from "@/lib/errors";
import { ALLOWED_MIME_TYPE_LIST, sanitizeFilename } from "@/lib/files";
import { findParserForMimeType, listParserIds, selectParser } from "@/lib/documents/parsers/registry";

import {
  buildMinimalPdf,
  buildRawZip,
  buildZip,
  makeTempDir,
  writeFixture,
} from "../helpers/document-fixtures";

let dir: string;

beforeAll(async () => {
  dir = await makeTempDir("sc-archive-");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("planZipExtraction 的安全闸门", () => {
  it("接受白名单内的条目，并按 basename 清洗文件名", async () => {
    const zipPath = await writeFixture(
      dir,
      "ok.zip",
      await buildZip([
        ["docs/report.pdf", buildMinimalPdf("hello")],
        ["data/sheet.xlsx", Buffer.from("PK\u0003\u0004placeholder", "latin1")],
      ]),
    );

    const plan = await planZipExtraction(zipPath);

    expect(plan.accepted.map((entry) => entry.safeFilename).sort()).toEqual([
      "report.pdf",
      "sheet.xlsx",
    ]);
    // 目录层级信息保留在 entryName 里，但不参与文件名
    expect(plan.accepted[0]?.entryName).toContain("/");
    expect(plan.rejected).toEqual([]);
  });

  it("拒绝不在白名单内的类型", async () => {
    const zipPath = await writeFixture(
      dir,
      "mixed.zip",
      await buildZip([
        ["ok.pdf", buildMinimalPdf("x")],
        ["payload.exe", Buffer.from("MZ", "latin1")],
        ["script.sh", Buffer.from("#!/bin/sh", "utf8")],
      ]),
    );

    const plan = await planZipExtraction(zipPath);

    expect(plan.accepted).toHaveLength(1);
    expect(plan.rejected).toHaveLength(2);
    expect(plan.rejected.every((item) => item.reason.includes("类型"))).toBe(true);
  });

  it("拒绝嵌套压缩包（压缩炸弹最常见的放大器）", async () => {
    const inner = await buildZip([["a.pdf", buildMinimalPdf("inner")]]);
    const zipPath = await writeFixture(dir, "nested.zip", await buildZip([["inner.zip", inner]]));

    const plan = await planZipExtraction(zipPath);

    expect(plan.accepted).toHaveLength(0);
    expect(plan.rejected[0]?.reason).toContain("嵌套");
  });

  it("拒绝压缩比异常的高压缩条目（压缩炸弹）", async () => {
    // 8 MB 全零字节 deflate 后只有几 KB —— 声明的解压大小合法，但压缩比远超阈值。
    const zipPath = await writeFixture(
      dir,
      "bomb.zip",
      await buildZip([["bomb.pdf", Buffer.alloc(8 * 1024 * 1024, 0)]]),
    );

    const plan = await planZipExtraction(zipPath);

    expect(plan.accepted).toHaveLength(0);
    expect(plan.rejected[0]?.reason).toContain("压缩比");
  });

  it("路径穿越条目：整包在打开容器阶段就被拒绝，且不向使用者泄漏内部实现细节", async () => {
    // yazl 会主动拒绝 `..` 路径，所以这里必须手写 zip 字节才能造出攻击样本。
    const zipPath = await writeFixture(
      dir,
      "traversal.zip",
      buildRawZip([
        { name: "../../etc/passwd.pdf", content: buildMinimalPdf("x") },
        { name: "..\\..\\windows\\system32\\evil.pdf", content: buildMinimalPdf("y") },
        { name: "/etc/shadow.pdf", content: buildMinimalPdf("z") },
      ]),
    );

    const error = await planZipExtraction(zipPath).then(
      () => null,
      (caught: unknown) => caught as AppError,
    );

    /**
     * 实测结论（yauzl v3）：这三种名字都在**中央目录解析层**被拒 ——
     * 整包在解压任何一个字节之前就被挡下。也就是说 archive.ts 里那条
     * 「条目名包含非法路径片段」的分支在当前依赖版本下**不可达**，
     * 它只是纵深防御，不是唯一防线。（诚实记录，避免误以为它被测试覆盖。）
     */
    expect(error?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(error?.message).toBe("压缩包结构不合法或已损坏，无法读取。");
    // 面向使用者的消息里不能出现内部库名或英文原始报错。
    expect(error?.message).not.toMatch(/yauzl|invalid|absolute|mismatch/i);
  });

  it("第二道防线：即便条目名漏过容器校验，清洗后也不会落到目录之外", async () => {
    // 第一道防线（yauzl）已实测拦死这类名字，但清洗函数是最后一道，
    // 必须单独证明它自己就是安全的 —— 不能靠「上游会拦」来免除举证。
    for (const malicious of [
      "../../etc/passwd.pdf",
      "..\\..\\windows\\system32\\evil.pdf",
      "/etc/shadow.pdf",
      "a/b/../../../c.pdf",
      "....//....//x.pdf",
    ]) {
      const safe = sanitizeFilename(entryBasename(malicious));
      expect(safe).not.toContain("..");
      expect(safe).not.toContain("/");
      expect(safe).not.toContain("\\");
      expect(path.isAbsolute(safe)).toBe(false);
      expect(safe.length).toBeGreaterThan(0);
    }
  });

  it("拒绝条目数远超上限的整包", async () => {
    const entries: Array<readonly [string, Buffer]> = [];
    for (let index = 0; index < ZIP_MAX_ENTRIES * 4 + 5; index += 1) {
      entries.push([`f${index}.pdf`, Buffer.from("%PDF-1.4", "latin1")]);
    }

    const zipPath = await writeFixture(dir, "many.zip", await buildZip(entries));

    await expect(planZipExtraction(zipPath)).rejects.toThrow(/条目过多/);
  });

  it("拒绝被标记为加密的条目（无法校验内容完整性）", async () => {
    const payload = buildMinimalPdf("secret");
    /**
     * 样本必须**先满足 yauzl 的 size 等式**才能测到想测的东西：
     * store 模式下 yauzl 要求 compressedSize === uncompressedSize +（加密 ? 12 : 0）。
     * 所以这里让 content = 12 字节伪造加密头 + 真实数据、并声明解压后为真实数据长度。
     * 早先的样本没做这件事，结果先被 size 校验拦下 —— 测到的是另一条闸门。
     */
    const zipPath = await writeFixture(
      dir,
      "encrypted.zip",
      buildRawZip([
        {
          name: "secret.pdf",
          content: Buffer.concat([Buffer.alloc(12, 0x5a), payload]),
          declaredUncompressedSize: payload.byteLength,
          markEncrypted: true,
        },
      ]),
    );

    const plan = await planZipExtraction(zipPath);

    expect(plan.accepted).toHaveLength(0);
    expect(plan.rejected).toHaveLength(1);
    expect(plan.rejected[0]?.entryName).toBe("secret.pdf");
    expect(plan.rejected[0]?.reason).toContain("加密");
  });

  it("目录条目被跳过，空文件被记为拒绝", async () => {
    const zipPath = await writeFixture(
      dir,
      "dirs.zip",
      buildRawZip([
        { name: "docs/", content: Buffer.alloc(0) },
        { name: "empty.pdf", content: Buffer.alloc(0) },
      ]),
    );

    const plan = await planZipExtraction(zipPath);

    expect(plan.accepted).toHaveLength(0);
    expect(plan.rejected.map((item) => item.entryName)).toEqual(["empty.pdf"]);
  });

  it("中央目录声明的大小与实际不符时，整包在打开阶段就被拒绝（元数据不能撒谎）", async () => {
    const content = buildMinimalPdf("declared size is a lie");

    // (a) 声明偏大 —— 故意夸大，想让限额判断误以为超限或反之；
    // (b) 声明偏小 —— 压缩炸弹的经典手法：声称很小，实际很大。
    const bigger = await writeFixture(
      dir,
      "lie-bigger.zip",
      buildRawZip([
        { name: "lie.pdf", content, declaredUncompressedSize: content.byteLength + 4096 },
      ]),
    );
    const smaller = await writeFixture(
      dir,
      "lie-smaller.zip",
      buildRawZip([{ name: "lie.pdf", content, declaredUncompressedSize: 128 }]),
    );

    for (const zipPath of [bigger, smaller]) {
      await expect(planZipExtraction(zipPath)).rejects.toMatchObject({
        code: ERROR_CODES.VALIDATION_FAILED,
      });
    }
  });
});

describe("extractZipEntries", () => {
  it("按计划逐条解压，字节与原始内容一致", async () => {
    const pdfContent = buildMinimalPdf("archived payload");
    const zipPath = await writeFixture(
      dir,
      "extract.zip",
      await buildZip([
        ["a.pdf", pdfContent],
        ["b.pdf", Buffer.from("%PDF-1.4 second", "latin1")],
      ]),
    );

    const plan = await planZipExtraction(zipPath);
    const collected = new Map<string, Buffer>();

    await extractZipEntries(zipPath, plan.accepted, async (entryPlan, stream) => {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      collected.set(entryPlan.safeFilename, Buffer.concat(chunks));
    });

    expect(collected.size).toBe(2);
    expect(collected.get("a.pdf")?.equals(pdfContent)).toBe(true);
  });

  it("回调抛错时立即中止、后续条目不再处理、错误原样上抛（不吞错）", async () => {
    const zipPath = await writeFixture(
      dir,
      "abort.zip",
      await buildZip([
        ["a.pdf", buildMinimalPdf("a")],
        ["b.pdf", buildMinimalPdf("b")],
      ]),
    );

    const plan = await planZipExtraction(zipPath);
    const processed: string[] = [];

    await expect(
      extractZipEntries(zipPath, plan.accepted, async (entryPlan) => {
        processed.push(entryPlan.safeFilename);
        throw new Error("落盘失败");
      }),
    ).rejects.toThrow("落盘失败");

    // 业务层依赖这个语义来回滚已落盘的条目：失败即停，不继续做无用功。
    expect(processed).toEqual(["a.pdf"]);
  });

  it("计划里出现不存在的条目时抛错（索引与内容不一致）", async () => {
    const zipPath = await writeFixture(
      dir,
      "mismatch.zip",
      await buildZip([["real.pdf", buildMinimalPdf("x")]]),
    );

    await expect(
      extractZipEntries(
        zipPath,
        [
          {
            entryName: "ghost.pdf",
            safeFilename: "ghost.pdf",
            mimeType: "application/pdf",
            uncompressedSize: 1,
            compressedSize: 1,
          },
        ],
        async () => undefined,
      ),
    ).rejects.toThrow(/索引不一致/);
  });
});

describe("解析器注册表覆盖全部白名单类型", () => {
  it("每一种允许上传的 MIME 都有对应解析器", () => {
    const missing = ALLOWED_MIME_TYPE_LIST.filter((mimeType) => !findParserForMimeType(mimeType));
    expect(missing).toEqual([]);
  });

  it("未知类型走兜底解析器并如实说明", () => {
    const parser = selectParser("application/x-unknown");
    expect(parser.id).toBe("unsupported");
  });

  it("解析器 id 不重复", () => {
    const ids = listParserIds();
    expect(new Set(ids).size).toBe(ids.length);
  });
});
