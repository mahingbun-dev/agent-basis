/**
 * 命中率指标输出接口:事件字段提取器注册表(唯一 ID → 提取器)+ 命中率报表
 * + @basis/observe 指标聚合器桥接。
 *
 * 口径(与 @basis/observe metrics.ts 完全同源同式,可互证):
 * - 缓存命中率 = cacheReadTokens / (inputTokens + cacheReadTokens + cacheWriteTokens)
 *   (observe metrics.ts:206-207;分母 = 全部 prompt token,互斥四桶口径见
 *   dsh-repo llm/src/types.ts:182-196);
 * - usage 骑在 assistant/message 事件上(session/src/types.ts:338-350;assistant/attempt 不带不计);
 * - 路由归属锚点:request/header(header.config,types.ts:395-403)→ request/context
 *   (types.ts:405-413),两者皆未出现时归 unknown/unknown(observe 同约定);
 * - 从未上报缓存桶(cacheRead/cacheWrite 皆缺)→ hitRate = null(未知,不伪报 0)。
 *
 * tests/hitrate.spec.ts 在相同事件流上断言:本包报表与 observe
 * aggregateSessionMetrics().cacheHitRate 逐位相等(对接验收门)。
 */
import type { SessionMetrics } from '@basis/observe'
import type {
  CacheHitRateReport, CacheUsageSample, EventFieldExtractor, EventFieldExtractorId,
  RouteCacheHitRate, RouteRefLike, SessionEventLike, TokenUsageLike,
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

/**
 * 事件字段提取器注册表(唯一 ID → 提取器;可交换接口面)。
 * 新提取器 = 新 ID 加进来,消费方按 ID 取用——不改任何既有签名。
 */
export const EVENT_FIELD_EXTRACTORS: Readonly<Record<EventFieldExtractorId, EventFieldExtractor<unknown>>> = {
  'cache-usage': extractCacheUsage,
  'request-route': extractRequestRoute,
}

/** 注册表全部 ID(出现序;供消费方遍历/校验)。 */
export const EVENT_FIELD_EXTRACTOR_IDS: readonly EventFieldExtractorId[] = ['cache-usage', 'request-route']

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

/** 样本序列 → 命中率报表(纯函数;总口径与 byRoute 同式)。 */
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

/** 事件流 → 命中率报表(提取器管线两步组合的便捷门)。 */
export function cacheHitRateFromEvents(events: readonly SessionEventLike[]): CacheHitRateReport {
  return cacheHitRateReport(collectCacheUsage(events))
}

/**
 * 桥接 @basis/observe 指标聚合器:aggregateSessionMetrics 产物 → 本包报表形态。
 * hitRate 直接取 observe 口径值(同公式,互证由测试钉住);byRoute 由路由明细重组。
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
