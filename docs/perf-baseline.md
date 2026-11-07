# 性能基线与观测口径（perf-baseline）

> T5 交付物。基线数据文件 `docs/perf-baseline-data.json` 由 `scripts/perf-baseline.mjs`
> 从最新 `dsh-evals-out/` 产物汇总生成（无产物则现场跑 event-planning replay 再汇总）。
> 口径全部对齐 `@basis/observe` L1 观测插件，不在文档层另造指标。

## 1. 指标定义

### 1.1 Token 用量（互斥四桶）

来源口径:`TokenUsage` 计数互斥（dsh-repo `packages/llm/src/types.ts:182-196`），聚合实现
`packages/observe/src/metrics.ts:26-34`:

| 桶 | 含义 |
|---|---|
| `input` | 未命中缓存的输入 token |
| `cacheRead` | KV-cache 命中读取的输入 token（单列，不并入 input） |
| `cacheWrite` | 写入缓存的输入 token（单列） |
| `output` | 输出 token（reasoning 已含其中，不重复累计） |
| `billed` | 计费合计 = input + cacheRead + cacheWrite + output |

配套口径:轮数 `turns` = `turn/start` 去重计数（`metrics.ts:126-130`）；步数 `steps` =
`step/start` 去重（`turn:step` 键）；`modelCalls` = 带 usage 的 `assistant/message` 计数
（`metrics.ts:162-177`）。dsh-evals runner 自身的 `sessions.jsonl` 另有 `total_tokens`
字段，口径 = `usage.totalTokens ?? input+output+cacheRead+cacheWrite`
（`tools/evals/src/events.ts:137,186`）——与 observe 的 `billed` 同分母，两处可互相校验。

### 1.2 成本（估算，非账单）

`packages/observe/src/pricing.ts`:单价表 `DEFAULT_PRICING`（DeepSeek 官方公开价，
2026-11 采集，USD / 1M tokens，`pricing.ts:27-30`）:

| 路由 | 输入(未命中) | 缓存命中 | 输出 |
|---|---|---|---|
| `deepseek/deepseek-chat` | $0.27 | $0.07 | $1.10 |
| `deepseek/deepseek-reasoner` | $0.55 | $0.14 | $2.19 |

- `cacheWrite` 按未命中输入价计（官方口径，`pricing.ts:11-12`）；
- 成本 = `estimateCostUsd(usage, price)`（`pricing.ts:59-76`），逐路由按
  `request/header` / `request/context` 事件锚定的 provider/model 归集（`metrics.ts:146-176`）；
- **价格表未命中 → 成本按 0 计，billed 全额计入 `unpricedBilledTokens`，绝不猜价**
  （`metrics.ts:42-43,189-200`）。基线数据中 `unpricedBilledTokens > 0` 即提示需要补价格表。
- 路由归属规则:优先 `request/header`（header.config），其次 `request/context`，
  两者皆无归 `unknown/unknown`（`metrics.ts:8-12,146-161`）。

### 1.3 KV-cache 命中率

```
cacheHitRate = cacheRead / (input + cacheRead + cacheWrite)
```

分母 = 全部 prompt token（`metrics.ts:16-18,206-207`）。**从无任一请求报告过缓存桶时
为 `null`（未知），不伪报 0**（`metrics.ts:107,173-175,207`）。

- replay fixture 只含 `{inputTokens, outputTokens}`，不带缓存桶 → replay 基线中
  `cacheHitRate` 恒为 `null`，属口径内「未知」，不是劣化信号；
- 真会话（acp 适配器 / 网关直测）由 provider usage 上报缓存桶后才有数值；
  门禁阈值 `cache_hit_rate_min: 0.7`（`packs/event-planning/evals/threshold.yml:11`）
  只对真会话口径生效。

### 1.4 首 token 延迟（TTFT）

定义:**模型侧发出请求到第一个流式 chunk 到达的墙钟时间差**，单位 ms。

测量锚点（真会话事件流）:
- 起点 = 该 step 的 `step/start` 事件 `time`；
- 终点 = 该 step 对应 `assistant/message.data.stream[]` 首条记录的 `time`
  （DSH 在 chunk 到达时以 `Date.now()` 落时间戳，dsh-repo
  `packages/core/agent-loop/src/assistant-stream.ts:61`
  `this.accumulator.push({ time: Date.now(), chunk })`）；
- 逐 step 计算后取会话中位数与最大值入基线。

**replay 产物不测 TTFT**:fixture 的时间戳是合成递增（如 1762000000100 → +100ms 间隔）
且 `stream: []`（`packs/<pack>/fixtures/*.jsonl` 生成器口径），测出来的数字是 fixture
形状而非模型行为。基线数据中 replay case 的 `ttft` 字段为 `null` 并带
`"ttft": "not-measurable (replay: synthetic timestamps, stream=[])"` 注记。
TTFT 只在真会话口径（acp 适配器、网关直测）下报告。

## 2. 测量环境

| 项 | 值 |
|---|---|
| 机器 | macOS arm64（darwin 27.0.0, Apple Silicon） |
| Node | v24.18.0（原生 type-stripping，直接跑 TS 源） |
| 仓库基点 | dev @ a03ee7c（复测时以 `git rev-parse HEAD` 记录进数据文件 `git_head`） |
| 基线 pack | `packs/event-planning`（金集 30 条 golden case） |
| 离线适配器 | `replay`（fixture 回放，**零模型凭据**，毫秒级跑完） |
| 真会话适配器 | `acp`（经 DSH Python SDK 驱动真实 session，需 LITELLM_API_KEY） |
| 真会话网关 | liteLLM OpenAI 兼容网关，BASE_URL 读 `.secrets/litellm-base-url.txt`，key 只从 `.secrets/litellm-master-key.txt` 读进宿主进程环境（纪律同 `scripts/t7-smoke.mjs:28-29,67-73`），不写入任何被跟踪文件 |

**可比性规则:基线对比只在同 pack + 同 adapter + 同 case 集 + 同机器环境间进行。**
replay 数字（fixture 决定）与真会话数字（模型决定）不可互比。

## 3. 数据源

### 3.1 dsh-evals-out 产物（主数据源）

`dsh-evals` CLI（`tools/evals/bin/dsh-evals.mjs` → `src/cli.ts`）缺省把产物写到
`./dsh-evals-out/<adapter>-<时间戳>/`（`cli.ts:49-51`），产物布局（`src/runner.ts:117-127`）:

```
dsh-evals-out/replay-2026-11-06T18-08-59-461Z/
  report.md        # 通过率 / 分 tags 统计 / 失败分类 / 用例明细
  sessions.jsonl   # 一行一 case:user_input/answer/tags/status/adapter/metrics{turns,steps,
                   #   tool_calls,total_tokens,approval_asks,event_count}/duration_ms
  events/<case-id>.jsonl   # 每 case 的原始 session 事件流（DSH SessionEvent 形态，每行一个）
  workspaces/<case-id>/    # 每 case 独立工作区（终态文件）
```

`scripts/perf-baseline.mjs` 选取规则:取 `dsh-evals-out/` 下含 `sessions.jsonl` 的产物
目录中 `report.md` `started_at` 最新者;若无任何产物，现场执行

```sh
node tools/evals/bin/dsh-evals.mjs run --pack packs/event-planning --adapter replay \
  --out dsh-evals-out/replay-<UTC 时间戳>
```

（replay 适配器只回放 fixture，不发起模型调用，无凭据依赖。）随后把每个
`events/*.jsonl` 喂给 observe 聚合器。**注意:replay fixture 事件流不带
`request/header` / `request/context` 路由锚点 → 成本按 0 计、全部 billed 计入
`unpricedBilledTokens`（§1.2 不猜价口径），成本基线只在真会话口径下有效。**

### 3.2 observe 插件（口径与漂移对比的单一权威）

`packages/observe/src/index.ts:1-15` 五模块分工；性能基线直接复用其中两个纯函数:

- `aggregateSessionMetrics(events)`（`metrics.ts:97-233`）——事件流 →
  §1.1-§1.3 全部指标 + `perTurn` 归一化口径（costPerTurn / billedTokensPerTurn /
  errorTurnRate，`metrics.ts:227-231`）+ 路由明细；
- `DEFAULT_DRIFT_THRESHOLDS`（`drift.ts:50-56`）——§4 复测对比的阈值来源。

观测插件在线侧的输出（sqlite `evolve_signal` 信号存储、feedback 低分入队、漂移信号）
属运行期信号通道，与本基线的离线汇总共用同一套聚合口径，故以 `aggregateSessionMetrics`
为准即可保证在线/离线数字可对账。

### 3.3 真会话单点（补充口径）

网关直测（OpenAI 兼容 `/v1/chat/completions`，`stream: true`）单次测量:
TTFT = 时间到首个 delta chunk；usage 取响应尾帧 `usage`
（`prompt_tokens` / `completion_tokens` / `prompt_tokens_details.cached_tokens`），
缓存命中率按 §1.3 公式由 `cached_tokens / prompt_tokens` 折算。仅作单点抽查，
不入门禁基线（样本量 1，无统计意义）。

**实测样例（2026-11-06，basis-minimal profile 经 DSH harness 跑一轮真实会话，
事件流喂 `aggregateSessionMetrics`，凭据只读自 `.secrets/`）:**

| 项 | 值 |
|---|---|
| 输入 | `请只回复两个字:在线`，maxTokens=100，模型 `basis/deepseek-flash`（liteLLM 网关） |
| 轮/步/模型调用 | 1 / 1 / 1，墙钟 1667 ms |
| Token | input=1173，cacheRead=1024，output=2，billed=2199 |
| KV-cache 命中率 | **46.6%**（1024 / 2197 prompt tokens，provider 真实上报） |
| TTFT | **1108 ms**（`assistant/message.stream` 首记录时间 − `step/start` 时间，真实时间戳） |
| 成本 | `$0`（route `basis/deepseek-flash` 不在 DEFAULT_PRICING → unpriced，不猜价；billed 2199 全额计入 unpricedBilledTokens） |

该样例演示真会话口径下四个指标的可测性:TTFT 与缓存命中率只有真会话才有数值
（replay 基线中恒为 null / 不测，见 §1.3-§1.4）。

## 4. 复测与对比规则（发布前后不劣化）

### 4.1 复测命令

```sh
node scripts/perf-baseline.mjs          # 汇总最新产物 → docs/perf-baseline-data.json + stdout 摘要
node scripts/perf-baseline.mjs --fresh  # 先现场跑 event-planning replay 生成新产物再汇总
```

发布门禁流程:发布前跑一次（同机器、同 pack、默认全量 case），与已提交的
`docs/perf-baseline-data.json` 逐指标对比;发布后回归一次确认。

### 4.2 对比规则（drift 阈值，来自 `packages/observe/src/drift.ts:50-56`）

| 指标 | 阈值 | 方向 | 超阈值含义 |
|---|---|---|---|
| `costPerTurn` | 相对 25% | 只禁升 | 单轮成本超基线 25% → 查 prompt 膨胀/路由漂移 |
| `billedTokensPerTurn` | 相对 25% | 只禁升 | 单轮 token 超基线 25% → 查上下文裁剪 |
| `cacheHitRate` | 绝对 0.1 | 双向 | 命中率掉 10 个百分点 → 查缓存路径（真会话口径） |
| `errorTurnRate` | 相对 50% 或绝对 0.1 | 只禁升 | 错误轮占比恶化 |
| `turns` | 相对 40% | 双向 | 轮数漂移超 40% → 查 agent 循环行为 |

附加硬规则:

1. **通过率不劣化**:新产物 `report.md` 的 pass_rate ≥ 基线记录的 pass_rate
   （replay 下金集应保持 100%）；出现新增 FAIL case 即停，先修不发布。
2. **`null` 语义**:任一侧 `cacheHitRate` 为 `null`（如 replay 口径）时该指标跳过对比
   （`drift.ts` 的 `skipped-null`，不按 0 处理）。
3. **价格表变更可追溯**:基线数据文件记录 `pricing` 表与 `git_head`；改价格表必须连
   基线一起重生成并在 PR 说明。
4. **基线更新纪律**:只有「有意接受的性能变化」（如 prompt 结构调整）才允许重生成基线
   并入 PR;意外漂移先定位原因，不许用刷基线的方式过门禁。
5. **真会话门禁**:acp/网关口径下另须满足 `cache_hit_rate_min: 0.7`
   （`packs/event-planning/evals/threshold.yml:11`）与 release 段的
   `verification_pass_rate_min: 0.85` / `trajectory_match_rate_min: 0.8`（同文件:8-9）。

### 4.3 数据文件结构

`docs/perf-baseline-data.json` 顶层字段:`generated_at`（生成时刻）、`git_head`、
`artifact`（dsh-evals-out 目录名）、`pack`、`adapter`、`cases`（total/pass/pass_rate）、
`totals`（observe 聚合的会话级合计）、`per_case`（逐 case 明细，含 `ttft` 字段）、
`per_turn`、`pricing`（当次使用的单价表）、`notes`（口径注记）。复测脚本读它做对比，
重生成即更新基线。
