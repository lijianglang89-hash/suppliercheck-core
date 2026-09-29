/**
 * 应用外壳（components/dashboard/shell.tsx）的打印守卫。
 *
 * v1.0.0 线上冒烟实测发现：打印报告时侧边栏（工作区/导航）与顶栏
 * （账号信息/退出按钮）被一并印进了 PDF —— 交互界面残余出现在正式
 * 交付物上。修复方式是给 aside / header 标 `print:hidden`。
 *
 * 这里的守卫钉住两件事：
 *   1. aside 与 header 必须带 `print:hidden`（防止将来重构时被顺手删掉）；
 *   2. `<main>` 本体**不得**带 `print:hidden`（打印的正是它里面的内容）。
 *
 * Tailwind 的 variant 类名没有编译期检查，删错了也不会构建失败 ——
 * 只能用源码字符串守卫钉住。真实渲染生效性由线上冒烟
 * （playwright emulateMedia('print') 后 aside 的 getClientRects 为空）复核。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SHELL_SOURCE = readFileSync(
  path.join(process.cwd(), "components/dashboard/shell.tsx"),
  "utf-8",
);

function tagBlock(source: string, tag: "aside" | "header" | "main"): string {
  // 匹配元素的开始标签（到首个 `>` 为止），足够覆盖 className 判断。
  const match = source.match(new RegExp(`<${tag}\\b[^>]*>`));
  if (!match) throw new Error(`shell.tsx 中找不到 <${tag}> 元素`);
  return match[0];
}

describe("应用外壳的打印纪律", () => {
  it("aside（侧边导航）带 print:hidden", () => {
    expect(tagBlock(SHELL_SOURCE, "aside")).toMatch(/print:hidden/);
  });

  it("header（顶栏：账号信息与退出按钮）带 print:hidden", () => {
    expect(tagBlock(SHELL_SOURCE, "header")).toMatch(/print:hidden/);
  });

  it("main 本体不得被打印隐藏（打印的正是里面的报告）", () => {
    expect(tagBlock(SHELL_SOURCE, "main")).not.toMatch(/print:hidden/);
  });
});
