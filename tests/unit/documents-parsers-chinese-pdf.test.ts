/**
 * 中文 PDF 提取（用仓库里的真实 PDF 夹具）。
 *
 * 这条测试补的是一个具体的、此前一直空着的缺口：
 * 手工合成的极简 PDF **写不进中文** —— 塞进去的 UTF-16BE 十六进制串会被 pdf.js
 * 按 WinAnsi 逐字节读出来，得到 `O ^ UF D (`f Nf g...` 这种乱码
 * （详见 tests/helpers/document-fixtures.ts 里 buildMinimalPdf 的说明）。
 * 于是「中文供应商资料能不能正确提取」长期只有 tests/manual/ 下一个需要手动
 * 传环境变量才跑的手工探测，CI 里等于没有覆盖。
 *
 * 夹具 `tests/fixtures/supplier-package-zh.pdf` 由
 * `scripts/make-sample-supplier-pdf.py` 生成（真实字体嵌入 + 真实 CMap），
 * 提取路径与真实业务文件完全一致。要改内容就改那个脚本再重新生成，
 * 不要手改 PDF 二进制。
 *
 * 断言分三层，缺一不可：
 *   1. 结构：页数、解析器标识、未截断 —— 证明文件被完整处理，不是降级跳过；
 *   2. 内容：关键中文字串必须出现 —— 证明提取到的确实是这份文件的内容；
 *   3. 反乱码：不得出现替换字符或 latin1 误读特征 —— 这一层最容易被漏掉，
 *      而它恰恰是「提取看起来成功、实际全是乱码」的唯一防线。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { pdfParser } from "@/lib/documents/parsers/pdf";

const FIXTURE = path.resolve(process.cwd(), "tests/fixtures/supplier-package-zh.pdf");

/** 常见的「UTF-8 被当成 latin1 解读」乱码特征。 */
const MOJIBAKE_PATTERN = /[\uFFFD]|â€|Ã[\u0080-\u00BF]|ä¸|å[¼¾]/;

/** 夹具里刻意覆盖的难提取字符与字段，逐项要求出现。 */
const EXPECTED_FRAGMENTS = [
  "供应商准入资料包",
  "示例精密五金制造（佛山）有限公司",
  "91440606MA0000000X",
  "广东省佛山市顺德区示例路 88 号 3 栋",
  "ISO 9001:2015 质量管理体系认证",
  "CN-SAMPLE-2024-0001",
  "2027 年 6 月 30 日",
  "报价单号：QT-2026-0927-A",
  "Φ60×3.0 mm", // 希腊字母 + 乘号
  "热浸镀锌", // 专业术语
  "≥ 65 μm", // 数学符号 + 微米
  "±0.5°", // 正负号 + 度
  "-40 ℃ 至 +85 ℃", // 摄氏度
  "¥175,000.00", // 全角币种符号 + 千分位
  "壹拾柒万伍仟元整", // 中文大写金额
];

describe("中文 PDF 提取", () => {
  it("完整提取中文内容，且不出现乱码", async () => {
    const bytes = await readFile(FIXTURE);
    const outcome = await pdfParser.parse({
      mimeType: "application/pdf",
      size: bytes.byteLength,
      originalFilename: "供应商准入资料包-示例.pdf",
      localPath: FIXTURE,
      openStream: () => Promise.resolve(Readable.from([bytes])),
      readAll: () => Promise.resolve(new Uint8Array(bytes)),
    });

    // --- 1. 结构 ---
    expect(outcome.parserId).toBe("pdf");
    expect(outcome.pageCount).toBe(2);
    expect(outcome.truncated).toBe(false);
    expect(outcome.charCount).toBeGreaterThan(800);

    // 中文占比必须是真的「中文文档」，而不是零星几个字
    const cjkCount = (outcome.text.match(/[\u4e00-\u9fff]/g) ?? []).length;
    expect(cjkCount).toBeGreaterThan(400);

    // --- 2. 内容 ---
    const missing = EXPECTED_FRAGMENTS.filter((fragment) => !outcome.text.includes(fragment));
    expect(missing, `以下内容没有被提取到：${JSON.stringify(missing)}`).toEqual([]);

    // --- 3. 反乱码 ---
    // 这一层是重点：前两层都可能通过，而文字其实已经错了。
    expect(MOJIBAKE_PATTERN.test(outcome.text), "提取结果里出现乱码特征").toBe(false);
    expect(outcome.text).not.toContain("\uFFFD");
  });
});
