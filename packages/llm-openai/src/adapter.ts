/** Chat-completions transport with one cancellable lifecycle per model request. */

import { attributionHeaders, isContextWindowExceededError, isQuotaExceededError, LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type { BuiltinLlmFailureCode, GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm'
import { idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { BasisConnectionOptions as Connection } from './types.ts'
import { serialize } from './serialize.ts'
import { translate } from './translate.ts'

/** Auth headers resolved per operation by the owning plugin. */
export interface BasisAuth {
  headers: Record<string, string>
}

export interface BasisAdapterOptions {
  /** Validated connection facts for the current configuration generation. */
  options: () => Connection
  /** Resolve per-operation auth headers; rejects to fail the request. */
  resolveAuth: (connection: Connection) => Promise<BasisAuth>
}

/** Provider-owned fields of an OpenAI-style error envelope, when the body is one. */
interface ProviderErrorFields {
  /** Provider error `type` (e.g. `rate_limit_error`); empty when absent. */
  type: string
  /** Type, code, and message joined for wording classification. */
  detail: string
}

function providerFields(text: string): ProviderErrorFields {
  try {
    const parsed: unknown = JSON.parse(text)
    const error = typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>).error
      : undefined
    if (typeof error !== 'object' || error === null) return { type: '', detail: text }
    const fields = error as Record<string, unknown>
    return {
      type: typeof fields.type === 'string' ? fields.type : '',
      detail: [fields.type, fields.code, fields.message].filter(value => typeof value === 'string').join(' '),
    }
  } catch (_invalidErrorBody) {
    return { type: '', detail: text }
  }
}

/**
 * Classify one non-2xx answer into the rc.5 {@link BuiltinLlmFailureCode} table,
 * mirroring the upstream `llm-deepseek` provider classifier. Statuses the retry
 * policy distinguishes (429/5xx) become RATE_LIMIT/SERVER so `llm-retry`'s
 * default codes apply; provider error types, quota, and context-overflow
 * wording win over the raw status. Remaining statuses keep `HTTP_<status>`.
 * @param status - provider HTTP status.
 * @param fields - provider type/detail text from the error body.
 * @returns the provider-neutral failure code.
 */
function httpCode(status: number, fields: ProviderErrorFields): BuiltinLlmFailureCode {
  if (status === 401 || status === 403 || ['authentication_error', 'permission_error'].includes(fields.type)) return 'AUTH'
  if (status === 402 || isQuotaExceededError(fields.detail)) return 'QUOTA'
  if (status === 429 || fields.type === 'rate_limit_error') return 'RATE_LIMIT'
  if (isContextWindowExceededError(fields.detail)) return 'CONTEXT_WINDOW_EXCEEDED'
  if (status === 400 || status === 413 || fields.type === 'invalid_request_error') return 'INVALID_REQUEST'
  if (status >= 500 || ['api_error', 'overloaded_error'].includes(fields.type)) return 'SERVER'
  return `HTTP_${status}`
}

/** OpenAI-compatible provider: text and tool streams over chat-completions SSE. */
export class BasisOpenAIAdapter extends LlmAdapter {
  constructor(private readonly dependencies: BasisAdapterOptions) {
    super()
  }

  override providerInfo(provider: string) {
    return { id: provider, name: 'Basis LLM (OpenAI-compatible)' }
  }

  override listModels(provider: string) {
    const connection = this.dependencies.options()
    return Promise.resolve((connection.models ?? []).map((model): LlmModelInfo => ({
      provider,
      id: model.id,
      name: model.name ?? model.id,
      inputModalities: ['text'],
    })))
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const connection = this.dependencies.options()
    const configured = connection.models?.find(entry => entry.id === model)
    return Promise.resolve({
      provider,
      id: model,
      name: configured?.name ?? model,
      inputModalities: ['text'],
      ...configured?.maxTokens === undefined ? {} : { defaultMaxTokens: configured.maxTokens },
    })
  }

  override async prepareCall(provider: string, model: string, _signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const resolved = await this.resolveModel(provider, model)
    return { model: resolved, stream: options => this.generate(options) }
  }

  /** Direct one-shot streaming for callers holding a connection already. */
  override stream(options: GenerateOptions<string>): AsyncIterable<StreamChunk> {
    return this.generate(options)
  }

  private async * generate(options: GenerateOptions<string>): AsyncGenerator<StreamChunk> {
    const consumer = new AbortController()
    const signal = options.signal === undefined ? consumer.signal : AbortSignal.any([consumer.signal, options.signal])
    const connection = this.dependencies.options()
    using watchdog = idleWatchdog(signal, connection.streamIdleTimeoutMs, 'BASIS_OPENAI_IDLE')
    const iterator = this.request(options, connection, watchdog.signal, () => { watchdog.pulse() })
    try {
      while (true) {
        const next = await watchdog.next(iterator)
        if (next.done) return
        yield next.value
      }
    } catch (error) {
      if (timeoutOf(watchdog.signal, 'BASIS_OPENAI_IDLE') !== undefined) throw new LlmError('Basis OpenAI stream idle timeout', 'TIMEOUT', { cause: error })
      if (options.signal?.aborted) throw new LlmError('Basis OpenAI request aborted', 'ABORTED', { cause: error })
      if (error instanceof LlmError) throw error
      throw new LlmError('Basis OpenAI transport failed', 'TRANSPORT', { cause: error })
    } finally {
      consumer.abort()
      void iterator.return(undefined).catch(() => {})
    }
  }

  private async * request(
    options: GenerateOptions<string>, connection: Connection, signal: AbortSignal, activity: () => void,
  ): AsyncGenerator<StreamChunk> {
    signal.throwIfAborted()
    const auth = await this.dependencies.resolveAuth(connection)
    const body = serialize(options, connection, options.messages)
    console.warn(`[basis-llm-openai] POST ${connection.baseURL}/chat/completions model=${options.model}`)
    const response = await fetch(`${connection.baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', signal, body: JSON.stringify(body), redirect: 'error',
      headers: {
        ...attributionHeaders(),
        'content-type': 'application/json',
        accept: 'text/event-stream',
        ...auth.headers,
      },
    })
    if (!response.ok) {
      const text = await response.text()
      // code 必须落在 BuiltinLlmFailureCode 的 `HTTP_${number}` 分支:插值须是数值表达式。
      // `HTTP_${String(response.status)}` 会退化成 `HTTP_${string}`,tsc 直接拒(TS2345)。
      throw new LlmError(
        `Basis OpenAI gateway returned ${String(response.status)}: ${text.slice(0, 400)}`,
        httpCode(response.status, providerFields(text)),
        { cause: new Error(text), status: response.status },
      )
    }
    if (response.body === null) throw new LlmError('Basis OpenAI gateway returned no response body', 'EMPTY_RESPONSE')
    yield* translate(readFrames(response.body, activity))
  }
}

/** Frame an SSE body into decoded `data:` JSON payloads, stopping at `[DONE]`. */
async function* readFrames(body: ReadableStream<Uint8Array>, activity: () => void): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    activity()
    buffer += decoder.decode(value, { stream: true })
    let index: number
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).replace(/\r$/, '')
      buffer = buffer.slice(index + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload.length === 0 || payload === '[DONE]') continue
      try {
        yield JSON.parse(payload) as Record<string, unknown>
      } catch (_invalidSseJson) {
        throw new LlmError('Basis OpenAI stream contains invalid JSON', 'MALFORMED_RESPONSE')
      }
    }
  }
}
