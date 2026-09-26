/**
 * 流式 XML 解析底座（供 XLSX 自建解析器使用）。
 *
 * 为什么不直接用某个「读 Excel / 读 Word」的重型库：
 * Agent 02 明确要求「极其轻量的纯 JS/TS 解析库」并给出内存红线。实测结论（详见
 * docs/V0.2-REPORT.md）：
 *   - `exceljs` 的流式读取器 WorkbookReader 存在顺序依赖缺陷（zip 中央目录里
 *     `xl/workbook.xml` 排在 worksheet 之后时，`this.model` 仍是 undefined，
 *     直接抛 TypeError），且它本身 23 MB、拖入 40+ 个传递依赖；
 *   - 因此 XLSX 改为「yauzl 解 zip + saxes 流式读 XML」自建，
 *     依赖体积从 23 MB 降到 172 KB，并且真的做到逐行读取、随时可停。
 *
 * saxes 是纯 JS 的 SAX 解析器，无原生依赖，是 exceljs 自己也在用的同款底座。
 */

import { StringDecoder } from "node:string_decoder";
import type { Readable } from "node:stream";

import { SaxesParser } from "saxes";

import { errors } from "@/lib/errors";

/** 简化版的标签信息：不需要命名空间时只保留名字与属性。 */
export interface SaxTag {
  name: string;
  attributes: Record<string, string>;
  isSelfClosing: boolean;
}

export interface SaxStreamHandlers {
  onOpen?: (tag: SaxTag) => void;
  onClose?: (tag: SaxTag) => void;
  onText?: (text: string) => void;
  /** 返回 true 时停止解析并正常返回（用于命中上限后提前收工）。 */
  shouldStop?: () => boolean;
}

export interface ParseXmlStreamOptions extends SaxStreamHandlers {
  /** 允许消费的最大 XML 字节数，超出即报错。省略则不限制。 */
  maxBytes?: number;
}

/**
 * 逐块消费 XML 流。
 *
 * 三个容易踩的坑，这里都处理了：
 *
 * 1. **不能开 `fragment: true`。** 实测（见 docs/V0.2-REPORT.md）saxes 在 fragment
 *    模式下会拒绝 `<?xml ... ?>` 声明，报「an XML declaration must be at the start of
 *    the document」—— 而 OOXML 的每一个部件几乎都带声明。因此用默认的单根文档模式，
 *    这与 OOXML 部件的真实结构一致（一个根元素）。
 * 2. **多字节字符跨块**：直接用 `chunk.toString("utf8")` 会把跨块的汉字切坏，
 *    必须用 StringDecoder 缓冲不完整的多字节序列；同时首块要剥掉 BOM，
 *    否则 `\uFEFF<?xml` 也会被判定成「声明不在文档开头」。
 * 3. **提前退出**：命中行数/字符上限后要立刻停止，不能把整个工作表读完，
 *    否则前面对内存的克制就白做了。这里通过 break 停止读取源流，
 *    由调用方负责销毁流。
 */
export async function parseXmlStream(
  stream: Readable,
  options: ParseXmlStreamOptions,
): Promise<void> {
  const parser = new SaxesParser({ xmlns: false, position: false });
  const decoder = new StringDecoder("utf8");

  let parseError: Error | undefined;
  parser.on("error", (error) => {
    parseError = error;
  });

  parser.on("opentag", (tag) => {
    options.onOpen?.({
      name: tag.name,
      attributes: (tag.attributes ?? {}) as Record<string, string>,
      isSelfClosing: tag.isSelfClosing ?? false,
    });
  });

  parser.on("closetag", (tag) => {
    options.onClose?.({
      name: tag.name,
      attributes: (tag.attributes ?? {}) as Record<string, string>,
      isSelfClosing: tag.isSelfClosing ?? false,
    });
  });

  parser.on("text", (text) => {
    options.onText?.(text);
  });

  let consumed = 0;
  let first = true;

  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      consumed += buffer.length;

      if (options.maxBytes !== undefined && consumed > options.maxBytes) {
        throw errors.validation("文档内部 XML 体积超出上限，已中止解析。");
      }

      let text = decoder.write(buffer);
      if (first) {
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
        first = false;
      }

      parser.write(text);
      if (parseError) throw parseError;
      if (options.shouldStop?.()) break;
    }
  } finally {
    // 提前 break 时必须显式销毁源流，否则 yauzl 的条目流会一直挂着。
    if (!stream.destroyed) stream.destroy();
  }

  // 刻意不调用 parser.close()：
  // 命中上限提前退出时文档本来就不完整，调用 close 会稳定报「未闭合」，
  // 把「有意截断」误判成「文件损坏」。完整性由 yauzl 的条目大小校验负责。
  if (parseError) throw parseError;
}

/** 从标签属性里取一个字符串属性，缺省返回空串。 */
export function attr(tag: SaxTag, name: string): string {
  return tag.attributes[name] ?? "";
}

/**
 * 标签名去命名空间前缀：`w:t` → `t`，`c` → `c`。
 *
 * 需要它的原因：同一份 OOXML 既可能写成带前缀（`<w:t>`，Word 的常见写法），
 * 也可能用默认命名空间（`<t>`）。按**本地名**比较可以同时覆盖两种，不用开 xmlns 解析。
 */
export function localName(name: string): string {
  const index = name.lastIndexOf(":");
  return index === -1 ? name : name.slice(index + 1);
}
