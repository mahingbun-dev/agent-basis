/**
 * turn/step 引擎(对齐 docs/design/04 号笔记的 DSH agent-loop 语义):
 * claim 输入 → turn/start → [step 循环:pre-step waterfall → llm →
 * tool 执行链(role=tool 回填)→ 有欠账续 step] → agent/turn-stopping(守卫可 cancel)
 * → turn/end → TurnResult。step 硬上限防"模型-工具"死循环(budget 插件是第二道闸)。
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@core/cordis'
import type { AgentHandle, LlmMessage, LlmProvider, StepDraft, TurnResult } from '@core/contracts'
import { assembleStream } from '@basis/llm'
import type { ToolRegistryImpl } from '@basis/tools'
import { createToolExecutor } from '@basis/tools'

export interface LoopOptions {
  /** agent id(turn-stopping 载荷用)。 */
  readonly id?: string
  /** system prompt 装配缺省变量表。 */
  readonly promptVariables?: Readonly<Record<string, string>>
  /** llm 路由名(缺省默认路由)。 */
  readonly provider?: string
  /** 模型覆盖。 */
  readonly model?: string
  /** step 硬上限(默认 16)。 */
  readonly stepBudget?: number
}

/** 可被 turn-stopping 守卫取消的 agent 面。 */
class CancelableAgent implements AgentHandle {
  cancelled: boolean = false
  stopReason: string = ''
  readonly id: string
  readonly controller: AbortController

  constructor(id: string, controller: AbortController = new AbortController()) {
    this.id = id
    this.controller = controller
  }

  cancel(cause: { readonly kind: 'hook'; readonly reason: string }, _options?: { readonly keepInbox?: boolean }): void {
    this.cancelled = true
    this.stopReason = cause.reason
    this.controller.abort()
  }
}

export function createAgentRunner(ctx: Context, options: LoopOptions = {}): { run(input: string): Promise<TurnResult> } {
  const registry = ctx.tools as ToolRegistryImpl
  const executor = createToolExecutor(ctx, registry)
  const agentId = options.id ?? randomUUID()

  return {
    async run(input: string): Promise<TurnResult> {
      const turn = 1 + ctx.session.query().filter(event => event.type === 'turn/start').length
      const agent = new CancelableAgent(agentId)
      const signal = agent.controller.signal
      // 读取经函数边界:守卫的 cancel 发生在 parallel 分发期间,属性流分析不可见
      const isCancelled = (): boolean => agent.cancelled
      ctx.session.append('turn/start', { turn, input })

      const systemPrompt = ctx.systemPrompt.assemble({ variables: options.promptVariables ?? {} })
      const messages: LlmMessage[] = [
        ...(systemPrompt.length > 0 ? [{ role: 'system' as const, content: systemPrompt }] : []),
        { role: 'user', content: input },
      ]
      const provider = ctx.llm.resolve(options.provider)
      const stepBudget = options.stepBudget ?? 16
      const tools = registry.schemas()
      const allCalls: { callId: string; name: string }[] = []
      let usageTotal: { inputTokens: number; outputTokens: number } | undefined
      let steps = 0
      let output = ''
      let stoppedBy: string | undefined

      try {
        for (let step = 1; step <= stepBudget; step += 1) {
          if (isCancelled()) {
            stoppedBy = agent.stopReason
            break
          }
          steps = step

          // 1) pre-step waterfall:可改写 messages/tools
          const stepDraft = { turn, step, messages: [...messages], tools, agent, signal }
          const nextDraft = (): Promise<StepDraft> => Promise.resolve(stepDraft)
          const draft: StepDraft = await ctx.waterfall('agent/pre-step', stepDraft, nextDraft)
          const effectiveMessages = draft.messages

          // 2) 模型调用(stream 优先,失败回退 chat)
          const request = {
            messages: effectiveMessages,
            ...(tools.length > 0 ? { tools } : {}),
            ...(options.model !== undefined ? { model: options.model } : {}),
          }
          let result
          try {
            const providerRef: LlmProvider = provider
            const streamImpl = providerRef.stream?.bind(providerRef)
            result = streamImpl !== undefined
              ? await assembleStream(streamImpl(request))
              : await providerRef.chat(request)
          } catch {
            result = await provider.chat(request)
          }

          messages.push(result.message)
          if (result.usage !== undefined) {
            usageTotal = usageTotal === undefined
              ? { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }
              : {
                inputTokens: usageTotal.inputTokens + result.usage.inputTokens,
                outputTokens: usageTotal.outputTokens + result.usage.outputTokens,
              }
          }
          ctx.session.append('assistant/message', {
            turn,
            step,
            ...(result.usage !== undefined ? { usage: result.usage } : {}),
          })
          output = result.message.content

          // 3) 工具欠账:逐个执行并回填 role=tool 消息
          const calls = result.message.toolCalls ?? []
          if (calls.length === 0) break
          for (const call of calls) {
            allCalls.push({ callId: call.id, name: call.name })
            ctx.session.append('tool/call', { turn, step, callId: call.id, name: call.name, arguments: call.arguments })
            let resultText: string
            try {
              const args: unknown = JSON.parse(call.arguments)
              const toolResult = await executor.exec({ name: call.name, args, turn, step })
              resultText = toolResult.content.map(block => block.text).join('\n')
              ctx.session.append('tool/result', { turn, step, callId: call.id, name: call.name, isError: !toolResult.ok })
            } catch (error) {
              resultText = `tool ${call.name} 参数或执行失败:${error instanceof Error ? error.message : String(error)}`
              ctx.session.append('tool/result', { turn, step, callId: call.id, name: call.name, isError: true })
            }
            messages.push({ role: 'tool', content: resultText, toolCallId: call.id, name: call.name })
          }
          ctx.session.append('step/end', { turn, step })

          // 4) turn-stopping 检查点:守卫插件经 agent.cancel 终止(串行语义)
          await ctx.parallel('agent/turn-stopping', { agent, turn, signal })
          if (isCancelled()) {
            stoppedBy = agent.stopReason
            break
          }
        }
        if (stoppedBy === undefined && steps >= stepBudget) {
          stoppedBy = `step 预算耗尽(${stepBudget})`
        }
      } finally {
        ctx.session.append('turn/end', { turn, reason: stoppedBy !== undefined ? { kind: 'stopped', message: stoppedBy } : { kind: 'completed' } })
      }

      const result: TurnResult = {
        turn,
        steps,
        output,
        toolCalls: allCalls,
        ...((usageTotal !== undefined || stoppedBy !== undefined) && {
          ...(usageTotal !== undefined ? { usage: { inputTokens: usageTotal.inputTokens, outputTokens: usageTotal.outputTokens } } : {}),
          ...(stoppedBy !== undefined ? { stoppedBy } : {}),
        }),
      }
      return result
    },
  }
}
