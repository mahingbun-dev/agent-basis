# RC5-MCPS-003 · 会话内调用系统 MCP 工具

- 套件：MCPS
- 结论：**NOTRUN**
- 开始/结束：2026-11-19T22:50:49.163Z / 2026-11-19T22:50:49.696Z

## 预期

会话内工具可见/可调；结果正确

## 实际

管理面 probe 已证明 server 连接与工具清单（echo），但“会话内 agent 调用”需真实模型回合；E1 无 LLM 凭据，未执行

## 备注

- 未用 probe 结果冒充“会话内可调”：会话投影不含工具清单（keys 见 cmd.log），agent 工具调用须经模型回合
- 可观测代理证据：mcpManager/probe 的 toolNames 非空、closeConfirmed=true

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/mcpManager/probe {"name":"e1http"}  # EXIT=200
$ POST /api/session/create  # EXIT=200
$ POST /api/session/projections  # EXIT=200
```
