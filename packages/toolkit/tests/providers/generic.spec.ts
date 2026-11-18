/**
 * K2.3 generic 适配器单测——function calling 客户端循环(36 号 §3 表 K2.3 门禁:
 * 0/1/N 调用、非法 arguments 容错、[DONE]/error 帧/无标记中断三终结、回灌序列)。
 *
 * 逐条对齐 29a R3 八条裁剪(结论表「协议环节 × 标准形态」):
 * - 发送 4:四件套/命名规范/朴素 schema/禁入键(strict 等 8 个 OpenAI 特有键任何深度拒绝);
 * - 接收 2:arguments 容错解析(非法→不执行工具、回灌错误字符串)/finish_reason==='tool_calls' 判工具轮;
 * - 回灌 2:先 assistant(原样 tool_calls)后每调用一条 tool 消息(恒非空)/同一 tools 声明循环;
 * - 流式:delta.tool_calls[i].index 归并、id/name 首帧、三终结([DONE]/error 帧/无标记中断);
 * - parallel_tool_calls 显式声明;tool_call id 无格式契约(不依赖前缀)。
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_TOOL_RESULT_PLACEHOLDER,
  GenericLoopError,
  buildGenericChatRequest,
  collectChatStream,
  parseSseLine,
  parseToolCallArguments,
  runToolLoop,
  toToolResultContent,
} from '../../src/index.ts'
import type { GenericChatResponse, GenericChatMessage, GenericChatTransport } from '../../src/index.ts'
import { toGenericFunctionTool } from '../../src/index.ts'
import { ForbiddenKeyError } from '../../src/index.ts'
import { ToolNameError } from '../../src/index.ts'

const SEARCH_TOOL = toGenericFunctionTool({
  name: 'web_search',
  description: '搜索',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
})

/** 脚本化非流式传输:按序回放响应,同时捕获每轮请求(回灌序列断言证据)。 */
function scriptedTransport(responses: readonly GenericChatResponse[]): {
  transport: GenericChatTransport
  requests: GenericChatMessage[][]
} {
  const requests: GenericChatMessage[][] = []
  let index = 0
  const transport: GenericChatTransport = async (request) => {
    requests.push(request.messages.map(message => structuredClone(message)))
    const response = responses[index]
    index += 1
    if (response === undefined) throw new Error(`脚本响应耗尽(第 ${index} 轮)`)
    return structuredClone(response)
  }
  return { transport, requests }
}

function toolCallResponse(calls: readonly { id: string; name: string; arguments: string }[]): GenericChatResponse {
  return {
    choices: [{
      message: { role: 'assistant', content: null, tool_calls: calls.map(call => ({ id: call.id, type: 'function' as const, function: { name: call.name, arguments: call.arguments } })) },
      finish_reason: 'tool_calls',
    }],
  }
}

const FINAL_RESPONSE: GenericChatResponse = {
  choices: [{ message: { role: 'assistant', content: '搜索完成,答案如下。' }, finish_reason: 'stop' }],
}

describe('R3 八条裁剪 · 发送侧(1–4)', () => {
  it('四件套 + parallel_tool_calls 显式 + tool_choice 默认 auto;请求不含任何禁入键', () => {
    const request = buildGenericChatRequest({ messages: [{ role: 'user', content: 'q' }], tools: [SEARCH_TOOL] })
    expect(request.tools).toEqual([SEARCH_TOOL])
    expect(request.parallel_tool_calls).toBe(true)
    expect(request.tool_choice).toBe('auto')
    expect(JSON.stringify(request)).not.toContain('strict')
    expect(JSON.stringify(request)).not.toContain('"functions"')
  })

  it('禁入键任何深度静态拒绝(strict/functions/function_call 等)', () => {
    expect(() => buildGenericChatRequest({
      messages: [{ role: 'user', content: 'q', ...({ strict: true } as object) }],
    })).toThrow(ForbiddenKeyError)
    const nested = buildGenericChatRequest({
      messages: [{ role: 'user', content: 'q' }],
      tools: [SEARCH_TOOL],
      toolChoice: { type: 'function', function: { name: 'web_search' } },
    })
    expect(nested.tool_choice).toEqual({ type: 'function', function: { name: 'web_search' } })
  })

  it('工具名不符契约命名规范即拒(^[a-zA-Z0-9_-]+$ 且 ≤64)', () => {
    expect(() => toGenericFunctionTool({ name: 'web.search', description: 'x', parameters: {} })).toThrow(ToolNameError)
    expect(() => toGenericFunctionTool({ name: 'a'.repeat(65), description: 'x', parameters: {} })).toThrow(ToolNameError)
  })
})

describe('R3 八条裁剪 · 接收/回灌(5–8)', () => {
  it('N 调用回灌序列:assistant(原样 tool_calls) → 每调用一条 tool 消息;下一轮同一 tools 声明', async () => {
    const executed: string[] = []
    const { transport, requests } = scriptedTransport([
      toolCallResponse([
        { id: 'call_a', name: 'web_search', arguments: '{"query":"a"}' },
        { id: 'call_b', name: 'web_search', arguments: '{"query":"b"}' },
      ]),
      FINAL_RESPONSE,
    ])
    const result = await runToolLoop({
      transport,
      messages: [{ role: 'user', content: '查一下' }],
      tools: [SEARCH_TOOL],
      execute: async (call) => {
        executed.push(call.id)
        return `结果:${String((call.arguments as { query?: string }).query)}`
      },
    })
    expect(executed).toEqual(['call_a', 'call_b'])
    // 第二轮请求 = 回灌序列(user → assistant 原样 tool_calls → tool×N;R3 固定序列)。
    expect(requests[1]).toEqual([
      { role: 'user', content: '查一下' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_a', type: 'function', function: { name: 'web_search', arguments: '{"query":"a"}' } },
          { id: 'call_b', type: 'function', function: { name: 'web_search', arguments: '{"query":"b"}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_a', content: '结果:a' },
      { role: 'tool', tool_call_id: 'call_b', content: '结果:b' },
    ])
    expect(result.finalContent).toBe('搜索完成,答案如下。')
    expect(result.finishReason).toBe('stop')
    // rounds=完整传输轮日志:轮1=工具轮(两调用),轮2=收尾轮(零调用)。
    expect(result.rounds).toHaveLength(2)
    expect(result.rounds[0]?.toolCalls.map(call => call.status)).toEqual(['ok', 'ok'])
    expect(result.rounds[1]?.toolCalls).toEqual([])
  })

  it('0 调用:finish_reason!=="tool_calls" 直接收尾,不执行任何工具', async () => {
    let executions = 0
    const { transport, requests } = scriptedTransport([FINAL_RESPONSE])
    const result = await runToolLoop({
      transport,
      messages: [{ role: 'user', content: '直接回答' }],
      tools: [SEARCH_TOOL],
      execute: () => {
        executions += 1
        return '不应执行'
      },
    })
    expect(executions).toBe(0)
    expect(requests).toHaveLength(1)
    expect(result.finalContent).toBe('搜索完成,答案如下。')
  })

  it('非法 arguments:容错解析失败不执行工具,回灌错误字符串(官方明示可能非法 JSON)', async () => {
    const executed: string[] = []
    const { transport, requests } = scriptedTransport([
      toolCallResponse([{ id: 'call_bad', name: 'web_search', arguments: '{"query": "截断' }]),
      FINAL_RESPONSE,
    ])
    const result = await runToolLoop({
      transport,
      messages: [{ role: 'user', content: 'q' }],
      tools: [SEARCH_TOOL],
      execute: (call) => {
        executed.push(call.id)
        return 'x'
      },
    })
    expect(executed).toEqual([])
    const toolMessage = requests[1]?.find(message => message.role === 'tool')
    expect(toolMessage?.tool_call_id).toBe('call_bad')
    expect(toolMessage?.content ?? '').toContain('arguments 非合法 JSON')
    expect((toolMessage?.content ?? '').length).toBeGreaterThan(0)
    expect(result.rounds[0]?.toolCalls[0]?.parseError).toContain('非合法 JSON')
    expect(result.rounds[0]?.toolCalls[0]?.status).toBe('error')
  })

  it('执行抛错:显式回灌非空错误文案(29 号 §5 降级语义)', async () => {
    const { transport, requests } = scriptedTransport([
      toolCallResponse([{ id: 'call_x', name: 'web_search', arguments: '{"query":"x"}' }]),
      FINAL_RESPONSE,
    ])
    await runToolLoop({
      transport,
      messages: [{ role: 'user', content: 'q' }],
      tools: [SEARCH_TOOL],
      execute: () => {
        throw new Error('下游 500')
      },
    })
    const toolMessage = requests[1]?.find(message => message.role === 'tool')
    expect(toolMessage?.content ?? '').toContain('工具执行失败')
    expect(toolMessage?.content ?? '').toContain('下游 500')
  })

  it('空结果回灌 coerce 为非空占位(失败/降级也显式回灌非空字符串)', () => {
    expect(toToolResultContent('')).toBe(EMPTY_TOOL_RESULT_PLACEHOLDER)
    expect(EMPTY_TOOL_RESULT_PLACEHOLDER.length).toBeGreaterThan(0)
  })

  it('轮数上限:恒 tool_calls 的模型显式失败而非死循环(实现护栏)', async () => {
    const { transport } = scriptedTransport(Array.from({ length: 3 }, () => toolCallResponse([{ id: 'c', name: 'web_search', arguments: '{}' }])))
    await expect(runToolLoop({
      transport,
      messages: [{ role: 'user', content: 'q' }],
      tools: [SEARCH_TOOL],
      execute: () => 'ok',
      maxRounds: 2,
    })).rejects.toThrow(GenericLoopError)
  })
})

describe('R3 · 流式(delta.tool_calls[i].index 归并 + 三终结)', () => {
  const STREAM_CHUNKS = [
    'data: {"choices":[{"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_s","type":"function","function":{"name":"web_search","arguments":""}}]}}]}',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"query\\":\\"流式\\""}}]}}]}',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]}}]}',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_t","type":"function","function":{"name":"read_url","arguments":"{\\"url\\":\\"https://example.com\\"}"}}],"content":"思考中"}}]}',
  ]

  it('按 index 归并:id/name 首帧携带,arguments 增量分片累加;[DONE] 终结', async () => {
    const lines = (async function* generate(): AsyncIterable<string> {
      yield* [...STREAM_CHUNKS, 'data: [DONE]']
    })()
    const collected = await collectChatStream(lines)
    expect(collected.termination).toBe('done')
    expect(collected.message.tool_calls).toEqual([
      { id: 'call_s', type: 'function', function: { name: 'web_search', arguments: '{"query":"流式"}' } },
      { id: 'call_t', type: 'function', function: { name: 'read_url', arguments: '{"url":"https://example.com"}' } },
    ])
    expect(collected.message.content).toBe('思考中')
  })

  it('error 帧:含 error 字段的 JSON 帧终结为 error,原文保留', async () => {
    const lines = (async function* generate(): AsyncIterable<string> {
      yield STREAM_CHUNKS[0] as string
      yield 'data: {"error":{"message":"rate limited","code":429}}'
    })()
    const collected = await collectChatStream(lines)
    expect(collected.termination).toBe('error')
    expect(collected.error).toEqual({ message: 'rate limited', code: 429 })
  })

  it('无标记中断:流耗尽仍无 [DONE]/error → interrupted,已累积调用如实保留', async () => {
    const lines = (async function* generate(): AsyncIterable<string> {
      yield* STREAM_CHUNKS
    })()
    const collected = await collectChatStream(lines)
    expect(collected.termination).toBe('interrupted')
    expect(collected.message.tool_calls).toHaveLength(2)
  })

  it('流式工具轮:回灌序列与非流式一致;error 帧驱动下循环显式抛错', async () => {
    const executed: unknown[] = []
    const roundScripts: string[][] = [
      [...STREAM_CHUNKS, 'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}', 'data: [DONE]'],
      ['data: {"choices":[{"delta":{"content":"流式收尾"},"finish_reason":"stop"}]}', 'data: [DONE]'],
    ]
    let round = 0
    const streamTransport = (): AsyncIterable<string> => {
      const script = roundScripts[round] ?? []
      round += 1
      return (async function* generate(): AsyncIterable<string> {
        yield* script
      })()
    }
    const result = await runToolLoop({
      streamTransport,
      messages: [{ role: 'user', content: 'q' }],
      tools: [SEARCH_TOOL, toGenericFunctionTool({ name: 'read_url', description: '读', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } })],
      execute: (call) => {
        executed.push(call.name)
        return `ok:${call.name}`
      },
      maxRounds: 2,
    })
    expect(executed).toEqual(['web_search', 'read_url'])
    expect(result.rounds[0]?.toolCalls.map(call => call.name)).toEqual(['web_search', 'read_url'])
    expect(result.finalContent).toBe('流式收尾')
    expect(result.messages.filter(message => message.role === 'tool')).toHaveLength(2)
    const streamError = (async function* generate(): AsyncIterable<string> {
      yield 'data: {"error":{"message":"boom"}}'
    })()
    await expect(runToolLoop({
      streamTransport: async () => streamError,
      messages: [{ role: 'user', content: 'q' }],
      tools: [SEARCH_TOOL],
      execute: () => 'ok',
    })).rejects.toThrow('error 帧')
  })

  it('SSE 帧解析:字面 [DONE] 非 JSON;注释/空行忽略;非 JSON data 帧留证不静默吞', () => {
    expect(parseSseLine('data: [DONE]')).toEqual({ kind: 'done' })
    expect(parseSseLine('')).toEqual({ kind: 'empty' })
    expect(parseSseLine(': keep-alive')).toEqual({ kind: 'empty' })
    const parsed = parseSseLine('data: not-json')
    expect(parsed.kind).toBe('data')
    if (parsed.kind === 'data') {
      expect(parsed.payload).toEqual({ parse_error: expect.stringContaining('非 JSON data 帧') as unknown })
    }
  })
})

describe('R3 · arguments 容错解析(纯函数)', () => {
  it('合法 JSON/空串(空参数)/非法 JSON 三态', () => {
    expect(parseToolCallArguments('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
    expect(parseToolCallArguments('')).toEqual({ ok: true, value: {} })
    const bad = parseToolCallArguments('{nope')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('非合法 JSON')
  })
})
