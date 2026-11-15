/**
 * golden script 的 LLM 直连层(C4):liteLLM 网关(OpenAI 兼容 /chat/completions)
 * → dsh StreamChunk 适配,复用真实 `summarizeWithLlm` 装配(COMPACTION_INSTRUCTION
 * 作为末条 user 消息、BlockAssembler、finish 映射)。
 *
 * 凭据只在运行时读 `.secrets/`(gitignored),不写日志/报告/argv。
 * 消息映射与生产同构:assistant 的 tool-call 块映射为 OpenAI tool_calls,tool
 * 结果映射为 role:'tool'(tool_call_id 配对;已实测网关接受该形态,孤 tool 消息
 * 会被网关拒绝)。
 *
 * @module @eterna/compaction/evals/gateway
 */

import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, RequestMessage, StreamChunk } from '@deepseek-ai/dsh-llm'
import { summarizeWithLlm } from '../src/basic/summarizer.ts'
import type { SummarizationInput, SummaryResult } from '../src/basic/summarizer.ts'
import type { CaseSummarizer } from './runner.ts'

/** 网关直连配置(baseUrl 不含密钥;key 由调用方注入,不落报告)。 */
export interface GatewayConfig {
  readonly baseUrl: string
  readonly apiKey: string
  readonly model: string
  readonly maxTokens: number
  readonly timeoutMs?: number
}

/** 一次真实调用的观测记录(报告用;不含任何密钥)。 */
export interface GatewayCallRecord {
  readonly model: string
  readonly elapsedMs: number
  readonly promptTokens?: number
  readonly completionTokens?: number
  readonly reasoningTokens?: number
  readonly finish?: string
  readonly error?: string
}

/** liteLLM usage 负载的读取面(其余字段不读不型)。 */
interface GatewayUsage {
  readonly prompt_tokens?: number
  readonly completion_tokens?: number
  readonly completion_tokens_details?: { readonly reasoning_tokens?: number }
}

/** dsh 消息(含单次请求的 RequestUserInput)→ OpenAI 兼容消息;assistant 的 tool-call 块与 tool 结果按原义配对映射。 */
export function toOpenAiMessages(messages: readonly RequestMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => {
    const text = message.content
      .map(block => block.type === 'text' ? block.text : '')
      .filter(part => part.length > 0)
      .join('\n')
    if (message.role === 'tool') {
      const toolCallId = 'toolCallId' in message && typeof message.toolCallId === 'string'
        ? message.toolCallId
        : 'unknown'
      return { role: 'tool', tool_call_id: toolCallId, content: text || '(empty)' }
    }
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      const toolCalls = message.content
        .filter(block => block.type === 'tool-call')
        .map(block => ({
          id: String((block as { id: unknown }).id),
          type: 'function',
          function: {
            name: String((block as { name: unknown }).name),
            arguments: String((block as { arguments: unknown }).arguments),
          },
        }))
      if (toolCalls.length > 0) {
        return {
          role: 'assistant',
          ...(text.length > 0 ? { content: text } : {}),
          tool_calls: toolCalls,
        }
      }
    }
    return { role: message.role, content: text || '(empty)' }
  })
}

/**
 * 构造直连网关的 CaseSummarizer:内部经真实 `summarizeWithLlm`(fake ctx.llm.stream
 * 换成网关 fetch),调用观测进 `calls`。
 */
export function createGatewaySummarizer(config: GatewayConfig): {
  summarize: CaseSummarizer
  calls: GatewayCallRecord[]
} {
  const calls: GatewayCallRecord[] = []

  async function requestChat(options: GenerateOptions, signal?: AbortSignal): Promise<{ content: string; finish: string; usage?: GatewayUsage }> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 300_000)
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort)
    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: config.maxTokens,
          messages: toOpenAiMessages(options.messages),
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(`gateway HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)
      }
      const payload = await response.json() as {
        choices?: Array<{ finish_reason?: string; message?: { content?: string } }>
        usage?: GatewayUsage
        error?: { message?: string }
      }
      if (payload.error !== undefined) throw new Error(`gateway error: ${payload.error.message ?? 'unknown'}`)
      const choice = payload.choices?.[0]
      return {
        content: choice?.message?.content ?? '',
        finish: choice?.finish_reason ?? 'stop',
        ...(payload.usage === undefined ? {} : { usage: payload.usage }),
      }
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  const ctx = {
    llm: {
      stream: (options: GenerateOptions): AsyncIterable<StreamChunk> => {
        return (async function* () {
          const started = Date.now()
          try {
            const result = await requestChat(options, options.signal)
            const usage = result.usage
            calls.push({
              model: config.model,
              elapsedMs: Date.now() - started,
              finish: result.finish,
              ...(usage?.prompt_tokens === undefined ? {} : { promptTokens: usage.prompt_tokens }),
              ...(usage?.completion_tokens === undefined ? {} : { completionTokens: usage.completion_tokens }),
              ...(usage?.completion_tokens_details?.reasoning_tokens === undefined
                ? {}
                : { reasoningTokens: usage.completion_tokens_details.reasoning_tokens }),
            })
            if (result.content.length > 0) {
              yield { type: 'block-start', index: 0, blockType: 'text' }
              yield { type: 'text-delta', index: 0, text: result.content }
              yield { type: 'block-end', index: 0, block: { type: 'text', text: result.content } }
            }
            // finish_reason 映射:stop→stop;length→max-tokens(截断 fail-closed);
            // 其余(如 content_filter)按 error 抛给 finish 链。
            yield {
              type: 'finish',
              reason: result.finish === 'stop'
                ? { kind: 'stop' }
                : result.finish === 'length'
                  ? { kind: 'max-tokens' }
                  : { kind: 'error', failure: { message: `gateway finish_reason ${result.finish}`, code: 'FINISH' } },
            }
          } catch (error: unknown) {
            calls.push({
              model: config.model,
              elapsedMs: Date.now() - started,
              error: error instanceof Error ? error.message : String(error),
            })
            yield {
              type: 'finish',
              reason: { kind: 'error', failure: { message: error instanceof Error ? error.message : String(error), code: 'GATEWAY' } },
            }
          }
        })()
      },
    },
  } as unknown as Context

  return {
    calls,
    summarize: (input: SummarizationInput, agent: Parameters<CaseSummarizer>[1], signal?: AbortSignal): Promise<SummaryResult> =>
      summarizeWithLlm(ctx, {
        summarizationProvider: 'litellm',
        summarizationModel: config.model,
        maxTokens: config.maxTokens,
      }, input, agent, signal),
  }
}
