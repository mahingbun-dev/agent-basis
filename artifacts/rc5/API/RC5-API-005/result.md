# RC5-API-005 — 主会话派 2 worker（真回执）

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:125`（P0 / S / E3）
- 执行时间：2026-11-19T22:54:16.931Z → 2026-11-19T22:54:27.459Z
- 环境：3108 测试容器 `eterna-rc5-e1`（healthy）；`dsh 0.2.2-rc.5`；上游 `@deepseek-ai/cordis 4.1.0`；隔离 `DSH_HOME=/tmp/api-run-home`；`realm=ApiHarness`
- 命令与退出码：见 `cmd.log`（`DOCKER_EXEC_EXIT=0` / `HARNESS_EXIT=0`）
- 判定：**PASS（API 语义）**（真实 tasks worker + 真实 SubagentManager）

> 后续（2026-11-20 晚，用户授权「用已配置的模型验证」）：E3 真模型档（`mimo/mimo-v2.6-pro`）已补跑 PASS —— 2 工单 / 2 真实 worker / 2 child / `waitForTreeWork` 41883ms / 2 条 completed 回执；权威证据见 `artifacts/rc5/e3-super/API-005-real-model.md`、`artifacts/rc5/e3-super/real-harness/`。本文件保留为确定性 stub 档记录。

## 预期

主会话派 2 个 worker；`waitForTreeWork` 等到全部完成；无丢回执。

## 实际

1. harness 以主会话 `orchestrator-ApiHarness` 的 sessionId，调用真实 webchat source 的
   `normalizeWebchatTrigger` 构造两条 webchat Trigger（两个 thread id），再以 `explicit accept`
   走真实 `Engine.decide` → 真实 `DshExecutor`，形成两张工单。派发决策由 harness 注入，
   不是主会话 LLM 产出（容器无模型凭据）；工单/worker/子代理/回执本身是真实 rc.5 路径。两条工单：
   - A `709dea15795ec8518199c38e37d54e74` → `worker-709dea15795ec8518199c38e37d54e74`
   - B `36ed884efff9cfc179578853b538df70` → `worker-36ed884efff9cfc179578853b538df70`
   两个 worker 由真实 `DshExecutor` 创建，创建后 `status=running`；worker A 持久史 `seq=9` 有 `user/message`（`source.kind=eterna-tasks`）注入的 assignment（见 `worker-a-session-extract.jsonl`）。
2. 在真实 worker A 的 Agent 上，通过上游 `@deepseek-ai/dsh-subagent` 的 in-process provider `spawn` 派生两个子代理：
   `7cb4fa40-67fa-4ee2-acc0-ef85bb51bc31`（api-child-1）、`1ad10993-392d-457d-adab-cf8c3b2d5a63`（api-child-2）。
3. `waitForTreeWork(workerA)`：harness 调用返回 `true`，等待 **8048 ms**；最后一个子代理 `subagent/end` 于 22:54:25.425Z（`completed`），wait 于 22:54:25.432Z 返回（相差 7 ms）。
4. tasks executor **自己**也调用了 `waitForTreeWork` 并等到同一棵树：stack 为
   `childrenEnd (background.ts:58) → untilQuiet (background.ts:108) → DshExecutor.workerIdle (dsh.ts:714)`，
   返回 `true`，等待 **6160 ms**，返回时刻同为 22:54:25.432Z。证明是迁移后的真实 executor 代码在等树，不是 harness 代调。
5. 回读 worker A 持久史：**2 条** `user/message`，`source.kind=subagent-settled`；`stopReason` 均为 `completed`；`sender` 恰为上述两个子代理，无丢失、无重复（见 `worker-a-receipts.txt`）。
6. 收尾后 worker A/B 均 `idle`，两个子代理均 `absent`；结果为 `ok=true`，`errors=[]`。

## 断言

- [x] 2 张工单 → 2 个真实 worker session（真实 `sessionController`/`agents`/`DshExecutor`，不是 fixture manager）
- [x] `waitForTreeWork` 等到两个子代理全部结束（8048 ms；最后 end → 返回 7 ms）
- [x] tasks executor 真实进入 `waitForTreeWork`（调用栈落在 `background.ts:58` / `dsh.ts:714`）
- [x] 回执 2/2，`completed`，sender 与两个子代理逐一对应，无丢回执
- [x] 清理后 worker A/B `idle`，子代理 `absent`

## 局限

- **模型层是确定性 stub**：3108 容器 `DEEPSEEK_API_KEY` 长度为 0；`MIMO_API_KEY` 为 31 字符占位，实测 `HTTP 401 Invalid API Key`（`../_harness/results/credential-probe.log`）。因此 harness 在 `llm` 上注册 `stub` adapter，替代模型文本生成；tasks worker / session / SubagentManager / 持久化 / 回执投递均为真实 rc.5 路径。真模型 worker 回合未跑，记为 P0 leftover `API005-REALMODEL`：API 语义已用真实 worker 验证，但按 T49e 的真实模型 E2E 口径仍未收口。
- 用例文档标 E3 super；本次按 lane 指令在 **3108（e1，`ETERNA_FORM=web`）** 执行。`e3`（3109，`ETERNA_FORM=super`）未跑，记为 leftover `API005-ENV`（P2）。tasks/subagent 源码在宿主与容器 `/repo` 的 SHA-256 完全一致（`../_harness/results/hash-compare.log`；容器角色见 `../_harness/results/container-roles.log`）。
- 两条并发工单使用两个 thread id（`webchat:orchestrator-ApiHarness::api-batch-1/2`）注入；同一主会话线程的第二条消息会按产品语义成为既有工单 follow-up。这是注入方式，不影响本用例对 worker/回执的断言。

## 证据

- `cmd.log` — 命令原文与 EXIT
- `receipts.json` — 本用例断言切片（工单/worker/wait/回执/executor 栈/最终状态）
- `worker-a-session-extract.jsonl` — worker A 持久史脱敏切片（assignment、catalog、两条 settled 回执）
- `worker-a-receipts.txt` — 两条回执正文（脱敏）
- `../_harness/results/api005-007-results.json` — 完整结果
- `../_harness/results/api005-007-harness.log` / `api005-007-boot.log` — 运行日志（token 已脱敏）
- `../_harness/results/hash-compare.log` — 宿主/容器源码哈希
- `../_harness/results/harness-hash.log` — 复现脚本/harness 与容器副本哈希
- `../_harness/results/container-roles.log` — e1 `ETERNA_FORM=web` / e3 `ETERNA_FORM=super`
- `../_harness/results/credential-probe.log` — 凭据可用性（无凭据值）