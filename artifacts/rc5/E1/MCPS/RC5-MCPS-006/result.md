# RC5-MCPS-006 · 普通用户 restart/probe 必须被拒

- 套件：MCPS
- 结论：**PASS**
- 开始/结束：2026-11-20T07:03:00.694Z / 2026-11-20T07:03:00.700Z

## 预期

B 直接打 `mcpManager/restart`、`mcpManager/probe` → 403/deny；配置与全局 server 不受影响

## 实际

probe: status=403 ok=false；restart: status=403 ok=false；普通用户实际可重启/探测全局 MCP server

## 备注

- 根因线索：mux 策略只在流通道换血 principal；HTTP unary 走 owner Peer，ADMIN_ONLY_UNARY_ACTIONS 只收窄 UI 快照门，未做请求级拦截（packages/access/src/mux.ts:157-158/175-176 为 UI 门；routes.ts 无 mcpManager 请求级门）
- 影响：任意登录用户可探测/重启组织级 MCP server（可拉起任意 command 的管理动作被越权触发）
- 按派发规则：越权红 → 本套件在此中止，后续用例不继续标绿

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/mcpManager/probe（B 普通用户）  # EXIT=403
$ POST /api/mcpManager/restart（B 普通用户）  # EXIT=403
```
