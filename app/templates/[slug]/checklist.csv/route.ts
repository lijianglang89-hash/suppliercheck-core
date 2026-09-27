import { findChecklistTemplate } from "@/lib/content/checklist-templates";
import { REVIEW_RULES } from "@/lib/reviews/rules";

/**
 * 清单 CSV 下载。
 *
 * ⚠️ 文件是**从内容数据现算出来的**，不是仓库里放一份静态文件。
 * 静态文件会在内容更新时静默过期 —— 页面上写着 9 项、下载下来是 7 项，
 * 这种不一致比没有下载更伤信任（而且没人会定期去核对附件）。
 *
 * 用 CSV 不用 xlsx：生成 xlsx 要引一个写作库，而 CSV 带 UTF-8 BOM
 * 在 Excel 里双击就能正确打开中文，零依赖、零维护成本。
 * 页面上的按钮也因此写「CSV（Excel 可打开）」而不是含糊的「Excel 下载」。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const template = findChecklistTemplate(slug);
  if (!template) {
    return new Response("Not Found", { status: 404 });
  }

  const ruleLabel = (ruleId: string) =>
    REVIEW_RULES.find((rule) => rule.id === ruleId)?.label ?? ruleId;

  const rows: string[][] = [
    ["序号", "资料名称", "必备", "为什么要收", "查验要点", "常见雷区", "对应规则"],
    ...template.items.map((item, index) => [
      String(index + 1),
      item.name,
      item.required ? "必备" : "选备",
      item.why,
      item.check.join("；"),
      item.pitfalls.join("；"),
      item.ruleIds.map(ruleLabel).join("、"),
    ]),
  ];

  const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n");

  return new Response(`﻿${csv}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${template.slug}-checklist.csv"`,
      "cache-control": "public, max-age=3600",
    },
  });
}

/** 标准 CSV 转义：含逗号/引号/换行的字段整体加引号，内部引号翻倍。 */
function escapeCsv(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
