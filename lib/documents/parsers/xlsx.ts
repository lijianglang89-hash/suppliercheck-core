/**
 * XLSX 纯文本提取（自建流式实现）。
 *
 * 选型经过实测，不是偏好（详见 docs/V0.2-REPORT.md 的依赖评估一节）：
 *
 * 1. `exceljs` 的流式读取器 `WorkbookReader` 有真实缺陷 —— 它在 `xl/workbook.xml`
 *    之前就处理 `xl/worksheets/*.xml`，而 zip 条目顺序由压缩方决定（exceljs 自己
 *    写出来的文件就是把 workbook.xml 放在最后），结果 `this.model` 仍是 undefined，
 *    直接抛 `TypeError: Cannot read properties of undefined (reading 'sheets')`。
 *    实测可复现。此外它本身 23 MB、拖入 40+ 个传递依赖（archiver / jszip /
 *    unzipper / fast-csv / dayjs…）。
 * 2. 非流式 API（`readFile`）会把整本工作簿建成 JS 对象，一个 20 MB 的表可能膨胀
 *    到几百 MB —— 直接违反内存红线。
 *
 * 因此改为 yauzl（按需打开单个 zip 条目）+ saxes（流式 SAX）自建：
 * 两次遍历同一个文件，第一遍只读元数据，第二遍逐行读表；命中行数/字符上限立刻停手。
 * 依赖增量 0（yauzl 与 saxes 已是本引擎的基础依赖）。
 *
 * 已处理的质量细节：
 *   - 空单元格：按 `r="C5"` 的列号补空位，保持制表符对齐（表格资料可读性关键）；
 *   - 共享字符串、内联字符串、公式结果、布尔、错误值均有对应分支；
 *   - 日期：识别内置/自定义日期格式，把 Excel 序列号转成 ISO 日期，
 *     而不是把 45678 这种数字直接丢给使用者。
 */

import type { Readable } from "node:stream";

import {
  XLSX_MAX_CELLS_TOTAL,
  XLSX_MAX_COLUMNS_PER_ROW,
  XLSX_MAX_ENTRY_UNCOMPRESSED_BYTES,
  XLSX_MAX_META_PART_BYTES,
  XLSX_MAX_ROWS_PER_SHEET,
  XLSX_MAX_ROWS_TOTAL,
  XLSX_MAX_SHARED_STRING_CHARS,
} from "../limits";
import { TextCollector, normalizeExtractedText } from "../text";
import { attr, localName, parseXmlStream } from "../xml-stream";
import { closeZipQuietly, openZip } from "../zip";
import { emptyOutcome, type DocumentParser, type ParseOutcome, type ParseSource } from "./types";

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const WORKBOOK_PART = "xl/workbook.xml";
const WORKBOOK_RELS_PART = "xl/_rels/workbook.xml.rels";
const SHARED_STRINGS_PART = "xl/sharedStrings.xml";
const STYLES_PART = "xl/styles.xml";

export const xlsxParser: DocumentParser = {
  id: "xlsx",
  supportedMimeTypes: [XLSX_MIME],

  supports(mimeType: string): boolean {
    return mimeType === XLSX_MIME;
  },

  async parse(source: ParseSource): Promise<ParseOutcome> {
    if (!source.localPath) {
      return emptyOutcome({
        parserId: this.id,
        notes: ["当前存储后端不支持按路径流式解析 XLSX，已跳过文本提取；文件本身已完整保存。"],
        meta: { extraction: "skipped", reason: "no_local_path" },
      });
    }

    const meta = await readWorkbookMeta(source.localPath);

    if (meta.sheets.length === 0) {
      return emptyOutcome({
        parserId: this.id,
        notes: ["未在工作簿中找到可读取的工作表。"],
        meta: { extraction: "empty_workbook" },
      });
    }

    const collector = new TextCollector();
    const sheetNotes: string[] = [];
    const sheetNames: string[] = [];
    let rowsTotal = 0;
    let cellsTotal = 0;
    let hitGlobalLimit = false;

    const zip = await openZip(source.localPath);
    try {
      for await (const entry of zip.eachEntry()) {
        const sheet = meta.sheets.find((candidate) => candidate.entryPath === entry.fileName);
        if (!sheet) {
          continue;
        }

        if (entry.uncompressedSize > XLSX_MAX_ENTRY_UNCOMPRESSED_BYTES) {
          sheetNotes.push(`工作表「${sheet.name}」体积超出上限，已跳过。`);
          continue;
        }

        sheetNames.push(sheet.name);
        collector.append(`\n## 工作表：${sheet.name}\n`);

        const stream = await zip.openReadStreamPromise(entry);
        const stats = await readSheet(stream, {
          collector,
          sharedStrings: meta.sharedStrings,
          dateStyleIndexes: meta.dateStyleIndexes,
          date1904: meta.date1904,
          remainingRows: Math.max(0, XLSX_MAX_ROWS_TOTAL - rowsTotal),
          remainingCells: Math.max(0, XLSX_MAX_CELLS_TOTAL - cellsTotal),
        });

        rowsTotal += stats.rows;
        cellsTotal += stats.cells;

        if (stats.hitLimit) {
          hitGlobalLimit = true;
          sheetNotes.push(`工作表「${sheet.name}」已读取前 ${stats.rows} 行后截断（达到行/单元格上限）。`);
        } else {
          sheetNotes.push(`工作表「${sheet.name}」共读取 ${stats.rows} 行。`);
        }

        if (collector.truncated || rowsTotal >= XLSX_MAX_ROWS_TOTAL || cellsTotal >= XLSX_MAX_CELLS_TOTAL) {
          hitGlobalLimit = true;
          break;
        }
      }
    } finally {
      closeZipQuietly(zip);
    }

    const text = normalizeExtractedText(collector.toString());
    const notes: string[] = [...sheetNotes];

    if (meta.sharedStringsTruncated) {
      notes.push("共享字符串表超出缓存上限，部分文本单元格可能显示为空。");
    }
    if (collector.truncated) {
      notes.push("累计文本已按上限截断。");
    }
    notes.push("公式按缓存的计算结果输出，不重新计算公式；图形、批注与图表不参与提取。");

    return {
      parserId: this.id,
      text,
      charCount: text.length,
      truncated: collector.truncated || hitGlobalLimit,
      sheetNames,
      notes,
      meta: {
        extraction: "ok",
        sheetCount: sheetNames.length,
        rows: rowsTotal,
        cells: cellsTotal,
        maxRowsPerSheet: XLSX_MAX_ROWS_PER_SHEET,
      },
    };
  },
};

/* ------------------------------------------------------------------ */
/* 第一遍：元数据                                                       */
/* ------------------------------------------------------------------ */

interface SheetRef {
  name: string;
  rId: string;
}

interface SheetTarget {
  name: string;
  entryPath: string;
}

interface WorkbookMeta {
  sheets: SheetTarget[];
  sharedStrings: string[];
  sharedStringsTruncated: boolean;
  dateStyleIndexes: Set<number>;
  date1904: boolean;
}

async function readWorkbookMeta(path: string): Promise<WorkbookMeta> {
  const sheetRefs: SheetRef[] = [];
  const rels = new Map<string, string>();
  const sharedStrings: string[] = [];
  const customDateFormats = new Set<number>();
  const dateStyleIndexes = new Set<number>();

  let date1904 = false;
  let sharedStringsTruncated = false;
  let cellXfsIndex = -1;
  let insideCellXfs = false;

  const zip = await openZip(path);
  try {
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName;
      if (
        name !== WORKBOOK_PART &&
        name !== WORKBOOK_RELS_PART &&
        name !== SHARED_STRINGS_PART &&
        name !== STYLES_PART
      ) {
        continue;
      }

      if (entry.uncompressedSize > XLSX_MAX_META_PART_BYTES) {
        continue;
      }

      const stream = await zip.openReadStreamPromise(entry);

      if (name === WORKBOOK_PART) {
        await parseXmlStream(stream, {
          maxBytes: XLSX_MAX_META_PART_BYTES,
          onOpen(tag) {
            const local = localName(tag.name);
            if (local === "workbookPr" && attr(tag, "date1904") === "1") {
              date1904 = true;
            }
            if (local === "sheet") {
              const rId = attr(tag, "r:id") || attr(tag, "id");
              const sheetName = attr(tag, "name");
              if (rId && sheetName) sheetRefs.push({ name: sheetName, rId });
            }
          },
        });
      } else if (name === WORKBOOK_RELS_PART) {
        await parseXmlStream(stream, {
          maxBytes: XLSX_MAX_META_PART_BYTES,
          onOpen(tag) {
            if (localName(tag.name) !== "Relationship") return;
            const type = attr(tag, "Type");
            const id = attr(tag, "Id");
            const target = attr(tag, "Target");
            const mode = attr(tag, "TargetMode");
            if (!id || !target) return;
            if (mode.toLowerCase() === "external") return;
            if (!type.endsWith("/worksheet")) return;
            rels.set(id, target);
          },
        });
      } else if (name === SHARED_STRINGS_PART) {
        const result = await collectSharedStrings(stream);
        sharedStrings.push(...result.items);
        sharedStringsTruncated = result.truncated;
      } else {
        // styles.xml：只需要 cellXfs 里每个样式对应的 numFmtId，用来判断某列是不是日期。
        await parseXmlStream(stream, {
          maxBytes: XLSX_MAX_META_PART_BYTES,
          onOpen(tag) {
            const local = localName(tag.name);
            if (local === "numFmt") {
              const id = Number.parseInt(attr(tag, "numFmtId"), 10);
              const code = attr(tag, "formatCode");
              if (Number.isFinite(id) && isDateLikeFormatCode(code)) customDateFormats.add(id);
              return;
            }
            if (local === "cellXfs") {
              insideCellXfs = true;
              return;
            }
            if (local === "xf" && insideCellXfs) {
              cellXfsIndex += 1;
              const numFmtId = Number.parseInt(attr(tag, "numFmtId"), 10);
              if (BUILTIN_DATE_FORMAT_IDS.has(numFmtId) || customDateFormats.has(numFmtId)) {
                dateStyleIndexes.add(cellXfsIndex);
              }
            }
          },
          onClose(tag) {
            if (localName(tag.name) === "cellXfs") insideCellXfs = false;
          },
        });
      }
    }
  } finally {
    closeZipQuietly(zip);
  }

  const sheets: SheetTarget[] = [];
  for (const ref of sheetRefs) {
    const target = rels.get(ref.rId);
    const entryPath = target ? normalizePartPath(target) : undefined;
    if (!entryPath) continue;
    sheets.push({ name: ref.name, entryPath });
  }

  return { sheets, sharedStrings, sharedStringsTruncated, dateStyleIndexes, date1904 };
}

/** 把 rels 里的 Target 归一化成包内绝对路径，并只接受 worksheets 目录。 */
function normalizePartPath(target: string): string | undefined {
  const cleaned = target.replace(/\\/g, "/").replace(/^\/+/, "");
  const normalized = cleaned.startsWith("xl/") ? cleaned : `xl/${cleaned}`;
  if (normalized.includes("..")) return undefined;
  return /^xl\/worksheets\/[^/]+\.xml$/i.test(normalized) ? normalized : undefined;
}

interface SharedStringsResult {
  items: string[];
  truncated: boolean;
}

async function collectSharedStrings(stream: Readable): Promise<SharedStringsResult> {
  const items: string[] = [];
  let current: string[] | undefined;
  let insideText = false;
  let cachedChars = 0;
  let truncated = false;

  await parseXmlStream(stream, {
    maxBytes: XLSX_MAX_META_PART_BYTES,
    onOpen(tag) {
      const local = localName(tag.name);
      if (local === "si") current = [];
      else if (local === "t") insideText = true;
    },
    onText(value) {
      if (!current || !insideText) return;
      const remaining = XLSX_MAX_SHARED_STRING_CHARS - cachedChars;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      const appended = value.length <= remaining ? value : value.slice(0, remaining);
      cachedChars += appended.length;
      if (appended.length < value.length) truncated = true;
      current.push(appended);
    },
    onClose(tag) {
      const local = localName(tag.name);
      if (local === "t") {
        insideText = false;
      } else if (local === "si") {
        items.push(current ? current.join("") : "");
        current = undefined;
      }
    },
    shouldStop: () => truncated,
  });

  return { items, truncated };
}

/** 内置的日期/时间数字格式 ID（ECMA-376 第 18.8.30 节）。 */
const BUILTIN_DATE_FORMAT_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47,
  50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

/** 自定义格式串是否像日期：去掉引号内字面量与方括号段落后，看是否含 y/m/d/h/s。 */
export function isDateLikeFormatCode(code: string): boolean {
  if (!code) return false;
  const stripped = code
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\\./g, "");
  return /[ymdhs]/i.test(stripped);
}

/* ------------------------------------------------------------------ */
/* 第二遍：逐行读表                                                     */
/* ------------------------------------------------------------------ */

interface ReadSheetOptions {
  collector: TextCollector;
  sharedStrings: string[];
  dateStyleIndexes: Set<number>;
  date1904: boolean;
  remainingRows: number;
  remainingCells: number;
}

interface SheetStats {
  rows: number;
  cells: number;
  hitLimit: boolean;
}

async function readSheet(stream: Readable, options: ReadSheetOptions): Promise<SheetStats> {
  const { collector, sharedStrings } = options;
  const rowLimit = Math.min(XLSX_MAX_ROWS_PER_SHEET, options.remainingRows);
  const cellLimit = options.remainingCells;

  const stats: SheetStats = { rows: 0, cells: 0, hitLimit: false };
  if (rowLimit <= 0 || cellLimit <= 0) {
    stats.hitLimit = true;
    stream.destroy();
    return stats;
  }

  /** 当前行的单元格（已按列号补空位）。 */
  const row: string[] = [];
  /** 下一个待写入的列号，用于补空位。 */
  let columnCursor = 0;

  let inCell = false;
  let cellType = "";
  let cellStyle = "";
  let inValue = false;
  let insideText = false;
  let valueParts: string[] = [];
  let textParts: string[] = [];
  let stop = false;

  await parseXmlStream(stream, {
    maxBytes: XLSX_MAX_ENTRY_UNCOMPRESSED_BYTES,

    onOpen(tag) {
      switch (localName(tag.name)) {
        case "c": {
          inCell = true;
          cellType = attr(tag, "t");
          cellStyle = attr(tag, "s");
          valueParts = [];
          textParts = [];

          // 空单元格在 XML 里根本不出现，用 r="C5" 的列号补位，保证表格对齐。
          const index = columnIndexFromRef(attr(tag, "r"));
          if (index !== undefined && index > columnCursor) {
            const target = Math.min(index, XLSX_MAX_COLUMNS_PER_ROW);
            while (columnCursor < target) {
              row.push("");
              columnCursor += 1;
            }
          }
          break;
        }
        case "v":
          inValue = true;
          break;
        case "t":
          insideText = true;
          break;
        case "is":
          // 内联字符串容器：其内部 <t> 由 insideText 分支处理，无需额外状态。
          break;
        default:
          break;
      }
    },

    onText(value) {
      if (inValue) valueParts.push(value);
      else if (insideText && inCell) textParts.push(value);
    },

    onClose(tag) {
      switch (localName(tag.name)) {
        case "v":
          inValue = false;
          break;
        case "t":
          insideText = false;
          break;
        case "c": {
          if (!inCell) break;
          inCell = false;
          inValue = false;
          insideText = false;

          if (columnCursor < XLSX_MAX_COLUMNS_PER_ROW) {
            row.push(
              resolveCellValue({
                type: cellType,
                styleIndex: cellStyle,
                rawValue: valueParts.join(""),
                inlineText: textParts.join(""),
                sharedStrings,
                dateStyleIndexes: options.dateStyleIndexes,
                date1904: options.date1904,
              }),
            );
            columnCursor += 1;
            stats.cells += 1;
          }
          break;
        }
        case "row": {
          collector.append(trimTrailingEmpty(row).join("\t"));
          collector.append("\n");
          row.length = 0;
          columnCursor = 0;
          stats.rows += 1;

          if (stats.rows >= rowLimit || stats.cells >= cellLimit) {
            stats.hitLimit = true;
            stop = true;
          }
          break;
        }
        default:
          break;
      }
    },

    shouldStop: () => collector.truncated || stop,
  });

  return stats;
}

interface ResolveCellValueInput {
  type: string;
  styleIndex: string;
  rawValue: string;
  inlineText: string;
  sharedStrings: string[];
  dateStyleIndexes: Set<number>;
  date1904: boolean;
}

function resolveCellValue(input: ResolveCellValueInput): string {
  switch (input.type) {
    case "s": {
      const index = Number.parseInt(input.rawValue, 10);
      if (!Number.isFinite(index)) return "";
      return input.sharedStrings[index] ?? "";
    }
    case "inlineStr":
      return input.inlineText;
    case "str":
      return input.rawValue;
    case "b":
      return input.rawValue === "1" ? "TRUE" : "FALSE";
    case "e":
      return input.rawValue;
    case "d":
      return input.rawValue;
    default: {
      if (input.rawValue === "") return "";
      const numeric = Number(input.rawValue);
      const styleIndex = Number.parseInt(input.styleIndex, 10);
      if (
        Number.isFinite(numeric) &&
        Number.isFinite(styleIndex) &&
        input.dateStyleIndexes.has(styleIndex)
      ) {
        return excelSerialToIso(numeric, input.date1904);
      }
      return input.rawValue;
    }
  }
}

/** `C12` → 2（0 基列号）。只解析字母部分。 */
export function columnIndexFromRef(ref: string): number | undefined {
  const match = /^([A-Za-z]{1,3})\d*$/.exec(ref.trim());
  if (!match || !match[1]) return undefined;
  const letters = match[1].toUpperCase();
  let index = 0;
  for (const char of letters) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

const MS_PER_DAY = 86_400_000;
/** 1900 历法的基准（已计入 Excel 把 1900 当闰年的历史 bug）。 */
const EPOCH_1900 = Date.UTC(1899, 11, 30);
const EPOCH_1904 = Date.UTC(1904, 0, 1);
const MAX_SERIAL = 2_958_465; // 9999-12-31

export function excelSerialToIso(serial: number, date1904: boolean): string {
  if (!Number.isFinite(serial) || serial < 0 || serial > MAX_SERIAL) {
    return String(serial);
  }

  const wholeDays = Math.floor(serial);
  const fraction = serial - wholeDays;
  const base = date1904 ? EPOCH_1904 : EPOCH_1900;
  const timestamp = base + wholeDays * MS_PER_DAY;

  if (fraction === 0) {
    return new Date(timestamp).toISOString().slice(0, 10);
  }

  const totalSeconds = Math.round(fraction * 86_400);
  return new Date(timestamp + totalSeconds * 1000).toISOString().replace("T", " ").slice(0, 19);
}

function trimTrailingEmpty(cells: string[]): string[] {
  let end = cells.length;
  while (end > 0 && cells[end - 1] === "") end -= 1;
  return end === cells.length ? cells : cells.slice(0, end);
}
