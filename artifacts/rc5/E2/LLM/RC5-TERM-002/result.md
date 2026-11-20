# RC5-TERM-002 · 侧栏 terminal 面板可见/可开/可输入；首次按键人接管后 Agent 只读

- 套件：LLM
- 结论：**PASS**
- 开始/结束：2026-11-20T04:38:20.580Z / 2026-11-20T04:38:33.431Z

## 预期

Agent 开终端 → 用户在侧栏键入即接管；之后 Agent send 被 user-control 拒绝且输入不入终端

## 实际

open=true typed=true takeover=true agent_leaked=false

## 备注

- 浏览器为 Playwright + 本机 Chrome（headless），cookie 注入不走登录页
- 两回合均由聊天框真实发送；确定性假模型只决定 terminal_open / terminal_send 调什么，PTY/xterm/接管判定全走产品代码

## 证据附件

- `cmd.log`

## 执行命令

```
$ UI：聊天框发送 terminal_open 回合  # EXIT=200
$ UI：xterm 键入 printf rc5-user-typed  # EXIT=200
$ UI：聊天框发送 terminal_send（已接管）  # EXIT=200
```
