# RC5-MCPP-018 · 断线重连 3 次后停止；新会话恢复

- 套件：MCPP
- 结论：**PASS**
- 开始/结束：2026-11-20T05:53:18.466Z / 2026-11-20T05:53:40.495Z

## 预期

配置下传 maxAttempts=3；掉线后重连窗口内工具重新可用；20s 后已 give-up（工具注销）；新会话恢复

## 实际

unit=true baseline=true reconnected=true absentAt20s=true recovered=true

## 备注

- lane=rc5-e2suite（独立测试容器，未触碰生产）
- 掉线由目录项 flaky（已连接 3s 后主动退出的 stdio 夹具）制造；每次重连起新进程、3s 后再掉
- mcp-client 的 reconnect 日志走宿主 logger、不落容器 stdout（实测 0 行），故行为腿用「重连窗口可用 → 20s 后消失」判定；精确 3 次由单测腿锁定
- give-up 是终态：恢复靠新会话重新挂载（不是无限重连自愈）

## 证据附件

- `cmd.log`

## 执行命令

```
$ pnpm --filter @eterna/access exec vitest run tests/mcp-personal-runtime.spec.ts -t personalMcpClientInput  # EXIT=0
$ POST /api/mcp-personal/catalog（B）  # EXIT=200
$ POST /api/mcp-personal/upsert {name:flaky,stdio,catalogId:flaky}（B）  # EXIT=200
$ POST /api/session/prompt（基线 echo，假模型）  # EXIT=200
$ POST /api/session/prompt（掉线后重连窗口内再调）  # EXIT=200
$ POST /api/session/prompt（20s 后检查工具是否注销）  # EXIT=200
$ POST /api/mcp-personal/delete（清理 flaky）  # EXIT=200
$ POST /api/mcp-personal/upsert {name:recovered,catalogId:echo}（恢复用）  # EXIT=200
$ 新会话 + 假模型 echo（恢复验证）  # EXIT=200
```
