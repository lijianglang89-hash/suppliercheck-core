import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * 产出最小化的 standalone 运行目录，供 Docker 镜像使用。
   * 部署时端口由环境变量 PORT 控制（默认 3010，避免与宿主机已有的 3000 冲突）。
   */
  output: "standalone",

  /** 生产构建不做类型/ESLint 阻塞之外的额外动作；类型检查有独立脚本。 */
  typescript: {
    ignoreBuildErrors: false,
  },

  /** 安全响应头。CSP 等更严格的策略留待接入真实域名后再收敛。 */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },

  /**
   * 用户上传的原始文件一律存放在私有目录（STORAGE_PATH），
   * 绝不会出现在 public/ 下，因此这里不需要也不允许放任何文件相关的 rewrite。
   */
};

export default nextConfig;
