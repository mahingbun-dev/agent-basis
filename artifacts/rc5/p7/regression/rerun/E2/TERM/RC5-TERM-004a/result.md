# RC5-TERM-004a · B 用 A 的 sessionId 调 terminal/list 必须被拒

- 套件：TERM
- 结论：**PASS**
- 开始/结束：2026-11-20T01:38:51.473Z / 2026-11-20T01:38:51.473Z

## 预期

按 51 §3.7

## 实际

denied code=remote-access/denied

## 备注

- 本行由 scripts/verify-terminal-guard.mjs（51 §4 指定脚本）在同一次执行中产出；命令见上

## 证据附件

- `cmd.log`

## 执行命令

```
$ node scripts/verify-terminal-guard.mjs --base http://127.0.0.1:3119 --accounts-file <0600> --data-root <E2 数据根> --container rc5-e2suite --json artifacts/rc5/E2/TERM/report.json  # EXIT=0
```
