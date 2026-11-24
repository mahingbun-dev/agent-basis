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

# 2.5) 匿名根路径跳登录页（2026-11-17：dsh 索引认证 401 由 access 改写为 302 /login）
loc=$(curl -s -o /dev/null -w '%{redirect_url}' --max-time 8 "$BASE/")
check "匿名根路径跳登录页" "$BASE/login" "$loc"

# 3) 管理员登录（JSON 契约）+ 会话
JAR="$(mktemp)"
resp=$(curl -s -c "$JAR" -w '\n%{http_code}' --max-time 8 -X POST "$BASE/login" \
  -H 'Content-Type: application/json' \
  -d "{\"account\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")
code="${resp##*$'\n'}"; body="${resp%$'\n'*}"
check "管理员登录" 200 "$code"
# dsh 桥接：登录 JSON 只回 redirect；必须跟一次 /?token=... 才铸 dsh 会话 cookie。
# 知识库 RPC 走 access 租户守卫，按 dsh token 认人——不跟就 401 unauthorized
# （2026-11-19 首次部署实测；E2E 脚本一直这么跟，verify 漏了一步）。
redirect=$(printf '%s' "$body" | sed -n 's/.*"redirect":"\([^"]*\)".*/\1/p')
# 生产 redirect 是 ETERNA_PUBLIC_URL 公网根；本机验证要换成 $BASE 再跟，
# 否则 token cookie 落在公网域名/localhost 不一致，守卫仍认不出会话。
redirect_path=$(printf '%s' "$redirect" | sed -E 's#^[a-zA-Z][a-zA-Z0-9+.-]*://[^/]*##')
if [ -n "$redirect_path" ]; then
  curl -s -b "$JAR" -c "$JAR" -L --max-time 8 "$BASE$redirect_path" >/dev/null || true
fi

# 4) 会话生效：me 返回管理员
me=$(curl -s -b "$JAR" --max-time 8 "$BASE/access/api/me")
echo "$me" | grep -q '"role":"admin"' && ok "me 返回 admin 角色" || bad "me 未返回 admin（${me}）"

# 5) 插件清单（含红线）
plugins=$(curl -s -b "$JAR" --max-time 8 "$BASE/access/api/plugins")
echo "$plugins" | grep -q '"redLine":true' && ok "插件清单含红线标记" || bad "插件清单缺红线标记"

# 5.5) 发布说明路由已挂载（55 号）：匿名必须 401——404 说明 access 没接线或镜像缺清单
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$BASE/access/api/release-notes")
check "匿名 /access/api/release-notes 拒绝" 401 "$code"

# 15) 发布说明（55 号 §5.3 ④；编号沿用设计文档的清单序）：current.version == VERSION 且 ≥3 页
#     镜像里的 VERSION 与清单是同一份事实；这里验「线上真的读到了它」。
REL_VERSION="$(tr -d '[:space:]' < "$SCRIPT_DIR/../VERSION" 2>/dev/null || true)"
notes=$(curl -s -b "$JAR" --max-time 8 "$BASE/access/api/release-notes")
if [ -z "$REL_VERSION" ]; then
  bad "仓库缺 VERSION——发布说明无从判定（55 号 §5.1）"
elif ! printf '%s' "$notes" | grep -q "\"version\":\"$REL_VERSION\""; then
  bad "发布说明未指向 ${REL_VERSION}（${notes}）"
elif printf '%s' "$notes" | grep -q '"current":null'; then
  bad "发布说明 current 为空（镜像缺 releases/$REL_VERSION/release.json？）"
else
  slides=$(printf '%s' "$notes" | grep -o '"kind":"' | wc -l | tr -d ' ')
  if [ "${slides:-0}" -ge 3 ]; then ok "发布说明 ${REL_VERSION}（$slides 页）"; else bad "发布说明页数不足（实得 ${slides}）"; fi
fi

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
#    检查目标路径文件存在、非空、含显式 default 声明与 allow-fs（空规则×never=静默全拒的根因即
#    "文件不在插件读取路径"）。口径 2026-11-19 起:部署文件显式 default: allow(询问全局静默,
#    沙箱/access 钳制/egress 承担限界);引擎缺省仍 ask(裸宿主 fail-closed 不动),故这里的断言
#    钉「部署文件在场且显式声明」,不钉引擎缺省。
CONTAINER="${ETERNA_CONTAINER:-eterna-agent}"
gov=$(docker exec "$CONTAINER" sh -c 'test -s /data/.eterna/governance.rules.yml && grep -cE "^default: (allow|ask|deny)$" /data/.eterna/governance.rules.yml && grep -c "^  - id: allow-fs" /data/.eterna/governance.rules.yml' 2>/dev/null | tr '\n' ' ')
if [ "$gov" = "1 1 " ]; then
  ok "治理规则活性（/data/.eterna 存在+default 显式+allow-fs）"
else
  bad "治理规则活性探针失败（实得: ${gov:-不可达}）——空规则×完全权限=静默全拒事故模式"
fi

# 8.5) 知识底座内置装载（2026-11-19 融合：唯一宿主 @eterna/knowledge-admin，
#      Loader 行 id 仍是 eterna-knowledge；四工具 + 侧栏「知识库」+ 账号面同一实例）。
#      静态两件：profile patch 的 baked row name + @eterna 链；运行时一件：登录态
#      POST /api/knowledgeAdmin/overview 返回 ok。web/super 任一 profile 满足即可。
kb=$(docker exec "$CONTAINER" sh -c 'for p in /data/profiles/eterna-web /data/profiles/eterna-super; do if grep -q "name: .@eterna/knowledge-admin." "$p/cordis.patch.yml" 2>/dev/null && [ -e "$p/node_modules/@eterna/knowledge-admin" ]; then basename "$p"; break; fi; done' 2>/dev/null)
if [ -n "$kb" ]; then
  ok "知识底座内置装载（profile: ${kb}）"
else
  bad "知识底座未内置装载（patch 行 name/symlink 任一缺席）——切形态后四工具与「知识库」页会一起消失"
fi
kbprobe='{"type":"client-request","rpcId":"verify-kb","method":"knowledgeAdmin/overview","payload":{"args":{}}}'
kbresp=$(curl -s -b "$JAR" --max-time 10 -X POST "$BASE/api/knowledgeAdmin/overview" \
  -H 'Content-Type: application/json' -d "$kbprobe")
echo "$kbresp" | grep -q '"ok":true' && ok "知识底座运行探针（overview ok）" \
  || bad "知识底座运行探针失败（${kbresp:-不可达}）"

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
case "$ctype" in "200 text/html"*) ok "指引页 /companion/guide 可达";; *) bad "指引页异常（${ctype}）"; FAIL=$((FAIL+1));; esac

echo "── 结果: $PASS 过 / $FAIL 败"
[ "$FAIL" -eq 0 ]
