/**
 * 成本估算价格表(纯数据 + 纯函数,零副作用)。
 *
 * 用途:metrics.ts 把 provider 上报的 TokenUsage(计数互斥口径,见 types.ts 模块注释)
 * 按路由单价折算为估算成本(货币:USD)。**这是估算而非账单**——单价随官方定价页变动,
 * 组合层可用 options.pricing 全量覆写;未命中路由计入 unpriced(不猜价)。
 *
 * 默认表取 DeepSeek 官方公开价(2026-11 采集,USD / 1M tokens):
 * - deepseek-chat:    输入(未命中)$0.27,缓存命中 $0.07,输出 $1.10
 * - deepseek-reasoner:输入(未命中)$0.55,缓存命中 $0.14,输出 $2.19
 * cacheWrite 按未命中输入价计(官方口径:写缓存按正常输入计费);
 * '*' 通配条目可由调用方提供,作为未知路由的兜底单价(缺省无兜底 → unpriced)。
 */

/** 一条路由的单价(USD / 1M tokens);cacheRead/cacheWrite 缺省回落 input 价。 */
export interface RoutePrice {
  readonly input: number
  readonly output: number
  readonly cacheRead?: number
  readonly cacheWrite?: number
}

/** 键形如 `provider/model`;'*' 为通配兜底(可选)。 */
export type PricingTable = Readonly<Record<string, RoutePrice>>

/** DeepSeek 官方公开价(估算用,可全量覆写)。 */
export const DEFAULT_PRICING: PricingTable = {
  'deepseek/deepseek-chat': { input: 0.27, cacheRead: 0.07, output: 1.1 },
  'deepseek/deepseek-reasoner': { input: 0.55, cacheRead: 0.14, output: 2.19 },
}

/** 路由键(provider/model);model 内部斜杠容错(取首个 provider 段 + 其余为 model)。 */
export function routeKey(route: { readonly provider: string; readonly model: string }): string {
  return `${route.provider}/${route.model}`
}

/**
 * 查一条路由的单价:精确 `provider/model` → 通配 '*' → undefined(不猜价)。
 * cacheRead/cacheWrite 未给时回落 input 价(写缓存按输入计费的保守口径)。
 */
export function lookupPrice(
  route: { readonly provider: string; readonly model: string },
  table: PricingTable = DEFAULT_PRICING,
): RoutePrice | undefined {
  const price = table[routeKey(route)] ?? table['*']
  if (price === undefined) return undefined
  return {
    input: price.input,
    output: price.output,
    cacheRead: price.cacheRead ?? price.input,
    cacheWrite: price.cacheWrite ?? price.input,
  }
}

/**
 * 一次计费的用量与单价 → 估算成本(USD)。
 * billed 口径 = input + cacheRead + cacheWrite + output(TokenUsage 互斥四桶)。
 */
export function estimateCostUsd(
  usage: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly cacheReadTokens?: number
    readonly cacheWriteTokens?: number
  },
  price: RoutePrice,
): number {
  const cacheRead = usage.cacheReadTokens ?? 0
  const cacheWrite = usage.cacheWriteTokens ?? 0
  return (
    (usage.inputTokens / 1e6) * price.input
    + (cacheRead / 1e6) * (price.cacheRead ?? price.input)
    + (cacheWrite / 1e6) * (price.cacheWrite ?? price.input)
    + (usage.outputTokens / 1e6) * price.output
  )
}
