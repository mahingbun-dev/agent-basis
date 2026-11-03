/**
 * 指标聚合器单测:tokens(互斥四桶)/成本估算/缓存命中率/轮数 —— fixture 事件流(自造),
 * 路由归属以 request/header 类事件为准;另盖:未知路由不计价、无缓存桶 → cacheHitRate=null、
 * 坏数据防御、空流、纯 request/context 锚定。
 */
import { describe, expect, it } from 'vitest'
import { aggregateSessionMetrics, DEFAULT_PRICING } from '../src/index.ts'
import type { PricingTable } from '../src/index.ts'
import {
  assistantNoUsage, assistantUsage, ev, noise, requestContext, requestHeader, standardFixture, turnStart,
} from './fixtures.ts'

describe('aggregateSessionMetrics —— 标准两轮三步 fixture(手算对账)', () => {
  const metrics = aggregateSessionMetrics(standardFixture())

  it('轮数 = turn/start 去重(2),步数 = step/start 去重(3),模型调用 = 带 usage 的 assistant/message(3)', () => {
    expect(metrics.turns).toBe(2)
    expect(metrics.steps).toBe(3)
    expect(metrics.modelCalls).toBe(3)
  })

  it('互斥四桶:input/output/cacheRead 分路由归集,billed = 三 prompt 桶 + output', () => {
    expect(metrics.tokens).toMatchObject({
      input: 180, output: 420, cacheRead: 450, cacheWrite: 0, reasoning: 30, billed: 1050,
    })
  })

  it('缓存命中率 = cacheRead / 全部 prompt token = 450/630(≈0.7143)', () => {
    expect(metrics.cacheHitRate).not.toBeNull()
    expect(metrics.cacheHitRate).toBeCloseTo(450 / 630, 10)
  })

  it('成本估算按 DEFAULT_PRICING(DeepSeek 官方价)逐路由折算,合计 0.0006408 USD', () => {
    expect(metrics.costUsd).toBeCloseTo(0.0006408, 10)
    expect(metrics.unpricedBilledTokens).toBe(0)
    expect(metrics.routes).toHaveLength(2)
    const chat = metrics.routes.find(route => route.model === 'deepseek-chat')
    const reasoner = metrics.routes.find(route => route.model === 'deepseek-reasoner')
    expect(chat?.costUsd).toBeCloseTo(0.0004435, 10)
    expect(reasoner?.costUsd).toBeCloseTo(0.0001973, 10)
    expect(chat?.priced).toBe(true)
    expect(reasoner?.priced).toBe(true)
  })

  it('turn/end 结束原因计数 + 逐轮派生指标', () => {
    expect(metrics.turnEnd).toEqual({ completed: 1, error: 1 })
    expect(metrics.perTurn.costPerTurn).toBeCloseTo(0.0006408 / 2, 10)
    expect(metrics.perTurn.billedTokensPerTurn).toBeCloseTo(1050 / 2, 10)
    expect(metrics.perTurn.errorTurnRate).toBe(0.5)
  })

  it('事件窗口边界(firstTime/lastTime/firstSeq/lastSeq/events)', () => {
    expect(metrics.window).toEqual({
      events: 12, firstTime: 1000, lastTime: 2004, firstSeq: 1, lastSeq: 12,
    })
  })
})

describe('路由锚定 —— request/header 类事件为准', () => {
  it('usage 出现在任何 request/header 之前 → 归 unknown/unknown 路由(不猜)', () => {
    const metrics = aggregateSessionMetrics([
      turnStart(1, 100, 1),
      assistantUsage(2, 101, 1, 1, { inputTokens: 10, outputTokens: 5 }),
    ])
    expect(metrics.routes).toHaveLength(1)
    expect(metrics.routes[0]).toMatchObject({ provider: 'unknown', model: 'unknown', priced: false })
    expect(metrics.unpricedBilledTokens).toBe(15)
    expect(metrics.costUsd).toBe(0)
  })

  it('request/context(仅在路由变化时记录)同样锚定路由', () => {
    const metrics = aggregateSessionMetrics([
      turnStart(1, 100, 1),
      requestContext(2, 101, 'deepseek', 'deepseek-chat'),
      assistantUsage(3, 102, 1, 1, { inputTokens: 1000_000, outputTokens: 0 }),
    ])
    expect(metrics.routes[0]).toMatchObject({ provider: 'deepseek', model: 'deepseek-chat' })
    // 1M input × $0.27(DEFAULT_PRICING 命中 deepseek-chat)
    expect(metrics.costUsd).toBeCloseTo(0.27, 6)
  })

  it('中途换 header(request/header reason=change)→ usage 分别归各自路由', () => {
    const metrics = aggregateSessionMetrics([
      turnStart(1, 100, 1),
      requestHeader(2, 101, 'deepseek', 'deepseek-chat'),
      assistantUsage(3, 102, 1, 1, { inputTokens: 100, outputTokens: 0 }),
      requestHeader(4, 103, 'deepseek', 'deepseek-reasoner', 'change'),
      assistantUsage(5, 104, 1, 2, { inputTokens: 100, outputTokens: 0 }),
    ])
    expect(metrics.routes.map(route => route.model)).toEqual(['deepseek-chat', 'deepseek-reasoner'])
    expect(metrics.routes[0]?.tokens.input).toBe(100)
    expect(metrics.routes[1]?.tokens.input).toBe(100)
  })

  it('自定义价格表全量覆写 + 通配 * 兜底未知路由', () => {
    const pricing: PricingTable = {
      '*': { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1 },
    }
    const metrics = aggregateSessionMetrics(
      [
        turnStart(1, 100, 1),
        requestHeader(2, 101, 'acme', 'acme-x'),
        assistantUsage(3, 102, 1, 1, { inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 1_000_000 }),
      ],
      { pricing },
    )
    expect(metrics.unpricedBilledTokens).toBe(0)
    // 1M input × $1 + 1M cacheRead × $0.5 + 0.5M output × $2 = 1 + 0.5 + 1 = 2.5
    expect(metrics.costUsd).toBeCloseTo(2.5, 6)
  })

  it('DEFAULT_PRICING 未命中且无通配 → 不猜价:成本 0、billed 计入 unpriced', () => {
    const metrics = aggregateSessionMetrics([
      turnStart(1, 100, 1),
      requestHeader(2, 101, 'acme', 'acme-y'),
      assistantUsage(3, 102, 1, 1, { inputTokens: 42, outputTokens: 8 }),
    ])
    expect(metrics.costUsd).toBe(0)
    expect(metrics.unpricedBilledTokens).toBe(50)
    expect(metrics.routes[0]?.priced).toBe(false)
  })
})

describe('口径边界', () => {
  it('无任何缓存桶上报 → cacheHitRate = null(未知,不伪报 0)', () => {
    const metrics = aggregateSessionMetrics([
      turnStart(1, 100, 1),
      requestHeader(2, 101, 'deepseek', 'deepseek-chat'),
      assistantUsage(3, 102, 1, 1, { inputTokens: 100, outputTokens: 50 }),
    ])
    expect(metrics.cacheHitRate).toBeNull()
  })

  it('零轮(turn/start 缺失)→ perTurn 三项为 null', () => {
    const metrics = aggregateSessionMetrics([
      requestHeader(1, 100, 'deepseek', 'deepseek-chat'),
      assistantUsage(2, 101, 1, 1, { inputTokens: 10, outputTokens: 5 }),
    ])
    expect(metrics.turns).toBe(0)
    expect(metrics.perTurn).toEqual({ costPerTurn: null, billedTokensPerTurn: null, errorTurnRate: null })
  })

  it('空事件流 → 全零快照,billed=0,cacheHitRate=null', () => {
    const metrics = aggregateSessionMetrics([])
    expect(metrics).toMatchObject({
      turns: 0, steps: 0, modelCalls: 0, costUsd: 0, unpricedBilledTokens: 0, cacheHitRate: null,
    })
    expect(metrics.tokens.billed).toBe(0)
    expect(metrics.window.events).toBe(0)
  })

  it('不带 usage 的 assistant/message 不计入 modelCalls(adapter 未上报)', () => {
    const metrics = aggregateSessionMetrics([
      turnStart(1, 100, 1),
      requestHeader(2, 101, 'deepseek', 'deepseek-chat'),
      assistantNoUsage(3, 102, 1, 1),
    ])
    expect(metrics.modelCalls).toBe(0)
    expect(metrics.tokens.billed).toBe(0)
  })

  it('坏数据防御:usage 非 object / 负数 / 缺 inputTokens → 该条不计,不崩', () => {
    const metrics = aggregateSessionMetrics([
      turnStart(1, 100, 1),
      ev('assistant/message', 2, 101, { turn: 1, step: 1, usage: 'not-usage' }),
      ev('assistant/message', 3, 102, { turn: 1, step: 2, usage: { inputTokens: -5, outputTokens: 3 } }),
      ev('assistant/message', 4, 103, { turn: 1, step: 3, usage: { outputTokens: 3 } }),
      ev('assistant/message', 5, 104, { turn: 1, step: 4, usage: { inputTokens: 7, outputTokens: 3 } }),
      ev('request/header', 6, 105, 'bad-shape'),
      noise(7, 106),
      ev('turn/end', 8, 107, { turn: 1, reason: 'malformed-not-object' }),
    ])
    expect(metrics.modelCalls).toBe(1)
    expect(metrics.tokens.billed).toBe(10)
    expect(metrics.turnEnd['unknown']).toBe(1)
    // steps 来自 step/start 去重:本流没有 step/start → 0(usage 事件中的 step 字段不重复计步)
    expect(metrics.steps).toBe(0)
  })

  it('DEFAULT_PRICING 的 DeepSeek 两条目存在且 cacheWrite 回落 input 价', () => {
    expect(DEFAULT_PRICING['deepseek/deepseek-chat']).toBeDefined()
    expect(DEFAULT_PRICING['deepseek/deepseek-reasoner']).toBeDefined()
    // cacheWrite 100 万 × input 价 0.27 = 0.27(写缓存按输入计费口径)
    const metrics = aggregateSessionMetrics([
      turnStart(1, 100, 1),
      requestHeader(2, 101, 'deepseek', 'deepseek-chat'),
      assistantUsage(3, 102, 1, 1, { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000 }),
    ])
    expect(metrics.costUsd).toBeCloseTo(0.27, 6)
  })
})
