# RC5-ACC-006 · 普通用户访问 mcp-manager 设置/管理动作不可见且被拒

- 套件：ACC
- 结论：**PASS**
- 开始/结束：2026-11-20T07:05:48.435Z / 2026-11-20T07:05:48.751Z

## 预期

settings/describe 无 mcp-manager；watch/restart/probe 全 403/deny

## 实际

设置隐藏=true 写拒=true watch拒=true unary拒=true（probe=403/false restart=403/false）

## 备注

- 与 E1 RC5-MCPS-006 同根因：HTTP unary 走 owner Peer，ADMIN_ONLY_UNARY_ACTIONS 只收窄 UI 快照门（packages/access/src/mux.ts:171-177）

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/settings/update ns=mcp-manager（A 登记系统 server e2sys）  # EXIT=200
$ POST /api/settings/describe（B）  # EXIT=200
$ POST /api/settings/describe（A）  # EXIT=200
$ POST /api/settings/update ns=mcp-manager（B）  # EXIT=200
$ WS /api/remote.mux open {endpoint:"mcpManager/watch"}（B）  # EXIT=0
$ POST /api/mcpManager/probe（B）  # EXIT=403
$ POST /api/mcpManager/restart（B）  # EXIT=403
```
