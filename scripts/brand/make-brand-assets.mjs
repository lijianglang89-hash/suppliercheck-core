/**
 * 生成品牌静态资产：OG 分享图 + Favicon 三件套。
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
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PUBLIC = join(ROOT, "public");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

/** 品牌标识图形（不含底板）—— 与 app/icon.svg、components/brand/logo.tsx 同一套坐标。 */
const MARK = `
  <g fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M7.5 5h8l4 4v18h-12z" />
    <path d="M15.5 5v4h4" />
    <path d="M11 14h6" />
    <path d="M11 18h6" />
  </g>
  <circle cx="23" cy="23" r="7" fill="#ffffff" />
  <path d="M20.2 23.1l2.1 2.1 3.6-3.6" fill="none" stroke="#2f6097" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />`;

/**
 * iOS 桌面图标 / PWA 图标：**必须不透明满幅**。
 * iOS 自己会加圆角遮罩，透明区域会被填成黑色 —— 所以这里用实心品牌蓝铺满，
 * 图形缩到 80% 居中，圆角让系统去切。
 */
const OPAQUE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="#2f6097" />
  <g transform="translate(3.2 3.2) scale(0.8)">${MARK}</g>
</svg>`;

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

/** 把一段 SVG 按给定边长渲染（先高倍率出图再降采样，保证小尺寸下的边缘质量）。 */
async function renderSvg(svg, size) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 4,
  });
  await page.setContent(
    `<!doctype html><html><body style="margin:0">${svg}</body></html>`,
    { waitUntil: "load" },
  );
  const buffer = await page.screenshot({ type: "png", omitBackground: true });
  await page.close();
  return sharp(buffer).resize(size, size, { kernel: "lanczos3" }).png().toBuffer();
}

/* ---------------------------------- OG 图 --------------------------------- */
{
  const html = readFileSync(join(ROOT, "scripts", "brand", "og.html"), "utf8");
  const raw = await renderHtml(html, 1200, 630, 2);
  // 2 倍图降采样到 1200×630：文字边缘更平滑；palette 把体积压到远低于 1MB 上限。
  const out = await sharp(raw)
    .resize(1200, 630, { kernel: "lanczos3" })
    .png({ palette: true, quality: 90, compressionLevel: 9 })
    .toBuffer();
  const file = join(PUBLIC, "og-image.png");
  writeFileSync(file, out);
  results.push(["public/og-image.png", `${out.length} B`]);
}

/* ------------------------------- 图标三件套 -------------------------------- */
{
  const iconSvg = readFileSync(join(ROOT, "app", "icon.svg"), "utf8");

  // apple-touch-icon 180（不透明）
  const apple = await renderSvg(OPAQUE_ICON_SVG, 180);
  writeFileSync(join(PUBLIC, "apple-touch-icon.png"), apple);

  // PWA manifest 用
  const i192 = await renderSvg(OPAQUE_ICON_SVG, 192);
  const i512 = await renderSvg(OPAQUE_ICON_SVG, 512);
  writeFileSync(join(PUBLIC, "icon-192.png"), i192);
  writeFileSync(join(PUBLIC, "icon-512.png"), i512);

  // favicon.ico 32（嵌 PNG 的 ICO，Vista+ 起所有浏览器都认）
  const png32 = await renderSvg(iconSvg, 32);
  writeFileSync(join(PUBLIC, "favicon.ico"), wrapPngInIco(png32, 32));

  results.push(["public/apple-touch-icon.png", `${apple.length} B`]);
  results.push(["public/icon-192.png", `${i192.length} B`]);
  results.push(["public/icon-512.png", `${i512.length} B`]);
  results.push(["public/favicon.ico", `${wrapPngInIco(png32, 32).length} B`]);
}

await browser.close();

console.log("已生成：");
for (const [name, size] of results) {
  console.log(`  ${name.padEnd(30)} ${size}`);
}

/**
 * PNG → ICO 容器。
 * ICO 里直接放 PNG 数据从 Vista 起就是合法格式，比自己拼 BMP 省事且体积更小。
 */
function wrapPngInIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count

  const entry = Buffer.alloc(16);
  entry.writeUInt8(size === 256 ? 0 : size, 0); // width
  entry.writeUInt8(size === 256 ? 0 : size, 1); // height
  entry.writeUInt8(0, 2); // palette colors
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8); // data size
  entry.writeUInt32LE(22, 12); // data offset

  return Buffer.concat([header, entry, png]);
}
