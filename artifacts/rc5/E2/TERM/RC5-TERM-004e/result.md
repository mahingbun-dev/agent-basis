# RC5-TERM-004e · B 用 A 的 sessionId 调 terminal/close 必须被拒

- 套件：TERM
- 结论：**PASS**
- 开始/结束：2026-11-20T07:05:50.179Z / 2026-11-20T07:05:50.180Z

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
$ node scripts/verify-terminal-guard.mjs --base http://127.0.0.1:3119 --accounts-file /Users/sunny/eterna-data/test-rc5/.test-accounts.json --data-root /Users/sunny/eterna-data/test-20261120/e2 --container rc5-e2suite --json /Users/sunny/code/agent-basis-rc5/artifacts/rc5/E2/TERM/report.json  # EXIT=0
```
