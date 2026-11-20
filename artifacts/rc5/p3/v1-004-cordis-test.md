# RC5-V1-004 — `pnpm --filter @core/cordis test` 绿

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:281`（RC5-V1-004，P0）
- 任务：T19（54 §4.5「cordis tests 5/5」）
- 判定：**PASS**（本 session 实跑）

## 命令原文

```bash
cd /Users/sunny/code/agent-basis-rc5
pnpm --filter @core/cordis test
```

## 结果

```text
 RUN  v4.1.12 /Users/sunny/code/agent-basis-rc5/core/cordis

 ✓ tests/smoke.spec.ts (5 tests) 5ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Duration  158ms
```

`EXIT=0`。日志：`artifacts/rc5/p3/v1-cordis-test.log`

## CI 顺序复跑（declarations 之后）

CI `v1-line` 先产声明再跑 test（`.github/workflows/ci.yml:175-183`）。按同序复跑：

```bash
pnpm --filter @core/cordis declarations     # EXIT=0
pnpm --filter @core/cordis test             # EXIT=0 → 5 passed (5)
```

日志：`artifacts/rc5/p3/v1-cordis-test-after-decl.log`（`Tests 5 passed (5)`）

## 断言

- [x] `pnpm --filter @core/cordis test` EXIT=0
- [x] 5 tests / 1 file 全通过（与 T19 定义的「cordis tests 5/5」一致）
- [x] 在 CI 同序（declarations → test）下同样 5/5