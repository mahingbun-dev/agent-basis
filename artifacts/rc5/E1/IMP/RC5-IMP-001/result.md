# RC5-IMP-001 · 未登录上传 401 且不写会话

- 套件：IMP
- 结论：**PASS**
- 开始/结束：2026-11-19T23:26:27.455Z / 2026-11-19T23:26:27.455Z

## 预期

401；不写任何会话

## 实际

status=401 count 0→0

## 证据附件

- `IMP-report.json`
- `cmd.log`

## 执行命令

```
$ scripts/verify-chat-import.mjs（RC5-IMP-001 行）  # EXIT=0
```
