# E2 套件测试环境

- 生成：2026-11-20T05:52:02.843Z
- 镜像：`eterna-agent:rc5-test` → `sha256:22fe8acb436f2ce24ea7a6b790b08462b9b769e10b98acb096590352b739bcfb`
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

## 夹具纪律（实测踩坑，必须遵守）

- 宿主 `sqlite3` CLI 对 virtiofs 上的 WAL 库（`/data/access/users.db`）会在关闭时
  执行 checkpoint 并删除 `-wal`；容器内进程仍持有已 unlink 的 WAL inode，此后
  所有记账（workspace/session 归属）写入都落在已删除 inode，外部读取为空。
  本 lane 实测一次（工作区账本 0 行）后重建数据根；之后所有宿主侧读取一律用
  `node:sqlite` `{readOnly:true}`，写操作只在容器停止时执行。
- 快照只保留 users 三账号；E1 的 workspace/session/个人 MCP 行在首启前清空，
  否则会与 E2 上游 `workspace.json` 脱节并被 boot 的 orphan 划归 admin。

## 复现

```bash
node artifacts/rc5/E2/_setup/setup.mjs init
node artifacts/rc5/E2/_setup/setup.mjs up
node artifacts/rc5/E2/_setup/setup.mjs provision
```
