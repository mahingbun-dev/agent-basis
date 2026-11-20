#!/bin/sh
# RC5-API-005/006/007 真模型复跑（2026-11-20 用户授权「用已配置的模型验证」）。
#
# 在测试容器（默认 eterna-rc5-e3 / 3109 super 车道）内起一个隔离 DSH_HOME 的
# 独立 dsh 进程：默认模型 = 已配置的 mimo/mimo-v2.6-pro；harness 以
# API_HARNESS_REAL=1 不注册 stub adapter，worker/子代理回合由真实模型驱动。
# 不读写容器 /data，不触碰生产容器。
set -u
HARNESS=/tmp/api-harness
HOME_DIR=/tmp/api-real-home
PROFILE="$HOME_DIR/profiles/api-real"

rm -rf "$HOME_DIR"
mkdir -p "$HOME_DIR"
DSH_HOME="$HOME_DIR" dsh api-real --from-default-profile web --dump-config >/dev/null 2>&1 || exit 11
mkdir -p "$PROFILE/node_modules/@eterna"

ln -sfn /repo/packages/tasks "$PROFILE/node_modules/@eterna/tasks"
ln -sfn "$HARNESS" "$PROFILE/node_modules/@eterna/api-harness"

cat > "$PROFILE/cordis.patch.yml" <<'YAML'
# API-005..007 真模型 harness overlay（rc.5 真宿主 + 已配置 mimo provider）。
- id: agent-default-model
  config:
    provider: mimo
    model: mimo-v2.6-pro

- id: llm-pi-ai
  config:
    providers:
      mimo:
        displayName: MiMo（小米官方直连）
        apiKeyEnv: MIMO_API_KEY
        api: openai-completions
        baseURL: https://api.xiaomimimo.com/v1
        models:
          - id: mimo-v2.6-pro
            name: MiMo V2.6 Pro
            contextWindow: 300000
            input:
              - text
            compat:
              supportsDeveloperRole: false
              requiresReasoningContentOnAssistantMessages: true
            reasoningEfforts:
              off: null
              low: low
              medium: medium
              high: high

- insert:
    - id: eterna-tasks
      name: "@eterna/tasks"
      config:
        realm: ApiHarness
    - id: eterna-api-harness
      name: "@eterna/api-harness"
      inject: [tasks]
      config:
        outDir: /tmp/api-real-home/out
YAML

API_HARNESS_REAL=1 DSH_HOME="$HOME_DIR" DSH_AGENTS_HOME="$HOME_DIR/agents" \
  timeout 600 dsh --profile api-real --port 0 --host 127.0.0.1 --no-open > "$HOME_DIR/boot.log" 2>&1
code=$?
echo "HARNESS_EXIT=$code"
tail -30 "$HOME_DIR/boot.log"
echo "--- harness.log ---"
cat "$HOME_DIR/out/harness.log" 2>/dev/null
exit "$code"