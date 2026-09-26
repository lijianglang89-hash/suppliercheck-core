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

# Alpine 包源。默认官方 CDN，国内构建机需覆盖为镜像站 ——
# 实测从阿里云 ECS 取同一个 APKINDEX.tar.gz：dl-cdn.alpinelinux.org 12 s+（基本到超时边缘），
# mirrors.aliyun.com 0.09 s。差 100 倍以上，表现为 `apk add` 卡住数分钟毫无输出，
# 很容易被误判成构建死锁。这是构建期网络问题，不是代码问题。
# 用法：--build-arg APK_MIRROR=https://mirrors.aliyun.com
ARG APK_MIRROR=https://dl-cdn.alpinelinux.org

FROM ${NODE_IMAGE} AS base
# ⚠️ 必须在本阶段内重新声明 ARG：FROM 之前声明的 ARG 只对 FROM 行可见，
# 在 RUN 里展开为空字符串 —— 症状是 sed 把源改成 "/alpine/v3.24/main"（协议主机都没了），
# apk 报 "opening /alpine/v3.24/main/x86_64/APKINDEX.tar.gz: No such file or directory"
# 然后报 libc6-compat (no such package)。看着像网络问题，其实是 ARG 作用域问题。
ARG APK_MIRROR
RUN sed -i "s|https://dl-cdn.alpinelinux.org|${APK_MIRROR}|g" /etc/apk/repositories \
 && apk update \
 && apk add --no-cache libc6-compat
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

# 构建期的 Node 堆上限。构建机是 4 GB 内存的共享 ECS，上面还跑着 ULTRON 的
# 生产容器（合计已占约 1.5 GB）。不设上限时 next build 的堆增长可能触发内核
# OOM killer，而 OOM killer 挑的是 RSS 最高的进程 —— 很可能是邻居的生产容器。
# 宁可让本次构建失败（有 swap 兜底），也不能拖垮在生产里跑的服务。
# 本应用只有 17 条路由，实测构建期 Node 堆峰值远低于此值。
ARG NODE_OPTIONS=--max-old-space-size=1536
ENV NODE_OPTIONS=${NODE_OPTIONS}

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
