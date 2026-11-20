# RC5-API-004 — tasks 包 verify（API-004）——替代覆盖：test/typecheck/oxlint

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P0
- 结论：**NOTRUN**
- 时间：2026-11-20T01:45:08.322Z → 2026-11-20T01:45:14.801Z

## 预期（51/54 原文口径）

51 原文为 `pnpm --filter @eterna/tasks verify` 退出码 0

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | tasks vitest 全绿 | exit=0 files=53 tests=864 |
| PASS | tasks typecheck 绿 | exit=0 |
| PASS | tasks oxlint 0/0 | Found 0 warnings and 0 errors. |

## 命令原文（完整见 cmd.log）

- `pnpm --filter @eterna/tasks test` → exit=0（vitest run（只读测试，不写 lib/））
- `pnpm --filter @eterna/tasks typecheck` → exit=0（tsc --noEmit）
- `pnpm exec oxlint --config ./.oxlintrc.json packages/tasks/src packages/tasks/tests` → exit=0（oxlint）

## 备注

- 51 的 API-004 命名命令 `pnpm --filter @eterna/tasks verify` 含 build:client（写 packages/tasks/lib/client.js）；本 lane 可改文件仅限 artifacts/rc5/e3-super/**，故未跑复合 verify，改跑 test/typecheck/oxlint 三段并如实标注。

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
