/**
 * DocumentParser 抽象。
 *
 * 设计目标（Agent 02 第 4 条）：把「读什么格式」和「怎么用文本」彻底解耦。
 * 上层只认识 `DocumentParser`，未来接入真 OCR、接入外部解析 API 时，
 * 只需要在 ./registry.ts 注册一个新实现，上传/状态机/入库代码一行都不用改。
 *
 * 关于内存：ParseSource 故意**不给绝对路径以外的随机访问能力**，
 * 而是提供 openStream()（流式）与 readAll()（整体读取，需调用方先自查上限）两条路，
 * 让「整体读取」成为一个必须显式做出的决定，而不是不知不觉的默认行为。
 */

import type { Readable } from "node:stream";

/** 解析输入。由 service 层从 StorageProvider 构造。 */
export interface ParseSource {
  /** 规范化后的 MIME（来自白名单反查，不是用户声明值）。 */
  readonly mimeType: string;
  /** 字节数（来自数据库记录，不是用户声明值）。 */
  readonly size: number;
  /** 原始文件名，仅用于日志与提示。 */
  readonly originalFilename: string;
  /**
   * 本地绝对路径。仅当存储后端是本地磁盘时存在。
   * 支持按路径流式读取的库（mammoth、yauzl）应优先使用它，避免多一层拷贝。
   */
  readonly localPath?: string;
  /** 打开一个新的只读流（每次调用都应返回全新的、从头开始的流）。 */
  openStream(): Promise<Readable>;
  /**
   * 把文件整体读成字节。
   *
   * ⚠️ 调用方**必须**先用 `size` 与自己的限额比对再调用。
   * 这里的注释就是这条规则的落点：整个引擎里只有 PDF 解析器被允许调用它。
   */
  readAll(): Promise<Uint8Array>;
}

/** 解析产出。刻意把「不完整」显式建模成字段，而不是靠约定。 */
export interface ParseOutcome {
  /** 实际干活的解析器标识，落库便于追溯。 */
  parserId: string;
  /** 归一化后的纯文本。 */
  text: string;
  /** 保留的字符数（截断后）。 */
  charCount: number;
  /** 是否发生截断（触顶或格式限制导致内容不完整）。 */
  truncated: boolean;
  /** 页数，仅 PDF 等分页格式提供。 */
  pageCount?: number;
  /** 工作表名列表，仅 XLSX 提供。 */
  sheetNames?: string[];
  /**
   * 面向使用者的说明，会持久化并展示在资料库中。
   * 例：「该 PDF 为扫描件，未提取到文本层」「Excel 已读取前 5000 行」。
   * 这里写的内容必须能被非技术用户看懂。
   */
  notes: string[];
  /** 结构化附加信息，仅用于诊断与后续阶段。 */
  meta: Record<string, unknown>;
}

export interface DocumentParser {
  /** 稳定标识，落库后不要改名。 */
  readonly id: string;
  /** 该解析器能处理的 MIME 列表。 */
  readonly supportedMimeTypes: readonly string[];
  supports(mimeType: string): boolean;
  parse(source: ParseSource): Promise<ParseOutcome>;
}

/** 构造一个「什么都没解析出来」的结果，用于不支持或降级的场景。 */
export function emptyOutcome(params: {
  parserId: string;
  notes?: string[];
  meta?: Record<string, unknown>;
  truncated?: boolean;
}): ParseOutcome {
  return {
    parserId: params.parserId,
    text: "",
    charCount: 0,
    truncated: params.truncated ?? false,
    notes: params.notes ?? [],
    meta: params.meta ?? {},
  };
}
