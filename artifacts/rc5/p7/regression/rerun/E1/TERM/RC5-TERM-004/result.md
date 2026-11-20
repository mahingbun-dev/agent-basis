# RC5-TERM-004 · B 用 A 的 sessionId 调 terminal 6 个 unary 动作必须 403/deny

- 套件：TERM
- 结论：**PASS**
- 开始/结束：2026-11-20T01:42:00.728Z / 2026-11-20T01:42:00.729Z

## 预期

list/environment/shells/create/close/rename 全部 403/deny，无数据泄漏

## 实际

6 个 unary 全部 denied（denied code=remote-access/denied | denied code=remote-access/denied | denied code=remote-access/denied | denied code=remote-access/denied | denied code=remote-access/denied | denied code=remote-access/denied）

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
