# RC5-SEC-004 · 跨租户枚举：session / workspace / 文件 / MCP 全部 403/deny

- 套件：SEC
- 结论：**PASS**
- 开始/结束：2026-11-20T07:07:12.683Z / 2026-11-20T07:07:12.711Z

## 预期

B 对 A 的 session、workspace、文件、MCP 条目全部被拒；无存在性泄漏

## 实际

session=200 workspace=200 file=200 mcp=[]

## 备注

- 文件面与 ACC-008 同根因已修：/api/workspaceFiles/* 在 mux admit 换血为 per-user Peer，网关按会话资源 decide（remote-access/denied）；tenant.ts 守卫路由仍回 tenant/denied
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
