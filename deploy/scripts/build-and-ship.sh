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
# 没有 ~/.ssh/config 别名时用 user@ip 形式；有别名就把整个 REMOTE_HOST 覆盖成别名。
REMOTE_HOST="${REMOTE_HOST:-admin@39.108.235.240}"
# 密钥路径。为空则依赖 ssh-agent 或 ~/.ssh/config。
SSH_KEY="${SSH_KEY:-$HOME/.ssh/trustreply_ops_ed25519}"
REMOTE_DIR="${REMOTE_DIR:-/srv/suppliercheck}"
APP_URL="${APP_URL:-https://supplier.ultron.xin}"
# ⚠️ APK_MIRROR 必须是**站点根**，不能带 /alpine 后缀。
# /etc/apk/repositories 里已经是 https://dl-cdn.alpinelinux.org/alpine/v3.24/main，
# Dockerfile 做的是整段前缀替换，再拼一个 /alpine 就会得到
# https://mirrors.aliyun.com/alpine/alpine/v3.24/main → HTTP 404。
# （我第一次写脚本时就踩了这个，留在这里提醒下次别再手快。）
APK_MIRROR="${APK_MIRROR:-https://mirrors.aliyun.com}"

# ⚠️ 基础镜像默认走 DaoCloud 镜像站，不要改成 node:22-alpine。
# 实测本机直连 Docker Hub 会失败：
#   ERROR: failed to authorize: failed to fetch oauth token:
#   Post "https://auth.docker.io/token": Bad Gateway
# 这不是网络抖动 —— auth.docker.io 在本机网络环境下就是不可达的，重试多少次都一样。
# （registry.cn-hangzhou.aliyuncs.com/library/node 也试过：pull access denied。）
NODE_IMAGE="${NODE_IMAGE:-docker.m.daocloud.io/library/node:22-alpine}"

TARBALL="/tmp/${IMAGE_NAME}-${TAG}.tar.gz"

docker info >/dev/null 2>&1 || { echo "❌ 本机 Docker 未运行"; exit 1; }

echo "==> 本机构建 ${IMAGE_NAME}:${TAG}"
docker build \
  --file Dockerfile \
  --build-arg "NODE_IMAGE=${NODE_IMAGE}" \
  --build-arg "APP_URL=${APP_URL}" \
  --build-arg "APK_MIRROR=${APK_MIRROR}" \
  --tag "${IMAGE_NAME}:${TAG}" \
  .

echo "==> 导出并压缩（gzip 后通常能从 ~500MB 降到 ~150MB）"
docker save "${IMAGE_NAME}:${TAG}" | gzip -1 > "${TARBALL}"
ls -lh "${TARBALL}"

if [[ -n "${SSH_KEY}" && -f "${SSH_KEY}" ]]; then
  SSH="ssh -i ${SSH_KEY} -o ServerAliveInterval=30"
  SCP="scp -i ${SSH_KEY} -o ServerAliveInterval=30"
else
  SSH="ssh -o ServerAliveInterval=30"
  SCP="scp -o ServerAliveInterval=30"
fi

echo "==> 传到 ECS"
${SCP} "${TARBALL}" "${REMOTE_HOST}:/tmp/"

echo "==> ECS 加载镜像并重启（只做 load 和 up，不构建）"
${SCP} docker-compose.yml "${REMOTE_HOST}:/tmp/docker-compose.yml"
# ⚠️ 远端脚本必须先落成本地文件再重定向给 ssh，不要直接 `ssh ... bash -s <<EOF`。
# 实测：在 Git Bash 里 heredoc 直接喂给 ssh 时，若 ssh 的 stdin 处理出现时序问题，
# 剩余的 heredoc 内容会被**本机 shell** 继续读走并执行 —— 而本机 Git Bash 的 `sudo`
# 已被 Windows 自带的 sudo.exe 抢占，于是远端命令在本机乱跑（本轮两次部署都触发了）。
# 先写文件再 `bash -s < file`，stdin 与 ssh 完全解耦，杜绝这种串扰。
REMOTE_SCRIPT="$(mktemp)"
cat > "${REMOTE_SCRIPT}" <<REMOTE
set -euo pipefail
cd ${REMOTE_DIR}
# ⚠️ compose 文件必须先同步：远端的 docker-compose.yml 如果还是旧版
# （image 硬编码成 suppliercheck-app:0.3.0），下面的 APP_IMAGE 覆盖就完全无效 ——
# up -d 报 Successfully / Started，而容器纹丝不动。这个失败是静默的。
mv /tmp/docker-compose.yml docker-compose.yml
sudo docker load -i /tmp/$(basename "${TARBALL}")
rm -f /tmp/$(basename "${TARBALL}")
# ⚠️ 环境变量必须写在 sudo 之后。
# 写成「APP_IMAGE=x sudo docker compose」是错的：sudo 默认 env_reset，会把变量丢掉，
# 于是 compose 回落到默认 image，「up -d」一路 Successfully 却什么都没换。
#
# ⚠️⚠️ 这是**不加引号的 heredoc**（<<REMOTE），bash 会对正文做命令替换。
# 所以正文里一个反引号都不能有（包括注释里！）：
# 曾经注释里写了「up -d」外加反引号，本机会真的把它当命令执行，
# 报 "up: command not found"，并在 set -e 下让整个脚本提前退出 ——
# 远端其实已经全部执行完了，纯属本地副作用。要强调命令一律用「」或普通引号。
# 讽刺的是，写这条注释时我又在注释里打了一次反引号，于是报错翻倍（第三次才干净）。
sudo APP_IMAGE=${IMAGE_NAME}:${TAG} docker compose up -d app
sleep 10
# 核对实际生效的镜像与启动时间，别只信 ps 里的 healthy
sudo docker inspect ${IMAGE_NAME} --format 'IMAGE={{.Config.Image}} STARTED={{.State.StartedAt}}' 2>/dev/null \\
  || sudo docker compose ps --format '{{.Name}} {{.Status}}'
curl -s -o /dev/null -w 'LOCAL_HTTP=%{http_code}\n' --max-time 10 http://127.0.0.1:3010/
REMOTE
${SSH} "${REMOTE_HOST}" bash -s < "${REMOTE_SCRIPT}"
rm -f "${REMOTE_SCRIPT}"

echo "==> 验证对外的真实响应（不要只信容器 healthy）"
curl -s -o /dev/null -w "PUBLIC_HTTP=%{http_code}\n" --max-time 20 "${APP_URL}/"

cat <<EOF

完成后请用**页面内容**复核版本，不要只看 HTTP 200、也不要只看容器 healthy：
  curl -s ${APP_URL}/ | grep -o "五类检查，一次跑完\\|环节 1 / 4"
  ssh -i ${SSH_KEY} ${REMOTE_HOST} "sudo docker inspect suppliercheck-app --format '{{.Config.Image}}'"

> 这一步不是形式主义。本脚本第一版在这连栽两次：
> ① 「APP_IMAGE=x sudo」→ sudo 丢弃变量；② 远端 compose 是旧版 → 覆盖了也没用。
> 两次都表现为「命令成功、容器照旧」。只有查「docker inspect」的 Image 字段才看得出来。
> （这里的反引号同样会被本 heredoc 命令替换掉，所以一律不写。）

回滚（同样注意 sudo 的位置）：
  ssh -i ${SSH_KEY} ${REMOTE_HOST} "cd ${REMOTE_DIR} && sudo APP_IMAGE=${IMAGE_NAME}:0.3.0 docker compose up -d app"
EOF
