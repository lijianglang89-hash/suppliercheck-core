/**
 * DOCX 纯文本提取（自建流式实现）。
 *
 * 为什么不用 mammoth（Agent 02 指令里点名的方案）—— 实测结论，不是偏好：
 *   mammoth 的 openZip({path}) 第一步就是 `fs.readFile(path)` 把整份文件读成
 *   ArrayBuffer，再交给 JSZip 建索引，最后把 word/document.xml 解析成 xmldom DOM。
 *   也就是说它**在设计上就无法满足「严禁整体读入内存」**：一个 20 MB 的 docx
 *   峰值可能到 100 MB 以上。同时它还会带进 jszip / bluebird / underscore /
 *   xmlbuilder / xmldom 等 10 个传递依赖（约 2.5 MB）。
 *
 * 自建版本用与 XLSX 完全相同的 yauzl + saxes 底座：按需打开 word/document.xml，
 * 逐块流式解析，命中字符上限立刻停手。依赖成本 0（复用已有依赖）。
 *
 * 覆盖范围（有意为之，不是遗漏）：
 *   ✅ 正文段落与表格（段落按 \n 分隔，单元格按 \t 分隔）
 *   ✅ 制表符 <w:tab/>、换行 <w:br/>、分页 <w:cr/>
 *   ✅ 脚注 / 尾注（word/footnotes.xml、word/endnotes.xml）
 *   ❌ 页眉页脚、文本框、批注、超链接的目标地址（对「资料审核」无信息增量）
 *
 * 注意：`w:instrText`（域代码）与 `w:delText`（修订删除文本）天然不会被收集，
 * 因为我们只认标签名 `t`。
 */

import type { Readable } from "node:stream";

import { MAX_EXTRACTED_CHARS } from "../limits";
import { TextCollector, normalizeExtractedText } from "../text";
import { localName, parseXmlStream } from "../xml-stream";
import { closeZipQuietly, openZip } from "../zip";import { emptyOutcome, type DocumentParser, type ParseOutcome, type ParseSource } from "./types";

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** 正文所在的部件；脚注/尾注紧随其后。 */
const BODY_PART = "word/document.xml";
const EXTRA_PARTS = ["word/footnotes.xml", "word/endnotes.xml"];

/** 单个 XML 部件的解压上限，防止压缩炸弹。 */
const MAX_PART_BYTES = 64 * 1024 * 1024;

export const docxParser: DocumentParser = {
  id: "docx",
  supportedMimeTypes: [DOCX_MIME],

  supports(mimeType: string): boolean {
    return mimeType === DOCX_MIME;
  },

  async parse(source: ParseSource): Promise<ParseOutcome> {
    if (!source.localPath) {
      return emptyOutcome({
        parserId: this.id,
        notes: ["当前存储后端不支持按路径流式解析 DOCX，已跳过文本提取；文件本身已完整保存。"],
        meta: { extraction: "skipped", reason: "no_local_path" },
      });
    }

    const zip = await openZip(source.localPath);
    const collector = new TextCollector();

    try {
      // yauzl v3 的 eachEntry() 会自动推进并排空跳过的条目，无需（也不能）手动 autodrain。
      for await (const entry of zip.eachEntry()) {
        if (entry.fileName !== BODY_PART && !EXTRA_PARTS.includes(entry.fileName)) {
          continue;
        }

        if (entry.uncompressedSize > MAX_PART_BYTES) {
          continue;
        }

        const stream = await zip.openReadStreamPromise(entry);
        if (collector.charCount > 0) {
          collector.append("\n");
        }
        await extractPartText(stream, collector);

        if (collector.truncated) break;
      }
    } finally {
      closeZipQuietly(zip);
    }

    const text = normalizeExtractedText(collector.toString());
    const notes: string[] = [];

    if (text.length === 0) {
      notes.push("未从该文档中提取到正文文本，可能是空文档或仅含图片。");
    }
    if (collector.truncated) {
      notes.push(`正文较长，已按上限（${MAX_EXTRACTED_CHARS.toLocaleString("zh-CN")} 字）截断。`);
    }
    notes.push("页眉、页脚与文本框内容不参与提取。");

    return {
      parserId: this.id,
      text,
      charCount: text.length,
      truncated: collector.truncated,
      notes,
      meta: { extraction: "ok", maxChars: MAX_EXTRACTED_CHARS },
    };
  },
};

/**
 * 流式读取一个 OOXML 部件里的可见文本。
 *
 * 状态机很浅：只需要知道「当前是不是在 <w:t> 里」，以及若干用于补分隔符的
 * 结构标签。刻意不建 DOM —— 那正是 mammoth 内存占用的来源。
 */
async function extractPartText(stream: Readable, collector: TextCollector): Promise<void> {
  let insideText = false;

  await parseXmlStream(stream, {
    maxBytes: MAX_PART_BYTES,

    onOpen(tag) {
      const name = localName(tag.name);
      if (name === "t") {
        insideText = true;
        return;
      }
      // 自闭合的非文本结构：补上占位分隔符，避免「张三李四」被粘成一个词。
      if (tag.isSelfClosing) {
        if (name === "tab") collector.append("\t");
        else if (name === "br" || name === "cr") collector.append("\n");
      }
    },

    onText(value) {
      if (insideText) collector.append(value);
    },

    onClose(tag) {
      const name = localName(tag.name);
      switch (name) {
        case "t":
          insideText = false;
          break;
        case "tc":
          collector.append("\t");
          break;
        case "p":
        case "tr":
          collector.append("\n");
          break;
        default:
          break;
      }
    },

    shouldStop: () => collector.truncated,
  });
}
