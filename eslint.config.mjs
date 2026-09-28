import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    // 用 .next*/ 而不是 .next/ —— 本机构建会因为缓存停滞，
    // 排障时用 `mv .next .next.stale-<ts>` 把旧缓存挪走（不能用 rm，会被删除守卫拦），
    // 那些 .next.stale-* 同样是构建产物，不该进 lint（实测误扫出 16900 个问题）。
    ".next*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 工作区目录：临时探针脚本、审阅包的源码片段（可能是被 sed 截断的不完整文件），
    // 它们不是产品代码，不该让 lint 因为解析失败而红。
    ".workbuddy/**",
  ]),
]);

export default eslintConfig;
