# RC5-ACC-004 · mux 动作漂移测试（上游差集=0，含 terminal 9）

- 套件：ACC
- 结论：**PASS**
- 开始/结束：2026-11-20T01:36:10.498Z / 2026-11-20T01:36:11.690Z

## 预期

`mux-drift` + `mux-peer-drift` 全绿

## 实际

2 test files passed

## 证据附件

- `cmd.log`

## 执行命令

```
$ pnpm --filter @eterna/access exec vitest run tests/mux-drift.spec.ts tests/mux-peer-drift.spec.ts  # EXIT=0
```
