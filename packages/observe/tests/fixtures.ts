/**
 * fixture 事件流工厂:自造结构兼容 dsh SessionEvent 的事件数组(单测共用)。
 * 事件形态依据 deepseek-harness packages/core/session/src/types.ts:258-436(SessionEventMap):
 * turn/start { turn } / turn/end { turn, reason: { kind } } / step/start { turn, step } /
 * request/header { header: { config: { provider, model } }, reason } /
 * request/context { provider, model } / assistant/message { turn, step, usage?: TokenUsage }。
 */
import type { SessionEventLike } from '../src/index.ts'

export interface FixtureEventSpec {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
}

/** 单条 fixture 事件。 */
export function ev(type: string, seq: number, time: number, data: unknown): FixtureEventSpec {
  return { type, seq, time, data }
}

export function turnStart(seq: number, time: number, turn: number): FixtureEventSpec {
  return ev('turn/start', seq, time, { turn })
}

export function turnEnd(seq: number, time: number, turn: number, reasonKind = 'completed'): FixtureEventSpec {
  return ev('turn/end', seq, time, { turn, reason: { kind: reasonKind } })
}

export function stepStart(seq: number, time: number, turn: number, step: number): FixtureEventSpec {
  return ev('step/start', seq, time, { turn, step })
}

/** request/header:路由锚点(本期验收口径:request/header 类事件为准)。 */
export function requestHeader(
  seq: number,
  time: number,
  provider: string,
  model: string,
  reason: 'initial' | 'resume' | 'change' | 'series' = 'initial',
): FixtureEventSpec {
  return ev('request/header', seq, time, { header: { config: { provider, model } }, reason })
}

export function requestContext(seq: number, time: number, provider: string, model: number | string): FixtureEventSpec {
  return ev('request/context', seq, time, { provider, model })
}

/** assistant/message(带互斥四桶 usage;reasoning 已含在 outputTokens 内)。 */
export function assistantUsage(
  seq: number,
  time: number,
  turn: number,
  step: number,
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    reasoningTokens?: number
  },
): FixtureEventSpec {
  return ev('assistant/message', seq, time, { turn, step, message: { role: 'assistant' }, stream: [], usage })
}

/** 不带 usage 的 assistant/message(adapter 未上报)。 */
export function assistantNoUsage(seq: number, time: number, turn: number, step: number): FixtureEventSpec {
  return ev('assistant/message', seq, time, { turn, step, message: { role: 'assistant' }, stream: [] })
}

/** 无关事件(聚合器应静默跳过)。 */
export function noise(seq: number, time: number): FixtureEventSpec {
  return ev('tool/result', seq, time, { turn: 1, step: 1, message: { toolCallId: 't1', isError: false } })
}

/**
 * feedback/message-put 事件(形态:packages/feedback/message-feedback/src/types.ts:33-38):
 * { sessionId, item: { messageId, rating, note?, category?, version, createdAt, updatedAt } }。
 */
export function feedbackPutLike(
  sessionId: string,
  messageId: string,
  rating: 'positive' | 'negative',
  extra: { note?: string; category?: string } = {},
): SessionEventLike {
  return {
    type: 'feedback/message-put',
    seq: 1,
    time: 1_000,
    data: {
      sessionId,
      item: {
        messageId,
        rating,
        ...(extra.note !== undefined && { note: extra.note }),
        ...(extra.category !== undefined && { category: extra.category }),
        version: 'v1',
        createdAt: 1_000,
        updatedAt: 1_000,
      },
    },
  }
}

/**
 * 标准两轮三步 fixture(混合路由 + 缓存桶):
 * - turn1:header deepseek/deepseek-chat → step1(usage:100 in/50 cacheRead/200 out)
 *                          → step2(usage:0 in/400 cacheRead/150 out,reasoning 30 已含)
 * - turn2:header 变更 deepseek/deepseek-reasoner → step1(usage:80 in/0 cache/70 out)
 *   turn/end reason=error
 * 期望(手算):
 *   turns=2, steps=3, modelCalls=3
 *   chat 路由: input=100 output=350 cacheRead=450 cacheWrite=0 billed=900
 *   reasoner 路由:input=80  output=70  cacheRead=0   cacheWrite=0 billed=150
 *   cacheHitRate = 450 / (100+450+0+80+0+0) = 450/630 = 0.714285…
 *   cost(chat)    = 100/1e6*0.27 + 450/1e6*0.07 + 350/1e6*1.1  = 0.000027+0.0000315+0.000385 = 0.0004435
 *   cost(reasoner)= 80/1e6*0.55 + 70/1e6*2.19                  = 0.000044+0.0001533 = 0.0001973
 *   cost 合计     = 0.0006408
 */
export function standardFixture(): readonly SessionEventLike[] {
  return [
    turnStart(1, 1_000, 1),
    stepStart(2, 1_001, 1, 1),
    requestHeader(3, 1_002, 'deepseek', 'deepseek-chat'),
    assistantUsage(4, 1_003, 1, 1, { inputTokens: 100, outputTokens: 200, cacheReadTokens: 50 }),
    stepStart(5, 1_004, 1, 2),
    assistantUsage(6, 1_005, 1, 2, { inputTokens: 0, outputTokens: 150, cacheReadTokens: 400, reasoningTokens: 30 }),
    turnEnd(7, 1_006, 1, 'completed'),
    turnStart(8, 2_000, 2),
    stepStart(9, 2_001, 2, 1),
    requestHeader(10, 2_002, 'deepseek', 'deepseek-reasoner', 'change'),
    assistantUsage(11, 2_003, 2, 1, { inputTokens: 80, outputTokens: 70 }),
    turnEnd(12, 2_004, 2, 'error'),
  ]
}
