# RC5-ENV-007 — pnpm -w run verify（全仓）

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:96`（优先级 P1 / 方式 A）
- 执行时间：2026-11-19T22:04:52Z → 2026-11-19T22:05:38Z
- 命令与退出码：见 `cmd.log`
- 判定：**PASS**

## 预期

全包绿；含 prompt-studio registry/ledger 锚点测试；记录包数。

## 实际

`pnpm -w run verify` EXIT 0。`pnpm` 选面 `Scope: 39 of 40 workspace projects`；日志中 38 个不同 `verify` 任务前缀（core/contracts、core/cordis、core/runtime、32 个 packages/*、3 个 tools/*）。prompt-studio：16 个测试文件 / 349 tests 全绿，含 `tests/registry.test.ts` 23 tests（`ledger ↔ 注册表` 双向互锁，registry.test.ts:227-264）。UI 令牌 lint 先行通过。

## 断言

- [x] 全仓 verify EXIT 0
- [x] prompt-studio registry/ledger 锚点测试绿
- [x] 记录包数：38 个 verify 前缀

## 备注

- 包数按日志实际 `verify` 前缀统计；`pnpm` 的 39/40 为递归选面（根包不参与 `-r`）。

## 证据

- `cmd.log`
