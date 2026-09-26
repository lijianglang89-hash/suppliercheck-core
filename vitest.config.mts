import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": projectRoot,
      /**
       * server-only 包在任何非 RSC 环境下 import 都会抛错（这正是它的设计目的），
       * 而单元测试跑在普通 Node 进程里。用空实现替换，让服务端逻辑可测；
       * 生产构建仍然由真实的 server-only 把关。
       */
      "server-only": path.join(projectRoot, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: [path.join(projectRoot, "tests/setup.ts")],
    // 集成测试会连真实数据库，串行执行避免互相干扰。
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    reporters: ["default"],
  },
});
