# RC5-TERM-001 · profile 含 terminal bundle

- 套件：TERM
- 结论：**PASS**
- 开始/结束：2026-11-20T07:03:32.910Z / 2026-11-20T07:03:32.911Z

## 预期

`dsh-experimental-terminal-bundle` 在 profile bundle 清单

## 实际

bundles-terminal=true（渲染 profile package.json 实读）

## 备注

- bundles 行取自同一轮 verify-terminal-guard.mjs（脚本内先做 007/001 核对）

## 证据附件

- `cmd.log`

## 执行命令

```
$ node scripts/verify-terminal-guard.mjs --base http://127.0.0.1:3118 --accounts-file /Users/sunny/eterna-data/test-rc5/.test-accounts.json --data-root /Users/sunny/eterna-data/test-20261120/e1 --container rc5-e1suite --json /Users/sunny/code/agent-basis-rc5/artifacts/rc5/E1/TERM/RC5-TERM-004/terminal-guard-report.json  # EXIT=0
```
