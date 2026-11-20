/**
 * llm 冒烟:注册表路由纪律 / SSE 流解析 / provider chat(注入 fetch mock)/ 插件装配。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@core/cordis'
import { LlmRegistryImpl } from '../src/registry.ts'
import { assembleStream, createOpenAiCompatProvider } from '../src/openai.ts'
import type { LlmProvider, StreamChunk } from '@core/contracts'
import plugin from '../src/index.ts'

function sseResponse(events: readonly string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const event of events) controller.enqueue(encoder.encode(event))
      controller.close()
    },
  })
  return new Response(body, { status: 200 })
}

describe('LlmRegistryImpl', () => {
  it('唯一名;首个注册即默认;resolve 缺省走默认;撤销默认后需显式路由', () => {
    const registry = new LlmRegistryImpl()
    const stub: LlmProvider = {
      name: 'a',
      model: 'm1',
      chat: async () => ({ message: { role: 'assistant', content: '' }, finish: { kind: 'stop' } }),
    }
    const stubB: LlmProvider = { name: 'b', model: 'm2', chat: async () => ({ message: { role: 'assistant', content: '' }, finish: { kind: 'stop' } }) }
    const offA = registry.register(stub)
    const offB = registry.register(stubB)
    expect(registry.defaultRoute()).toBe('a')
    expect(registry.resolve().name).toBe('a')
    registry.setDefault('b')
    expect(registry.resolve().name).toBe('b')
    expect((): void => { registry.setDefault('nope') }).toThrow(/未注册/)
    offA()
    expect(registry.resolve('b').name).toBe('b')
    // 撤销的是非默认 provider,默认路由不受影响;撤销默认本身后才必须显式路由
    expect(registry.resolve().name).toBe('b')
    offB()
    expect((): unknown => registry.resolve()).toThrow(/无默认路由/)
  })
})

describe('openai-compat provider', () => {
  it('chat:映射 content/tool_calls/usage/finish', async () => {
    const provider = createOpenAiCompatProvider({
      name: 'litellm',
      model: 'deepseek-chat',
      baseUrl: 'http://mock/v1',
      apiKey: () => 'sk-test',
      fetchImpl: (async (): Promise<Response> => new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '你好', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'budget_calc', arguments: '{"lines":[]}' } }] }, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_tokens_details: { cached_tokens: 4 } },
      }), { status: 200 })),
    })
    const result = await provider.chat({ messages: [{ role: 'user', content: 'hi' }] })
    expect(result.message.content).toBe('你好')
    expect(result.message.toolCalls?.[0]).toMatchObject({ id: 'c1', name: 'budget_calc' })
    expect(result.finish).toEqual({ kind: 'tool-calls' })
    expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 5, totalTokens: 15, cacheReadTokens: 4 })
  })

  it('stream:SSE 切片解析(text-delta/tool-call 聚合/usage/finish)', async () => {
    const provider = createOpenAiCompatProvider({
      name: 'litellm',
      model: 'deepseek-chat',
      baseUrl: 'http://mock/v1',
      apiKey: () => undefined,
      fetchImpl: (async (): Promise<Response> => {
        return sseResponse([
          'data: {"choices":[{"delta":{"content":"he"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c9","function":{"name":"echo","arguments":"{\\"x\\""}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":1}"}}]},"finish_reason":null}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
          'data: [DONE]\n\n',
        ])
      }),
    })
    expect(typeof provider.stream).toBe('function')
    const streamFn = provider.stream?.bind(provider)
    const chunks: AsyncIterable<StreamChunk> = streamFn!({ messages: [{ role: 'user', content: 'hi' }] })
    const result = await assembleStream(chunks)
    expect(result.message.content).toBe('hello')
    expect(result.message.toolCalls?.[0]).toMatchObject({ id: 'c9', name: 'echo', arguments: '{"x":1}' })
    expect(result.finish).toEqual({ kind: 'tool-calls' })
    expect(result.usage).toMatchObject({ inputTokens: 3, outputTokens: 2 })
  })

  it('HTTP 错误规范化抛出', async () => {
    const provider = createOpenAiCompatProvider({
      name: 'litellm',
      model: 'm',
      baseUrl: 'http://mock/v1',
      apiKey: () => undefined,
      fetchImpl: (async (): Promise<Response> => new Response('boom', { status: 500 })),
    })
    await expect(provider.chat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(/500/)
  })
})

describe('插件装配', () => {
  it('provide ctx.llm;dispose 后服务撤销', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(plugin)
    await fiber
    const registry = (ctx as unknown as { llm: LlmRegistryImpl }).llm
    expect(registry.defaultRoute()).toBe('litellm')
    await fiber.dispose()
    expect(ctx.reflect.get('llm', false)).toBeUndefined()
  })
})
