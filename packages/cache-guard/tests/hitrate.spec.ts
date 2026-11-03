/**
 * 命中率指标输出接口测试:
 * - 事件字段提取器(cache-usage / request-route)逐事件行为;
 * - 路由锚定(request/header → request/context → unknown);
 * - 报表口径手算(互斥四桶、null=未知不伪报 0、byRoute);
 * - **对接 @basis/observe 指标聚合器(验收门)**:相同事件流上,
 *   cacheHitRateFromEvents().hitRate === aggregateSessionMetrics().cacheHitRate 逐位相等,
 *   hitRateFromSessionMetrics(observe 产物) 与本包提取器管线结果字段级一致。
 *
 * 事件形态依据 dsh-repo packages/core/session/src/types.ts:258-436
 * (request/header { header: { config } } / request/context { provider, model } /
 * assistant/message { turn, step, usage })。
 */
import { aggregateSessionMetrics } from '@basis/observe'
import { describe, expect, it } from 'vitest'
import {
  cacheHitRateFromEvents, cacheHitRateReport, collectCacheUsage, EVENT_FIELD_EXTRACTOR_IDS,
  EVENT_FIELD_EXTRACTORS, extractCacheUsage, extractRequestRoute, hitRateFromSessionMetrics,
} from '../src/index.ts'
import type { SessionEventLike } from '../src/index.ts'

function ev(type: string, data: unknown): SessionEventLike {
  return { type, data, seq: 0, time: 0 }
}

function usageEvent(turn: number, step: number, usage: Record<string, number>): SessionEventLike {
  return ev('assistant/message', { turn, step, message: { role: 'assistant' }, stream: [], usage })
}

function headerEvent(provider: string, model: string): SessionEventLike {
  return ev('request/header', { header: { config: { provider, model } }, reason: 'initial' })
}

function contextEvent(provider: string, model: string): SessionEventLike {
  return ev('request/context', { provider, model })
}

describe('事件字段提取器', () => {
  it('cache-usage:assistant/message 带 usage → 提取互斥四桶;不带 usage → null', () => {
    const fields = extractCacheUsage(usageEvent(1, 1, {
      inputTokens: 100, outputTokens: 200, cacheReadTokens: 50, reasoningTokens: 30,
    }))
    expect(fields).toEqual({ turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 200, cacheReadTokens: 50, reasoningTokens: 30 } })
    expect(extractCacheUsage(ev('assistant/message', { turn: 1, step: 1, stream: [] }))).toBeNull()
  })

  it('cache-usage:坏数据(缺 inputTokens/负数)不计而非崩', () => {
    expect(extractCacheUsage(usageEvent(1, 1, { outputTokens: 10 }))).toBeNull()
    expect(extractCacheUsage(usageEvent(1, 1, { inputTokens: -1, outputTokens: 10 }))).toBeNull()
    expect(extractCacheUsage(usageEvent(1, 1, { inputTokens: Number.NaN, outputTokens: 10 }))).toBeNull()
  })

  it('cache-usage:非 assistant/message 事件一律 null', () => {
    expect(extractCacheUsage(headerEvent('deepseek', 'deepseek-chat'))).toBeNull()
    expect(extractCacheUsage(ev('turn/start', { turn: 1 }))).toBeNull()
    expect(extractCacheUsage(ev('assistant/attempt', { usage: { inputTokens: 1, outputTokens: 1 } }))).toBeNull()
  })

  it('request-route:request/header 读 header.config;request/context 读顶层;其余 null', () => {
    expect(extractRequestRoute(headerEvent('deepseek', 'deepseek-chat'))).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    expect(extractRequestRoute(contextEvent('zai', 'glm-4.7'))).toEqual({ provider: 'zai', model: 'glm-4.7' })
    expect(extractRequestRoute(usageEvent(1, 1, { inputTokens: 1, outputTokens: 1 }))).toBeNull()
    expect(extractRequestRoute(ev('request/header', { header: {}, reason: 'change' }))).toBeNull()
  })

  it('提取器注册表:全部唯一 ID 可取用且行为一致(可交换接口面)', () => {
    expect(EVENT_FIELD_EXTRACTOR_IDS).toEqual(['cache-usage', 'request-route'])
    const event = usageEvent(2, 1, { inputTokens: 3, outputTokens: 4 })
    expect(EVENT_FIELD_EXTRACTORS['cache-usage'](event)).toEqual(
      extractCacheUsage(event),
    )
    const routeEvent = headerEvent('deepseek', 'deepseek-chat')
    expect(EVENT_FIELD_EXTRACTORS['request-route'](routeEvent)).toEqual(
      extractRequestRoute(routeEvent),
    )
  })
})

describe('路由锚定与样本收集(collectCacheUsage)', () => {
  it('request/header → request/context 顺序锚定;未出现归 unknown/unknown', () => {
    const events: SessionEventLike[] = [
      headerEvent('deepseek', 'deepseek-chat'),
      usageEvent(1, 1, { inputTokens: 10, outputTokens: 5 }),
      contextEvent('deepseek', 'deepseek-reasoner'),
      usageEvent(2, 1, { inputTokens: 20, outputTokens: 5 }),
    ]
    const samples = collectCacheUsage(events)
    expect(samples.map(s => `${s.route.provider}/${s.route.model}`)).toEqual([
      'deepseek/deepseek-chat', 'deepseek/deepseek-reasoner',
    ])
    expect(samples.map(s => s.turn)).toEqual([1, 2])
  })

  it('无路由事件:归 unknown/unknown(observe 同约定)', () => {
    const samples = collectCacheUsage([usageEvent(1, 1, { inputTokens: 10, outputTokens: 5 })])
    expect(samples[0]?.route).toEqual({ provider: 'unknown', model: 'unknown' })
  })
})

describe('命中率报表口径(手算)', () => {
  it('混合路由:总命中率 = ΣcacheRead / ΣpromptTokens;byRoute 同式', () => {
    const events: SessionEventLike[] = [
      headerEvent('deepseek', 'deepseek-chat'),
      // turn1:prompt=100+50=150? —— input=100 cacheRead=50 → prompt 150
      usageEvent(1, 1, { inputTokens: 100, outputTokens: 200, cacheReadTokens: 50 }),
      // turn1 step2:input=0 cacheRead=400 → prompt 400
      usageEvent(1, 2, { inputTokens: 0, outputTokens: 150, cacheReadTokens: 400 }),
      headerEvent('deepseek', 'deepseek-reasoner'),
      // turn2:reasoner 无缓存桶上报
      usageEvent(2, 1, { inputTokens: 80, outputTokens: 70 }),
    ]
    const report = cacheHitRateFromEvents(events)
    expect(report.calls).toBe(3)
    expect(report.promptTokens).toBe(100 + 50 + 0 + 400 + 80)
    expect(report.cacheReadTokens).toBe(450)
    // 手算:450 / 630 = 0.7142857142857143
    expect(report.hitRate).toBe(450 / 630)
    expect(report.byRoute).toHaveLength(2)
    const chat = report.byRoute[0]
    const reasoner = report.byRoute[1]
    expect(chat?.route).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    expect(chat?.hitRate).toBe(450 / 550)
    // reasoner 从未上报缓存桶 → null(未知,不伪报 0)
    expect(reasoner?.hitRate).toBeNull()
  })

  it('从未上报缓存桶 → 总命中率 null;全 0 分母 → null', () => {
    const noCache = cacheHitRateFromEvents([
      headerEvent('deepseek', 'deepseek-chat'),
      usageEvent(1, 1, { inputTokens: 10, outputTokens: 5 }),
    ])
    expect(noCache.hitRate).toBeNull()
    const zeroPrompt = cacheHitRateReport([
      { route: { provider: 'p', model: 'm' }, usage: { inputTokens: 0, outputTokens: 5, cacheReadTokens: 0 } },
    ])
    expect(zeroPrompt.hitRate).toBeNull()
  })

  it('空事件流 → 空报表(calls=0,hitRate=null)', () => {
    const report = cacheHitRateFromEvents([])
    expect(report.calls).toBe(0)
    expect(report.promptTokens).toBe(0)
    expect(report.hitRate).toBeNull()
    expect(report.byRoute).toEqual([])
  })
})

describe('对接 @basis/observe 指标聚合器(验收门)', () => {
  const mixedStream: SessionEventLike[] = [
    headerEvent('deepseek', 'deepseek-chat'),
    usageEvent(1, 1, { inputTokens: 100, outputTokens: 200, cacheReadTokens: 50 }),
    usageEvent(1, 2, { inputTokens: 0, outputTokens: 150, cacheReadTokens: 400 }),
    headerEvent('deepseek', 'deepseek-reasoner'),
    usageEvent(2, 1, { inputTokens: 80, outputTokens: 70 }),
  ]
  const noCacheStream: SessionEventLike[] = [
    headerEvent('deepseek', 'deepseek-chat'),
    usageEvent(1, 1, { inputTokens: 10, outputTokens: 5 }),
  ]
  const noiseStream: SessionEventLike[] = [
    ev('turn/start', { turn: 1 }),
    ev('tool/result', { turn: 1, step: 1, message: { toolCallId: 't1' } }),
  ]

  it('相同事件流:本包 hitRate 与 observe cacheHitRate 逐位相等(混合/无缓存/噪声)', () => {
    expect(cacheHitRateFromEvents(mixedStream).hitRate).toBe(aggregateSessionMetrics(mixedStream).cacheHitRate)
    expect(cacheHitRateFromEvents(noCacheStream).hitRate).toBe(aggregateSessionMetrics(noCacheStream).cacheHitRate)
    expect(cacheHitRateFromEvents(noiseStream).hitRate).toBe(aggregateSessionMetrics(noiseStream).cacheHitRate)
    expect(cacheHitRateFromEvents(mixedStream).hitRate).toBeCloseTo(450 / 630, 15)
  })

  it('observe 聚合产物桥接:hitRateFromSessionMetrics 与提取器管线字段级一致', () => {
    const ours = cacheHitRateFromEvents(mixedStream)
    const bridged = hitRateFromSessionMetrics(aggregateSessionMetrics(mixedStream))
    expect(bridged.calls).toBe(ours.calls)
    expect(bridged.promptTokens).toBe(ours.promptTokens)
    expect(bridged.cacheReadTokens).toBe(ours.cacheReadTokens)
    expect(bridged.hitRate).toBe(ours.hitRate)
    expect(bridged.byRoute.map(r => [r.route.provider, r.calls, r.promptTokens, r.cacheReadTokens, r.hitRate]))
      .toEqual(ours.byRoute.map(r => [r.route.provider, r.calls, r.promptTokens, r.cacheReadTokens, r.hitRate]))
  })

  it('observe 无缓存桶:两侧同为 null,桥接不伪报 0', () => {
    expect(hitRateFromSessionMetrics(aggregateSessionMetrics(noCacheStream)).hitRate).toBeNull()
  })
})
