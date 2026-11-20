# RC5-TERM-004 · B 用 A 的 sessionId 调 terminal 6 个 unary 动作必须 403/deny

- 套件：TERM
- 结论：**PASS**
- 开始/结束：2026-11-20T07:03:32.912Z / 2026-11-20T07:03:32.913Z

## 预期

list/environment/shells/create/close/rename 全部 403/deny，无数据泄漏

## 实际

6/6 remote-access/denied（mux admit 换血 eterna-user principal + 服务入口租户守卫）

## 备注

- 2026-11-20 复跑：W5 修复前本行为 FAIL（B 读到 A 的 cwd/shells）；修复后在 E1 容器实测 6/6 deny
- 历史失败报告保留在 terminal-guard-report.pre-fix.json

## 证据附件

- `terminal-guard-report.json`
- `terminal-guard-report.pre-fix.json`
- `cmd.log`

## 执行命令

```
$ node scripts/verify-terminal-guard.mjs --base http://127.0.0.1:3118 --accounts-file /Users/sunny/eterna-data/test-rc5/.test-accounts.json --data-root /Users/sunny/eterna-data/test-20261120/e1 --container rc5-e1suite --json /Users/sunny/code/agent-basis-rc5/artifacts/rc5/E1/TERM/RC5-TERM-004/terminal-guard-report.json  # EXIT=0
```
