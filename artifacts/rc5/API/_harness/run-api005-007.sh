#!/bin/sh
# RC5-API-005/006/007 容器内复现脚本（在 eterna-rc5-e1 / 端口 3108 的测试容器里跑）。
# 隔离 DSH_HOME=/tmp/api-run-home；不读写 /data，不碰生产容器。
set -u
HARNESS=/tmp/api-harness
HOME_DIR=/tmp/api-run-home
PROFILE="$HOME_DIR/profiles/api-prof"

rm -rf "$HOME_DIR"
mkdir -p "$HOME_DIR"
DSH_HOME="$HOME_DIR" dsh api-prof --from-default-profile web --dump-config >/dev/null 2>&1 || exit 11
mkdir -p "$PROFILE/node_modules/@eterna"

ln -sfn /repo/packages/tasks "$PROFILE/node_modules/@eterna/tasks"
ln -sfn "$HARNESS" "$PROFILE/node_modules/@eterna/api-harness"

cat > "$PROFILE/cordis.patch.yml" <<'YAML'
# API-005..007 harness profile overlay (rc.5 真宿主).
# 测试容器没有可用模型凭据（DEEPSEEK_API_KEY 空；MIMO_API_KEY 为占位，实测 401），
# 故默认模型走 harness 注册的确定性 stub 适配器；tasks worker / session / subagent
# manager 仍是真实 rc.5 装配（非 fixture）。
- id: agent-default-model
  config:
    provider: stub
    model: stub-fast

- insert:
    - id: eterna-tasks
      name: "@eterna/tasks"
      config:
        realm: ApiHarness
    - id: eterna-api-harness
      name: "@eterna/api-harness"
      inject: [tasks]
      config:
        outDir: /tmp/api-run-home/out
YAML

DSH_HOME="$HOME_DIR" DSH_AGENTS_HOME="$HOME_DIR/agents" \
  timeout 180 dsh --profile api-prof --port 0 --host 127.0.0.1 --no-open > "$HOME_DIR/boot.log" 2>&1
code=$?
echo "HARNESS_EXIT=$code"
tail -20 "$HOME_DIR/boot.log"
echo "--- harness.log ---"
cat "$HOME_DIR/out/harness.log" 2>/dev/null
exit "$code"
