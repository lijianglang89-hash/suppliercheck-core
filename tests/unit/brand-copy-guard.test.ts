/**
 * 公开渲染层的文案与品牌守卫（V2.2 探针 #2 / Gemini Q6 工程化）。
 *
 * 起因：V2.2 全程靠**手工 grep** 验证「SupplierCheck 零残留、演示数据标识常驻、
 * 零虚构营销词」。手工检查只保当时，自动化断言才保永久 —— 本文件把那组手工探针
 * 固化进常规 `npm test`，未来任何页面更新或依赖升级，无意中破坏真实性纪律与品牌
 * 规范时会在 CI 里直接红。
 *
 * 扫描切面（2026-09-28 recon 实测确定，零误报）：
 *   - **渲染层目录**：app/**（含 API 响应——对外可见）、components/**、lib/content/**；
 *   - **喂给界面的常量文件**：lib/site.ts、lib/reviews/labels.ts（字符串会直接渲染）。
 *   `suppliercheck` 作为技术标识合法存在于 lib/site.ts 注释、lib/storage/signature.ts
 *   的 HMAC 域分隔串、package.json、测试夹具 —— 这些都**不在**扫描面内，因此
 *   「渲染层源码（剥注释后）恒为 0」是当前事实，也应该是永久事实。
 *
 * 断言纪律（沿用 brand-assets.test.ts 的先例，避免误伤）：
 *   - **剥注释后扫描**：设计意图写在注释里的词（「不写准确率 99.9%」）不该被拦；
 *   - **营销词必须绑定承诺形态**：「准确率」不能裸禁 —— 信任中心的可见文案
 *     「也没有准确率…因为它们目前都无法验证」是诚实的边界声明，禁子串会把它误杀。
 *     所以每条违禁词都写成「承诺 + 数字 / 独立词」的形态（详见 FORBIDDEN_CLAIM_PATTERNS）；
 *   - 行注释只剥「整行注释」、不剥行尾 `//`：避免误伤字符串里的 `https://`。
 *     代价是行尾注释里的违禁词会进入扫描 —— 这是**保守方向**（宁可人工看一眼，不漏拦截）。
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

const RENDER_DIRS = ["app", "components", "lib/content"];
const RENDER_FILES = ["lib/site.ts", "lib/reviews/labels.ts"];

/** 递归收集目录下的 .ts/.tsx（手动递归，不依赖 readdir recursive 的版本差异）。 */
async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** 块注释全剥；行注释只剥「整行注释」（行首若干空白后紧跟 //）。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

interface RenderedSource {
  /** 相对仓库根的路径，用于失败信息定位。 */
  relative: string;
  /** 剥注释后的代码文本。 */
  code: string;
}

let cachedSources: RenderedSource[] | null = null;

async function renderedSources(): Promise<RenderedSource[]> {
  if (cachedSources) return cachedSources;

  const files: string[] = [];
  for (const dir of RENDER_DIRS) {
    files.push(...(await walk(path.resolve(ROOT, dir))));
  }
  files.push(...RENDER_FILES.map((relative) => path.resolve(ROOT, relative)));

  cachedSources = await Promise.all(
    files.map(async (absolute) => ({
      relative: path.relative(ROOT, absolute).replace(/\\/g, "/"),
      code: stripComments(await readFile(absolute, "utf8")),
    })),
  );
  return cachedSources;
}

/**
 * 虚构承诺 / 不存在能力的违禁形态。
 * 每条都绑定「承诺 + 数字」或独立词，不裸禁关键词 ——
 * 诚实的边界声明（「没有准确率」「不放提升 xx%」）必须能存活。
 */
const FORBIDDEN_CLAIM_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "准确率数字承诺（如「准确率 99.9%」）", pattern: /准确率\D{0,8}\d/ },
  // 渲染层不需要任何字面 100%：Tailwind 写满宽用 w-full，不写 style="100%"。
  { label: "100% 承诺", pattern: /100\s*%/ },
  { label: "ROI", pattern: /ROI/i },
  // 诚实声明写的是「提升 xx%」（无数字），不会被此模式命中。
  { label: "提升 N% / N% 提升", pattern: /(提升\s*\d|\d\s*%提升)/ },
  { label: "秒出（无实测支撑的耗时承诺）", pattern: /秒出/ },
  { label: "成功率", pattern: /成功率/ },
  { label: "零误报", pattern: /零误报/ },
  { label: "一键导出（不存在的功能）", pattern: /一键导出/ },
  { label: "团队协作（不存在的功能）", pattern: /团队协作/ },
];

describe("渲染层品牌守卫：拉丁名 SupplierCheck 零残留", () => {
  it("★ app/ components/ lib/content/（+ site/labels 常量）剥注释后 suppliercheck 恒为 0", async () => {
    const sources = await renderedSources();
    expect(sources.length).toBeGreaterThan(50); // 扫描面本身必须非空，防止目录挪走后守卫空转

    const violations = sources.filter((source) => /suppliercheck/i.test(source.code));
    expect(
      violations.map((source) => source.relative),
      "渲染层源码出现了拉丁名 —— 对客只此一份的中文名是「企智审」，SupplierCheck 已废弃（技术标识只许出现在 site.ts 注释 / 签名域串 / 部署资产）",
    ).toEqual([]);
  });
});

describe("渲染层真实性守卫：演示数据标识必须常驻", () => {
  it("★ /sample-report 顶部「演示数据 · 非真实客户项目」不可被删", async () => {
    const code = stripComments(
      await readFile(path.resolve(ROOT, "app/sample-report/page.tsx"), "utf8"),
    );
    expect(code).toContain("演示数据 · 非真实客户项目");
    // 同一句的后半段：边界声明必须与标识同在，只有标识没有边界等于只喊口号。
    expect(code).toContain("不代表任何真实供应商审核结果");
  });

  it("★ 首页「企智审审核示例」区必须自带演示数据标识", async () => {
    const code = stripComments(
      await readFile(path.resolve(ROOT, "components/landing/sections.tsx"), "utf8"),
    );
    expect(code).toContain("企智审审核示例 · 演示数据");
  });
});

describe("渲染层营销词守卫：零虚构承诺", () => {
  it("★ 违禁承诺形态在所有渲染层源码中出现次数为 0", async () => {
    const sources = await renderedSources();

    for (const source of sources) {
      for (const { label, pattern } of FORBIDDEN_CLAIM_PATTERNS) {
        const matched = source.code.match(pattern);
        expect(
          matched,
          `${source.relative} 出现了虚构承诺形态「${label}」（命中：${matched?.[0] ?? ""}）。` +
            `若这是诚实边界声明，请改写措辞避开数字承诺形态；若是真实能力，先让它成为真实，再谈文案。`,
        ).toBeNull();
      }
    }
  });
});
