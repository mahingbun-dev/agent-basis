# RC5-TERM-SETUP · A 建立活会话 + 受害终端（TERM 流动作受害者）

- 套件：TERM
- 结论：**PASS**
- 开始/结束：2026-11-20T07:05:50.329Z / 2026-11-20T07:05:50.380Z

## 预期

session/create 返回 sessionId；terminal/create 建出 running 终端

## 实际

sessionId=session-48caf76f-1af8-4db7-957f-a8361c3e4625 terminal=e2-victim-term

## 备注

- 辅助步骤，不计入 51 用例数

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/session/create（A 建立活会话）  # EXIT=200
$ POST /api/terminal/create（A 建受害终端，供 005 用真实 id）  # EXIT=200
```
