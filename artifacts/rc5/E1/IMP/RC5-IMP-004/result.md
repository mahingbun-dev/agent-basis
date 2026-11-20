# RC5-IMP-004 · 导入会话 B 可见 / A 不可见

- 套件：IMP
- 结论：**PASS**
- 开始/结束：2026-11-20T07:03:42.315Z / 2026-11-20T07:03:42.316Z

## 预期

B 可见；A 不可见（sessionOwner 记账）

## 实际

B 可见 10/10，A 可见 0/10（A 还能看到他人会话 = 跨租户元数据泄漏）

## 证据附件

- `IMP-report.json`
- `cmd.log`

## 执行命令

```
$ scripts/verify-chat-import.mjs（RC5-IMP-004 行）  # EXIT=0
```
