/**
 * 命中率指标输出接口测试:
 * - 事件字段提取器(cache-usage / request-route)逐事件行为;
 * - 路由锚定(request/header → request/context → unknown);
 * - 报表口径手算(互斥四桶、null=未知不伪报 0、byRoute);
 * - **对接 @eterna/observe 指标聚合器(验收门)**:相同事件流上,
 *   cacheHitRateFromEvents().hitRate === aggregateSessionMetrics().cacheHitRate 逐位相等,
 *   hitRateFromSessionMetrics(observe 产物) 与本包提取器管线结果字段级一致。
 *
 * 事件形态依据 deepseek-harness packages/core/session/src/types.ts:258-436
 * (request/header { header: { config } } / request/context { provider, model } /
 * assistant/message { turn, step, usage })。
 */
import { aggregateSessionMetrics } from '@eterna/observe'
import { describe, expect, it } from 'vitest'
import {
  cacheHitRateFromEvents, cacheHitRateReport, collectCacheUsage, EVENT_FIELD_EXTRACTOR_IDS,
  EVENT_FIELD_EXTRACTORS, extractCacheUsage, extractCompactionEvent, extractRequestRoute,
  hitRateFromSessionMetrics,
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

/**
 * 压缩事务事件(载荷依据 @deepseek-ai/dsh-compaction 0.2.2-rc.5 src/types.ts:24,72
 * SessionEventMap 合并:start/end = `{ compactionId, sourceCommandId?, turn: number|null }`
 * (+ end 失败时的 `error?: string`);本仓同形 append(region.ts:221,248,256)。
 */
function compactionStartEvent(compactionId: string, turn: number | null, seq: number, time: number): SessionEventLike {
  return { type: 'compaction/start', data: { compactionId, turn }, seq, time }
}

function compactionEndEvent(
  compactionId: string, turn: number | null, error?: string, seq = 0, time = 0,
): SessionEventLike {
  return {
    type: 'compaction/end',
    data: { compactionId, turn, ...(error !== undefined && { error }) },
    seq,
    time,
  }
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

  it('compaction-event:compaction/start|end → 相位标记(seq/time 透传);其余事件 null', () => {
    const start = extractCompactionEvent(compactionStartEvent('c-1', 3, 10, 1000))
    expect(start).toEqual({ phase: 'start', compactionId: 'c-1', turn: 3, seq: 10, time: 1000 })
    // 手动压缩事务:turn = null(dsh-compaction types.ts:24 number|null)。
    expect(extractCompactionEvent(compactionStartEvent('c-2', null, 11, 1001)))
      .toEqual({ phase: 'start', compactionId: 'c-2', turn: null, seq: 11, time: 1001 })
    const end = extractCompactionEvent(compactionEndEvent('c-1', 3, undefined, 20, 2000))
    expect(end).toEqual({ phase: 'end', compactionId: 'c-1', turn: 3, seq: 20, time: 2000 })
    // 失败收尾:error 透传(errorChain 字符串,dsh-compaction types.ts:72)。
    expect(extractCompactionEvent(compactionEndEvent('c-3', 4, 'invalid-summary: bad', 30, 3000)))
      .toEqual({ phase: 'end', compactionId: 'c-3', turn: 4, error: 'invalid-summary: bad', seq: 30, time: 3000 })
    expect(extractCompactionEvent(headerEvent('deepseek', 'deepseek-chat'))).toBeNull()
    expect(extractCompactionEvent(usageEvent(1, 1, { inputTokens: 1, outputTokens: 1 }))).toBeNull()
    expect(extractCompactionEvent(ev('turn/start', { turn: 1 }))).toBeNull()
  })

  it('compaction-event:坏数据防御(缺 compactionId/turn 坏值不计而非崩)', () => {
    expect(extractCompactionEvent({ type: 'compaction/start', data: {}, seq: 1, time: 1 }))
      .toEqual({ phase: 'start', seq: 1, time: 1 })
    expect(extractCompactionEvent({ type: 'compaction/end', data: { turn: -1 }, seq: 2, time: 2 }))
      .toEqual({ phase: 'end', seq: 2, time: 2 })
    expect(extractCompactionEvent({ type: 'compaction/start', data: 'junk', seq: 3, time: 3 })).toBeNull()
    expect(extractCompactionEvent({ type: 'compaction/end', data: null, seq: 4, time: 4 })).toBeNull()
    // 无 seq/time 的事件包(结构兼容层允许缺省)→ 锚点缺省。
    expect(extractCompactionEvent({ type: 'compaction/start', data: { compactionId: 'c' } }))
      .toEqual({ phase: 'start', compactionId: 'c' })
  })

  it('提取器注册表:全部唯一 ID 可取用且行为一致(可交换接口面)', () => {
    expect(EVENT_FIELD_EXTRACTOR_IDS).toEqual(['cache-usage', 'request-route', 'compaction-event'])
    const event = usageEvent(2, 1, { inputTokens: 3, outputTokens: 4 })
    expect(EVENT_FIELD_EXTRACTORS['cache-usage'](event)).toEqual(
      extractCacheUsage(event),
    )
    const routeEvent = headerEvent('deepseek', 'deepseek-chat')
    expect(EVENT_FIELD_EXTRACTORS['request-route'](routeEvent)).toEqual(
      extractRequestRoute(routeEvent),
    )
    const compactionEvent = compactionStartEvent('c-1', 1, 10, 1000)
    expect(EVENT_FIELD_EXTRACTORS['compaction-event'](compactionEvent)).toEqual(
      extractCompactionEvent(compactionEvent),
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

  it('空事件流 → 空报表(calls=0,hitRate=null,压缩统计全零)', () => {
    const report = cacheHitRateFromEvents([])
    expect(report.calls).toBe(0)
    expect(report.promptTokens).toBe(0)
    expect(report.hitRate).toBeNull()
    expect(report.byRoute).toEqual([])
    // 事件流路径的压缩面貌恒在场:空流事实为零(非未知)。
    expect(report.compaction).toEqual({ starts: 0, ends: 0, errors: 0, markers: [] })
  })

  it('样本路径(cacheHitRateReport)不带事件流 → compaction 打标块缺省(未知不伪报 0)', () => {
    const report = cacheHitRateReport([
      { route: { provider: 'p', model: 'm' }, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 5 } },
    ])
    expect(report.hitRate).toBe(5 / 15)
    expect('compaction' in report).toBe(false)
  })
})

describe('压缩事件打标(53 号 D6,收口 28 号 §7-2:区分「压缩导致」vs「前缀污染」)', () => {
  it('混合流:压缩标记入报表,不扰动命中率算式(压缩事件不携带 usage/路由)', () => {
    const events: SessionEventLike[] = [
      headerEvent('deepseek', 'deepseek-chat'),
      usageEvent(1, 1, { inputTokens: 100, outputTokens: 200, cacheReadTokens: 50 }),
      compactionStartEvent('c-1', 1, 11, 1000),
      compactionEndEvent('c-1', 1, undefined, 12, 1100),
      usageEvent(2, 1, { inputTokens: 0, outputTokens: 150, cacheReadTokens: 400 }),
    ]
    const report = cacheHitRateFromEvents(events)
    // 命中率算式与无压缩流的混合口径一致:450/(100+50+0+400)。
    expect(report.hitRate).toBe(450 / 550)
    expect(report.compaction).toEqual({
      starts: 1,
      ends: 1,
      errors: 0,
      markers: [
        { phase: 'start', compactionId: 'c-1', turn: 1, seq: 11, time: 1000 },
        { phase: 'end', compactionId: 'c-1', turn: 1, seq: 12, time: 1100 },
      ],
    })
  })

  it('失败事务与未收尾开括号:errors 计数、start/end 不配对也各计', () => {
    const report = cacheHitRateFromEvents([
      compactionStartEvent('c-1', 1, 1, 100),
      // c-1 从未收到 end(开括号悬挂)。
      compactionStartEvent('c-2', 2, 2, 200),
      compactionEndEvent('c-2', 2, 'invalid-summary: bad', 3, 300),
      compactionEndEvent('c-3', 3, 'commit: conflict', 4, 400),
    ])
    expect(report.compaction?.starts).toBe(2)
    expect(report.compaction?.ends).toBe(2)
    expect(report.compaction?.errors).toBe(2)
    // 标记明细按事件流出现序(出现序即时间序)。
    expect(report.compaction?.markers).toEqual([
      { phase: 'start', compactionId: 'c-1', turn: 1, seq: 1, time: 100 },
      { phase: 'start', compactionId: 'c-2', turn: 2, seq: 2, time: 200 },
      { phase: 'end', compactionId: 'c-2', turn: 2, error: 'invalid-summary: bad', seq: 3, time: 300 },
      { phase: 'end', compactionId: 'c-3', turn: 3, error: 'commit: conflict', seq: 4, time: 400 },
    ])
  })

  it('无压缩事件的真实流:压缩统计全零(事实为零,区别于样本路径的缺省未知)', () => {
    const report = cacheHitRateFromEvents([headerEvent('deepseek', 'deepseek-chat'), usageEvent(1, 1, { inputTokens: 10, outputTokens: 5 })])
    expect(report.compaction).toEqual({ starts: 0, ends: 0, errors: 0, markers: [] })
  })

  it('observe 桥接产物不带压缩面貌 → compaction 缺省(observe 指标不感知压缩事件)', () => {
    const mixedStream: SessionEventLike[] = [
      headerEvent('deepseek', 'deepseek-chat'),
      compactionStartEvent('c-1', 1, 5, 500),
      compactionEndEvent('c-1', 1, undefined, 6, 600),
      usageEvent(1, 1, { inputTokens: 100, outputTokens: 200, cacheReadTokens: 50 }),
    ]
    const bridged = hitRateFromSessionMetrics(aggregateSessionMetrics(mixedStream))
    expect('compaction' in bridged).toBe(false)
    // 事件流路径同流可读出压缩标记:两侧打标能力差异如实保持。
    expect(cacheHitRateFromEvents(mixedStream).compaction?.starts).toBe(1)
  })
})

describe('对接 @eterna/observe 指标聚合器(验收门)', () => {
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
