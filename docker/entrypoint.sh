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

# ── 3. 插件 symlink(本仓 @eterna/*) ────────────────────────────────────
for pkg in glue llm-doctor brand panel prompt-studio llm-openai access; do
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

echo "[entrypoint] container IP: $IP  LLM: $ETERNA_LLM_BASE_URL"
exec dsh "$@"
