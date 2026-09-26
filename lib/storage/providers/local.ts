/**
 * 本地私有磁盘存储实现（V0.1 默认）。
 *
 * 安全性要点：
 * - 根目录来自 STORAGE_PATH，默认 ./data/uploads，位于 public/ 之外；
 * - 每次读写前都做 `assertSafeStorageKey` + realpath 前缀复核，双保险防路径穿越；
 * - 文件权限显式设为 0640（目录 0750），不依赖 umask；
 * - 不生成、也不暴露任何静态公开 URL。
 */
import { createHash } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { PassThrough, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";

import { AppError, errors } from "@/lib/errors";
import { assertSafeStorageKey } from "@/lib/files";

import { encodeStorageKey, signStorageKey } from "../signature";
import type {
  SignedUrlOptions,
  StorageProvider,
  StoredObject,
  UploadInput,
  UploadStreamInput,
} from "../types";

const DEFAULT_EXPIRES_SECONDS = 300;
const FILE_MODE = 0o640;
const DIR_MODE = 0o750;

export interface LocalStorageProviderOptions {
  /** 私有存储根目录。 */
  rootDir: string;
  /** 签名密钥，通常来自 SESSION_SECRET。 */
  secret: string;
  /** 生成签名 URL 时使用的站点根地址。 */
  appUrl: string;
  /** 签名 URL 的默认有效期（秒）。 */
  defaultExpiresInSeconds?: number;
}

export class LocalStorageProvider implements StorageProvider {
  readonly id = "local";

  private readonly rootDir: string;
  private readonly secret: string;
  private readonly appUrl: string;
  private readonly defaultExpires: number;

  constructor(options: LocalStorageProviderOptions) {
    this.rootDir = path.resolve(options.rootDir);
    this.secret = options.secret;
    this.appUrl = options.appUrl.replace(/\/+$/, "");
    this.defaultExpires = options.defaultExpiresInSeconds ?? DEFAULT_EXPIRES_SECONDS;
  }

  /** 把存储键映射为绝对路径，并确保结果始终落在 rootDir 之内。 */
  private resolvePath(key: string): string {
    assertSafeStorageKey(key);
    const absolute = path.resolve(this.rootDir, key);
    const rootWithSep = this.rootDir.endsWith(path.sep) ? this.rootDir : `${this.rootDir}${path.sep}`;
    if (!absolute.startsWith(rootWithSep)) {
      throw errors.unsafeFileName("存储键解析后越出存储根目录。");
    }
    return absolute;
  }

  async upload(input: UploadInput): Promise<StoredObject> {
    const absolute = this.resolvePath(input.key);
    try {
      await mkdir(path.dirname(absolute), { recursive: true, mode: DIR_MODE });
      await writeFile(absolute, input.data, { mode: FILE_MODE, flag: "wx" });
    } catch (error) {
      if (isAlreadyExists(error)) {
        throw errors.conflict("该存储键已存在，拒绝覆盖。", { details: { key: input.key } });
      }
      throw errors.storage("写入文件失败。", { cause: error, details: { key: input.key } });
    }

    return {
      key: input.key,
      size: input.data.byteLength,
      checksum: createHash("sha256").update(input.data).digest("hex"),
      contentType: input.contentType,
    };
  }

  /**
   * 流式写入：字节从来源直接落到磁盘，全程不拼 Buffer。
   *
   * 三个实现要点：
   * 1. `flags: "wx"` —— 独占创建，天然满足「绝不覆盖既有文件」的审计要求，
   *    而且不像 `exists()` + `writeFile()` 那样存在竞态窗口；
   * 2. 边写边算 SHA-256 与字节数，返回的是**实际落盘字节**的结果，
   *    不是调用方的声明值（声明的 size 可能是假的）；
   * 3. 任何失败路径都必须删掉半成品文件，否则磁盘上会留下永远查不到主的数据。
   */
  async uploadStream(input: UploadStreamInput): Promise<StoredObject> {
    const absolute = this.resolvePath(input.key);
    await mkdir(path.dirname(absolute), { recursive: true, mode: DIR_MODE });

    const hash = createHash("sha256");
    const maxBytes = input.maxBytes;
    let size = 0;
    let failure: unknown;

    const meter = new PassThrough({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        // 用实际字节数卡上限：条目元数据里声明的解压大小是可以撒谎的。
        if (maxBytes !== undefined && size > maxBytes) {
          callback(errors.fileTooLarge("文件超出大小限制。", { details: { maxBytes } }));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(
        input.stream as Readable,
        meter,
        createWriteStream(absolute, { flags: "wx", mode: FILE_MODE }),
      );
    } catch (error) {
      failure = error;
    }

    if (failure !== undefined) {
      // 清理半成品：失败时磁盘上不允许留下任何孤儿文件。
      await rm(absolute, { force: true }).catch(() => undefined);
      if (isAlreadyExists(failure)) {
        throw errors.conflict("该存储键已存在，拒绝覆盖。", { details: { key: input.key } });
      }
      // 已经是带语义的 AppError（如 FILE_TOO_LARGE）时原样上抛，
      // 不要包成 STORAGE_UNAVAILABLE —— 那会把 413 变成 503，让使用者以为是服务器故障。
      if (failure instanceof AppError) throw failure;
      throw errors.storage("写入文件失败。", { cause: failure, details: { key: input.key } });
    }

    return {
      key: input.key,
      size,
      checksum: hash.digest("hex"),
      contentType: input.contentType,
    };
  }

  async download(key: string): Promise<Uint8Array> {
    const absolute = this.resolvePath(key);
    try {
      const buffer = await readFile(absolute);
      return new Uint8Array(buffer);
    } catch (error) {
      if (isNotFound(error)) {
        throw errors.notFound("文件不存在。", { details: { key } });
      }
      throw errors.storage("读取文件失败。", { cause: error, details: { key } });
    }
  }

  /**
   * 流式读取。先显式探一次存在性，把 ENOENT 映射成 404 ——
   * 否则错误只会在响应头已经发出去之后才从流里冒出来，那时已经无法改成 404 了。
   */
  async downloadStream(key: string): Promise<Readable> {
    const absolute = this.resolvePath(key);
    try {
      await access(absolute, constants.R_OK);
    } catch (error) {
      if (isNotFound(error)) {
        throw errors.notFound("文件不存在。", { details: { key } });
      }
      throw errors.storage("读取文件失败。", { cause: error, details: { key } });
    }
    return createReadStream(absolute);
  }

  /** 本地磁盘后端可以提供绝对路径，供 yauzl 这类按路径随机访问的解析器使用。 */
  localPathFor(key: string): string {
    return this.resolvePath(key);
  }

  async delete(key: string): Promise<void> {
    const absolute = this.resolvePath(key);
    try {
      await rm(absolute, { force: true });
    } catch (error) {
      throw errors.storage("删除文件失败。", { cause: error, details: { key } });
    }
  }

  async exists(key: string): Promise<boolean> {
    const absolute = this.resolvePath(key);
    try {
      await access(absolute, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async getSignedUrl(key: string, options: SignedUrlOptions = {}): Promise<string> {
    // 先校验 key 合法，避免把穿越路径签进 URL。
    assertSafeStorageKey(key);

    const expiresIn = options.expiresInSeconds ?? this.defaultExpires;
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw errors.validation("签名有效期必须是正数。");
    }

    const expiresAt = Math.floor(Date.now() / 1000) + Math.floor(expiresIn);
    const signature = signStorageKey({ key, expiresAt, secret: this.secret });

    // 走 /api/files/signed/... 而不是 /api/files/...：
    // 后者是按**文档 id** 授权下载的路径（需要登录会话 + 工作区成员校验），
    // 两者语义不同，路径必须分开，否则签名 URL 会被当成文档 id 去查库。
    const url = new URL(`${this.appUrl}/api/files/signed/${encodeStorageKey(key)}`);
    url.searchParams.set("expires", String(expiresAt));
    url.searchParams.set("signature", signature);
    if (options.downloadFilename) {
      url.searchParams.set("filename", options.downloadFilename);
    }
    return url.toString();
  }
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "EEXIST";
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}
