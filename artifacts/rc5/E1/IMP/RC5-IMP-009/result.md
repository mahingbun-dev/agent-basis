# RC5-IMP-009 · 坏 JSON 会话跳过、其余完整

- 套件：IMP
- 结论：**PASS**
- 开始/结束：2026-11-20T07:03:42.316Z / 2026-11-20T07:03:42.316Z

## 预期

跳过坏行继续；warning；成功会话完整

## 实际

status=200 sessionIds=10 skipped=1 brokenNamed=true

## 证据附件

- `IMP-report.json`
- `cmd.log`

## 执行命令

```
$ scripts/verify-chat-import.mjs（RC5-IMP-009 行）  # EXIT=0
```
