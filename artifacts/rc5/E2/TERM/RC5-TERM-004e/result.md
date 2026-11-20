# RC5-TERM-004e · B 用 A 的 sessionId 调 terminal/close 必须被拒

- 套件：TERM
- 结论：**FAIL**
- 开始/结束：2026-11-20T00:39:24.632Z / 2026-11-20T00:39:24.632Z

## 预期

按 51 §3.7

## 实际

跨租户未拒绝：B 与 A 结果相同=true；B=undefined

## 备注

- 本行由 scripts/verify-terminal-guard.mjs（51 §4 指定脚本）在同一次执行中产出；命令见上
- 跨租户可达 → 已按 lane 停线规则记 P0

## 证据附件

- `cmd.log`

## 执行命令

```
$ node scripts/verify-terminal-guard.mjs --base http://127.0.0.1:3119 --accounts-file <0600> --data-root <E2 数据根> --container rc5-e2suite --json artifacts/rc5/E2/TERM/report.json  # EXIT=0
```
