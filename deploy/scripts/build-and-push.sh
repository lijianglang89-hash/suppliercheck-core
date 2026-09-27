#!/usr/bin/env bash
#
# 本地构建 → 推送 ACR → ECS 拉取上线
#
# 为什么必须走这条路（这是踩出来的，不是偏好）：
#   2026-09-27 在 ECS（2 核 4G，同时跑着内容矩阵的 9 个容器）上直接
#   `docker compose build app`，构建撑爆内存 → 整机 SSH / HTTPS 全部无响应
#   （TCP 端口仍 OPEN 但服务不应答），站点对外中断，最后靠控制台强制重启才恢复。
#
#   Next.js 构建阶段的内存消耗无上限。生产机不是构建机。
#
# 前置条件：
#   1. 本机 Docker 已运行（docker info 能返回）
#   2. 阿里云 ACR 个人版已开通（免费），拿到：
#        registry 地址   形如 registry.cn-shenzhen.aliyuncs.com/<namespace>
#        登录用户名 / 密码（在 ACR 控制台「访问凭证」里设置，不是阿里云账号密码）
#   3. 构建期需要的 ARG 已准备好（APP_URL 会被固化进 canonical / OG / sitemap）
#
# 用法：
#   bash deploy/scripts/build-and-push.sh <TAG>          # 构建并推送
#   bash deploy/scripts/build-and-push.sh <TAG> --only-build   # 只构建不推
#   ECS 上线（单独一条命令，10 秒内完成）：
#     ssh admin@<ECS> "cd /srv/suppliercheck && sudo docker compose pull app && sudo docker compose up -d app"
#
set -euo pipefail

TAG="${1:?用法: build-and-push.sh <TAG> [--only-build]}"
ONLY_BUILD="${2:-}"

# ACR registry 地址。改这里，或者用环境变量覆盖。
REGISTRY="${ACR_REGISTRY:?请设置 ACR_REGISTRY，例如 registry.cn-shenzhen.aliyuncs.com/ultron-suppliercheck}"
IMAGE_NAME="${IMAGE_NAME:-suppliercheck-app}"

# ⚠️ 构建期必须有 APP_URL：canonical / sitemap / OG 的绝对 URL 在构建时就固化进静态产物，
#    构建完再配环境变量是无效的。
APP_URL="${APP_URL:-https://supplier.ultron.xin}"

# Alpine 的 APK 源。国内机器请覆盖为镜像站，否则安装依赖会超时。
APK_MIRROR="${APK_MIRROR:-https://mirrors.aliyun.com/alpine}"

FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}:${TAG}"

echo "==> 目标镜像：${FULL_IMAGE}"
echo "==> APP_URL  ：${APP_URL}"

docker info >/dev/null 2>&1 || { echo "❌ 本机 Docker 未运行，先启动 Docker Desktop"; exit 1; }

echo "==> 构建（本机内存远大于 ECS，安全）"
docker build \
  --file Dockerfile \
  --build-arg "APP_URL=${APP_URL}" \
  --build-arg "APK_MIRROR=${APK_MIRROR}" \
  --tag "${FULL_IMAGE}" \
  --tag "${IMAGE_NAME}:${TAG}" \
  .

# 顺手打一个 latest 之外的本地别名，方便回滚时 docker images 里一眼看到
docker tag "${FULL_IMAGE}" "${IMAGE_NAME}:latest"

if [[ "${ONLY_BUILD}" == "--only-build" ]]; then
  echo "==> 已跳过推送（--only-build）"
  echo "    本地镜像：${FULL_IMAGE}"
  exit 0
fi

echo "==> 登录 ACR"
docker login "${REGISTRY%%/*}" \
  --username "${ACR_USERNAME:?请设置 ACR_USERNAME}" \
  --password-stdin <<<"${ACR_PASSWORD:?请设置 ACR_PASSWORD}"

echo "==> 推送"
docker push "${FULL_IMAGE}"

cat <<EOF

==> 完成。现在到 ECS 上执行（只有 pull 和重启，不构建）：

  ssh admin@<ECS> "cd /srv/suppliercheck && sudo docker compose pull app && sudo docker compose up -d app"

注意事项：
  - ECS 上的 docker-compose.yml 必须把 image 改成 ${FULL_IMAGE}
  - pull 之前先确认 APP_URL 与线上一致，否则 canonical 会写错
  - 回滚：把 compose 里 image 改回上一个 TAG 后 up -d
EOF
