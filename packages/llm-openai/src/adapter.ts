/** Chat-completions transport with one cancellable lifecycle per model request. */

import { attributionHeaders, LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm'
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
      throw new LlmError(`Basis OpenAI gateway returned ${String(response.status)}: ${text.slice(0, 400)}`, 'PROVIDER_ERROR', { cause: new Error(text) })
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
      yield JSON.parse(payload) as Record<string, unknown>
    }
  }
}
