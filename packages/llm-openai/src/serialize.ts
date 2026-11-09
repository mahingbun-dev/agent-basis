/** Map harness request messages to the OpenAI chat-completions wire format. */

import { LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message, RequestMessage } from '@deepseek-ai/dsh-llm'
import type { BasisConnectionOptions as Connection } from './types.ts'

interface WireToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: WireToolCall[]
  tool_call_id?: string
  /**
   * Non-standard reasoning replay, written only under `replayReasoning:
   * 'preserve'`. DeepSeek-family gateways ignore it harmlessly on assistant
   * history; gateways that reject unknown fields need the default `drop`.
   */
  reasoning_content?: string
}

export interface WireRequest {
  model: string
  stream: true
  stream_options: { include_usage: true }
  messages: WireMessage[]
  max_tokens: number
  temperature?: number
  stop?: string[]
  tools?: { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }[]
}

function unsupported(type: string): never {
  throw new LlmError(`Basis OpenAI transport cannot represent ${type}`, 'UNSUPPORTED_CONTENT')
}

/** Historical tool arguments that are no longer valid JSON degrade to an empty object. */
function toolInput(raw: string): string {
  try { JSON.parse(raw) } catch (_invalidToolHistoryJson) {
    return '{}'
  }
  return raw
}

function text(blocks: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (block.type !== 'text') continue
    if (block.text.length > 0) parts.push(block.text)
  }
  return parts.join('')
}

function assistantContent(blocks: readonly ContentBlock[]): { content: string | null; toolCalls: WireToolCall[] } {
  let content: string | null = null
  const toolCalls: WireToolCall[] = []
  for (const block of blocks) {
    if (block.type === 'text') {
      if (block.text.length > 0) content = (content ?? '') + (content === null ? '' : '\n') + block.text
      continue
    }
    if (block.type === 'tool-call') {
      toolCalls.push({ id: block.id, type: 'function', function: { name: block.name, arguments: toolInput(block.arguments) } })
      continue
    }
    if (block.type === 'reasoning') continue
    unsupported(`assistant content ${block.type}`)
  }
  return { content, toolCalls }
}

function toolResult(message: Extract<Message, { role: 'tool' }>): string {
  const parts: string[] = []
  for (const block of message.content) {
    if (block.type === 'text') {
      if (block.text.length > 0) parts.push(block.text)
      continue
    }
    if (block.type === 'image') unsupported('tool-result images')
    unsupported(`tool-result content ${block.type}`)
  }
  return parts.join('\n')
}

/** Serialize one complete request.
 * Developer messages become system-role updates; images are unsupported in
 * this first cut. Reasoning history follows the connection's replay policy:
 * `drop` (default) omits it entirely, `preserve` re-sends it as the
 * non-standard assistant `reasoning_content` field for gateways that accept it.
 * @param options - provider-neutral request.
 * @param connection - validated connection facts.
 * @param history - request history as projected for this route.
 * @returns the chat-completions JSON body.
 */
export function serialize(options: GenerateOptions<string>, connection: Connection, history: readonly RequestMessage[]): WireRequest {
  const system: string[] = []
  if (options.system !== undefined && options.system.length > 0) system.push(options.system)
  const messages: WireMessage[] = []
  for (const message of history) {
    if (message.role === 'system') {
      const value = text(message.content)
      if (message.content.some(block => block.type !== 'text')) unsupported('non-text system message')
      if (value.length > 0) system.push(value)
      continue
    }
    if (message.role === 'developer') {
      const value = text(message.content)
      if (message.content.some(block => block.type !== 'text')) unsupported('developer tool-change blocks')
      if (value.length > 0) system.push(value)
      continue
    }
    if (message.role === 'tool') {
      const value = toolResult(message)
      messages.push({ role: 'tool', tool_call_id: message.toolCallId, content: value })
      continue
    }
    if (message.role === 'user') {
      const value = text(message.content)
      if (message.content.some(block => block.type !== 'text')) unsupported('user image content')
      if (value.length === 0) continue
      messages.push({ role: 'user', content: value })
      continue
    }
    const { content, toolCalls } = assistantContent(message.content)
    const reasoning = connection.replayReasoning === 'preserve'
      ? message.content.filter(block => block.type === 'reasoning').map(block => block.text).join('\n')
      : ''
    if (content === null && toolCalls.length === 0 && reasoning.length === 0) continue
    const wire: WireMessage = content === null && toolCalls.length === 0
      ? { role: 'assistant', content: null }
      : content === null
        ? { role: 'assistant', content: null, tool_calls: toolCalls }
        : toolCalls.length === 0
          ? { role: 'assistant', content }
          : { role: 'assistant', content, tool_calls: toolCalls }
    if (reasoning.length > 0) wire.reasoning_content = reasoning
    messages.push(wire)
  }
  const configured = connection.models?.find(entry => entry.id === options.model)
  const body: WireRequest = {
    model: options.model,
    stream: true,
    stream_options: { include_usage: true },
    messages: system.length === 0
      ? messages
      : [{ role: 'system', content: system.join('\n\n') }, ...messages],
    max_tokens: options.maxTokens ?? configured?.maxTokens ?? connection.maxTokens,
  }
  if (options.temperature !== undefined) body.temperature = options.temperature
  if (options.stop !== undefined) body.stop = options.stop
  if (options.tools !== undefined && options.tools.length > 0) {
    body.tools = options.tools.map(tool => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }))
  }
  return body
}
