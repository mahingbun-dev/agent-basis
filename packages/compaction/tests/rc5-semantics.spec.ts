/**
 * rc.5 compaction 语义对照回归(T22 / WP3-2,47 号 B3、54 号 §4.5):
 *
 * 1. **seq/surface 断言**:rc.5 session 数组 append 改批量发布
 *    (`session.seq`/`session.surface` 在发布期已含完整批次,
 *    `currentBatchPublication` 标识当前成员;见 upstream
 *    `packages/core/session/tests/append.spec.ts`)。compaction 的 surface 断言
 *    (`selectCompactableRange` 的 meter/surface 对齐校验)与 shadow-price 替换协议
 *    必须在批量构建的会话上原样成立;发布期监听器读到的 surface/generation 也必须是
 *    整批提交后的终态。
 * 2. **摘要失败走 `LlmError.fromFailure`**(upstream `summarizer.ts` finishError;
 *    P1 H1 已切换):error/aborted 终止把 provider 的 message/code/status/
 *    providerRetryAfterMs/requestId 原样带出,不再用 `new LlmError(msg, code)`。
 * 3. **fork/压缩行为**(upstream `compaction-basic/tests/manual-compaction.spec.ts`):
 *    fork 种子切开的残留 compaction/start 不阻塞子会话手动压缩;reload/fork 后出现
 *    end-seed 的孤儿 bracket 视为陈旧;活 bracket 与开 turn 仍 busy 且零摘要调用。
 *
 * 上游对照源:`deepseek-harness` tag `dsh-v0.2.2-rc.5`
 * `packages/core/session/tests/append.spec.ts`、
 * `packages/compaction/compaction-basic/tests/manual-compaction.spec.ts`、
 * `packages/compaction/compaction-basic/src/summarizer.ts:197-209`。
 */
import { describe, expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CompactionId, ManualCompactionError } from '@deepseek-ai/dsh-compaction'
// Type-only: compaction/* SessionEventMap merges (compaction/prune batch member).
import type {} from '@deepseek-ai/dsh-compaction'
import {
  createSystemMessage,
  createToolResultMessage,
  createUserMessage,
  LlmError,
  ProviderRequestId,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import type { ContentBlock, FinishReason, GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  buildForkSeed,
  Session,
  SessionId,
  SessionSeq,
  SessionStore,
} from '@deepseek-ai/dsh-session'
import type { Session as SessionType } from '@deepseek-ai/dsh-session'
import type { CompactionResult } from '@deepseek-ai/dsh-compaction'
import { estimateMessage } from '@deepseek-ai/dsh-token-meter/estimate'
import { PRUNE_MARKER, ToolResultPruner } from '../src/pruner/index.ts'
import type { ToolResultPruneConfig } from '../src/pruner/types.ts'
import { selectCompactableRange } from '../src/basic/region.ts'
import { summarizeWithLlm } from '../src/basic/summarizer.ts'
import {
  appendAssistantToolCall,
  appendRequestHeader,
  appendTurnStart,
  appendUserMessage,
  createFakeMeter,
  fakeSummarizer,
  makeEngine,
  makeFakeAgent,
  makeFakeEngineContext,
  makeSession,
  MINIMAL_VALID_SUMMARY,
  text,
} from './helpers/fakes.ts'
import type { FakeSummarizerFace } from './helpers/fakes.ts'
import type { BasicCompactionEngine } from '../src/basic/index.ts'

const SIGNAL = new AbortController().signal

/** fake summarizer 的脚本面(compactNow 用例注入)。 */
function makeManualHarness(): {
  engine: BasicCompactionEngine
  face: FakeSummarizerFace
} {
  const harness = makeFakeEngineContext(createFakeMeter())
  const engine = makeEngine(harness.ctx)
  const face = fakeSummarizer([MINIMAL_VALID_SUMMARY])
  // regionDependencies 的动态派发钩子是引擎私有 Promise 方法;测试直覆实例字段。
  ;(engine as unknown as { summarize: unknown }).summarize = face
  return { engine, face }
}

/** 只有 maintenance claim 的 idle 代理(runMaintenance 同步拒绝面不参与这些用例)。 */
function makeIdleAgent(session: SessionType): Agent {
  return {
    id: session.id,
    session,
    options: { provider: 'p', model: 'm' },
    runMaintenance: async <T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> => task(SIGNAL),
  } as unknown as Agent
}

/** 一段已闭合的旧对话:turn 1 内含两条大文本 user(无 system 头,firstIdx=0)。 */
function closedConversation(id: string): SessionType {
  const session = makeSession(id)
  appendTurnStart(session, 1)
  appendRequestHeader(session, 'p', 'm')
  appendUserMessage(session, 'x'.repeat(800))
  appendUserMessage(session, 'y'.repeat(800))
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return session
}

/** 捕获一次只带 finish 的摘要调用的拒绝值(finishError 的映射结果)。 */
async function summarizeFailure(reason: FinishReason): Promise<unknown> {
  const ctx = {
    llm: {
      stream: (_options: GenerateOptions): AsyncIterable<StreamChunk> => (async function* () {
        yield { type: 'finish', reason }
      })(),
    },
  } as unknown as Context
  const session = makeSession('rc5-summary-failure')
  appendRequestHeader(session, 'p', 'm')
  const agent = makeFakeAgent(session, 'p', 'm')
  try {
    await summarizeWithLlm(ctx, {
      summarizationProvider: 'p',
      summarizationModel: 'm',
      maxTokens: 256,
    }, {
      messages: [createUserMessage({ content: [text('hello')], source: { kind: 'user' } })],
    }, agent)
  } catch (error: unknown) {
    return error
  }
  throw new Error('expected summarizeWithLlm to reject')
}

/** Await one classified manual-compaction rejection. */
async function rejection(operation: () => Promise<unknown>): Promise<ManualCompactionError> {
  let caught: unknown
  try {
    const value = await operation()
    throw new Error(`expected a rejection, resolved with ${String(value)}`)
  } catch (error: unknown) {
    caught = error
  }
  if (!(caught instanceof ManualCompactionError)) {
    throw new Error(`expected a ManualCompactionError, got ${String(caught)}`)
  }
  return caught
}

// ---------------------------------------------------------------------------
// 1. rc.5 session 批量 append 发布语义(seq/surface 断言复验)
// ---------------------------------------------------------------------------

describe('rc.5 批量 append 发布语义(seq/surface)', () => {
  it('发布期 session.seq/surface 已含整批,currentBatchPublication 逐成员;compaction surface 断言通过', async () => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('rc5-batch-append'))

    const observed: Array<{
      type: string
      seq: number
      logEnd: number
      batchSeq: number | undefined
      nodes: readonly number[]
    }> = []
    ctx.on('session/event', (current, event) => {
      if (current !== session) return
      observed.push({
        type: event.type,
        seq: event.seq,
        logEnd: current.seq,
        batchSeq: current.currentBatchPublication?.seq,
        nodes: [...current.surface.nodes],
      })
    })

    const userOne = createUserMessage({ content: [text('older one')], source: { kind: 'user' } })
    const userTwo = createUserMessage({ content: [text('older two')], source: { kind: 'user' } })
    const userThree = createUserMessage({ content: [text('older three')], source: { kind: 'user' } })
    const events = session.append([
      ['turn/start', { turn: 1 }],
      ['system/message', { turn: 1, step: 0, message: createSystemMessage('system head') }, { surfaceOp: 'append' }],
      ['user/message', userOne, { surfaceOp: 'append' }],
      ['user/message', userTwo, { surfaceOp: 'append' }],
      ['user/message', userThree, { surfaceOp: 'append' }],
    ])

    // 发布语义:每个成员看到的是整批提交后的日志尾与 surface(rc.5 append.spec.ts 同款)。
    expect(events.map(event => event.seq)).toEqual([0, 1, 2, 3, 4])
    expect(observed.map(entry => entry.type)).toEqual([
      'turn/start', 'system/message', 'user/message', 'user/message', 'user/message',
    ])
    for (const entry of observed) {
      expect(entry.logEnd).toBe(5)
      expect(entry.nodes).toEqual([1, 2, 3, 4])
      expect(entry.batchSeq).toBe(entry.seq)
    }
    expect(observed[1]?.seq).toBe(1)
    expect(session.currentBatchPublication).toBeUndefined()
    expect(session.seq).toBe(5)
    expect(session.surface.nodes).toEqual([1, 2, 3, 4])

    // compaction 的 meter/surface 对齐断言:批量构建的 surface 必须被原样接受。
    const meter = createFakeMeter()
    const measurement = meter.measure(session)
    expect(measurement.nodes.map(node => node.seq)).toEqual([...session.surface.nodes])
    // retain=尾节点价 → 保留最后一条 user,压缩系统头后的前两条(与 basic-region 同口径)。
    const retain = measurement.nodes[3]?.tokens ?? 0
    const range = selectCompactableRange(session, measurement, retain)
    expect(range).toEqual({ start: session.surface.nodes[1], end: session.surface.nodes[2] })

    // 断言本体仍然拒绝错位的 meter 快照(不是放水)。
    const drifted = { ...measurement, nodes: [...measurement.nodes].reverse() }
    expect(() => selectCompactableRange(session, drifted, 0))
      .toThrow('compaction: token-meter surface does not match the current session surface')
  })

  it('同一批内的 shadow-price 替换:发布期 surface/replaceGeneration 已是终态', async () => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('rc5-batch-replace'))

    session.append('turn/start', { turn: 1 })
    const assistantSeq = appendAssistantToolCall(session, 1, 1, 'call-1', 'read')
    const original = session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('call-1'),
        content: [text('x'.repeat(400))],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    const originalSeq = original.seq
    expect(session.surface.replaceGeneration).toBe(0)

    const observed: Array<{
      type: string
      seq: number
      generation: number
      nodes: readonly number[]
      batchSeq: number | undefined
    }> = []
    ctx.on('session/event', (current, event) => {
      if (current !== session) return
      observed.push({
        type: event.type,
        seq: event.seq,
        generation: current.surface.replaceGeneration,
        nodes: [...current.surface.nodes],
        batchSeq: current.currentBatchPublication?.seq,
      })
    })

    const replacement = { ...original.data.message, content: [text('[stale]')] }
    const batch = session.append([
      ['compaction/prune', {
        shadowedRange: { start: originalSeq, end: originalSeq },
        shadowedSeqs: [originalSeq],
        shadowedTokenCount: 100,
      }],
      ['tool/result', { turn: 1, step: 1, message: replacement }, {
        surfaceOp: { op: 'replace', startSeq: originalSeq, endSeq: originalSeq },
        sourceEventSeqs: [originalSeq],
      }],
    ])

    // 两个成员都在整批提交后发布:替换已在 surface 生效、generation 已 +1。
    expect(observed.map(entry => entry.type)).toEqual(['compaction/prune', 'tool/result'])
    for (const entry of observed) {
      expect(entry.generation).toBe(1)
      expect(entry.nodes).toEqual([assistantSeq, batch[1]?.seq])
      expect(entry.batchSeq).toBe(entry.seq)
    }
    expect(session.surface.nodes).toEqual([assistantSeq, batch[1]?.seq])
    expect(session.surface.nodes.includes(originalSeq)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2. 摘要失败走 LlmError.fromFailure(rc.5 summarizer finishError)
// ---------------------------------------------------------------------------

describe('摘要失败 LlmError.fromFailure(rc.5 语义)', () => {
  it('error 终止 → LlmError 原样携带 provider message/code/status/retry/requestId', async () => {
    const failure = {
      message: 'provider rate limited the request',
      code: 'RATE_LIMIT',
      status: 429,
      providerRetryAfterMs: 1500,
      requestId: ProviderRequestId('req-rc5-1'),
    }
    const error = await summarizeFailure({ kind: 'error', failure })
    expect(error).toBeInstanceOf(LlmError)
    const carried = error as LlmError
    expect(carried.name).toBe('LlmError')
    expect(carried.message).toBe(failure.message)
    expect(carried.code).toBe('RATE_LIMIT')
    expect(carried.failure).toEqual(failure)
  })

  it('aborted 终止 → 同一 fromFailure 路径(取消不当普通 Error 泄漏)', async () => {
    const failure = { message: 'request cancelled by provider', code: 'ABORTED' }
    const error = await summarizeFailure({ kind: 'aborted', failure })
    expect(error).toBeInstanceOf(LlmError)
    const carried = error as LlmError
    expect(carried.code).toBe('ABORTED')
    expect(carried.failure).toEqual(failure)
  })
})

// ---------------------------------------------------------------------------
// 3. fork/压缩行为(upstream manual-compaction.spec.ts 对照)
// ---------------------------------------------------------------------------

describe('fork 种子与压缩 bracket(rc.5 行为对照)', () => {
  it('活 bracket → busy 且零摘要调用(compaction link 已激活)', async () => {
    const { engine, face } = makeManualHarness()
    const session = closedConversation('rc5-live-lock')
    session.append('compaction/start', {
      compactionId: CompactionId('rc5-live-compaction'),
      turn: null,
    })
    const error = await rejection(() => engine.compactNow(makeIdleAgent(session), SIGNAL))
    expect(error.code).toBe('busy')
    expect(error.message).toContain('compaction lock is already active')
    expect(face.calls).toHaveLength(0)
  })

  it('开 turn → busy 且零摘要调用(manual compaction 只收 idle 会话)', async () => {
    const { engine, face } = makeManualHarness()
    const session = closedConversation('rc5-open-turn')
    session.append('turn/start', { turn: 2 })
    const error = await rejection(() => engine.compactNow(makeIdleAgent(session), SIGNAL))
    expect(error.code).toBe('busy')
    expect(error.message).toContain('already has an open turn')
    expect(face.calls).toHaveLength(0)
  })

  it('reload 后 end-seed 晚于孤儿 compaction/start → bracket 视为陈旧,压缩成功', async () => {
    const { engine, face } = makeManualHarness()
    const original = closedConversation('rc5-stale-source')
    original.append('compaction/start', {
      compactionId: CompactionId('rc5-stale-compaction'),
      turn: null,
    })
    // seed 重建的构造器在日志尾追加 session/end-seed(rc.5 生命周期边界)。
    // oxlint-disable-next-line typescript/no-deprecated -- 测试面回放只读(S'-1 行内豁免,同 fakes.ts)。
    const reloaded = Session.create(SessionId('rc5-stale-reload'), original.snapshotEvents())
    const result: CompactionResult | null = await engine.compactNow(makeIdleAgent(reloaded), SIGNAL)
    expect(result).not.toBeNull()
    expect(face.calls).toHaveLength(1)
  })

  it('fork 种子切开 turn 内活 bracket → 子会话 bracket 陈旧,压缩成功', async () => {
    const { engine, face } = makeManualHarness()
    const original = closedConversation('rc5-fork-source')
    original.append('turn/start', { turn: 2 })
    original.append('compaction/start', {
      compactionId: CompactionId('rc5-forked-compaction'),
      turn: 2,
    })
    // oxlint-disable-next-line typescript/no-deprecated -- 测试面回放只读(S'-1 行内豁免,同 fakes.ts)。
    const boundary = original.snapshotEvents().at(-1)!.seq
    // oxlint-disable-next-line typescript/no-deprecated -- 测试面回放只读(S'-1 行内豁免,同 fakes.ts)。
    const seed = buildForkSeed(original.snapshotEvents(), boundary)
    // fork 种子只平衡 turn(forked closer),绝不合成 compaction/end。
    expect(seed.filter(event => event.type === 'compaction/end')).toEqual([])
    expect(seed.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'forked' } } })

    const child = Session.create(SessionId('rc5-fork-child'), seed)
    const result = await engine.compactNow(makeIdleAgent(child), SIGNAL)
    expect(result).not.toBeNull()
    expect(face.calls).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 4. tool-result-pruner 行为对照(upstream rc.5 tool-result-pruner.spec.ts)
// ---------------------------------------------------------------------------

describe('tool-result-pruner 行为对照(rc.5 同口径)', () => {
  /** pruner 构造所需的最小 ctx:Service 注册槽 + tokenMeter 估价。 */
  function prunerService(config: ToolResultPruneConfig = {
    thresholdChars: 50,
    headChars: 4,
    tailChars: 3,
  }): ToolResultPruner {
    const ctx = {
      reflect: { provide: () => undefined },
      tokenMeter: { estimateMessage: (message: Message) => estimateMessage(message) },
    } as unknown as Context
    return new ToolResultPruner(ctx, config)
  }

  it('head/tail 按码点裁剪且不切代理对(与 rc.5 逐字公式一致)', () => {
    const prune = prunerService()
    expect(prune.measureContent([
      { type: 'text', text: 'a😀b' },
      { type: 'reasoning', text: 'not measured' },
    ])).toBe(3)
    expect(prune.pruneContent([{ type: 'text', text: 'a😀b' }])).toBeNull()
    const result = prune.pruneContent([{ type: 'text', text: '😀'.repeat(60) }])
    expect(result).toEqual([{
      type: 'text',
      text: `${'😀'.repeat(4)}${PRUNE_MARKER}${'😀'.repeat(3)}`,
    }])
    expect(prune.measureContent(result!)).toBeLessThanOrEqual(50)
    expect((result![0] as { text: string }).text).not.toContain('\uFFFD')
  })

  it('非文本块原序保留,移除区间两侧文本按预算保留', () => {
    const prune = prunerService()
    const reasoning: ContentBlock = { type: 'reasoning', text: 'private-rich-block' }
    const call: ContentBlock = {
      type: 'tool-call',
      id: ToolCallId('nested'),
      name: 'nested',
      arguments: '{}',
    }
    const result = prune.pruneContent([
      { type: 'text', text: 'A'.repeat(40) },
      reasoning,
      { type: 'text', text: 'B'.repeat(30) },
      call,
      { type: 'text', text: 'C'.repeat(30) },
    ])
    expect(result).toEqual([
      { type: 'text', text: `AAAA${PRUNE_MARKER}` },
      reasoning,
      call,
      { type: 'text', text: 'CCC' },
    ])
    expect(prune.measureContent(result!)).toBeLessThanOrEqual(50)
  })

  it('会话事务:shadow-price 紧邻替换、完整 data 保留、引用被替换 seq、二次收敛', () => {
    const session = makeSession('rc5-pruner-transaction')
    appendTurnStart(session, 1)
    appendAssistantToolCall(session, 1, 1, 'one', 'read')
    const original = session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('one'),
        content: [text('x'.repeat(100))],
        isError: true,
      }),
      error: { name: 'ExitError', code: 'EXIT_1' },
    }, { surfaceOp: 'append' })
    session.append('turn/start', { turn: 2 })

    const prune = prunerService()
    const first = prune.pruneSession(session)
    expect(first.pruned).toHaveLength(1)
    expect(first.charsRemoved).toBeGreaterThan(0)
    const entry = first.pruned[0]!
    expect(entry).toMatchObject({ originalSeq: original.seq, callId: ToolCallId('one'), charsBefore: 100 })
    expect(entry.charsAfter).toBeLessThanOrEqual(50)
    expect(session.surface.nodes).not.toContain(original.seq)

    // 替换事件保留完整 data(除 content),sourceEventSeqs 引用被遮蔽节点。
    // oxlint-disable-next-line typescript/no-deprecated -- 测试面回放只读(S'-1 行内豁免,同 fakes.ts)。
    const replacement = session.eventAt(entry.replacementSeq)
    expect(replacement).toMatchObject({
      type: 'tool/result',
      data: {
        turn: 1,
        step: 1,
        error: { name: 'ExitError', code: 'EXIT_1' },
        message: {
          role: 'tool',
          toolCallId: ToolCallId('one'),
          isError: true,
        },
      },
      surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq },
      sourceEventSeqs: [original.seq],
    })
    // shadow-price 协议:计量事件紧邻替换之前,价格取同源估价。
    // oxlint-disable-next-line typescript/no-deprecated -- 测试面回放只读(S'-1 行内豁免,同 fakes.ts)。
    const shadowPrice = session.eventAt(SessionSeq(entry.replacementSeq - 1))
    expect(shadowPrice).toMatchObject({
      type: 'compaction/prune',
      data: {
        shadowedRange: { start: original.seq, end: original.seq },
        shadowedSeqs: [original.seq],
        shadowedTokenCount: estimateMessage(original.data.message),
      },
    })

    // 一次清够:同一会话二次 prune 不再产生任何替换。
    expect(prune.pruneSession(session)).toEqual({ pruned: [], charsRemoved: 0 })
  })
})

