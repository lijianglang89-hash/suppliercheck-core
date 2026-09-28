/**
 * 业务场景内容（首页 `#scenarios`）的守卫测试。
 *
 * 守两件事：
 *
 * 1. **每个场景必须落在真实规则上。** `ruleIds` 的类型已经是 `RuleId`，
 *    但那条防线只在「写了一个不存在的编号」时生效；真正难防的是
 *    「编号存在、但和这个场景其实无关」—— 那会让人拿一个真实编号
 *    去支撑一句它并不支撑的话。所以这里还要断言每个场景至少引用 1 条规则，
 *    且全部落在 REVIEW_RULES 里（而不是只落在 RULE_IDS 里，
 *    后者包含未启用的 AI_REVIEW）。
 *
 * 2. **字段不能是空壳。** 「谁在做 / 什么时候 / 系统做什么 / 拿到什么」
 *    四格只要有一格空着，这一格就退化成装饰 —— 页面看着满，读者拿不到信息。
 */
import { describe, expect, it } from "vitest";

import { BUSINESS_SCENARIOS, SCENARIO_COVERED_RULES } from "@/lib/content/scenarios";
import { REVIEW_RULES } from "@/lib/reviews/rules";

/** 已上线的确定性规则编号。刻意不用 RULE_IDS —— 那个集合里还有未启用的 AI_REVIEW。 */
const ACTIVE_RULE_IDS = new Set(REVIEW_RULES.map((rule) => rule.id));

describe("业务场景内容", () => {
  it("场景 id 唯一、数量在 4~6 之间（低于 4 撑不起一区，高于 6 读者扫不完）", () => {
    const ids = BUSINESS_SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BUSINESS_SCENARIOS.length).toBeGreaterThanOrEqual(4);
    expect(BUSINESS_SCENARIOS.length).toBeLessThanOrEqual(6);
  });

  it.each(BUSINESS_SCENARIOS.map((scenario) => [scenario.id, scenario] as const))(
    "%s：四格信息齐全且不为空壳",
    (_id, scenario) => {
      expect(scenario.title.length).toBeGreaterThanOrEqual(4);
      expect(scenario.role.trim().length).toBeGreaterThan(0);
      expect(scenario.trigger.trim().length).toBeGreaterThan(10);
      expect(scenario.outcome.trim().length).toBeGreaterThan(10);
      expect(scenario.steps.length).toBeGreaterThanOrEqual(2);
      for (const step of scenario.steps) {
        expect(step.trim().length).toBeGreaterThan(10);
      }
    },
  );

  it.each(BUSINESS_SCENARIOS.map((scenario) => [scenario.id, scenario] as const))(
    "%s：引用的规则都是已上线的确定性规则",
    (_id, scenario) => {
      expect(scenario.ruleIds.length).toBeGreaterThan(0);
      for (const ruleId of scenario.ruleIds) {
        expect(
          ACTIVE_RULE_IDS.has(ruleId),
          `场景引用了不存在的规则：${ruleId}`,
        ).toBe(true);
      }
    },
  );

  it("场景之间不重复引用同一条规则以外的内容 —— 覆盖规则清单是去重后的并集", () => {
    const expected = [...new Set(BUSINESS_SCENARIOS.flatMap((s) => s.ruleIds))];
    expect([...SCENARIO_COVERED_RULES]).toEqual(expected);
    expect(new Set(SCENARIO_COVERED_RULES).size).toBe(SCENARIO_COVERED_RULES.length);
  });

  it("覆盖的规则不超过规则总数的 15 条（场景是入口，不是全量清单）", () => {
    expect(SCENARIO_COVERED_RULES.length).toBeLessThanOrEqual(ACTIVE_RULE_IDS.size);
    expect(SCENARIO_COVERED_RULES.length).toBeLessThan(ACTIVE_RULE_IDS.size);
  });
});
