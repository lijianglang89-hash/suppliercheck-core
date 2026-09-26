/**
 * 审核引擎测试。
 *
 * 分两部分：
 *
 * **A. 合成文本**：逐条验证规则的触发与**不触发**。重点在"不触发"——
 * 一个规则引擎「什么都报」和「什么都不报」一样没用，所以每条规则都配了反例。
 *
 * **B. 真实中文 PDF**：用仓库里的 `supplier-package-zh.pdf`（真字体嵌入的真 PDF）
 * 走完整链路：pdf.js 提取 → 审核引擎。这层能抓到合成文本永远抓不到的问题，
 * 例如全角括号、`Φ60×3.0 mm`、千分位与中文大写金额混排时的正则行为。
 *
 * 全部用例都传入**固定的判定基准日**，因此结果与运行时间无关 ——
 * 「证书是否过期」这类断言一旦读系统时钟，会在某一天毫无征兆地变红。
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import type { AIProvider } from "@/lib/ai";
import { pdfParser } from "@/lib/documents/parsers/pdf";
import { runReviewEngine } from "@/lib/reviews/engine";
import { REVIEW_RULES } from "@/lib/reviews/rules";
import { findCompanyNames, findExpiryWindows, findLongTermMarkers } from "@/lib/reviews/extract";
import {
  RULE_IDS,
  SEVERITIES,
  type DraftFinding,
  type ReviewDocumentInput,
  type RuleId,
} from "@/lib/reviews/types";
import { BUILTIN_TEMPLATES, findBuiltinTemplate } from "@/lib/templates/builtin";
import { parseTemplateConfig, templateConfigSchema } from "@/lib/templates/types";

const FIXTURE = path.resolve(process.cwd(), "tests/fixtures/supplier-package-zh.pdf");

/** 固定基准日：2026-09-27。所有日期断言都以它为参照。 */
const NOW = new Date("2026-09-27T00:00:00.000Z");

/**
 * 补充文本。
 *
 * 存在的理由：引擎有一条「正文不足 30 字 = 没有可用正文，不参与审核」的规则，
 * 而测试里的用例文本往往只有一两行。不补齐的话，**每条规则都会因为"没读到正文"而静默不执行** ——
 * 测试会全绿，但什么都没验证。这是最危险的一种假绿。
 *
 * 补充内容刻意不含数字、日期、「有效期」、企业后缀等任何可能被规则命中的词。
 */
const FIXTURE_FILLER =
  "本资料为系统测试用夹具文本，不含任何真实企业信息；补充此段是为了让正文长度超过最小可读阈值。";

function doc(text: string, overrides: Partial<ReviewDocumentInput> = {}): ReviewDocumentInput {
  const padded = text.length >= 60 ? text : `${text}\n${FIXTURE_FILLER}`;
  return {
    id: "11111111-1111-4111-8111-111111111111",
    label: "资料.txt",
    originalFilename: "资料.txt",
    mimeType: "text/plain",
    status: "READY",
    parserId: "plaintext",
    text: padded,
    charCount: padded.length,
    truncated: false,
    pageCount: 1,
    notes: [],
    ...overrides,
  };
}

const onboarding = parseTemplateConfig(findBuiltinTemplate("supplier-onboarding")!.config);

async function run(
  documents: ReviewDocumentInput[],
  config = onboarding,
  extras: {
    supplierName?: string | null;
    supplierUscc?: string | null;
    maxFindings?: number;
    provider?: AIProvider;
  } = {},
) {
  return runReviewEngine({
    documents,
    config,
    now: NOW,
    supplierName: extras.supplierName ?? null,
    supplierUscc: extras.supplierUscc ?? null,
    ...(extras.maxFindings !== undefined ? { maxFindings: extras.maxFindings } : {}),
    ...(extras.provider ? { provider: extras.provider } : {}),
  });
}

function findingsOf(outcome: { findings: readonly DraftFinding[] }, ruleId: RuleId) {
  return outcome.findings.filter((finding) => finding.ruleId === ruleId);
}

/** 造一个形如 UUID 的 id，避免测试里出现看起来像真实标识的随意字符串。 */
function uuidFor(index: number): string {
  return `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`;
}

/* ================================================================== */
/* A. 规则行为                                                        */
/* ================================================================== */

describe("模板配置的校验", () => {
  it("坏掉的配置回退到默认值而不是抛错（列表页不该 500）", () => {
    const parsed = parseTemplateConfig({ requiredDocuments: "这不是数组", expiryWarningDays: -5 });
    expect(parsed.requiredDocuments).toEqual([]);
    expect(parsed.expiryWarningDays).toBe(90);
  });

  it("所有内置模板都能通过各自的 schema 校验", () => {
    for (const template of BUILTIN_TEMPLATES) {
      const parsed = templateConfigSchema.safeParse(template.config);
      expect(parsed.success, `模板 ${template.key} 配置非法`).toBe(true);
    }
  });

  it("内置模板引用的规则 id 都真实存在", () => {
    const known = new Set(REVIEW_RULES.map((rule) => rule.id));
    for (const template of BUILTIN_TEMPLATES) {
      for (const ruleId of template.config.enabledRules) {
        expect(known.has(ruleId as RuleId), `${template.key} 引用了不存在的规则 ${ruleId}`).toBe(
          true,
        );
      }
    }
  });
});

describe("必备资料缺失", () => {
  it("找不到关键词时报 HIGH，并在详情里说明检索范围与关键词", async () => {
    const outcome = await run([doc("公司名称：示例有限公司\n统一社会信用代码：914403001922038216")]);
    const findings = findingsOf(outcome, "REQUIRED_DOCUMENT_MISSING");

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.severity === "HIGH")).toBe(true);
    expect(findings[0]!.detail).toContain("检索关键词");
    expect(findings[0]!.detail).toContain("份");
  });

  it("关键词命中时不再报缺失", async () => {
    const outcome = await run([
      doc("营业执照 统一社会信用代码：914403001922038216 开户许可证 一般纳税人 法定代表人"),
    ]);
    const labels = findingsOf(outcome, "REQUIRED_DOCUMENT_MISSING").map((finding) => finding.title);

    expect(labels.some((title) => title.includes("营业执照"))).toBe(false);
    expect(labels.some((title) => title.includes("开户许可证"))).toBe(false);
  });

  it("非必备资料缺失只报 INFO", async () => {
    const outcome = await run([doc("营业执照")]);
    const findings = findingsOf(outcome, "OPTIONAL_DOCUMENT_MISSING");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.severity === "INFO")).toBe(true);
  });

  it("无法提取正文的资料会让「缺失」结论写明未参与匹配", async () => {
    const outcome = await run([
      doc("营业执照", { id: "22222222-2222-4222-8222-222222222222" }),
      doc("", {
        id: "33333333-3333-4333-8333-333333333333",
        text: "",
        charCount: 0,
        parserId: "image-ocr-pending",
        label: "扫描件.png",
      }),
    ]);
    const finding = findingsOf(outcome, "REQUIRED_DOCUMENT_MISSING")[0];
    expect(finding!.detail).toContain("未能提取正文");
  });
});

describe("正文可用性", () => {
  it("未完成解析的资料报 HIGH 且不参与匹配", async () => {
    const outcome = await run([
      doc("", { status: "PROCESSING", text: "", charCount: 0, label: "卡住的.pdf" }),
    ]);
    const findings = findingsOf(outcome, "DOCUMENT_NOT_READY");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("HIGH");
    expect(outcome.summary.readableDocumentCount).toBe(0);
  });

  it("正文过短（扫描件）报「无法参与审核」而不是判为合格", async () => {
    const outcome = await run([
      doc("", { text: "扫描件", charCount: 3, parserId: "pdf", notes: ["未提取到文本层"] }),
    ]);
    const findings = findingsOf(outcome, "DOCUMENT_UNREADABLE");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detail).toContain("未提取到文本层");
  });

  it("被截断的资料报 INFO 而不是静默略过", async () => {
    const outcome = await run([doc("营业执照".repeat(50), { truncated: true })]);
    expect(findingsOf(outcome, "DOCUMENT_TEXT_TRUNCATED")).toHaveLength(1);
  });
});

describe("统一社会信用代码", () => {
  it("完全没有代码时报「未找到」", async () => {
    const outcome = await run([doc("这是一份没有任何代码的资料，营业执照在此。")]);
    expect(findingsOf(outcome, "USCC_MISSING")).toHaveLength(1);
  });

  it("校验位错误时报 HIGH 并写出应有校验位", async () => {
    const outcome = await run([doc("统一社会信用代码：914403001922038217")]);
    const findings = findingsOf(outcome, "USCC_INVALID");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("HIGH");
    expect(findings[0]!.detail).toContain("校验位应为");
  });

  it("合法代码不报任何 USCC 问题", async () => {
    const outcome = await run([doc("统一社会信用代码：914403001922038216")]);
    expect(findingsOf(outcome, "USCC_INVALID")).toHaveLength(0);
    expect(findingsOf(outcome, "USCC_MISSING")).toHaveLength(0);
  });

  it("出现两个不同代码时报「多主体」", async () => {
    const outcome = await run([
      doc("统一社会信用代码：914403001922038216", { label: "A.pdf" }),
      doc("统一社会信用代码：91330100799655058B", { label: "B.pdf" }),
    ]);
    const findings = findingsOf(outcome, "USCC_MULTIPLE");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detail).toContain("914403001922038216");
  });
});

describe("主体一致性", () => {
  it("剔除认证机构后只剩一个主体时不报冲突", async () => {
    const outcome = await run([
      doc(
        "公司名称：示例精密制造有限公司\n" +
          "本证书由 中国质量认证中心 颁发，认证机构：北京中示例检测有限公司",
      ),
    ]);
    expect(findingsOf(outcome, "COMPANY_NAME_CONFLICT")).toHaveLength(0);
  });

  /**
   * 级别是 LOW 而不是 MEDIUM，这是**改过一次**的：
   * 报价单上必然有客户抬头、检测报告上必然有机构名，
   * 无条件报 MEDIUM 的结果是这条规则被当成噪音略过。
   */
  it("出现两个非第三方主体时报 LOW，措辞为「需确认」而非「疑似混入」", async () => {
    const outcome = await run([
      doc("申报主体：示例精密制造有限公司\n担保方：另一家示例贸易有限公司"),
    ]);
    const findings = findingsOf(outcome, "COMPANY_NAME_CONFLICT");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("LOW");
    expect(findings[0]!.detail).toContain("示例精密制造有限公司");
    expect(findings[0]!.detail).toContain("另一家示例贸易有限公司");
  });

  it("关联了供应商但资料里没有该名称时报 LOW（如实说明「无法确认归属」）", async () => {
    const outcome = await run([doc("营业执照：某某有限公司")], onboarding, {
      supplierName: "目标供应商有限公司",
    });
    const findings = findingsOf(outcome, "SUPPLIER_NAME_NOT_FOUND");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("LOW");
  });

  it("未关联供应商时该规则不执行（避免凭空的提示）", async () => {
    const outcome = await run([doc("营业执照：某某有限公司")]);
    expect(findingsOf(outcome, "SUPPLIER_NAME_NOT_FOUND")).toHaveLength(0);
  });
});

describe("证照有效期", () => {
  it("已过期报 CRITICAL 并写出逾期天数", async () => {
    const outcome = await run([doc("ISO 9001 认证证书，有效期至 2026 年 1 月 1 日")]);
    const findings = findingsOf(outcome, "CERTIFICATE_EXPIRED");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("CRITICAL");
    expect(findings[0]!.detail).toContain("已过期");
    expect(findings[0]!.detail).toContain("269");
  });

  it("到期日当天**不算**过期（边界取闭区间）", async () => {
    const outcome = await run([doc("证书有效期至 2026 年 9 月 27 日")]);
    expect(findingsOf(outcome, "CERTIFICATE_EXPIRED")).toHaveLength(0);
    expect(findingsOf(outcome, "CERTIFICATE_EXPIRING_SOON")).toHaveLength(1);
  });

  it("阈值内报即将到期，阈值外不报", async () => {
    const soon = await run([doc("有效期至 2026 年 11 月 30 日")]);
    expect(findingsOf(soon, "CERTIFICATE_EXPIRING_SOON")).toHaveLength(1);

    const later = await run([doc("有效期至 2028 年 1 月 1 日")]);
    expect(findingsOf(later, "CERTIFICATE_EXPIRING_SOON")).toHaveLength(0);
  });

  it("预警阈值由模板决定（120 天模板能抓到 90 天模板漏掉的）", async () => {
    const text = "有效期至 2026 年 12 月 31 日";
    const base = parseTemplateConfig(findBuiltinTemplate("supplier-onboarding")!.config); // 90
    const wide = parseTemplateConfig(findBuiltinTemplate("qualification-validity")!.config); // 120

    expect(findingsOf(await run([doc(text)], base), "CERTIFICATE_EXPIRING_SOON")).toHaveLength(0);
    expect(findingsOf(await run([doc(text)], wide), "CERTIFICATE_EXPIRING_SOON")).toHaveLength(1);
  });

  it("只有「30 个自然日」这种相对期限时如实报「无法判定」而不做推算", async () => {
    const outcome = await run([doc("报价有效期：自报价日起 30 个自然日")]);
    const findings = findingsOf(outcome, "CERTIFICATE_EXPIRY_UNKNOWN");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detail).toContain("不做推算");
  });

  it("没有任何「有效期」字样时不报（不制造噪声）", async () => {
    const outcome = await run([doc("这是一份说明文档，没有证书信息。")]);
    expect(findingsOf(outcome, "CERTIFICATE_EXPIRY_UNKNOWN")).toHaveLength(0);
  });
});

describe("金额大小写一致性", () => {
  it("一致时不报", async () => {
    const outcome = await run([doc("合计金额：人民币 壹拾柒万伍仟元整（¥175,000.00）")]);
    expect(findingsOf(outcome, "AMOUNT_MISMATCH")).toHaveLength(0);
  });

  it("不一致时报 HIGH 并同时给出两个数值", async () => {
    const outcome = await run([doc("合计金额：人民币 壹拾柒万伍仟元整（¥175,500.00）")]);
    const findings = findingsOf(outcome, "AMOUNT_MISMATCH");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("HIGH");
    expect(findings[0]!.detail).toContain("175,000.00");
    expect(findings[0]!.detail).toContain("175,500.00");
  });

  it("⭐ 「注册资本 500 万元整」不会被当成大写金额去和附近数字配对（曾踩过的假阳性）", async () => {
    const outcome = await run([
      doc("注册资本：人民币 500 万元整\n报价合计：¥180,000.00\n实收资本 500 万元"),
    ]);
    expect(findingsOf(outcome, "AMOUNT_MISMATCH")).toHaveLength(0);
  });

  it("报价表里多个金额彼此相距较远时不强行配对", async () => {
    const rows = ["连接底板 18.50 元 37,000.00", "加强角件 24.80 元 37,200.00"].join("\n");
    const outcome = await run([doc(`报价明细\n${rows}`)]);
    expect(findingsOf(outcome, "AMOUNT_MISMATCH")).toHaveLength(0);
  });
});

describe("占位内容", () => {
  it("识别空白模板（下划线 + 待补充）", async () => {
    const outcome = await run([doc("联系人：________\n银行账号：待补充")]);
    const findings = findingsOf(outcome, "PLACEHOLDER_CONTENT");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("MEDIUM");
    expect(findings[0]!.detail).toContain("下划线空格");
  });

  it("正常填写的内容不报", async () => {
    const outcome = await run([doc("联系人：张三\n银行账号：6222 0000 0000 0000")]);
    expect(findingsOf(outcome, "PLACEHOLDER_CONTENT")).toHaveLength(0);
  });
});

describe("AI 复核的诚实性", () => {
  it("默认（模拟 Provider）下 enabled = false，且不产出任何 AI 发现", async () => {
    const outcome = await run([doc("营业执照")]);
    expect(outcome.ai.enabled).toBe(false);
    expect(outcome.ai.mock).toBe(true);
    expect(outcome.ai.findings).toHaveLength(0);
    expect(outcome.ai.notes.join(" ")).toContain("未启用");
    expect(outcome.findings.some((finding) => finding.category === "AI")).toBe(false);
  });

  it("摘要里必须写明 AI 复核未启用（不能只藏在 ai 字段里）", async () => {
    const outcome = await run([doc("营业执照")]);
    expect(outcome.summary.coverageNotes.join(" ")).toContain("AI 复核未启用");
  });

  it("接入非 mock Provider 时才产出 AI 发现，且级别不超过 MEDIUM", async () => {
    const fake: AIProvider = {
      id: "fake",
      model: "fake-model",
      isMock: false,
      generateText: async () => ({ provider: "fake", model: "fake-model", mock: false, text: "" }),
      generateStructuredOutput: async () => {
        throw new Error("本测试不使用结构化输出");
      },
      classify: async () => ({
        provider: "fake",
        model: "fake-model",
        mock: false,
        label: "Other",
        confidence: 0,
      }),
      extractEntities: async () => ({
        provider: "fake",
        model: "fake-model",
        mock: false,
        entities: [],
      }),
      analyzeEvidence: async () => ({
        provider: "fake",
        model: "fake-model",
        mock: false,
        conclusion: "发现一处需要人工确认的表述。",
        confidence: 0.5,
        citations: ["doc-1"],
      }),
    };

    const outcome = await run([doc("营业执照")], onboarding, { provider: fake });
    expect(outcome.ai.enabled).toBe(true);
    expect(outcome.ai.findings.length).toBeGreaterThan(0);
    expect(outcome.ai.findings.every((finding) => finding.category === "AI")).toBe(true);
    expect(outcome.ai.findings.every((finding) => finding.severity === "MEDIUM")).toBe(true);
  });

  it("真实 Provider 返回空结论时，不补一句「未发现异常」充数", async () => {
    const silent: AIProvider = {
      id: "silent",
      model: "silent-model",
      isMock: false,
      generateText: async () => ({ provider: "silent", model: "silent-model", mock: false, text: "" }),
      generateStructuredOutput: async () => {
        throw new Error("本测试不使用结构化输出");
      },
      classify: async () => ({
        provider: "silent",
        model: "silent-model",
        mock: false,
        label: "Other",
        confidence: 0,
      }),
      extractEntities: async () => ({
        provider: "silent",
        model: "silent-model",
        mock: false,
        entities: [],
      }),
      analyzeEvidence: async () => ({
        provider: "silent",
        model: "silent-model",
        mock: false,
        conclusion: "   ",
        confidence: 0,
        citations: [],
      }),
    };

    const outcome = await run([doc("营业执照")], onboarding, { provider: silent });
    expect(outcome.ai.enabled).toBe(true);
    expect(outcome.ai.findings).toHaveLength(0);
    expect(outcome.ai.notes.join(" ")).toContain("未返回结论");
  });
});

describe("摘要与排序", () => {
  it("按严重级别降序排列", async () => {
    const outcome = await run([
      doc("联系人：______\n有效期至 2020 年 1 月 1 日\n统一社会信用代码：914403001922038217"),
    ]);
    const ranks = outcome.findings.map((finding) => SEVERITIES.indexOf(finding.severity));
    const sorted = [...ranks].sort((a, b) => a - b);
    expect(ranks).toEqual(sorted);
    expect(outcome.summary.findingsBySeverity.CRITICAL).toBeGreaterThan(0);
  });

  it("没有任何发现时摘要依然说明「查了什么、覆盖了多少」", async () => {
    const outcome = await run([doc("公司名称：示例精密制造有限公司\n统一社会信用代码：914403001922038216")], {
      ...onboarding,
      requiredDocuments: [],
    });
    expect(outcome.findings).toHaveLength(0);
    expect(outcome.summary.documentCount).toBe(1);
    expect(outcome.summary.readableDocumentCount).toBe(1);
    expect(outcome.summary.executedRules.length).toBeGreaterThan(0);
    expect(outcome.summary.coverageNotes.length).toBeGreaterThan(0);
  });

  it("空文档集合时不假装「通过」", async () => {
    const outcome = await run([]);
    expect(outcome.summary.coverageNotes.join(" ")).toContain("没有选中任何资料");
    expect(outcome.summary.readableDocumentCount).toBe(0);
  });

  it("模板未启用的规则会被如实列为 skipped", async () => {
    const config = parseTemplateConfig({ enabledRules: ["USCC_MISSING"] });
    const outcome = await run([doc("营业执照")], config);
    expect(outcome.summary.executedRules).toEqual(["USCC_MISSING"]);
    expect(outcome.summary.skippedRules.length).toBe(REVIEW_RULES.length - 1);
    expect(outcome.summary.coverageNotes.join(" ")).toContain("跳过");
  });

  it("enabledRules 为空时执行全部规则（不静默变成「什么都不查」）", async () => {
    const config = parseTemplateConfig({ enabledRules: [] });
    const outcome = await run([doc("营业执照")], config);
    expect(outcome.summary.executedRules).toHaveLength(REVIEW_RULES.length);
    expect(outcome.summary.skippedRules).toHaveLength(0);
  });

  it("发现数触顶时截断并在覆盖度说明里如实交代", async () => {
    // 正文必须超过最小可读长度，否则会被判为"未提取到正文"而不参与有效期判定。
    const texts = Array.from({ length: 30 }, (_, index) =>
      doc(`第 ${index} 份资料的说明文字若干。\n有效期至 2020 年 1 月 1 日`, {
        id: uuidFor(index),
        label: `资料-${String(index).padStart(2, "0")}.txt`,
      }),
    );
    const outcome = await run(texts, onboarding, { maxFindings: 5 });
    expect(outcome.findings).toHaveLength(5);
    expect(outcome.summary.coverageNotes.join(" ")).toContain("未展示");
  });
});

describe("规则实现的健壮性", () => {
  it("每条规则都在空上下文下不抛错", async () => {
    for (const rule of REVIEW_RULES) {
      expect(() =>
        rule.evaluate({
          documents: [],
          config: onboarding,
          supplierName: null,
          supplierUscc: null,
          now: NOW,
        }),
      ).not.toThrow();
    }
  });

  it("每条规则都有非空的名字与说明（界面要展示给用户看）", () => {
    for (const rule of REVIEW_RULES) {
      expect(rule.label.length, `${rule.id} 缺少名字`).toBeGreaterThan(0);
      expect(rule.description.length, `${rule.id} 缺少说明`).toBeGreaterThan(0);
    }
  });

  it("REVIEW_RULES 里的每个 id 都在 RuleId 联合类型内", () => {
    const known = new Set<string>(RULE_IDS);
    for (const rule of REVIEW_RULES) expect(known.has(rule.id)).toBe(true);
  });
});

/* ================================================================== */
/* B. 真实中文 PDF 端到端                                              */
/* ================================================================== */

describe("真实中文 PDF 端到端", () => {
  async function engineOnFixture(templateKey: string, now = NOW) {
    const bytes = await readFile(FIXTURE);
    const parsed = await pdfParser.parse({
      mimeType: "application/pdf",
      size: bytes.byteLength,
      originalFilename: "供应商准入资料包-示例.pdf",
      localPath: FIXTURE,
      openStream: () => Promise.resolve(Readable.from([bytes])),
      readAll: () => Promise.resolve(new Uint8Array(bytes)),
    });

    const document = doc(parsed.text, {
      label: "供应商准入资料包-示例.pdf",
      originalFilename: "供应商准入资料包-示例.pdf",
      mimeType: "application/pdf",
      parserId: parsed.parserId,
      charCount: parsed.charCount,
      truncated: parsed.truncated,
      pageCount: parsed.pageCount ?? null,
      notes: parsed.notes,
    });

    const config = parseTemplateConfig(findBuiltinTemplate(templateKey)!.config);
    return { outcome: await runReviewEngine({ documents: [document], config, now }), parsed };
  }

  it("准入模板：报出示例资料包真正缺的两项必备资料", async () => {
    const { outcome } = await engineOnFixture("supplier-onboarding");
    const titles = findingsOf(outcome, "REQUIRED_DOCUMENT_MISSING").map((finding) => finding.title);

    expect(titles.some((title) => title.includes("开户许可证"))).toBe(true);
    expect(titles.some((title) => title.includes("纳税人资格"))).toBe(true);
    // 示例里明确给了营业执照信息、ISO 9001、CE 认证、报价单 → 不该被判缺失
    expect(titles.some((title) => title.includes("营业执照"))).toBe(false);
    expect(titles.some((title) => title.includes("ISO 9001"))).toBe(false);
    expect(titles.some((title) => title.includes("报价单"))).toBe(false);
  });

  it("示例里的占位统一社会信用代码被判为校验位错误（这正是它的用途）", async () => {
    const { outcome } = await engineOnFixture("supplier-onboarding");
    const findings = findingsOf(outcome, "USCC_INVALID");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.title).toContain("91440606MA0000000X");
    expect(findings[0]!.evidence).toBeTruthy();
  });

  it("中文大写金额与千分位小写金额一致 → 不报金额不一致", async () => {
    const { outcome } = await engineOnFixture("supplier-onboarding");
    expect(findingsOf(outcome, "AMOUNT_MISMATCH")).toHaveLength(0);
  });

  it("全角括号的企业名被完整抽出，且不会因为括号形态产生重复主体", async () => {
    const { outcome } = await engineOnFixture("supplier-onboarding");
    expect(findingsOf(outcome, "COMPANY_NAME_CONFLICT")).toHaveLength(0);
  });

  it("「报价有效期：30 个自然日」被如实标为无法判定", async () => {
    const { outcome } = await engineOnFixture("supplier-onboarding");
    const findings = findingsOf(outcome, "CERTIFICATE_EXPIRY_UNKNOWN");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.evidence ?? "").toContain("有效期");
  });

  it("把基准日推到 2027-07-01 后，三张证书全部判为已过期", async () => {
    const { outcome } = await engineOnFixture(
      "supplier-onboarding",
      new Date("2027-07-01T00:00:00.000Z"),
    );
    const expired = findingsOf(outcome, "CERTIFICATE_EXPIRED");
    // ISO 9001 与 ISO 14001 到 2027-06-30，CE 到 2026-12-31 → 三张都应判过期
    expect(expired.length).toBe(3);
    expect(expired.every((finding) => finding.severity === "CRITICAL")).toBe(true);
  });

  it("基准日为 2026-12-15 时，CE 证书落入 90 天预警窗口", async () => {
    const { outcome } = await engineOnFixture(
      "supplier-onboarding",
      new Date("2026-12-15T00:00:00.000Z"),
    );
    const soon = findingsOf(outcome, "CERTIFICATE_EXPIRING_SOON");
    expect(soon).toHaveLength(1);
    expect(soon[0]!.detail).toContain("2026-12-31");
  });

  it("完整跑通后摘要里的覆盖度、规则数与发现数互相自洽", async () => {
    const { outcome } = await engineOnFixture("supplier-onboarding");
    const summary = outcome.summary;

    expect(summary.documentCount).toBe(1);
    expect(summary.readableDocumentCount).toBe(1);
    expect(summary.totalCharacters).toBeGreaterThan(800);
    expect(summary.findingCount).toBe(outcome.findings.length);

    const total = Object.values(summary.findingsBySeverity).reduce((a, b) => a + b, 0);
    expect(total).toBe(summary.findingCount);

    const blocking = summary.findingsBySeverity.CRITICAL + summary.findingsBySeverity.HIGH;
    expect(summary.blockingCount).toBe(blocking);

    expect(summary.executedRules).toHaveLength(REVIEW_RULES.length);
    expect(summary.generatedAt).toBe(NOW.toISOString());
    expect(outcome.ai.enabled).toBe(false);
  });

  it("每一条发现都带着可复核的依据（详情非空；证据落在原文里）", async () => {
    const { outcome, parsed } = await engineOnFixture("supplier-onboarding");

    expect(outcome.findings.length).toBeGreaterThan(0);
    for (const finding of outcome.findings) {
      expect(finding.detail.trim().length, `${finding.ruleId} 详情为空`).toBeGreaterThan(0);
      expect(finding.title.trim().length).toBeGreaterThan(0);
      // 有证据的发现，证据片段必须能在原文里找到（去掉省略号后比对核心片段）
      if (finding.evidence) {
        // 摘录会把连续空白折成单个空格，因此两侧都要先归一化再比对。
        const core = finding.evidence.replace(/^…|…$/g, "").slice(0, 24);
        const haystack = parsed.text.replace(/\s+/g, " ");
        expect(
          haystack.includes(core),
          `${finding.ruleId} 的证据与原文对不上：${core}`,
        ).toBe(true);
      }
    }
  });
});

/* ================================================================== */
/* C. 降噪：这两条规则曾经无条件报 MEDIUM，                             */
/*    真实资料里几乎必然命中 —— 必须证明现在不再误报                    */
/* ================================================================== */

describe("多主体判定：降噪但不替审核员下结论", () => {
  /**
   * ⚠️ 这一组断言在第三轮被推翻过一次，改回来时请先看 rules.ts 里的注释。
   *
   * 第二版曾经实现「申报主体的代码在其中 → 不报」。它解决了误报（检测报告必带第三方代码），
   * 但顺手把**资质挂靠**这个最典型的 B2B 违规场景一起藏了：
   * 挂靠时申报主体 A 的代码**确实在文件里**（底部的印章或"代办方"行），
   * 而真正的资质主体是 B。闸门成立 → 不报 → 致命风险被静默放过。
   *
   * 现在的立场：**系统没有能力判断资质归属，就不该假装能判断。**
   * 降噪改在文案里做（说清哪些情况正常），发现本身必须报出来。
   */
  const DECLARED = "914403001922038216";
  const THIRD_PARTY = "91110108100010001X";

  it("申报主体的代码在资料里时**仍然要报**，但级别为 LOW 且说明含申报主体", async () => {
    // 一份检测报告上必然印着检测机构的代码 —— 这是最常见的情况，不能因为常见就不报。
    const text = `本公司统一社会信用代码：${DECLARED}。检测机构统一社会信用代码：${THIRD_PARTY}。`;
    const outcome = await run([doc(text)], onboarding, { supplierUscc: DECLARED });

    const findings = findingsOf(outcome, "USCC_MULTIPLE");
    expect(findings.length).toBe(1);
    expect(findings[0]!.severity).toBe("LOW");
    expect(findings[0]!.detail).toContain("包含申报主体");
    // 必须把「挂靠」这个可能性明确说出来，否则审核员不知道该往哪个方向核实
    expect(findings[0]!.detail).toContain("挂靠");
  });

  it("资质挂靠场景必须报出来（这是第二版被藏掉的场景）", async () => {
    // 真正的资质主体是 B（开户信息里的那家），申报主体 A 只出现在底部的代办方行。
    const text =
      `【银行基本存款账户信息】开户名称：远方工程建设有限公司。` +
      `统一社会信用代码：${THIRD_PARTY}。` +
      `……（底部印章文字）代办方：甲方案例制造有限公司，代码：${DECLARED}。`;
    const outcome = await run([doc(text)], onboarding, { supplierUscc: DECLARED });

    const findings = findingsOf(outcome, "USCC_MULTIPLE");
    expect(findings.length).toBe(1);
    expect(findings[0]!.recommendation).toContain("挂靠");
  });

  it("申报主体的代码不在资料里时仍然报，且级别降为 LOW", async () => {
    const text = `甲方统一社会信用代码：914403001922038216。乙方统一社会信用代码：${THIRD_PARTY}。`;
    const outcome = await run([doc(text)], onboarding, { supplierUscc: "91110000100010002Y" });

    const findings = findingsOf(outcome, "USCC_MULTIPLE");
    expect(findings.length).toBe(1);
    expect(findings[0]!.severity).toBe("LOW");
    expect(findings[0]!.detail).toContain("检测机构");
  });

  it("未关联供应商时仍报（此时确实说不清归属）", async () => {
    const text = `甲方统一社会信用代码：914403001922038216。乙方统一社会信用代码：${THIRD_PARTY}。`;
    const outcome = await run([doc(text)]);

    expect(findingsOf(outcome, "USCC_MULTIPLE").length).toBe(1);
  });

  it("资料里出现客户抬头时**仍然要报**，但级别 LOW 且说明含申报主体", async () => {
    // 报价单上必然有客户名 —— 常见不等于不用看，挂靠时申报主体同样会出现在抬头里。
    const text = "供方：示例精密五金制造（佛山）有限公司\n需方：远方工程建设有限公司\n";
    const outcome = await run([doc(text)], onboarding, {
      supplierName: "示例精密五金制造（佛山）有限公司",
    });

    const findings = findingsOf(outcome, "COMPANY_NAME_CONFLICT");
    expect(findings.length).toBe(1);
    expect(findings[0]!.severity).toBe("LOW");
    expect(findings[0]!.detail).toContain("包含申报主体");
  });

  it("申报主体名称不在资料里时仍然报，级别为 LOW", async () => {
    const text = "供方：甲方案例制造有限公司\n需方：远方工程建设有限公司\n";
    const outcome = await run([doc(text)], onboarding, { supplierName: "示例精密五金制造有限公司" });

    const findings = findingsOf(outcome, "COMPANY_NAME_CONFLICT");
    expect(findings.length).toBe(1);
    expect(findings[0]!.severity).toBe("LOW");
  });
});

/* ================================================================== */
/* D. 「长期有效」—— 中国营业执照的高频写法                             */
/* ================================================================== */

describe("证照有效期的「长期」语义", () => {
  /**
   * ⚠️ 第二版这里还有 `***` 和 `——`，第三版**删掉了**。
   *
   * 反例（见 extract.ts 的 LONG_TERM_PATTERN 注释）：
   *   法定代表人身份证号：*** 有效期至：2026-10-05
   * `***` 是脱敏打码，不是期限。把它当长期，会让"长期项不计入未判定"这条规则
   * 把真实的期限告警静默吞掉 —— 一份明明带着明确有效期的资料被判成"不用看"。
   * 只保留明确的自然语言语义；宁可报「无法判定」，也不要猜成「长期」。
   */
  const cases = ["长期", "长期有效", "永久", "无固定期限", "不限期", "不设定"];

  for (const wording of cases) {
    it(`「有效期：${wording}」不报「无法判定」`, async () => {
      const text = `营业执照\n统一社会信用代码：914403001922038216\n有效期：${wording}`;
      const outcome = await run([doc(text)]);

      expect(findingsOf(outcome, "CERTIFICATE_EXPIRY_UNKNOWN")).toHaveLength(0);
      expect(findingsOf(outcome, "CERTIFICATE_EXPIRED")).toHaveLength(0);
    });
  }

  it("脱敏打码的 *** 不再被当成「长期」", () => {
    // 直接验证抽取层：这是 Q5 反例的最小复现
    expect(findLongTermMarkers("法定代表人身份证号：*** 有效期至：2026-10-05")).toEqual([]);
  });

  it("占位符导致的期限缺失，仍然要报「无法判定」（不能被长期项静默拦截）", async () => {
    const text = "法定代表人身份证号：***\n资质证书有效期：***";
    const outcome = await run([doc(text)]);

    expect(findingsOf(outcome, "CERTIFICATE_EXPIRY_UNKNOWN").length).toBe(1);
  });

  it("真正的相对期限（30 个自然日）仍然要报", async () => {
    const text = "报价有效期：自报价日起 30 个自然日";
    const outcome = await run([doc(text)]);

    expect(findingsOf(outcome, "CERTIFICATE_EXPIRY_UNKNOWN").length).toBe(1);
  });

  it("长期与真日期并存时，只对真日期判定，且在详情里说明长期项", async () => {
    const text = "营业执照有效期：长期\nISO 9001 有效期至 2026-10-05";
    const outcome = await run([doc(text)]);

    // 2026-10-05 距基准日 2026-09-27 剩 8 天，落在 90 天预警窗口内
    const expiring = findingsOf(outcome, "CERTIFICATE_EXPIRING_SOON");
    expect(expiring.length).toBe(1);

    const unknown = findingsOf(outcome, "CERTIFICATE_EXPIRY_UNKNOWN");
    expect(unknown).toHaveLength(0);
  });
});

/* ================================================================== */
/* E. 正则不能把主线程打死                                             */
/* ================================================================== */

describe("大文本下的正则行为", () => {
  /**
   * 1 MB 中文字符、且刻意塞满「有效期」标记与形似企业名的串 ——
   * 这是灾难性回溯最容易被引爆的输入形状。
   * 阈值取 10 秒（正常应远低于此），目的是**卡住**而不是精确计时。
   */
  it("1 MB 文本上的抽取在 10 秒内完成，不锁死主线程", () => {
    const unit = "有效期至 2027 年 12 月 31 日，示例精密五金制造（佛山）有限公司，金额 ¥175,000.00。";
    const text = unit.repeat(Math.ceil(1_000_000 / unit.length));

    const started = Date.now();
    findExpiryWindows(text);
    findLongTermMarkers(text);
    findCompanyNames(text);
    const elapsed = Date.now() - started;

    expect(elapsed, `抽取耗时 ${elapsed} 毫秒`).toBeLessThan(10_000);
  });
});
