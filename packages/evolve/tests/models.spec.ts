/**
 * dshLlmModelCaller 运行时单测(fake DSH llm stream 注入 —— 不真实调用):
 * text-delta 聚合 / finish 非 stop 抛错 / 流无 finish 抛错 / 请求形态透传。
 */
import { describe, expect, it } from 'vitest'
import { dshLlmModelCaller, parseJsonLoose } from '../src/index.ts'
import type { DshChunkLike, DshLlmLike, ModelRoute } from '../src/index.ts'

const route: ModelRoute = { provider: 'deepseek', model: 'deepseek-flash' }

function fakeLlm(chunks: readonly DshChunkLike[], capture?: { last: unknown }): DshLlmLike {
  return {
    async *stream(options) {
      if (capture !== undefined) capture.last = options
      for (const chunk of chunks) yield chunk
    },
  }
}

describe('dshLlmModelCaller', () => {
  it('聚合 text-delta 直到 finish(stop),请求形态 = provider/model/system/messages', async () => {
    const captured: { last: unknown } = { last: undefined }
    const caller = dshLlmModelCaller(fakeLlm([
      { type: 'text-delta', text: '{"mast":"' },
      { type: 'text-delta', text: 'F5"}' },
      { type: 'finish', reason: { kind: 'stop' } },
    ], captured))
    const text = await caller.call({
      route,
      system: 'sys',
      json: true,
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(text).toBe('{"mast":"F5"}')
    interface CapturedOptions {
      provider: string
      model: string
      system?: string
      temperature?: number
      messages: unknown[]
    }
    const options = captured.last as CapturedOptions
    expect(options.provider).toBe('deepseek')
    expect(options.model).toBe('deepseek-flash')
    expect(options.system).toBe('sys')
    expect(options.temperature).toBe(0) // json 模式温度钉 0
    expect(JSON.stringify(options.messages)).toContain('hi')
  })

  it('finish 非 stop(tool-calls/error/aborted)→ 抛错(不静默半截输出)', async () => {
    const caller = dshLlmModelCaller(fakeLlm([
      { type: 'text-delta', text: '部分' },
      { type: 'finish', reason: { kind: 'aborted' } },
    ]))
    await expect(caller.call({ route, messages: [] })).rejects.toThrow('aborted')
  })

  it('流无 finish → 抛错', async () => {
    const caller = dshLlmModelCaller(fakeLlm([{ type: 'text-delta', text: 'x' }]))
    await expect(caller.call({ route, messages: [] })).rejects.toThrow('未收到 finish')
  })

  it('parseJsonLoose:裸 JSON / 围栏 / 前后噪声三形态;全失败返回 undefined', () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 })
    expect(parseJsonLoose('```json\n{"a":2}\n```')).toEqual({ a: 2 })
    expect(parseJsonLoose('结论:{"a":3} 以上')).toEqual({ a: 3 })
    expect(parseJsonLoose('完全不是 JSON')).toBeUndefined()
  })
})
