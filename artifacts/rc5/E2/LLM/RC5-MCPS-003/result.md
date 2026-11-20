# RC5-MCPS-003 · 会话内调用系统 MCP 工具（确定性模型回合）

- 套件：LLM
- 结论：**PASS**
- 开始/结束：2026-11-20T07:05:55.617Z / 2026-11-20T07:05:55.868Z

## 预期

工具在 tools 清单中、可调用、结果正确回传

## 实际

tools_has=true result_echo=true call=mcp__e2sys__echo

## 备注

- 模型=确定性假模型（fake/fake-1）——只替代「选工具」，不替代 MCP 客户端/权限/执行

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/session/create（管理员，系统 MCP 会话）  # EXIT=200
$ POST /api/session/prompt（@@CALL name=mcp__e2sys__echo）  # EXIT=200
$ POST /api/session/wait（回合记录）  # EXIT=200
```
