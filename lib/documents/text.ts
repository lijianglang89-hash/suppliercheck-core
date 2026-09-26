/**
 * 文本收集器与归一化。
 *
 * 解析器的产出永远是「可能不完整」的：要么撞到字符上限，要么格式只支持部分提取。
 * 因此这里的设计目标是**让不完整变可见**，而不是把不完整伪装成完整：
 * - 超出上限时立刻置 truncated = true，并停止累积（不再占用内存）；
 * - 归一化只做无损清理（控制字符、行尾空白、连续空行），不改写文字内容。
 */

import { MAX_EXTRACTED_CHARS } from "./limits";

/**
 * 有上限的字符串累积器。
 *
 * 关键点：上限判断发生在**累积之前**，所以单次 append 传入超大字符串也不会
 * 让内存先涨上去再被截断。
 */
export class TextCollector {
  private readonly chunks: string[] = [];
  private stored = 0;
  private readonly maxChars: number;

  /** 是否因为触顶而丢弃了内容。 */
  truncated = false;

  constructor(maxChars: number = MAX_EXTRACTED_CHARS) {
    if (!Number.isFinite(maxChars) || maxChars <= 0) {
      throw new Error("TextCollector 的 maxChars 必须是正数。");
    }
    this.maxChars = Math.floor(maxChars);
  }

  append(value: string | undefined | null): void {
    if (!value) return;

    const remaining = this.maxChars - this.stored;
    if (remaining <= 0) {
      this.truncated = true;
      return;
    }

    if (value.length <= remaining) {
      this.chunks.push(value);
      this.stored += value.length;
      return;
    }

    this.chunks.push(value.slice(0, remaining));
    this.stored += remaining;
    this.truncated = true;
  }

  /** 当前已保留的字符数（不含被丢弃的部分）。 */
  get charCount(): number {
    return this.stored;
  }

  get isEmpty(): boolean {
    return this.stored === 0;
  }

  toString(): string {
    return this.chunks.join("");
  }
}

/**
 * 归一化提取结果。
 *
 * 只做「无信息损失」的清理：
 * - 去掉 NUL 与其他控制字符（保留 \n \t）；
 * - CRLF / CR 统一为 LF；
 * - 去掉每行行尾空白；
 * - 连续 3 个以上换行压成 2 个（避免大量空行浪费 AI 上下文）；
 * - 首尾整体去空白。
 *
 * 故意**不**做：全角转半角、繁简转换、标点统一 —— 这些会改变原文语义，
 * 属于后续回答问题阶段的职责，不该在提取阶段偷偷做掉。
 */
export function normalizeExtractedText(raw: string): string {
  if (!raw) return "";

  return raw
    .replace(/\r\n?/g, "\n")
    // 控制字符是**刻意**要匹配的（PDF/XLSX 里常有嵌入控制符），不是笔误。
    // 保留 \t(TAB) 与 \n(LF)，只清掉真正会造成解析歧义的那些。
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 把一段文本按行归一化并拼进收集器（解析器最常用的写入口）。 */
export function appendLine(collector: TextCollector, line: string): void {
  collector.append(line);
  collector.append("\n");
}
