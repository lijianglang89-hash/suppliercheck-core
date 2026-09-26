/**
 * 文件存储抽象层 · 类型定义（需求「七、文件存储必须抽象」）。
 *
 * 供应商资料是本产品最核心的数据，因此存储必须：
 * 1. 私有：产出物不允许出现在 public/ 下，也不产生公开静态 URL；
 * 2. 可替换：V0.1 用本地磁盘卷，未来换成阿里云 OSS 时业务代码不改；
 * 3. 可鉴权：需要下载时通过签名 URL（getSignedUrl），由服务端校验授权后放行。
 */

export interface UploadInput {
  /** 存储键，必须由 buildStorageKey() 生成。 */
  key: string;
  data: Uint8Array;
  contentType?: string;
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
  download(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** 生成带签名与有效期的应用内下载地址。 */
  getSignedUrl(key: string, options?: SignedUrlOptions): Promise<string>;
}
