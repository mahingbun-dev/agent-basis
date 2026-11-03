/**
 * 组合门(createObservatory)端到端单测:事件流 → 聚合 → 快照漂移 → 信号入队,
 * 与 feedback 低分信号同库共处;OBSERVE_SERVICE_ID 注册表形态;dispose 逆effect。
 */
import { describe, expect, it } from 'vitest'
import { aggregateSessionMetrics, createObservatory, evaluateDrift, OBSERVE_SERVICE_ID } from '../src/index.ts'
import type { MetricsSnapshot, SessionEventLike } from '../src/index.ts'
import {
  assistantUsage, feedbackPutLike, requestHeader, standardFixture, turnEnd, turnStart,
} from './fixtures.ts'

describe('createObservatory 组合门', () => {
  it('id 为注册表唯一 ID(OBSERVE_SERVICE_ID),aggregate 携带实例 pricing', () => {
    const observe = createObservatory({ store: ':memory:', packId: '@event/pack' })
    expect(observe.id).toBe(OBSERVE_SERVICE_ID)
    // standardFixture 手算合计 0.0006408 USD(DEFAULT_PRICING)
    expect(observe.aggregate(standardFixture()).costUsd).toBeCloseTo(0.0006408, 10)
    observe.dispose()
  })

  it('自定义 pricing 生效于组合门聚合', () => {
    const observe = createObservatory({
      store: ':memory:',
      packId: '@event/pack',
      pricing: { '*': { input: 1, output: 1 } },
    })
    // standardFixture billed=1050 全走通配价 $1/M → 0.00105(四桶全按 1 美元/M)
    expect(observe.aggregate(standardFixture()).costUsd).toBeCloseTo(1050 / 1e6, 10)
    observe.dispose()
  })

  it('端到端:feedback 低分 + 指标漂移同库入队,聚类/查询可用', () => {
    const observe = createObservatory({ store: ':memory:', packId: '@event/pack' })
    // ① 低分反馈 ×2(同会话)→ feedback_low ×2,同轨迹簇
    for (const messageId of ['m1', 'm2']) {
      const result = observe.feedback.applyEvent(feedbackPutLike('sess-9', messageId, 'negative'))
      expect(result.reason).toBe('enqueued')
    }
    // ② 基线快照(4 轮小流量)→ 当前快照(4 轮,缓存崩了)→ 漂移 → drift 信号
    const events = (turns: number, input: number, cacheRead: number): readonly SessionEventLike[] => [
      turnStart(1, 100, 1),
      requestHeader(2, 101, 'deepseek', 'deepseek-chat'),
      assistantUsage(3, 102, 1, 1, { inputTokens: input, outputTokens: 2000, cacheReadTokens: cacheRead }),
      turnEnd(4, 103, 1, 'completed'),
      ...Array.from({ length: turns - 1 }, (_, index): SessionEventLike[] => [
        turnStart(5 + index * 3, 200 + index, index + 2),
        assistantUsage(6 + index * 3, 201 + index, index + 2, 1, { inputTokens: input, outputTokens: 2000, cacheReadTokens: cacheRead }),
        turnEnd(7 + index * 3, 202 + index, index + 2, 'completed'),
      ]).flat(),
    ]
    const baseline: MetricsSnapshot = { label: 'w43', at: 1, metrics: observe.aggregate(events(4, 1000, 9000)) }
    const current: MetricsSnapshot = { label: 'w44', at: 2, metrics: observe.aggregate(events(4, 9000, 1000)) }
    const report = observe.drift(baseline, current)
    expect(report.triggered).toBe(true)
    const driftResult = observe.reportDrift(report)
    expect(driftResult.reason).toBe('enqueued')
    expect(driftResult.signal?.kind).toBe('drift')
    // 重复上报同一报告 → 幂等
    expect(observe.reportDrift(report).reason).toBe('duplicate')
    // ③ 库内三类信号共存,查询互不串
    expect(observe.signals.count()).toBe(3)
    expect(observe.signals.count({ kind: 'feedback_low' })).toBe(2)
    expect(observe.signals.count({ kind: 'drift' })).toBe(1)
    expect(observe.signals.clusterByTrajectory({ minCount: 2 })).toHaveLength(1)
    observe.dispose()
  })

  it('未触发的漂移报告 → reportDrift 返回 ignored(不落库)', () => {
    const observe = createObservatory({ store: ':memory:', packId: '@event/pack' })
    const same = aggregateSessionMetrics(standardFixture())
    const report = evaluateDrift({ label: 'a', at: 1, metrics: same }, { label: 'b', at: 2, metrics: same })
    expect(observe.reportDrift(report)).toEqual({ signal: null, reason: 'ignored' })
    expect(observe.signals.count()).toBe(0)
    observe.dispose()
  })

  it('dispose(逆effect)后信号库关闭', () => {
    const observe = createObservatory({ store: ':memory:', packId: '@event/pack' })
    observe.dispose()
    expect(observe.signals.closed).toBe(true)
    expect(() => observe.signals.count()).toThrow(/已 close/)
  })

  it('可注入时钟(feedback 信号 ts 与 drift ref 一致性由默认 now 兜底)', () => {
    let fake = 500
    const observe = createObservatory({ store: ':memory:', packId: '@event/pack', now: () => fake })
    const result = observe.feedback.applyEvent(feedbackPutLike('s', 'm', 'negative'))
    expect(result.signal?.ts).toBe(500)
    fake = 600
    expect(observe.feedback.applyEvent(feedbackPutLike('s', 'm2', 'negative')).signal?.ts).toBe(600)
    observe.dispose()
  })
})
