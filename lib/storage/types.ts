/**
 * 文件存储抽象层 · 类型定义（需求「七、文件存储必须抽象」）。
 *
 * 供应商资料是本产品最核心的数据，因此存储必须：
 * 1. 私有：产出物不允许出现在 public/ 下，也不产生公开静态 URL；
 * 2. 可替换：V0.1 用本地磁盘卷，未来换成阿里云 OSS 时业务代码不改；
 * 3. 可鉴权：需要下载时通过签名 URL（getSignedUrl），由服务端校验授权后放行。
 */

import type { Readable } from "node:stream";

export interface UploadInput {
  /** 存储键，必须由 buildStorageKey() 生成。 */
  key: string;
  data: Uint8Array;
  contentType?: string;
}

/**
 * 流式写入。
 *
 * 存在的唯一理由是内存：`upload()` 要求调用方先把整个文件拿在手里，
 * 而需求明确禁止这么做。上传路由一律走这个接口，字节从 HTTP 请求直接流到磁盘。
 *
 * 契约：
 * - 目标已存在时**必须报 CONFLICT**，不得覆盖（审计要求）；
 * - 失败时实现方必须清理掉自己写了一半的文件；
 * - 返回的 size / checksum 必须来自**实际写入的字节**，不是调用方的声明值。
 */
export interface UploadStreamInput {
  key: string;
  stream: Readable;
  contentType?: string;
  /**
   * 硬上限（字节），由调用方按业务规则给出（例如 zip 条目声明的解压大小）。
   * 实现方必须用**实际写入的字节数**卡这个上限，超出即中止并清理半成品 ——
   * 因为元数据里的声明大小是可以撒谎的。
   */
  maxBytes?: number;
}

export interface StoredObject {
  key: string;
  size: number;
  /** SHA-256 十六进制摘要。 */
  checksum: string;
  contentType?: string;
}

export interface SignedUrlOptions {
  /** 有效期（秒），默认 300。 */
  expiresInSeconds?: number;
  /** 建议的下载文件名，会作为查询参数透传，不参与签名。 */
  downloadFilename?: string;
}

export interface StorageProvider {
  readonly id: string;

  upload(input: UploadInput): Promise<StoredObject>;
  /** 流式写入。上传路由必须用它，避免把整份文件读进内存。 */
  uploadStream(input: UploadStreamInput): Promise<StoredObject>;
  download(key: string): Promise<Uint8Array>;
  /** 流式读取。下载路由必须用它。 */
  downloadStream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** 生成带签名与有效期的应用内下载地址。 */
  getSignedUrl(key: string, options?: SignedUrlOptions): Promise<string>;
  /**
   * 可选能力：本地绝对路径。
   *
   * 只有本地磁盘型后端能提供。按路径随机访问的解析器（yauzl 解 docx/xlsx/zip）
   * 依赖它；对象存储型后端返回 undefined，对应的解析器会如实降级并说明原因，
   * 而不是偷偷把文件先整份下载到内存里。
   */
  localPathFor?(key: string): string | undefined;
}
