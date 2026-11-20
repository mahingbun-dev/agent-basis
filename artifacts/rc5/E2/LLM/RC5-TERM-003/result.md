# RC5-TERM-003 · 逐个调用 rc.5 注册的 6 个 terminal_* 工具

- 套件：LLM
- 结论：**PASS**
- 开始/结束：2026-11-20T07:05:55.869Z / 2026-11-20T07:06:00.837Z

## 预期

全部可调用；输出通过工具结果流式回传（命令输出可见）

## 实际

requested=terminal_open,terminal_send,terminal_read,terminal_send,terminal_signal,terminal_list,terminal_close；输出片段=root@71cf1174be6d:/data/workspaces/rc5admin# printf rc5-term-ok rc5-term-okroot@71cf1174be6d:/data/workspaces/rc5admin# [wait: stdin_read] [session: running]

## 备注

- 确定性假模型只决定 tool_call 的次序与参数；PTY 创建/写入/读取/信号/关闭均由 rc.5 产品实现执行

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/session/create（终端工具会话）  # EXIT=200
$ POST /api/session/prompt（@@CALL × 7 链式终端调用）  # EXIT=200
$ POST /api/session/wait（回合记录）  # EXIT=200
```
