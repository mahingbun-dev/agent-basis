# T22 · B3 compaction 语义对照（rc.5 → Eterna fork）

> Lane：L3 · WP3-2 · 54 号 §4.5 T22；47 号 B3；50 号 WP3-2。
> 日期：2026-11-20。分支 `feat/dsh-rc5-merge`。只改 `packages/compaction/**`。
> 上游只读源：`/Users/sunny/code/deepseek-harness` tag `dsh-v0.2.2-rc.5`
>（commit `9c2670d3bce5275e0d1610272958121af87787bb`），未修改该仓库。

## 0. 结论（先给结果）

| 语义面 | 结论 | 证据 |
|---|---|---|
| seq/surface 断言（meter↔surface 对齐、选区校验、bracket 状态） | **与 rc.5 一致**（`region.ts` 逐字，仅 fork 增量 C11 附件/C3 结构校验） | `05-diff-region.txt`；测试 `rc5-semantics.spec.ts:151/216` |
| 摘要失败走 `LlmError.fromFailure` | **已一致**（P1 `02f4857` 落；`finishError` 的 error/aborted 分支同 rc.5） | `06-diff-summarizer.txt`；测试 `:284/301` |
| fork/压缩行为（残留 bracket、陈旧判定、busy） | **与 rc.5 一致**（`inspectCompactionEntryState` + `latestEndSeedSeq` 判定逐字） | `05-diff-region.txt`；测试 `:316/329/339/354` |
| tool-result-pruner 行为 | **与 rc.5 源码逐字一致**（仅 module 头注释不同） | `07-diff-config-types-pruner-command.txt`；测试 `:395/411/436` |
| 批量 append 发布语义（`currentBatchPublication`） | **compaction 断言在 rc.5 批量会话上通过**；发布期监听器看到整批终态 | 测试 `:151/216`；`10-upstream-session-semantics.txt` |
| `/compact` 命令 | handler 与 rc.5 一致；仅 `definitionId` 改为本包入口 | `07-diff-config-types-pruner-command.txt` |

## 1. 对照方法

```sh
# 上游 rc.5 源抽取（只读）
git -C /Users/sunny/code/deepseek-harness show dsh-v0.2.2-rc.5:<path> > /tmp/rc5-src/<path>
# 逐文件 diff（差异见 05–08 号证据）
diff -u /tmp/rc5-src/packages/compaction/compaction-basic/src/region.ts \
        packages/compaction/src/basic/region.ts
diff -u /tmp/rc5-src/packages/compaction/compaction-basic/src/summarizer.ts \
        packages/compaction/src/basic/summarizer.ts
```

diff 的退出码 1 表示有差异（预期）；差异内容全部是**本地 fork 增量或改名**，没有上游语义被删/被改写：

- `region.ts`（`05-diff-region.txt`）：仅新增 C11 附件槽与 C3 结构校验插入点；
  `selectCompactableRange`、`validateSurfaceRegion`、`assertCompactionInactive`、
  `inspectCompactionEntryState`、`assertWholeSurfaceUnchanged`/`assertSelectedSpanStable`
  全部逐字相同。
- `summarizer.ts`（`06-diff-summarizer.txt`）：错误映射逐字相同
  （上游 `summarizer.ts:197-201` ↔ 本地 `src/basic/summarizer.ts:203-207`）；
  本地增量是 C2 提示词规则、C3 `parseSummarySections/validateSummaryStructure/InvalidSummaryError`、
  CHECKPOINT_PREAMBLE 时间线尾注。
- `config.ts`/`types.ts`/`pruner/*`/`command-plugin.ts`
  （`07-diff-config-types-pruner-command.txt`）：pruner 源码逐字一致（含
  `PRUNE_MARKER`、头尾码点裁剪、shadow-price 协议）；config/types 仅多
  `attachments` 键；command 仅 `definitionId` 改名。
- `basic/index.ts`（`08-diff-basic-index.txt`）：rc.5 的五个常驻监听器
  （pre-step/status/request/request-error/session/event）逐字保留；本地增量是
  C7 rapid-refill 熔断、overrides/state 文件桥、`auto` 热切换门控。`compactNow`
  的 admission/`runMaintenance` 结构与 rc.5 相同（`src/basic/index.ts:618-670`）。

## 2. seq/surface 断言复验（47 号 B3 第 4 条）

rc.5 session 的数组 append 改为**整批提交后逐成员发布**
（`dsh-session` d.ts:51-59：`session.seq`/`session.surface` 已含完整批，
`currentBatchPublication` 标识当前成员；摘录见 `10-upstream-session-semantics.txt`）。

本地 compaction 自身仍逐事件 append（`compaction/start` → `compaction/summary` →
`user/message` replace → `compaction/end`），不依赖批量 append；但它的
**断言面**必须在 rc.5 会话上成立：

- `selectCompactableRange` 先断言 token-meter 的 `nodes[].seq` 与
  `session.surface.nodes` 逐位相等，不等即抛
  `compaction: token-meter surface does not match the current session surface`
  （`packages/compaction/src/basic/region.ts:128-142`，与上游 rc.5 `region.ts:117-129` 逐字一致）。
- 新增回归 `rc5-semantics.spec.ts:151`：用真实 `SessionStore` + rc.5 批量 append
  构建 surface；断言发布期每个成员看到 `session.seq` 已到批尾、`surface.nodes`
  已含整批、`currentBatchPublication.seq === event.seq`；随后 fake meter 与
  `selectCompactableRange` 正常给出区间，且错位 meter 快照仍被同一文案拒绝。
- 新增回归 `rc5-semantics.spec.ts:216`：同一批内 `compaction/prune` +
  `tool/result` replace（shadow-price 协议）；断言两个成员发布时
  `surface.replaceGeneration === 1`、`surface.nodes` 已替换——即发布期读到的
  surface 是整批终态，符合 rc.5 语义。

## 3. 摘要失败 `LlmError.fromFailure`

- 本地 `finishError`（`src/basic/summarizer.ts:203-217`）对 `kind: 'error'` 与
  `kind: 'aborted'` 均 `return LlmError.fromFailure(finish.failure)`（:207）；
  `max-tokens` 仍为 `code=MAX_TOKENS` 的普通 Error。
- 上游 rc.5 同函数逐字一致（`compaction-basic/src/summarizer.ts:197-201`）。
- 新增回归 `rc5-semantics.spec.ts:284`：`error` finish 携带
  `message/code(RATE_LIMIT)/status(429)/providerRetryAfterMs(1500)/requestId`；
  断言抛出 `LlmError` 且 `.failure` 逐字段保留。
- 新增回归 `rc5-semantics.spec.ts:301`：`aborted` finish 同一路径，code `ABORTED`
  不再退化成普通 Error。
- 既有 `basic-prompt.spec.ts` 的 `MAX_TOKENS` fail-closed 用例继续绿。

## 4. fork / 压缩行为（上游 `manual-compaction.spec.ts` 对照）

判定逻辑：`inspectCompactionEntryState` 从日志尾向前找最近的
`compaction/start|end`、`turn/start|end` 与 `session/end-seed`；
`assertCompactionInactive` 只有在“未配对 start 之后存在更新的 end-seed”时
才判其陈旧（`src/basic/region.ts:319-333`、`:607-641`，与 rc.5 逐字一致）。

新增 4 条回归（`rc5-semantics.spec.ts`）：

| 用例 | 行 | 断言 |
|---|---|---|
| 活 bracket | :316 | `compactNow` 拒绝 `ManualCompactionError code=busy`，文案含 `compaction lock is already active`，摘要 0 次 |
| 开 turn | :329 | busy，文案含 `already has an open turn`，摘要 0 次 |
| reload 孤儿 bracket | :339 | `Session.create(id, snapshotEvents())` 构造器补 `session/end-seed` 后，孤儿 bracket 陈旧 → 压缩成功 1 次 |
| fork 种子切开活 bracket | :354 | `buildForkSeed` 只补 `turn/end {kind:'forked'}`、不合成 `compaction/end`；子会话压缩成功 1 次 |

（第 3/4 条与上游 `compaction-basic/tests/manual-compaction.spec.ts` 的
“ignores an unmatched bracket inherited before a later end-seed marker” /
“ignores an unmatched bracket a mid-turn fork seed cut open” 同义。）

## 5. tool-result-pruner 行为对照（B3 第 3 条：只做行为对照，不引包）

源码 diff：`pruner/index.ts` 与 rc.5 `compaction-tool-result-pruner/src/index.ts`
逐字一致（仅 `@module` 注释不同）；config/types 逐字一致。

新增 3 条行为回归（`rc5-semantics.spec.ts`，与上游
`tool-result-pruner.spec.ts:123-269` 同口径）：

- :395 head/tail 按 Unicode 码点裁剪，代理对不劈开，`😀` 不出现 `\uFFFD`；
- :411 非文本块（reasoning/tool-call）原序保留，移除区间两侧文本按预算保留；
- :436 会话事务：`compaction/prune` 紧邻替换、完整 data（含 error）保留、
  `sourceEventSeqs` 引用被替换 seq、surface 不再含原节点、二次 prune 收敛为空。

## 6. 有意保留的 fork 增量（不是回归）

| 增量 | 位置 | 与 rc.5 的关系 |
|---|---|---|
| C2 提示词规则（命令逐字/用户原语言/防冒充/安全约束） | `summarizer.ts:63-70` | 上游无此规则；只影响摘要质量，不改事务/seq 语义 |
| C3 结构校验（8 段 + 关键两段非空） | `summarizer.ts:229-357` | 上游 rc.5 不做结构校验；本地空壳摘要进 recover/失败链（fail-closed） |
| C7 rapid-refill 熔断 | `basic/index.ts:165-314` | 本地增量；只 gate 自动 pre-step 路径 |
| C11 checkpoint 附件 | `basic/attachments.ts`、`region.ts` 附件槽 | 本地增量；默认 false，关闭时行为与 rc.5 相同 |
| overrides/state 文件桥（设置分区） | `basic/index.ts:191-268` | 本地增量；不改变压缩事务 |
| `/compact` definitionId | `command-plugin.ts:103` | 身份改名，handler 逐字同 rc.5 |

## 7. 验证命令与实测结果

| 命令 | 结果 |
|---|---|
| `pnpm --filter @eterna/compaction test`（改前基线） | EXIT=0；16 文件 / 221 测试通过（`01-baseline-test.log`） |
| `pnpm --filter @eterna/compaction verify`（build:client + oxlint + tsc + vitest） | EXIT=0；17 文件 / **232** 测试通过（`02-verify.log`） |
| `./node_modules/.bin/vitest run tests/rc5-semantics.spec.ts --reporter=verbose` | EXIT=0；11/11 通过（`09-rc5-semantics-test.log`） |
| `node tools/evals/bin/dsh-evals.mjs run --pack packs/event-planning --adapter replay --out artifacts/rc5/p3/compaction-semantics/dsh-evals-out` | EXIT=0；**30/30** 通过（`03-dsh-evals-replay.log`，report 见 `dsh-evals-out/report.md`） |
| `node tools/evals/bin/dsh-evals.mjs run --pack packs/industrial-analysis --adapter replay --out artifacts/rc5/p3/compaction-semantics/dsh-evals-out-industrial` | EXIT=0；**18/18** 通过（`04-dsh-evals-replay-industrial.log`） |

说明：`pnpm --filter @eterna/compaction verify` 的 vitest 段即 compaction 全部单测
（含 `evals-golden.spec.ts`/`evals-compare.spec.ts`/`evals-judge.spec.ts` 三文件
27+14+9=50 条评估相关用例）；`dsh-evals replay` 为仓级对话/工具/任务回放基线，
两包合计 48/48。真实 LLM 层 golden（`run-golden.mjs`）需网关凭据与网络，**本轮
未跑**（不在 T22 完成定义内；确定性评估层已由 verify 覆盖）。

## 8. 改动文件

- `packages/compaction/tests/rc5-semantics.spec.ts`（新增，11 条用例）。
- 无生产代码改动（`src/**` 未动；P1 的 `LlmError.fromFailure` 已在此前提交 `02f4857`）。

## 9. 遗留项

| id | 现象 | 级别 | 建议 |
|---|---|---|---|
| T22-L1 | 上游 rc.5 `compaction-image-offload`（图像卸载 + `image/offload` 投影）在本 fork 无对应实现/没有挂载行；B3 按设计“不直接引包、只做行为对照”，但本轮无法做它的行为对照（包内不存在该能力） | 中 | 若产品需要图像输入长会话卸载，另立任务移植 image-offload（含 projection 注册与 profile 行）；否则在 47/50 文档标注“不采用” |
| T22-L2 | 本地 C3 结构校验比 rc.5 更严（空壳摘要在 rc.5 会被接受、在本 fork 被拒），属于有意 fail-closed 分歧 | 低 | 保持现状；已在本报告 §6 记录，避免后续上游同步时误判为回归 |
| T22-L3 | 真实 LLM 层 golden（`run-golden.mjs`/`run-compare.mjs`）未跑 | 低 | 有网关凭据的窗口按 22 号 §3-C4 复跑，与 `evals/reports/` 最新基线对照 |