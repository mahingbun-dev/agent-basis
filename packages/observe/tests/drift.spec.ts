/**
 * 漂移快照对比单测:两份指标快照 diff 出超阈值项(默认阈值与自定义阈值、方向语义、
 * 除零护栏、skipped-null、严格大于边界、drift 信号生成与入队幂等)。
 * 快照由 aggregateSessionMetrics 产物构造(真链路:事件流 → 指标 → 快照 → 漂移)。
 */
import { describe, expect, it } from 'vitest'
import {
  aggregateSessionMetrics, DEFAULT_DRIFT_THRESHOLDS, driftSignal, DRIFT_GAUGES, evaluateDrift, SignalStore,
} from '../src/index.ts'
import type { DriftReport, MetricsSnapshot, SessionEventLike } from '../src/index.ts'
import { assistantUsage, requestHeader, turnEnd, turnStart } from './fixtures.ts'

/**
 * 造快照:turns 轮、chat 路由、每轮同一 usage。
 * 基线 {input 1000, cacheRead 9000, output 2000}:cacheHitRate=0.9,billed/turn=12000,
 * cost/turn = 0.001×0.27 + 0.009×0.07 + 0.002×1.1 = 0.0031(USD)。
 */
function snapshot(
  label: string,
  at: number,
  opts: {
    readonly inputPerTurn: number
    readonly cacheReadPerTurn: number
    readonly outputPerTurn: number
    readonly turns: number
    readonly errorTurns?: number
  },
): MetricsSnapshot {
  const events: SessionEventLike[] = []
  let seq = 0
  for (let turn = 1; turn <= opts.turns; turn += 1) {
    events.push(turnStart(++seq, at + seq, turn))
    events.push(requestHeader(++seq, at + seq, 'deepseek', 'deepseek-chat'))
    events.push(assistantUsage(++seq, at + seq, turn, 1, {
      inputTokens: opts.inputPerTurn,
      outputTokens: opts.outputPerTurn,
      cacheReadTokens: opts.cacheReadPerTurn,
    }))
    events.push(turnEnd(++seq, at + seq, turn, turn <= (opts.errorTurns ?? 0) ? 'error' : 'completed'))
  }
  return { label, at, metrics: aggregateSessionMetrics(events) }
}

const baseline = snapshot('week-2026W43', 1_000_000, {
  inputPerTurn: 1000, cacheReadPerTurn: 9000, outputPerTurn: 2000, turns: 4,
})

describe('evaluateDrift —— 默认阈值触发', () => {
  it('无变化(同快照)→ 不触发,全项 direction=flat', () => {
    const report = evaluateDrift(baseline, baseline)
    expect(report.triggered).toBe(false)
    expect(report.breaches).toEqual([])
    expect(report.items.every(item => item.direction === 'flat' && !item.breached)).toBe(true)
    expect(report.baseline.label).toBe('week-2026W43')
    expect(report.current.at).toBe(baseline.at)
  })

  it('成本每轮大涨(超 rel=0.25)→ 触发;billed +25% 恰等于阈值(严格大于)→ 不触发', () => {
    const current = snapshot('week-2026W44', 2_000_000, {
      inputPerTurn: 2000, cacheReadPerTurn: 9000, outputPerTurn: 4000, turns: 4,
    })
    const report = evaluateDrift(baseline, current)
    expect(report.triggered).toBe(true)
    const cost = report.items.find(item => item.gauge === 'costPerTurn')
    expect(cost?.breached).toBe(true)
    expect(cost?.direction).toBe('up')
    expect(cost?.changeRate ?? 0).toBeGreaterThan(0.25)
    // billed/turn:12000 → 15000,|Δ|/baseline = 3000/12000 = 0.25 恰在阈值上(二进制精确)→ 严格大于判定不触发
    const tokens = report.items.find(item => item.gauge === 'billedTokensPerTurn')
    expect(tokens?.delta).toBe(3000)
    expect(tokens?.changeRate).toBe(0.25)
    expect(tokens?.breached).toBe(false)
  })

  it('缓存命中率 0.9 → 0.1(|Δ|=0.8 > abs 0.1,双向)→ 触发 cacheHitRate 项', () => {
    const current = snapshot('week-2026W44', 2_000_000, {
      inputPerTurn: 9000, cacheReadPerTurn: 1000, outputPerTurn: 2000, turns: 4,
    })
    const report = evaluateDrift(baseline, current)
    const hit = report.items.find(item => item.gauge === 'cacheHitRate')
    expect(hit?.status).toBe('compared')
    expect(hit?.baseline).toBeCloseTo(0.9, 6)
    expect(hit?.current).toBeCloseTo(0.1, 6)
    expect(hit?.direction).toBe('down')
    expect(hit?.breached).toBe(true)
    expect(report.breaches.map(item => item.gauge)).toContain('cacheHitRate')
    expect(report.triggered).toBe(true)
  })

  it('错误轮率 0 → 0.5(baseline=0 → changeRate=null 不猜除零;abs=0.1 兜底触发)', () => {
    const current = snapshot('week-2026W44', 2_000_000, {
      inputPerTurn: 1000, cacheReadPerTurn: 9000, outputPerTurn: 2000, turns: 4, errorTurns: 2,
    })
    const report = evaluateDrift(baseline, current)
    expect(report.breaches.map(item => item.gauge)).toEqual(['errorTurnRate'])
    const err = report.items.find(item => item.gauge === 'errorTurnRate')
    expect(err?.changeRate).toBeNull()
    expect(err?.delta).toBeCloseTo(0.5, 10)
    expect(err?.breached).toBe(true)
  })

  it('改善方向不触发 direction=up 的指标(成本大降 ≠ drift)', () => {
    const current = snapshot('week-2026W44', 2_000_000, {
      inputPerTurn: 500, cacheReadPerTurn: 9000, outputPerTurn: 1000, turns: 4,
    })
    const report = evaluateDrift(baseline, current)
    const cost = report.items.find(item => item.gauge === 'costPerTurn')
    expect(cost?.direction).toBe('down')
    expect(cost?.changeRate ?? 0).toBeGreaterThan(0.25) // 量级足以触发,若方向语义错误会 breach
    expect(cost?.breached).toBe(false)
    expect(report.triggered).toBe(false)
  })
})

describe('evaluateDrift —— 自定义阈值与边界', () => {
  it('自定义阈值收紧后,原本不触发的变化(+16%)触发', () => {
    const current = snapshot('week-2026W44', 2_000_000, {
      inputPerTurn: 1200, cacheReadPerTurn: 9000, outputPerTurn: 2400, turns: 4,
    })
    expect(evaluateDrift(baseline, current).triggered).toBe(false)
    const tight = evaluateDrift(baseline, current, {
      ...DEFAULT_DRIFT_THRESHOLDS,
      costPerTurn: { rel: 0.05, direction: 'up' },
    })
    expect(tight.triggered).toBe(true)
    expect(tight.breaches.map(item => item.gauge)).toEqual(['costPerTurn'])
    expect(tight.items.find(item => item.gauge === 'costPerTurn')?.changeRate ?? 0).toBeGreaterThan(0.05)
  })

  it('指标一侧为 null(快照从未上报缓存桶)→ skipped-null,不参与判定', () => {
    const events: readonly SessionEventLike[] = [
      turnStart(1, 100, 1),
      requestHeader(2, 101, 'deepseek', 'deepseek-chat'),
      assistantUsage(3, 102, 1, 1, { inputTokens: 100, outputTokens: 50 }),
    ]
    const nullSnapshot: MetricsSnapshot = { label: 'n', at: 0, metrics: aggregateSessionMetrics(events) }
    expect(nullSnapshot.metrics.cacheHitRate).toBeNull()
    const report = evaluateDrift(nullSnapshot, nullSnapshot)
    const hit = report.items.find(item => item.gauge === 'cacheHitRate')
    expect(hit?.status).toBe('skipped-null')
    expect(hit?.breached).toBe(false)
    expect(report.triggered).toBe(false)
  })

  it('turns 相对变化(rel=0.4 默认,双向)超阈触发', () => {
    const current = snapshot('week-2026W44', 2_000_000, {
      inputPerTurn: 1000, cacheReadPerTurn: 9000, outputPerTurn: 2000, turns: 10,
    })
    const report = evaluateDrift(baseline, current)
    expect(report.breaches.map(item => item.gauge)).toEqual(['turns'])
    const turns = report.items.find(item => item.gauge === 'turns')
    expect(turns?.changeRate).toBeCloseTo(1.5, 6)
    expect(turns?.breached).toBe(true)
  })

  it('报告字段完整性:items 覆盖全部五指标,limit 透传,未覆盖项回落默认', () => {
    const report = evaluateDrift(baseline, baseline, { turns: { rel: 10 } })
    expect(report.items.map(item => item.gauge)).toEqual([...DRIFT_GAUGES])
    expect(report.items.find(item => item.gauge === 'turns')?.limit).toEqual({ rel: 10 })
    expect(report.items.find(item => item.gauge === 'costPerTurn')?.limit).toEqual(DEFAULT_DRIFT_THRESHOLDS.costPerTurn)
  })
})

describe('drift 信号生成与入队', () => {
  it('未触发 → driftSignal 返回 null', () => {
    expect(driftSignal(evaluateDrift(baseline, baseline), '@event/pack')).toBeNull()
  })

  it('触发 → kind=drift 信号,ref 指向快照对,tags 带 gauge;入队幂等', () => {
    const current = snapshot('week-2026W44', 2_000_000, {
      inputPerTurn: 9000, cacheReadPerTurn: 1000, outputPerTurn: 2000, turns: 4,
    })
    const report: DriftReport = evaluateDrift(baseline, current)
    const draft = driftSignal(report, '@event/pack', 3_000_000)
    expect(draft?.kind).toBe('drift')
    expect(draft?.ref).toBe('drift:week-2026W43->week-2026W44')
    expect(draft?.ts).toBe(3_000_000)
    expect(draft?.payload.tags).toContain('drift')
    expect(draft?.payload.tags).toContain('gauge:cacheHitRate')
    expect(draft?.payload.summary).toContain('cacheHitRate')
    expect(Array.isArray(draft?.payload['breaches'])).toBe(true)
    const store = new SignalStore(':memory:')
    const first = store.enqueue(draft!)
    const second = store.enqueue(draft!)
    expect(first.reason).toBe('enqueued')
    expect(second.reason).toBe('duplicate')
    expect(store.count({ kind: 'drift' })).toBe(1)
    store.close()
  })
})
