# RC5-SEC-006 · 审计无明文；关键事件齐全

- 套件：SEC
- 结论：**PASS**
- 开始/结束：2026-11-20T00:37:12.632Z / 2026-11-20T00:37:12.634Z

## 预期

审计与日志无密钥/token/cookie/authorization；登录、登出、租户决策、个人 MCP、chat-import、terminal/mux/sandbox 安装事件齐全

## 实际

hits=0；kind=access.chatImport,access.login,access.login.gate,access.logout,access.mux.install,access.sandbox.install,access.tenant,access.terminal.install,mcp.personal.delete,mcp.personal.install,mcp.personal.probe,mcp.personal.upsert

## 备注

- MCP 事件落在 2026-11-19 的审计文件（MCPP 跑在 UTC 23:5x），SEC-008 的 logout 事件落在 2026-11-20 文件，故两日文件一起扫

## 证据附件

- `cmd.log`

## 执行命令

```
$ ls /Users/sunny/eterna-data/test-20261120/e2/.eterna + /Users/sunny/eterna-data/test-20261120/e2/logs  # EXIT=0
$ scan audit/log 文件（密钥/token/authorization/cookie/密码）  # EXIT=0
$ 统计审计事件 kind  # EXIT=0
```
