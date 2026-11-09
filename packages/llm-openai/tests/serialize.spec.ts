/** Unit tests for the OpenAI chat-completions wire serializer (pure functions). */

import { describe, expect, it } from 'vitest'
import { serialize } from '../src/serialize.ts'
import { resolveBasisOptions } from '../src/types.ts'
import type { BasisConnectionOptions } from '../src/types.ts'
import type { GenerateOptions, RequestMessage } from '@deepseek-ai/dsh-llm'

function connection(overrides: Partial<BasisConnectionOptions> = {}): BasisConnectionOptions {
  return { ...resolveBasisOptions({ baseURL: 'http://gateway:4000/v1' }), ...overrides }
}

function options(history: RequestMessage[], extra: Partial<GenerateOptions<string>> = {}): GenerateOptions<string> {
  return { provider: 'basis', model: 'deepseek-flash', messages: history, ...extra }
}

function message(role: string, content: unknown[], extra: Record<string, unknown> = {}): RequestMessage {
  return { role, content, ...extra } as unknown as RequestMessage
}

describe('serialize', () => {
  it('merges options.system, system snapshots, and developer updates into one leading system message', () => {
    const history: RequestMessage[] = [
      message('system', [{ type: 'text', text: 'snapshot one' }]),
      message('user', [{ type: 'text', text: 'hi' }]),
      message('developer', [{ type: 'text', text: 'runtime update' }]),
      message('system', [{ type: 'text', text: 'snapshot two' }]),
    ]
    const body = serialize(options(history, { system: 'persona line' }), connection(), history)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'persona line\n\nsnapshot one\n\nruntime update\n\nsnapshot two' })
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' })
  })

  it('skips empty user and assistant messages but keeps tool results with their call ids', () => {
    const history: RequestMessage[] = [
      message('user', [{ type: 'text', text: '' }]),
      message('assistant', [{ type: 'text', text: '' }]),
      message('user', [{ type: 'text', text: 'real' }]),
      message('assistant', [{ type: 'tool-call', id: 'call_1', name: 'read', arguments: '{"p":1}' }]),
      message('tool', [{ type: 'text', text: 'file body' }], { toolCallId: 'call_1' }),
    ]
    const body = serialize(options(history), connection(), history)
    expect(body.messages).toHaveLength(3)
    expect(body.messages[1]).toEqual({
      role: 'assistant', content: null,
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"p":1}' } }],
    })
    expect(body.messages[2]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'file body' })
  })

  it('degrades unparseable historical tool arguments to an empty object', () => {
    const history: RequestMessage[] = [
      message('assistant', [{ type: 'tool-call', id: 'c', name: 'n', arguments: '{broken' }]),
    ]
    const body = serialize(options(history), connection(), history)
    expect(body.messages[0]).toMatchObject({ tool_calls: [{ function: { arguments: '{}' } }] })
  })

  it('drops assistant reasoning blocks by default', () => {
    const history: RequestMessage[] = [
      message('assistant', [
        { type: 'reasoning', text: 'secret thoughts' },
        { type: 'text', text: 'answer' },
      ]),
    ]
    const body = serialize(options(history), connection({ replayReasoning: 'drop' }), history)
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0]).toEqual({ role: 'assistant', content: 'answer' })
    expect(JSON.stringify(body)).not.toContain('secret thoughts')
  })

  it('preserves reasoning as reasoning_content under the preserve policy', () => {
    const history: RequestMessage[] = [
      message('assistant', [
        { type: 'reasoning', text: 'thought a' },
        { type: 'reasoning', text: 'thought b' },
        { type: 'text', text: 'answer' },
      ]),
    ]
    const body = serialize(options(history), connection({ replayReasoning: 'preserve' }), history)
    expect(body.messages[0]).toEqual({ role: 'assistant', content: 'answer', reasoning_content: 'thought a\nthought b' })
  })

  it('emits a pure-reasoning assistant message under preserve when no other content exists', () => {
    const history: RequestMessage[] = [
      message('assistant', [{ type: 'reasoning', text: 'only thoughts' }]),
    ]
    const body = serialize(options(history), connection({ replayReasoning: 'preserve' }), history)
    expect(body.messages[0]).toEqual({ role: 'assistant', content: null, reasoning_content: 'only thoughts' })
  })

  it('maps tools, stop sequences, temperature, and max_tokens precedence', () => {
    const history: RequestMessage[] = [message('user', [{ type: 'text', text: 'go' }])]
    const conn = connection({ models: [{ id: 'deepseek-flash', maxTokens: 77 }], maxTokens: 999 })
    const body = serialize(options(history, {
      tools: [{ name: 't1', description: 'd', parameters: { type: 'object' } }],
      stop: ['END'], temperature: 0.4,
    }), conn, history)
    expect(body.max_tokens).toBe(77)
    expect(body.tools).toEqual([{ type: 'function', function: { name: 't1', description: 'd', parameters: { type: 'object' } } }])
    expect(body.stop).toEqual(['END'])
    expect(body.temperature).toBe(0.4)
  })

  it('falls back to connection max_tokens when the catalog entry has none', () => {
    const history: RequestMessage[] = [message('user', [{ type: 'text', text: 'go' }])]
    const body = serialize(options(history), connection({ maxTokens: 555 }), history)
    expect(body.max_tokens).toBe(555)
  })
})
