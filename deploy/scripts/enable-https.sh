#!/usr/bin/env bash
#
# 供应商智审 SupplierCheck · 为 supplier.ultron.xin 签发证书并切换到 HTTPS。
#
# 前置条件：DNS A 记录 supplier.ultron.xin -> 39.108.235.240 已经生效。
# 本脚本会先验证这一点，并在真正消耗 ACME 配额之前做一次「HTTP-01 路径可达性」实测。
#
# 幂等：可以反复执行。证书未接近到期时不会重复签发。
#
# 用法（服务器上，需要 root）：
#   sudo bash deploy/scripts/enable-https.sh --email you@example.com
#
#   先跑一遍 staging 做演练（拿到的证书浏览器不信任，但能验证整条链路）：
#   sudo bash deploy/scripts/enable-https.sh --email you@example.com --staging
#
#   演练通过后签发正式证书（务必带 --prod，否则还是 staging）：
#   sudo bash deploy/scripts/enable-https.sh --email you@example.com --prod
#
set -euo pipefail

readonly DOMAIN="supplier.ultron.xin"
readonly EXPECTED_IP="39.108.235.240"
readonly WEBROOT="/var/www/html"
readonly NGINX_CONF="/etc/nginx/conf.d/suppliercheck.conf"
readonly TEMPLATE="${SUPPLIERCHECK_ROOT:-/srv/suppliercheck}/deploy/nginx/suppliercheck.conf.template"
readonly HTTP_ONLY="${SUPPLIERCHECK_ROOT:-/srv/suppliercheck}/deploy/nginx/suppliercheck.http-only.conf"
readonly CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"

EMAIL=""
ACME_SERVER="default"
STAGING_FLAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --email)   EMAIL="${2:-}"; shift 2 ;;
    --staging) ACME_SERVER="staging"; shift ;;
    --prod)    ACME_SERVER="production"; shift ;;
    -h|--help)
      sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

log()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { printf '\n✗ %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || fail "需要 root 运行：sudo bash $0 --email <你的邮箱>"
[[ -n "$EMAIL" ]]      || fail "缺少 --email。Let's Encrypt 需要联系方式用于到期提醒。"

if [[ "$ACME_SERVER" == "default" ]]; then
  fail "请显式选择：--staging（演练）或 --prod（正式）。
   强烈建议先跑 --staging：ACME 有失败次数配额，链路问题应该在演练里暴露。"
fi

# ---------------------------------------------------------------------------
log "1/7 校验 DNS"
# ---------------------------------------------------------------------------
RESOLVED="$(getent hosts "${DOMAIN}" | awk '{print $1}' | sort -u | tr '\n' ' ' || true)"
if [[ -z "${RESOLVED// /}" ]]; then
  fail "DNS 未解析：${DOMAIN} 查不到 A 记录。
   请先在域名解析处添加：${DOMAIN} A ${EXPECTED_IP}
   解析生效后再运行本脚本（通常 1-10 分钟，阿里云默认 TTL 10 分钟）。"
fi
echo "  解析结果：${RESOLVED}"
if ! grep -qw "${EXPECTED_IP}" <<<"${RESOLVED}"; then
  fail "DNS 解析到的不是本机。
   期望：${EXPECTED_IP}   实际：${RESOLVED}
   若域名走了 Cloudflare 之类的代理（橙云），本机看不到真实 IP，
   此时 HTTP-01 校验仍然可用，但需要人工确认后改用 --skip-dns-check 逻辑。"
fi
echo "  ✓ 指向本机 ${EXPECTED_IP}"

# ---------------------------------------------------------------------------
log "2/7 校验 nginx 阶段一配置在位"
# ---------------------------------------------------------------------------
[[ -f "${NGINX_CONF}" ]] || fail "${NGINX_CONF} 不存在。
   请先部署阶段一配置（仅 80、放行 ACME）：
   sudo install -m 0644 ${HTTP_ONLY} ${NGINX_CONF}
   sudo /usr/sbin/nginx -t && sudo systemctl reload nginx"
grep -q "server_name[[:space:]]*${DOMAIN}" "${NGINX_CONF}" \
  || fail "${NGINX_CONF} 里没有 server_name ${DOMAIN}，配置可能不对。"
echo "  ✓ ${NGINX_CONF} 已就位"

# ---------------------------------------------------------------------------
log "3/7 实测 HTTP-01 路径可达（不消耗 ACME 配额）"
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
   排查方向：DNS 是否已全网生效（本机 hosts 缓存）、80 端口是否被安全组放行、
   nginx 是否 reload 过、server_name 是否写对。"
fi
echo "  ✓ ACME 校验路径可达"

# ---------------------------------------------------------------------------
log "4/7 签发证书（${ACME_SERVER}）"
# ---------------------------------------------------------------------------
CERTBOT_ARGS=(
  certonly --webroot -w "${WEBROOT}"
  -d "${DOMAIN}"
  --non-interactive --agree-tos --email "${EMAIL}"
  --keep-until-expiring
  # 续期后自动 reload，否则 nginx 会一直用旧证书直到手动 reload
  --deploy-hook "systemctl reload nginx"
)
if [[ "${ACME_SERVER}" == "staging" ]]; then
  CERTBOT_ARGS+=(--server https://acme-staging-v02.api.letsencrypt.org/directory)
fi

certbot "${CERTBOT_ARGS[@]}"
[[ -f "${CERT_DIR}/fullchain.pem" ]] || fail "certbot 结束但找不到 ${CERT_DIR}/fullchain.pem"
echo "  ✓ 证书已签发："
openssl x509 -in "${CERT_DIR}/fullchain.pem" -noout -subject -dates -ext subjectAltName

# ---------------------------------------------------------------------------
log "5/7 切换到 443 配置（失败自动回滚）"
# ---------------------------------------------------------------------------
[[ -f "${TEMPLATE}" ]] || fail "找不到模板 ${TEMPLATE}"
BACKUP="${NGINX_CONF}.before-https-$(date +%Y%m%d-%H%M%S)"
cp -a "${NGINX_CONF}" "${BACKUP}"
echo "  已备份原配置 -> ${BACKUP}"

# 模板里只有 __DOMAIN__ 一个占位符
sed "s|__DOMAIN__|${DOMAIN}|g" "${TEMPLATE}" > "${NGINX_CONF}"

if ! /usr/sbin/nginx -t 2>&1; then
  echo "✗ nginx -t 失败，回滚配置（生产服务不受影响）" >&2
  cp -a "${BACKUP}" "${NGINX_CONF}"
  /usr/sbin/nginx -t && echo "  已回滚到原配置，nginx 仍健康。" >&2
  fail "443 配置未通过校验，未执行 reload。请检查模板与证书路径。"
fi
echo "  ✓ nginx -t 通过"

# ---------------------------------------------------------------------------
log "6/7 reload nginx"
# ---------------------------------------------------------------------------
systemctl reload nginx
sleep 2
echo "  ✓ 已 reload"

# ---------------------------------------------------------------------------
log "7/7 端到端验证"
# ---------------------------------------------------------------------------
CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://${DOMAIN}/api/health" || true)"
echo "  https://${DOMAIN}/api/health -> ${CODE}"
REDIRECT="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "http://${DOMAIN}/api/health" || true)"
echo "  http://${DOMAIN}/api/health  -> ${REDIRECT}（期望 301）"
echo
echo "  证书链："
echo | openssl s_client -servername "${DOMAIN}" -connect "${DOMAIN}:443" 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates 2>/dev/null || true

[[ "${CODE}" == "200" ]] || fail "HTTPS 已启用但 /api/health 返回 ${CODE}，请人工确认。"

cat <<EOF

────────────────────────────────────────────────────────────
完成。

  ⚠️ 如果刚才是用 --staging 演练，浏览器会报证书不受信任，这是正常的。
     演练确认无误后，用 --prod 再跑一次换成正式证书。

  续期：certbot.timer 会自动处理（首次签发已写入 /etc/letsencrypt/renewal/），
       并带 --deploy-hook 在续期后自动 reload nginx，无需人工干预。
       查看状态：certbot certificates
EOF
