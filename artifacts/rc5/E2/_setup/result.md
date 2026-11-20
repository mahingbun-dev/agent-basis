# E2 套件测试环境

- 生成：2026-11-19T23:47:14.863Z
- 镜像：`eterna-agent:rc5-test` → `sha256:99d8e85b509b6e3e1990481b2742a98cd550161621491cba16964d801d838f00`
- 容器：`rc5-e2suite`（项目 `rc5-e2suite`），宿主端口 **3119** → 8080；relay 9322 → 9310
- 数据根：`/Users/sunny/eterna-data/test-20261120/e2`
- 夹具：`/Users/sunny/code/agent-basis-rc5/tests/fixtures` → `/fixtures:ro`
- 个人层 MCP：catalog=echo（stdio，/fixtures/mcp-echo-server.mjs）；主密钥=`/data/.secrets/mcp-master-key`（0600）
- 健康：healthy
- 账号快照：users 行数 3（口令不落证据）

## 环境偏差（必须知悉）

- 54 §6.1 规定 E2 使用 3108 容器。本 lane 运行期间 3108 由另一 lane 的 24h 浸泡容器
  `eterna-rc5-e1` 占用；该浸泡以容器连续性为判据，重启/改写会破坏其 P0 证据。
  故本 lane 用同一镜像在**独立项目/容器/数据根/端口 3119** 上执行，
  容器隔离强度与 3108 等价；生产容器 `eterna-agent`（3210）全程未触碰。

## 复现

```bash
node artifacts/rc5/E2/_setup/setup.mjs init
node artifacts/rc5/E2/_setup/setup.mjs up
node artifacts/rc5/E2/_setup/setup.mjs provision
```
