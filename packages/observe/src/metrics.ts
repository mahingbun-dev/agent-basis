/**
 * 指标聚合器:session 事件流(数组)→ 会话指标快照(纯函数,零副作用)。
 *
 * 输入:结构兼容 dsh SessionEvent 的事件数组(types.ts SessionEventLike;
 * 消费面 = turn/start、turn/end、step/start、request/header、request/context、assistant/message)。
 * 输出:tokens(互斥四桶)/ 成本估算(USD)/ 缓存命中率 / 轮数 + 路由明细 + 逐轮派生指标。
 *
 * **路由归属以 request/header / request/context 事件为准**(本任务验收口径):
 * request/header 在 step 内 dispatch 前追加(session/src/types.ts:395-403),
 * request/context 在路由/容量变化时记录(types.ts:405-413)——两者锚定「当前路由」,
 * 其后的 assistant/message.usage 记入该路由;两者皆未出现时归 'unknown/unknown' 路由。
 *
 * 口径依据:
 * - TokenUsage 互斥桶(llm/src/types.ts:182-196):inputTokens=未缓存输入,cacheRead/cacheWrite
 *   单列,计费输入=三者之和,reasoning 已含在 outputTokens 内不重复累计;
 * - 缓存命中率 = cacheRead / (input + cacheRead + cacheWrite)(分母=全部 prompt token;
 *   任一请求报告过缓存桶才计算,否则 null=未知,不伪报 0);
 * - 轮数 = turn/start 去重计数(空输入/被拒的 turn 也以 turn/start 开轮,types.ts:262-267)。
 */
import { DEFAULT_PRICING, estimateCostUsd, lookupPrice } from './pricing.ts'
import type { PricingTable } from './pricing.ts'
import { isRecord } from './types.ts'
import type { RouteRef, SessionEventLike, TokenUsageLike } from './types.ts'

/** 互斥四桶 token 计数(billed = input+cacheRead+cacheWrite+output,对齐 token-meter 投影口径)。 */
export interface TokenBuckets {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
  /** 计费口径合计 = input + cacheRead + cacheWrite + output。 */
  readonly billed: number
}

/** 单路由累计(provider/model 维度,报告与成本归集的最小单元)。 */
export interface RouteMetrics extends RouteRef {
  /** 计费模型调用次数(带 usage 的 assistant/message)。 */
  readonly calls: number
  readonly tokens: TokenBuckets
  readonly costUsd: number
  /** false = 价格表未命中,成本按 0 计、billed 全额计入 unpriced。 */
  readonly priced: boolean
}

/** turn/end 结束原因计数(kind → 次数;dsh TurnEndReasonMap 全集 + 前向兼容)。 */
export type TurnEndCounts = Readonly<Record<string, number>>

/** 会话指标快照(漂移对比的最小单元,见 drift.ts)。 */
export interface SessionMetrics {
  /** 轮数(turn/start 去重)。 */
  readonly turns: number
  /** 步数(step/start 去重,一轮可含多步)。 */
  readonly steps: number
  /** 计费模型调用次数(全部路由合计)。 */
  readonly modelCalls: number
  readonly tokens: TokenBuckets
  /**
   * 缓存命中率 = cacheRead / (input+cacheRead+cacheWrite);从未报告缓存桶时为 null(未知)。
   */
  readonly cacheHitRate: number | null
  /** 全路由成本估算合计(USD)。 */
  readonly costUsd: number
  /** 未计价路由的 billed token 合计(价格表未命中即不猜价)。 */
  readonly unpricedBilledTokens: number
  readonly turnEnd: TurnEndCounts
  /** 路由明细(出现序)。 */
  readonly routes: readonly RouteMetrics[]
  /** 事件窗口(输入数组边界)。 */
  readonly window: {
    readonly events: number
    readonly firstTime?: number
    readonly lastTime?: number
    readonly firstSeq?: number
    readonly lastSeq?: number
  }
  /** 逐轮派生(漂移对比用的归一化口径;turns=0 时 cost/tokens/errorRate 为 null)。 */
  readonly perTurn: {
    readonly costPerTurn: number | null
    readonly billedTokensPerTurn: number | null
    readonly errorTurnRate: number | null
  }
}

/** 聚合选项。 */
export interface AggregateOptions {
  /** 单价表;缺省 DEFAULT_PRICING(DeepSeek 官方价,估算口径)。 */
  readonly pricing?: PricingTable
}

const UNKNOWN_ROUTE: RouteRef = { provider: 'unknown', model: 'unknown' }

/**
 * 聚合一段 session 事件流为指标快照(纯函数;未知事件类型静默跳过,前向兼容 66+ 事件类型)。
 * 输入按数组序处理(事件流本身即时间序,seq 交叉时以数组序为准——导出日志保证有序)。
 */
export function aggregateSessionMetrics(
  events: readonly SessionEventLike[],
  options: AggregateOptions = {},
): SessionMetrics {
  const pricing = options.pricing ?? DEFAULT_PRICING
  const turns = new Set<number>()
  const steps = new Set<string>()
  const turnEnd: Record<string, number> = {}
  let currentRoute: RouteRef = UNKNOWN_ROUTE
  const routes = new Map<string, MutableRoute>()
  let cacheReportedCalls = 0
  let events0: number = 0
  let firstTime: number | undefined
  let lastTime: number | undefined
  let firstSeq: number | undefined
  let lastSeq: number | undefined

  for (const event of events) {
    events0 += 1
    if (event.time !== undefined) {
      firstTime ??= event.time
      lastTime = event.time
    }
    if (event.seq !== undefined) {
      firstSeq ??= event.seq
      lastSeq = event.seq
    }
    if (!isRecord(event.data)) continue
    switch (event.type) {
      case 'turn/start': {
        const turn = readNonNegative(event.data['turn'])
        if (turn !== undefined) turns.add(turn)
        break
      }
      case 'step/start': {
        const turn = readNonNegative(event.data['turn'])
        const step = readNonNegative(event.data['step'])
        if (turn !== undefined && step !== undefined) steps.add(`${turn}:${step}`)
        break
      }
      case 'turn/end': {
        const turn = readNonNegative(event.data['turn'])
        if (turn !== undefined) turns.add(turn)
        const reason = isRecord(event.data['reason'])
          ? typeof event.data['reason']['kind'] === 'string' ? event.data['reason']['kind'] : 'unknown'
          : 'unknown'
        turnEnd[reason] = (turnEnd[reason] ?? 0) + 1
        break
      }
      case 'request/header': {
        // 路由锚点 ①:header.config(provider/model/session/src/types.ts:241-256 EpochHeader)。
        const header = event.data['header']
        if (!isRecord(header)) break
        const config = header['config']
        if (!isRecord(config)) break
        const route = readRoute(config)
        if (route !== undefined) currentRoute = route
        break
      }
      case 'request/context': {
        // 路由锚点 ②:route 元数据(仅在变化时记录,types.ts:405-413)。
        const route = readRoute(event.data)
        if (route !== undefined) currentRoute = route
        break
      }
      case 'assistant/message': {
        // usage 骑在 assistant/message 上(types.ts:338-350);assistant/attempt 不带 usage 不计。
        const usage = readUsage(event.data['usage'])
        if (usage === undefined) break
        const bucket = routeBucket(routes, currentRoute, pricing)
        bucket.calls += 1
        bucket.input += usage.inputTokens
        bucket.output += usage.outputTokens
        bucket.cacheRead += usage.cacheReadTokens ?? 0
        bucket.cacheWrite += usage.cacheWriteTokens ?? 0
        bucket.reasoning += usage.reasoningTokens ?? 0
        if (usage.cacheReadTokens !== undefined || usage.cacheWriteTokens !== undefined) {
          cacheReportedCalls += 1
        }
        break
      }
      default:
        break
    }
  }

  const routeMetrics: RouteMetrics[] = []
  let total = emptyBuckets()
  let costUsd = 0
  let unpricedBilledTokens = 0
  for (const bucket of routes.values()) {
    const tokens = freezeBuckets(bucket)
    const cost = bucket.priced && bucket.price !== undefined
      ? estimateCostUsd(
        {
          inputTokens: bucket.input,
          outputTokens: bucket.output,
          ...(bucket.cacheRead > 0 && { cacheReadTokens: bucket.cacheRead }),
          ...(bucket.cacheWrite > 0 && { cacheWriteTokens: bucket.cacheWrite }),
        },
        bucket.price,
      )
      : 0
    if (!bucket.priced) unpricedBilledTokens += tokens.billed
    costUsd += cost
    total = addBuckets(total, tokens)
    routeMetrics.push({ provider: bucket.provider, model: bucket.model, calls: bucket.calls, tokens, costUsd: cost, priced: bucket.priced })
  }

  const promptTotal = total.input + total.cacheRead + total.cacheWrite
  const cacheHitRate = cacheReportedCalls > 0 && promptTotal > 0 ? total.cacheRead / promptTotal : null
  const turnCount = turns.size
  const errorTurns = turnEnd['error'] ?? 0
  return {
    turns: turnCount,
    steps: steps.size,
    modelCalls: routeMetrics.reduce((sum, route) => sum + route.calls, 0),
    tokens: total,
    cacheHitRate,
    costUsd,
    unpricedBilledTokens,
    turnEnd,
    routes: routeMetrics,
    window: {
      events: events0,
      ...(firstTime !== undefined && { firstTime }),
      ...(lastTime !== undefined && { lastTime }),
      ...(firstSeq !== undefined && { firstSeq }),
      ...(lastSeq !== undefined && { lastSeq }),
    },
    perTurn: {
      costPerTurn: turnCount > 0 ? costUsd / turnCount : null,
      billedTokensPerTurn: turnCount > 0 ? total.billed / turnCount : null,
      errorTurnRate: turnCount > 0 ? errorTurns / turnCount : null,
    },
  }
}

interface MutableRoute extends RouteRef {
  calls: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  priced: boolean
  price: ReturnType<typeof lookupPrice>
}

function routeBucket(
  routes: Map<string, MutableRoute>,
  route: RouteRef,
  pricing: PricingTable,
): MutableRoute {
  const key = `${route.provider}/${route.model}`
  let bucket = routes.get(key)
  if (bucket === undefined) {
    const price = lookupPrice(route, pricing)
    bucket = {
      provider: route.provider,
      model: route.model,
      calls: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      priced: price !== undefined,
      price,
    }
    routes.set(key, bucket)
  }
  return bucket
}

function emptyBuckets(): TokenBuckets {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, billed: 0 }
}

function freezeBuckets(bucket: MutableRoute): TokenBuckets {
  const input = bucket.input
  const output = bucket.output
  const cacheRead = bucket.cacheRead
  const cacheWrite = bucket.cacheWrite
  return { input, output, cacheRead, cacheWrite, reasoning: bucket.reasoning, billed: input + cacheRead + cacheWrite + output }
}

function addBuckets(a: TokenBuckets, b: TokenBuckets): TokenBuckets {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    reasoning: a.reasoning + b.reasoning,
    billed: a.billed + b.billed,
  }
}

function readRoute(record: Record<string, unknown>): RouteRef | undefined {
  const provider = record['provider']
  const model = record['model']
  if (typeof provider !== 'string' || provider.length === 0) return undefined
  if (typeof model !== 'string' || model.length === 0) return undefined
  return { provider, model }
}

/** dsh TokenUsage 的防御性读取(窄于官方类型;坏数据不计而非崩)。 */
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

function readNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}
