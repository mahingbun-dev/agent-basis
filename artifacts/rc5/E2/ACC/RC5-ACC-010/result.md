# RC5-ACC-010 · 全局事件 allowlist 单测

- 套件：ACC
- 结论：**PASS**
- 开始/结束：2026-11-19T23:52:00.352Z / 2026-11-19T23:52:01.288Z

## 预期

五个失效信号仍授 global；无回归

## 实际

2 test files passed

## 备注

- mux-drift 断言 GLOBAL_EVENT_ACTIONS 五项均在上游转发清单且不带 resources（packages/access/tests/mux-drift.spec.ts:294-318）

## 证据附件

- `cmd.log`

## 执行命令

```
$ pnpm --filter @eterna/access exec vitest run tests/mux-policy.spec.ts tests/mux-drift.spec.ts  # EXIT=0
```
