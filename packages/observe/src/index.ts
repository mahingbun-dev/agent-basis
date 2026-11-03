/**
 * @basis/observe —— L1 观测插件核心(策略纯函数层 + sqlite 信号存储 + 组合门)。
 *
 * 五个模块:
 * 1. 信号存储(signals.ts):evolve_signal sqlite 表(kind/ref/payload/tags/trajectory_hash),
 *    (kind, ref) 唯一去重 + trajectory_hash 聚类查询(reflector「同一错误 ≥N 次才立项」输入);
 * 2. 指标聚合(metrics.ts):session 事件流数组 → tokens(互斥四桶)/成本估算/缓存命中率/轮数,
 *    路由归属以 request/header / request/context 事件为准;
 * 3. 成本估算(pricing.ts):可覆写单价表(默认 DeepSeek 官方价,估算口径,未命中不猜价);
 * 4. 反馈桥(feedback.ts):feedback/message-put 低分(negative)→ feedback_low 信号入队;
 * 5. 漂移对比(drift.ts):两份指标快照 diff 出超阈值项 → drift 信号。
 *
 * Cordis 纪律:本包聚合层是纯函数 + 显式持有 sqlite 句柄(无旁路全局、无副作用闭包逃逸);
 * 组合层(bundle)把 createObservatory() 的产物以 `ctx.observe` 服务
 * (注册表 + OBSERVE_SERVICE_ID 唯一 ID)形态 provide,可交换、可配逆。
 * seam 形态的编译期钉住见 tests/types.seam-pin.ts。
 */
import { FeedbackWatcher } from './feedback.ts'
import { aggregateSessionMetrics } from './metrics.ts'
import type { AggregateOptions, SessionMetrics } from './metrics.ts'
import type { PricingTable } from './pricing.ts'
import { SignalStore } from './signals.ts'
import type { SignalStorePath } from './signals.ts'
import { DEFAULT_DRIFT_THRESHOLDS, driftSignal, evaluateDrift } from './drift.ts'
import type { DriftReport, DriftThresholds, MetricsSnapshot } from './drift.ts'
import type { SessionEventLike, SignalEnqueueResult } from './types.ts'

export { FeedbackWatcher, screenFeedbackItem, trajectoryHashOf } from './feedback.ts'
export type { FeedbackSignalDraft, FeedbackWatcherOptions } from './feedback.ts'
export { aggregateSessionMetrics } from './metrics.ts'
export type { AggregateOptions, RouteMetrics, SessionMetrics, TokenBuckets, TurnEndCounts } from './metrics.ts'
export { DEFAULT_PRICING, estimateCostUsd, lookupPrice, routeKey } from './pricing.ts'
export type { PricingTable, RoutePrice } from './pricing.ts'
export { enqueueApprovalSignal, SignalDecodeError, SignalStore } from './signals.ts'
export type { SignalStorePath } from './signals.ts'
export { DEFAULT_DRIFT_THRESHOLDS, DRIFT_GAUGES, driftSignal, evaluateDrift } from './drift.ts'
export type { DriftGauge, DriftItem, DriftLimit, DriftReport, DriftThresholds, MetricsSnapshot } from './drift.ts'
export { isRecord, SIGNAL_KINDS } from './types.ts'
export type {
  EvolveSignal, RouteRef, SessionEventLike, SignalEnqueueResult, SignalInput, SignalKind, SignalPayload,
  SignalQuery, TokenUsageLike, TrajectoryCluster,
} from './types.ts'

/** 组合层注册 ctx.observe 服务时的唯一 ID(注册表 + 唯一 ID 形态,provide 可交换)。 */
export const OBSERVE_SERVICE_ID = '@basis/observe'

/** 观测组合门:信号存储 + 反馈桥 + 聚合/漂移的默认装配。 */
export interface Observe {
  readonly id: typeof OBSERVE_SERVICE_ID
  readonly signals: SignalStore
  readonly feedback: FeedbackWatcher
  /** 聚合一段事件流(纯函数转发,默认携带本实例 pricing)。 */
  aggregate(events: readonly SessionEventLike[]): SessionMetrics
  /** 对比两份快照(纯函数转发,默认携带本实例 thresholds)。 */
  drift(baseline: MetricsSnapshot, current: MetricsSnapshot): DriftReport
  /** 漂移报告超阈值 → drift 信号入队(未触发返回 ignored,幂等)。 */
  reportDrift(report: DriftReport): SignalEnqueueResult
  /** 释放(effect 逆:关库 + 使组合门不可用)。 */
  dispose(): void
}

/** 组合门选项。 */
export interface ObservatoryOptions {
  /** sqlite 路径(文件或 ':memory:')。 */
  readonly store: SignalStorePath
  /** 信号归属领域包 id。 */
  readonly packId: string
  readonly pricing?: PricingTable
  readonly driftThresholds?: DriftThresholds
  readonly now?: () => number
}

/** 组装观测门(纯对象,无隐藏全局;字段不可变;dispose 为构造的逆)。 */
export function createObservatory(options: ObservatoryOptions): Observe {
  const signals = new SignalStore(options.store, { ...(options.now !== undefined && { now: options.now }) })
  const feedback = new FeedbackWatcher({
    store: signals,
    packId: options.packId,
    ...(options.now !== undefined && { now: options.now }),
  })
  const aggregateOptions: AggregateOptions = {
    ...(options.pricing !== undefined && { pricing: options.pricing }),
  }
  const driftThresholds = options.driftThresholds ?? DEFAULT_DRIFT_THRESHOLDS
  const id = OBSERVE_SERVICE_ID
  return {
    id,
    signals,
    feedback,
    aggregate: events => aggregateSessionMetrics(events, aggregateOptions),
    drift: (baseline, current) => evaluateDrift(baseline, current, driftThresholds),
    reportDrift(report) {
      const draft = driftSignal(report, options.packId)
      if (draft === null) return { signal: null, reason: 'ignored' }
      return signals.enqueue(draft)
    },
    dispose: () => {
      signals.close()
    },
  }
}
