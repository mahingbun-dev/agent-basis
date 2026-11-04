/**
 * 会话事件流的运行期解析:从 `SessionEventLike`(data: unknown)安全取出
 * 断言器消费的具名事件视图。fixture 与真实 session 的 JSON 都是外来数据,
 * 解析失败一律返回 undefined(调用方按「事件不存在」处理),不抛异常。
 */
import type { ApprovalOutcomeLike, SessionEventLike, TokenUsageLike } from './types.ts'

/** tool/call 载荷(session/src/types.ts:373-377)。 */
export interface ToolCallView {
  readonly turn: number
  readonly step: number
  readonly callId: string
  readonly name: string
  readonly arguments: string
}

/** approval/asked 载荷(user-approval/src/types.ts:44-49)。 */
export interface ApprovalAskedView {
  readonly id: string
  readonly toolName: string
  readonly callId?: string
}

/** approval/decided 载荷(user-approval/src/types.ts:55-58)。 */
export interface ApprovalDecidedView {
  readonly id: string
  readonly outcome: ApprovalOutcomeLike
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function toolCallOf(event: SessionEventLike): ToolCallView | undefined {
  if (event.type !== 'tool/call') return undefined
  const data = asRecord(event.data)
  if (data === undefined) return undefined
  const turn = asNumber(data.turn)
  const step = asNumber(data.step)
  const callId = asString(data.callId)
  const name = asString(data.name)
  const args = asString(data.arguments)
  if (turn === undefined || step === undefined || callId === undefined || name === undefined || args === undefined) {
    return undefined
  }
  return { turn, step, callId, name, arguments: args }
}

export function approvalAskedOf(event: SessionEventLike): ApprovalAskedView | undefined {
  if (event.type !== 'approval/asked') return undefined
  const data = asRecord(event.data)
  if (data === undefined) return undefined
  const id = asString(data.id)
  const toolName = asString(data.toolName)
  if (id === undefined || toolName === undefined) return undefined
  const callId = asString(data.callId)
  return { id, toolName, ...(callId === undefined ? {} : { callId }) }
}

const APPROVAL_OUTCOMES: readonly string[] = ['allowed-once', 'rejected', 'cancelled', 'unavailable']

export function approvalDecidedOf(event: SessionEventLike): ApprovalDecidedView | undefined {
  if (event.type !== 'approval/decided') return undefined
  const data = asRecord(event.data)
  if (data === undefined) return undefined
  const id = asString(data.id)
  const outcome = asString(data.outcome)
  if (id === undefined || outcome === undefined || !APPROVAL_OUTCOMES.includes(outcome)) return undefined
  return { id, outcome: outcome as ApprovalOutcomeLike }
}

/** assistant/message 的 TokenUsage(缺 usage 或形态非法 → undefined)。 */
export function usageOf(event: SessionEventLike): TokenUsageLike | undefined {
  if (event.type !== 'assistant/message') return undefined
  const data = asRecord(event.data)
  const usage = data === undefined ? undefined : asRecord(data.usage)
  if (usage === undefined) return undefined
  const inputTokens = asNumber(usage.inputTokens)
  const outputTokens = asNumber(usage.outputTokens)
  if (inputTokens === undefined || outputTokens === undefined) return undefined
  const totalTokens = asNumber(usage.totalTokens)
  const cacheReadTokens = asNumber(usage.cacheReadTokens)
  const cacheWriteTokens = asNumber(usage.cacheWriteTokens)
  const reasoningTokens = asNumber(usage.reasoningTokens)
  return {
    inputTokens,
    outputTokens,
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
  }
}

/** assistant/message / user/message 的文本块拼接(非 text 块跳过)。
 * 包裹层级双容忍(真实样本实证 docs/acp-real-6/notifications-sample.jsonl):
 * assistant/message 走 data.message.content;真实 user/message 是 data.content 直挂
 * (session 事件 surface 形态,无 message 包裹)。 */
export function messageTextOf(event: SessionEventLike): string | undefined {
  if (event.type !== 'assistant/message' && event.type !== 'user/message') return undefined
  const data = asRecord(event.data)
  if (data === undefined) return undefined
  const message = asRecord(data.message)
  const content = (message === undefined ? undefined : message.content) ?? data.content
  if (!Array.isArray(content)) return undefined
  const parts: string[] = []
  for (const block of content) {
    const record = asRecord(block)
    if (record === undefined) continue
    if (record.type === 'text' && typeof record.text === 'string') parts.push(record.text)
  }
  return parts.join('')
}

/** 一次会话事件的聚合视图(metrics + 断言的统一数据源)。 */
export interface SessionSummary {
  readonly turns: number
  readonly steps: number
  readonly toolCalls: readonly ToolCallView[]
  readonly totalTokens: number
  readonly approvalsAsked: readonly ApprovalAskedView[]
  readonly approvalsDecided: readonly ApprovalDecidedView[]
  /** 成功执行(非 error)的 tool/result 对应 callId 集合——审批被拒的调用不在此列。 */
  readonly successfulCallIds: ReadonlySet<string>
  readonly finalAnswerText: string
  readonly eventCount: number
}

/** 按 DSH 口径聚合:token 总量 = totalTokens ?? input+output+cacheRead+cacheWrite
 * (llm/src/types.ts:189-197:inputTokens 是未缓存输入,缓存单列,billed input = 三者之和)。 */
export function summarize(events: readonly SessionEventLike[]): SessionSummary {
  const turnSeen = new Set<number>()
  const stepSeen = new Set<string>()
  const toolCalls: ToolCallView[] = []
  const asked: ApprovalAskedView[] = []
  const decided: ApprovalDecidedView[] = []
  const successfulCallIds = new Set<string>()
  let totalTokens = 0
  let finalAnswerText = ''
  for (const event of events) {
    switch (event.type) {
      case 'turn/start': {
        const data = asRecord(event.data)
        const turn = data === undefined ? undefined : asNumber(data.turn)
        if (turn !== undefined) turnSeen.add(turn)
        break
      }
      case 'step/start': {
        const data = asRecord(event.data)
        const turn = data === undefined ? undefined : asNumber(data.turn)
        const step = data === undefined ? undefined : asNumber(data.step)
        if (turn !== undefined && step !== undefined) stepSeen.add(`${turn}:${step}`)
        break
      }
      case 'tool/call': {
        const call = toolCallOf(event)
        if (call !== undefined) toolCalls.push(call)
        break
      }
      case 'tool/result': {
        const callId = successfulCallIdOf(event)
        if (callId !== undefined) successfulCallIds.add(callId)
        break
      }
      case 'approval/asked': {
        const ask = approvalAskedOf(event)
        if (ask !== undefined) asked.push(ask)
        break
      }
      case 'approval/decided': {
        const decision = approvalDecidedOf(event)
        if (decision !== undefined) decided.push(decision)
        break
      }
      case 'assistant/message': {
        const usage = usageOf(event)
        if (usage !== undefined) {
          totalTokens += usage.totalTokens
            ?? usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
        }
        const text = messageTextOf(event)
        if (text !== undefined && text.length > 0) finalAnswerText = text
        break
      }
      default:
        break
    }
  }
  return {
    turns: turnSeen.size,
    steps: stepSeen.size,
    toolCalls,
    totalTokens,
    approvalsAsked: asked,
    approvalsDecided: decided,
    successfulCallIds,
    finalAnswerText,
    eventCount: events.length,
  }
}

/** tool/result 成功(非 error)时返回其 message.toolCallId。
 * 失败口径:message.isError === true 或事件 data.error 存在
 * (DSH session/src/types.ts:379-388:error 为 message 的兄弟字段,仅 isError:true 时允许)。 */
function successfulCallIdOf(event: SessionEventLike): string | undefined {
  if (event.type !== 'tool/result') return undefined
  const data = asRecord(event.data)
  const message = data === undefined ? undefined : asRecord(data.message)
  if (message === undefined || message.isError === true || data?.error !== undefined) return undefined
  const callId = asString(message.toolCallId)
  return callId
}
