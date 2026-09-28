/**
 * 生成 OG 分享图（public/og-image.png）。
 *
 * 为什么用 headless Chrome 而不是 next/og：
 * next/og 内置默认字体是 Geist-Regular（实测 973 个字形，零 CJK），
 * 中文会渲染成豆腐块；要修就得往镜像里塞一份中文字体（体积 + 授权）。
 * 分享图的文案是固定的，静态出图更省事也更可控 —— 出完图提交进 public/，
 * 运行时零依赖、零字体、零 wasm。
 *
 * 用法（在本机跑，产物需要提交）：
 *   node scripts/brand/make-brand-assets.mjs
 *
 * 依赖：playwright-core（用本机 Chrome）+ sharp（均在 devDependencies / next 依赖里）。
 *
 * ⚠️ **本脚本只产 OG 图。** favicon / apple-touch-icon / PWA 图标
 * 一律由 `scripts/brand/make-logo-assets.py` 生成（它从品牌源图抠图，是真源）。
 * 曾经这里也写那三件套、用的是一段手写 SVG —— 于是同一批文件有两个作者，
 * 谁后跑谁赢：跑完这个脚本，favicon 会静默退回上一版图形与上一版蓝。
 * 一个产物只能有一个作者，这条不要为了"省一次执行"而破。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PUBLIC = join(ROOT, "public");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const MARK_PNG = join(PUBLIC, "brand", "mark-transparent-512.png");

const results = [];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

/** 把一段 HTML 按给定尺寸与倍率渲染成 PNG Buffer。 */
async function renderHtml(html, width, height, scale) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: scale,
  });
  await page.setContent(html, { waitUntil: "load" });
  const buffer = await page.screenshot({ type: "png", omitBackground: false });
  await page.close();
  return buffer;
}

/* ---------------------------------- OG 图 --------------------------------- */
{
  /*
   * 品牌标识内联成 data URI 再注入。
   * `page.setContent` 渲染的是 about:blank 文档，相对路径的 <img> 取不到文件；
   * 内联之后分享图的图形与页面上的标记**同源同像素**，不会各画一份。
   */
  let mark;
  try {
    mark = readFileSync(MARK_PNG);
  } catch {
    throw new Error(
      `缺少 ${MARK_PNG} —— 先跑 python scripts/brand/make-logo-assets.py 生成品牌标识`,
    );
  }
  const markUri = `data:image/png;base64,${mark.toString("base64")}`;

  const template = readFileSync(join(ROOT, "scripts", "brand", "og.html"), "utf8");
  if (!template.includes("{{MARK}}")) {
    throw new Error("og.html 里找不到 {{MARK}} 占位符 —— 品牌标识的注入点被改掉了");
  }
  const html = template.replaceAll("{{MARK}}", markUri);

  const raw = await renderHtml(html, 1200, 630, 2);
  // 2 倍图降采样到 1200×630：文字边缘更平滑；palette 把体积压到远低于 1MB 上限。
  const out = await sharp(raw)
    .resize(1200, 630, { kernel: "lanczos3" })
    .png({ palette: true, quality: 90, compressionLevel: 9 })
    .toBuffer();
  writeFileSync(join(PUBLIC, "og-image.png"), out);
  results.push(["public/og-image.png", `${out.length} B`]);
}

await browser.close();

console.log("已生成：");
for (const [name, size] of results) {
  console.log(`  ${name.padEnd(30)} ${size}`);
}
console.log("\n图标三件套（favicon / apple-touch-icon / PWA）请跑：");
console.log("  python scripts/brand/make-logo-assets.py");
