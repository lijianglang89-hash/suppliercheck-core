/**
 * 真实文件探测（手动 / 可选）。
 *
 * 存在的理由是一个明确的能力缺口：手工合成的 PDF 夹具放不了中文（详见
 * tests/helpers/document-fixtures.ts 里 buildMinimalPdf 的说明），
 * 于是「PDF 中文提取到底能不能用」这件事**没有被自动化测试覆盖**。
 * 这个缺口不能靠一条永远通过的假断言糊过去，只能靠真实文件验证。
 *
 * 用法（把任何一份真实 PDF 的路径传进来）：
 *
 *   REAL_PDF="/path/to/真实供应商资质.pdf" npx vitest run tests/manual
 *
 * 它会报告：页数、提取字符数、中文字符数、疑似乱码字符数、解析器提示语。
 * 含中文时自动断言「没有替换字符（U+FFFD）」，不含中文时只报告统计。
 *
 * 建议在正式接入真实供应商资料前，用一份真实的中文 PDF 跑一次。
 */
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { pdfParser } from "@/lib/documents/parsers/pdf";

const REAL_PDF = process.env.REAL_PDF;

/** 常见的「UTF-8 被当成 latin1 解读」乱码特征字符。 */
const MOJIBAKE_PATTERN = /[\uFFFD]|â€|Ã[\u0080-\u00BF]|ä¸|å[¼¾]/;

if (!REAL_PDF) {
  describe("真实 PDF 探测（未启用）", () => {
    it.skip("设置 REAL_PDF=<文件路径> 后运行：npx vitest run tests/manual", () => {});
  });
} else {
  describe("真实 PDF 探测", () => {
    it("报告提取统计，并在含中文时断言没有乱码", async () => {
      const bytes = await readFile(REAL_PDF);
      const outcome = await pdfParser.parse({
        mimeType: "application/pdf",
        size: bytes.byteLength,
        originalFilename: REAL_PDF.split(/[\\/]/).pop() ?? "probe.pdf",
        localPath: REAL_PDF,
        openStream: () => Promise.resolve(Readable.from([bytes])),
        readAll: () => Promise.resolve(new Uint8Array(bytes)),
      });

      const cjkCount = (outcome.text.match(/[\u4e00-\u9fff]/g) ?? []).length;

      console.log("──── 真实 PDF 探测结果 ────");
      console.log("文件：", REAL_PDF);
      console.log("字节：", bytes.byteLength, "| 页数：", outcome.pageCount);
      console.log("提取字符数：", outcome.charCount, "| 中文字符数：", cjkCount);
      console.log("是否截断：", outcome.truncated);
      console.log("解析器提示：", JSON.stringify(outcome.notes));
      console.log("前 80 字：", JSON.stringify(outcome.text.slice(0, 80)));

      expect(outcome.parserId).toBe("pdf");

      if (cjkCount > 0) {
        // 有中文才谈得上验证中文；此时必须没有乱码特征。
        expect(outcome.text).not.toMatch(MOJIBAKE_PATTERN);
      } else {
        console.log("（该文件不含中文，本次未覆盖中文提取 —— 请换一份中文 PDF 再跑一次）");
      }
    });
  });
}
