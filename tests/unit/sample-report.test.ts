/**
 * 示例报告（/sample-report）的守卫测试。
 *
 * 这一页是转化链路里最靠前的一环，也是**最容易被写成"演示专用版本"**的地方：
 * 一旦示例里的规则名、严重级别、天数与真实引擎不一致，客户注册后跑出来的东西
 * 和他看到的不是同一个 —— 那就是典型的"买家秀与卖家秀"。
 *
 * 所以这里把示例**钉在真实规则上**：
 *   - ruleId 必须存在；
 *   - category 必须等于该规则的真实类别；
 *   - severity 必须等于该规则的默认级别；
 *   - 涉及日期的结论必须与写死的判定基准日算得一致。
 */
import { describe, expect, it } from "vitest";

import { SAMPLE_REPORT } from "@/lib/content/sample-report";
import { REVIEW_RULES } from "@/lib/reviews/rules";

const RULE_BY_ID = new Map(REVIEW_RULES.map((rule) => [rule.id, rule]));
const DAY = 24 * 60 * 60 * 1000;

describe("示例报告与真实规则一致", () => {
  it("引用的每条规则都真实存在", () => {
    expect(SAMPLE_REPORT.findings.length).toBeGreaterThan(0);
    for (const finding of SAMPLE_REPORT.findings) {
      expect(RULE_BY_ID.has(finding.ruleId), `示例引用了不存在的规则 ${finding.ruleId}`).toBe(true);
    }
  });

  it("类别与严重级别等于规则的真实定义", () => {
    for (const finding of SAMPLE_REPORT.findings) {
      const rule = RULE_BY_ID.get(finding.ruleId)!;
      expect(finding.category, `${finding.ruleId} 的类别与规则定义不一致`).toBe(rule.category);
      expect(finding.severity, `${finding.ruleId} 的严重级别与规则默认不一致`).toBe(
        rule.defaultSeverity,
      );
    }
  });

  it("每条发现都有可复算的判据（详情非空）", () => {
    for (const finding of SAMPLE_REPORT.findings) {
      expect(finding.detail.length).toBeGreaterThan(10);
      expect(finding.recommendation.length).toBeGreaterThan(5);
    }
  });

  it("有效期结论与写死的判定基准日算得一致", () => {
    const base = Date.parse(`${SAMPLE_REPORT.baseDate}T00:00:00Z`);
    expect(Number.isNaN(base)).toBe(false);

    const expired = SAMPLE_REPORT.findings.find((f) => f.ruleId === "CERTIFICATE_EXPIRED")!;
    const expiredEnd = Date.parse("2026-08-15T00:00:00Z");
    const overdueDays = Math.round((base - expiredEnd) / DAY);
    expect(expired.detail).toContain(`${overdueDays} 天`);

    const expiring = SAMPLE_REPORT.findings.find((f) => f.ruleId === "CERTIFICATE_EXPIRING_SOON")!;
    const expiringEnd = Date.parse("2026-11-20T00:00:00Z");
    const leftDays = Math.round((expiringEnd - base) / DAY);
    expect(expiring.detail).toContain(`${leftDays} 天`);
    // 临期必须在预警阈值内，否则这条示例本身就不成立。
    expect(leftDays).toBeLessThanOrEqual(SAMPLE_REPORT.expiryWarningDays);
  });

  it("预警阈值取自真实内置模板配置", async () => {
    const { BUILTIN_TEMPLATES } = await import("@/lib/templates/builtin");
    const template = BUILTIN_TEMPLATES.find((t) => t.name === SAMPLE_REPORT.templateName);
    expect(template, `示例用的模板「${SAMPLE_REPORT.templateName}」不存在`).toBeDefined();
    expect(SAMPLE_REPORT.expiryWarningDays).toBe(template!.config.expiryWarningDays);
  });

  it("示例主体是中性名，不指向真实企业", () => {
    expect(SAMPLE_REPORT.supplierName).toContain("示例");
  });

  /**
   * 这三个数字会被**首页首屏**直接渲染（ReviewWorkspacePreview 的数字条），
   * 因此它们的不自洽不再是"示例页的小瑕疵"，而是首页在说一个可验证的错数字。
   *
   * 起因：落地页要放大展示资料清单时才发现，documentCount 写的是 5，
   * 而 findings 里实际引用了 6 份文件 —— 手抄的数字迟早和真实内容分家。
   * 现在清单是唯一来源，这三个断言把三者钉在一起。
   */
  it("资料份数与清单、与发现引用的文件自洽", () => {
    expect(SAMPLE_REPORT.documentCount).toBe(SAMPLE_REPORT.documents.length);
    expect(SAMPLE_REPORT.readableDocumentCount).toBe(
      SAMPLE_REPORT.documents.filter((document) => !document.note).length,
    );
    expect(SAMPLE_REPORT.readableDocumentCount).toBeLessThan(SAMPLE_REPORT.documentCount);

    // findings 里出现的每一个文件名，都必须在资料清单里找得到（缺失类发现除外）。
    const known = new Set(SAMPLE_REPORT.documents.map((document) => document.name));
    for (const finding of SAMPLE_REPORT.findings) {
      if (!finding.documentLabel) continue; // 缺失类发现没有来源文件
      for (const name of finding.documentLabel.split(" / ")) {
        expect(known.has(name), `发现引用了资料包里不存在的文件：${name}`).toBe(true);
      }
    }
  });
});
