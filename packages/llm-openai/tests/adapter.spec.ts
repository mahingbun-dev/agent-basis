/** Regression tests for the chat-completions transport: rc.5 LlmError code/status mapping. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, RequestMessage, StreamChunk } from '@deepseek-ai/dsh-llm'
import { BasisOpenAIAdapter } from '../src/adapter.ts'
import { resolveBasisOptions } from '../src/types.ts'
import type { BasisConnectionOptions } from '../src/types.ts'

const BASE = 'http://gateway:4000/v1'

function connection(overrides: Partial<BasisConnectionOptions> = {}): BasisConnectionOptions {
  return { ...resolveBasisOptions({ baseURL: BASE }), ...overrides }
}

function request(extra: Partial<GenerateOptions<string>> = {}): GenerateOptions<string> {
  const messages: RequestMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
  return { provider: 'basis', model: 'deepseek-flash', messages, ...extra }
}

function adapter(
  overrides: Partial<BasisConnectionOptions> = {},
  resolveAuth: () => Promise<{ headers: Record<string, string> }> = () => Promise.resolve({ headers: { authorization: 'Bearer test' } }),
): BasisOpenAIAdapter {
  const facts = connection(overrides)
  return new BasisOpenAIAdapter({ options: () => facts, resolveAuth })
}

async function collect(
  target: BasisOpenAIAdapter,
  options: GenerateOptions<string> = request(),
): Promise<{ chunks: StreamChunk[]; error?: unknown }> {
  const chunks: StreamChunk[] = []
  try {
    for await (const chunk of target.stream(options)) chunks.push(chunk)
  } catch (error) {
    return { chunks, error }
  }
  return { chunks }
}

function llmError(value: unknown): LlmError {
  expect(value).toBeInstanceOf(LlmError)
  return value as LlmError
}

function sse(frames: readonly unknown[]): string {
  return frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n'
}

function errorBody(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } })
}

function causeOf(error: LlmError): Error {
  expect(error.cause).toBeInstanceOf(Error)
  return error.cause as Error
}

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('BasisOpenAIAdapter error mapping', () => {
  const statusCases: readonly [status: number, body: string, code: string][] = [
    [401, '{"error":{"message":"bad key","type":"authentication_error"}}', 'AUTH'],
    [403, 'permission denied', 'AUTH'],
    [402, '{"error":{"message":"payment required"}}', 'QUOTA'],
    [429, '{"error":{"message":"slow down","type":"rate_limit_error"}}', 'RATE_LIMIT'],
    [400, '{"error":{"message":"bad field","type":"invalid_request_error"}}', 'INVALID_REQUEST'],
    [413, 'payload too large', 'INVALID_REQUEST'],
    [500, '{"error":{"message":"boom","type":"api_error"}}', 'SERVER'],
    [503, '{"error":{"message":"overloaded","type":"overloaded_error"}}', 'SERVER'],
    [404, '{"error":{"message":"no such model"}}', 'HTTP_404'],
    [422, 'unprocessable', 'HTTP_422'],
  ]

  for (const [status, body, code] of statusCases) {
    it(`maps HTTP ${String(status)} to ${code} with the status and body retained`, async () => {
      fetchMock.mockResolvedValue(errorBody(status, body))
      const { error } = await collect(adapter())
      const failure = llmError(error)
      expect(failure.code).toBe(code)
      expect(failure.failure.status).toBe(status)
      expect(failure.message).toContain(`Basis OpenAI gateway returned ${String(status)}: ${body.slice(0, 400)}`)
      expect(causeOf(failure).message).toBe(body)
    })
  }

  it('classifies context-overflow wording over a generic 400', async () => {
    const body = '{"error":{"code":"context_length_exceeded","message":"This model\'s maximum context length is 8192 tokens."}}'
    fetchMock.mockResolvedValue(errorBody(400, body))
    const { error } = await collect(adapter())
    expect(llmError(error).code).toBe('CONTEXT_WINDOW_EXCEEDED')
  })

  it('classifies terminal quota wording over a generic 429', async () => {
    const body = '{"error":{"code":"insufficient_quota","message":"You exceeded your current quota, please check your plan."}}'
    fetchMock.mockResolvedValue(errorBody(429, body))
    const { error } = await collect(adapter())
    expect(llmError(error).code).toBe('QUOTA')
  })

  it('uses the provider error type when the status is generic', async () => {
    fetchMock.mockResolvedValue(errorBody(400, '{"error":{"message":"slow down","type":"rate_limit_error"}}'))
    expect(llmError((await collect(adapter())).error).code).toBe('RATE_LIMIT')

    fetchMock.mockResolvedValue(errorBody(418, '{"error":{"message":"upstream failed","type":"api_error"}}'))
    expect(llmError((await collect(adapter())).error).code).toBe('SERVER')
  })

  it('classifies plain-text quota wording and bounds the message to 400 characters', async () => {
    const body = `insufficient_quota ${'x'.repeat(500)}`
    fetchMock.mockResolvedValue(errorBody(418, body))
    const { error } = await collect(adapter())
    const failure = llmError(error)
    expect(failure.code).toBe('QUOTA')
    expect(failure.message).toBe(`Basis OpenAI gateway returned 418: ${body.slice(0, 400)}`)
    expect(causeOf(failure).message).toBe(body)
  })

  it('reports EMPTY_RESPONSE when a successful answer carries no body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
    const { error } = await collect(adapter())
    expect(llmError(error).code).toBe('EMPTY_RESPONSE')
  })

  it('reports TRANSPORT for a fetch rejection and keeps the cause', async () => {
    const rejected = new TypeError('fetch failed')
    fetchMock.mockRejectedValue(rejected)
    const { error } = await collect(adapter())
    const failure = llmError(error)
    expect(failure.code).toBe('TRANSPORT')
    expect(failure.cause).toBe(rejected)
  })

  it('reports MALFORMED_RESPONSE for an SSE data frame that is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('data: {not-json}\n\ndata: [DONE]\n\n', { status: 200 }))
    const { error } = await collect(adapter())
    expect(llmError(error).code).toBe('MALFORMED_RESPONSE')
  })

  it('passes an LlmError raised by the response body through unchanged', async () => {
    const malformed = new LlmError('Basis OpenAI stream: bad frame', 'MALFORMED_RESPONSE')
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(malformed)
      },
    })
    fetchMock.mockResolvedValue(new Response(body, { status: 200 }))
    const { error } = await collect(adapter())
    expect(error).toBe(malformed)
  })

  it('passes an LlmError raised by auth resolution through unchanged', async () => {
    const missing = new LlmError('no API key', 'MISSING_CREDENTIAL')
    const { error } = await collect(adapter({}, () => Promise.reject(missing)))
    expect(error).toBe(missing)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports ABORTED when the caller signal is already aborted', async () => {
    const { error } = await collect(adapter(), request({ signal: AbortSignal.abort() }))
    expect(llmError(error).code).toBe('ABORTED')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports TIMEOUT when the response stream stays idle past streamIdleTimeoutMs', async () => {
    const idle = new ReadableStream<Uint8Array>({ start() {} })
    fetchMock.mockResolvedValue(new Response(idle, { status: 200 }))
    const started = Date.now()
    const { error } = await collect(adapter({ streamIdleTimeoutMs: 25 }))
    const failure = llmError(error)
    expect(failure.code).toBe('TIMEOUT')
    expect((failure.cause as { code?: string }).code).toBe('BASIS_OPENAI_IDLE')
    expect(Date.now() - started).toBeGreaterThanOrEqual(20)
  })
})

describe('BasisOpenAIAdapter transport', () => {
  it('streams decoded chunks from SSE and sends the serialized request with auth headers', async () => {
    fetchMock.mockResolvedValue(new Response(sse([
      { choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 1 } },
    ]), { status: 200, headers: { 'content-type': 'text/event-stream' } }))

    // `purpose` is an arbitrary auxiliary string: the forwarding adapter's
    // `GenerateOptions<string>` signature must accept caller-declared purposes.
    const { error, chunks } = await collect(adapter(), request({ purpose: 'compaction' }))
    expect(error).toBeUndefined()
    expect(chunks).toContainEqual({ type: 'text-delta', index: 0, text: 'hello' })
    expect(chunks).toContainEqual({ type: 'usage', usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } })
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE}/chat/completions`)
    expect(init?.method).toBe('POST')
    expect(init?.redirect).toBe('error')
    const headers = init?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer test')
    expect(headers.accept).toBe('text/event-stream')
    expect(typeof init?.body).toBe('string')
    const body = JSON.parse(init?.body as string) as { model: string; stream: boolean }
    expect(body.model).toBe('deepseek-flash')
    expect(body.stream).toBe(true)
  })

  it('accepts arbitrary purpose strings from forwarding callers (compile-time contract)', () => {
    const purpose: Parameters<BasisOpenAIAdapter['stream']>[0]['purpose'] = 'arbitrary-purpose'
    expect(purpose).toBe('arbitrary-purpose')
  })
})
