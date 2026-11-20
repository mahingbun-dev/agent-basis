# RC5-IMP-002 · B 传 A 的 workspaceId 403 且不写

- 套件：IMP
- 结论：**PASS**
- 开始/结束：2026-11-19T23:26:27.455Z / 2026-11-19T23:26:27.455Z

## 预期

403；不写（跨租户用例，绿）

## 实际

status=403 body=forbidden count 1→1

## 证据附件

- `IMP-report.json`
- `cmd.log`

## 执行命令

```
$ scripts/verify-chat-import.mjs（RC5-IMP-002 行）  # EXIT=0
```
