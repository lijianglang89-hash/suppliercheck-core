# ---------------------------------------------------------------------------
# 供应商智审 SupplierCheck · 生产镜像
#
# 多阶段构建，最终镜像只包含 Next.js standalone 产物 + 运行时依赖，
# 体积小、攻击面小。构建阶段需要联网安装依赖，运行阶段完全离线。
# ---------------------------------------------------------------------------

# 基础镜像来源可通过 build arg 覆盖：
# 国内环境（如阿里云 ECS 直连 Docker Hub 超时）可指向镜像加速器，例如
#   --build-arg NODE_IMAGE=docker.m.daocloud.io/library/node:22-alpine
# 默认保持官方名称，便于在任意环境复现。
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app


# --- 依赖层：只复制清单文件，命中缓存时不重复安装 --------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci


# --- 构建层 ----------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# ⚠️ APP_URL 会被固化进静态预渲染页面（canonical / Open Graph / sitemap），
# 因此它必须在**构建期**提供，只在运行时注入是无效的。
# 换域名后需要重新构建镜像 —— 这是静态渲染换来的代价，可以接受。
ARG APP_URL=http://localhost:3010
ENV APP_URL=${APP_URL}

# 构建期不读取真实 secrets；应用对其他环境变量的读取是惰性的，不会在 build 阶段触发校验。
RUN npm run build


# --- 运行层 ----------------------------------------------------------------
FROM base AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3010
ENV HOSTNAME=0.0.0.0

# 非 root 运行
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 私有上传目录（宿主挂载卷的落点，见 docker-compose.yml）。
# 容器内路径必须与 STORAGE_PATH 一致，否则应用会往一个没有挂载的目录写，
# 重建容器时资料就丢了。
RUN mkdir -p /storage/uploads && chown -R nextjs:nodejs /storage

USER nextjs
EXPOSE 3010

# 健康检查直接打应用自身的接口，避免「进程活着但数据库断了」被误判为健康。
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3010/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
