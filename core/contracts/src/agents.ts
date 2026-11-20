/**
 * agents seam 契约:AgentFactory 注册点("no privileged core" —— agent loop 本身
 * 就是一个普通插件,经本 seam 登记)。turn/step 语义见 docs/design/04 号笔记:
 * turn → 多 step;每 step = 一次模型请求 + 其工具调用。
 */
import type { Context } from '@core/cordis'
import type { LlmMessage, TokenUsage } from './llm.ts'
import type { ToolSchema } from './tools.ts'

/** turn-stopping 载荷里,守卫插件实际调用的 agent 能面(结构兼容 governance TurnStoppingAgentLike)。 */
export interface AgentHandle {
  readonly id: string
  cancel(cause: { readonly kind: 'hook'; readonly reason: string }, options?: { readonly keepInbox?: boolean }): void
}

/** agent/turn-stopping 事件载荷(结构兼容 governance TurnStoppingEvent)。 */
export interface TurnStoppingEvent {
  readonly agent: AgentHandle
  readonly turn: number
  readonly signal: AbortSignal
}

/** agent/pre-step 的 waterfall 草稿(可改写 messages/tools,或拒绝本 step)。 */
export interface StepDraft {
  readonly turn: number
  readonly step: number
  readonly messages: readonly LlmMessage[]
  readonly tools: readonly ToolSchema[]
}

/** 一个 turn 的终态。 */
export interface TurnResult {
  readonly turn: number
  readonly steps: number
  /** 最终助手文本。 */
  readonly output: string
  /** 本 turn 发起过的工具调用(顺序)。 */
  readonly toolCalls: readonly { readonly callId: string; readonly name: string }[]
  readonly usage?: TokenUsage
  /** 被 turn-stopping 终止时给出原因。 */
  readonly stoppedBy?: string
}

/** agent 运行器:吃一条用户输入,跑完一个 turn。 */
export interface AgentRunner {
  run(input: string): Promise<TurnResult>
}

/** AgentFactory:在指定 ctx 上物化一个 runner(effect 所有权归创建方)。 */
export type AgentFactory = (ctx: Context) => AgentRunner

/** agents 注册表(ctx.agents 服务面)。 */
export interface AgentRegistry {
  /** 注册具名 agent,返回 the exact disposer(effect 配逆)。 */
  register(name: string, factory: AgentFactory): () => void
  /** 按名物化 runner;缺省走默认 agent;未注册抛错。 */
  resolve(name?: string, ctx?: Context): AgentRunner
  /** 当前默认 agent 名;未设置返回 undefined。 */
  defaultName(): string | undefined
  /** 设默认 agent(未注册的名字抛错)。 */
  setDefault(name: string): void
}
