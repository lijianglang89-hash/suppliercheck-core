/**
 * PDF 文本层提取（unpdf）。
 *
 * 选型理由：
 * - `pdf-parse` 已是多年未更新的包，且把整个 pdf.js 塞进一个 CJS 文件；
 * - `unpdf` 基于同一份 pdf.js，但为服务端裁剪过打包（无 DOM 依赖、无 worker），
 *   且提供 `extractText` 这种「给我字节、还我文本」的最小接口。
 *
 * ⚠️ 内存诚实声明（不要在这里写「已实现流式」）：
 * PDF 的交叉引用表在文件末尾，文本/字体对象散落全文，pdf.js 需要一份完整字节缓冲。
 * 本解析器是**全引擎唯一允许整体读取文件**的地方，靠三件事把峰值压住：
 *   1. size 超过 PDF_MAX_IN_MEMORY_BYTES 时降级，不解析、并写明原因；
 *   2. 解析在串行队列中执行（./../queue.ts），进程内同一时刻只有一份 PDF 在内存里；
 *   3. 输出文本按 MAX_EXTRACTED_CHARS 截断。
 */

import { PDF_MAX_IN_MEMORY_BYTES } from "../limits";
import { TextCollector, normalizeExtractedText } from "../text";
import { emptyOutcome, type DocumentParser, type ParseOutcome, type ParseSource } from "./types";

export const PDF_MIME = "application/pdf";

export const pdfParser: DocumentParser = {
  id: "pdf",
  supportedMimeTypes: [PDF_MIME],

  supports(mimeType: string): boolean {
    return mimeType === PDF_MIME;
  },

  async parse(source: ParseSource): Promise<ParseOutcome> {
    if (source.size > PDF_MAX_IN_MEMORY_BYTES) {
      return emptyOutcome({
        parserId: this.id,
        notes: [
          `文件超过本地解析上限（${formatMb(PDF_MAX_IN_MEMORY_BYTES)}），已跳过文本提取；文件本身已完整保存。`,
        ],
        meta: { extraction: "skipped", reason: "size_over_limit", size: source.size },
      });
    }

    // 唯一的整体读取点。上面已经做过限额判断，这里不再重复判断。
    const bytes = await source.readAll();

    // 动态导入：让 pdf.js 只在实际有 PDF 需要解析时才被加载，
    // 避免启动阶段为一个可能用不到的功能付内存代价。
    const { extractText } = await import("unpdf");

    const result = await extractText(bytes, { mergePages: false });
    const pages = Array.isArray(result.text) ? result.text : [result.text];

    const collector = new TextCollector();
    let nonEmptyPages = 0;

    for (let index = 0; index < pages.length; index += 1) {
      const page = normalizeExtractedText(pages[index] ?? "");
      if (page.length > 0) nonEmptyPages += 1;
      if (index > 0) collector.append("\n");
      collector.append(page);
      collector.append("\n");
      if (collector.truncated) break;
    }

    const text = normalizeExtractedText(collector.toString());
    const notes: string[] = [];

    if (nonEmptyPages === 0) {
      notes.push(
        "未从该 PDF 中提取到文本层，通常是扫描件或纯图片 PDF。文件已完整保存，后续接入 OCR 后可重新解析。",
      );
    } else if (nonEmptyPages < pages.length) {
      notes.push(`共 ${pages.length} 页，其中 ${pages.length - nonEmptyPages} 页没有文本层（可能含扫描页）。`);
    }
    if (collector.truncated) {
      notes.push("提取到的文本较长，已按上限截断，仅保留前面部分。");
    }

    return {
      parserId: this.id,
      text,
      charCount: text.length,
      truncated: collector.truncated,
      pageCount: result.totalPages,
      notes,
      meta: {
        extraction: "ok",
        totalPages: result.totalPages,
        pagesWithText: nonEmptyPages,
        bytesRead: bytes.byteLength,
      },
    };
  },
};

function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
