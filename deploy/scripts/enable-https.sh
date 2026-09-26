#!/usr/bin/env bash
#
# 供应商智审 SupplierCheck · 为 supplier.ultron.xin 签发证书并切换到 HTTPS。
#
# 前置条件：DNS A 记录 supplier.ultron.xin -> 39.108.235.240 已经生效。
# 本脚本会先验证这一点，并在真正消耗 ACME 配额之前做一次「HTTP-01 路径可达性」实测。
#
# 两步走（强烈建议按顺序）：
#
#   1) 演练：走完整 ACME 流程，但**不签发、不落盘、不改 nginx**（certbot --dry-run）
#      sudo bash deploy/scripts/enable-https.sh --email you@example.com --rehearse
#
#   2) 正式签发并切到 443
#      sudo bash deploy/scripts/enable-https.sh --email you@example.com --prod
#
# 幂等：可以反复执行。证书未接近到期时 --prod 不会重复签发。
#
set -euo pipefail

readonly DOMAIN="supplier.ultron.xin"
readonly EXPECTED_IP="39.108.235.240"
readonly WEBROOT="/var/www/html"
readonly NGINX_CONF="/etc/nginx/conf.d/suppliercheck.conf"
readonly ROOT_DIR="${SUPPLIERCHECK_ROOT:-/srv/suppliercheck}"
readonly TEMPLATE="${ROOT_DIR}/deploy/nginx/suppliercheck.conf.template"
readonly HTTP_ONLY="${ROOT_DIR}/deploy/nginx/suppliercheck.http-only.conf"
readonly CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"

EMAIL=""
MODE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --email)    EMAIL="${2:-}"; shift 2 ;;
    --rehearse) MODE="rehearse"; shift ;;
    --prod)     MODE="prod"; shift ;;
    -h|--help)  sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

log()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { printf '\n✗ %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]]      || fail "需要 root 运行：sudo bash $0 --email <邮箱> --rehearse|--prod"
[[ -n "$EMAIL" ]]           || fail "缺少 --email。Let's Encrypt 需要联系方式用于到期提醒。"
[[ -n "$MODE" ]]            || fail "请显式选择 --rehearse（演练）或 --prod（正式签发）。"
[[ -f "${TEMPLATE}" ]]      || fail "找不到模板 ${TEMPLATE}"
[[ -f "${HTTP_ONLY}" ]]     || fail "找不到阶段一配置 ${HTTP_ONLY}"

# ---------------------------------------------------------------------------
log "1/5 校验 DNS"
# ---------------------------------------------------------------------------
RESOLVED="$(getent hosts "${DOMAIN}" | awk '{print $1}' | sort -u | tr '\n' ' ' || true)"
[[ -n "${RESOLVED// /}" ]] || fail "DNS 未解析：${DOMAIN} 查不到 A 记录。
   请先在域名解析处添加：${DOMAIN} A ${EXPECTED_IP}"
echo "  解析结果：${RESOLVED}"
grep -qw "${EXPECTED_IP}" <<<"${RESOLVED}" || fail "DNS 解析到的不是本机。
   期望：${EXPECTED_IP}   实际：${RESOLVED}"
echo "  ✓ 指向本机 ${EXPECTED_IP}"

# ---------------------------------------------------------------------------
log "2/5 校验 nginx 阶段一配置在位"
# ---------------------------------------------------------------------------
[[ -f "${NGINX_CONF}" ]] || fail "${NGINX_CONF} 不存在。请先部署阶段一配置：
   sudo install -m 0644 ${HTTP_ONLY} ${NGINX_CONF}
   sudo /usr/sbin/nginx -t && sudo systemctl reload nginx"
grep -q "server_name[[:space:]]*${DOMAIN}" "${NGINX_CONF}" \
  || fail "${NGINX_CONF} 里没有 server_name ${DOMAIN}，配置可能不对。"
echo "  ✓ ${NGINX_CONF} 已就位"

# ---------------------------------------------------------------------------
log "3/5 实测 HTTP-01 路径可达（不消耗 ACME 配额）"
# ---------------------------------------------------------------------------
# 先在 webroot 放一个已知内容的探针文件，再通过**公网域名**取回来。
# 这一步过了，certbot 才可能过；不过就先把 nginx/DNS 修好，别去撞 ACME 限额。
mkdir -p "${WEBROOT}/.well-known/acme-challenge"
PROBE_TOKEN="sc-probe-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
echo "${PROBE_TOKEN}" > "${WEBROOT}/.well-known/acme-challenge/${PROBE_TOKEN}"
chmod 0644 "${WEBROOT}/.well-known/acme-challenge/${PROBE_TOKEN}"
GOT="$(curl -sS --max-time 15 "http://${DOMAIN}/.well-known/acme-challenge/${PROBE_TOKEN}" 2>&1 || true)"
rm -f "${WEBROOT}/.well-known/acme-challenge/${PROBE_TOKEN}"
if [[ "${GOT}" != "${PROBE_TOKEN}" ]]; then
  fail "HTTP-01 路径不可达。
   请求 http://${DOMAIN}/.well-known/acme-challenge/${PROBE_TOKEN}
   期望返回：${PROBE_TOKEN}
   实际返回：${GOT:-<空>}
   排查方向：DNS 是否已全网生效、80 端口是否被安全组放行、nginx 是否 reload 过。"
fi
echo "  ✓ ACME 校验路径可达"

# ---------------------------------------------------------------------------
log "4/5 ACME 流程（mode=${MODE}）"
# ---------------------------------------------------------------------------
CERTBOT_BASE=(
  certonly --webroot -w "${WEBROOT}"
  -d "${DOMAIN}"
  --non-interactive --agree-tos --email "${EMAIL}"
)

if [[ "${MODE}" == "rehearse" ]]; then
  # --dry-run 会走完整的 ACME 流程（内部用 staging 端点），但**不保存证书**、
  # 不改 nginx —— 所以没有「中间态出现不受信任证书」的窗口。
  # 比「真的签一张 staging 证书」更干净，也更快。
  certbot "${CERTBOT_BASE[@]}" --dry-run
  cat <<EOF

────────────────────────────────────────────────────────────
✓ 演练通过。DNS、安全组、nginx、webroot、ACME 账号全链路都通。

  现在可以正式签发并切到 HTTPS：
    sudo bash $0 --email ${EMAIL} --prod
────────────────────────────────────────────────────────────
EOF
  exit 0
fi

# --- 正式签发 ---
CERTBOT_ARGS=(
  "${CERTBOT_BASE[@]}"
  --keep-until-expiring
  # 续期后自动 reload，否则 nginx 会一直用旧证书直到手动 reload
  --deploy-hook "systemctl reload nginx"
)

# 如果磁盘上现有的是 staging 签发的证书，切 prod 时必须强制重签 ——
# 否则 certbot 会以「未到续期时间」为由跳过，站点会一直挂着不受信任的证书。
if [[ -f "${CERT_DIR}/fullchain.pem" ]] \
   && openssl x509 -in "${CERT_DIR}/fullchain.pem" -noout -issuer 2>/dev/null | grep -q "STAGING"; then
  echo "  检测到现有证书由 staging 签发 → 强制重新签发"
  CERTBOT_ARGS+=(--force-renewal)
fi

certbot "${CERTBOT_ARGS[@]}"
[[ -f "${CERT_DIR}/fullchain.pem" ]] || fail "certbot 结束但找不到 ${CERT_DIR}/fullchain.pem"
echo "  ✓ 证书已签发："
openssl x509 -in "${CERT_DIR}/fullchain.pem" -noout -subject -issuer -dates -ext subjectAltName

# ---------------------------------------------------------------------------
log "5/5 切换到 443 配置（失败自动回滚）"
# ---------------------------------------------------------------------------
BACKUP="${NGINX_CONF}.before-https-$(date +%Y%m%d-%H%M%S)"
cp -a "${NGINX_CONF}" "${BACKUP}"
echo "  已备份原配置 -> ${BACKUP}"

# 模板里只有 __DOMAIN__ 一个占位符
sed "s|__DOMAIN__|${DOMAIN}|g" "${TEMPLATE}" > "${NGINX_CONF}"

if ! /usr/sbin/nginx -t 2>&1; then
  echo "✗ nginx -t 失败，回滚配置（生产服务不受影响）" >&2
  cp -a "${BACKUP}" "${NGINX_CONF}"
  /usr/sbin/nginx -t && echo "  已回滚到原配置，nginx 仍健康。" >&2
  fail "443 配置未通过校验，未执行 reload。"
fi
echo "  ✓ nginx -t 通过"

systemctl reload nginx
sleep 2
echo "  ✓ 已 reload"

log "端到端验证"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://${DOMAIN}/api/health" || true)"
echo "  https://${DOMAIN}/api/health -> ${CODE}"
# 注意：-k 这里不能用。用 -k 就验证不了证书链是否被信任，等于把这一步的意义抹掉。
CHAIN="$(echo | openssl s_client -servername "${DOMAIN}" -connect "${DOMAIN}:443" 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates 2>/dev/null || true)"
echo "  证书链："
echo "${CHAIN}" | sed 's/^/    /'
REDIRECT="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "http://${DOMAIN}/api/health" || true)"
echo "  http://${DOMAIN}/api/health  -> ${REDIRECT}（期望 301）"

[[ "${CODE}" == "200" ]] || fail "HTTPS 已启用但 /api/health 返回 ${CODE}，请人工确认。"
if grep -q "STAGING" <<<"${CHAIN}"; then
  fail "当前挂的是 staging 证书（不受信任）。请用 --prod 重新签发。"
fi

cat <<EOF

────────────────────────────────────────────────────────────
✓ 完成。https://${DOMAIN} 已启用。

  续期：certbot.timer 自动处理（/etc/letsencrypt/renewal/ 已写入），
       并带 --deploy-hook 在续期后自动 reload nginx，无需人工干预。
       查看状态：certbot certificates
EOF
