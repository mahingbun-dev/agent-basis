#!/bin/sh
# Eterna Agent 容器入口:渲染 profile → 建立插件 symlink → 启动 dsh web。
#
# 关键事实(2026-11-09 实测):
# - `dsh --host` 只收具体接口地址,拒通配 → 启动时解析容器 eth0 IP。
# - profile node_modules 只放本仓 @eterna 插件 symlink;@deepseek-ai 家族一律
#   指向全局 dsh 自带拷贝(版本与运行时严格一致——指向工作区/registry 另装拷贝
#   会因版本错配被 dsh 静默 disable preset 行,宿主验收实例 2026-11-09 实测)。
# - patch/manifest 模板渲染走哈希门控(2026-11-12 重构):模板(+relay token 盐)
#   未变则保留卷上用户文件——插件页启停(cordis.patch.yml disabled: 标记)、包级
#   启停与模型设置(package.json dsh.profile / patch llm-pi-ai 行)跨重启持久;
#   模板变更(镜像升级)才重渲染,并把旧文件的启停标记/追加覆写行/bundles 选择
#   窄移植到新渲染(模型行 config 不移植——升级重置,重启场景已由门控根治)。
#   会话/存储/审计全在卷,升级镜像不丢数据。
# - bootstrap token 打印在 stdout(docker logs 取);首次浏览器连接消费后,
#   BrowserAuth 会话签名落卷 credentials(重启不掉线)。
set -eu

: "${MIMO_API_KEY:?MIMO_API_KEY required (env / compose .env——默认模型走 MiMo 直连)}"
DSH_HOME="${DSH_HOME:-/data}"
PROFILE_DIR="$DSH_HOME/profiles/eterna-web"
REPO=/repo

# ── 1. profile 骨架(不覆盖既有会话数据) ─────────────────────────────────
mkdir -p "$PROFILE_DIR/node_modules/@eterna" "$PROFILE_DIR/node_modules/@deepseek-ai"

# ── 2. 模板哈希门控渲染(2026-11-12 重构,修复「插件启停/模型设置重启即丢」)──
# 过去每启裸 cp 模板覆盖卷上 cordis.patch.yml 与 package.json——dsh 插件页启停
# 写 patch 的 disabled: 标记(boot/plugin-manager patch.ts:25-78)、包级启停与
# 设置弹窗「模型」分区(dsh-config-editor 写 llm-pi-ai 行)全部重启即丢。
# 现按 sha256(模板内容 + ETERNA_RELAY_TOKEN 盐) 门控:未变→保留用户文件;
# 首启/模板变更→重渲染,且把旧文件的显式 disabled 标记、仅存于旧文件的用户
# 覆写行、manifest 的 dsh.profile 块移植到新渲染(2026-11-12 用户拍板)。
# 治理红线行不参与移植(其装载由本文件第 2.5 步 admin 清单独立管理)。
RENDER_SALT="${ETERNA_RELAY_TOKEN:-}"

ensure_rendered() {
  tpl="$1"; dst="$2"; hashfile="$3"; mode="$4"
  want="$( { cat "$tpl"; printf '%s' "$RENDER_SALT"; } | sha256sum | cut -d' ' -f1 )"
  if [ -f "$dst" ] && [ -f "$hashfile" ] && [ "$(cat "$hashfile")" = "$want" ]; then
    echo "[entrypoint] profile 渲染:模板未变,保留用户文件 $(basename "$dst")(启停/模型设置跨重启持久)"
    return 0
  fi
  if [ -f "$dst" ]; then
    echo "[entrypoint] profile 渲染:模板变更/首启接管,移植用户标记后重渲染 $(basename "$dst")"
    node - "$tpl" "$dst" "$mode" <<'TRANSPLANT_EOF' || cp "$tpl" "$dst"
const fs = require('fs')
const [tplPath, dstPath, mode] = process.argv.slice(2)
if (mode === 'manifest') {
  let tpl = null, old = null
  try { tpl = JSON.parse(fs.readFileSync(tplPath, 'utf8')) } catch { /* 模板坏:走直拷 */ }
  try { old = JSON.parse(fs.readFileSync(dstPath, 'utf8')) } catch { /* 旧文件坏:弃移植 */ }
  if (tpl === null) { process.exit(1) }
  if (old !== null && old.dsh && typeof old.dsh === 'object') tpl.dsh = old.dsh
  fs.writeFileSync(dstPath, JSON.stringify(tpl, null, 2) + '\n')
  process.exit(0)
}
// patch 模式:文本级顶层块移植(顶层=col0 的 `- ` 行;preset 组内嵌行有缩进不参与)
const tplText = fs.readFileSync(tplPath, 'utf8')
const oldText = fs.readFileSync(dstPath, 'utf8')
function splitBlocks(text) {
  const lines = text.split('\n')
  const out = []
  let start = -1
  for (let i = 0; i <= lines.length; i++) {
    const line = i < lines.length ? lines[i] : '- '
    if (/^- /.test(line) && start >= 0) { out.push({ lines: lines.slice(start, i), start }); start = -1 }
    if (i < lines.length && /^- /.test(line)) start = i
  }
  return { lines, out }
}
const blockId = (b) => { const m = /^- id: (\S+)\s*$/.exec(b[0]); return m ? m[1] : null }
const explicitDisabled = (b) => {
  for (const l of b.slice(1)) { const m = /^  disabled: (true|false)\s*$/.exec(l); if (m) return m[1] }
  return null
}
const tpl = splitBlocks(tplText)
const old = splitBlocks(oldText)
const tplById = new Map()
for (const b of tpl.out) { const id = blockId(b.lines); if (id !== null && !tplById.has(id)) tplById.set(id, b) }
const edits = []
for (const b of old.out) {
  const id = blockId(b.lines)
  const oldDis = explicitDisabled(b.lines)
  if (id === null || oldDis === null) continue
  const tb = tplById.get(id)
  if (tb !== undefined) {
    if (explicitDisabled(tb.lines) === oldDis) continue
    let replaced = false
    for (let k = 1; k < tb.lines.length; k++) {
      if (/^  disabled: /.test(tb.lines[k])) { edits.push({ at: tb.start + k, kind: 'replace', text: '  disabled: ' + oldDis }); replaced = true; break }
    }
    if (!replaced) edits.push({ at: tb.start + 1, kind: 'insertBefore', text: '  disabled: ' + oldDis })
  } else {
    const appendLines = [...b.lines]
    while (appendLines.length > 0 && appendLines[appendLines.length - 1].trim() === '') appendLines.pop()
    if (appendLines.every((l, k) => k === 0 || l.trim() === '' || /^#/.test(l) || /^  [A-Za-z][\w-]*: (?!!!)\S/.test(l))) {
      edits.push({ at: -1, kind: 'append', text: appendLines.join('\n') })
    }
  }
}
const lines = tplText.split('\n')
while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
for (const e of edits.sort((a, b) => b.at - a.at)) {
  if (e.kind === 'replace') lines[e.at] = e.text
  else if (e.kind === 'insertBefore') lines.splice(e.at, 0, e.text)
  else { lines.push(''); for (const l of e.text.split('\n')) lines.push(l) }
}
lines.push('')
fs.writeFileSync(dstPath, lines.join('\n'))
console.log('[entrypoint] 移植标记:', edits.length, '处')
TRANSPLANT_EOF
  else
    echo "[entrypoint] profile 渲染:全新卷,直拷模板 $(basename "$dst")"
    cp "$tpl" "$dst"
  fi
  printf '%s' "$want" > "$hashfile"
}

ensure_rendered /repo/docker/profile/package.json "$PROFILE_DIR/package.json" "$PROFILE_DIR/.rendered.package.json.sha256" manifest
ensure_rendered /repo/docker/profile/cordis.patch.yml.template "$PROFILE_DIR/cordis.patch.yml" "$PROFILE_DIR/.rendered.cordis.patch.yml.sha256" patch

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
# governance-plugin 读 process.cwd()/.eterna/governance.rules.yml(governance-plugin.ts:74)。
# 容器 working_dir=/data(compose:23)= $DSH_HOME——渲染目标必须是 $DSH_HOME/.eterna/。
# 【2026-11-10 I2 事故修正】原实现按「WORKDIR=/repo」的错误假设渲染到 /repo/.eterna/,
# 插件读不到 → 空规则集 → fail-closed 默认 ask × 完全权限预设 approval=never = 同毫秒全拒
# (cherry 会话 session-6b03c31d 实证)。规则集随镜像入仓
# (docker/profile/governance.rules.yml,工具名逐字对账见其头注);卷上
# $DSH_HOME/access/governance.rules.yml 存在时优先(运维免重建改规则)。
GOV_SRC="$DSH_HOME/access/governance.rules.yml"
if [ ! -f "$GOV_SRC" ]; then
  GOV_SRC=/repo/docker/profile/governance.rules.yml
fi
mkdir -p "$DSH_HOME/.eterna"
cp "$GOV_SRC" "$DSH_HOME/.eterna/governance.rules.yml"
echo "[entrypoint] governance rules: $GOV_SRC -> $DSH_HOME/.eterna/governance.rules.yml (cwd=$(pwd))"

# ── 3. 插件 symlink(本仓 @eterna/*) ────────────────────────────────────
# compaction(2026-11-12 fork 的上下文压缩家族)必须在此清单内,否则容器内解析不到。
# attachments(2026-11-12 附件入口,客户端双面包)同理——缺 symlink 即 insert 行静默 disable。
for pkg in glue llm-doctor brand panel prompt-studio llm-openai access usage-stats compaction attachments; do
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

echo "[entrypoint] container IP: $IP  LLM: 三家直连(deepseek/mimo/glm,P2 网关)"

# ── 沙箱 runner 预检(P1-T3):landlock probe 非 full → 告警(沙箱 fail-closed 由上游保证,
#    预检只做可见性;实测基镜像 probe=full,见隔离计划 T0.1)。
# 沙箱 runner 预检(P1-T3):直调 landlock-run --probe(等价 probe() 语义:exit 0 且无
# partial 标记=full)。包不入顶层 node_modules(可选依赖),按 .pnpm 实际路径定位。
LAUNCHER="$(find /repo/node_modules/.pnpm -path '*node-addon-system-*/bin/landlock-run' -type f 2>/dev/null | head -1)"
SANDBOX_PROBE="unusable"
if [ -n "$LAUNCHER" ] && [ -x "$LAUNCHER" ] && OUT="$("$LAUNCHER" --probe 2>/dev/null)" && [ "$?" = "0" ]; then
  case "$OUT" in *partially\ enforced*) SANDBOX_PROBE="partial" ;; *) SANDBOX_PROBE="full" ;; esac
fi
if [ "$SANDBOX_PROBE" = "full" ]; then
  echo "[entrypoint] sandbox runner: landlock full"
else
  echo "[entrypoint] WARNING sandbox runner probe: $SANDBOX_PROBE — 沙箱可能 fail-closed(全拒)或降级,请检查内核"
fi

exec dsh "$@"
