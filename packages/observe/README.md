# @basis/observe

L1 观测插件核心(设计文档 08 §3-7、09 §1/§4、10 §2;任务 T9):evolve_signal 信号存储、
session 事件流→指标聚合、feedback 低分→信号入队、漂移快照对比。策略纯函数层 +
`node:sqlite` 存储(零外部依赖,Node ≥22 内置);组合层以 `ctx.observe` 服务
(注册表 + `OBSERVE_SERVICE_ID` 唯一 ID)形态 provide。

## 模块

| 模块 | 职责 | 关键 API |
|---|---|---|
| `signals.ts` | evolve_signal sqlite 表(kind/ref/payload/tags/trajectory_hash);`(kind, ref)` 唯一去重(重放幂等);trajectory_hash 聚类查询(reflector「同一错误 ≥N 次才立项」的统计输入);approval/decided 负信号桥 | `SignalStore` `enqueue` `list` `count` `clusterByTrajectory` `close` `enqueueApprovalSignal` |
| `metrics.ts` | session 事件流数组 → tokens(互斥四桶)/成本估算(USD)/缓存命中率/轮数/路由明细/逐轮派生。**路由归属以 `request/header` / `request/context` 事件为准**;`assistant/message.usage` 记入当前路由 | `aggregateSessionMetrics` |
| `pricing.ts` | 可覆写单价表(默认 DeepSeek 官方价,USD/1M tokens;估算口径);未命中路由不猜价(计 `unpricedBilledTokens`) | `DEFAULT_PRICING` `lookupPrice` `estimateCostUsd` |
| `feedback.ts` | `feedback/message-put` 低分(rating=negative)→ `feedback_low` 信号;ref=`feedback:<sessionId>:<messageId>`(版本 churn 不重复);同会话共享 trajectory_hash 簇 | `FeedbackWatcher` `screenFeedbackItem` `trajectoryHashOf` |
| `drift.ts` | 两份指标快照 diff 超阈值项(默认:成本/每轮 token +25%(up)、命中率 ±0.1(both)、错误率 +50% 或 +0.1(up)、轮数 ±40%(both));baseline=0 不猜除零(仅 abs);超阈值 → `drift` 信号 | `evaluateDrift` `driftSignal` `DEFAULT_DRIFT_THRESHOLDS` |
| `index.ts` | 组合门 `createObservatory`(signals+feedback+aggregate+drift+reportDrift+dispose);`OBSERVE_SERVICE_ID = '@basis/observe'` | `createObservatory` |

## 口径说明

- **TokenUsage 互斥桶**(dsh `packages/llm/llm/src/types.ts:182`):`inputTokens` 只含未缓存输入,
  `cacheRead/cacheWrite` 单列,计费输入 = 三者之和;`reasoning` 已含在 `outputTokens` 内不重复累计。
- **缓存命中率** = `cacheRead / (input + cacheRead + cacheWrite)`;从未上报缓存桶 → `null`(未知,不伪报 0)。
- **轮数** = `turn/start` 去重;结束原因计数来自 `turn/end.reason.kind`。
- 信号为 append-only 审计数据(对齐设计 09 §6 账本语义),`SignalStore.close()` 是构造的逆 effect。

## seam 钉住

`tests/types.seam-pin.ts` 用已发布 `@deepseek-ai/dsh-session` / `dsh-llm` / `dsh-message-feedback`
(0.2.2-alpha.2,与 ../dsh-repo 同版)断言官方 `SessionEvent`/`TokenUsage`/`LlmCallConfig`/
`feedback/message-put` 可直接喂给本包——DSH 升级破坏 seam 时 `tsc --noEmit` 即失败。

## 验收

```
pnpm --filter @basis/observe run verify   # oxlint + tsc --noEmit + vitest run(60 测试)
```

覆盖:信号去重(重放/版本 churn/跨实例重开)、指标计算(手算对账/路由锚定/坏数据防御)、
漂移触发(默认+自定义阈值/方向语义/除零护栏/严格大于边界)、组合门端到端。

## 已知边界(需运行时联调)

- 真实 DSH host 内挂载(live session 事件订阅、ctx.observe 注册)属组合层 bundle,T14 总装联调;
- `approval_modified`(用户改产出=隐含差评)需 interact 插件的 deliverables 比对结果,经
  `store.enqueue({ kind: 'approval_modified', ... })` 直接入队(内核事件无此信号,见 signals.ts 注释);
- OTel→ai-evo 直通(设计 08 §3-7)不在本包验收面,后续任务接 telemetry。
