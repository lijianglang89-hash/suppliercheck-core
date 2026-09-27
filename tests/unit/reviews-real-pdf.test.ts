/**
 * 审核引擎 × 真实中文资料包。
 *
 * 补的是一个此前一直空着的洞：引擎原来**只在合成文本上被单测过**
 * （tests/unit/reviews-engine.test.ts 手写的字符串），而「真实 PDF → 解析 → 提取 →
 * 规则 → 结论」这条链路唯一的验证是 tests/manual 下一个 describe.skip 的手工脚本，
 * 依赖库里已有的资料 —— CI 里等于没有覆盖。
 *
 * 这里用的是仓库里随附的真实夹具 `tests/fixtures/supplier-package-zh.pdf`
 * （由 scripts/make-sample-supplier-pdf.py 用真实嵌入字体生成，提取路径与真实业务文件一致）。
 *
 * ⚠️ 断言全部来自**实测结果**，不是设计意图。改夹具或改规则后如果这里红了，
 * 先跑一遍看真实结论是什么，再决定是改断言还是改实现 —— 不要凭直觉把断言改成绿的。
 *
 * 夹具事实（探针实测）：
 *   - 统一社会信用代码 91440606MA0000000X 是虚构占位码，GB 32100 校验位应为 P，实际 X；
 *   - 全文没有「开户 / 银行 / 纳税人」等必备资料关键词；
 *   - 证书：ISO 9001/14001 有效期至 2027-06-30，CE 有效期至 2026-12-31；
 *   - 报价单写的是「自报价日起 30 个自然日」这类**相对期限**（无法解析成绝对日期）。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { pdfParser } from "@/lib/documents/parsers/pdf";
import { runReviewEngine } from "@/lib/reviews/engine";
import type { ReviewDocumentInput, Severity } from "@/lib/reviews/types";
import { findBuiltinTemplate } from "@/lib/templates/builtin";

const FIXTURE = path.resolve(process.cwd(), "tests/fixtures/supplier-package-zh.pdf");

/** 常见的「UTF-8 被当成 latin1 解读」乱码特征。 */
const MOJIBAKE_PATTERN = /[\uFFFD]|â€|Ã[\u0080-\u00BF]|ä¸|å[¼¾]/;

async function loadFixtureDocument(status = "READY"): Promise<ReviewDocumentInput> {
  const bytes = await readFile(FIXTURE);
  const parsed = await pdfParser.parse({
    mimeType: "application/pdf",
    size: bytes.byteLength,
    originalFilename: "供应商准入资料包-示例.pdf",
    localPath: FIXTURE,
    openStream: () => Promise.resolve(Readable.from([bytes])),
    readAll: () => Promise.resolve(new Uint8Array(bytes)),
  });

  return {
    id: "00000000-0000-4000-8000-000000000001",
    label: "供应商准入资料包-示例.pdf",
    originalFilename: "供应商准入资料包-示例.pdf",
    mimeType: "application/pdf",
    /**
     * ⚠️ 解析器输出**不带** status —— 状态由文档服务层在落库时写
     * （UPLOADED → PROCESSING → READY / FAILED）。引擎判定「可读」要求 status === "READY"。
     * 写探针时曾经直接透传 parsed.status（undefined），结果引擎报 0 字符参与审核，
     * 差点被误读成引擎缺陷。这条注释和下方的反向断言一起把这个坑钉死。
     */
    status,
    parserId: parsed.parserId,
    text: parsed.text,
    charCount: parsed.text.length,
    truncated: Boolean(parsed.truncated),
    pageCount: parsed.pageCount ?? null,
    notes: parsed.notes ?? [],
  };
}

function templateConfig() {
  const template = findBuiltinTemplate("supplier-onboarding");
  if (!template) throw new Error("内置模板 supplier-onboarding 不存在");
  return template.config;
}

async function runAt(isoDate: string, documents: ReviewDocumentInput[]) {
  return runReviewEngine({
    documents,
    config: templateConfig(),
    supplierName: "示例精密五金制造（佛山）有限公司",
    supplierUscc: null,
    supplierSubjectType: null,
    now: new Date(`${isoDate}T00:00:00.000Z`),
  });
}

const ids = (severityAndRule: { ruleId: string; severity: Severity }[]) =>
  severityAndRule.map((f) => `${f.severity}/${f.ruleId}`).sort();

describe("审核引擎 · 真实中文资料包", () => {
  it("解析出的正文可供引擎使用（结构 + 无乱码）", async () => {
    const doc = await loadFixtureDocument();
    expect(doc.parserId).toBe("pdf");
    expect(doc.pageCount).toBe(2);
    expect(doc.truncated).toBe(false);
    expect(doc.text.length).toBeGreaterThan(1000);
    expect(MOJIBAKE_PATTERN.test(doc.text)).toBe(false);
    // 关键字段必须真的被提取出来，否则后面所有断言都是在空文本上自欺
    expect(doc.text).toContain("91440606MA0000000X");
    expect(doc.text).toContain("2027 年 6 月 30 日");
  });

  it("基准日 2026-09-27：查出编造的信用代码与两份缺失必备资料", async () => {
    const doc = await loadFixtureDocument();
    const outcome = await runAt("2026-09-27", [doc]);

    expect(outcome.summary.readableDocumentCount).toBe(1);
    expect(outcome.summary.totalCharacters).toBe(doc.text.length);
    expect(outcome.summary.skippedRules).toEqual([]);

    const got = ids(outcome.findings);
    expect(got).toEqual(
      [
        "HIGH/REQUIRED_DOCUMENT_MISSING",
        "HIGH/REQUIRED_DOCUMENT_MISSING",
        "HIGH/USCC_INVALID",
        "LOW/CERTIFICATE_EXPIRY_UNKNOWN",
      ].sort(),
    );

    const uscc = outcome.findings.find((f) => f.ruleId === "USCC_INVALID");
    expect(uscc?.detail).toContain("P"); // 校验位应为 P
    expect(uscc?.detail).toContain("X"); // 实际为 X

    // 相对期限「30 个自然日」必须被如实报成「判不了」，而不是被推算成一个日期
    const unknown = outcome.findings.find((f) => f.ruleId === "CERTIFICATE_EXPIRY_UNKNOWN");
    expect(unknown?.detail).toContain("不做推算");
  });

  it("基准日 2026-09-27：CE 证书距到期 95 天 > 90 天阈值，不应告警", async () => {
    const doc = await loadFixtureDocument();
    const outcome = await runAt("2026-09-27", [doc]);
    const ruleIds = outcome.findings.map((f) => f.ruleId);
    expect(ruleIds).not.toContain("CERTIFICATE_EXPIRING_SOON");
    expect(ruleIds).not.toContain("CERTIFICATE_EXPIRED");
  });

  it("基准日推到 2026-10-10（距到期 82 天 ≤ 90）：CE 转为临期告警", async () => {
    const doc = await loadFixtureDocument();
    const outcome = await runAt("2026-10-10", [doc]);
    const soon = outcome.findings.filter((f) => f.ruleId === "CERTIFICATE_EXPIRING_SOON");
    expect(soon).toHaveLength(1);
    expect(soon[0]?.severity).toBe("HIGH");
  });

  it("基准日推到 2027-01-05（CE 已过期）：出现阻断级过期", async () => {
    const doc = await loadFixtureDocument();
    const outcome = await runAt("2027-01-05", [doc]);
    const expired = outcome.findings.filter((f) => f.ruleId === "CERTIFICATE_EXPIRED");
    expect(expired).toHaveLength(1);
    expect(expired[0]?.severity).toBe("CRITICAL");
    expect(outcome.summary.blockingCount).toBeGreaterThan(0);
  });

  it("未就绪（status 非 READY）的资料不参与审核，且被如实说明", async () => {
    const doc = await loadFixtureDocument("PROCESSING");
    const outcome = await runAt("2026-09-27", [doc]);
    expect(outcome.summary.readableDocumentCount).toBe(0);
    expect(outcome.findings.some((f) => f.ruleId === "DOCUMENT_NOT_READY")).toBe(true);
    // 不能因为没正文就静默通过 —— 必须明确告知「什么也没检查」
    expect(
      outcome.summary.coverageNotes.some((note) => note.includes("什么也没有检查")),
    ).toBe(true);
  });

  it("AI 复核如实标记为未启用（不得拿 mock 冒充结论）", async () => {
    const doc = await loadFixtureDocument();
    const outcome = await runAt("2026-09-27", [doc]);
    expect(outcome.ai.enabled).toBe(false);
    expect(outcome.ai.mock).toBe(true);
    expect(outcome.ai.findings).toHaveLength(0);
  });

  it("确定性：同一输入跑两次，结论完全一致", async () => {
    const doc = await loadFixtureDocument();
    const a = await runAt("2026-10-10", [doc]);
    const b = await runAt("2026-10-10", [doc]);
    expect(JSON.stringify(a.findings)).toBe(JSON.stringify(b.findings));
    expect(a.summary.findingCount).toBe(b.summary.findingCount);
  });
});
