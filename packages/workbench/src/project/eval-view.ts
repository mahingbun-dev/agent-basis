/**
 * 评测监控投影(38 号 T11:金集通过率趋势/路由金集衰减/漂移检测;28 号 §5
 * 衰减阈值 2pp;26 号 §4.1 金集即验收、不另建第二套指标)。
 *
 * 图表几何 = 原型 03 视图四两张 SVG 静态稿的坐标系(viewBox 520×250,绘图区
 * x∈[80,470] 映射到 [50,500] 轴系):趋势 y = 200-(v-80)×9(v 为百分数),
 * 衰减 y = 200-pp×72;点/网格线/达标线坐标由数据计算,mock 初始数据下与原型
 * 逐值一致(测试钉死)。
 */
import type { EvalSnapshot } from '../types.ts'

const PLOT_LEFT = 80
const PLOT_RIGHT = 470

/** x 均匀铺点(整像素);y 坐标一律保留 1 位小数(原型 SVG 精度)。 */
const xAt = (index: number, count: number): number =>
  count <= 1 ? PLOT_LEFT : Math.round(PLOT_LEFT + index * ((PLOT_RIGHT - PLOT_LEFT) / (count - 1)))

const fixed1 = (value: number): string => value.toFixed(1)

const y1 = (raw: number): number => Math.round(raw * 10) / 10

export interface ChartPoint {
  readonly index: number
  readonly x: number
  readonly y: number
  readonly value: number
  /** 低于达标线/超阈值的点(原型 pt-warn,半径加大)。 */
  readonly warn: boolean
}

export interface ChartGridLine {
  readonly y: number
  readonly label: string
}

export interface LineChartView {
  readonly title: string
  readonly desc: string
  readonly points: readonly ChartPoint[]
  readonly grid: readonly ChartGridLine[]
  /** 达标线/阈值线(虚线 + 标注,原型 .gate)。 */
  readonly gate: { readonly y: number; readonly label: string }
  readonly xFirstLabel: string
  readonly xLastLabel: string
  readonly yLabel: string
  readonly note: string
}

/** 金集通过率趋势(近 N 次跑批;达标线 90%,dsh-evals 回归门)。无 run 数据
 * (M4 实接初值,dsh-evals-out 目录为空)时给如实空态,不伪报序列。 */
export function trendChart(evalSnap: EvalSnapshot, gateValue = 90): LineChartView {
  const series = evalSnap.trend
  const count = series.length
  if (count === 0) {
    return {
      title: '金集通过率趋势（暂无 run 数据）',
      desc: `dsh-evals 结果目录尚无 run 报告；跑批后此处呈现近 N 次通过率序列，达标线 ${gateValue}%（dsh-evals 回归门）。`,
      points: [],
      grid: [80, 85, 90, 95, 100].map(value => ({ y: y1(200 - (value - 80) * 9), label: String(value) })),
      gate: { y: y1(200 - (gateValue - 80) * 9), label: `达标线 ${gateValue}%` },
      xFirstLabel: '第 1 次',
      xLastLabel: '—',
      yLabel: '通过率 %',
      note: '暂无 run 数据（dsh-evals 回归门在跑批后生效）。',
    }
  }
  const yAt = (value: number): number => y1(200 - (value - 80) * 9)
  const points: ChartPoint[] = series.map((value, index) => ({
    index,
    x: xAt(index, count),
    y: yAt(value),
    value,
    warn: value < gateValue,
  }))
  const below = points.filter(point => point.warn)
  const belowList = below.map(point => `第 ${point.index + 1} 次 ${fixed1(point.value)}%`)
  const only = below.length === 1 ? belowList[0] : undefined
  const belowClause = below.length === 0
    ? '全部达标。'
    : only !== undefined
      ? `${only} 低于达标线，其余均达标。`
      : `${belowList.join('、')} 低于达标线，其余均达标。`
  const note = below.length === 0
    ? '全部跑批达标（dsh-evals 回归门）。'
    : `${belowList.join('；')} 触发达标线复核（dsh-evals 回归门）。`
  return {
    title: `金集通过率趋势（近 ${count} 次跑批）`,
    desc: `近 ${count} 次跑批通过率依次为 ${series.map(fixed1).join('、')}；达标线 ${gateValue}%。${belowClause}`,
    points,
    grid: [80, 85, 90, 95, 100].map(value => ({ y: yAt(value), label: String(value) })),
    gate: { y: yAt(gateValue), label: `达标线 ${gateValue}%` },
    xFirstLabel: '第 1 次',
    xLastLabel: `第 ${count} 次`,
    yLabel: '通过率 %',
    note,
  }
}

/** 路由金集衰减曲线(压缩前后通过率差;阈值 2pp,28 号 §5)。空序列(M4 实接
 * 初值:G2-A9 两次 run 的 report 未产出)给如实空态,不伪报衰减读数。 */
export function decayChart(evalSnap: EvalSnapshot): LineChartView {
  const series = evalSnap.decaySeries
  const count = series.length
  const threshold = evalSnap.decayThresholdPp
  if (count === 0) {
    return {
      title: '路由金集衰减曲线（暂无两次 run）',
      desc: `路由金集压缩前后各跑一遍（G2-A9）尚未产出 run 对；产出后此处呈现会话深度 1 至 N 的衰减序列，阈值 ${threshold} 个百分点（28 §5）。`,
      points: [],
      grid: [0, 1, 2].map(pp => ({ y: y1(200 - pp * 72), label: String(pp) })),
      gate: { y: y1(200 - threshold * 72), label: `阈值 ${threshold}pp（28 §5）` },
      xFirstLabel: '深度 1',
      xLastLabel: '—',
      yLabel: '衰减 pp',
      note: '暂无两次 run（G2-A9 路由金集在建）；衰减超标调摘要档位，不靠 prompt 硬扛（28 §5）。',
    }
  }
  const yAt = (pp: number): number => y1(200 - pp * 72)
  const points: ChartPoint[] = series.map((value, index) => ({
    index,
    x: xAt(index, count),
    y: yAt(value),
    value,
    warn: value > threshold,
  }))
  const over = points.filter(point => point.warn)
  const overClause = over.length === 0
    ? '全程未超标。'
    : `${over.map(point => `深度 ${point.index + 1}`).join('、')} 超过阈值。`
  return {
    title: '路由金集衰减曲线（压缩前后通过率差）',
    desc: `会话深度 1 至 ${count} 的衰减依次为 ${series.map(fixed1).join('、')} 个百分点；阈值 ${threshold} 个百分点，${overClause}`,
    points,
    grid: [0, 1, 2].map(pp => ({ y: yAt(pp), label: String(pp) })),
    gate: { y: yAt(threshold), label: `阈值 ${threshold}pp（28 §5）` },
    xFirstLabel: '深度 1',
    xLastLabel: `深度 ${count}`,
    yLabel: '衰减 pp',
    note: '压缩前后各跑一遍路由金集；衰减超标调摘要档位，不靠 prompt 硬扛（28 §5）。',
  }
}

/** 四指标卡(原型 03 视图四 metrics-4 逐字;值随快照数据驱动)。 */
/**
 * 比例投影：0–1 夹紧并保留四位小数。
 * 不取整会让 SVG 环长出现 0.9279999999999999 这类浮点尾巴,实测抖动亚像素。
 */
function ratioOf(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 1
  return Math.round(Math.min(1, Math.max(0, value / total)) * 10000) / 10000
}

export interface MetricCard {
  readonly label: string
  readonly value: string
  readonly sub: string
  readonly badge?: string
  /**
   * v4 §8:有比例语义的指标用「玉环 + 数字」表达（0–1）。
   * 无数值或非比例的卡片省缺，只呈数字。
   */
  readonly ratio?: number
  /** 玉环色调；阈内 = jade，越阈 = warn/danger。 */
  readonly ratioTone?: 'accent' | 'jade' | 'warn' | 'danger'
}

export function evalMetricCards(evalSnap: EvalSnapshot): readonly MetricCard[] {
  const latest = evalSnap.trend[evalSnap.trend.length - 1] ?? 0
  const delta = evalSnap.passDelta
  const deltaText = `${delta >= 0 ? '+' : ''}${fixed1(delta)}pp`
  const decayLatest = evalSnap.decayLatestPp
  const decayOk = decayLatest <= evalSnap.decayThresholdPp && evalSnap.decaySeries.length > 0
  const trendEmpty = evalSnap.trend.length === 0
  return [
    {
      label: '金集通过率 · 最近跑批',
      ...(trendEmpty
        ? { value: '暂无', sub: 'dsh-evals 结果目录尚无 run 报告' }
        : {
          value: `${fixed1(latest)}%`,
          sub: `环比 ${deltaText} · 金集 ${evalSnap.suiteSize} 条`,
          ratio: ratioOf(latest, 100),
          ratioTone: 'jade',
        }),
    },
    {
      label: '路由金集衰减',
      ...(evalSnap.decaySeries.length === 0
        ? { value: '暂无', sub: '两次 run（G2-A9）未产出 · 阈值 ≤ 2pp' }
        : {
          value: `${fixed1(decayLatest)}pp`,
          sub: `会话深度 ${evalSnap.decaySeries.length} · 阈值 ≤ ${evalSnap.decayThresholdPp}pp`,
          ...(decayOk ? { badge: '达标' } : {}),
          /* 衰减是"越小越好":用阈值吃满环,越阈才染色 */
          ratio: ratioOf(decayLatest, evalSnap.decayThresholdPp),
          ratioTone: decayOk ? 'jade' : 'warn',
        }),
    },
    {
      label: '漂移检测（observe）',
      value: evalSnap.drift.label,
      sub: evalSnap.drift.label !== '无警报'
        ? `最近警报距今 ${evalSnap.drift.days} 天`
        : evalSnap.drift.days > 0
          ? `连续 ${evalSnap.drift.days} 天无漂移`
          : '信号库无漂移记录（observe 快照接线后计入观察窗）',
    },
    {
      label: '本周回归跑批',
      value: `${evalSnap.weeklyRuns} 次`,
      sub: 'prompt 版本绑定请求（24 §7.6）',
    },
  ]
}
