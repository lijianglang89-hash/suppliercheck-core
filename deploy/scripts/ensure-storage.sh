#!/usr/bin/env bash
#
# 确保私有存储目录存在且权限正确。
#
# 为什么需要这个脚本（而不是靠容器自己 mkdir）：
# 宿主目录是以 **bind mount** 方式挂进容器的，属主由宿主决定，容器里改不了。
# 应用在容器内以 uid 1001（nextjs）运行，如果宿主目录是 root:root，
# 上传会在第一个字节就被 EACCES 拦下 —— 而且报错发生在运行期，不在部署期，
# 很容易被当成「代码 bug」查很久。
#
# 幂等：可以反复执行。
#
# 用法（在服务器上，需要 root 或可 sudo）：
#   sudo bash deploy/scripts/ensure-storage.sh
#
set -euo pipefail

# 容器内 nextjs 用户的 uid/gid，见 Dockerfile
readonly APP_UID=1001
readonly APP_GID=1001

# 允许通过环境变量覆盖，便于换部署路径
readonly ROOT_DIR="${SUPPLIERCHECK_ROOT:-/srv/suppliercheck}"
readonly STORAGE_DIR="${ROOT_DIR}/storage/uploads"

echo "[ensure-storage] 目标目录：${STORAGE_DIR}"

mkdir -p "${STORAGE_DIR}"

# 目录权限 0750：同组可读可进入，其他人不可见。
# 应用自己写入的文件是 0640（见 lib/storage/providers/local.ts），
# 两者合起来保证只有应用用户与同组能读取供应商资料。
chown -R "${APP_UID}:${APP_GID}" "${ROOT_DIR}/storage"
chmod 750 "${ROOT_DIR}/storage"
chmod 750 "${STORAGE_DIR}"

echo "[ensure-storage] 完成。当前状态："
ls -ld "${ROOT_DIR}/storage" "${STORAGE_DIR}"
