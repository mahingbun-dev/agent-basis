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

# 8) 治理规则活性探针（2026-11-10 I2 事故补遗：PR#5 修复因渲染路径错配从未生效且本脚本无检查——假阴性盲区）。
#    插件读 process.cwd()/.eterna/governance.rules.yml；容器 working_dir=/data=$DSH_HOME。
#    检查目标路径文件存在、非空、含 default: ask 与 allow-fs（空规则×never=静默全拒的根因即"文件不在插件读取路径"）。
CONTAINER="${ETERNA_CONTAINER:-eterna-agent}"
gov=$(docker exec "$CONTAINER" sh -c 'test -s /data/.eterna/governance.rules.yml && grep -c "default: ask" /data/.eterna/governance.rules.yml && grep -c "allow-fs" /data/.eterna/governance.rules.yml' 2>/dev/null | tr '\n' ' ')
if echo "$gov" | grep -q '^1 1 '; then
  ok "治理规则活性（/data/.eterna 存在+default:ask+allow-fs）"
else
  bad "治理规则活性探针失败（实得: ${gov:-不可达}）——空规则×完全权限=静默全拒事故模式"
fi

rm -f "$JAR"
echo "── 结果: $PASS 过 / $FAIL 败"
[ "$FAIL" -eq 0 ]
