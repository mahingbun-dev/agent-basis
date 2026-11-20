# RC5-API-007 — drainDescendants 后无残留 running

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:127`（P1 / S / E3）
- 执行时间：2026-11-19T22:54:16.931Z → 2026-11-19T22:54:27.459Z（与 API-005 同一次真实宿主运行）
- 环境：3108 测试容器 `eterna-rc5-e1`；`dsh 0.2.2-rc.5`；隔离 `DSH_HOME=/tmp/api-run-home`
- 命令与退出码：见 `cmd.log`（`DOCKER_EXEC_EXIT=0` / `HARNESS_EXIT=0`）
- 判定：**PASS**

> 后续（2026-11-20 晚）：E3 真模型档（`mimo/mimo-v2.6-pro`）已补跑 PASS，`drainDescendants` 后 `residentAfter=[]`；权威证据见 `artifacts/rc5/e3-super/API-005-real-model.md`。

## 预期

排空后代；`drainDescendants` 后无残留 running。

## 实际

1. 真实 worker B `worker-36ed884efff9cfc179578853b538df70` 上派生长驻子代理
   `d50af1bc-bfc3-44e1-a3b3-4453cffc0aef`（api-drain-child，prompt 为 `sleep 120`，模型层 stub 延迟 60s）。派生后 `agents.get(childB)` 存在，`status=running`。
2. 调用真实 `subagents.drainDescendants([workerB])`，**9 ms** 返回。
3. drain 后：
   - `listDescendants(workerB.id)` 仍返回该 child 的 catalog 行（见备注），但 `agents.get(childB)` 已 `undefined`，即 `resident=false`；
   - `residentAfter=[]`（无任何驻留 Agent）；
   - `waitForTreeWork(workerB)` 返回 `false`（已无在跑后代）；
   - worker B `status=idle`；
   - `subagent/end`：`stopReason=aborted`（drain 主动中止长驻子代理）。
4. 结果 `ok=true`，`errors=[]`。

## 断言

- [x] drain 前 child 真实驻留且 running
- [x] `drainDescendants([workerB])` 正常返回（9 ms，无超时/异常）
- [x] drain 后 `agents.get(child)` 为 undefined，`residentAfter=[]`
- [x] drain 后 `waitForTreeWork(workerB)=false`
- [x] drain 后 worker B idle；`subagent/end stopReason=aborted`

## 备注

- `listDescendants` 是持久 catalog 视图，drain 只释放 Agent、不删除历史 catalog 行，因此 drain 后仍能看到该 child 的 id（`resident=false`）。这不等于“残留 running”；判断驻留必须叠加 `agents.get(id)` 过滤。已在 leftover `API007-CATALOG`（P3）记录，供调用方文档化。
- 模型层为确定性 stub 的局限同 API-005（P0 leftover `API005-REALMODEL`）；本用例断言的是 drain 生命周期与驻留状态，不依赖模型输出。

## 证据

- `cmd.log` — 命令原文与 EXIT
- `drain.json` — `checks.drainDescendants` + `drain` + drain 前驻留 + 最终状态
- `worker-b-session-extract.jsonl` — worker B 持久史切片（assignment + drain child catalog）
- `../_harness/results/api005-007-results.json` — 完整结果
- `../_harness/results/api005-007-harness.log` — 运行日志（token 已脱敏）
- `../_harness/results/hash-compare.log` — 宿主/容器源码哈希