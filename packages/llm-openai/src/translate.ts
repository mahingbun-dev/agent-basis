/** Translate OpenAI chat-completions SSE frames into the Harness stream protocol. */

import { LlmError, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { FinishReason, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'

interface OpenTextBlock {
  index: number
  kind: 'text'
  text: string
}

interface OpenReasoningBlock {
  index: number
  kind: 'reasoning'
  text: string
}

interface OpenToolBlock {
  index: number
  kind: 'tool'
  id: string | undefined
  name: string | undefined
  json: string
  /** Length of `json` already emitted as deltas. */
  sent: number
}

type Block = OpenTextBlock | OpenReasoningBlock | OpenToolBlock

function malformed(detail: string): never {
  throw new LlmError(`Basis OpenAI stream: ${detail}`, 'MALFORMED_RESPONSE')
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return malformed('expected an object')
  return value as Record<string, unknown>
}

function updateUsage(usage: TokenUsage, raw: unknown): void {
  const fields = object(raw)
  const prompt = fields.prompt_tokens
  const completion = fields.completion_tokens
  if (prompt !== undefined) {
    if (!Number.isSafeInteger(prompt) || (prompt as number) < 0) return malformed('invalid prompt_tokens')
    usage.inputTokens = prompt as number
  }
  if (completion !== undefined) {
    if (!Number.isSafeInteger(completion) || (completion as number) < 0) return malformed('invalid completion_tokens')
    usage.outputTokens = completion as number
  }
  const details = fields.prompt_tokens_details
  if (typeof details === 'object' && details !== null) {
    const cached = (details as Record<string, unknown>).cached_tokens
    if (cached !== undefined) {
      if (!Number.isSafeInteger(cached) || (cached as number) < 0) return malformed('invalid cached_tokens')
      usage.cacheReadTokens = cached as number
    }
  }
}

function finishReason(raw: unknown): FinishReason {
  switch (raw) {
    case 'stop': return { kind: 'stop' }
    case 'tool_calls': case 'function_call': return { kind: 'tool-calls' }
    case 'length': return { kind: 'max-tokens' }
    default: return malformed(`unsupported finish_reason ${String(raw)}`)
  }
}

/** Translate decoded SSE data frames into the Harness stream protocol.
 * OpenAI has no block lifecycle, so block boundaries are synthesized: deltas
 * open blocks on first sight, and every open block closes right before the
 * terminal finish. Usage may arrive on any frame and is emitted once.
 * @param frames - decoded `data:` JSON frames in arrival order (`[DONE]` excluded).
 * @returns blocks, one usage value, and exactly one terminal finish.
 */
export async function* translate(frames: AsyncIterable<Record<string, unknown>>): AsyncGenerator<StreamChunk> {
  const blocks = new Map<string, Block>()
  let nextIndex = 0
  let usage: TokenUsage | undefined
  let reason: FinishReason | undefined

  const openText = (): OpenTextBlock => {
    let block = blocks.get('text')
    if (block === undefined) {
      block = { index: nextIndex++, kind: 'text', text: '' }
      blocks.set('text', block)
      return block
    }
    if (block.kind !== 'text') return malformed('text delta inside a non-text block')
    return block
  }
  const openReasoning = (): OpenReasoningBlock => {
    let block = blocks.get('reasoning')
    if (block === undefined) {
      block = { index: nextIndex++, kind: 'reasoning', text: '' }
      blocks.set('reasoning', block)
      return block
    }
    if (block.kind !== 'reasoning') return malformed('reasoning delta inside a non-reasoning block')
    return block
  }
  const openTool = (wireIndex: number): OpenToolBlock => {
    const key = `tool:${String(wireIndex)}`
    let block = blocks.get(key)
    if (block === undefined) {
      block = { index: nextIndex++, kind: 'tool', id: undefined, name: undefined, json: '', sent: 0 }
      blocks.set(key, block)
      return block
    }
    if (block.kind !== 'tool') return malformed('tool delta inside a non-tool block')
    return block
  }

  for await (const frame of frames) {
    const usageField = frame.usage
    if (usageField !== undefined && usageField !== null) {
      usage ??= { inputTokens: 0, outputTokens: 0 }
      updateUsage(usage, usageField)
    }
    const choices = frame.choices
    if (!Array.isArray(choices)) continue
    const choice = object(choices[0] ?? {})
    const deltaRaw = choice.delta
    if (typeof deltaRaw === 'object' && deltaRaw !== null) {
      const delta = object(deltaRaw)
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        const block = openText()
        block.text += delta.content
        yield { type: 'text-delta', index: block.index, text: delta.content }
      }
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
        const block = openReasoning()
        block.text += delta.reasoning_content
        yield { type: 'reasoning-delta', index: block.index, text: delta.reasoning_content }
      }
      const toolCalls = delta.tool_calls
      if (Array.isArray(toolCalls)) {
        for (const rawCall of toolCalls) {
          const call = object(rawCall)
          const wireIndex = typeof call.index === 'number' ? call.index : 0
          const block = openTool(wireIndex)
          if (typeof call.id === 'string' && call.id.length > 0) block.id = call.id
          const fn = typeof call.function === 'object' && call.function !== null ? object(call.function) : undefined
          if (fn !== undefined) {
            if (typeof fn.name === 'string' && fn.name.length > 0) block.name = fn.name
            if (typeof fn.arguments === 'string' && fn.arguments.length > 0) block.json += fn.arguments
          }
          if (block.id === undefined || block.name === undefined) continue
          const argumentsDelta = block.json.slice(block.sent)
          if (argumentsDelta.length === 0) continue
          block.sent = block.json.length
          yield { type: 'tool-call-delta', index: block.index, id: ToolCallId(block.id), name: block.name, argumentsDelta }
        }
      }
    }
    const rawReason = choice.finish_reason
    if (rawReason !== undefined && rawReason !== null) reason = finishReason(rawReason)
  }
  if (reason === undefined) throw new LlmError('Basis OpenAI stream ended without a finish reason', 'STREAM_CLOSED')

  for (const block of blocks.values()) {
    if (block.kind === 'text') {
      yield { type: 'block-end', index: block.index, block: { type: 'text', text: block.text } }
      continue
    }
    if (block.kind === 'reasoning') {
      yield { type: 'block-end', index: block.index, block: { type: 'reasoning', text: block.text } }
      continue
    }
    if (block.id === undefined || block.name === undefined) return malformed('tool call without an id or name')
    yield {
      type: 'block-end',
      index: block.index,
      block: { type: 'tool-call', id: ToolCallId(block.id), name: block.name, arguments: block.json.length > 0 ? block.json : '{}' },
    }
  }
  if (blocks.size === 0 && reason.kind === 'stop') throw new LlmError('Basis OpenAI transport returned no content', 'EMPTY_RESPONSE')
  const finalUsage = usage ?? { inputTokens: 0, outputTokens: 0 }
  finalUsage.totalTokens = finalUsage.inputTokens + finalUsage.outputTokens
    + (finalUsage.cacheReadTokens ?? 0) + (finalUsage.cacheWriteTokens ?? 0)
  yield { type: 'usage', usage: finalUsage }
  yield { type: 'finish', reason }
}
