# RC5-TERM-SETUP · A 建立活会话（TERM 流动作受害者）

- 套件：TERM
- 结论：**PASS**
- 开始/结束：2026-11-20T00:39:24.776Z / 2026-11-20T00:39:24.789Z

## 预期

session/create 返回 sessionId

## 实际

sessionId=session-90fb975c-1a40-431a-b2cb-885c97342558

## 备注

- 辅助步骤，不计入 51 用例数

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/session/create（A 建立活会话）  # EXIT=200
```
