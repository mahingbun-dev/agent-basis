# RC5-API-005 — 主会话派 2 个 worker：waitForTreeWork 等到全部完成（API-005）

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109）内的隔离 DSH_HOME 真宿主 harness
  （`/tmp/api-real-home`，`--profile api-real`；不动容器 `/data`、不碰生产）
- 优先级：P0
- 结论：**PASS（真模型档）**
- 时间：2026-11-20T08:46:37.088Z → 2026-11-20T08:48:17.524Z
- 模型：`mimo / mimo-v2.6-pro`（E3 已注入的**已配置**凭据；只从容器 env 读取，日志/证据无凭据值）

## 预期（51/54 原文口径）

E3 主会话派 2 worker；waitForTreeWork 全完成；无丢回执

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | 真模型装配（provider/model 与配置一致） | worker session `request/header`：`provider=mimo model=mimo-v2.6-pro` |
| PASS | 两条 Trigger 均被真实 Engine accept → 两张工单 | `1b90ba4ca28133d1e16ec5c08377288e`、`400260cbd9bf9a14ee645eccb3c6423b`，`decision=accept` |
| PASS | DshExecutor + Sessions 建出两条真实 worker session | `worker-1b90ba4ca28133d1e16ec5c08377288e`、`worker-400260cbd9bf9a14ee645eccb3c6423b` |
| PASS | worker A 的真实子代理树 2 个 child | `d172fc6d-…`(api-child-1)、`f3ceb318-…`(api-child-2) |
| PASS | `waitForTreeWork(workerA)` 等到整棵树完成 | `returned=true waitedMs=41883`；结束时两 child `status=absent` |
| PASS | 无丢回执：两条 `subagent-settled` 均 `completed` 且 sender 对得上 | `receipts=2/2`、`stopReasons=[completed,completed]`、`unexpected=[]` |
| PASS（advisory） | executor 亲自 join（≥3s） | `advisory.executorTreeJoin=false`；51 判据不要求调用方，确定性 stub 档同一断言 PASS（`waitedMs≥3s`） |

## 复现

```sh
docker cp artifacts/rc5/API/_harness/index.js eterna-rc5-e3:/tmp/api-harness/index.js
docker cp artifacts/rc5/API/_harness/package.json eterna-rc5-e3:/tmp/api-harness/package.json
docker cp artifacts/rc5/API/_harness/run-api005-real.sh eterna-rc5-e3:/tmp/run-api005-real.sh
docker exec eterna-rc5-e3 sh /tmp/run-api005-real.sh
# HARNESS_EXIT=0；结果 /tmp/api-real-home/out/results.json
```

## 证据

- `artifacts/rc5/e3-super/real-harness/results.json` — 完整结果（工单/worker/子代理/回执/等待时长/descendants/drain）
- `artifacts/rc5/e3-super/real-harness/harness.log` — 运行日志
- `artifacts/rc5/e3-super/real-harness/worker-a.jsonl` — worker A 持久史（含 `provider=mimo model=mimo-v2.6-pro` 与两条回执）
- `artifacts/rc5/e3-super/real-harness/boot.log` — dsh 启动（`token` 已脱敏）
- `artifacts/rc5/e3-super/API-005-real-model.md` — 三组证据的合并说明与边界

## 边界（如实记录）

1. **产品线程语义**：同一 webchat 主会话线程的第二条消息按产品设计成为既有工单的 follow-up，不会开第二张工单。harness 以同一主会话的两个独立线程标识（`orchestrator-…::api-batch-1/2`）注入两条并发工单，等价于两个独立来源线程；会话归属/scope/gate 仍是主会话。
2. **executor join 的时序观察项**：真模型首响应延迟实测约 110–150s，与子代理生命周期同量级，`executorTreeJoin` 会竞态；确定性 stub 档（`artifacts/rc5/API/_harness/results/api005-007-results.json`）已 PASS 该项。51 的 API-005 判据（waitForTreeWork 全完成 + 无丢回执）在真模型档独立成立。
3. **任务角色 prompt/preset 接线**：E3 app 级真模型实测发现主会话仍使用标准 preset（带 subagent 工具），可能自行派发而非走 tasks 路由；已作为产品遗留 R22 记录（根因/修复方案/为何不在本镜像改动），不影响本条 API-005 的判据。

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。