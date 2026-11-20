# RC5-MCPS-004 · 普通用户看不到/改不了全局 MCP 配置

- 套件：MCPS
- 结论：**PASS**
- 开始/结束：2026-11-20T01:41:33.745Z / 2026-11-20T01:41:33.794Z

## 预期

B 的 settings/describe 无 mcp-manager 命名空间；B 写 mcp-manager 被拒；配置不变

## 实际

B含ns=false A含ns=true B写拒=true 配置未被写=true

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/settings/describe（B 普通用户）  # EXIT=200
$ POST /api/settings/describe（A 管理员）  # EXIT=200
$ POST /api/settings/update ns=mcp-manager（B 普通用户）  # EXIT=200
```
