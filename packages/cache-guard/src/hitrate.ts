/**
 * 命中率指标输出接口:事件字段提取器注册表(唯一 ID → 提取器)+ 命中率报表
 * + @eterna/observe 指标聚合器桥接。
 *
 * 口径(与 @eterna/observe metrics.ts 完全同源同式,可互证):
 * - 缓存命中率 = cacheReadTokens / (inputTokens + cacheReadTokens + cacheWriteTokens)
 *   (observe metrics.ts:206-207;分母 = 全部 prompt token,互斥四桶口径见
 *   deepseek-harness llm/src/types.ts:182-196);
 * - usage 骑在 assistant/message 事件上(session/src/types.ts:338-350;assistant/attempt 不带不计);
 * - 路由归属锚点:request/header(header.config,types.ts:395-403)→ request/context
 *   (types.ts:405-413),两者皆未出现时归 unknown/unknown(observe 同约定);
 * - 从未上报缓存桶(cacheRead/cacheWrite 皆缺)→ hitRate = null(未知,不伪报 0);
 * - 压缩事件打标(53 号 D6,收口 28 号 §7-2):提取器 `compaction-event` 把
 *   compaction/start|end(载荷形态见 types.ts CompactionEventMarker 注释)纳入
 *   命中率报表的 compaction 打标块,命中率下降可区分「压缩导致」vs「前缀污染」。
 *
 * tests/hitrate.spec.ts 在相同事件流上断言:本包报表与 observe
 * aggregateSessionMetrics().cacheHitRate 逐位相等(对接验收门)。
 */
import type { SessionMetrics } from '@eterna/observe'
import type {
  CacheHitRateReport, CacheUsageSample, CompactionEventMarker, CompactionEventStats,
  EventFieldExtractor, EventFieldExtractorId, RouteCacheHitRate, RouteRefLike, SessionEventLike,
  TokenUsageLike,
} from './types.ts'
import { isRecord } from './types.ts'

/** assistant/message 事件携带的原始 usage 字段(路由未锚定,单事件即可提取)。 */
export interface UsageEventFields {
  readonly turn?: number
  readonly step?: number
  readonly usage: TokenUsageLike
}

const UNKNOWN_ROUTE: RouteRefLike = { provider: 'unknown', model: 'unknown' }

function readNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** dsh TokenUsage 的防御性读取(窄于官方类型;坏数据不计而非崩;input/output 必需)。 */
function readUsage(value: unknown): TokenUsageLike | undefined {
  if (!isRecord(value)) return undefined
  const inputTokens = readNonNegative(value['inputTokens'])
  const outputTokens = readNonNegative(value['outputTokens'])
  if (inputTokens === undefined || outputTokens === undefined) return undefined
  const totalTokens = readNonNegative(value['totalTokens'])
  const cacheReadTokens = readNonNegative(value['cacheReadTokens'])
  const cacheWriteTokens = readNonNegative(value['cacheWriteTokens'])
  const reasoningTokens = readNonNegative(value['reasoningTokens'])
  return {
    inputTokens,
    outputTokens,
    ...(totalTokens !== undefined && { totalTokens }),
    ...(cacheReadTokens !== undefined && { cacheReadTokens }),
    ...(cacheWriteTokens !== undefined && { cacheWriteTokens }),
    ...(reasoningTokens !== undefined && { reasoningTokens }),
  }
}

/**
 * 提取器 `cache-usage`:assistant/message 事件 → usage 字段(不带 usage 返回 null;
 * 不含路由——路由锚定需要事件流上下文,由 collectCacheUsage 完成)。
 */
export const extractCacheUsage: EventFieldExtractor<UsageEventFields> = (event) => {
  if (event.type !== 'assistant/message' || !isRecord(event.data)) return null
  const usage = readUsage(event.data['usage'])
  if (usage === undefined) return null
  const turn = readNonNegative(event.data['turn'])
  const step = readNonNegative(event.data['step'])
  return {
    ...(turn !== undefined && { turn }),
    ...(step !== undefined && { step }),
    usage,
  }
}

function readRoute(record: Record<string, unknown>): RouteRefLike | undefined {
  const provider = record['provider']
  const model = record['model']
  if (typeof provider !== 'string' || provider.length === 0) return undefined
  if (typeof model !== 'string' || model.length === 0) return undefined
  return { provider, model }
}

/**
 * 提取器 `request-route`:request/header(读 header.config)或 request/context
 * (读顶层 provider/model)→ 路由;其余事件返回 null。
 */
export const extractRequestRoute: EventFieldExtractor<RouteRefLike> = (event) => {
  if (!isRecord(event.data)) return null
  if (event.type === 'request/header') {
    const header = event.data['header']
    if (!isRecord(header)) return null
    const config = header['config']
    if (!isRecord(config)) return null
    return readRoute(config) ?? null
  }
  if (event.type === 'request/context') {
    return readRoute(event.data) ?? null
  }
  return null
}

/** compaction 载荷 turn 字段的防御性读取(官方类型 turn: number|null,dsh-compaction types.ts:24)。 */
function readCompactionTurn(value: unknown): number | null | undefined {
  if (value === null) return null
  return readNonNegative(value)
}

/**
 * 提取器 `compaction-event`:compaction/start|end 事件 → 压缩事务标记
 * (53 号 D6 压缩事件打标;28 号 §7-2:命中率下降可区分「压缩导致」vs「前缀污染」)。
 * 载荷防御性读取(坏数据缺省而非崩):compactionId/turn/error 逐字段窄判,
 * seq/time 透传(事件流锚点,供命中率下降窗口对齐);其余事件返回 null。
 */
export const extractCompactionEvent: EventFieldExtractor<CompactionEventMarker> = (event) => {
  if (event.type !== 'compaction/start' && event.type !== 'compaction/end') return null
  if (!isRecord(event.data)) return null
  const phase: 'start' | 'end' = event.type === 'compaction/start' ? 'start' : 'end'
  const compactionId = event.data['compactionId']
  const turn = readCompactionTurn(event.data['turn'])
  const error = event.data['error']
  return {
    phase,
    ...(typeof compactionId === 'string' && { compactionId }),
    ...(turn !== undefined && { turn }),
    ...(phase === 'end' && typeof error === 'string' && { error }),
    ...(event.seq !== undefined && { seq: event.seq }),
    ...(event.time !== undefined && { time: event.time }),
  }
}

/**
 * 事件字段提取器注册表(唯一 ID → 提取器;可交换接口面)。
 * 新提取器 = 新 ID 加进来,消费方按 ID 取用——不改任何既有签名。
 */
export const EVENT_FIELD_EXTRACTORS: Readonly<Record<EventFieldExtractorId, EventFieldExtractor<unknown>>> = {
  'cache-usage': extractCacheUsage,
  'request-route': extractRequestRoute,
  'compaction-event': extractCompactionEvent,
}

/** 注册表全部 ID(出现序;供消费方遍历/校验)。 */
export const EVENT_FIELD_EXTRACTOR_IDS: readonly EventFieldExtractorId[] = [
  'cache-usage',
  'request-route',
  'compaction-event',
]

/**
 * 走一遍事件流:锚定当前路由(request/header → request/context,observe 同约定),
 * 产出带路由归属的缓存用量样本序列(数组序即时间序)。
 */
export function collectCacheUsage(events: readonly SessionEventLike[]): CacheUsageSample[] {
  const samples: CacheUsageSample[] = []
  let currentRoute: RouteRefLike = UNKNOWN_ROUTE
  for (const event of events) {
    const route = extractRequestRoute(event)
    if (route !== null) {
      currentRoute = route
      continue
    }
    const fields = extractCacheUsage(event)
    if (fields !== null) {
      samples.push({
        ...(fields.turn !== undefined && { turn: fields.turn }),
        ...(fields.step !== undefined && { step: fields.step }),
        route: currentRoute,
        usage: fields.usage,
      })
    }
  }
  return samples
}

interface RouteAccumulator extends RouteRefLike {
  calls: number
  promptTokens: number
  cacheReadTokens: number
  cacheReportedCalls: number
}

function promptTokensOf(usage: TokenUsageLike): number {
  return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}

function hitRateOf(cacheReportedCalls: number, promptTokens: number, cacheRead: number): number | null {
  return cacheReportedCalls > 0 && promptTokens > 0 ? cacheRead / promptTokens : null
}

/**
 * 样本序列 → 命中率报表(纯函数;总口径与 byRoute 同式)。
 * 样本路径不带事件流 → compaction 打标块缺省(压缩面貌未知,不作 0 计解读)。
 */
export function cacheHitRateReport(samples: readonly CacheUsageSample[]): CacheHitRateReport {
  const routes = new Map<string, RouteAccumulator>()
  let calls = 0
  let promptTokens = 0
  let cacheReadTokens = 0
  let cacheReportedCalls = 0
  for (const sample of samples) {
    const key = `${sample.route.provider}/${sample.route.model}`
    let bucket = routes.get(key)
    if (bucket === undefined) {
      bucket = {
        provider: sample.route.provider,
        model: sample.route.model,
        calls: 0,
        promptTokens: 0,
        cacheReadTokens: 0,
        cacheReportedCalls: 0,
      }
      routes.set(key, bucket)
    }
    bucket.calls += 1
    bucket.promptTokens += promptTokensOf(sample.usage)
    bucket.cacheReadTokens += sample.usage.cacheReadTokens ?? 0
    if (sample.usage.cacheReadTokens !== undefined || sample.usage.cacheWriteTokens !== undefined) {
      bucket.cacheReportedCalls += 1
      cacheReportedCalls += 1
    }
    calls += 1
    promptTokens += promptTokensOf(sample.usage)
    cacheReadTokens += sample.usage.cacheReadTokens ?? 0
  }
  const byRoute: RouteCacheHitRate[] = []
  for (const bucket of routes.values()) {
    byRoute.push({
      route: { provider: bucket.provider, model: bucket.model },
      calls: bucket.calls,
      promptTokens: bucket.promptTokens,
      cacheReadTokens: bucket.cacheReadTokens,
      hitRate: hitRateOf(bucket.cacheReportedCalls, bucket.promptTokens, bucket.cacheReadTokens),
    })
  }
  return {
    calls,
    promptTokens,
    cacheReadTokens,
    hitRate: hitRateOf(cacheReportedCalls, promptTokens, cacheReadTokens),
    byRoute,
  }
}

/**
 * 事件流 → 压缩事件统计(提取器 `compaction-event` 逐事件收集,出现序)。
 * 事件流中真实无压缩事件 → 全零统计(事实为零,非未知——与样本路径的缺省区分)。
 */
function compactionStatsFromEvents(events: readonly SessionEventLike[]): CompactionEventStats {
  let starts = 0
  let ends = 0
  let errors = 0
  const markers: CompactionEventMarker[] = []
  for (const event of events) {
    const marker = extractCompactionEvent(event)
    if (marker === null) continue
    markers.push(marker)
    if (marker.phase === 'start') {
      starts += 1
    } else {
      ends += 1
      if (marker.error !== undefined) errors += 1
    }
  }
  return { starts, ends, errors, markers }
}

/**
 * 事件流 → 命中率报表(提取器管线组合的便捷门,附压缩事件打标块)。
 * 压缩打标与命中率同源事件流:报告窗口内的 start/end/error 计数与标记锚点
 * (seq/time)供消费方把命中率下降归因为「压缩导致」(窗口含压缩标记)或
 * 「前缀污染」(无压缩标记而稳定性告警为 volatile-*,28 号 §7-2)。
 */
export function cacheHitRateFromEvents(events: readonly SessionEventLike[]): CacheHitRateReport {
  return {
    ...cacheHitRateReport(collectCacheUsage(events)),
    compaction: compactionStatsFromEvents(events),
  }
}

/**
 * 桥接 @eterna/observe 指标聚合器:aggregateSessionMetrics 产物 → 本包报表形态。
 * hitRate 直接取 observe 口径值(同公式,互证由测试钉住);byRoute 由路由明细重组。
 * observe 的 SessionMetrics 不感知压缩事件 → compaction 打标块缺省(未知)。
 */
export function hitRateFromSessionMetrics(metrics: SessionMetrics): CacheHitRateReport {
  const byRoute: RouteCacheHitRate[] = metrics.routes.map((route) => {
    const promptTokens = route.tokens.input + route.tokens.cacheRead + route.tokens.cacheWrite
    // observe 的 RouteMetrics 未暴露「该路由是否上报过缓存桶」;calls>0 且有缓存桶读数才可算,
    // 否则 null——与 observe 总口径的未知语义一致(不伪报 0)。
    const cacheReported = route.tokens.cacheRead > 0 || route.tokens.cacheWrite > 0
    return {
      route: { provider: route.provider, model: route.model },
      calls: route.calls,
      promptTokens,
      cacheReadTokens: route.tokens.cacheRead,
      hitRate: cacheReported && promptTokens > 0 ? route.tokens.cacheRead / promptTokens : null,
    }
  })
  return {
    calls: metrics.modelCalls,
    promptTokens: metrics.tokens.input + metrics.tokens.cacheRead + metrics.tokens.cacheWrite,
    cacheReadTokens: metrics.tokens.cacheRead,
    hitRate: metrics.cacheHitRate,
    byRoute,
  }
}
