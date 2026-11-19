/**
 * openai-completions 语义 provider(node fetch + SSE,零 SDK)。
 * 消息与响应的 wire 映射集中在本文件;TokenUsage 按 prompt/completion/total + cached 细分映射。
 */
import type {
  FinishReason, LlmChatRequest, LlmChatResult, LlmMessage, LlmProvider, LlmToolCall,
  StreamChunk, TokenUsage,
} from '@core/contracts'

/** wire 请求消息(role/content/tool_calls/tool_call_id)。 */
interface WireMessage {
  role: string
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
  name?: string
}

export interface ProviderOptions {
  readonly name: string
  readonly model: string
  /** completions 端点基底(如 LiteLLM 网关 http://127.0.0.1:4000)。 */
  readonly baseUrl: string
  /** 每次请求时求值 env(测试注入)。 */
  readonly apiKey: () => string | undefined
  /** fetch 注入(测试 mock;缺省全局 fetch)。 */
  readonly fetchImpl?: typeof fetch
}

function toWireMessage(message: LlmMessage): WireMessage {
  const wire: WireMessage = { role: message.role, content: message.content }
  if (message.role === 'assistant' && message.toolCalls !== undefined && message.toolCalls.length > 0) {
    wire.tool_calls = message.toolCalls.map(call => ({
      id: call.id,
      type: 'function' as const,
      function: { name: call.name, arguments: call.arguments },
    }))
  }
  if (message.role === 'tool') {
    if (message.toolCallId !== undefined) wire.tool_call_id = message.toolCallId
    if (message.name !== undefined) wire.name = message.name
  }
  return wire
}

function mapFinish(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case 'stop': return { kind: 'stop' }
    case 'tool_calls': return { kind: 'tool-calls' }
    case 'length': return { kind: 'max-tokens' }
    default: return { kind: reason === null || reason === undefined || reason === '' ? 'stop' : reason }
  }
}

function mapUsage(usage: unknown): TokenUsage | undefined {
  if (usage === null || typeof usage !== 'object') return undefined
  const record = usage as Record<string, unknown>
  const input = typeof record['prompt_tokens'] === 'number' ? record['prompt_tokens'] : 0
  const output = typeof record['completion_tokens'] === 'number' ? record['completion_tokens'] : 0
  const details = (record['prompt_tokens_details'] ?? null) as Record<string, unknown> | null
  const cached = details !== null && typeof details['cached_tokens'] === 'number' ? details['cached_tokens'] : undefined
  const mapped: TokenUsage = {
    inputTokens: input,
    outputTokens: output,
    ...(typeof record['total_tokens'] === 'number' ? { totalTokens: record['total_tokens'] } : {}),
    ...(cached !== undefined ? { cacheReadTokens: cached } : {}),
  }
  return mapped
}

function mapToolCalls(raw: unknown): LlmToolCall[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const record = item as Record<string, unknown>
    const fn = record['function'] as Record<string, unknown> | undefined
    if (fn === undefined || typeof record['id'] !== 'string' || typeof fn['name'] !== 'string') return []
    return [{
      id: record['id'],
      name: fn['name'],
      arguments: typeof fn['arguments'] === 'string' ? fn['arguments'] : JSON.stringify(fn['arguments'] ?? {}),
    }]
  })
}

/** 构造一个 openai-completions provider(chat 非流式 + stream SSE)。 */
export function createOpenAiCompatProvider(options: ProviderOptions): LlmProvider {
  const doFetch = options.fetchImpl ?? fetch

  async function post(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    const key = options.apiKey()
    return doFetch(`${options.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key !== undefined ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(body),
      ...(signal !== undefined ? { signal } : {}),
    })
  }

  function buildBody(request: LlmChatRequest, stream: boolean): Record<string, unknown> {
    return {
      model: request.model ?? options.model,
      messages: request.messages.map(toWireMessage),
      ...(request.tools !== undefined && request.tools.length > 0
        ? { tools: request.tools.map(schema => ({ type: 'function', function: schema })) }
        : {}),
      ...(request.controls?.temperature !== undefined ? { temperature: request.controls.temperature } : {}),
      ...(request.controls?.maxTokens !== undefined ? { max_tokens: request.controls.maxTokens } : {}),
      ...(request.controls?.stop !== undefined ? { stop: request.controls.stop } : {}),
      ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    }
  }

  async function readError(response: Response): Promise<string> {
    const text = await response.text().catch(() => '')
    return `LLM HTTP ${String(response.status)}:${text.slice(0, 300)}`
  }

  return {
    name: options.name,
    model: options.model,
    async chat(request, signal): Promise<LlmChatResult> {
      const response = await post(buildBody(request, false), signal)
      if (!response.ok) throw new Error(await readError(response))
      const payload = (await response.json()) as Record<string, unknown>
      const choice = (payload['choices'] as Record<string, unknown>[] | undefined)?.[0]
      const message = choice?.['message'] as Record<string, unknown> | undefined
      const content = typeof message?.['content'] === 'string' ? message['content'] : ''
      const toolCalls = mapToolCalls(message?.['tool_calls'])
      const usage = mapUsage(payload['usage'])
      const result: LlmChatResult = {
        message: { role: 'assistant', content, ...(toolCalls.length > 0 ? { toolCalls } : {}) },
        ...(usage !== undefined ? { usage } : {}),
        finish: mapFinish(choice?.['finish_reason'] as string | undefined),
      }
      return result
    },

    async *stream(request, signal): AsyncGenerator<StreamChunk> {
      const response = await post(buildBody(request, true), signal)
      if (!response.ok) throw new Error(await readError(response))
      if (response.body === null) throw new Error('LLM 流式响应缺 body')
      // SSE 增量聚合:text-delta 逐片产出;tool_calls 按 index 聚合到 finish 前
      const partials = new Map<number, { id: string; name: string; arguments: string }>()
      let usage: TokenUsage | undefined
      let finish: FinishReason = { kind: 'stop' }
      let buffer = ''
      const decoder = new TextDecoder()
      let index = 0
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk as Uint8Array, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') continue
          let payload: Record<string, unknown>
          try {
            payload = JSON.parse(data) as Record<string, unknown>
          } catch {
            continue
          }
          const choice = (payload['choices'] as Record<string, unknown>[] | undefined)?.[0]
          const delta = choice?.['delta'] as Record<string, unknown> | undefined
          if (delta !== undefined && typeof delta['content'] === 'string' && delta['content'].length > 0) {
            yield { type: 'text-delta', index, delta: delta['content'] }
            index += 1
          }
          const rawCalls = delta?.['tool_calls']
          if (Array.isArray(rawCalls)) {
            for (const raw of rawCalls) {
              const record = raw as Record<string, unknown>
              const fn = record['function'] as Record<string, unknown> | undefined
              const slot = typeof record['index'] === 'number' ? record['index'] : 0
              const partial = partials.get(slot) ?? { id: '', name: '', arguments: '' }
              if (typeof record['id'] === 'string') partial.id = record['id']
              if (typeof fn?.['name'] === 'string') partial.name = fn['name']
              if (typeof fn?.['arguments'] === 'string') partial.arguments += fn['arguments']
              partials.set(slot, partial)
            }
          }
          if (choice?.['finish_reason'] !== undefined && choice['finish_reason'] !== null) {
            finish = mapFinish(choice['finish_reason'] as string)
          }
          const chunkUsage = mapUsage(payload['usage'])
          if (chunkUsage !== undefined) usage = chunkUsage
        }
      }
      for (const partial of Array.from(partials.values())) {
        if (partial.id.length === 0 || partial.name.length === 0) continue
        const call = { id: partial.id, name: partial.name, arguments: partial.arguments }
        yield { type: 'tool-call', index, call }
      }
      if (usage !== undefined) {
        yield { type: 'usage', usage }
      }
      yield { type: 'finish', reason: finish }
    },
  }
}

/** 把流切片归并为 chat 结果(loop 在 provider 无 stream 或需要终态时的共用路径)。 */
export async function assembleStream(chunks: AsyncIterable<StreamChunk>): Promise<LlmChatResult> {
  let content = ''
  const toolCalls: LlmToolCall[] = []
  let usage: TokenUsage | undefined
  let finish: FinishReason = { kind: 'stop' }
  for await (const chunk of chunks) {
    switch (chunk.type) {
      case 'text-delta': {
        content += chunk.delta
        break
      }
      case 'tool-call': {
        toolCalls.push(chunk.call)
        break
      }
      case 'usage': {
        usage = chunk.usage
        break
      }
      case 'finish': {
        finish = chunk.reason
        break
      }
    }
  }
  return {
    message: { role: 'assistant', content, ...(toolCalls.length > 0 ? { toolCalls } : {}) },
    ...(usage !== undefined ? { usage } : {}),
    finish,
  }
}
