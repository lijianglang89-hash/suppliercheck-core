import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MOCK_DISCLAIMER, MockAIProvider } from "@/lib/ai/providers/mock";

/**
 * 这组测试守护的是需求「十六、不要制造假 AI」：
 * Mock 必须在每个返回值上标注 mock: true，并且在无法诚实产出结果时抛错，
 * 而不是编造一份看起来很像真的分析。
 */
describe("MockAIProvider", () => {
  const provider = new MockAIProvider();

  it("声明自己是 mock，供 UI 展示演示标记", () => {
    expect(provider.isMock).toBe(true);
    expect(provider.id).toBe("mock");
  });

  it("generateText 返回明确标注的开发占位文本", async () => {
    const result = await provider.generateText({ prompt: "帮我审核这份资料" });

    expect(result.mock).toBe(true);
    expect(result.text).toContain("开发占位");
    expect(result.text).toContain(MOCK_DISCLAIMER);
  });

  it("generateStructuredOutput 在没有 fixture 时抛错，而不是编造数据", async () => {
    const schema = z.object({ companyName: z.string() });

    await expect(
      provider.generateStructuredOutput({ prompt: "提取公司名", schema }),
    ).rejects.toThrow(/拒绝/);
  });

  it("提供了 fixture 时按 schema 校验后返回", async () => {
    const schema = z.object({ companyName: z.string() });
    const withFixture = new MockAIProvider({
      structuredFixtures: { "提取公司名": { companyName: "某某科技有限公司" } },
    });

    const result = await withFixture.generateStructuredOutput({ prompt: "提取公司名", schema });
    expect(result.mock).toBe(true);
    expect(result.data.companyName).toBe("某某科技有限公司");
  });

  it("fixture 不符合 schema 时抛错", async () => {
    const schema = z.object({ companyName: z.string() });
    const bad = new MockAIProvider({ structuredFixtures: { "x": { companyName: 123 } } });

    await expect(bad.generateStructuredOutput({ prompt: "x", schema })).rejects.toThrow(/schema/);
  });

  it("classify 不做猜测：落到 Other 且置信度为 0", async () => {
    const result = await provider.classify({
      text: "你们是否通过了 ISO 27001 认证？",
      labels: ["Security", "Compliance", "Other"],
    });

    expect(result.mock).toBe(true);
    expect(result.label).toBe("Other");
    expect(result.confidence).toBe(0);
  });

  it("extractEntities 返回空集，不假装抽到了实体", async () => {
    const result = await provider.extractEntities({
      text: "统一社会信用代码：91310000MA1K35XXXX",
      entityTypes: ["credit_code", "company_name"],
    });

    expect(result.mock).toBe(true);
    expect(result.entities).toEqual([]);
  });

  it("analyzeEvidence 返回空结论并附带免责说明", async () => {
    const result = await provider.analyzeEvidence({
      question: "供应商是否具备数据加密能力？",
      evidence: [{ id: "e1", text: "我们使用 AES-256 加密" }],
    });

    expect(result.mock).toBe(true);
    expect(result.conclusion).toBe("");
    expect(result.confidence).toBe(0);
    expect(result.citations).toEqual([]);
    expect(result.notes).toBe(MOCK_DISCLAIMER);
  });
});
