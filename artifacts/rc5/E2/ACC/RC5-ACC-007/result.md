# RC5-ACC-007 · B 用 A 的 sessionId 打 unary 必须 403/deny

- 套件：ACC
- 结论：**PASS**
- 开始/结束：2026-11-20T07:05:48.273Z / 2026-11-20T07:05:48.324Z

## 预期

state/projections/rename/search/events 全部 tenant/denied；session/title 非 RPC（404）；审计有记录

## 实际

拒绝=5/6；不存在=session/title；未拒=无；审计命中=true

## 备注

- session/title 不在 tenant.ts sessionValidated 清单（packages/access/src/tenant.ts:387-392）；实测 404（事件名而非 RPC），不构成可达面

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/session/state（B → A 的 sessionId）  # EXIT=200
$ POST /api/session/projections（B → A 的 sessionId）  # EXIT=200
$ POST /api/session/rename（B → A 的 sessionId）  # EXIT=200
$ POST /api/session/search（B → A 的 sessionId）  # EXIT=200
$ POST /api/session/title（B → A 的 sessionId）  # EXIT=404
$ POST /api/session/events（B → A 的 sessionId）  # EXIT=200
```
