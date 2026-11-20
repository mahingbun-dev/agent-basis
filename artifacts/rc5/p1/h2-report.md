# T06 H2 subagent API 迁移 + worker 真回执集成测试

- 工位：`/Users/sunny/code/agent-basis-rc5`（分支 `feat/dsh-rc5-merge`，未 commit / 未 push）
- 依据：54 号 §4.3 R01（`packages/tasks/src/executor/background.ts` 旧 API，P0）· 54 号 T06 · 50 号 WP1-4 · 51 号 RC5-API-005..007
- 生成时间：2026-11-19T17:51Z

## 起点状态（如实记录）

会话开始时工作树里 `background.ts` / `background.spec.ts` / `tests/fixtures/host.ts` 已有**未提交**的三处改名（以及一份 01:28 的 `h2-tasks-verify.log`）。本次：
1. 对照 rc.5 实际类型逐一核验签名与语义；
2. 修正 `stopSubagents` 的过时注释（rc.5 drain 回执是 inject 不唤醒、且关树准入）；
3. 把 fixture 的 subagent 面补成 rc.5 形状（整树 join / 终态回执 / drain 注入 aborted）；
4. 新增 worker 真回执集成测试，断言完成 / 失败 / 取消三条路径；
5. 全量 tasks verify + 回退牙齿检查（temporarily revert = 3/3 失败）。

## 改动

| 文件 | 改动 |
|---|---|
| `packages/tasks/src/executor/background.ts` | `waitForChildren→waitForTreeWork`、`listChildren→listDescendants`、`drainChildren→drainDescendants`（含签名 `SessionId`/`readonly Agent[]`）；`stopSubagents` 注释改为 rc.5 teardown 语义 |
| `packages/tasks/tests/subagent-receipt.spec.ts` | **新增**：完成/失败/取消三路径 worker 真回执集成（模拟宿主 fixture 驱动真实的 `untilQuiet`/`stopSubagents` 调用路径） |
| `packages/tasks/tests/fixtures/host.ts` | subagent fixture：`waitForTreeWork` join 整棵树；`settle(id, stopReason, wake)` 产出 rc.5 `subagent-settled` 形状回执；`drainDescendants` 关准入并注入 `aborted` |
| `packages/tasks/tests/background.spec.ts` | 起点已改名的 stub（沿用，未再改）：新 API 名断言 |

## 命令与 EXIT

| 命令 | EXIT | 结果 |
|---|---|---|
| `pnpm --filter @eterna/tasks verify`（基线，改动前） | 0 | 52 文件 / 860 测试通过 |
| `pnpm --filter @eterna/tasks exec tsc --noEmit` | 0 | 无类型错误 |
| `pnpm --filter @eterna/tasks exec oxlint --config ../../.oxlintrc.json .` | 0 | 0 warnings / 0 errors（121 文件） |
| `pnpm --filter @eterna/tasks exec vitest run` | 0 | 53 文件 / 863 测试通过 |
| `pnpm --filter @eterna/tasks exec vitest run tests/subagent-receipt.spec.ts --reporter=verbose` | 0 | 3/3 通过（完成/失败/取消） |
| `pnpm --filter @eterna/tasks verify`（最终） | 0 | 53 文件 / 863 测试通过；build-client + oxlint + tsc + vitest 全链 |
| 牙齿检查：`sed` 把 background.ts 改回旧 API 名后跑 receipt spec | 1（预期） | 3/3 失败 `TypeError: subagents.listChildren is not a function`；已恢复检查前备份（sha1 `dc9320ae...`；之后仅再改一处注释） |
| `grep -rn "waitForChildren\|listChildren\|drainChildren" packages tools core scripts` | 1（无匹配） | 全仓源码无旧 API 名 |

## 断言结果（`h2-receipt-tests.log`）

1. **完成路径**：两个直接子 + 一个孙代。`untilQuiet` 在只结束第一个、以及在第二个结束后孙代仍跑时都**不结束**（整树 join）；最后一个结束后返回 `false`（回执唤醒 worker）。回执经 session 历史确认 **2 条 `completed`**，`senderSessionId` 分别对应两个直接子，文本含 `finished and will do no further work`。worker idle 后再次 `untilQuiet` 为 `true`（无回执丢失/无残留）。
2. **失败路径**：`stopReason: 'error'` 回执到达 worker，文本含 `failed before it finished`；结束后无活 child。
3. **取消路径**：`listDescendants` 返回 `[child, nested]`（树一致）；`stopSubagents` 调 `drainDescendants` 后两后代均非 live、`agents.get` 为空、`waitForTreeWork=false`（无残留 running）；teardown 回执经 `inject` 到达 worker 且 `stopReason: 'aborted'`；worker 回合被 `cancel({kind:'user'},{keepInbox:false})` 且回到 idle。

## 遗留

| id | 现象 | 级别 | 建议 |
|---|---|---|---|
| H2-L1 | rc.5 `drainDescendants` 会 `closingRoots.add(root)`，直到根 agent `agent/disposed` 才删除；tasks 的 worker session 复用（停止/交接后再开回合）时再派 subagent 会被 `DRAINING` 拒绝 | P2 | 与上游/产品确认树级 teardown 是否终态；若无 reopen API，考虑每次 assignment 重建 root agent，或在 54/51 立案该语义 |
| H2-L2 | `stopSubagents` 仍以 `ctx.agents.get(id)` 过滤活后代；external（无本地 Agent）激活不在其中，可能被漏停 | P3 | 启用 out-of-process subagent provider 时改为按 `listDescendants` 行判定或直接 drain；当前 profile 仅 in-process |
| H2-L3 | 本次 E2E 跑在 rc.5 形状的 fixture manager 上，未驱动真 `SubagentManager`；54 号 R04 的「真宿主」API-005..007 仍未跑 | P2 | T09/T49e 在真宿主（in-process provider）跑双 worker 冒烟并归档 |
| H2-L4 | 54 号 T06/R01 文档仍标 ⬜/open 且声称 background.ts 用旧 API；本次未改 docs（不在可改文件） | P3 | 文档 lane 更新状态与证据指针 |

## 证据

- `artifacts/rc5/p1/h2-tasks-verify.log`：最终 `verify` 全量输出 + EXIT=0
- `artifacts/rc5/p1/h2-tasks-verify-baseline.log`：改动前基线 + EXIT=0
- `artifacts/rc5/p1/h2-receipt-tests.log`：三路径 receipt spec verbose 输出 + EXIT=0
- `artifacts/rc5/p1/h2-revert-teeth.log`：回退旧 API 后的预期失败 + EXIT=1
- `artifacts/rc5/p1/h2-api-contract.log`：rc.5 d.ts 签名/行号、旧名全仓 grep、background.ts 新名 grep