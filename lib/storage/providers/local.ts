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
import { constants } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { errors } from "@/lib/errors";
import { assertSafeStorageKey } from "@/lib/files";

import { encodeStorageKey, signStorageKey } from "../signature";
import type { SignedUrlOptions, StorageProvider, StoredObject, UploadInput } from "../types";

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

    const url = new URL(`${this.appUrl}/api/files/${encodeStorageKey(key)}`);
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
