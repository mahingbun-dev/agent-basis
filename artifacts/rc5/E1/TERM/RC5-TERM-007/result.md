# RC5-TERM-007 · 容器终端配置

- 套件：TERM
- 结论：**PASS**
- 开始/结束：2026-11-20T07:03:32.913Z / 2026-11-20T07:03:32.914Z

## 预期

readUserTerminals=false；preferredShells=[bash]

## 实际

渲染 patch 的 optional-terminal-panel 配置读回一致

## 备注

- 官方脚本内 007 行（同轮执行）

## 证据附件

- `cmd.log`

## 执行命令

```
$ node scripts/verify-terminal-guard.mjs --base http://127.0.0.1:3118 --accounts-file /Users/sunny/eterna-data/test-rc5/.test-accounts.json --data-root /Users/sunny/eterna-data/test-20261120/e1 --container rc5-e1suite --json /Users/sunny/code/agent-basis-rc5/artifacts/rc5/E1/TERM/RC5-TERM-004/terminal-guard-report.json  # EXIT=0
```
