/**
 * 首页真实浏览器实测（1440 / 834 / 390 三档）。
 *
 * 为什么要保留成脚本而不是一次性命令：
 *   UI 的"看起来没问题"是最容易假通过的判断 —— 容器溢出、元素叠字、
 *   区块空壳、锚点够不着，这几类问题在 DOM 里都存在、结构也合法，
 *   只有真渲染 + 量 bounding box 才看得见。每次改版都要重跑。
 *
 * 用法：
 *   1) 先起服务：npx next start --port 3010（或 npm run dev）
 *   2) node scripts/qa/visual-audit.mjs
 *
 * 踩过的坑（别回头再踩）：
 *   - 全页截图前必须连续滚动把 Reveal 全部触发，否则截出来是假空白。
 *     Reveal 的水合策略是「初始可见，水合后接管」，所以禁 JS 时内容在，
 *     但**开着 JS 不滚动**时视口外的元素是真的 opacity-0 —— 截图会骗人。
 *   - 横向溢出按 documentElement.scrollWidth > clientWidth 判，
 *     不要用 body 的，body 可能因为 overflow-x-clip 自己收缩干净。
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.env.AUDIT_BASE ?? "http://127.0.0.1:3010";
const SHOTS = "docs/brand/_shots";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 },
];

/** 必须可达且非空的区块锚点。改版新增/删除区块时同步这里。 */
const ANCHORS = ["scenarios", "workflow", "evidence", "rules", "capabilities", "trust"];

/**
 * 逐项结论禁用词。系统只产出发现、不产出通过/不通过，
 * 所以页面上任何"某份资料被判定为通过"的表述都是假的。
 * 「通过」单字不禁用（"通过 API"、"通过工作区隔离" 都是正常用法），
 * 禁的是把它当结论用的短语。
 *
 * ⚠️ 注意：这些词在**否定句**里是合法且必要的 —— 信任中心写
 * 「报告里没有总评分、没有通过率」正是在说明系统不做什么。
 * 所以断言必须看上下文，不能裸做子串匹配（第一版就是这么误报的）。
 */
const FAKE_PASS_PHRASES = [
  "审核通过",
  "通过审核",
  "已通过",
  "判定通过",
  "结论：通过",
  "通过率",
  "检验合格",
  "审核合格",
];

/** 否定上下文：命中词前面这么近的距离内出现这些词，说明是在说"我们不这么做"。 */
const NEGATION_WINDOW = 8;
const NEGATION_MARKERS = ["没有", "不会", "不写", "不含", "无", "并非", "也不"];

function findFakePass(text, phrase) {
  let from = 0;
  const hits = [];
  for (;;) {
    const at = text.indexOf(phrase, from);
    if (at === -1) break;
    const before = text.slice(Math.max(0, at - NEGATION_WINDOW), at);
    const negated = NEGATION_MARKERS.some((m) => before.includes(m));
    hits.push({ at, negated, snippet: text.slice(Math.max(0, at - 12), at + phrase.length + 12) });
    from = at + phrase.length;
  }
  return hits;
}

const results = [];
let failures = 0;

function check(scope, label, ok, detail = "") {
  if (!ok) failures += 1;
  results.push(`${ok ? "PASS" : "FAIL"}  [${scope}] ${label}${detail ? ` — ${detail}` : ""}`);
}

async function scanPage(page) {
  return page.evaluate(() => {
    const de = document.documentElement;

    // 横向溢出：找真正顶宽出去的元素，便于定位而不是只报一个布尔
    const overflowing = [];
    const limit = de.clientWidth;
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > limit + 1 || r.left < -1) {
        const style = getComputedStyle(el);
        if (style.position === "fixed") continue;
        // 带上祖先定位，否则只拿到一个 div 根本不知道是哪个区块在越界
        const chain = [];
        for (let p = el; p && p !== document.body; p = p.parentElement) {
          const cls = (p.className || "").toString();
          const id = p.id ? `#${p.id}` : "";
          if (id || cls) chain.push(`${p.tagName.toLowerCase()}${id}${cls ? `.${cls.split(/\s+/).slice(0, 3).join(".")}` : ""}`);
          if (chain.length >= 4) break;
        }
        overflowing.push({
          cls: (el.className || "").toString().slice(0, 70),
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width),
          chain: chain.join("  <  "),
        });
      }
    }

    // 首屏（hero = main 的第一个 section）内叶子文本元素的两两重叠
    const hero = document.querySelector("main > section");
    const leaves = [];
    if (hero) {
      for (const el of hero.querySelectorAll("*")) {
        if (el.children.length > 0) continue;
        const text = (el.textContent || "").trim();
        if (!text) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const style = getComputedStyle(el);
        if (style.position === "absolute" || style.position === "fixed") continue;
        leaves.push({
          text: text.slice(0, 24),
          x: r.left,
          y: r.top,
          w: r.width,
          h: r.height,
        });
      }
    }
    const overlaps = [];
    for (let i = 0; i < leaves.length; i += 1) {
      for (let j = i + 1; j < leaves.length; j += 1) {
        const a = leaves[i];
        const b = leaves[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        // 容忍 2px 的抗锯齿/行高重叠
        if (ox > 2 && oy > 2) {
          overlaps.push({ a: a.text, b: b.text, ox: Math.round(ox), oy: Math.round(oy) });
        }
      }
    }

    // 区块存在性与体量：空的 section 在 DOM 里也是"存在"，必须量高度
    const sections = {};
    for (const id of window.__ANCHORS ?? []) {
      const el = document.getElementById(id);
      sections[id] = el ? Math.round(el.getBoundingClientRect().height) : null;
    }

    const text = document.body.innerText || "";

    /*
     * 逐项结论词单独成块 —— 黑盒验证。
     * 单测守的是源码里的字面量（STATUS_STYLE / tsx），这里守的是**渲染结果**：
     * 不管文案从哪来（常量、props、后端），只要页面上真出现了独立的一块「通过」，
     * 它就是替系统宣布了一件它从不宣布的事。
     */
    const standaloneVerdicts = [];
    for (const el of document.querySelectorAll("body *")) {
      if (el.children.length > 0) continue;
      const t = (el.textContent || "").trim();
      if (!t) continue;
      if (!["通过", "待确认", "问题"].includes(t)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      standaloneVerdicts.push({ text: t, cls: (el.className || "").toString().slice(0, 50) });
    }

    return {
      docScrollWidth: de.scrollWidth,
      docClientWidth: limit,
      overflowing: overflowing.slice(0, 8),
      overflowCount: overflowing.length,
      leafCount: leaves.length,
      overlaps: overlaps.slice(0, 6),
      overlapCount: overlaps.length,
      sections,
      standaloneVerdicts,
      text,
      title: document.title,
    };
  }, null);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
mkdirSync(SHOTS, { recursive: true });

try {
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
    });
    await page.addInitScript(`window.__ANCHORS = ${JSON.stringify(ANCHORS)};`);
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });

    // 触发全部 Reveal 后再截图：视口外的元素初始是 opacity-0，不滚动就是假空白
    await page.evaluate(async () => {
      const step = Math.round(window.innerHeight * 0.8);
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 300));
    });

    const snap = await scanPage(page);

    // 两个条件都要查：文档级滚动条会被 overflow-x-clip 藏掉，
    // 而"藏掉"意味着内容被硬裁 —— 比出滚动条更糟，因为读者根本不知道少了东西。
    check(vp.name, "零横向溢出（无滚动条）", snap.docScrollWidth <= snap.docClientWidth + 1,
      `scrollWidth=${snap.docScrollWidth} clientWidth=${snap.docClientWidth}`);
    check(vp.name, "零横向溢出（无元素越界被裁）", snap.overflowCount === 0,
      snap.overflowCount ? `${snap.overflowCount} 个，例：${JSON.stringify(snap.overflowing[0])}` : "");

    check(vp.name, "首屏无叠字", snap.overlapCount === 0,
      `叶子文本 ${snap.leafCount} 个，重叠 ${snap.overlapCount} 对` +
      (snap.overlapCount ? ` 例：${JSON.stringify(snap.overlaps[0])}` : ""));

    for (const [id, height] of Object.entries(snap.sections)) {
      check(vp.name, `区块 #${id} 存在且非空`, height !== null && height > 200,
        height === null ? "DOM 中不存在" : `高度 ${height}px`);
    }

    // 品牌名：简称必须在正文里；拉丁名已废止，可见文本不得再出现
    check(vp.name, "正文出现品牌简称「企智审」", snap.text.includes("企智审"));
    check(vp.name, "可见文本不再出现拉丁名 SupplierCheck", !snap.text.includes("SupplierCheck"));

    for (const phrase of FAKE_PASS_PHRASES) {
      const hits = findFakePass(snap.text, phrase);
      const offending = hits.filter((h) => !h.negated);
      check(vp.name, `无逐项结论词「${phrase}」`, offending.length === 0,
        offending.length ? `${offending.length} 处，例：…${offending[0].snippet}…`
          : hits.length ? `${hits.length} 处均为否定表述（合法）` : "");
    }

    check(vp.name, "页面上没有单独成块的逐项结论词", snap.standaloneVerdicts.length === 0,
      snap.standaloneVerdicts.length ? JSON.stringify(snap.standaloneVerdicts[0]) : "");

    // 锚点可达：滚到该锚点后它必须真的落在 header 下方（scroll-mt-16 生效与否）。
    // ⚠️ 判据不能用 top >= 0 —— sticky header 高 64px，top=0 意味着标题正好被盖住，
    // 而那种情况在 DOM 里完全"合法"，只有量真实位置才发现。
    const headerHeight = await page.evaluate(() => {
      const h = document.querySelector("header");
      return h ? Math.round(h.getBoundingClientRect().height) : 0;
    });
    for (const id of ANCHORS) {
      const pos = await page.evaluate((anchorId) => {
        const el = document.getElementById(anchorId);
        if (!el) return null;
        el.scrollIntoView({ block: "start" });
        return Math.round(el.getBoundingClientRect().top);
      }, id);
      const ok = pos !== null && pos >= headerHeight - 2 && pos < headerHeight + 40;
      check(vp.name, `锚点 #${id} 落在 header 下方`, ok,
        pos === null ? "DOM 中不存在" : `top=${pos}px，header=${headerHeight}px`);
      await page.evaluate(() => window.scrollTo(0, 0));
    }

    await page.screenshot({ path: `${SHOTS}/home-${vp.name}.png`, fullPage: true });

    // 全页图缩到屏幕上看不清字，逐区块再出一遍，用于目检版式。
    // 截图前把 sticky header 设为 visibility:hidden —— 它不是布局元素，
    // 藏起来不改动版式，但能避免它盖在区块截图上造成"标题被遮"的假象。
    if (process.env.AUDIT_SECTIONS === "1") {
      await page.evaluate(() => {
        const h = document.querySelector("header");
        if (h) h.style.visibility = "hidden";
      });
      const targets = [["hero", "main > section"]];
      for (const id of ANCHORS) targets.push([id, `#${id}`]);
      for (const [label, sel] of targets) {
        const el = await page.$(sel);
        if (el) await el.screenshot({ path: `${SHOTS}/${vp.name}-${label}.png` }).catch(() => {});
      }
      await page.evaluate(() => {
        const h = document.querySelector("header");
        if (h) h.style.visibility = "";
      });
    }

    await page.close();
  }
} finally {
  await browser.close();
}

console.log(results.join("\n"));
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}  (${results.length} checks)`);
console.log(`截图：${SHOTS}/home-{desktop,tablet,mobile}.png`);
process.exit(failures === 0 ? 0 : 1);
