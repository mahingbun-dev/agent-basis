/**
 * 漂移快照对比:两份指标快照 diff 出超阈值项(设计 09 §4 趋势层:
 * 「指标漂移先于用户感知——通过率、成本、缓存命中率、千 turn 打断率」;10 §2 采集点:
 * 「漂移(observe 指标快照 diff)」)。
 *
 * 纯函数:evaluateDrift(baseline, current, thresholds) → DriftReport;
 * 超阈值(triggered)可经 driftSignal() 转为 kind='drift' 信号入队(ref 指向快照对,
 * 对齐 10 §2 ref 语义「指向……指标快照」)。
 *
 * 对比口径:快照是窗口聚合(如周窗口),总量随窗口内会话数波动,直接比总量会误报;
 * 默认比较**归一化指标**(metrics.perTurn):costPerTurn / billedTokensPerTurn /
 * errorTurnRate + cacheHitRate(比率本身已归一)+ turns(窗口轮数,仅绝对阈值有意义)。
 *
 * 阈值语义:每指标 { rel, abs?, direction? } ——
 * - rel:相对基线变化率(|Δ|/baseline),要求 baseline>0;baseline=0 时仅 abs 判定(不猜除零);
 * - abs:绝对差(|Δ|);cacheHitRate 这类比率指标建议只给 abs;
 * - direction:'both'(默认)| 'up'(只有恶化方向才算漂移,如成本↑)| 'down'(如命中率↓)。
 * 任一侧取值为 null(如两侧都没报缓存)→ 该指标 skipped,不参与判定。
 */
import type { SessionMetrics } from './metrics.ts'
import type { SignalInput } from './types.ts'

/** 一份带时间戳与标签的指标快照(observe 周期产物;快照可持久化,ref 用 label/at 定位)。 */
export interface MetricsSnapshot {
  /** 快照标签(如 'week-2026W44'),进 drift 信号 ref。 */
  readonly label: string
  /** 快照时间(Unix 毫秒)。 */
  readonly at: number
  readonly metrics: SessionMetrics
}

/** 参与漂移判定的归一化指标集。 */
export const DRIFT_GAUGES = ['costPerTurn', 'billedTokensPerTurn', 'cacheHitRate', 'errorTurnRate', 'turns'] as const

export type DriftGauge = (typeof DRIFT_GAUGES)[number]

/** 单指标阈值。 */
export interface DriftLimit {
  /** 相对阈值:|Δ|/baseline 超过才触发(0 < rel;baseline<=0 时该维度不判定)。 */
  readonly rel?: number
  /** 绝对阈值:|Δ| 超过才触发。 */
  readonly abs?: number
  /** 触发方向:both(默认)= 双向;up=仅恶化方向;down=仅改善方向也算漂移(如命中率骤升=行为突变)。 */
  readonly direction?: 'both' | 'up' | 'down'
}

export type DriftThresholds = Readonly<Partial<Record<DriftGauge, DriftLimit>>>

/** 默认阈值:成本/ token 每轮 +25% 或绝对差,命中率 ±10pct 双向,错误率 +50% 或 +0.1,轮数 ±40%。 */
export const DEFAULT_DRIFT_THRESHOLDS: DriftThresholds = {
  costPerTurn: { rel: 0.25, direction: 'up' },
  billedTokensPerTurn: { rel: 0.25, direction: 'up' },
  cacheHitRate: { abs: 0.1, direction: 'both' },
  errorTurnRate: { rel: 0.5, abs: 0.1, direction: 'up' },
  turns: { rel: 0.4, direction: 'both' },
}

/** 单指标对比结果。 */
export interface DriftItem {
  readonly gauge: DriftGauge
  readonly baseline: number
  readonly current: number
  /** current - baseline。 */
  readonly delta: number
  /** |Δ|/baseline;baseline<=0 时为 null(不猜除零)。 */
  readonly changeRate: number | null
  readonly direction: 'up' | 'down' | 'flat'
  /** 'compared' 正常对比;'skipped-null' 任一侧指标缺失(如缓存未报告)。 */
  readonly status: 'compared' | 'skipped-null'
  /** 是否超过阈值(status='skipped-null' 恒 false)。 */
  readonly breached: boolean
  /** 判定用的阈值(合并默认;skipped 时 undefined)。 */
  readonly limit?: DriftLimit
}

/** 漂移报告。 */
export interface DriftReport {
  readonly baseline: { readonly label: string; readonly at: number }
  readonly current: { readonly label: string; readonly at: number }
  /** 全部参与对比的指标(skipped 项含在内,报告可读)。 */
  readonly items: readonly DriftItem[]
  /** 仅超阈值项(触发项)。 */
  readonly breaches: readonly DriftItem[]
  /** breaches 非空即 true。 */
  readonly triggered: boolean
}

/** 从快照取一个指标值(null 表示该快照未产生该指标,如无缓存数据/零轮)。 */
function gaugeValue(metrics: SessionMetrics, gauge: DriftGauge): number | null {
  switch (gauge) {
    case 'costPerTurn':
      return metrics.perTurn.costPerTurn
    case 'billedTokensPerTurn':
      return metrics.perTurn.billedTokensPerTurn
    case 'cacheHitRate':
      return metrics.cacheHitRate
    case 'errorTurnRate':
      return metrics.perTurn.errorTurnRate
    case 'turns':
      return metrics.turns
  }
}

/**
 * 对比两份快照(纯函数)。thresholds 未覆盖的指标用 DEFAULT_DRIFT_THRESHOLDS 补全;
 * 显式传 { gauge: undefined } 不可(Record 语义),要禁用一指标请给超大阈值或在 thresholds 里不给且用全量自定义。
 */
export function evaluateDrift(
  baseline: MetricsSnapshot,
  current: MetricsSnapshot,
  thresholds: DriftThresholds = DEFAULT_DRIFT_THRESHOLDS,
): DriftReport {
  const items: DriftItem[] = []
  for (const gauge of DRIFT_GAUGES) {
    const limit = thresholds[gauge] ?? DEFAULT_DRIFT_THRESHOLDS[gauge]
    const base = gaugeValue(baseline.metrics, gauge)
    const curr = gaugeValue(current.metrics, gauge)
    if (base === null || curr === null) {
      items.push({
        gauge,
        baseline: base ?? 0,
        current: curr ?? 0,
        delta: 0,
        changeRate: null,
        direction: 'flat',
        status: 'skipped-null',
        breached: false,
      })
      continue
    }
    const delta = curr - base
    const direction: DriftItem['direction'] = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
    const changeRate = base > 0 ? Math.abs(delta) / base : null
    const limitOrDefault: DriftLimit = limit ?? {}
    const relBreach = limitOrDefault.rel !== undefined && changeRate !== null && changeRate > limitOrDefault.rel
    const absBreach = limitOrDefault.abs !== undefined && Math.abs(delta) > limitOrDefault.abs
    const wanted = limitOrDefault.direction ?? 'both'
    const directionOk = wanted === 'both' || direction === wanted || direction === 'flat'
    items.push({
      gauge,
      baseline: base,
      current: curr,
      delta,
      changeRate,
      direction,
      status: 'compared',
      breached: (relBreach || absBreach) && directionOk,
      limit: limitOrDefault,
    })
  }
  const breaches = items.filter(item => item.breached)
  return {
    baseline: { label: baseline.label, at: baseline.at },
    current: { label: current.label, at: current.at },
    items,
    breaches,
    triggered: breaches.length > 0,
  }
}

/** drift 信号草稿(不入队;ref 指向快照对,对齐 10 §2「ref 指向……指标快照」)。 */
export function driftSignal(report: DriftReport, packId: string, ts?: number): SignalInput | null {
  if (!report.triggered) return null
  const parts = report.breaches.map(item => `${item.gauge}:${item.baseline.toFixed(4)}→${item.current.toFixed(4)}`)
  return {
    ...(ts !== undefined && { ts }),
    packId,
    kind: 'drift',
    ref: `drift:${report.baseline.label}->${report.current.label}`,
    payload: {
      summary: `指标漂移(${report.breaches.length} 项超阈值):${parts.join('; ')}`,
      tags: ['drift', ...report.breaches.map(item => `gauge:${item.gauge}`)],
      baselineAt: report.baseline.at,
      currentAt: report.current.at,
      breaches: report.breaches.map(item => ({
        gauge: item.gauge,
        baseline: item.baseline,
        current: item.current,
        delta: item.delta,
        changeRate: item.changeRate,
        limit: item.limit,
      })),
    },
  }
}
