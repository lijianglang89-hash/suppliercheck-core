/**
 * 品牌静态资产的守卫测试。
 *
 * 守两件事：
 *
 * 1. **OG 图上的数字必须与代码一致。** 分享图是静态 PNG，文案写在
 *    scripts/brand/og.html 里 —— 一旦规则条数或支持格式变了而图没重出，
 *    对外发出的就是一句假话，而且这种假话藏在图片里，没人会去核对。
 *    所以这里把「图里写了什么」和「代码里是什么」直接绑在一起。
 *
 * 2. **资产文件不能缺、不能超限。** OG 图必须 1200×630 且 < 1MB
 *    （各平台抓取的上限），favicon 三件套必须都在；
 *    缺了任何一个，分享出去就是缺省图或白板 —— 前面的视觉控制在点开前就漏光了。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ALLOWED_MIME_TYPES } from "@/lib/files";
import { CATEGORY_LABELS } from "@/lib/reviews/labels";
import { REVIEW_RULES } from "@/lib/reviews/rules";
import { siteConfig } from "@/lib/site";

const ROOT = process.cwd();
const OG_HTML = path.resolve(ROOT, "scripts/brand/og.html");
const OG_PNG = path.resolve(ROOT, "public/og-image.png");

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
