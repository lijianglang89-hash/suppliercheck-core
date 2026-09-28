/**
 * 品牌静态资产的守卫测试。
 *
 * 守三件事：
 *
 * 1. **OG 图上的数字必须与代码一致。** 分享图是静态 PNG，文案写在
 *    scripts/brand/og.html 里 —— 一旦规则条数或支持格式变了而图没重出，
 *    对外发出的就是一句假话，而且这种假话藏在图片里，没人会去核对。
 *    所以这里把「图里写了什么」和「代码里是什么」直接绑在一起。
 *
 * 2. **「系统不下判定」这条硬规则要落到每一处会渲染状态文字的界面上。**
 *    同一条规则在同一天被违反过两次：一次在 OG 图里，一次在首页能力区的
 *    维度卡片上（STATUS_STYLE 的 `pass → 通过`，还配了绿色）。两处都是
 *    "看着像界面截图所以没人读文案"的地方 —— 所以两处都钉死。
 *
 * 3. **资产文件不能缺、不能超限。** OG 图必须 1200×630 且 < 1MB
 *    （各平台抓取的上限），favicon 三件套必须都在；
 *    缺了任何一个，分享出去就是缺省图或白板 —— 前面的视觉控制在点开前就漏光了。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { STATUS_STYLE } from "@/components/landing/visuals";
import { ALLOWED_MIME_TYPES } from "@/lib/files";
import { CATEGORY_LABELS, SEVERITY_LABELS } from "@/lib/reviews/labels";
import { REVIEW_RULES } from "@/lib/reviews/rules";
import { siteConfig } from "@/lib/site";

const ROOT = process.cwd();
const OG_HTML = path.resolve(ROOT, "scripts/brand/og.html");
const OG_PNG = path.resolve(ROOT, "public/og-image.png");

/**
 * 逐项结论用词 —— 系统只在规则命中时产出发现，从不产出「某份资料已通过」。
 * 这份表同时守着 OG 图和页面组件，新增受守卫的面时复用它，不要另抄一份。
 */
const FORBIDDEN_VERDICT_WORDS = ["通过", "待确认", "问题"] as const;

describe("OG 分享图文案与代码一致", () => {
  it("规则条数 / 支持格式数 / 版本号取自同一份事实", async () => {
    const html = await readFile(OG_HTML, "utf8");
    expect(html).toContain(`${REVIEW_RULES.length} 条确定性规则`);
    expect(html).toContain(`${Object.keys(ALLOWED_MIME_TYPES).length} 种文件格式`);
    expect(html).toContain(`${REVIEW_RULES.length} 条规则逐条核对`);
    // 版本号只在这里当一个「别写成别的值」的提醒；真值以 siteConfig 为准。
    expect(siteConfig.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("列出的检查维度全部是真实维度，且不含未启用的 AI 复核", async () => {
    const html = await readFile(OG_HTML, "utf8");
    for (const [key, label] of Object.entries(CATEGORY_LABELS)) {
      if (key === "AI") {
        // AI 复核尚未启用，不能出现在对外物料里 —— 出现就是宣传不存在的能力。
        expect(html).not.toContain(label);
        continue;
      }
      expect(html).toContain(label);
    }
  });

  it("示例界面必须自己声明是示例", async () => {
    const html = await readFile(OG_HTML, "utf8");
    expect(html).toContain("示例数据");
    expect(html).toContain("不代表任何真实审核结果");
  });

  it("分享图上不得出现「通过 / 待确认 / 问题」这类逐项结论", async () => {
    /*
     * 系统只在规则命中时产出发现，**从不产出「某份资料已通过」的正面结论**。
     * 分享图上画一行「通过」，等于替系统宣布一件它从不宣布的事 ——
     * 而且它在图片里，没人会去核对（2026-09-28 实测：旧版 OG 面板正是这么画的）。
     *
     * 注释要先剥掉：设计稿里用注释解释了这条规则本身，注释里当然会写到这些词。
     */
    const html = await readFile(OG_HTML, "utf8");
    const visible = html.replace(/<!--[\s\S]*?-->/g, "");
    for (const word of FORBIDDEN_VERDICT_WORDS) {
      expect(visible, `分享图的可见内容里出现了逐项结论用词：${word}`).not.toContain(word);
    }
  });

  it("分享图里的严重级别标签与 SEVERITY_LABELS 同源", async () => {
    const html = await readFile(OG_HTML, "utf8");
    const visible = html.replace(/<!--[\s\S]*?-->/g, "");
    // 面板上出现的级别标签，必须是代码里真实存在的级别词，不能自造「重要 / 次要」这类说法。
    const used = ["严重", "高", "中", "低"];
    const known = new Set(Object.values(SEVERITY_LABELS));
    for (const label of used) {
      expect(known.has(label), `OG 图用了不存在的严重级别标签：${label}`).toBe(true);
      expect(visible).toContain(label);
    }
  });
});

/**
 * 「系统不下判定」这条硬规则在**页面组件**上的守卫。
 *
 * 起因：2026-09-28 首页能力区左侧的维度卡片，五个状态徽章写的是
 * 「问题 / 待确认 / 待确认 / 待确认 / 通过」，其中「通过」还是绿色 success 底。
 * 它与 OG 图里那处是同一个错误 —— 系统只输出发现，从不输出通过项，
 * 而这块因为在视觉上像"界面截图"，文案没人读。
 */
describe("页面状态文案不得下判定", () => {
  it("维度状态标签不含逐项结论用词，且 clear 不用 success 绿", () => {
    for (const [key, style] of Object.entries(STATUS_STYLE)) {
      for (const word of FORBIDDEN_VERDICT_WORDS) {
        expect(style.label, `状态 ${key} 的标签用了逐项结论用词：${word}`).not.toContain(word);
      }
    }
    // 「本次没命中规则」不能画成绿灯 —— 绿徽章在这一屏会被读成"这份资料通过了"。
    expect(STATUS_STYLE.clear.className).not.toContain("success");
  });

  it("首页源码里没有把逐项结论写成独立文案", async () => {
    /*
     * 扫的是**完整字符串字面量**（"通过"），不是子串包含 ——
     * 「通过工作区隔离」「通过 API 上传」都是正常用法，不能误伤。
     * 真正要拦的是 `label: "通过"` 这种把结论当成一个独立词用的写法。
     */
    const files = [
      "components/landing/visuals.tsx",
      "components/landing/sections.tsx",
      "components/landing/scenarios-section.tsx",
      "components/landing/evidence-chain-section.tsx",
      "components/landing/trust-center-section.tsx",
      "app/page.tsx",
    ];
    for (const relative of files) {
      const source = await readFile(path.resolve(ROOT, relative), "utf8");
      // 注释里会解释这条规则本身，先剥掉行注释与块注释
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const word of FORBIDDEN_VERDICT_WORDS) {
        const pattern = new RegExp(`["'\`]${word}["'\`]`);
        expect(pattern.test(code), `${relative} 里出现了独立文案 "${word}"`).toBe(false);
      }
    }
  });
});

describe("品牌资产文件", () => {
  it("OG 图是 1200×630 且小于 1MB", async () => {
    const buffer = await readFile(OG_PNG);
    expect(buffer.length).toBeLessThan(1024 * 1024);

    // PNG 头部取宽高，避免为了一个断言把 sharp 拉进测试依赖。
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    expect(width).toBe(1200);
    expect(height).toBe(630);
  });

  it.each([
    "public/favicon.ico",
    "public/apple-touch-icon.png",
    "public/icon-192.png",
    "public/icon-512.png",
    "public/manifest.webmanifest",
    "app/icon.svg",
  ])("%s 存在且非空", async (relative) => {
    const buffer = await readFile(path.resolve(ROOT, relative));
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("apple-touch-icon 是 180×180（iOS 桌面书签的规格）", async () => {
    const buffer = await readFile(path.resolve(ROOT, "public/apple-touch-icon.png"));
    expect(buffer.readUInt32BE(16)).toBe(180);
    expect(buffer.readUInt32BE(20)).toBe(180);
  });
});
