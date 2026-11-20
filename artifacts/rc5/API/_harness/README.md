# RC5 API-005/006/007 宿主 harness

本目录是 `artifacts/rc5/API/RC5-API-005..007` 的可复现执行夹具。它跑在
**3108 测试容器 `eterna-rc5-e1`** 内的一个**独立 dsh 进程**里，使用隔离
`DSH_HOME=/tmp/api-run-home`、`--port 0`、`127.0.0.1`，不读写容器的 `/data`，
不触碰 `eterna-rc5-e3` 与生产 `eterna-agent`。

## 为什么需要 harness

API-005/006/007 需要“主会话派 worker + worker 上派子代理 + 真实
`SubagentManager`/session 持久化”。测试容器里跑着的 E1 应用是常驻服务，直接往里
注入测试工单会污染其数据根；因此另起一个真实 dsh 进程，在同一镜像内装配：

- 官方 `dsh 0.2.2-rc.5` 的 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` bundle
- 工作树当前 `@eterna/tasks`（`/repo/packages/tasks`，与宿主源码哈希一致）
- 本 harness 插件（`index.js`），注入 `tasks/agents/subagents/sessionController/sessionPersistence`

worker session、子代理、回执投递、`waitForTreeWork`、`listDescendants`、
`drainDescendants` 全部是上游真实实现，不是 fixture manager。

## 模型层为什么是 stub

测试容器没有可用模型凭据：

- `DEEPSEEK_API_KEY` 长度为 0
- `MIMO_API_KEY` 为 31 字符占位，实测 `HTTP 401 Invalid API Key`

（证据：`results/credential-probe.log`，只记录长度/状态，不记录凭据值。）

因此 harness 在真实 `llm` 服务上注册 provider `stub` 的确定性 adapter，只替代模型
文本生成；任务 worker/子代理的生命周期、回执、持久化仍是真实路径。**真模型 worker
回合未跑**，这是 P0 leftover `API005-REALMODEL` 的范围。

> **2026-11-20 晚更新**：真模型档已补齐（`API_HARNESS_REAL=1` + `run-api005-real.sh`），
> 在 E3 super 容器用生产已配置的 `mimo/mimo-v2.6-pro` 跑通 —— 2 工单 / 2 真实 worker /
> 2 child / `waitForTreeWork` 41883ms / 2 条 completed 回执；`API005-REALMODEL` 已闭。
> 本节「测试容器无凭据」只适用于默认 stub 档。证据：`artifacts/rc5/e3-super/API-005-real-model.md`。

## 复现

前置：3108 容器健康；容器内存在 `/repo/packages/tasks` 与 `dsh`；`/tmp/api-harness`
下有本目录的 `index.js`、`package.json`。

```sh
cd /Users/sunny/code/agent-basis-rc5
docker cp artifacts/rc5/API/_harness/index.js eterna-rc5-e1:/tmp/api-harness/index.js
docker cp artifacts/rc5/API/_harness/package.json eterna-rc5-e1:/tmp/api-harness/package.json
docker cp artifacts/rc5/API/_harness/run-api005-007.sh eterna-rc5-e1:/tmp/run-api005-007.sh
docker exec eterna-rc5-e1 sh /tmp/run-api005-007.sh
```

`run-api005-007.sh` 会：

1. `rm -rf /tmp/api-run-home`，`dsh api-prof --from-default-profile web --dump-config`
   生成 `api-prof` profile；
2. 软链 `@eterna/tasks -> /repo/packages/tasks`、`@eterna/api-harness -> /tmp/api-harness`；
3. 写入 `cordis.patch.yml`：默认模型 `stub/stub-fast`，插入 `@eterna/tasks`
   （`realm=ApiHarness`）与 harness 插件（`outDir=/tmp/api-run-home/out`）；
4. `timeout 180 dsh --profile api-prof --port 0 --host 127.0.0.1 --no-open`；
5. 输出 `HARNESS_EXIT=<code>` 与 `harness.log`。

成功运行：`HARNESS_EXIT=0`，`results.json` 中 `ok=true`。

**注意**：`api-prof` 的 `--from-default-profile` 会重建 profile 目录，软链必须在它
之后创建；早期脚本顺序相反导致 `ERR_MODULE_NOT_FOUND` 并超时（EXIT 124），已修正。

## 证据文件

- `results/api005-007-results.json` — 完整结果（工单/worker/子代理/回执/wait 栈/drain）
- `results/api005-007-harness.log` — 运行日志
- `results/api005-007-boot.log` — dsh 启动日志（`token=` 已脱敏）
- `results/hash-compare.log` — 宿主与容器 `/repo` 的 tasks 源码 SHA-256（逐行相同）
- `results/credential-probe.log` — 凭据可用性（无凭据值）
- `sessions/worker-a-session-extract.jsonl` — worker A 持久史脱敏切片（17 事件）
- `sessions/worker-a-receipts.txt` — 两条 `subagent-settled` 回执正文
- `sessions/worker-b-session-extract.jsonl` — worker B 持久史切片（7 事件）
- `api009/` — API-009 的静态复核与两套 cordis 行为日志
- `api009.mjs` — API-009 行为脚本
- `run-api005-007.sh` — 本 harness 的容器内复现脚本（stub 档）
- `run-api005-real.sh` — 真模型档复现脚本（E3 super，`API_HARNESS_REAL=1`）

## 已知边界

- 用例文档标 E3 super；本 harness 的 stub 档在 3108（e1，`ETERNA_FORM=web`）执行，e3（3109，`ETERNA_FORM=super`）未跑。
  两者 tasks/subagent 源码相同，super 特有插件不在本用例断言面。
  **2026-11-20 晚真模型档已在 E3 super 上跑通**（`run-api005-real.sh`），该边界对 stub 档仍适用。
- harness 用两个 thread id 注入两条并发工单（`webchat:...::api-batch-1/2`）；
  同一主会话线程的第二条消息会按产品语义成为既有工单 follow-up。
- 派发决策（accept）由 harness 以 `explicit` 注入，不是主会话 LLM 产出；由于容器无模型凭据，
  主会话/worker 的模型文本都由 stub adapter 生成，但 Engine/Executor/SubagentManager/持久化/
  回执投递是真实 rc.5 路径。
- `listDescendants` 是持久 catalog 视图，drain 后仍列出已释放的 child（`resident=false`）；
  判断残留 running 需叠加 `agents.get(id)`。