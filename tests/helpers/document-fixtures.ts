/**
 * 文档夹具生成器。
 *
 * 为什么用代码生成而不是提交二进制样本：
 * 1. Git 里不放二进制，diff 可读；
 * 2. 每个夹具的**内容**在代码里一目了然，测试断言才有意义 ——
 *    否则「断言提取到某段文字」会变成「断言碰巧和那个 .docx 里的内容一致」；
 * 3. 可以精确构造边界样本（空单元格、日期格式、嵌套压缩包、压缩炸弹）。
 *
 * 生成的 zip 条目顺序刻意把 `xl/workbook.xml` 放在**最后** ——
 * 这正好是 exceljs 的 WorkbookReader 会崩的顺序（见 docs/V0.2-REPORT.md），
 * 用作我们两遍式实现的回归保护。
 */

import { createWriteStream } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import yazl from "yazl";

/** 建一个临时目录，调用方负责在测试结束时清理（或交给 OS 的临时目录策略）。 */
export async function makeTempDir(prefix = "sc-test-"): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

/**
 * 手工构造一个只有一个页面、含可提取文本层的合法 PDF。
 *
 * ⚠️ **只支持 ASCII 文本。** 这不是偷懒，是这类合成夹具的硬限制，记清楚：
 * PDF 里有两种写法可以放字符串 —— `(...)` 字面量（按 PDFDocEncoding 解释，装不下中文）
 * 和 `<FEFF....>` 的 UTF-16BE hex 字符串。第二种**写入**没问题，但**读取**时
 * pdf.js 会按当前字体的编码（本例是标准 14 字体 Helvetica → WinAnsi）逐字节映射，
 * 于是中文变成乱码 —— 想让它正确还原，必须嵌入带 ToUnicode CMap 的字体程序，
 * 那已经不是「最小夹具」了。
 *
 * 因此：**PDF 的中文提取能力无法用本夹具覆盖**。真实的中文 PDF 会自带
 * 字体与 ToUnicode 表，pdf.js 能正常提取；而「合成 PDF 能提中文」这件事只能靠
 * 真实文件验证。XLSX / DOCX 的中文覆盖不受影响（它们是纯 UTF-8 XML）。
 */
export function buildMinimalPdf(text: string): Buffer {
  const escaped = text.replace(/[\\()]/g, (char) => `\\${char}`);
  const content = `BT /F1 24 Tf 72 700 Td (${escaped}) Tj ET`;

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets[index] = Buffer.byteLength(out, "latin1");
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefPosition = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPosition}\n%%EOF\n`;

  return Buffer.from(out, "latin1");
}

/* ------------------------------------------------------------------ */
/* DOCX                                                                */
/* ------------------------------------------------------------------ */

const DOCX_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const DOCX_ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

export interface DocxFixtureInput {
  /** document.xml 的 body 内部 XML。 */
  bodyXml: string;
  /** 可选的脚注部件。 */
  footnotesXml?: string;
}

export function buildMinimalDocx(input: DocxFixtureInput): Promise<Buffer> {
  const entries: Array<[string, Buffer]> = [
    ["[Content_Types].xml", Buffer.from(DOCX_CONTENT_TYPES, "utf8")],
    ["_rels/.rels", Buffer.from(DOCX_ROOT_RELS, "utf8")],
    [
      "word/document.xml",
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${input.bodyXml}</w:body></w:document>`,
        "utf8",
      ),
    ],
  ];

  if (input.footnotesXml) {
    entries.push([
      "word/footnotes.xml",
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${input.footnotesXml}</w:footnotes>`,
        "utf8",
      ),
    ]);
  }

  return buildZip(entries);
}

/** 一个覆盖段落、制表符、表格单元格与域代码的典型正文。 */
export const SAMPLE_DOCX_BODY = [
  "<w:p><w:r><w:t>资质证书持有人：</w:t></w:r><w:r><w:t>示例科技</w:t></w:r></w:p>",
  "<w:p><w:r><w:t>有效期至</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>2027-12-31</w:t></w:r></w:p>",
  "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>项目</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>结论</w:t></w:r></w:p></w:tc></w:tr></w:tbl>",
  "<w:p><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:t>正文结尾</w:t></w:r></w:p>",
].join("");

/* ------------------------------------------------------------------ */
/* XLSX                                                                */
/* ------------------------------------------------------------------ */

export interface XlsxFixtureInput {
  sheetName?: string;
  sharedStringsXml: string;
  sheetXml: string;
  stylesXml?: string;
}

const DEFAULT_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
<xf numFmtId="14" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>
</cellXfs>
</styleSheet>`;

export function buildMinimalXlsx(input: XlsxFixtureInput): Promise<Buffer> {
  const sheetName = input.sheetName ?? "控制项";

  const contentTypes = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    "utf8",
  );

  const rootRels = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    "utf8",
  );

  const workbookRels = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    "utf8",
  );

  const workbook = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<workbookPr/>
<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    "utf8",
  );

  const sharedStrings = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3">${input.sharedStringsXml}</sst>`,
    "utf8",
  );

  const sheet = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${input.sheetXml}</sheetData></worksheet>`,
    "utf8",
  );

  // ⚠️ 顺序刻意打乱：workbook.xml 放最后，复现 exceljs WorkbookReader 的已知崩溃顺序。
  return buildZip([
    ["[Content_Types].xml", contentTypes],
    ["_rels/.rels", rootRels],
    ["xl/styles.xml", Buffer.from(input.stylesXml ?? DEFAULT_STYLES_XML, "utf8")],
    ["xl/sharedStrings.xml", sharedStrings],
    ["xl/worksheets/sheet1.xml", sheet],
    ["xl/_rels/workbook.xml.rels", workbookRels],
    ["xl/workbook.xml", workbook],
  ]);
}

/** 覆盖共享串、内联串、公式结果、布尔、错误值、日期与空单元格的典型工作表。 */
export const SAMPLE_XLSX_SHARED_STRINGS = [
  "<si><t>控制编号</t></si>",
  "<si><t>是否文档化？</t></si>",
  // 富文本：多段 run 应被拼接
  "<si><r><t>富文本</t></r><r><t>拼接</t></r></si>",
].join("");

export const SAMPLE_XLSX_SHEET = [
  '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>',
  '<row r="2"><c r="A2" t="inlineStr"><is><t>内联文本</t></is></c><c r="C2"><v>123.5</v></c></row>',
  '<row r="3"><c r="A3" s="1"><v>45678</v></c><c r="B3" s="2"><v>45678</v></c><c r="C3" t="b"><v>1</v></c></row>',
  '<row r="4"><c r="B4" t="str"><v>公式结果</v></c><c r="D4" t="e"><v>#REF!</v></c></row>',
  '<row r="5"><c r="B5"/></row>',
].join("");

/* ------------------------------------------------------------------ */
/* ZIP                                                                 */
/* ------------------------------------------------------------------ */

/** 用 yazl 打一个 zip（deflate）。 */
export function buildZip(entries: ReadonlyArray<readonly [string, Buffer]>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const [name, content] of entries) {
      zip.addBuffer(content, name);
    }
    zip.end();

    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on("error", reject);
  });
}

/**
 * 构造一个「压缩炸弹」：内容全为零字节，deflate 压缩比极高。
 * 用于验证 archive.ts 在**解压之前**就把它拦下来。
 */
export function buildZipBomb(params: {
  entryName: string;
  declaredUncompressedBytes: number;
}): Promise<Buffer> {
  return buildZip([[params.entryName, Buffer.alloc(params.declaredUncompressedBytes, 0)]]);
}

/* ------------------------------------------------------------------ */
/* 原始 zip 写入器（用于构造 yazl 会拒绝的恶意样本）                     */
/* ------------------------------------------------------------------ */

/**
 * 手写 zip 字节。
 *
 * 为什么需要它：yazl 会主动拒绝 `..` 路径和以 `/` 结尾的条目名 —— 也就是说
 * **用一个守规矩的库造不出攻击样本**。要测「路径穿越被拦住」「目录条目被跳过」
 * 「central directory 里的大小声明与实际不符」，只能自己拼字节。
 *
 * 采用 store（不压缩，method=0）：构造简单，且天然避免压缩比干扰其他断言。
 * flag 置 0x0800（UTF-8 名称），与 yauzl 的 decodeStrings 对齐。
 */
export interface RawZipEntry {
  name: string;
  content: Buffer;
  /** 伪造 central directory 里声明的大小（用于测试「元数据撒谎」）。 */
  declaredUncompressedSize?: number;
  /**
   * 伪造 central directory 里声明的压缩后大小。
   *
   * 为什么需要它：yauzl 对 store(method=0) 条目会强制校验
   * `compressedSize === uncompressedSize + (加密 ? 12 : 0)`。
   * 也就是说，要造出一个「能通过 size 校验、但真的携带加密标记」的样本，
   * 必须让压缩后大小比解压后大小多 12 字节（伪造的加密头）。
   * 否则样本会先被 size 校验拦下，测到的就不是「拒绝加密条目」这条闸门了。
   */
  declaredCompressedSize?: number;
  /** 是否在 central directory 里标记为加密。 */
  markEncrypted?: boolean;
}

export function buildRawZip(entries: readonly RawZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.content);
    const declared = entry.declaredUncompressedSize ?? entry.content.byteLength;
    const declaredCompressed = entry.declaredCompressedSize ?? entry.content.byteLength;
    // bit 11 = UTF-8 名称；bit 0 = 加密
    const flags = 0x0800 | (entry.markEncrypted ? 0x0001 : 0);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(0, 8); // store
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(declaredCompressed, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);

    localParts.push(local, nameBytes, entry.content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(declaredCompressed, 20);
    central.writeUInt32LE(declared, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);

    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + entry.content.byteLength;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.byteLength, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

/** 标准 CRC-32（zip 使用的那种）。 */
function crc32(buffer: Buffer): number {
  let table = CRC_TABLE;
  if (!table) {
    table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[index] = value >>> 0;
    }
    CRC_TABLE = table;
  }

  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

let CRC_TABLE: Uint32Array | undefined;

/* ------------------------------------------------------------------ */
/* 落盘辅助                                                            */
/* ------------------------------------------------------------------ */

export async function writeFixture(directory: string, filename: string, content: Buffer): Promise<string> {
  const filePath = path.join(directory, filename);
  await writeFile(filePath, content);
  return filePath;
}

/** 供需要「写入流」的测试使用。 */
export function writeStreamToFile(filePath: string, content: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(filePath);
    stream.on("close", resolve);
    stream.on("error", reject);
    stream.end(content);
  });
}

/** 生成一段可控长度的可压缩文本。 */
export function repeatText(unit: string, times: number): string {
  return new Array(times).fill(unit).join("");
}
