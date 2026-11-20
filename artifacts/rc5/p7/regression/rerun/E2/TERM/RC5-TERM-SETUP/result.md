# RC5-TERM-SETUP · A 建立活会话（TERM 流动作受害者）

- 套件：TERM
- 结论：**PASS**
- 开始/结束：2026-11-20T01:38:51.630Z / 2026-11-20T01:38:51.657Z

## 预期

session/create 返回 sessionId

## 实际

sessionId=session-e169525a-d619-4402-b759-f4c100eb71db

## 备注

- 辅助步骤，不计入 51 用例数

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/session/create（A 建立活会话）  # EXIT=200
```
