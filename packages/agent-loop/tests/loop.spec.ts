/**
 * agent-loop 冒烟:装配全内核 stub(plugins 六面)→ 直答 turn / 工具一轮 /
 * pre-step 改写 / turn-stopping 取消 / step 预算截断。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@core/cordis'
import { defineTool } from '@core/contracts'
import type { LlmChatResult, LlmProvider, StepDraft, StreamChunk, TurnStoppingEvent } from '@core/contracts'
import { createAgentRunner } from '../src/loop.ts'
import { AgentRegistryImpl } from '../src/registry.ts'

/** stub provider:脚本化逐次响应(非流式,loop 自动回退 chat)。 */
function scriptedProvider(responses: readonly LlmChatResult[]): LlmProvider {
  let cursor = 0
  return {
    name: 'stub',
    model: 'stub-1',
    chat: async () => {
      const next = responses[cursor]
      cursor += 1
      if (next === undefined) throw new Error('stub 脚本耗尽')
      return next
    },
  }
}

/** 组装一个挂好六 seam 的 ctx(全部 stub,零网络)。 */
function makeCtx(provider: LlmProvider): { ctx: Context; toolCalls: string[] } {
  const ctx = new Context()
  const toolCalls: string[] = []

  const toolsImpl = {
    register: (definition: ReturnType<typeof defineTool>) => {
      liveTools.set(definition.name, definition)
      return () => { liveTools.delete(definition.name) }
    },
    get: (name: string) => liveTools.get(name),
    list: () => [...liveTools.values()],
    schemas: () => [...liveTools.values()].map(({ name, description, parameters }) => ({ name, description, parameters })),
    restricted: () => false,
    newCallId: () => `call-${liveTools.size}`,
  }
  const liveTools = new Map<string, ReturnType<typeof defineTool>>()

  ctx.provide('systemPrompt', { section: () => () => {}, assemble: () => '你是测试助手。' })
  const sessionEvents: { type: string; seq: number; time: number; data: unknown }[] = []
  ctx.provide('session', {
    append: (type: string, data: unknown) => {
      const event = { type, seq: sessionEvents.length + 1, time: 0, data }
      sessionEvents.push(event)
      return event
    },
    query: (filter: { type?: string; sinceSeq?: number; untilSeq?: number } = {}) =>
      sessionEvents.filter((event) => {
        if (filter.type !== undefined && event.type !== filter.type) return false
        if (filter.sinceSeq !== undefined && event.seq < filter.sinceSeq) return false
        if (filter.untilSeq !== undefined && event.seq > filter.untilSeq) return false
        return true
      }),
    size: () => sessionEvents.length,
  })
  ctx.provide('tools', toolsImpl)
  ctx.provide('llm', { register: () => () => {}, resolve: () => provider, defaultRoute: () => 'stub', setDefault: () => {} })
  ctx.provide('approval', { request: async () => 'allowed-once' })
  return { ctx, toolCalls }
}

const STOP: LlmChatResult = { message: { role: 'assistant', content: 'done' }, finish: { kind: 'stop' } }

describe('agent loop', () => {
  it('直答:无工具欠账 → 单 step 完成,turn/end 落盘', async () => {
    const { ctx } = makeCtx(scriptedProvider([STOP]))
    const runner = createAgentRunner(ctx)
    const result = await runner.run('你好')
    expect(result.steps).toBe(1)
    expect(result.output).toBe('done')
    const types = (ctx as unknown as { session: { query(filter?: { type?: string }): { type: string }[] } }).session
      .query().map(event => event.type)
    expect(types).toEqual(['turn/start', 'assistant/message', 'turn/end'])
  })

  it('工具一轮:assistant tool_calls → tool 执行回填 → 第二步直答', async () => {
    const { ctx, toolCalls } = makeCtx(scriptedProvider([
      {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"text":"hi"}' }],
        },
        finish: { kind: 'tool-calls' },
        usage: { inputTokens: 3, outputTokens: 2 },
      },
      STOP,
    ]))
    // 注册一个真 echo 工具(经 defineTool 校验包装)
    ;(ctx as unknown as { tools: { register(definition: ReturnType<typeof defineTool>): () => void } }).tools.register(
      defineTool({
        name: 'echo',
        description: '原样返回',
        parameters: { text: { type: 'string', required: true } },
        output: { schema: { type: 'object' }, render: () => [{ type: 'text', text: 'ok' }] },
        execute: async args => ({ echo: (args as { text: string }).text }),
      }),
    )
    const runner = createAgentRunner(ctx)
    const result = await runner.run('调一下 echo')
    expect(result.steps).toBe(2)
    expect(result.toolCalls).toEqual([{ callId: 'c1', name: 'echo' }])
    expect(result.output).toBe('done')
    expect(result.usage).toMatchObject({ inputTokens: 3, outputTokens: 2 })
    const toolEvents = (ctx as unknown as { session: { query(filter: { type: string }): { type: string; data: unknown }[] } })
      .session.query({ type: 'tool/result' })
    expect(toolEvents.length).toBe(1)
    expect(toolCalls.length).toBe(0)
  })

  it('turn-stopping:守卫 cancel → stoppedBy 与 reason 落盘', async () => {
    const { ctx } = makeCtx(scriptedProvider([
      {
        message: { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"text":"hi"}' }] },
        finish: { kind: 'tool-calls' },
      },
    ]))
    ;(ctx as unknown as { tools: { register(definition: ReturnType<typeof defineTool>): () => void } }).tools.register(
      defineTool({
        name: 'echo',
        description: '原样返回',
        parameters: { text: { type: 'string', required: true } },
        output: { schema: { type: 'object' }, render: () => [{ type: 'text', text: 'ok' }] },
        execute: async () => ({ ok: true }),
      }),
    )
    ctx.events.on('agent/turn-stopping', (event: TurnStoppingEvent) => {
      // 模拟预算守卫:首轮即超限
      event.agent.cancel({ kind: 'hook', reason: '[governance] 预算超限' })
    })
    let preStepSignal: AbortSignal | undefined
    ctx.events.on('agent/pre-step', (draft: StepDraft, next: () => Promise<StepDraft>) => {
      preStepSignal = draft.signal
      return next()
    })
    const runner = createAgentRunner(ctx)
    const result = await runner.run('hi')
    expect(result.stoppedBy).toContain('预算超限')
    // cancel 必须同步 abort 同一 turn 信号(插件可据此停掉外部工作)
    expect(preStepSignal?.aborted).toBe(true)
    const turnEnd = (ctx as unknown as {
      session: { query(filter: { type: string }): { data: { reason: { kind: string; message?: string } } }[] }
    }).session.query({ type: 'turn/end' })[0]
    expect(turnEnd?.data.reason.kind).toBe('stopped')
  })

  it('pre-step waterfall 可改写 messages', async () => {
    const seen: number[] = []
    const { ctx } = makeCtx(scriptedProvider([STOP]))
    const drafts: StepDraft[] = []
    ctx.events.on('agent/pre-step', (draft: StepDraft, next: () => Promise<StepDraft>) => {
      seen.push(draft.messages.length)
      drafts.push(draft)
      return next()
    })
    const runner = createAgentRunner(ctx)
    await runner.run('hi')
    expect(seen).toEqual([2])
    // pre-step 能拿到 turn 级 agent 与取消信号(技能 catalog 注入依赖)
    expect(drafts[0]?.agent?.id).toEqual(expect.any(String))
    expect(drafts[0]?.signal).toBeInstanceOf(AbortSignal)
    expect(drafts[0]?.signal?.aborted).toBe(false)
  })

  it('step 预算:provider 永远出工具欠账 → 截断并 stoppedBy', async () => {
    const endless = scriptedProvider(Array.from({ length: 20 }, () => ({
      message: { role: 'assistant' as const, content: '', toolCalls: [{ id: `c${Math.random()}`, name: 'echo', arguments: '{"text":"x"}' }] },
      finish: { kind: 'tool-calls' as const },
    })))
    const { ctx } = makeCtx(endless)
    ;(ctx as unknown as { tools: { register(definition: ReturnType<typeof defineTool>): () => void } }).tools.register(
      defineTool({
        name: 'echo',
        description: '原样返回',
        parameters: { text: { type: 'string', required: true } },
        output: { schema: { type: 'object' }, render: () => [{ type: 'text', text: 'ok' }] },
        execute: async () => ({}),
      }),
    )
    const runner = createAgentRunner(ctx, { stepBudget: 3 })
    const result = await runner.run('loop')
    expect(result.steps).toBe(3)
    expect(result.stoppedBy).toContain('step 预算耗尽')
  })

  it('流式路径:provider.stream 存在时走 stream 并聚合', async () => {
    const streamProvider: LlmProvider = {
      name: 'stub',
      model: 'stub-1',
      chat: async () => STOP,
      stream: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'text-delta', index: 0, delta: '流' }
        yield { type: 'text-delta', index: 1, delta: '式' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    const { ctx } = makeCtx(streamProvider)
    const runner = createAgentRunner(ctx)
    const result = await runner.run('hi')
    expect(result.output).toBe('流式')
  })

  it('AgentRegistryImpl:默认名纪律与 disposer', () => {
    const registry = new AgentRegistryImpl()
    const off = registry.register('default', () => ({ run: async () => ({ turn: 1, steps: 1, output: '', toolCalls: [] }) }))
    expect(registry.defaultName()).toBe('default')
    expect(() => registry.register('default', () => ({ run: async () => ({ turn: 1, steps: 1, output: '', toolCalls: [] }) }))).toThrow(/已注册/)
    off()
    expect(registry.defaultName()).toBeUndefined()
  })
})
