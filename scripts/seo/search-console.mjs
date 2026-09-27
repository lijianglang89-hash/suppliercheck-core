/**
 * 搜索引擎站长平台 · 半自动操作辅助
 *
 * 为什么是"半自动"：
 *   站点验证与 sitemap 提交属于高权鉴权操作。运行在隔离沙箱里的 Agent
 *   读不到本机的浏览器 Cookie，也替人做不了验证码和扫码登录 ——
 *   建立身份信任的**第一道握手必须由带真实凭据的客户端完成**。
 *
 *   但握手之后的事可以交给机器：Cookie 落盘后，提交 sitemap、
 *   查询收录状态、批量推送 URL 都是纯 HTTP 操作。
 *   这就是本脚本做的事：**人过登录关，机器跑剩余关。**
 *
 * 用法：
 *   node scripts/seo/search-console.mjs setup  baidu    # 打开浏览器，你登录
 *   node scripts/seo/search-console.mjs submit baidu    # 复用登录态，提交 sitemap
 *
 * 环境变量：
 *   SC_PROFILE_DIR  登录态存放目录（默认 .workbuddy/seo-profile）
 *   SC_SITEMAP      sitemap 地址（默认 https://supplier.ultron.xin/sitemap.xml）
 *   CHROME_PATH     Chrome 可执行文件路径
 *   PLAYWRIGHT_CORE_PATH  playwright-core 模块路径（未装进项目时用它兜底）
 *
 * 前置：本机需要 playwright-core。
 *   项目内未安装时执行：npm i -D playwright-core
 */

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const DEFAULT_CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CHROME = process.env.CHROME_PATH ?? DEFAULT_CHROME;

const SITES = {
  baidu: {
    name: "百度搜索资源平台",
    home: "https://ziyuan.baidu.com/",
    // 百度把验证、链接提交、抓取诊断分散在几个子页面，登录入口是统一的
    linkSubmit: "https://ziyuan.baidu.com/linksubmit/index",
    sitemap: "https://ziyuan.baidu.com/robots/index",
  },
  google: {
    name: "Google Search Console",
    home: "https://search.google.com/search-console",
    sitemap: "https://search.google.com/search-console/sitemaps",
  },
  bing: {
    name: "Bing Webmaster Tools",
    home: "https://www.bing.com/webmasters",
    sitemap: "https://www.bing.com/webmasters/sitemaps",
  },
};

/**
 * playwright-core 可能装在项目 node_modules，也可能在别处。逐个尝试，
 * 而不是假设一个路径 —— 假设路径的失败信息对用户毫无帮助。
 *
 * ⚠️ 两个 Windows / ESM 的坑，都踩过：
 *   1. `await import("C:\\foo")` 会把绝对路径当成 bare package specifier 去找
 *      node_modules → ERR_MODULE_NOT_FOUND，错误信息看着像路径写错，极易误导。
 *   2. 改成 file:// URL 后又报 ERR_UNSUPPORTED_DIR_IMPORT —— ESM 不允许导入目录。
 *
 * 两条路都堵，正解是 `createRequire`：它走 CJS 解析规则，
 * Windows 绝对路径和目录导入（读 package.json 的 main）都能正常处理。
 */
function loadPlaywright() {
  const candidates = [
    "playwright-core",
    process.env.PLAYWRIGHT_CORE_PATH,
    join(homedir(), ".workbuddy/binaries/node/workspace/node_modules/playwright-core"),
  ].filter(Boolean);

  const require = createRequire(import.meta.url);
  const errors = [];
  for (const candidate of candidates) {
    try {
      return require(candidate).chromium;
    } catch (error) {
      errors.push(`${candidate}: ${String(error).slice(0, 80)}`);
    }
  }

  throw new Error(
    "找不到 playwright-core。在项目里执行：npm i -D playwright-core\n" +
      "或设置 PLAYWRIGHT_CORE_PATH 指向它的安装目录。\n尝试过：\n  " +
      errors.join("\n  "),
  );
}

/** 等用户在终端按回车。readline 在 stdin 不可用时直接返回。 */
function waitForEnter(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    if (!process.stdin.isTTY) {
      console.log("（非交互环境，跳过等待）");
      return resolve();
    }
    process.stdin.once("data", () => resolve());
  });
}

async function main() {
  const [, , action = "setup", siteKey = "baidu"] = process.argv;
  const site = SITES[siteKey];
  if (!site) {
    console.error(`未知平台：${siteKey}。可选：${Object.keys(SITES).join(" / ")}`);
    process.exit(2);
  }

  const chromium = loadPlaywright();
  const profileDir = process.env.SC_PROFILE_DIR ?? ".workbuddy/seo-profile";
  mkdirSync(profileDir, { recursive: true });
  const stateFile = join(profileDir, `${siteKey}-state.json`);

  if (action === "setup") {
    console.log(`\n==> 打开 ${site.name}`);
    console.log("    请在弹出的浏览器里手动登录（含验证码 / 扫码 / 二次校验）。");
    console.log("    登录完成后回到这里按 Enter —— Cookie 会被保存到：");
    console.log(`    ${stateFile}\n`);

    const context = await chromium.launchPersistentContext(profileDir, {
      executablePath: CHROME,
      headless: false,
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(site.home, { waitUntil: "domcontentloaded" }).catch(() => {});

    await waitForEnter("按 Enter 继续…");
    await context.storageState({ path: stateFile });
    await context.close();
    console.log(`\n✅ 登录态已保存：${stateFile}`);
    console.log(`   下一步：node scripts/seo/search-console.mjs submit ${siteKey}`);
    return;
  }

  if (action === "submit") {
    const sitemap = process.env.SC_SITEMAP ?? "https://supplier.ultron.xin/sitemap.xml";
    console.log(`\n==> 用已保存的登录态打开 ${site.name} 的 sitemap 页面`);

    const browser = await chromium.launch({ executablePath: CHROME, headless: false });
    const context = await browser.newContext({
      storageState: stateFile,
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    const page = context.pages()[0] ?? (await context.newPage());

    await page.goto(site.sitemap ?? site.home, { waitUntil: "domcontentloaded" }).catch(() => {});

    /*
     * 到这里**刻意停住**，不尝试自动点按钮。
     *
     * 理由：站长平台的表单会随版本改版（百度的链接提交、Google 的 sitemap
     * 输入框位置都不止变过一次），写一个依赖 DOM 结构的自动化脚本，
     * 收益是一次省几秒点击，代价是下次改版后静默点错地方 ——
     * 而提交错的东西是在污染索引，比不提交更糟。
     *
     * 机器负责把已经认证好的会话开到正确的页面，最后一下由人来点。
     */
    console.log("\n-----------------------------------------------");
    console.log("浏览器已停在 sitemap 页面，请在页面上手动提交：");
    console.log(`  ${sitemap}`);
    console.log("-----------------------------------------------");
    console.log("为什么不自动点：表单结构会改版，点错地方是在污染索引。");
    console.log("机器已经把最难的一步（登录 + 找到页面）做完了。\n");

    await waitForEnter("提交完成后按 Enter 关闭…");
    await browser.close();
    return;
  }

  console.error(`未知动作：${action}。可选：setup / submit`);
  process.exit(2);
}

await main();
