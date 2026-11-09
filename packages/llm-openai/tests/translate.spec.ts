/** Unit tests for the OpenAI SSE-frame translator (pure functions). */

import { describe, expect, it } from 'vitest'
import { translate } from '../src/translate.ts'

async function collect(frames: unknown[]): Promise<{ chunks: unknown[]; error?: unknown }> {
  const chunks: unknown[] = []
  async function* source(): AsyncGenerator<Record<string, unknown>> {
    for (const frame of frames) yield frame as Record<string, unknown>
  }
  try {
    for await (const chunk of translate(source())) chunks.push(chunk)
  } catch (error) {
    return { chunks, error }
  }
  return { chunks }
}

const frame = (delta: Record<string, unknown>, extra: { finish_reason?: string; usage?: unknown } = {}) => ({
  choices: [{ index: 0, delta, finish_reason: extra.finish_reason ?? null }],
  usage: extra.usage ?? null,
})

describe('translate', () => {
  it('streams reasoning then text with synthesized block ends, usage, and a stop finish', async () => {
    const { chunks, error } = await collect([
      frame({ role: 'assistant', content: null, reasoning_content: '' }),
      frame({ reasoning_content: 'thin' }),
      frame({ reasoning_content: 'king' }),
      frame({ content: null, reasoning_content: null }),
      frame({ content: 'He' }),
      frame({ content: 'llo' }),
      frame({}, { finish_reason: 'stop', usage: { prompt_tokens: 5, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 1 } } }),
    ])
    expect(error).toBeUndefined()
    expect(chunks).toEqual([
      { type: 'reasoning-delta', index: 0, text: 'thin' },
      { type: 'reasoning-delta', index: 0, text: 'king' },
      { type: 'text-delta', index: 1, text: 'He' },
      { type: 'text-delta', index: 1, text: 'llo' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'thinking' } },
      { type: 'block-end', index: 1, block: { type: 'text', text: 'Hello' } },
      { type: 'usage', usage: { inputTokens: 5, outputTokens: 2, cacheReadTokens: 1, totalTokens: 8 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('accumulates tool-call fragments and emits deltas of new argument parts only', async () => {
    const { chunks, error } = await collect([
      frame({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read', arguments: '{"p":' } }] }),
      frame({ tool_calls: [{ index: 0, function: { arguments: '1}' } }] }),
      frame({}, { finish_reason: 'tool_calls' }),
      { choices: [], usage: { prompt_tokens: 9, completion_tokens: 3 } },
    ])
    expect(error).toBeUndefined()
    expect(chunks.filter(chunk => (chunk as { type: string }).type === 'tool-call-delta')).toEqual([
      { type: 'tool-call-delta', index: 0, id: 'call_1', name: 'read', argumentsDelta: '{"p":' },
      { type: 'tool-call-delta', index: 0, id: 'call_1', name: 'read', argumentsDelta: '1}' },
    ])
    expect(chunks).toContainEqual({
      type: 'block-end', index: 0,
      block: { type: 'tool-call', id: 'call_1', name: 'read', arguments: '{"p":1}' },
    })
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
  })

  it('maps finish reasons: length to max-tokens', async () => {
    const { chunks } = await collect([
      frame({ content: 'x' }),
      frame({}, { finish_reason: 'length' }),
    ])
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'max-tokens' } })
  })

  it('rejects a stream that ends without a finish reason', async () => {
    const { error } = await collect([frame({ content: 'x' })])
    expect((error as { code: string }).code).toBe('STREAM_CLOSED')
  })

  it('rejects an empty response that stops without content', async () => {
    const { error } = await collect([
      frame({ role: 'assistant', content: null }),
      frame({}, { finish_reason: 'stop' }),
    ])
    expect((error as { code: string }).code).toBe('EMPTY_RESPONSE')
  })

  it('ignores null usage fields and keeps usage from the terminal usage frame', async () => {
    const { chunks } = await collect([
      frame({ content: 'x' }),
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: null },
      { choices: [], usage: { prompt_tokens: 4, completion_tokens: 6 } },
    ])
    expect(chunks.filter(chunk => (chunk as { type: string }).type === 'usage')).toEqual([
      { type: 'usage', usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 } },
    ])
  })
})
