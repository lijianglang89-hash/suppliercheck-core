/**
 * 解析器行为测试 —— 用代码生成的真实文件跑通全链路。
 *
 * 这里**不允许**用 mock 解析器：被测对象就是「能不能从真实字节里读出文字」，
 * 打桩之后测的就不是这件事了。夹具由 tests/helpers/document-fixtures.ts 现场生成，
 * 因此断言里出现的每一段文字都能在夹具代码里找到出处。
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { archiveParser } from "@/lib/documents/parsers/archive";
import { docxParser } from "@/lib/documents/parsers/docx";
import { imageParser } from "@/lib/documents/parsers/image";
import { pdfParser } from "@/lib/documents/parsers/pdf";
import type { ParseSource } from "@/lib/documents/parsers/types";
import { xlsxParser } from "@/lib/documents/parsers/xlsx";

import {
  SAMPLE_DOCX_BODY,
  SAMPLE_XLSX_SHEET,
  SAMPLE_XLSX_SHARED_STRINGS,
  buildMinimalDocx,
  buildMinimalPdf,
  buildMinimalXlsx,
  buildZip,
  makeTempDir,
  writeFixture,
} from "../helpers/document-fixtures";

/** 按本地磁盘后端的语义构造解析输入。 */
async function localSource(filePath: string, mimeType: string): Promise<ParseSource> {
  const buffer = await readFile(filePath);
  return {
    mimeType,
    size: buffer.byteLength,
    originalFilename: path.basename(filePath),
    localPath: filePath,
    openStream: async () => {
      const { createReadStream } = await import("node:fs");
      return createReadStream(filePath);
    },
    readAll: async () => new Uint8Array(await readFile(filePath)),
  };
}

let dir: string;

beforeAll(async () => {
  dir = await makeTempDir("sc-parsers-");
});

describe("pdfParser", () => {
  it("从含文本层的 PDF 中提取到文字，并报告页数", async () => {
    const pdfPath = await writeFixture(
      dir,
      "sample.pdf",
      buildMinimalPdf("SupplierCheck PDF text layer probe 12345"),
    );

    const outcome = await pdfParser.parse(await localSource(pdfPath, "application/pdf"));

    expect(outcome.parserId).toBe("pdf");
    expect(outcome.text).toContain("SupplierCheck PDF text layer probe 12345");
    expect(outcome.pageCount).toBe(1);
    expect(outcome.truncated).toBe(false);
    expect(outcome.charCount).toBeGreaterThan(0);
    expect(outcome.notes).toEqual([]);
  });

  it("合成 PDF 无法覆盖中文提取 —— 如实记录这个限制，不用假通过掩盖", async () => {
    /**
     * 这条测试**不是在验证能力，是在登记缺口**。
     *
     * 手工合成的 PDF 只能放 ASCII：中文即使以 UTF-16BE hex 字符串写进文本层，
     * pdf.js 也会按字体编码（Helvetica → WinAnsi）逐字节映射成乱码，
     * 因为夹具没有嵌入字体程序与 ToUnicode CMap。要修就得往夹具里塞一份
     * 几 MB 的 TTF 并手写 CIDFont 结构 —— 那已经不是「最小夹具」了。
     *
     * 真实的中文 PDF 自带字体与 ToUnicode 表，提取是正常的；但**这一点
     * 未在本项目的自动化测试里验证过**，投产前必须用一份真实中文 PDF 人工确认。
     * 声明这个缺口，比编一条永远通过的中文断言更有价值。
     */
    const pdfPath = await writeFixture(dir, "chinese.pdf", buildMinimalPdf("ASCII part 2027-12-31"));
    const outcome = await pdfParser.parse(await localSource(pdfPath, "application/pdf"));

    // 能验证的部分：ASCII 文本层提取完好，且没有被中文缺口连累。
    expect(outcome.text).toContain("ASCII part 2027-12-31");
    expect(outcome.parserId).toBe("pdf");
  });
});

describe("docxParser", () => {
  it("提取段落、制表符与表格单元格，并忽略域代码", async () => {
    const docxPath = await writeFixture(
      dir,
      "sample.docx",
      await buildMinimalDocx({
        bodyXml: SAMPLE_DOCX_BODY,
        footnotesXml: "<w:p><w:r><w:t>脚注内容</w:t></w:r></w:p>",
      }),
    );

    const outcome = await docxParser.parse(
      await localSource(
        docxPath,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    );

    // 同一段落里多个 run 必须被拼接成一句话
    expect(outcome.text).toContain("资质证书持有人：示例科技");
    // <w:tab/> 必须转成真正的制表符，否则「有效期至」和日期会粘在一起
    expect(outcome.text).toContain("有效期至\t2027-12-31");
    // 表格单元格文字要保留
    expect(outcome.text).toContain("项目");
    expect(outcome.text).toContain("结论");
    // 脚注部件也要抽
    expect(outcome.text).toContain("脚注内容");
    // w:instrText（域代码）不是可见内容，必须被排除
    expect(outcome.text).not.toContain("PAGE");
    expect(outcome.text).toContain("正文结尾");
  });

  it("没有本地路径时如实降级，而不是假装解析成功", async () => {
    const outcome = await docxParser.parse({
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 1024,
      originalFilename: "x.docx",
      openStream: async () => {
        throw new Error("不应被调用");
      },
      readAll: async () => {
        throw new Error("不应被调用");
      },
    });

    expect(outcome.text).toBe("");
    expect(outcome.meta.reason).toBe("no_local_path");
    expect(outcome.notes.join("")).toContain("已跳过文本提取");
  });
});

describe("xlsxParser", () => {
  it("逐行提取单元格，保持列对齐，且不依赖 zip 条目顺序", async () => {
    // 夹具刻意把 xl/workbook.xml 放在 zip 最后 —— exceljs 的流式读取器正是
    // 在这个顺序下崩溃。我们的两遍式实现必须不受影响。
    const xlsxPath = await writeFixture(
      dir,
      "sample.xlsx",
      await buildMinimalXlsx({
        sheetName: "控制项",
        sharedStringsXml: SAMPLE_XLSX_SHARED_STRINGS,
        sheetXml: SAMPLE_XLSX_SHEET,
      }),
    );

    const outcome = await xlsxParser.parse(
      await localSource(
        xlsxPath,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    );

    expect(outcome.parserId).toBe("xlsx");
    expect(outcome.sheetNames).toEqual(["控制项"]);

    const lines = outcome.text.split("\n");
    // 表头：共享字符串按索引解析；富文本多段 run 要拼接
    expect(lines).toContain("控制编号\t是否文档化？\t富文本拼接");
    // 第 2 行：内联字符串 + B 列空缺要补位，数字原样保留
    expect(lines).toContain("内联文本\t\t123.5");
    // 第 3 行：两个日期样式（内置 14 与自定义 164）都要转成 ISO 日期，布尔转 TRUE/FALSE
    expect(lines).toContain("2025-01-21\t2025-01-21\tTRUE");
    // 第 4 行：公式缓存结果 + 错误值，D 列前要补两个空位
    expect(lines).toContain("\t公式结果\t\t#REF!");
    // 第 5 行只有一个空单元格：整行必须被裁空，不能输出一串只有制表符的噪音
    expect(lines.some((line) => line.length > 0 && line.trim().length === 0)).toBe(false);
    expect(lines[lines.length - 1]).toBe("\t公式结果\t\t#REF!");

    expect(outcome.truncated).toBe(false);
    expect(outcome.meta.rows).toBe(5);
  });

  it("读取多行数据时会带出工作表标题，并统计行数", async () => {
    const rows = new Array(60)
      .fill(0)
      .map((_, index) => `<row r="${index + 1}"><c r="A${index + 1}"><v>${index}</v></c></row>`)
      .join("");

    const xlsxPath = await writeFixture(
      dir,
      "big.xlsx",
      await buildMinimalXlsx({
        sharedStringsXml: "<si><t>x</t></si>",
        sheetXml: rows,
      }),
    );

    const outcome = await xlsxParser.parse(
      await localSource(
        xlsxPath,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    );

    expect(outcome.meta.rows).toBe(60);
    expect(outcome.text).toContain("## 工作表：控制项");
    expect(outcome.truncated).toBe(false);
  });
});

describe("archiveParser", () => {
  it("列出可展开的条目与被拒绝的条目", async () => {
    const zipPath = await writeFixture(
      dir,
      "pack.zip",
      await buildZip([
        ["ok.pdf", buildMinimalPdf("inside archive")],
        ["notes.exe", Buffer.from("not allowed", "utf8")],
        ["nested.zip", Buffer.from("PK\x03\x04", "latin1")],
      ]),
    );

    const outcome = await archiveParser.parse(await localSource(zipPath, "application/zip"));

    expect(outcome.meta.acceptedCount).toBe(1);
    expect(outcome.text).toContain("ok.pdf");
    // 关键：被拒绝的条目必须写出来，而不是悄悄消失
    expect(outcome.text).toContain("notes.exe");
    expect(outcome.text).toContain("nested.zip");
    expect(outcome.text).toContain("不支持嵌套压缩包");
  });
});

describe("imageParser", () => {
  it("明确返回「暂不支持本地 OCR」，不伪造文本", async () => {
    const outcome = await imageParser.parse({
      mimeType: "image/png",
      size: 2048,
      originalFilename: "scan.png",
      openStream: async () => {
        throw new Error("不应被调用");
      },
      readAll: async () => {
        throw new Error("不应被调用 —— 图片解析器不读文件内容");
      },
    });

    expect(outcome.text).toBe("");
    expect(outcome.charCount).toBe(0);
    expect(outcome.meta.extraction).toBe("unsupported");
    expect(outcome.notes.join("")).toContain("暂不支持本地 OCR");
  });
});
