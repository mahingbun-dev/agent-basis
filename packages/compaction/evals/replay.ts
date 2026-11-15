/**
 * golden 会话回放(C4):session.jsonl(dsh-evals events 格式,每行
 * `{type,seq,time,data}`)→ 真实 dsh Session 重建 → SummarizationInput 投影。
 *
 * 投影语义对齐 region.ts `buildSummarizationInput`:首个 surface 节点是
 * `system/message` 时作 system 头,其后按 surface 顺序逐节点 deriveEventMessage。
 * 消息承载型事件(user/assistant/system message、tool/result)上 surface,其余
 * (turn/*、step/start、tool/call、approval/*、plugin:* 等)只入日志不上表面——
 * 与 fixtures/dsh-evals 产物一致(它们不带 surfaceOp 字段)。
 *
 * @module @eterna/compaction/evals/replay
 */

import { estimateMessage } from '@deepseek-ai/dsh-token-meter/estimate'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionSeq as SessionSeqType } from '@deepseek-ai/dsh-session'
import type { Message } from '@deepseek-ai/dsh-llm'
import type { SummarizationInput } from '../src/basic/summarizer.ts'

/** session.jsonl 的一行(格式校验后)。 */
export interface SessionEventLine {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: Record<string, unknown>
}

/** 消息承载型、需要上 surface 的事件型别(与 fixtures 观察一致)。 */
const SURFACE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'system/message',
  'user/message',
  'assistant/message',
  'tool/result',
])

/** 格式校验失败。 */
export class SessionFormatError extends Error {
  override name = 'SessionFormatError'
}

/**
 * 解析并校验 session.jsonl 文本:每行一个 JSON 对象,`type` 非空字符串、`seq` 为
 * 从 1 开始的连续整数、`time` 为数值、`data` 为对象。
 * @param text - session.jsonl 的全部文本。
 * @param source - 报错时的来源标注(如 case id 或文件路径)。
 * @returns 校验后的事件行(顺序保持)。
 * @throws {SessionFormatError} 任一行不合格式。
 */
export function parseSessionJsonl(text: string, source = 'session.jsonl'): SessionEventLine[] {
  const lines = text.split('\n').filter(line => line.trim().length > 0)
  if (lines.length === 0) throw new SessionFormatError(`${source}: no events`)
  const events: SessionEventLine[] = []
  for (const [index, line] of lines.entries()) {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (error) {
      throw new SessionFormatError(`${source} line ${index + 1}: invalid JSON (${(error as Error).message})`)
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new SessionFormatError(`${source} line ${index + 1}: event must be a JSON object`)
    }
    const event = parsed as Record<string, unknown>
    const where = `${source} line ${index + 1}`
    if (typeof event.type !== 'string' || event.type.length === 0) {
      throw new SessionFormatError(`${where}: "type" must be a non-empty string`)
    }
    if (!Number.isInteger(event.seq) || event.seq !== index + 1) {
      throw new SessionFormatError(`${where}: "seq" must be the contiguous 1-based integer ${index + 1}`)
    }
    if (typeof event.time !== 'number' || !Number.isFinite(event.time)) {
      throw new SessionFormatError(`${where}: "time" must be a number`)
    }
    if (typeof event.data !== 'object' || event.data === null || Array.isArray(event.data)) {
      throw new SessionFormatError(`${where}: "data" must be an object`)
    }
    events.push({ type: event.type, seq: event.seq, time: event.time, data: event.data as Record<string, unknown> })
  }
  return events
}

/**
 * 把校验后的事件行重放进一个真实 detached Session,并投影出摘要输入。
 * `tool/result` 带 `error` 时要求 message.isError === true(与 dsh-session 一致;
 * golden 集是策展数据,写错就 fail-loud,不做静默修补)。
 * @param events - {@link parseSessionJsonl} 的输出。
 * @param id - 重建 Session 的 id。
 * @returns 会话、投影输入、surface 序列与被遮蔽价(estimate 纯函数,文本负载下
 * heuristic 与 route 同价)。
 * @throws {SessionFormatError} 事件重放被 dsh-session 拒绝。
 */
export function replaySession(events: SessionEventLine[], id = 'golden-replay'): {
  session: Session
  input: SummarizationInput
  surfaceSeqs: readonly SessionSeqType[]
  shadowedTokens: number
} {
  const session = Session.create(SessionId(id))
  for (const event of events) {
    // 消息承载型事件的文本块必须有 text 字段(缺失会让下游估价炸出难懂的错;
    // golden 是策展数据,在回放口 fail-loud)。
    if (SURFACE_EVENT_TYPES.has(event.type)) {
      const message = event.data.message as
        | { content?: Array<{ type?: string; text?: unknown }> }
        | undefined
      for (const [index, block] of (message?.content ?? []).entries()) {
        if (block.type === 'text' && typeof block.text !== 'string') {
          throw new SessionFormatError(`${event.type} seq ${event.seq}: content[${index}] text block requires a string "text"`)
        }
      }
    }
    if (event.type === 'tool/result' && event.data.error !== undefined) {
      const message = event.data.message as { isError?: boolean } | undefined
      if (message?.isError !== true) {
        throw new SessionFormatError(
          `${event.type} seq ${event.seq}: data.error requires message.isError === true`,
        )
      }
    }
    const options = SURFACE_EVENT_TYPES.has(event.type) ? { surfaceOp: 'append' as const } : undefined
    // dsh-evals events 格式把 user/message 包成 {message: <UserMessage>},而
    // Session.append 的 user/message 载荷就是消息本身(region/fakes 同构)——回放
    // 侧做这一层格式适配;其余型别的载荷与 append 一致,原样透传。
    const payload = event.type === 'user/message'
      && typeof event.data.message === 'object'
      && event.data.message !== null
      ? event.data.message
      : event.data
    try {
      // 事件型别来自数据文件,经最小调用面传入(运行时校验由 dsh-session 负责);
      // 显式绑定 this(方法引用不能脱离 session 调用)。
      const append = session.append as unknown as (
        this: Session,
        type: string,
        data: unknown,
        ...surfaceOptions: unknown[]
      ) => unknown
      append.call(session, event.type, payload, ...(options === undefined ? [] : [options]))
    } catch (error) {
      throw new SessionFormatError(
        `${event.type} seq ${event.seq}: dsh-session rejected the event (${(error as Error).message})`,
      )
    }
  }

  const surfaceSeqs = [...session.surface.nodes]
  const input = projectSummarizationInput(session, surfaceSeqs)
  const shadowedTokens = input.messages.reduce((total, message) => total + estimateMessage(message), 0)
  return { session, input, surfaceSeqs, shadowedTokens }
}

/**
 * 对齐 region.ts `buildSummarizationInput` 的投影:首个 surface 节点是
 * `system/message` 则先派生 system 头,其后按 surface 顺序逐节点派生消息,
 * 空派生(null)跳过。golden 回放无 request/header,tools 缺省。
 */
function projectSummarizationInput(session: Session, surfaceSeqs: readonly SessionSeqType[]): SummarizationInput {
  const messages: Message[] = []
  // surface 非空时节点 0 必存在;golden 集不允许空会话。
  const headSeq = surfaceSeqs[0]
  if (headSeq !== undefined) {
    // Existing Session history read; migration deferred.
    const head = session.eventAt(headSeq)
    if (head?.type === 'system/message') {
      const system = session.deriveEventMessage(head)
      if (system !== null) messages.push(system)
    }
  }
  for (const seq of surfaceSeqs) {
    // Existing Session history read; migration deferred.
    // surface 节点都是现行日志 seq,事件必存在(undefined 分支为类型收窄的防御面)。
    const event = session.eventAt(seq)
    const message = event === undefined ? null : session.deriveEventMessage(event)
    if (message !== null) messages.push(message)
  }
  return { messages }
}

/** runner 的确定性 meter:逐 surface 节点按 estimate 纯函数估价(文本负载 heuristic=route)。 */
export function createEstimateMeter(): {
  measure(session: Session): { nodes: Array<{ seq: SessionSeqType; tokens: number; heuristicTokens: number }>; totalTokens: number }
  estimateMessage(message: Message): number
} {
  return {
    estimateMessage: message => estimateMessage(message),
    measure: session => {
      const nodes = session.surface.nodes.map((seq) => {
        // Existing Session history read; migration deferred.
        // surface 节点都是现行日志 seq,事件必存在(undefined 分支为类型收窄的防御面)。
        const event = session.eventAt(seq)
        const message = event === undefined ? null : session.deriveEventMessage(event)
        const tokens = message === null ? 0 : estimateMessage(message)
        return { seq, tokens, heuristicTokens: tokens }
      })
      return { nodes, totalTokens: nodes.reduce((sum, node) => sum + node.tokens, 0) }
    },
  }
}
