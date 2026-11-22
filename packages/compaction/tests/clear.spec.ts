/**
 * clear 单测:清空事务的空 surface、仅系统头、全清投影、tool 配对整段清除、
 * 未闭合步骤拒绝、开 turn / 压缩锁 / 忙 agent 的 busy、落盘失败、取消,以及
 * checkpoint source 载荷与命令层中文诊断映射。
 *
 * 事件词汇约束(2026-11-23):v4 恢复拒载未知非 ignorable 事件类型,事务不新增
 * 事件类型——审计全在 checkpoint user/message 的 source(merge-extensible
 * MessageSourceMap)里,本 spec 据此断言。
 */
import { describe, expect, it } from 'vitest'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionSeq, type Session } from '@deepseek-ai/dsh-session'
import type { TokenMeter } from '@deepseek-ai/dsh-token-meter'
import {
  CLEAR_CHECKPOINT_TEXT,
  clearSessionContext,
  ContextClearError,
} from '../src/clear/clear.ts'
import type { ClearDeps } from '../src/clear/clear.ts'
import { expectedClearFailure } from '../src/clear/command-plugin.ts'
import {
  appendAssistantToolCall,
  appendSystemMessage,
  appendToolResult,
  appendTurnStart,
  appendUserMessage,
  createFakeMeter,
  makeSession,
} from './helpers/fakes.ts'

/** runMaintenance 直通 job 的假 agent(空闲态;clear 只触达 session+runMaintenance)。 */
function makeIdleAgent(session: Session): Agent {
  return {
    id: session.id,
    session,
    options: {},
    runMaintenance: <T>(job: (signal: AbortSignal) => Promise<T>): Promise<T> =>
      job(new AbortController().signal),
  } as unknown as Agent
}

/** runMaintenance 直接抛错的假 agent(模拟宿主忙闸)。 */
function makeBusyAgent(session: Session): Agent {
  return {
    id: session.id,
    session,
    options: {},
    runMaintenance: (): Promise<never> =>
      Promise.reject(new Error('agent "x" already has active work')),
  } as unknown as Agent
}

/** deps 工厂:fake meter + flush 记录器。 */
function makeClearDeps(flushImpl?: (session: Session) => Promise<void>): {
  deps: ClearDeps
  flushed: Session[]
} {
  const flushed: Session[] = []
  const deps: ClearDeps = {
    meter: createFakeMeter() as unknown as TokenMeter,
    flush: flushImpl ?? (async (session) => { flushed.push(session) }),
  }
  return { deps, flushed }
}

describe('clearSessionContext', () => {
  it('空 surface → null 且零事件追加、零 flush', async () => {
    const session = makeSession()
    const seqBefore = session.seq
    const { deps, flushed } = makeClearDeps()
    const result = await clearSessionContext(deps, makeIdleAgent(session), new AbortController().signal)
    expect(result).toBeNull()
    expect(session.seq).toBe(seqBefore)
    expect(session.surface.nodes).toHaveLength(0)
    expect(flushed).toHaveLength(0)
  })

  it('仅系统头 → null(firstIdx=1 吞不掉任何节点)', async () => {
    const session = makeSession()
    appendSystemMessage(session)
    const seqBefore = session.seq
    const { deps, flushed } = makeClearDeps()
    const result = await clearSessionContext(deps, makeIdleAgent(session), new AbortController().signal)
    expect(result).toBeNull()
    expect(session.seq).toBe(seqBefore)
    expect(flushed).toHaveLength(0)
  })

  it('全清基础:surface 只剩 [system, checkpoint],释放价=启发式求和', async () => {
    const session = makeSession()
    appendSystemMessage(session)
    appendUserMessage(session, 'q1')
    appendUserMessage(session, 'q2')
    const meter = createFakeMeter()
    const expectedTokens = meter.measure(session)
      .nodes.slice(1)
      .reduce((total, node) => total + node.heuristicTokens, 0)
    const { deps, flushed } = makeClearDeps()
    const agent = makeIdleAgent(session)
    const result = await clearSessionContext({ ...deps, meter: meter as unknown as TokenMeter }, agent, new AbortController().signal)
    expect(result).not.toBeNull()
    expect(result!.clearedCount).toBe(2)
    expect(result!.clearedTokenCount).toBe(expectedTokens)
    expect(session.surface.nodes).toHaveLength(2)
    const messages = session.deriveMessages()
    expect(messages).toHaveLength(2)
    expect(flushed).toEqual([session])
  })

  it('checkpoint 事件载荷:正文/source kind/审计字段齐备,无 commandId 时键缺席', async () => {
    const session = makeSession()
    appendUserMessage(session, 'q1')
    appendUserMessage(session, 'q2')
    const { deps } = makeClearDeps()
    const result = await clearSessionContext(deps, makeIdleAgent(session), new AbortController().signal)
    expect(result).not.toBeNull()
    // Existing Session history read; migration deferred(S'-1 测试面豁免)。
    // oxlint-disable-next-line typescript/no-deprecated
    const event = session.eventAt(result!.checkpointSeq)!
    if (event.type !== 'user/message') throw new Error(`unexpected event type: ${event.type}`)
    const message = event.data
    expect(message.role).toBe('user')
    expect(message.content).toEqual([{ type: 'text', text: CLEAR_CHECKPOINT_TEXT }])
    expect(message.source.kind).toBe('eterna-clear-checkpoint')
    if (message.source.kind !== 'eterna-clear-checkpoint') return
    expect(message.source.clearedSeqs).toHaveLength(2)
    expect(message.source.clearedTokenCount).toBeGreaterThan(0)
    expect('sourceCommandId' in message.source).toBe(false)
  })

  it('带 commandId:checkpoint source 记录命令身份', async () => {
    const session = makeSession()
    appendUserMessage(session, 'q1')
    const { deps } = makeClearDeps()
    const result = await clearSessionContext(
      deps,
      makeIdleAgent(session),
      new AbortController().signal,
      CommandId('cmd-1'),
    )
    expect(result).not.toBeNull()
    // oxlint-disable-next-line typescript/no-deprecated
    const event = session.eventAt(result!.checkpointSeq)!
    if (event.type !== 'user/message') throw new Error(`unexpected event type: ${event.type}`)
    const source = event.data.source
    expect(source.kind).toBe('eterna-clear-checkpoint')
    if (source.kind !== 'eterna-clear-checkpoint') return
    expect(source.sourceCommandId).toBe('cmd-1')
  })

  it('tool 配对整段清除:真实 replace 校验跑通,deriveMessages 只剩 [system, checkpoint]', async () => {
    const session = makeSession()
    appendSystemMessage(session)
    appendUserMessage(session, 'q1')
    appendAssistantToolCall(session, 1, 0, 'c1')
    appendToolResult(session, 1, 0, 'c1', 'ok')
    appendUserMessage(session, 'q2')
    const { deps } = makeClearDeps()
    const result = await clearSessionContext(deps, makeIdleAgent(session), new AbortController().signal)
    expect(result).not.toBeNull()
    expect(result!.clearedCount).toBe(4)
    expect(session.surface.nodes).toHaveLength(2)
    expect(session.deriveMessages()).toHaveLength(2)
  })

  it('未闭合步骤(尾随 tool-call 无 result)→ unbalanced 拒绝', async () => {
    const session = makeSession()
    appendUserMessage(session, 'q1')
    appendAssistantToolCall(session, 1, 0, 'c1')
    const { deps } = makeClearDeps()
    await expect(
      clearSessionContext(deps, makeIdleAgent(session), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'unbalanced' })
  })

  it('开 turn → busy(照 compactNow 的 owner=null 语义)', async () => {
    const session = makeSession()
    appendTurnStart(session)
    appendUserMessage(session, 'q1')
    const { deps } = makeClearDeps()
    await expect(
      clearSessionContext(deps, makeIdleAgent(session), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'busy' })
  })

  it('未闭合 compaction/start 压缩锁 → busy', async () => {
    const session = makeSession()
    appendUserMessage(session, 'q1')
    session.append('compaction/start', { compactionId: CompactionId('lock-test'), turn: null })
    const { deps } = makeClearDeps()
    await expect(
      clearSessionContext(deps, makeIdleAgent(session), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'busy' })
  })

  it('agent 忙(runMaintenance 抛错)→ busy', async () => {
    const session = makeSession()
    appendUserMessage(session, 'q1')
    const { deps } = makeClearDeps()
    await expect(
      clearSessionContext(deps, makeBusyAgent(session), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'busy' })
  })

  it('落盘失败 → persistence(surface 已替换,与 compactNow 同语义)', async () => {
    const session = makeSession()
    appendUserMessage(session, 'q1')
    appendUserMessage(session, 'q2')
    const { deps } = makeClearDeps(async () => { throw new Error('disk full') })
    await expect(
      clearSessionContext(deps, makeIdleAgent(session), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'persistence' })
    expect(session.surface.nodes).toHaveLength(1)
  })

  it('调用前已取消 → 拒绝且零事件追加', async () => {
    const session = makeSession()
    appendUserMessage(session, 'q1')
    const seqBefore = session.seq
    const { deps } = makeClearDeps()
    const controller = new AbortController()
    controller.abort()
    await expect(
      clearSessionContext(deps, makeIdleAgent(session), controller.signal),
    ).rejects.toThrow()
    expect(session.seq).toBe(seqBefore)
  })

  it('清空不落任何压缩锁事件(全日志词汇均为已知类型)', async () => {
    const session = makeSession()
    appendUserMessage(session, 'q1')
    const { deps } = makeClearDeps()
    await clearSessionContext(deps, makeIdleAgent(session), new AbortController().signal)
    const types: string[] = []
    for (let seq = 0; seq < session.seq; seq += 1) {
      // Existing Session history read; migration deferred(S'-1 测试面豁免)。
      // oxlint-disable-next-line typescript/no-deprecated
      types.push(session.eventAt(SessionSeq(seq))!.type)
    }
    expect(types).toEqual(['user/message', 'user/message'])
  })
})

describe('expectedClearFailure', () => {
  it('闭合码逐一映射中文诊断', () => {
    const cases: Array<[ContextClearError['code'], string]> = [
      ['busy', '会话正在处理消息，或存在未完成的压缩，暂时无法清空，请稍后再试。'],
      ['cancelled', '已取消清空。'],
      ['unbalanced', '清空失败：会话存在未闭合的步骤边界，暂无法整段替换。'],
      ['persistence', '上下文已清空，但会话落盘失败，请检查宿主日志。'],
    ]
    for (const [code, text] of cases) {
      const result = expectedClearFailure(new ContextClearError(code, 'internal'))
      expect(result.kind).toBe('error')
      expect(result.text).toBe(text)
    }
  })
})
