/**
 * llm seam 契约:provider 路由 + openai-completions 语义的请求/流式/用量形态。
 * 零 SDK 依赖:@basis/llm 用 node fetch + SSE 解析实现 provider;agent-loop 只消费本契约。
 */
import type { ContentBlock } from './content.ts'
import type { ToolSchema } from './tools.ts'

/** 助手发起的一次工具调用(模型输出面)。 */
export interface LlmToolCall {
  readonly id: string
  readonly name: string
  /** 模型原始 JSON 串(与 tool/call 会话事件同形态)。 */
  readonly arguments: string
}

/** 会话消息(openai-completions 语义的 v1 文本承载)。 */
export interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content: string
  /** role=assistant 时可能携带的调用欠账。 */
  readonly toolCalls?: readonly LlmToolCall[]
  /** role=tool 时对应的调用 id。 */
  readonly toolCallId?: string
  /** role=tool 时的工具名。 */
  readonly name?: string
}

/** 单次调用采样控制(缺省由路由默认值决定)。 */
export interface LlmControls {
  readonly temperature?: number
  readonly maxTokens?: number
  readonly stop?: readonly string[]
}

/** 一次 chat 请求。 */
export interface LlmChatRequest {
  /** provider 名;缺省 = 默认路由。 */
  readonly provider?: string
  readonly model?: string
  readonly messages: readonly LlmMessage[]
  readonly tools?: readonly ToolSchema[]
  readonly controls?: LlmControls
}

/** 模型响应为何停止(合并可扩展;adapter 可加 provider 特有 kind)。 */
export type FinishReason =
  | { readonly kind: 'stop' }
  | { readonly kind: 'tool-calls' }
  | { readonly kind: 'max-tokens' }
  | { readonly kind: 'aborted'; readonly message?: string }
  | { readonly kind: string }

/** 一次调用的 token 记账(计数互斥:cache 单列,billed input = 三者之和)。 */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/** 流式切片(v1 子集:text/tool-call/usage/finish)。 */
export type StreamChunk =
  | { readonly type: 'text-delta'; readonly index: number; readonly delta: string }
  | { readonly type: 'tool-call'; readonly index: number; readonly call: LlmToolCall }
  | { readonly type: 'usage'; readonly usage: TokenUsage }
  | { readonly type: 'finish'; readonly reason: FinishReason }

/** chat 结果(流式可由 assembleStream 归并出同形态)。 */
export interface LlmChatResult {
  readonly message: LlmMessage
  readonly usage?: TokenUsage
  readonly finish: FinishReason
  /** 内容块视图(与 message.content 同文本;给渲染面用)。 */
  readonly content?: readonly ContentBlock[]
}

/** 一个 LLM provider(命名路由;@basis/llm 注册)。 */
export interface LlmProvider {
  readonly name: string
  /** 该 provider 暴露的默认模型名。 */
  readonly model: string
  /** 非流式一次生成。 */
  chat(request: LlmChatRequest, signal?: AbortSignal): Promise<LlmChatResult>
  /** 流式生成;未实现时消费者回退 chat()。 */
  stream?(request: LlmChatRequest, signal?: AbortSignal): AsyncIterable<StreamChunk>
}

/** 一条 provider/model 路由(cache-guard / observe / evolve 的路由锚定消费面)。 */
export interface LlmRoute {
  readonly provider: string
  readonly model: string
}

/** llm 注册表(ctx.llm 服务面)。 */
export interface LlmRegistry {
  /** 注册 provider,返回 the exact disposer(effect 配逆)。 */
  register(provider: LlmProvider): () => void
  /** 按名解析;缺省走默认路由;不存在抛错。 */
  resolve(name?: string): LlmProvider
  /** 当前默认路由名;未设置返回 undefined。 */
  defaultRoute(): string | undefined
  /** 设默认路由(未注册的名字抛错)。 */
  setDefault(name: string): void
}
