#!/bin/sh
# Eterna Agent 容器入口:渲染 profile → 建立插件 symlink → 启动 dsh web。
#
# 关键事实(2026-11-09 实测):
# - `dsh --host` 只收具体接口地址,拒通配 → 启动时解析容器 eth0 IP。
# - profile node_modules 只放本仓 @eterna 插件 symlink;@deepseek-ai 家族一律
#   指向全局 dsh 自带拷贝(版本与运行时严格一致——指向工作区/registry 另装拷贝
#   会因版本错配被 dsh 静默 disable preset 行,宿主验收实例 2026-11-09 实测)。
# - patch 模板渲染到卷上(每次启动重渲染):配置变更只改 env,不动卷内容;
#   会话/存储/审计全在卷,升级镜像不丢数据。
# - bootstrap token 打印在 stdout(docker logs 取);首次浏览器连接消费后,
#   BrowserAuth 会话签名落卷 credentials(重启不掉线)。
set -eu

: "${LITELLM_API_KEY:?LITELLM_API_KEY required (env / compose .env)}"
DSH_HOME="${DSH_HOME:-/data}"
PROFILE_DIR="$DSH_HOME/profiles/eterna-web"
REPO=/repo

# ── 1. profile 骨架(不覆盖既有会话数据) ─────────────────────────────────
mkdir -p "$PROFILE_DIR/node_modules/@eterna" "$PROFILE_DIR/node_modules/@deepseek-ai"
cp /repo/docker/profile/package.json "$PROFILE_DIR/package.json"

# ── 2. patch 渲染(env 即配置) ──────────────────────────────────────────
: "${ETERNA_LLM_BASE_URL:?ETERNA_LLM_BASE_URL required (e.g. http://192.168.31.165:4000/v1)}"
sed "s|__ETERNA_LLM_BASE_URL__|$ETERNA_LLM_BASE_URL|g" \
  /repo/docker/profile/cordis.patch.yml.template > "$PROFILE_DIR/cordis.patch.yml"

# ── 2.5 插件启停清单(T2.3):admin 停用的可停插件 → 渲染时裁剪对应 insert 行 ──
DISABLED_FILE="$DSH_HOME/access/disabled-plugins.json"
REMOVED_FILE="$DSH_HOME/access/removed-plugins.json"
if [ -f "$DISABLED_FILE" ] || [ -f "$REMOVED_FILE" ]; then
  node -e '
    const fs = require("fs")
    const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")) } catch { return [] } }
    const disabled = new Set([...read(process.argv[1]), ...read(process.argv[2])])
    const removed = new Set(read(process.argv[2]))
    const redLine = new Set(["eterna-governance", "eterna-audit", "eterna-egress", "eterna-access"])
    const file = process.argv[3]
    const lines = fs.readFileSync(file, "utf8").split("\n")
    const out = []
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\s*- id: (\S+)\s*$/)
      if (m && disabled.has(m[1]) && !redLine.has(m[1]) && /^\s*name:/.test(lines[i + 1] ?? "")) { i++; continue }
      out.push(lines[i])
    }
    fs.writeFileSync(file, out.join("\n"))
    console.log("[entrypoint] plugin strip applied:", [...disabled].filter((id) => !redLine.has(id)).join(", ") || "(none)", "| removed:", [...removed].join(", ") || "(none)")
  ' "$DISABLED_FILE" "$REMOVED_FILE" "$PROFILE_DIR/cordis.patch.yml"
fi

# ── 2.6 治理规则渲染(2026-11-10「完全权限全拒」事故修复,方案 A)──────────
# governance-plugin 读 process.cwd()/.eterna/governance.rules.yml(WORKDIR=/repo);
# 缺文件即空规则集 → fail-closed 默认 ask 打在每个工具调用上,而「完全权限」预设
# approval=never 对 ask 确定性 rejected → 静默全拒。规则集随镜像入仓
# (docker/profile/governance.rules.yml,工具名逐字对账见其头注);卷上
# $DSH_HOME/access/governance.rules.yml 存在时优先(运维免重建改规则)。
GOV_SRC="$DSH_HOME/access/governance.rules.yml"
if [ ! -f "$GOV_SRC" ]; then
  GOV_SRC=/repo/docker/profile/governance.rules.yml
fi
mkdir -p /repo/.eterna
cp "$GOV_SRC" /repo/.eterna/governance.rules.yml
echo "[entrypoint] governance rules: $GOV_SRC"

# ── 3. 插件 symlink(本仓 @eterna/*) ────────────────────────────────────
for pkg in glue llm-doctor brand panel prompt-studio llm-openai access; do
  ln -sfn "$REPO/packages/$pkg" "$PROFILE_DIR/node_modules/@eterna/$pkg"
done
# creation-skills 别名(preset-cordis skill-filesystem 解析名)
ln -sfn "$REPO/packages/brand" "$PROFILE_DIR/node_modules/@eterna/creation-skills"

# ── 4. @deepseek-ai 家族 → 全局拷贝 ─────────────────────────────────────
# preset 必须指 dsh 包内拷贝（版本与运行内核严格一致——指向别处会静默 disable）；
# mcp-client 指独立全局安装包（Dockerfile 显式 npm i -g，0.2.2-rc.1）。
DSH_PKG="$(dirname "$(dirname "$(readlink -f "$(command -v dsh)")")")"
ln -sfn "$DSH_PKG/node_modules/@deepseek-ai/dsh-agent-preset" \
  "$PROFILE_DIR/node_modules/@deepseek-ai/dsh-agent-preset"
MCP_CLI="$(npm root -g)/@deepseek-ai/dsh-mcp-client"
if [ -d "$MCP_CLI" ]; then
  ln -sfn "$MCP_CLI" "$PROFILE_DIR/node_modules/@deepseek-ai/dsh-mcp-client"
else
  echo "[entrypoint] 警告：全局 @deepseek-ai/dsh-mcp-client 不存在（$MCP_CLI）——mcp-browser 挂载将失效"
fi

# ── 4.5 companion 中继（浏览器执行面）：后台监督循环拉起 ──────────────────
# relay=用户浏览器扩展的 ws 接入腿 + mcp-browser 工具的 HTTP 后端。
# token：ETERNA_RELAY_TOKEN env 优先；缺省生成随机 token 落卷（重启不变），
# docker logs 提示路径。红线 9（中继鉴权）：生产必带 token。
RELAY_TOKEN="${ETERNA_RELAY_TOKEN:-}"
if [ -z "$RELAY_TOKEN" ]; then
  TOKEN_FILE="$DSH_HOME/relay-token"
  if [ -f "$TOKEN_FILE" ]; then
    RELAY_TOKEN="$(cat "$TOKEN_FILE")"
  else
    RELAY_TOKEN="rl-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    printf '%s' "$RELAY_TOKEN" > "$TOKEN_FILE"
    chmod 600 "$TOKEN_FILE"
  fi
fi
# 用户令牌清单（access /access/api/companion 按用户生成，relay 直读校验；
# 文件缺省不存在=仅主 token 有效）。mcp-browser 的容器内凭据同源渲染进 patch。
TOKENS_FILE="$DSH_HOME/access/companion-tokens.json"
RELAY_ARGS="start --host 0.0.0.0 --port 9310 --token $RELAY_TOKEN --tokens-file $TOKENS_FILE --zip /repo/packages/extension-companion/eterna-companion.zip"
if [ -n "${ETERNA_RELAY_PUBLIC_URL:-}" ]; then
  RELAY_ARGS="$RELAY_ARGS --public-ws-url $ETERNA_RELAY_PUBLIC_URL"
fi

# patch 渲染期 mcp-browser env 的容器内凭据（LLM base 渲染在步骤 2，token 生成在其后的
# 4.5 段——故此处对已落卷的 patch 做第二遍 sed 替换占位）
sed -i "s|__ETERNA_RELAY_TOKEN__|$RELAY_TOKEN|g" "$PROFILE_DIR/cordis.patch.yml"
(
  while true; do
    node /repo/packages/browser-relay/dist/cli.mjs $RELAY_ARGS || true
    sleep 2
  done
) &
if [ -n "${ETERNA_RELAY_TOKEN:-}" ]; then
  echo "[entrypoint] companion relay 后台启动 :9310（token=env 注入；publicWsUrl=${ETERNA_RELAY_PUBLIC_URL:-未设（guide 按本机默认展示）}）"
else
  echo "[entrypoint] companion relay 后台启动 :9310（token 已生成落卷 $DSH_HOME/relay-token；publicWsUrl=${ETERNA_RELAY_PUBLIC_URL:-未设（guide 按本机默认展示）}）"
fi

# ── 5. 启动(--host 拒通配:解析容器具体地址) ────────────────────────────
IP="$(hostname -i | awk '{print $1}')"
set -- --profile eterna-web --host "$IP" --port 8080 --no-open
if [ -n "${ETERNA_PUBLIC_URL:-}" ]; then
  set -- "$@" --public-url "$ETERNA_PUBLIC_URL"
fi
if [ -n "${ETERNA_TRUSTED_HOST:-}" ]; then
  for host in $ETERNA_TRUSTED_HOST; do
    set -- "$@" --trusted-host "$host"
  done
fi

echo "[entrypoint] container IP: $IP  LLM: $ETERNA_LLM_BASE_URL"
exec dsh "$@"
