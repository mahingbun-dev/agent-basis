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

: "${MIMO_API_KEY:?MIMO_API_KEY required (env / compose .env——默认模型走 MiMo 直连)}"
DSH_HOME="${DSH_HOME:-/data}"
PROFILE_DIR="$DSH_HOME/profiles/eterna-web"
REPO=/repo

# ── 1. profile 骨架(不覆盖既有会话数据) ─────────────────────────────────
mkdir -p "$PROFILE_DIR/node_modules/@eterna" "$PROFILE_DIR/node_modules/@deepseek-ai"
cp /repo/docker/profile/package.json "$PROFILE_DIR/package.json"

# ── 2. patch 渲染(env 即配置;P2 网关后模板无占位符,直拷) ────────────────
cp /repo/docker/profile/cordis.patch.yml.template "$PROFILE_DIR/cordis.patch.yml"

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
for pkg in glue llm-doctor brand panel prompt-studio llm-openai access usage-stats; do
  ln -sfn "$REPO/packages/$pkg" "$PROFILE_DIR/node_modules/@eterna/$pkg"
done
# creation-skills 别名(preset-cordis skill-filesystem 解析名)
ln -sfn "$REPO/packages/brand" "$PROFILE_DIR/node_modules/@eterna/creation-skills"

# ── 4. @deepseek-ai 家族 → 全局 dsh 同版本拷贝 ─────────────────────────
DSH_PKG="$(dirname "$(dirname "$(readlink -f "$(command -v dsh)")")")"
ln -sfn "$DSH_PKG/node_modules/@deepseek-ai/dsh-agent-preset" \
  "$PROFILE_DIR/node_modules/@deepseek-ai/dsh-agent-preset"

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
