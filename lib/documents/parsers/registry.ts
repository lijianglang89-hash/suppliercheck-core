/**
 * 解析器注册表。
 *
 * 上层只通过 `selectParser(mimeType)` 拿解析器，永远不 import 具体实现 ——
 * 这样加一种格式（比如接入外部 OCR 后的扫描件）只需要在这里加一行。
 *
 * 不变量：MIME 白名单（lib/files.ts 的 ALLOWED_MIME_TYPES）里的每一种，
 * 都必须能在这里找到解析器。由单元测试守住这条不变量。
 */

import { errors } from "@/lib/errors";

import { archiveParser } from "./archive";
import { docxParser } from "./docx";
import { imageParser } from "./image";
import { pdfParser } from "./pdf";
import type { DocumentParser } from "./types";
import { xlsxParser } from "./xlsx";

/** 注册顺序即优先级；当前各解析器支持的 MIME 互不重叠。 */
export const PARSERS: readonly DocumentParser[] = [
  pdfParser,
  docxParser,
  xlsxParser,
  archiveParser,
  imageParser,
];

/** 兜底解析器：白名单里出现了没有实现的类型时使用，如实说明而不是抛错。 */
const unsupportedParser: DocumentParser = {
  id: "unsupported",
  supportedMimeTypes: [],
  supports: () => false,
  async parse(source) {
    return {
      parserId: "unsupported",
      text: "",
      charCount: 0,
      truncated: false,
      notes: [`暂不支持解析该类型（${source.mimeType}）。文件已完整保存。`],
      meta: { extraction: "unsupported", mimeType: source.mimeType },
    };
  },
};

export function selectParser(mimeType: string): DocumentParser {
  const normalized = (mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const parser = PARSERS.find((candidate) => candidate.supports(normalized));
  if (!parser) {
    // 不抛错：让文档落到「已保存但无文本」，比整份失败更符合使用者的实际预期。
    return unsupportedParser;
  }
  return parser;
}

/** 供诊断与测试使用：列出当前已注册的解析器 id。 */
export function listParserIds(): string[] {
  return [...PARSERS.map((parser) => parser.id), unsupportedParser.id];
}

/** 供测试使用：断言每种白名单 MIME 都有解析器（不包含兜底）。 */
export function findParserForMimeType(mimeType: string): DocumentParser | undefined {
  return PARSERS.find((candidate) => candidate.supports(mimeType));
}

/** 类型守卫式的断言：注册表出现空档时立刻暴露，而不是在生产里静默降级。 */
export function assertParserCoverage(mimeTypes: readonly string[]): void {
  const missing = mimeTypes.filter((mimeType) => !findParserForMimeType(mimeType));
  if (missing.length > 0) {
    throw errors.configuration("存在没有解析器的文件类型。", { details: { missing } });
  }
}
