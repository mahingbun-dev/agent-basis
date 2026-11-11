#!/usr/bin/env bash
# 部署验证清单（迁移/升级后执行）：对目标实例跑一遍核心门禁，全过退出 0。
# 用法: ./deploy/verify.sh [BASE_URL] [ENV_FILE]
#   BASE_URL  默认 http://127.0.0.1:3210；反代形态传 https://<域名>:<端口>
#   ENV_FILE  默认仓库根 .env（读管理员凭据做登录检查）
set -u
BASE="${1:-http://127.0.0.1:3210}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${2:-$SCRIPT_DIR/../.env}"

PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "❌ $1"; FAIL=$((FAIL+1)); }
check() { # check <名称> <期望> <实际>
  if [ "$2" = "$3" ]; then ok "$1 ($3)"; else bad "$1 (期望 $2，实得 $3)"; fi
}

ADMIN_USER="${ETERNA_ACCESS_ADMIN_USER:-}"
ADMIN_PASS="${ETERNA_ACCESS_ADMIN_PASSWORD:-}"
if [ -f "$ENV_FILE" ] && [ -z "$ADMIN_USER" ]; then
  ADMIN_USER="$(grep -E '^ETERNA_ACCESS_ADMIN_USER=' "$ENV_FILE" | cut -d= -f2- | head -1)"
  ADMIN_PASS="$(grep -E '^ETERNA_ACCESS_ADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2- | head -1)"
fi

# 1) 登录页可达
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$BASE/login")
check "登录页可达" 200 "$code"

# 2) 匿名数据端点拒绝（未登录 401）
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$BASE/access/api/me")
check "匿名 /access/api/me 拒绝" 401 "$code"

# 3) 管理员登录（JSON 契约）+ 会话
JAR="$(mktemp)"
code=$(curl -s -c "$JAR" -o /dev/null -w '%{http_code}' --max-time 8 -X POST "$BASE/login" \
  -H 'Content-Type: application/json' \
  -d "{\"account\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")
check "管理员登录" 200 "$code"

# 4) 会话生效：me 返回管理员
me=$(curl -s -b "$JAR" --max-time 8 "$BASE/access/api/me")
echo "$me" | grep -q '"role":"admin"' && ok "me 返回 admin 角色" || bad "me 未返回 admin（$me）"

# 5) 插件清单（含红线）
plugins=$(curl -s -b "$JAR" --max-time 8 "$BASE/access/api/plugins")
echo "$plugins" | grep -q '"redLine":true' && ok "插件清单含红线标记" || bad "插件清单缺红线标记"

# 6) 越权变更拒绝（无 cookie 改昵称 → 401）
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -X POST "$BASE/access/api/nickname" \
  -H 'Content-Type: application/json' -d '{"nickname":"x"}')
check "无会话变更拒绝" 401 "$code"

# 7) 错密码登录拒绝（统一 401 话术）
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -X POST "$BASE/login" \
  -H 'Content-Type: application/json' \
  -d '{"account":"__verify_probe__","password":"wrong-pass-1"}')
check "错密码登录拒绝" 401 "$code"

rm -f "$JAR"

# ── companion 中继（浏览器执行面，8-10）：直连宿主映射端口 9310 ─────────────
# RELAY_BASE 可覆盖（反代形态传 https://域名/relay 前缀；带 token 时经 docker
# logs 取落卷 token——此处仅验端点存活与分发物在位，ws+token 鉴权在浏览器侧联调）
RELAY_BASE="${RELAY_BASE:-http://127.0.0.1:9310}"

# 8) 中继状态端点
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$RELAY_BASE/api/status")
check "companion 中继 /api/status 可达" 200 "$code"

# 9) 扩展分发包（zip 头 PK 可下）
body=$(curl -s --max-time 8 -r 0-1 "$RELAY_BASE/companion/download.zip" 2>/dev/null)
if [ "$(printf '%s' "$body" | head -c 2)" = "PK" ]; then ok "扩展分发包 /companion/download.zip 可下（PK 头）"; else bad "扩展分发包不可下（非 zip 内容）"; FAIL=$((FAIL+1)); fi

# 10) 指引页（含生产扩展连接地址占位不可判——只验 200 HTML）
ctype=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' --max-time 8 "$RELAY_BASE/companion/guide")
case "$ctype" in "200 text/html"*) ok "指引页 /companion/guide 可达";; *) bad "指引页异常（$ctype）"; FAIL=$((FAIL+1));; esac

echo "── 结果: $PASS 过 / $FAIL 败"
[ "$FAIL" -eq 0 ]
