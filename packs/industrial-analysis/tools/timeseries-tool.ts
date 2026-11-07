/**
 * 时序查询工具(确定性桩;首场景① 时序查询 / 趋势与异常摘要的确定性核心)。
 * 样例数据写死在桩内(TDengine MCP 接入前的桩):真实接入只换数据源、不动接口;
 * 输出恒带 source: 'stub-sample' 声明 —— 样例不得冒充实测(persona 红线)。
 *
 * Cordis 纪律形态:
 * - 注册表 + 唯一 ID:@industrial-analysis/timeseries-tool(packctl lint CORD004 校验命名空间);
 * - 纯函数实现:无旁路全局、无裸定时器、无 Date.now(确定性,CORD001);
 * - 只读(R0 档):不做任何写入;达梦写权限仅限预警记录表(alert_records 单点白名单)。
 */

/** 唯一 ID(注册表键;@industrial-analysis/* 命名空间)。 */
export const TIMESERIES_TOOL_SERVICE_ID = '@industrial-analysis/timeseries-tool'

/** 时序点(ts 与窗口边界同格式:'YYYY-MM-DD HH:mm')。 */
export interface TsPoint {
  readonly ts: string
  readonly value: number
}

/** 测点台账条目(测点名不确定时先查台账,绝不臆造 tag)。 */
export interface TsTagMeta {
  readonly tag: string
  readonly asset: string
  readonly metric: string
  readonly unit: string
  readonly source: 'stub-sample'
}

/** 查询选项:start/end 形如 'YYYY-MM-DD' 或 'YYYY-MM-DD HH:mm'(含起止);threshold 为越限上限。 */
export interface TsQueryOptions {
  readonly start?: string
  readonly end?: string
  readonly threshold?: number
}

export interface TsQueryResult {
  readonly tag: string
  readonly asset: string
  readonly metric: string
  readonly unit: string
  readonly source: 'stub-sample'
  readonly window: { readonly start: string; readonly end: string }
  readonly count: number
  readonly points: readonly TsPoint[]
  readonly stats: {
    readonly min: number
    readonly max: number
    readonly avg: number
    readonly first: number
    readonly last: number
  }
  /** 趋势:direction = 首末差符号(峰谷另给,复杂形态由分析叙述,不脑补)。 */
  readonly trend: {
    readonly direction: 'up' | 'down' | 'flat'
    readonly delta: number
    readonly deltaRatio: number
    readonly peak: number
    readonly peakAt: string
    readonly trough: number
    readonly troughAt: string
  }
  /** threshold 给定时才有:越限(上限)时刻列表;低限类异常不在其中,须单独研判。 */
  readonly breaches?: { readonly threshold: number; readonly count: number; readonly moments: readonly string[] }
}

/** 可交换接口:任何提供同等 id 与能力的实现(真实 TDengine MCP)可整体替换本模块。 */
export interface IndustrialTimeseriesTool {
  readonly id: typeof TIMESERIES_TOOL_SERVICE_ID
  /** 测点台账(样例):查 tag 前先核对,绝不臆造测点名。 */
  listTags(): readonly TsTagMeta[]
  /** 时序查询:返回窗口内数据点、统计与趋势;tag 不存在 / 窗口非法 / start>end 抛错。 */
  query(tag: string, options?: TsQueryOptions): TsQueryResult
}

/** 样例数据日(写死,确定性)。 */
const SAMPLE_DAY = '2026-11-06'

/** 样例测点台账:小时粒度,24 点/测点。[时, 值]。 */
const SERIES: Readonly<Record<string, {
  readonly asset: string
  readonly metric: string
  readonly unit: string
  readonly points: readonly (readonly [string, number])[]
}>> = {
  'unit1.reactor.temp': {
    asset: 'unit1.reactor',
    metric: '1#反应釜温度',
    unit: '°C',
    points: [
      ['00:00', 178.2], ['01:00', 179.5], ['02:00', 181.0], ['03:00', 182.3],
      ['04:00', 183.8], ['05:00', 185.1], ['06:00', 186.6], ['07:00', 188.0],
      ['08:00', 189.4], ['09:00', 191.2], ['10:00', 193.5], ['11:00', 194.8],
      ['12:00', 195.6], ['13:00', 196.2], ['14:00', 195.1], ['15:00', 192.8],
      ['16:00', 190.4], ['17:00', 188.9], ['18:00', 187.2], ['19:00', 185.6],
      ['20:00', 184.1], ['21:00', 182.7], ['22:00', 181.3], ['23:00', 180.4],
    ],
  },
  'unit1.reactor.press': {
    asset: 'unit1.reactor',
    metric: '1#反应釜压力',
    unit: 'MPa',
    points: [
      ['00:00', 0.42], ['01:00', 0.43], ['02:00', 0.45], ['03:00', 0.46],
      ['04:00', 0.48], ['05:00', 0.49], ['06:00', 0.50], ['07:00', 0.52],
      ['08:00', 0.53], ['09:00', 0.55], ['10:00', 0.56], ['11:00', 0.57],
      ['12:00', 0.58], ['13:00', 0.61], ['14:00', 0.59], ['15:00', 0.56],
      ['16:00', 0.54], ['17:00', 0.52], ['18:00', 0.51], ['19:00', 0.49],
      ['20:00', 0.48], ['21:00', 0.47], ['22:00', 0.46], ['23:00', 0.45],
    ],
  },
  'line2.motor.vib': {
    asset: 'line2.motor',
    metric: '2#线电机轴承振动',
    unit: 'mm/s',
    points: [
      ['00:00', 2.4], ['01:00', 2.5], ['02:00', 2.4], ['03:00', 2.6],
      ['04:00', 2.5], ['05:00', 2.7], ['06:00', 2.6], ['07:00', 2.8],
      ['08:00', 2.9], ['09:00', 3.0], ['10:00', 3.1], ['11:00', 3.0],
      ['12:00', 3.2], ['13:00', 3.4], ['14:00', 3.6], ['15:00', 3.8],
      ['16:00', 4.8], ['17:00', 4.6], ['18:00', 4.1], ['19:00', 3.7],
      ['20:00', 3.4], ['21:00', 3.1], ['22:00', 2.9], ['23:00', 2.8],
    ],
  },
  'boiler1.steam.flow': {
    asset: 'boiler1',
    metric: '1#锅炉蒸汽流量',
    unit: 't/h',
    points: [
      ['00:00', 39.5], ['01:00', 39.8], ['02:00', 40.1], ['03:00', 40.3],
      ['04:00', 40.0], ['05:00', 39.6], ['06:00', 39.9], ['07:00', 40.2],
      ['08:00', 40.5], ['09:00', 40.8], ['10:00', 41.0], ['11:00', 40.9],
      ['12:00', 40.7], ['13:00', 40.2], ['14:00', 33.5], ['15:00', 38.9],
      ['16:00', 39.8], ['17:00', 40.2], ['18:00', 40.5], ['19:00', 40.3],
      ['20:00', 40.1], ['21:00', 39.9], ['22:00', 39.7], ['23:00', 39.6],
    ],
  },
}

const round2 = (x: number): number => Math.round(x * 100) / 100
const round4 = (x: number): number => Math.round(x * 10000) / 10000

/** 窗口边界归一:'YYYY-MM-DD' → 起点补 00:00 / 终点补 23:59;'T' 分隔统一为空格。 */
function normalizeBound(raw: string, kind: 'start' | 'end'): string {
  const s = raw.trim().replace('T', ' ')
  if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(s)) {
    throw new Error(`timeseries_query: 时间必须是 YYYY-MM-DD 或 YYYY-MM-DD HH:mm,收到: ${raw}`)
  }
  return s.length === 10 ? `${s} ${kind === 'start' ? '00:00' : '23:59'}` : s
}

export function createTimeseriesTool(): IndustrialTimeseriesTool {
  return {
    id: TIMESERIES_TOOL_SERVICE_ID,
    listTags() {
      return Object.entries(SERIES).map(([tag, meta]) => ({
        tag,
        asset: meta.asset,
        metric: meta.metric,
        unit: meta.unit,
        source: 'stub-sample' as const,
      }))
    },
    query(tag, options) {
      const series = SERIES[tag]
      if (series === undefined) {
        throw new Error(`timeseries_query: 测点不存在: ${tag}(查不到=明说,不编造;可用测点见 listTags)`)
      }
      const all: readonly TsPoint[] = series.points.map(([hh, value]) => ({ ts: `${SAMPLE_DAY} ${hh}`, value }))
      const start = options?.start === undefined ? all[0]!.ts : normalizeBound(options.start, 'start')
      const end = options?.end === undefined ? all[all.length - 1]!.ts : normalizeBound(options.end, 'end')
      if (start > end) throw new Error(`timeseries_query: start 晚于 end(${start} > ${end})`)
      const points = all.filter(point => point.ts >= start && point.ts <= end)
      if (points.length === 0) throw new Error(`timeseries_query: 窗口内无数据(${start} ~ ${end});明说无数据,不编造`)

      const values = points.map(point => point.value)
      const first = values[0]!
      const last = values[values.length - 1]!
      const delta = round2(last - first)
      const peak = points.reduce((a, b) => (b.value > a.value ? b : a))
      const trough = points.reduce((a, b) => (b.value < a.value ? b : a))
      const result: TsQueryResult = {
        tag,
        asset: series.asset,
        metric: series.metric,
        unit: series.unit,
        source: 'stub-sample',
        window: { start, end },
        count: points.length,
        points,
        stats: {
          min: round2(Math.min(...values)),
          max: round2(Math.max(...values)),
          avg: round2(values.reduce((sum, v) => sum + v, 0) / values.length),
          first,
          last,
        },
        trend: {
          direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
          delta,
          deltaRatio: round4(first === 0 ? 0 : (last - first) / first),
          peak: peak.value,
          peakAt: peak.ts,
          trough: trough.value,
          troughAt: trough.ts,
        },
      }
      const threshold = options?.threshold
      if (threshold !== undefined) {
        if (!Number.isFinite(threshold)) throw new Error('timeseries_query: threshold 必须是数字(来自规则库 RULE-*,不自行发明限值)')
        const moments = points.filter(point => point.value > threshold).map(point => point.ts)
        result.breaches = { threshold, count: moments.length, moments }
      }
      return result
    },
  }
}
