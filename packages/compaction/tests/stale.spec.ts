/**
 * C6 stale-pruner 单测（22 号 §4-C6 验收清单）：分组边界（恰好 N 组/N+1 组）、
 * error 豁免、富块豁免、回收下限（差 1 token 不动）、占位符文案、shadow-price
 * 事件与 replace 的顺序与字段、压力未达 null；另钉死 tracker 取数纪律
 * （session/event 订阅喂入、seed 不可见）与 pre-step 触发链（resolveModelInfo
 * 取窗口、异常不阻断）。
 *
 * 取数纪律（勘察 S'-1）：实现零 deprecated 读法；本 spec 仅在 seed 回放一处用
 * snapshotEvents（上游允许测试调用，行内豁免）。
 */
import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, freezeMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, Message, ToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { estimateMessage } from '@deepseek-ai/dsh-token-meter/estimate'
// Type-only: the `compaction/*` SessionEventMap merges (assertions on the shadow-price event).
import type {} from '@deepseek-ai/dsh-compaction'
import { StaleToolResultPruner } from '../src/stale/index.ts'
import { resolveStaleConfig, STALE_PRUNE_MARKER } from '../src/stale/config.ts'
import type { StalePruneConfig } from '../src/stale/types.ts'

// ---------------------------------------------------------------------------
// 确定性 fake 面（自包含，不动 tests/helpers/fakes.ts）
// ---------------------------------------------------------------------------

/** 单文本块快捷构造。 */
function textBlock(value: string): ContentBlock {
  return { type: 'text', text: value }
}

/** 与实现同源的估价纯函数（测试负载全为文本，heuristic 与 route 两价一致）。 */
function priceOf(message: Message): number {
  return estimateMessage(message)
}

/** 实现 placeholder 公式的镜像（22 号 §4-C6 步骤 4：原文价 − 占位估价）。 */
function expectedPlaceholderPrice(original: ToolResultMessage): number {
  return estimateMessage(freezeMessage<ToolResultMessage>({
    ...original,
    content: [textBlock(STALE_PRUNE_MARKER)],
  }))
}

/** fakeMeter 的结构面（消费侧以 as unknown as Context 收窄，只承诺 totalTokens/estimateMessage）。 */
function createFakeMeter() {
  return {
    estimateMessage: (message: Message) => estimateMessage(message),
    measure: (session: Session) => {
      const totalTokens = session.deriveMessages().reduce((sum, message) => sum + estimateMessage(message), 0)
      return { totalTokens }
    },
  }
}

interface FakeCtxHarness {
  readonly ctx: unknown
  listenersOf(event: string): Array<(...args: never[]) => unknown>
  readonly warns: string[]
  readonly infos: string[]
  readonly llmCalls: number
  setModelInfo(info: { contextWindow?: number } | undefined): void
  setModelInfoError(error: Error | undefined): void
}

/**
 * 结构性假 ctx：声明构造器触达的全部读法（on/logger/tokenMeter/llm.
 * resolveModelInfo/reflect.provide），不依赖真实 cordis 运行时。reflect.provide
 * 承接 Service 构造器注册（cordis src/service.ts:57）。
 */
function makeFakeCtx(): FakeCtxHarness {
  const listeners = new Map<string, Array<(...args: never[]) => unknown>>()
  const warns: string[] = []
  const infos: string[] = []
  let llmCallCount = 0
  let modelInfo: { contextWindow?: number } | undefined
  let modelInfoError: Error | undefined
  const ctx = {
    on: (event: string, listener: (...args: never[]) => unknown) => {
      const set = listeners.get(event) ?? []
      set.push(listener)
      listeners.set(event, set)
      return () => {
        listeners.set(event, set.filter(registered => registered !== listener))
      }
    },
    logger: {
      info: (message: string) => { infos.push(message) },
      warn: (message: string) => { warns.push(message) },
    },
    get: (_name: string) => undefined,
    tokenMeter: createFakeMeter(),
    llm: {
      resolveModelInfo: async () => {
        llmCallCount += 1
        if (modelInfoError !== undefined) throw modelInfoError
        if (modelInfo === undefined) return {}
        return modelInfo.contextWindow === undefined ? {} : { context: { contextWindow: modelInfo.contextWindow } }
      },
    },
    reflect: { provide: () => {} },
  }
  return {
    ctx,
    listenersOf: event => [...(listeners.get(event) ?? [])],
    warns,
    infos,
    get llmCalls() { return llmCallCount },
    setModelInfo: (value) => { modelInfo = value },
    setModelInfoError: (value) => { modelInfoError = value },
  }
}

interface ToolResultOptions {
  /** 落一条带失败身份的 tool/result（message.isError 与 data.error 成对）。 */
  error?: { name: string; code: string; reason?: string }
  /** 只置 isError（无 data.error——实现层加严豁免的钉死用例）。 */
  isError?: boolean
  /** content 混入非文本块（image 富块豁免钉死用例；块形按 event 校验面只需 JSON 值）。 */
  rich?: boolean
}

/** 落一条 tool/result（surfaceOp append），返回事件本体。 */
function appendToolResult(
  session: Session,
  turn: number,
  step: number,
  callId: string,
  body: string,
  options: ToolResultOptions = {},
): SessionEvent<'tool/result'> {
  const richBlock = { type: 'image' } as unknown as ContentBlock
  const content: ContentBlock[] = options.rich === true
    ? [textBlock(body), richBlock]
    : [textBlock(body)]
  return session.append('tool/result', {
    turn,
    step,
    message: createToolResultMessage({
      callId: ToolCallId(callId),
      content,
      isError: options.error !== undefined || options.isError === true,
    }),
    ...options.error === undefined ? {} : { error: options.error },
  }, { surfaceOp: 'append' })
}

/** 落一条 request/header（pre-step 触发链的 routedTarget 读取源）。 */
function appendRequestHeader(session: Session, provider = 'p', model = 'm'): SessionSeq {
  return session.append('request/header', {
    header: { config: { provider, model } },
    reason: 'initial',
  }).seq
}

/** 取事件的派生 tool 消息（不为 null 才有意义，否则测试直接失败）。 */
function toolMessageOf(session: Session, event: SessionEvent<'tool/result'>): ToolResultMessage {
  const message = session.deriveEventMessage(event)
  if (message === null || message.role !== 'tool') throw new Error('expected a derived tool-result message')
  return message
}

/** 包装 session.append 录制落盘事件（不读 log——log 读法已 deprecated）。 */
function spyAppend(session: Session, sink: SessionEvent[]): void {
  type AppendFn = (type: string, data: unknown, ...opts: unknown[]) => SessionEvent
  const real = session.append.bind(session) as unknown as AppendFn
  ;(session as unknown as { append: AppendFn }).append = (type, data, ...opts) => {
    const event = real(type, data, ...opts)
    sink.push(event)
    return event
  }
}

/** pre-step 监听器的结构面（测试显式派发）。 */
type PreStepListener = (
  payload: { agent: Agent; signal: AbortSignal },
  next: () => Promise<PreStepDecision>,
) => Promise<PreStepDecision>

/** 结构兼容 pruneForStep 读法的最小 agent 面。 */
function makeFakeAgent(session: Session): Agent {
  return { session } as unknown as Agent
}

interface StaleHarness {
  readonly harness: FakeCtxHarness
  readonly pruner: StaleToolResultPruner
  readonly session: Session
  /** 经构造器注册的 session/event 监听器喂入事件（wire 真实走一遍）。 */
  deliver: (event: SessionEvent, to?: Session) => void
  appendTracked: (turn: number, callId: string, body: string, options?: ToolResultOptions) => SessionEvent<'tool/result'>
}

/**
 * harness：先构造服务（监听器注册进 fake ctx），再建会话；appendTracked =
 * append + deliver（模拟生产中 post-commit append feed）。可注入既有会话
 * （seed 恢复场景）。
 */
function makeStaleHarness(config: StalePruneConfig = {}, existing?: Session): StaleHarness {
  const harness = makeFakeCtx()
  const pruner = new StaleToolResultPruner(harness.ctx as Context, config)
  const session = existing ?? Session.create(SessionId('stale-test'))
  const deliver = (event: SessionEvent, to: Session = session) => {
    for (const listener of harness.listenersOf('session/event')) {
      ;(listener as unknown as (target: Session, delivered: SessionEvent) => void)(to, event)
    }
  }
  const appendTracked = (turn: number, callId: string, body: string, options?: ToolResultOptions) => {
    const event = appendToolResult(session, turn, 0, callId, body, options)
    deliver(event)
    return event
  }
  return { harness, pruner, session, deliver, appendTracked }
}

/** 标准 prunable 会话：turn 1 大候选 + turn 2 保留组（keepGroups=1 时恰好 2 组）。 */
function makePrunableSession(body = 'r'.repeat(4000)) {
  const harness = makeStaleHarness({ keepGroups: 1, minSavingsTokens: 1 })
  const candidate = harness.appendTracked(1, 'call-1', body)
  harness.appendTracked(2, 'call-2', 'kept')
  return { ...harness, candidate }
}

describe('resolveStaleConfig', () => {
  it('默认值 5/4096/0.7（22 号 §6 配置面全表）', () => {
    expect(resolveStaleConfig()).toEqual({ keepGroups: 5, minSavingsTokens: 4096, thresholdRatio: 0.7 })
  })

  it('显式覆盖生效', () => {
    expect(resolveStaleConfig({ keepGroups: 3, minSavingsTokens: 100, thresholdRatio: 0.9 }))
      .toEqual({ keepGroups: 3, minSavingsTokens: 100, thresholdRatio: 0.9 })
  })

  it('未知键拒绝', () => {
    expect(() => resolveStaleConfig({ keepGroups: 1, extra: true } as StalePruneConfig))
      .toThrow(/unknown key "extra"/)
  })

  it('非法值拒绝：非正整数 keepGroups/minSavingsTokens 与出界 thresholdRatio', () => {
    expect(() => resolveStaleConfig({ keepGroups: 0 })).toThrow(/keepGroups/)
    expect(() => resolveStaleConfig({ keepGroups: 1.5 })).toThrow(/keepGroups/)
    expect(() => resolveStaleConfig({ minSavingsTokens: 0 })).toThrow(/minSavingsTokens/)
    expect(() => resolveStaleConfig({ thresholdRatio: 0 })).toThrow(/thresholdRatio/)
    expect(() => resolveStaleConfig({ thresholdRatio: 1.1 })).toThrow(/thresholdRatio/)
    expect(() => resolveStaleConfig({ thresholdRatio: Number.NaN })).toThrow(/thresholdRatio/)
  })
})

describe('pruneStale：压力门与分组豁免', () => {
  it('压力未达 floor(contextWindow×thresholdRatio) → null 且不 append', () => {
    const { pruner, session, appendTracked } = makeStaleHarness({ keepGroups: 1, minSavingsTokens: 1 })
    appendTracked(1, 'call-1', 'r'.repeat(2000))
    appendTracked(2, 'call-2', 'r'.repeat(2000))
    const seqBefore = session.seq
    // threshold = floor(10_000_000 × 0.7) = 7_000_000 ≫ 实际压力
    expect(pruner.pruneStale(session, 10_000_000)).toBeNull()
    expect(session.seq).toBe(seqBefore)
  })

  it('恰好 keepGroups 组 → 全部豁免返回 null', () => {
    const { pruner, session, appendTracked } = makeStaleHarness({ keepGroups: 2, minSavingsTokens: 1 })
    appendTracked(2, 'call-2', 'r'.repeat(2000))
    appendTracked(3, 'call-3', 'r'.repeat(2000))
    expect(pruner.pruneStale(session, 10)).toBeNull()
  })

  it('N+1 组 → 只清最老组，其余组豁免', () => {
    const { pruner, session, appendTracked } = makeStaleHarness({ keepGroups: 2, minSavingsTokens: 1 })
    const oldest = appendTracked(1, 'call-1', 'r'.repeat(2000))
    appendTracked(2, 'call-2', 'r'.repeat(2000))
    appendTracked(3, 'call-3', 'r'.repeat(2000))
    const result = pruner.pruneStale(session, 10)
    expect(result).not.toBeNull()
    expect(result?.pruned.map(entry => entry.seq)).toEqual([oldest.seq])
    expect(result?.pruned.map(entry => entry.turn)).toEqual([1])
  })

  it('data.error 非空的结果豁免（失败证据保留）→ 唯一候选豁免后 null', () => {
    const { pruner, session, appendTracked } = makeStaleHarness({ keepGroups: 1, minSavingsTokens: 1 })
    appendTracked(1, 'call-1', 'r'.repeat(4000), { error: { name: 'ToolError', code: 'TOOL_FAILED' } })
    appendTracked(2, 'call-2', 'kept')
    expect(pruner.pruneStale(session, 10)).toBeNull()
  })

  it('isError 无 data.error 的结果同样豁免（失败证据保留的加严，偏离说明见交付）', () => {
    const { pruner, session, appendTracked } = makeStaleHarness({ keepGroups: 1, minSavingsTokens: 1 })
    appendTracked(1, 'call-1', 'r'.repeat(4000), { isError: true })
    appendTracked(2, 'call-2', 'kept')
    expect(pruner.pruneStale(session, 10)).toBeNull()
  })

  it('非文本主导块（image 富块）的结果豁免', () => {
    const { pruner, session, appendTracked } = makeStaleHarness({ keepGroups: 1, minSavingsTokens: 1 })
    appendTracked(1, 'call-1', 'r'.repeat(4000), { rich: true })
    appendTracked(2, 'call-2', 'kept')
    expect(pruner.pruneStale(session, 10)).toBeNull()
  })

  it('回收下限边界：恰好达到下限落地，差 1 token 不动手', () => {
    // probe 会话算出确定性 savings（同源 estimateMessage，22 号 §4-C6 步骤 4 公式）。
    const probe = makePrunableSession()
    const original = toolMessageOf(probe.session, probe.candidate)
    const savings = priceOf(original) - expectedPlaceholderPrice(original)
    expect(savings).toBeGreaterThan(0)

    const landed = makeStaleHarness({ keepGroups: 1, minSavingsTokens: savings })
    landed.appendTracked(1, 'call-1', 'r'.repeat(4000))
    landed.appendTracked(2, 'call-2', 'kept')
    expect(landed.pruner.pruneStale(landed.session, 10)).not.toBeNull()

    const gated = makeStaleHarness({ keepGroups: 1, minSavingsTokens: savings + 1 })
    gated.appendTracked(1, 'call-1', 'r'.repeat(4000))
    gated.appendTracked(2, 'call-2', 'kept')
    expect(gated.pruner.pruneStale(gated.session, 10)).toBeNull()
  })
})

describe('pruneStale：shadow-price 协议与占位符', () => {
  it('shadow-price 事件与 replace 的顺序与字段 + 占位符文案', () => {
    const { pruner, session, candidate } = makePrunableSession()
    const original = toolMessageOf(session, candidate)
    const appended: SessionEvent[] = []
    spyAppend(session, appended)

    const result = pruner.pruneStale(session, 10)
    expect(result).not.toBeNull()
    expect(appended.map(event => event.type)).toEqual(['compaction/prune', 'tool/result'])

    const shadow = appended[0] as SessionEvent<'compaction/prune'>
    expect(shadow.data).toEqual({
      shadowedRange: { start: candidate.seq, end: candidate.seq },
      shadowedSeqs: [candidate.seq],
      shadowedTokenCount: priceOf(original),
    })

    const replacement = appended[1] as SessionEvent<'tool/result'>
    expect(replacement.surfaceOp).toEqual({ op: 'replace', startSeq: candidate.seq, endSeq: candidate.seq })
    expect(replacement.sourceEventSeqs).toEqual([candidate.seq])
    expect(replacement.data.turn).toBe(1)
    expect(replacement.data.step).toBe(0)
    expect(replacement.data.message.content).toEqual([textBlock(STALE_PRUNE_MARKER)])

    // 派生历史里旧原文消失、占位符就位；保留组的原文不动。
    const firstBlock = original.content[0]
    const originalText = firstBlock?.type === 'text' ? firstBlock.text : ''
    const toolMessages = session.deriveMessages().filter(message => message.role === 'tool')
    expect(toolMessages.some(message => message.content.some(
      block => block.type === 'text' && block.text === STALE_PRUNE_MARKER,
    ))).toBe(true)
    expect(toolMessages.some(message => message.content.some(
      block => block.type === 'text' && block.text === 'kept',
    ))).toBe(true)
    expect(toolMessages.some(message => message.content.some(
      block => block.type === 'text' && block.text === originalText,
    ))).toBe(false)
  })

  it('savedTokens = Σ(原文价 − 占位价)，pruned 记录 seq/turn/原文价，组内 seq 升序', () => {
    const { pruner, session, appendTracked } = makeStaleHarness({ keepGroups: 1, minSavingsTokens: 1 })
    const first = appendTracked(1, 'call-1', 'r'.repeat(2000))
    const second = appendTracked(1, 'call-2', 's'.repeat(3000))
    appendTracked(2, 'call-3', 'kept')
    const expectedSaved = [first, second].reduce(
      (sum, event) => sum + priceOf(toolMessageOf(session, event)) - expectedPlaceholderPrice(toolMessageOf(session, event)),
      0,
    )

    const result = pruner.pruneStale(session, 10)
    expect(result).not.toBeNull()
    expect(result?.pruned.map(entry => entry.seq)).toEqual([first.seq, second.seq])
    expect(result?.pruned.map(entry => entry.turn)).toEqual([1, 1])
    expect(result?.pruned.map(entry => entry.shadowedTokenCount))
      .toEqual([first, second].map(event => priceOf(toolMessageOf(session, event))))
    expect(result?.savedTokens).toBe(expectedSaved)
  })

  it('零收益候选（已清占位）不会二次落地（幂等）', () => {
    const { harness, pruner, session, deliver, appendTracked } = makeStaleHarness({ keepGroups: 1, minSavingsTokens: 1 })
    appendTracked(1, 'call-1', 'r'.repeat(4000))
    appendTracked(2, 'call-2', 'kept')
    const appended: SessionEvent[] = []
    spyAppend(session, appended)
    expect(pruner.pruneStale(session, 10)).not.toBeNull()

    // 生产路径里 replacement 经 session/event 回流 tracker；测试手动喂入。
    const replacement = appended[1]
    if (replacement === undefined) throw new Error('expected the replacement event')
    deliver(replacement)
    expect(pruner.pruneStale(session, 10)).toBeNull()
    expect(harness.warns).toEqual([])
  })
})

describe('tracker 取数纪律（S\'-1）', () => {
  it('session/event 订阅喂入：deliver 过的事件可被清理（wire 真实走监听器）', () => {
    const harness = makeStaleHarness({ keepGroups: 1, minSavingsTokens: 1 })
    // 不经 appendTracked：手动 append 后 deliver，确认 tracker 由订阅面喂入。
    const event = appendToolResult(harness.session, 1, 0, 'call-1', 'r'.repeat(4000))
    expect(harness.pruner.pruneStale(harness.session, 10)).toBeNull()
    harness.deliver(event)
    const kept = appendToolResult(harness.session, 2, 0, 'call-2', 'kept')
    harness.deliver(kept)
    expect(harness.pruner.pruneStale(harness.session, 10)).not.toBeNull()
  })

  it('tracker 按 session 隔离（WeakMap 键 = 会话实例）', () => {
    const harness = makeFakeCtx()
    const pruner = new StaleToolResultPruner(harness.ctx as Context, { keepGroups: 1, minSavingsTokens: 1 })
    const deliver = (to: Session, event: SessionEvent) => {
      for (const listener of harness.listenersOf('session/event')) {
        ;(listener as unknown as (target: Session, delivered: SessionEvent) => void)(to, event)
      }
    }
    const first = Session.create(SessionId('stale-a'))
    const second = Session.create(SessionId('stale-b'))
    const candidate = appendToolResult(first, 1, 0, 'call-1', 'r'.repeat(4000))
    deliver(first, candidate)
    const kept = appendToolResult(first, 2, 0, 'call-2', 'kept')
    deliver(first, kept)

    const landed = pruner.pruneStale(first, 10)
    expect(landed).not.toBeNull()
    expect(landed?.pruned.map(entry => entry.seq)).toEqual([candidate.seq])
    // 第二个会话 tracker 为空 → 即使压力达标也不动手。
    expect(pruner.pruneStale(second, 10)).toBeNull()
  })

  it('seed 事件不经 session/event 发布 → pruneStale 直调（未 rescan）不动手（直调保守面保留）', () => {
    const source = makePrunableSession()
    expect(source.session.surface.nodes.length).toBeGreaterThan(0)
    // 测试面全量回放只读（S'-1 结论 ③：foldSurface/snapshotEvents 允许测试调用）。
    // oxlint-disable-next-line typescript/no-deprecated -- 测试面回放只读(S'-1 行内豁免)。
    const seed = source.session.snapshotEvents()
    const resumed = Session.create(SessionId('stale-resumed'), seed)
    const resumedHarness = makeStaleHarness({ keepGroups: 1, minSavingsTokens: 1 }, resumed)
    // 直调 pruneStale 不触发 rescan：tracker 空 → null（rescan 只挂在 pre-step 链）。
    expect(resumedHarness.pruner.pruneStale(resumed, 10)).toBeNull()
  })

})

describe('pre-step 触发链', () => {
  function preStepListenerOf(harness: FakeCtxHarness): PreStepListener {
    const listener = harness.listenersOf('agent/pre-step')[0]
    if (listener === undefined) throw new Error('agent/pre-step listener not registered')
    return listener as unknown as PreStepListener
  }

  const NEXT_REJECT: () => Promise<PreStepDecision> = async () => ({ kind: 'reject' })

  function markerPresent(session: Session): boolean {
    return session.deriveMessages().some(message => message.role === 'tool' && message.content.some(
      block => block.type === 'text' && block.text === STALE_PRUNE_MARKER,
    ))
  }

  it('resolveModelInfo 提供窗口 → 落地占位并原样放行 next() 决定', async () => {
    const { harness, session, appendTracked } = makeStaleHarness({ keepGroups: 1, minSavingsTokens: 1 })
    appendTracked(1, 'call-1', 'r'.repeat(4000))
    appendTracked(2, 'call-2', 'kept')
    appendRequestHeader(session)
    harness.setModelInfo({ contextWindow: 10 })

    const decision = await preStepListenerOf(harness)({ agent: makeFakeAgent(session), signal: new AbortController().signal }, NEXT_REJECT)
    expect(decision).toEqual({ kind: 'reject' })
    expect(markerPresent(session)).toBe(true)
    expect(harness.infos.some(info => info.includes('stale tool-result prune'))).toBe(true)
  })

  it('压力未达 → 不清理（resolveModelInfo 已调）', async () => {
    const { harness, session, appendTracked } = makeStaleHarness({ keepGroups: 1, minSavingsTokens: 1 })
    appendTracked(1, 'call-1', 'r'.repeat(4000))
    appendTracked(2, 'call-2', 'kept')
    appendRequestHeader(session)
    harness.setModelInfo({ contextWindow: 10_000_000 })

    await preStepListenerOf(harness)({ agent: makeFakeAgent(session), signal: new AbortController().signal }, NEXT_REJECT)
    expect(markerPresent(session)).toBe(false)
  })

  it('resolveModelInfo 抛错 → warn 不阻断，next() 照常返回', async () => {
    const { harness, session, appendTracked } = makeStaleHarness({ keepGroups: 1, minSavingsTokens: 1 })
    appendTracked(1, 'call-1', 'r'.repeat(4000))
    appendTracked(2, 'call-2', 'kept')
    appendRequestHeader(session)
    harness.setModelInfoError(new Error('no route'))

    const decision = await preStepListenerOf(harness)({ agent: makeFakeAgent(session), signal: new AbortController().signal }, NEXT_REJECT)
    expect(decision).toEqual({ kind: 'reject' })
    expect(harness.warns).toHaveLength(1)
    expect(harness.warns[0]).toContain('stale tool-result prune failed')
    expect(harness.warns[0]).toContain('no route')
    expect(markerPresent(session)).toBe(false)
  })

  it('无 request/header → 不调 resolveModelInfo 直接跳过', async () => {
    const { harness, session, appendTracked } = makeStaleHarness({ keepGroups: 1, minSavingsTokens: 1 })
    appendTracked(1, 'call-1', 'r'.repeat(4000))
    appendTracked(2, 'call-2', 'kept')
    harness.setModelInfo({ contextWindow: 10 })

    await preStepListenerOf(harness)({ agent: makeFakeAgent(session), signal: new AbortController().signal }, NEXT_REJECT)
    expect(harness.llmCalls).toBe(0)
    expect(markerPresent(session)).toBe(false)
  })

  it('无容量信息（context 缺席）→ 静默跳过，不 warn', async () => {
    const { harness, session, appendTracked } = makeStaleHarness({ keepGroups: 1, minSavingsTokens: 1 })
    appendTracked(1, 'call-1', 'r'.repeat(4000))
    appendTracked(2, 'call-2', 'kept')
    appendRequestHeader(session)
    harness.setModelInfo({})

    await preStepListenerOf(harness)({ agent: makeFakeAgent(session), signal: new AbortController().signal }, NEXT_REJECT)
    expect(harness.llmCalls).toBe(1)
    expect(harness.warns).toEqual([])
    expect(markerPresent(session)).toBe(false)
  })

  it('signal 已中止 → 跳过清理，不调 resolveModelInfo', async () => {
    const { harness, session, appendTracked } = makeStaleHarness({ keepGroups: 1, minSavingsTokens: 1 })
    appendTracked(1, 'call-1', 'r'.repeat(4000))
    appendTracked(2, 'call-2', 'kept')
    appendRequestHeader(session)
    harness.setModelInfo({ contextWindow: 10 })
    const controller = new AbortController()
    controller.abort()

    await preStepListenerOf(harness)({ agent: makeFakeAgent(session), signal: controller.signal }, NEXT_REJECT)
    expect(harness.llmCalls).toBe(0)
    expect(markerPresent(session)).toBe(false)
  })
  it('恢复会话经 pre-step rescan → 历史 tool/result 可清理（2026-11-15 P1-6 限制解除）', async () => {
    const source = makePrunableSession()
    // oxlint-disable-next-line typescript/no-deprecated -- 测试面回放只读(S'-1 行内豁免)。
    const seed = source.session.snapshotEvents()
    const resumed = Session.create(SessionId('stale-resumed-prestep'), seed)
    const resumedHarness = makeStaleHarness({ keepGroups: 1, minSavingsTokens: 1 }, resumed)
    appendRequestHeader(resumed)
    resumedHarness.harness.setModelInfo({ contextWindow: 10 })

    await preStepListenerOf(resumedHarness.harness)(
      { agent: makeFakeAgent(resumed), signal: new AbortController().signal },
      NEXT_REJECT,
    )
    // rescan 把 seed 历史收进 tracker → 压力达标 → 占位落地。
    expect(markerPresent(resumed)).toBe(true)
    // 第二次 pre-step 不重复 rescan（WeakSet 记账），且已清节点不再回收。
  })

})
