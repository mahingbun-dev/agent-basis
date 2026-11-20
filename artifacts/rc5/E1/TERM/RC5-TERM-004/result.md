# RC5-TERM-004 · B 用 A 的 sessionId 调 terminal 6 个 unary 动作必须 403/deny

- 套件：TERM
- 结论：**FAIL**
- 开始/结束：2026-11-19T23:26:01.352Z / 2026-11-19T23:26:01.352Z

## 预期

list/environment/shells/create/close/rename 全部 403/deny，无数据泄漏

## 实际

list/environment/shells/close 均未拒绝：B 拿到 A 会话的 cwd=/data/workspaces/rc5admin、shells=[/bin/bash]、close 成功；create/rename 因方法自用即报错无法判定

## 备注

- 根因线索：installTerminalTenant 只在 principal.kind==="eterna-user" 时校验（packages/access/src/terminal.ts:63-73），而 HTTP unary 走 owner Peer（packages/access/src/mux.ts:6-9），tenant 守卫被绕过；access 无 terminal unary 路由守卫（grep terminal/ packages/access/src 仅 mux 策略）
- 影响：任意登录用户可读他人会话终端环境/列出 shell/关闭终端（跨租户数据与破坏面）
- RC5-TERM-004 跨租户红（B 可读 A 会话终端）→ 按派发规则立即中止 TERM 套件

## 证据附件

- `terminal-guard-report.json`
- `cmd.log`

## 执行命令

```
$ node scripts/verify-terminal-guard.mjs --base http://127.0.0.1:3118 --accounts-file <0600> --data-root <E1 数据根> --container rc5-e1suite --json <case>/terminal-guard-report.json  # EXIT=1
```
