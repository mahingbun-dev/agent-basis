/**
 * cache-guard 共享词汇 + DSH seam 的本地最小形态(结构兼容层)。
 *
 * 来源与依据(deepseek-harness,0.2.2-alpha.2,只读):
 * - session 事件包:packages/core/session/src/types.ts:497-518 `{ type, seq, time, data }`;
 *   data 形态见 SessionEventMap(types.ts:258-436):
 *   - 'request/header' { header: { config: { provider, model, … } }, reason, startsSeries? }(types.ts:395-403)
 *     —— reason='change' 表示 header 变更(新 epoch,前缀缓存序列合法断开;设计文档 12 §1.5
 *     「监听 request/header 事件」的消费面,本包将其作为路由锚点与命中率上下文,不误报为失稳);
 *   - 'request/context' { provider, model, contextWindow? }(types.ts:405-413,route 元数据,仅在变化时记录);
 *   - 'assistant/message' { turn, step, message, stream, usage?: TokenUsage }(types.ts:338-350)
 *     —— usage 骑在 assistant/message 上;assistant/attempt 不带 usage,不计。
 * - TokenUsage:packages/llm/llm/src/types.ts:182-196 —— 计数互斥(disjoint):
 *   inputTokens 只含未缓存输入;缓存输入单列为 cacheReadTokens/cacheWriteTokens。
 *
 * 本文件只声明缓存守护实际消费的字段(比官方类型更窄),由 tests/types.seam-pin.ts
 * 在编译期断言官方类型可赋值进来 —— DSH 升级破坏 seam 时 tsc --noEmit 即失败。
 * 事件/usage/RouteRef 形态与 @eterna/observe types.ts 保持结构一致(同源同据),
 * 供命中率口径互证(tests/hitrate.spec.ts 断言两包在相同事件流上得出相同 cacheHitRate)。
 */

/**
 * session 事件流的最小事件包形态(结构兼容 dsh `SessionEvent`,types.ts:497)。
 * 字段提取器只消费 type/data(seq/time 透传可选)。
 */
export interface SessionEventLike {
  readonly type: string
  readonly data: unknown
  readonly seq?: number
  readonly time?: number
}

/**
 * dsh `TokenUsage` 的结构子集(llm/src/types.ts:182;互斥桶口径见模块注释)。
 * inputTokens = 未缓存输入;cacheRead/cacheWrite 单列;reasoning 已含在 outputTokens 内。
 */
export interface TokenUsageLike {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens?: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
  readonly reasoningTokens?: number
}

/** 一条 provider/model 路由(来自 request/header.config 或 request/context,与 observe RouteRef 同构)。 */
export interface RouteRefLike {
  readonly provider: string
  readonly model: string
}

/**
 * 一段 prompt 组装片段:source 标识来源(system / section:<id> / user / assistant / tool …),
 * text 为该段文本。段是稳定性对齐的最小单元——同 source 的段跨轮比较,前缀缓存按段序拼接。
 */
export interface PromptSegment {
  readonly source: string
  readonly text: string
}

/**
 * 一轮请求的 prompt 组装快照:该次发给模型的完整 prompt 按段序列。
 * 「连续多轮」= 同一会话内按数组序递增的组装序列(turn 字段用于告警定位,不要求连续)。
 */
export interface PromptAssembly {
  readonly turn: number
  readonly segments: readonly PromptSegment[]
}

/** 前缀失稳种类(告警 kind;前两类 = 可归因的易变内容,后两类 = 无法归因的变动)。 */
export type StabilityWarningKind =
  | 'volatile-timestamp'
  | 'volatile-random-id'
  | 'prefix-mutation'
  | 'structure-change'

/** 单条前缀稳定性告警。 */
export interface StabilityWarning {
  readonly kind: StabilityWarningKind
  /** 失稳发生的转移(从第几轮 → 到第几轮,取 PromptAssembly.turn)。 */
  readonly fromTurn: number
  readonly toTurn: number
  /**
   * 共同前缀字符数(= KV-cache 实际可复用的前缀长度;段间以单个换行拼接计长)。
   * 前缀缓存自此偏移处失效。
   */
  readonly commonPrefixLength: number
  /** 上一轮 prompt 总字符数(理论上可复用的前缀上限)。 */
  readonly previousLength: number
  /** 该转移的前缀保留率 = commonPrefixLength / previousLength(∈(0,1);告警必 <1)。 */
  readonly retention: number
  /** 失稳段来源(段内变动/结构变动时给出)。 */
  readonly source?: string
  /** 命中的易变模式 id 列表(volatile-* 才有;如 ['iso-datetime'] / ['uuid','hex-token'])。 */
  readonly patterns?: readonly string[]
  /** 变动前片段(截窗≤80 字符;结构变动为源段序列描述)。 */
  readonly before?: string
  /** 变动后片段(截窗≤80 字符)。 */
  readonly after?: string
  /** 人读一句话(带偏移与证据,进报表/告警通道)。 */
  readonly message: string
}

/** 逐转移前缀保留率明细(评分的分母/分子来源,漂移与报表用)。 */
export interface TransitionRetention {
  readonly fromTurn: number
  readonly toTurn: number
  readonly commonPrefixLength: number
  readonly previousLength: number
  /** previousLength=0 视为 1(空 prompt 无可失稳)。 */
  readonly retention: number
}

/** 前缀稳定性报告(检查器输出:告警列表 + 稳定性评分)。 */
export interface StabilityReport {
  /** 输入组装序列长度。 */
  readonly assemblies: number
  /** 转移数 = assemblies - 1(截断到非负)。 */
  readonly transitions: number
  /**
   * 稳定性评分 ∈ [0,1]:Σ共同前缀字符 / Σ上轮字符(空转移不计入)。
   * 1 = 完全稳定(每个转移都完整保留上轮前缀);无转移时为 1。
   * 对失稳严格单调:任一转移的共同前缀变小或失稳转移变多,评分必降(见 stability.ts 注释)。
   */
  readonly score: number
  readonly warnings: readonly StabilityWarning[]
  readonly retentions: readonly TransitionRetention[]
}

/** 单次模型调用的缓存用量样本(usage + 路由归属,由 collectCacheUsage 锚定)。 */
export interface CacheUsageSample {
  readonly turn?: number
  readonly step?: number
  readonly route: RouteRefLike
  readonly usage: TokenUsageLike
}

/** 单路由命中率(promptTokens = input+cacheRead+cacheWrite,互斥四桶口径)。 */
export interface RouteCacheHitRate {
  readonly route: RouteRefLike
  /** 该路由带 usage 的调用次数。 */
  readonly calls: number
  readonly promptTokens: number
  readonly cacheReadTokens: number
  /** 同总口径;该路由从未上报缓存桶时为 null(未知,不伪报 0)。 */
  readonly hitRate: number | null
}

/** 命中率指标报表(输出接口:对接 observe 指标聚合器,同公式可互证)。 */
export interface CacheHitRateReport {
  readonly calls: number
  readonly promptTokens: number
  readonly cacheReadTokens: number
  /**
   * 缓存命中率 = cacheRead / (input+cacheRead+cacheWrite)——与 @eterna/observe
   * aggregateSessionMetrics 的 cacheHitRate 完全同口径(metrics.ts:206-207);
   * 从未上报缓存桶或分母为 0 时为 null。
   */
  readonly hitRate: number | null
  /** 路由明细(出现序)。 */
  readonly byRoute: readonly RouteCacheHitRate[]
}

/** 事件字段提取器 ID(注册表唯一键;可交换接口面)。 */
export type EventFieldExtractorId = 'cache-usage' | 'request-route'

/**
 * 事件字段提取器:单事件 → 字段(null = 该事件不携带此字段)。
 * 注册表形态见 hitrate.ts EVENT_FIELD_EXTRACTORS(唯一 ID → 提取器)。
 */
export type EventFieldExtractor<T> = (event: SessionEventLike) => T | null

/** 任意 JSON record 的窄判别(与 observe/governance isRecord 同型,本包零依赖自持)。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
