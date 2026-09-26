/**
 * 真实文件探测（手动 / 可选）。
 *
 * ⚠️ 2026-09-27 更新：这里的「中文 PDF 提取无人覆盖」缺口**已经闭合**。
 * 现在有一份随仓库提交的真实中文 PDF 夹具
 * （`tests/fixtures/supplier-package-zh.pdf`，由 `scripts/make-sample-supplier-pdf.py`
 * 用真实字体嵌入生成），并由 `tests/unit/documents-parsers-chinese-pdf.test.ts`
 * 在**每次 CI** 里断言结构、内容、以及「没有乱码」。所以这个文件不再是唯一防线。
 *
 * 它保留下来是因为还有另一件事它才能做：拿**任意一份真实业务 PDF**（客户发来的、
 * 扫描件、带复杂排版的）临时验证一下。夹具代表的是我们自己造的文件，
 * 覆盖不了真实世界的全部排版。
 *
 * 用法：
 *
 *   REAL_PDF="/path/to/真实供应商资质.pdf" npx vitest run tests/manual
 *
 * 它会报告：页数、提取字符数、中文字符数、疑似乱码字符数、解析器提示语。
 * 含中文时自动断言「没有替换字符（U+FFFD）」，不含中文时只报告统计。
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
