/**
 * 公开内容页（/templates/[slug]）的守卫测试。
 *
 * 守的是两件「不做就一定会漂」的事：
 *
 * 1. **内容不能是空壳。** 内容农场式的页面特征是"条目有标题、没有实质"，
 *    所以这里强制每一项必须有查验要点与雷区 —— 只写"检查营业执照"
 *    这种等于没说的话，编译期就过不去。
 *
 * 2. **内容必须与产品定义一致。** 清单里标的「必备 / 选备」、
 *    引用的规则 id、关联的内置模板，都必须能在代码里找到对应物。
 *    写错规则 id 不会报错，只会在页面上显示一串大写英文 —— 这种静默失败
 *    在 SEO 页面上代价极高（爬虫抓到的是一串无意义的 token）。
 */
import { describe, expect, it } from "vitest";

import { CHECKLIST_TEMPLATES } from "@/lib/content/checklist-templates";
import { REVIEW_RULES } from "@/lib/reviews/rules";
import { BUILTIN_TEMPLATES } from "@/lib/templates/builtin";

const RULE_IDS = new Set(REVIEW_RULES.map((rule) => rule.id));

describe("内容页数据完整性", () => {
  it("至少有一份清单，slug 唯一且为 URL 安全形态", () => {
    expect(CHECKLIST_TEMPLATES.length).toBeGreaterThan(0);
    const slugs = CHECKLIST_TEMPLATES.map((template) => template.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("标题长度在 JSON-LD headline 的限制内（≤110 字符）", () => {
    for (const template of CHECKLIST_TEMPLATES) {
      expect(template.title.length).toBeLessThanOrEqual(110);
      expect(template.title.length).toBeGreaterThan(8);
    }
  });

  it.each(CHECKLIST_TEMPLATES.map((t) => [t.slug, t] as const))(
    "%s 每一条都有可执行的查验要点与雷区",
    (_slug, template) => {
      expect(template.items.length).toBeGreaterThan(0);
      for (const item of template.items) {
        expect(item.check.length, `${item.name} 缺查验要点`).toBeGreaterThan(0);
        expect(item.pitfalls.length, `${item.name} 缺雷区`).toBeGreaterThan(0);
        // 「检查 XX」这种只有动作没有标准的条目会被这里拦下。
        for (const point of item.check) {
          expect(point.length).toBeGreaterThan(6);
        }
        for (const point of item.pitfalls) {
          expect(point.length).toBeGreaterThan(6);
        }
      }
    },
  );

  it.each(CHECKLIST_TEMPLATES.map((t) => [t.slug, t] as const))(
    "%s 引用的规则 id 在 REVIEW_RULES 里真实存在",
    (_slug, template) => {
      for (const item of template.items) {
        expect(item.ruleIds.length).toBeGreaterThan(0);
        for (const ruleId of item.ruleIds) {
          expect(RULE_IDS, `${item.name} 引用了不存在的规则 ${ruleId}`).toContain(ruleId);
        }
      }
    },
  );

  it.each(CHECKLIST_TEMPLATES.map((t) => [t.slug, t] as const))(
    "%s 的必备标记与内置审核模板一致",
    (_slug, template) => {
      const builtin = BUILTIN_TEMPLATES.find((t) => t.key === template.builtinTemplateKey);
      expect(builtin, `关联的内置模板 ${template.builtinTemplateKey} 不存在`).toBeDefined();

      const docs = new Map(builtin!.config.requiredDocuments.map((doc) => [doc.key, doc]));
      for (const item of template.items) {
        const doc = docs.get(item.key);
        expect(doc, `清单项 ${item.key} 在内置模板里没有对应资料`).toBeDefined();
        // 页面上写「必备」而产品里其实按选备处理，是直接的误导。
        expect(item.required, `${item.name} 的必备标记与内置模板不一致`).toBe(doc!.required);
      }
    },
  );

  it("收尾必须声明判定权边界", () => {
    for (const template of CHECKLIST_TEMPLATES) {
      expect(template.closing.length).toBeGreaterThan(0);
      expect(template.closing.join("")).toContain("判定");
    }
  });
});
