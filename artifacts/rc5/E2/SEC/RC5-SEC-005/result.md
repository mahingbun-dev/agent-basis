# RC5-SEC-005 · 普通用户不可触达管理面（系统 MCP / 插件 / 用户 / 市场写）

- 套件：SEC
- 结论：**FAIL**
- 开始/结束：2026-11-20T00:37:12.543Z / 2026-11-20T00:37:12.632Z

## 预期

全部 403/deny

## 实际

可达面=mcpManager/probe,mcpManager/restart（probe ok=true restart ok=true）

## 备注

- MCP 全局 probe/restart 走 unary HTTP = owner Peer，mux 的 ADMIN_ONLY_UNARY_ACTIONS 只挡 UI 门 → 普通用户仍可触发系统 server 重建/探测（ACC-006 P0 同根因）

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/settings/update {ns:mcp-manager}（B）  # EXIT=200
$ POST /api/settings/update {ns:llm-pi-ai}（B）  # EXIT=200
$ POST /api/pluginManager/listBundles（B）  # EXIT=403
$ POST /access/api/users（B）  # EXIT=403
$ POST /access/api/plugins/eterna-panel（B）  # EXIT=403
$ POST /api/pluginMarket/publish（B）  # EXIT=403
$ POST /api/mcpManager/probe {name:fixture-echo}（B）  # EXIT=200
$ POST /api/mcpManager/restart {name:fixture-echo}（B）  # EXIT=200
```
