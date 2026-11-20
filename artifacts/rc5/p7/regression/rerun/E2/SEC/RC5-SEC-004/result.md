# RC5-SEC-004 · 跨租户枚举：session / workspace / 文件 / MCP 全部 403/deny

- 套件：SEC
- 结论：**FAIL**
- 开始/结束：2026-11-20T01:52:04.688Z / 2026-11-20T01:52:04.802Z

## 预期

B 对 A 的 session、workspace、文件、MCP 条目全部被拒；无存在性泄漏

## 实际

workspaceFiles/read 未拒绝：B 读到 A 工作区文件（value={"absolutePath":"/data/workspaces/rc5admin/e2-marker.txt","version":"43:211947:28:1795132187782666237:1795132187782666237","bytes":28,"offset":1,"text":"E2-ADMI… contentLeak=true）；session/workspace 面正常拒绝

## 备注

- 文件面复现 ACC-008 的 P0：workspaceFiles/* 不在 tenant.ts 的 sessionValidated 守卫清单内
- session/events 与 workspace/delete 的拒绝形态与伪造 id 一致（无存在性泄漏）

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/session/events {sessionId:A}（B）  # EXIT=200
$ POST /api/session/events {sessionId:不存在}（B）  # EXIT=200
$ POST /api/workspace/delete {A 工作区}（B）  # EXIT=200
$ POST /api/workspace/delete {不存在}（B）  # EXIT=200
$ POST /api/workspaceFiles/stat {scopeId:A session, path:e2-marker.txt}（B）  # EXIT=200
$ POST /api/workspaceFiles/read {scopeId:A session, path:e2-marker.txt}（B）  # EXIT=200
$ POST /api/mcp-personal/list（B）  # EXIT=200
```
