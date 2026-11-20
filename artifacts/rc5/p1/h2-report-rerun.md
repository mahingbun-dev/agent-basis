# T06 H2 subagent API 迁移 —— 复核与重跑报告（第二轮）

- 工位：`/Users/sunny/code/agent-basis-rc5`（分支 `feat/dsh-rc5-merge`；未 commit / 未 push）
- 依据：54 号 §4.3 R01、T06；50 号 WP1-4；51 号 RC5-API-005..007
- 生成时间：2026-11-19T18:17Z（UTC）
- 起点事实：会话开始时工作树已有未提交的 `background.ts` / `background.spec.ts` / `fixtures/host.ts` 改名与新增 `subagent-receipt.spec.ts`（上一轮同一工位的产物，见 `h2-report.md`）。本轮**逐一对照 rc.5 源码复核**这些改动，补一条失败传播单测，并重跑全部门禁。

## API 对照（实测，非推断）

| tasks 调用面（`background.ts`） | rc.5 服务面签名 | 实测出处 |
|---|---|---|
| `waitForTreeWork(root: Agent): Promise<boolean>`（第 24、58 行） | 同签名 | `dsh-subagent@0.2.2-rc.5/lib/types/index.d.ts:185`；实现 `src/index.ts:351`、`src/manager.ts:251` |
| `listDescendants(rootSessionId: SessionId, signal?): Promise<readonly {id}[]>`（第 25、162 行） | `Promise<SubagentDescendantListEntry[]>` | `lib/types/index.d.ts:241`；实现 `src/index.ts:427`、`src/list-children.ts:67` |
| `drainDescendants(parents: readonly Agent[]): Promise<void>`（第 26、164 行） | 同签名 | `lib/types/index.d.ts:224`；实现 `src/index.ts:404`、`src/manager.ts:289` |

旧名 `waitForChildren/listChildren/drainChildren` 在 `packages/tasks` 已无匹配（`h2-api-contract-rerun.log`）。

## 语义保持（逐条对照 rc.5 源码）

1. **整树 join**：`childrenEnd` 改为 `waitForTreeWork(agent)`（`background.ts:58`）。rc.5 对普通成员返回 false、对根 join 整棵树（`manager.ts:251-283`）。`untilQuiet` 的「join 一次、随后 free」缓存语义不变（`background.ts:55-63`）。
2. **释放范围**：`listDescendants(agent.id)` 后仍以 `ctx.agents.get` 过滤驻留后代（`background.ts:162`）；`drainDescendants([agent])` 以**树根数组**为参（`background.ts:164`）。drain 期间 rc.5 把结束回执 `inject` 给父（`manager.ts:1130-1132`，不唤醒），故 `stopSubagents` 的 finally 仍取消 worker 回合并等 `whenIdle`（`background.ts:165-169`）。
3. **失败传播**：drain 失败经 `until` 原样上抛，finally 先取消/等 idle，再由 `stopBackground` 聚合成 `AggregateError`（`background.ts:176-181`）。本轮新增单测钉住「teardown 失败仍取消 worker 且失败上抛」，并断言 `drainDescendants` 收到的是 `[agent]`。

## 命令与 EXIT（本轮实跑）

| 命令 | EXIT | 结果 |
|---|---|---|
| `pnpm --filter @eterna/tasks verify`（改动前，工作树现状） | 0 | `build:client` 145.3kb；oxlint 0 warnings/0 errors（121 文件）；tsc 无输出；53 文件 / **863** 测试过（`h2-tasks-verify-rerun.log`） |
| `pnpm --filter @eterna/tasks exec vitest run tests/subagent-receipt.spec.ts --reporter=verbose` | 0 | 3/3 通过：完成 / 失败 / 取消（`h2-receipt-tests-rerun.log`） |
| 回退牙齿：`sed` 把 `background.ts` 改回旧 API 名后跑 receipt spec | 1（预期） | 3/3 失败，`TypeError: subagents.waitForChildren/listChildren is not a function`；已按 sha256 原样恢复（`h2-revert-teeth-rerun.log`，前后 sha256 相同） |
| 恢复后重跑 receipt spec | 0 | 3/3 通过（同上日志） |
| **新增单测后** `pnpm --filter @eterna/tasks exec vitest run tests/background.spec.ts --reporter=verbose` | 0 | 9/9 通过（含新用例，`h2-background-spec-rerun.log`） |
| **最终** `pnpm --filter @eterna/tasks verify` | 0 | 全链同上；53 文件 / **864** 测试过（`h2-tasks-verify-final.log`） |

## 三路径断言（`tests/subagent-receipt.spec.ts`，fixture 驱动真实 `untilQuiet`/`stopSubagents`）

1. **完成**：2 直接子 + 1 孙代。只结束第一个、以及第二个结束后孙代仍跑时 `untilQuiet` 都**不**结束（整树 join）；最后一个结束后返回 `false`（回执唤醒 worker）。worker 回合起与下一步各领取一条，历史中 **2 条 `completed`** 回执，`senderSessionId` 对应两个直接子，文本含 `finished and will do no further work`；worker idle 后再查为 `true`（无丢回执）。fixture 文案与 rc.5 `settlementSummary` 原文一致（`continuation-messages.ts:106-129`）。
2. **失败**：`stopReason: 'error'` 回执进 worker 历史，文本含 `failed before it finished`，且该子代理不再 live。
3. **取消**：`listDescendants` 返回 `[child, nested]` 与树一致；`stopSubagents` 后两后代均非 live、`agents.get` 为空、`waitForTreeWork=false`（无残留）；teardown 回执经 `inject` 到达且为 `aborted`；worker 回合被 `cancel({kind:'user'},{keepInbox:false})` 并回 idle。

## 遗留

见 LaneReport；本文件同目录 `h2-*.log` 为原始证据。