/**
 * @eterna/cache-guard —— L1 缓存守护插件(KV-cache 前缀稳定守护 + 命中率指标输出)。
 *
 * 承载依据:设计文档 12 §1.5「KV-cache 前缀稳定守护 → B 插件(cache-guard)」与
 * §6.4「缓存命中率报表(与 1.5 合并实现)」;设计 08 §3 插件 9
 * 「前缀稳定性守护(启动/运行时告警破坏 KV-cache 的行为)+ 命中率采集,
 * 挂 request/header 事件、llm seam」。
 *
 * 五个模块:
 * 1. 易变模式库(volatile.ts):时间戳(epoch 秒/毫秒、ISO、纯日期、中文日期、时分)/
 *    随机 ID(uuid、hex token、base62 token)模式注册表 + 变动归因分类器(归一化精确归因);
 * 2. 前缀对齐(prefix.ts):连续两轮 prompt 组装的段级对齐——共同前缀、失稳定位、
 *    段内改写/截短/非末段增长/段序变动/尾部截断等明细;
 * 3. 稳定性检查(stability.ts):连续多轮序列 → 告警列表 + 稳定性评分
 *    (score = Σ共同前缀字符/Σ上轮字符,对失稳严格单调递减);
 * 4. 命中率输出(hitrate.ts):事件字段提取器注册表(cache-usage/request-route 唯一 ID)
 *    + 与 @eterna/observe aggregateSessionMetrics 同口径的 cacheRead/(input+cacheRead+cacheWrite)
 *    报表与桥接;
 * 5. 组合门(本文件):CACHE_GUARD_SERVICE_ID 唯一 ID 服务面 + 增量追踪(track/reset 配逆)。
 *
 * Cordis 纪律:纯函数层零副作用、无旁路全局;组合门把全部能力以
 * `ctx.cacheGuard` 服务(注册表 + CACHE_GUARD_SERVICE_ID 唯一 ID)形态 provide,
 * 可交换、可配逆(track 累积 ↔ reset 清空,dispose 后 track 拒用)。
 * seam 形态的编译期钉住见 tests/types.seam-pin.ts。
 */
import type { SessionMetrics } from '@eterna/observe'
import { hitRateFromSessionMetrics } from './hitrate.ts'
import { cacheHitRateFromEvents, cacheHitRateReport, EVENT_FIELD_EXTRACTORS, extractCacheUsage, extractRequestRoute } from './hitrate.ts'
import type { UsageEventFields } from './hitrate.ts'
import { analyzeStability } from './stability.ts'
import type { CacheHitRateReport, CacheUsageSample, PromptAssembly, SessionEventLike, StabilityReport } from './types.ts'
import type { EventFieldExtractor, EventFieldExtractorId, RouteRefLike } from './types.ts'

export { analyzeStability } from './stability.ts'
export { analyzeTransition, commonChars, joinedText, SEGMENT_SEPARATOR } from './prefix.ts'
export type { TransitionAlignment, TransitionDivergence } from './prefix.ts'
export { classifyVolatility, extractVolatileMatches, VOLATILE_PATTERNS } from './volatile.ts'
export type { VolatileMatch, VolatilePattern, VolatilityClassification } from './volatile.ts'
export {
  cacheHitRateFromEvents, cacheHitRateReport, collectCacheUsage, EVENT_FIELD_EXTRACTOR_IDS,
  EVENT_FIELD_EXTRACTORS, extractCacheUsage, extractRequestRoute, hitRateFromSessionMetrics,
} from './hitrate.ts'
export type { UsageEventFields } from './hitrate.ts'
export { isRecord } from './types.ts'
export type {
  CacheHitRateReport, CacheUsageSample, EventFieldExtractor, EventFieldExtractorId, PromptAssembly,
  PromptSegment, RouteCacheHitRate, RouteRefLike, SessionEventLike, StabilityReport, StabilityWarning,
  StabilityWarningKind, TokenUsageLike, TransitionRetention,
} from './types.ts'

/** 组合层注册 ctx.cacheGuard 服务时的唯一 ID(注册表 + 唯一 ID 形态,provide 可交换)。 */
export const CACHE_GUARD_SERVICE_ID = '@eterna/cache-guard'

/** 追踪窗口默认上限(防无界累积;滑窗丢弃最旧)。 */
export const DEFAULT_MAX_TRACKED = 1024

/** 组合门选项(coeffect 全声明:全部依赖显式注入,无隐藏全局)。 */
export interface CacheGuardOptions {
  /** 增量追踪窗口上限(≤0 视为无界);缺省 DEFAULT_MAX_TRACKED。 */
  readonly maxTracked?: number
}

/** 缓存守护组合门(服务面;字段不可变,track/reset/dispose 为 effect 配逆组)。 */
export interface CacheGuard {
  readonly id: typeof CACHE_GUARD_SERVICE_ID
  /** 前缀稳定性分析(纯函数转发 stability.analyzeStability)。 */
  analyze(assemblies: readonly PromptAssembly[]): StabilityReport
  /** 事件字段提取器注册表(唯一 ID → 提取器;消费方可交换取用)。 */
  readonly extractors: Readonly<Record<EventFieldExtractorId, EventFieldExtractor<unknown>>>
  /** 事件流 → 命中率报表(提取器管线:collectCacheUsage → cacheHitRateReport)。 */
  hitRate(events: readonly SessionEventLike[]): CacheHitRateReport
  /** observe 指标聚合器产物 → 本包报表(桥接,同口径)。 */
  hitRateFromMetrics(metrics: SessionMetrics): CacheHitRateReport
  /** 用量样本 → 报表(纯函数转发;供自定义事件源的消费方复用)。 */
  report(samples: readonly CacheUsageSample[]): CacheHitRateReport
  /** 单事件字段提取便捷门(等价 extractors['cache-usage'] / extractors['request-route'])。 */
  extractUsage(event: SessionEventLike): UsageEventFields | null
  extractRoute(event: SessionEventLike): RouteRefLike | null
  /**
   * 增量追踪:追加一轮 prompt 组装,返回当前窗口序列的稳定性报告。
   * effect 面:窗口滑出超限最旧者(maxTracked ≤0 无界)。
   */
  track(assembly: PromptAssembly): StabilityReport
  /** 当前窗口序列快照(副本,防外部篡改内部状态)。 */
  tracked(): readonly PromptAssembly[]
  /** effect 逆:清空追踪窗口(与 track 累积配对;重放同一序列结果一致)。 */
  reset(): void
  /** 彻底释放:等价 reset 且此后 track 拒用(服务不可用,与 observe dispose 同语义)。 */
  dispose(): void
}

/** 组装缓存守护门(纯对象,无隐藏全局;id 即注册键)。 */
export function createCacheGuard(options: CacheGuardOptions = {}): CacheGuard {
  const maxTracked = options.maxTracked ?? DEFAULT_MAX_TRACKED
  let window: PromptAssembly[] = []
  let disposed = false
  const id = CACHE_GUARD_SERVICE_ID
  return {
    id,
    analyze: assemblies => analyzeStability(assemblies),
    extractors: EVENT_FIELD_EXTRACTORS,
    hitRate: events => cacheHitRateFromEvents(events),
    hitRateFromMetrics: metrics => hitRateFromSessionMetrics(metrics),
    report: samples => cacheHitRateReport(samples),
    extractUsage: event => extractCacheUsage(event),
    extractRoute: event => extractRequestRoute(event),
    track(assembly) {
      if (disposed) throw new Error('cache-guard disposed: track is no longer available')
      window.push(assembly)
      if (maxTracked > 0 && window.length > maxTracked) {
        window = window.slice(window.length - maxTracked)
      }
      return analyzeStability(window)
    },
    tracked: () => [...window],
    reset() {
      window = []
    },
    dispose() {
      window = []
      disposed = true
    },
  }
}
