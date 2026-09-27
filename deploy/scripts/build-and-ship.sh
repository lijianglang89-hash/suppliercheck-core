#!/usr/bin/env bash
#
# 本地构建 → 导出镜像 → 传到 ECS → 加载 → 重启
#
# 适用场景：还没有配置阿里云 ACR，只想先把「不在生产机构建」这件事做对。
#           只需要本机 Docker 和一个能 ssh 的账号，不需要任何云服务凭据。
#
# 对比 build-and-push.sh（ACR 方案）：
#   - 本方案：零配置起步，但要传一个几百 MB 的 tar（取决于本机上行带宽）
#   - ACR 方案：配一次，之后每次更新只有 pull，10 秒完成 ← 长期应该走这条
#
# 前置：
#   1. 本机 Docker 已运行
#   2. ssh 免密已配好（ssh <REMOTE_HOST_ALIAS> 能直接进）
#
# 用法：
#   bash deploy/scripts/build-and-ship.sh 0.3.1
#
set -euo pipefail

TAG="${1:?用法: build-and-ship.sh <TAG>}"
IMAGE_NAME="${IMAGE_NAME:-suppliercheck-app}"
REMOTE_HOST="${REMOTE_HOST:-aliyun}"                 # ~/.ssh/config 里的别名，或 user@ip
REMOTE_DIR="${REMOTE_DIR:-/srv/suppliercheck}"
APP_URL="${APP_URL:-https://supplier.ultron.xin}"
APK_MIRROR="${APK_MIRROR:-https://mirrors.aliyun.com/alpine}"

TARBALL="/tmp/${IMAGE_NAME}-${TAG}.tar.gz"

docker info >/dev/null 2>&1 || { echo "❌ 本机 Docker 未运行"; exit 1; }

echo "==> 本机构建 ${IMAGE_NAME}:${TAG}"
docker build \
  --file Dockerfile \
  --build-arg "APP_URL=${APP_URL}" \
  --build-arg "APK_MIRROR=${APK_MIRROR}" \
  --tag "${IMAGE_NAME}:${TAG}" \
  .

echo "==> 导出并压缩（gzip 后通常能从 ~500MB 降到 ~150MB）"
docker save "${IMAGE_NAME}:${TAG}" | gzip -1 > "${TARBALL}"
ls -lh "${TARBALL}"

echo "==> 传到 ECS"
scp -o ServerAliveInterval=30 "${TARBALL}" "${REMOTE_HOST}:/tmp/"

echo "==> ECS 加载镜像并重启（只做 load 和 up，不构建）"
ssh -o ServerAliveInterval=30 "${REMOTE_HOST}" bash -s <<REMOTE
set -euo pipefail
cd ${REMOTE_DIR}
sudo docker load -i /tmp/$(basename "${TARBALL}")
rm -f /tmp/$(basename "${TARBALL}")
# APP_IMAGE 覆盖 compose 里的 image —— 不覆盖会静默跑回旧镜像
APP_IMAGE=${IMAGE_NAME}:${TAG} sudo docker compose up -d app
sleep 8
sudo docker compose ps --format '{{.Name}} {{.Status}}'
curl -s -o /dev/null -w 'LOCAL_HTTP=%{http_code}\n' --max-time 10 http://127.0.0.1:3010/
REMOTE

echo "==> 验证对外的真实响应（不要只信容器 healthy）"
curl -s -o /dev/null -w "PUBLIC_HTTP=%{http_code}\n" --max-time 20 "${APP_URL}/"

cat <<EOF

完成后请用**页面内容**复核版本，不要只看 HTTP 200：
  curl -s ${APP_URL}/ | grep -o "五类检查，一次跑完\\|环节 1 / 4"

回滚：
  ssh ${REMOTE_HOST} "cd ${REMOTE_DIR} && APP_IMAGE=${IMAGE_NAME}:0.3.0 sudo docker compose up -d app"
EOF
