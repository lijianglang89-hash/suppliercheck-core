/**
 * 模板配置的「文本编辑格式」解析与序列化。
 *
 * 为什么用文本而不是一组嵌套的 input：
 * 必备资料清单是**行数不定、每行有多个关键词**的结构。做成动态增删的表单组件
 * 需要客户端 JS 才能增删行，而这里的取舍是「先用得起、其次才好看」——
 * 文本区在无 JS 环境下也能用，复制粘贴一大段清单也方便。
 *
 * 格式（每行一条，`#` 开头为注释）：
 *
 *   营业执照 | 营业执照, 统一社会信用代码 | 必填
 *   ISO 14001 | ISO 14001, ISO14001, 环境管理体系 | 选填
 *
 * 三段分别为：名称 | 关键词（逗号或空格分隔） | 必填/选填（缺省为必填）
 *
 * 解析函数刻意**返回错误列表而不是抛错**：用户写错一行不该整份模板报废，
 * 而是告诉他第几行有问题。
 */
import type { RequiredDocumentSpec } from "./types";

export const DOCUMENT_LINE_EXAMPLE = [
  "# 每行一条：名称 | 关键词（逗号分隔） | 必填 或 选填",
  "营业执照 | 营业执照, 统一社会信用代码 | 必填",
  "产品认证 | CE 认证, 检验报告, 检测报告 | 选填",
].join("\n");

/** 关键词的分隔符：中英文逗号、顿号、斜杠、空白都认。 */
const KEYWORD_SEPARATOR = /[,，、/|\s]+/;

export interface ParseDocumentLinesResult {
  items: RequiredDocumentSpec[];
  /** 逐条的错误说明（含行号），用于回显给用户。 */
  errors: string[];
  /** 被跳过的空行与注释行数，仅用于提示。 */
  skipped: number;
}

export function parseDocumentLines(text: string): ParseDocumentLinesResult {
  const items: RequiredDocumentSpec[] = [];
  const errors: string[] = [];
  let skipped = 0;

  const lines = text.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      skipped += 1;
      return;
    }

    const segments = line.split("|").map((segment) => segment.trim());
    const label = segments[0] ?? "";
    if (label.length === 0) {
      errors.push(`第 ${lineNumber} 行缺少名称。`);
      return;
    }
    if (label.length > 64) {
      errors.push(`第 ${lineNumber} 行的名称超过 64 个字符。`);
      return;
    }

    const keywordSegment = segments[1] ?? "";
    const keywords = keywordSegment
      .split(KEYWORD_SEPARATOR)
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword.length > 0)
      .map((keyword) => keyword.slice(0, 64));

    if (keywords.length === 0) {
      errors.push(`第 ${lineNumber} 行「${label}」没有填写任何关键词，无法判定是否已提供。`);
      return;
    }

    const modeSegment = (segments[2] ?? "").trim();
    const required = modeSegment !== "选填";

    items.push({ key: label, label, keywords: keywords.slice(0, 20), required });
  });

  return { items, errors, skipped };
}

/** 把配置序列化回文本框。用于把内置模板带进编辑框。 */
export function serializeDocumentLines(items: readonly RequiredDocumentSpec[]): string {
  return items
    .map((item) => `${item.label} | ${item.keywords.join(", ")} | ${item.required ? "必填" : "选填"}`)
    .join("\n");
}
