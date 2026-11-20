# E4 ACP 夹具说明（测试专用，不入镜像）

## 假模型

`fake-model-server.mjs` 在宿主机 `127.0.0.1:18080` 提供 OpenAI `chat/completions`
SSE 方言，按 prompt 标记回放：

| 标记 | 行为 |
|---|---|
| `ACP-SLOW` | 每 350ms 一帧，约 5.25s（供 `session/cancel` 打断） |
| `ACP-TOOL` | 首次回 `tool_call: bash {description, command: echo acp-permission-ok}`；收到 `role=tool` 结果后回最终文本 |
| 其它 | 快速回“你好，ACP 协议验证通过。” |

启动：

```bash
ACP_FIXTURE_PORT=18080 ACP_FIXTURE_LOG=/tmp/acp-fixture.log \
  node artifacts/rc5/ACP/fixture/fake-model-server.mjs
```

驱动脚本会自行 start/stop，不需要手工起。

## 数据根与治理规则

夹具数据根：`$HOME/eterna-data/test-rc5/e4-acp-fixture`（0600）。
ACP-006 需要治理规则显式 ask，规则原文见
[`governance.rules.e4-acp-fixture.yml`](./governance.rules.e4-acp-fixture.yml)，部署位置：

```bash
mkdir -p "$HOME/eterna-data/test-rc5/e4-acp-fixture/access"
cp artifacts/rc5/ACP/fixture/governance.rules.e4-acp-fixture.yml \
   "$HOME/eterna-data/test-rc5/e4-acp-fixture/access/governance.rules.yml"
```

entrypoint 会把它复制到 `/data/.eterna/governance.rules.yml`（cwd=/data 的
governance-plugin 读取路径）。生产模板保持 `default: allow`，本规则只存在于测试根。

## 模板 / override

- `cordis.acp.fixture.yml.template`：仓库 `docker/profile/cordis.acp.patch.yml.template`
  的逐字拷贝，仅两行改动：`baseURL → http://host.docker.internal:18080/v1`、
  `apiKeyEnv → ACP_FIXTURE_API_KEY`。
- `compose.acp-fixture.yml`：只替换模板挂载并加 `extra_hosts`；“无 ports /
  stdin_open / tty:false” 全部继承主 compose。

`MIMO_API_KEY=acp-fixture-not-a-real-key` 只是让 entrypoint 的非空断言通过，
不是凭据；`ACP_FIXTURE_API_KEY` 同理。