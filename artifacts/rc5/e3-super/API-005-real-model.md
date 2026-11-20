# API-005/006/007 真模型补证（2026-11-20，用户授权）

> 用户指令：「API-005 可以使用已经配置的模型去验证」。
> 本文把 E3 真模型档、确定性 stub 档与 E3 app 级真模型走查三组证据合并，给出
> API-005/006/007 的判定与边界。**所有凭据只从容器 env 读入内存，未写入任何证据文件。**

## 0. 环境与前置

| 项 | 值 |
|---|---|
| 测试车道 | E3 super：compose `rc5-test-e3` / 容器 `eterna-rc5-e3` / 3109 |
| 镜像 | `eterna-agent:rc5-test` = `sha256:22fe8acb436f2ce24ea7a6b790b08462b9b769e10b98acb096590352b739bcfb` |
| 模型 | `mimo / mimo-v2.6-pro`（E3 已注入生产**已配置**的 MIMO/DEEPSEEK 凭据；只落 0600 `.env.e3`，日志只打长度/指纹） |
| realm | 模板 `eterna-tasks.config.realm=Mr.Ma`；E3 access 建 `Mr.Ma` 并对齐登录（口令只落 0600 `.test-accounts.json`） |
| harness DSH_HOME | `/tmp/api-real-home`（隔离；不读写容器 `/data`） |
| harness profile | `api-real`：`agent-default-model=mimo/mimo-v2.6-pro` + `llm-pi-ai` providers.mimo |

前置脚本：`artifacts/rc5/e3-super/api005-prep.mjs`（生产 inspect 只读 → 0600 env 注入 → 建 realm 账号 → 重建 E3 → healthy/指纹核对）。

## 1. 证据 A：真模型 2 工单 / 2 worker / 子代理树（51 API-005/006/007 主证据）

执行：`docker exec eterna-rc5-e3 sh /tmp/run-api005-real.sh`，`HARNESS_EXIT=0`，`results.ok=true`。
时间：`2026-11-20T08:46:37.088Z` → `08:48:17.524Z`。

| 判据 | 实测 | 结论 |
|---|---|---|
| 真模型装配 | worker session `request/header`：`provider=mimo model=mimo-v2.6-pro` | PASS |
| 2 张工单 | `1b90ba4c…`、`400260cb…`（真实 Engine `accept`） | PASS |
| 2 条真实 worker session | `worker-1b90ba4c…`、`worker-400260cb…`（DshExecutor + Sessions） | PASS |
| worker A 的 2 个真实 child | `d172fc6d-…`(api-child-1)、`f3ceb318-…`(api-child-2) | PASS |
| `waitForTreeWork(workerA)` | `returned=true`，`waitedMs=41883`；结束时两 child `absent` | PASS |
| 无丢回执 | 2/2 `subagent-settled`，`stopReason=completed`，sender 与两 child 一一对应，`unexpected=[]` | PASS |
| `listDescendants(workerA)` | 返回两 child，`extras=[]` | PASS |
| `drainDescendants(workerB)` | `residentAfter=[]`、`waitForTreeWorkAfter=false`、`workerStatusAfter=idle` | PASS |
| executor 亲自 join（≥3s，增补观察项） | `advisory.executorTreeJoin=false`（真模型首响应 ~110–150s，与 child 生命周期同量级，竞态） | 不影响 51 判据 |

证据：`artifacts/rc5/e3-super/real-harness/{results.json,harness.log,worker-a.jsonl,boot.log}`。

## 2. 证据 B：确定性 stub 档（补 executor join 时序断言）

同一 harness（`/tmp/api-run-home`，`API_HARNESS_REAL` 未置），模型为确定性 stub，其余
tasks/session/subagent/持久化为真实 rc.5 装配。结果 `ok=true`：

| 判据 | 实测 |
|---|---|
| executor 亲自调用 `waitForTreeWork(workerA)` | `fromExecutor=true`、`value=true`、`waitedMs≥3s`（`checks.executorTreeJoin.ok=true`） |
| 2 条回执 | 2/2 `completed`，sender 对得上 |
| `listDescendants` | 精确 2 个 child |
| `drainDescendants` | `residentAfter=[]` |

证据：`artifacts/rc5/API/_harness/results/api005-007-results.json`（既有）。

## 3. 证据 C：E3 app 级真模型走查（端到端链路）

在 E3 真实 Web/会话面，用 `Mr.Ma` 登录、`mimo/mimo-v2.6-pro` 真模型：

1. **主会话派 2 个 subagent**：首轮请求头工具清单含 subagent；模型一次派出 `worker`/`worker-2`，回执计数 2、4 均到达（无丢回执）。
2. **tasks 显式请求链路**：主会话用户消息 → webchat Trigger → 候选卡 → `orchestrator_route` accept → 工单 `f73624b9…` → 真实 `worker-f73624b9…` → 子代理树 → `worker_report`；tasks DB `trigger=4 / decision=3(accept explicitRouted) / ticket=1 / assignment running + report waiting`。
3. **产品线程语义**：同一主会话线程的第二条消息按设计成为既有工单的 follow-up（`disposition.fanout`），不新开第二张工单；这与 harness 用两个独立线程标识注入两条并发工单等价（会话归属/scope/gate 不变）。

## 4. 边界与遗留

1. **executor join 时序**：见 §1 表末行。51 的 API-005 判据是「waitForTreeWork 等到全部完成；无丢回执」，真模型档已独立满足；executor 亲自 join 的 ≥3s 观察项由 §2 确定性档补证。两档合并即完整证据。
2. **任务角色 prompt/preset 接线（R22，产品遗留，不影响本条判据）**：
   - 根因：super profile `docker/profile/package.json` 的 `bundles` 未含 `@eterna/tasks`，`packages/tasks/cordis.patch.yml` 的 orchestrator/worker preset 未进 preset registry；`SessionsHost.presets` 从未注入；`prompts.composePrompt` 只在测试中使用。
   - 现象：主会话按标准 preset 创建（带 persona/subagent 工具），系统 prompt 无 `你是 orchestrator`/`## dispatch`；真模型实测会自行派 subagent，与 tasks 路由重复。
   - 修复方案：super profile bundles 加 `@eterna/tasks` → `eterna-tasks` 配置注入 `presets: {orchestrator: eterna-tasks-orchestrator, worker: eterna-tasks-worker}` → `Sessions.ensure` 在 `agent.ctx.systemPrompt.section(...)` 注册角色 prompt（additive，order 0）→ 单测覆盖「每 agent 一次/role 文本/缺席降级」。
   - 为何不在本镜像改：最终镜像 `22fe8acb…` 上的 24h 浸泡（TERM-013/DATA-009）正在进行；改动会换镜像、作废浸泡窗口。按 54 §7/§9 记 P1 遗留，随下一次镜像变更窗口处理。
3. **产品线程 follow-up**：见 §3-3；不是缺陷，是产品语义。

## 5. 复现

```sh
# 前置（已执行）：注入已配置凭据 + 建 Mr.Ma + 重建 E3
node artifacts/rc5/e3-super/api005-prep.mjs

# 真模型 harness
docker exec eterna-rc5-e3 mkdir -p /tmp/api-harness
docker cp artifacts/rc5/API/_harness/index.js eterna-rc5-e3:/tmp/api-harness/index.js
docker cp artifacts/rc5/API/_harness/package.json eterna-rc5-e3:/tmp/api-harness/package.json
docker cp artifacts/rc5/API/_harness/run-api005-real.sh eterna-rc5-e3:/tmp/run-api005-real.sh
docker exec eterna-rc5-e3 sh /tmp/run-api005-real.sh   # HARNESS_EXIT=0
```

## 6. 结论

- **RC5-API-005 PASS**（真模型 2 工单/2 worker/树等待/无丢回执 + 确定性 executor join 补证）。
- **RC5-API-006 PASS**（真模型 `listDescendants` 与树一致）。
- **RC5-API-007 PASS**（真模型 `drainDescendants` 后无残留 running）。
- 遗留 **R22**（角色 prompt/preset 接线）为产品 P1，已定根因与修复方案，待下一次镜像变更窗口；不改变本三条判据。

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。