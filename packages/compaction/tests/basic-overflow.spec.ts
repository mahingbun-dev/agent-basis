/**
 * basic 引擎溢出恢复链单测(_registerAutomaticCompaction 的 agent/request-error
 * 监听器,语义钉死 :309-353):错误码分派、auto 门控、maxOverflowRetries 超限、
 * prune 先于 compact、replaceGeneration 前进 → retry 计数。
 */
import { describe, expect, it } from 'vitest'
import { CONTEXT_WINDOW_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import type { BasicCompactionConfig } from '../src/basic/types.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  createFakeMeter,
  engineInternals,
  fakeSummarizer,
  makeEngine,
  makeFakeAgent,
  makeFakeEngineContext,
  makePressureSession,
  MINIMAL_VALID_SUMMARY,
  registerAutomaticCompaction,
} from './helpers/fakes.ts'

const SIGNAL = new AbortController().signal

/** agent/request-error 监听器的结构面(测试显式派发)。 */
type OverflowListener = (
  payload: { agent: Agent; failure: { code: string }; signal: AbortSignal },
  next: () => Promise<unknown>,
) => Promise<unknown>

/** 溢出恢复 harness:注册监听器的引擎 + 标准压力会话 + 可配置 pruner/摘要。 */
function makeOverflowHarness(config: BasicCompactionConfig = {}) {
  const harness = makeFakeEngineContext(createFakeMeter())
  harness.setModelInfo({ contextWindow: 10_000, defaultMaxTokens: 1_000 })
  const engine = makeEngine(harness.ctx, config)
  registerAutomaticCompaction(engine)
  const { session } = makePressureSession('x'.repeat(800))
  const agent = makeFakeAgent(session, 'p', 'm')
  const listener = harness.listenersOf('agent/request-error')[0] as unknown as OverflowListener
  const trace: string[] = []
  // C3 起 region 先做摘要结构校验再 shrink:桩摘要须为结构合法摘要(escalate 拍板)。
  const face = fakeSummarizer([MINIMAL_VALID_SUMMARY])
  // 影子化受保护 summarize:追踪调用序(trace.push 在 face 内部记录之前)。
  ;(engine as unknown as { summarize: unknown }).summarize = (
    input: Parameters<typeof face>[0],
    owner: Agent,
    signal?: AbortSignal,
  ) => {
    trace.push('summarize')
    return face(input, owner, signal)
  }
  const dispatch = (code: string, next: () => Promise<unknown> = async () => 'next-result') =>
    listener({ agent, failure: { code }, signal: SIGNAL }, next)
  return { harness, engine, session, agent, trace, face, dispatch }
}

describe('agent/request-error 溢出恢复', () => {
  it('非 CONTEXT_WINDOW_EXCEEDED 错误码直通,不触发恢复链', async () => {
    const { trace, dispatch } = makeOverflowHarness()
    const result = await dispatch('PROVIDER_TIMEOUT')
    expect(result).toBe('next-result')
    expect(trace).toEqual([])
  })

  it('auto=false 时溢出恢复直通(:313 门控钉死)', async () => {
    const { trace, dispatch } = makeOverflowHarness({ auto: false })
    const result = await dispatch(CONTEXT_WINDOW_EXCEEDED_CODE)
    expect(result).toBe('next-result')
    expect(trace).toEqual([])
  })

  it('maxOverflowRetries 超限直通(默认 1:第二次溢出不再恢复)', async () => {
    const { dispatch } = makeOverflowHarness()
    expect(await dispatch(CONTEXT_WINDOW_EXCEEDED_CODE)).toEqual({ kind: 'retry' })
    // 无 assistant/message 落地清零,计数仍为 1 ≥ maxOverflowRetries → 直通。
    expect(await dispatch(CONTEXT_WINDOW_EXCEEDED_CODE)).toBe('next-result')
  })

  it('pruneSession 在 compact(摘要)之前被调(spy 次序)', async () => {
    const { harness, dispatch, trace } = makeOverflowHarness()
    harness.setPruner({ pruneSession: () => {
      trace.push('prune')
      return { pruned: [], charsRemoved: 0 }
    } })
    const result = await dispatch(CONTEXT_WINDOW_EXCEEDED_CODE)
    expect(result).toEqual({ kind: 'retry' })
    expect(trace).toEqual(['prune', 'summarize'])
  })

  it('replaceGeneration 前进 → retry 计数 +1 并登记 agent', async () => {
    const { engine, session, agent, dispatch } = makeOverflowHarness()
    const generationBefore = session.surface.replaceGeneration
    const result = await dispatch(CONTEXT_WINDOW_EXCEEDED_CODE)
    expect(result).toEqual({ kind: 'retry' })
    expect(session.surface.replaceGeneration).toBeGreaterThan(generationBefore)
    const internals = engineInternals(engine)
    expect(internals.overflowRetries.get(agent)).toBe(1)
    expect(internals.overflowAgents.get(session)).toBe(agent)
  })

  it('压缩失败且 replaceGeneration 未前进 → 直通保留原始错误并告警', async () => {
    const harness = makeFakeEngineContext(createFakeMeter())
    harness.setModelInfo({ contextWindow: 10_000, defaultMaxTokens: 1_000 })
    const engine = makeEngine(harness.ctx)
    registerAutomaticCompaction(engine)
    const { session } = makePressureSession('x'.repeat(800))
    const agent = makeFakeAgent(session, 'p', 'm')
    const face = fakeSummarizer([new Error('boom')])
    ;(engine as unknown as { summarize: unknown }).summarize = face
    const listener = harness.listenersOf('agent/request-error')[0] as unknown as OverflowListener

    const result = await listener(
      { agent, failure: { code: CONTEXT_WINDOW_EXCEEDED_CODE }, signal: SIGNAL },
      async () => 'next-result',
    )
    expect(result).toBe('next-result')
    expect(harness.warns.length).toBe(1)
    expect(harness.warns[0]).toContain('context-overflow compaction failed')
    expect(harness.warns[0]).toContain('boom')
    expect(engineInternals(engine).overflowRetries.get(agent)).toBeUndefined()
  })

  it('session/event assistant/message 落地清零重试计数(:303 语义)', async () => {
    const { engine, session, agent, dispatch, harness } = makeOverflowHarness()
    await dispatch(CONTEXT_WINDOW_EXCEEDED_CODE)
    expect(engineInternals(engine).overflowRetries.get(agent)).toBe(1)

    const sessionEventListener = harness.listenersOf('session/event')[0] as unknown as (
      session: Session,
      event: { type: string },
    ) => void
    sessionEventListener(session, { type: 'assistant/message' })
    expect(engineInternals(engine).overflowRetries.get(agent)).toBeUndefined()
  })
})
