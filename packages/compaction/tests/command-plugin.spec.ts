/**
 * T39(54 §4.6 / 51 §3.12 CMD)命令面验收——`/compact` 半边:
 * - 注册身份:name='compact';definitionId 必须保持上游首方能力标识
 *   `@deepseek-ai/dsh-command-compact`(dsh-commands/src/builtin.ts 的 BUILTINS.compact),
 *   否则 / 菜单的本地化 label/icon(ui-commands presentation.ts builtinRowFace)与
 *   中文别名(`压缩`,resolveCommand)全部退化;
 * - 不重复注册:同层同名第二条注册必须被命令注册表拒绝(commands/src/index.ts
 *   CommandLayer:NamedEntries 抛 "already registered");
 * - 行为:无参校验、compactNow 委托(同一 agent/signal/commandId)、null→
 *   "No compactable history yet."、结果计数回显、ManualCompactionError 六码映射、
 *   abort→cancelled。
 */
import { Context, type Plugin } from '@deepseek-ai/cordis'
import { CommandId } from '@deepseek-ai/dsh-commands/brand'
import { builtinCommandName, resolveCommand } from '@deepseek-ai/dsh-commands/builtin'
import CommandRuntime, { type CommandDescriptor } from '@deepseek-ai/dsh-commands'
import { ManualCompactionError } from '@deepseek-ai/dsh-compaction'
import type { CompactionResult } from '@deepseek-ai/dsh-compaction/types'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { apply as applyCompactCommand } from '../src/command-plugin.ts'

const SIGNAL = new AbortController().signal

/** 最小 Agent 面:命令注册表只把它当 scope key,execute 只读 agent.session.append。 */
function makeAgent(): { id: string; session: { append: () => { type: string } } } {
  return { id: 'agent-command-test', session: { append: () => ({ type: 'command/done' }) } }
}

/** compactNow 的返回值/抛错脚本面。 */
function fakeCompaction(script: (agent: unknown, signal: AbortSignal, commandId: unknown) => Promise<CompactionResult | null>) {
  return { compactNow: vi.fn(script) }
}

/** 真实命令注册表 + 真实 effect 生命周期;compaction 由脚本桩提供。 */
async function bootPlugin(script: Parameters<typeof fakeCompaction>[0] = async () => null) {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(CommandRuntime)
  const compaction = fakeCompaction(script)
  ctx.provide('compaction', compaction)
  await ctx.plugin({ name: 'command-compact', inject: ['commands', 'compaction'], apply: applyCompactCommand } as Plugin)
  const agent = makeAgent()
  const descriptors: readonly CommandDescriptor[] = ctx.commands.list(agent as never)
  return { ctx, compaction, agent, descriptors }
}

function compactDescriptor(descriptors: readonly CommandDescriptor[]): CommandDescriptor {
  const descriptor = descriptors.find(candidate => candidate.name === 'compact')
  if (descriptor === undefined) throw new Error(`/compact missing from catalog: ${descriptors.map(d => d.name).join(',')}`)
  return descriptor
}

function result(shadowedSeqs: number[], shadowedTokenCount: number, summarySeq: number): CompactionResult {
  return {
    compactionId: 'compaction-test',
    summarySeq: SessionSeq(summarySeq),
    shadowedSeqs: shadowedSeqs.map(seq => SessionSeq(seq)),
    shadowedTokenCount,
    retainedTokenCount: 0,
  } as unknown as CompactionResult
}

describe('/compact 注册与命令面板身份', () => {
  it('注册 name=compact,且 / 菜单/中文别名按上游首方身份识别(builtinCommandName/resolveCommand)', async () => {
    const { descriptors } = await bootPlugin()
    const descriptor = compactDescriptor(descriptors)
    expect(descriptor.description).toBe('Compact older conversation history')
    // 上游 ui-commands 的 builtinRowFace/claimToken 与 /压缩 别名都只认这个 identity。
    expect(builtinCommandName(descriptor)).toBe('compact')
    expect(resolveCommand('compact', descriptors)?.name).toBe('compact')
    expect(resolveCommand('压缩', descriptors)?.name).toBe('compact')
  })

  it('同层重复注册同名命令被注册表拒绝(不得重复注册同一命令)', async () => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    await ctx.plugin(CommandRuntime)
    ctx.commands.register({ name: 'compact', description: 'first', handler: () => ({ kind: 'success' }) })
    expect(() => ctx.commands.register({ name: 'compact', description: 'second', handler: () => ({ kind: 'success' }) }))
      .toThrow(/command "compact" is already registered/)
  })
})

describe('/compact 行为(走当前 compact 实现)', () => {
  it('无参校验:带 rawInput 返回 Usage 错误且不调用 compactNow', async () => {
    const { ctx, compaction, agent } = await bootPlugin()
    const execution = await ctx.commands.execute(agent as never, '/compact now', [], SIGNAL)
    expect(execution?.result).toEqual({ kind: 'error', text: 'Usage: /compact (no arguments)' })
    expect(compaction.compactNow).not.toHaveBeenCalled()
  })

  it('委托当前 compaction.compactNow:同一 agent/signal/commandId', async () => {
    const { ctx, compaction, agent } = await bootPlugin(async () => null)
    const execution = await ctx.commands.execute(agent as never, '/compact', [], SIGNAL)
    expect(execution?.result).toEqual({ kind: 'success', text: 'No compactable history yet.' })
    expect(compaction.compactNow).toHaveBeenCalledTimes(1)
    const [receivedAgent, receivedSignal, receivedCommandId] = compaction.compactNow.mock.calls[0] as [unknown, AbortSignal, unknown]
    expect(receivedAgent).toBe(agent)
    expect(receivedSignal).toBe(SIGNAL)
    expect(receivedCommandId).toBe(execution?.commandId)
  })

  it('有压缩范围时回显条数与 token 估算,并带 summarySeq', async () => {
    const { ctx, agent } = await bootPlugin(async () => result([1, 2, 3], 42, 9))
    const execution = await ctx.commands.execute(agent as never, '/compact', [], SIGNAL)
    expect(execution?.result).toEqual({
      kind: 'success',
      text: 'Compacted 3 history items (~42 tokens).',
      sourceEventSeq: 9,
    })
  })

  it('ManualCompactionError 六码各自映射为可读错误(不抛出)', async () => {
    const cases = [
      ['busy', 'Compaction is unavailable because this process has an active compaction, or the agent is not idle.'],
      ['cancelled', 'Compaction cancelled.'],
      ['changed', 'The history selected for compaction changed before it could be replaced. The attempt is recorded in the session log.'],
      ['summary', 'Compaction could not produce a useful summary. The attempt is recorded in the session log.'],
      ['commit', 'Compaction did not finish cleanly; some session history may have changed. Inspect the current session state before retrying.'],
      ['persistence', 'Compaction finished, but the session could not be saved.'],
    ] as const
    for (const [code, text] of cases) {
      const { ctx, agent } = await bootPlugin(async () => { throw new ManualCompactionError(code, 'backend detail') })
      const execution = await ctx.commands.execute(agent as never, '/compact', [], SIGNAL)
      expect(execution?.result).toEqual({ kind: 'error', text })
    }
  })

  it('请求 abort → cancelled 文案(handler 面;注册表 execute 面按上游 withAbort 直接 reject)', async () => {
    const controller = new AbortController()
    const { ctx, agent } = await bootPlugin(async () => {
      controller.abort()
      throw new Error('abort reason')
    })
    const definition = ctx.commands.find(agent as never, 'compact')
    if (definition === undefined) throw new Error('/compact not registered')
    const result = await definition.handler({
      commandId: CommandId('cmd-test'),
      agent,
      rawInput: '',
      attachments: [],
      signal: controller.signal,
    } as never)
    expect(result).toEqual({ kind: 'error', text: 'Compaction cancelled.' })
  })

  it('非 ManualCompactionError 的异常照常上抛(loud)', async () => {
    const { ctx, agent } = await bootPlugin(async () => { throw new Error('engine bug') })
    await expect(ctx.commands.execute(agent as never, '/compact', [], SIGNAL)).rejects.toThrow('engine bug')
  })
})

describe('/compact 生命周期', () => {
  it('插件 dispose 后命令注销(命令面板不再列出)', async () => {
    const ctx = new Context()
    await ctx.plugin(CommandRuntime)
    ctx.provide('compaction', fakeCompaction(async () => null))
    const fiber = await ctx.plugin({ name: 'command-compact', inject: ['commands', 'compaction'], apply: applyCompactCommand } as Plugin)
    const agent = makeAgent()
    expect(ctx.commands.list(agent as never).map(descriptor => descriptor.name)).toContain('compact')
    await fiber.dispose()
    expect(ctx.commands.list(agent as never).map(descriptor => descriptor.name)).not.toContain('compact')
    await ctx.fiber.dispose()
  })
})
