/**
 * StorageProvider 工厂。
 *
 * 未来接入阿里云 OSS 时，只需要在本文件注册新的工厂，
 * 上层「文档上传 / 报告导出」代码完全不需要改动。
 */
import "server-only";

import path from "node:path";

import { getEnv } from "@/lib/config/server-env";
import { errors } from "@/lib/errors";

import { LocalStorageProvider } from "./providers/local";
import type { StorageProvider } from "./types";

type StorageFactory = (options: {
  storagePath: string;
  secret: string;
  appUrl: string;
}) => StorageProvider;

const STORAGE_FACTORIES: Partial<Record<string, StorageFactory>> = {
  local: (options) =>
    new LocalStorageProvider({
      /**
       * 存储根目录来自配置（开发是相对路径，生产是容器内绝对路径 /storage/uploads），
       * 因此这个 path.resolve **无法被静态分析**。
       *
       * 不加 turbopackIgnore 的后果实测很具体：Turbopack 会认为「运行时可能访问项目里
       * 任何路径」，于是把整个项目（含 public/、测试夹具、迁移文件）都算成依赖打进
       * standalone 产物 —— 镜像变大、部署变慢，而我们其实只读一个数据目录。
       * 这里显式关掉追踪：这是被理解的路径，不是意外。
       */
      rootDir: path.resolve(/* turbopackIgnore: true */ process.cwd(), options.storagePath),
      secret: options.secret,
      appUrl: options.appUrl,
    }),
};

let cached: StorageProvider | undefined;

export function getStorageProvider(): StorageProvider {
  if (cached) return cached;

  const env = getEnv();
  const factory = STORAGE_FACTORIES[env.STORAGE_PROVIDER];

  if (!factory) {
    throw errors.configuration(`STORAGE_PROVIDER="${env.STORAGE_PROVIDER}" 尚未实现对应 Provider。`, {
      details: { supported: Object.keys(STORAGE_FACTORIES) },
    });
  }

  cached = factory({
    storagePath: env.STORAGE_PATH,
    secret: env.SESSION_SECRET,
    appUrl: env.APP_URL,
  });
  return cached;
}

/** 仅供测试使用。 */
export function resetStorageProviderCache(): void {
  cached = undefined;
}

export { LocalStorageProvider } from "./providers/local";
export type {
  SignedUrlOptions,
  StorageProvider,
  StoredObject,
  UploadInput,
  UploadStreamInput,
} from "./types";
