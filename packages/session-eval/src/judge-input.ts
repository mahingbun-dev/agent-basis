/**
 * 裁判输入投影(56 号 §5.4「长轨迹走滑窗 + 原始任务描述」):
 * 会话事件流 → 可放进提示词的最小对话摘要。
 *
 * 口径:
 * - **任务描述** = 第一条 `user/message` 且 `source.kind === 'user'` 的文本
 *   (合成注入:文件变更通知 / AGENTS.md / 技能内容等不算任务);
 * - **每轮** = `turn/start` 之后、`turn/end` 之前的用户文本(含后续合成注入)、
 *   助手文本、工具调用与结果预览;
 * - **截断**按字符与步数上限(模型上下文有限;裁判只看判定所需的信息);
 * - 未知事件静默跳过(与 trajectory.ts 同纪律)。
 */
import type { SessionEventLike } from './types.ts'

/** 一次工具调用的裁判视图(参数与结果各截断). */
export interface JudgeToolCall {
  readonly name: string
  readonly arguments: string
  readonly ok: boolean
  readonly result: string
}

/** 一轮的裁判视图. */
export interface JudgeTurnRecord {
  readonly turn: number
  readonly userText: string
  readonly assistantText: string
  readonly toolCalls: readonly JudgeToolCall[]
  readonly endReason?: string
}

/** 整条会话的裁判输入. */
export interface JudgeInput {
  /** 第一条真实用户消息(任务描述);空会话为 ''. */
  readonly task: string
  readonly turns: readonly JudgeTurnRecord[]
  /** 全轨迹字符总量(未截断,用于「窗口放不下」的显式判断). */
  readonly totalChars: number
}

/** 单条文本截断(保留尾部省略号). */
function clip(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 消息 content 的文本拼接(只取 text 块;非文本块跳过). */
function textOfContent(value: unknown): string {
  if (!Array.isArray(value)) return ''
  const parts: string[] = []
  for (const block of value) {
    const record = asRecord(block)
    if (record?.type === 'text' && typeof record.text === 'string') parts.push(record.text)
  }
  return parts.join('\n')
}

/** 结果预览上限(单条工具结果). */
const RESULT_PREVIEW_MAX = 300
/** 参数预览上限(单条工具调用). */
const ARGUMENTS_PREVIEW_MAX = 200
/** 用户/助手文本单条上限(裁判不必读全文,但要够判断). */
const MESSAGE_PREVIEW_MAX = 2_000

/** 内部可变轮次(投影结束冻结). */
interface MutableJudgeTurn {
  turn: number
  userText: string
  assistantText: string
  toolCalls: JudgeToolCall[]
  endReason?: string
}

/**
 * 投影裁判输入。
 * @param events - 会话事件快照(数组序 = 时间序).
 * @returns 任务描述、逐轮摘要与总量;无事件时为空输入。
 */
export function projectJudgeInput(events: readonly SessionEventLike[]): JudgeInput {
  const turns = new Map<number, MutableJudgeTurn>()
  const calls = new Map<string, { name: string; arguments: string; preview: string[] }>()
  let currentTurn: number | undefined
  let task = ''
  let totalChars = 0
  /** turn/start 之前到达的用户文本(真人消息通常先于轮开始落盘):归入下一轮。 */
  const pendingUser: string[] = []

  const turnOf = (turn: number): MutableJudgeTurn => {
    const existing = turns.get(turn)
    if (existing !== undefined) return existing
    const created: MutableJudgeTurn = { turn, userText: '', assistantText: '', toolCalls: [] }
    turns.set(turn, created)
    return created
  }

  for (const event of events) {
    const data = asRecord(event.data)
    if (data === undefined) continue
    switch (event.type) {
      case 'turn/start': {
        const turn = asNumber(data.turn)
        if (turn === undefined) break
        currentTurn = turn
        const record = turnOf(turn)
        if (pendingUser.length > 0) {
          const carried = pendingUser.join('\n')
          pendingUser.length = 0
          record.userText = record.userText === '' ? carried : `${carried}\n${record.userText}`
        }
        break
      }
      case 'turn/end': {
        const turn = asNumber(data.turn)
        if (turn === undefined) break
        const reason = asRecord(data.reason)
        if (typeof reason?.kind === 'string') turnOf(turn).endReason = reason.kind
        break
      }
      case 'user/message': {
        const text = clip(textOfContent(data.content), MESSAGE_PREVIEW_MAX)
        if (text === '') break
        totalChars += text.length
        const source = asRecord(data.source)
        if (task === '' && source?.kind === 'user') task = text
        if (currentTurn !== undefined) {
          const turn = turnOf(currentTurn)
          turn.userText = turn.userText === '' ? text : `${turn.userText}\n${text}`
        } else if (source?.kind === 'user') {
          // 轮前的合成注入(工作区上下文等)不是用户发言,不带入下一轮。
          pendingUser.push(text)
        }
        break
      }
      case 'assistant/message': {
        const message = asRecord(data.message)
        const text = clip(textOfContent(message?.content), MESSAGE_PREVIEW_MAX)
        if (text === '') break
        const turn = asNumber(data.turn)
        if (turn !== undefined) {
          const record = turnOf(turn)
          record.assistantText = record.assistantText === '' ? text : `${record.assistantText}\n${text}`
          totalChars += text.length
        }
        break
      }
      case 'tool/call': {
        const callId = typeof data.callId === 'string' ? data.callId : undefined
        const name = typeof data.name === 'string' ? data.name : undefined
        if (callId === undefined || name === undefined) break
        calls.set(callId, {
          name,
          arguments: clip(typeof data.arguments === 'string' ? data.arguments : '', ARGUMENTS_PREVIEW_MAX),
          preview: [],
        })
        break
      }
      case 'tool/result': {
        const message = asRecord(data.message)
        const callId = typeof message?.toolCallId === 'string' ? message.toolCallId : undefined
        if (callId === undefined) break
        const call = calls.get(callId)
        if (call === undefined) break
        call.preview.push(clip(textOfContent(message?.content), RESULT_PREVIEW_MAX))
        break
      }
      default:
        break
    }
  }

  // 工具调用归轮到 calls 声明的 turn(tool/call.data.turn),按事件序配对结果。
  const callsByTurn = new Map<number, JudgeToolCall[]>()
  for (const event of events) {
    if (event.type !== 'tool/call') continue
    const data = asRecord(event.data)
    const turn = asNumber(data?.turn)
    const callId = typeof data?.callId === 'string' ? data.callId : undefined
    const name = typeof data?.name === 'string' ? data.name : undefined
    if (turn === undefined || callId === undefined || name === undefined) continue
    const call = calls.get(callId)
    if (call === undefined) continue
    const resultText = call.preview.join('\n')
    const failed = eventFailed(events, callId)
    const list = callsByTurn.get(turn) ?? []
    list.push({ name, arguments: call.arguments, ok: !failed, result: resultText })
    callsByTurn.set(turn, list)
    totalChars += resultText.length
  }

  const frozen: JudgeTurnRecord[] = [...turns.values()]
    .sort((left, right) => left.turn - right.turn)
    .map(turn => ({
      turn: turn.turn,
      userText: turn.userText,
      assistantText: turn.assistantText,
      toolCalls: callsByTurn.get(turn.turn) ?? [],
      ...turn.endReason === undefined ? {} : { endReason: turn.endReason },
    }))
  return { task, turns: frozen, totalChars }
}

/** 该 callId 的 result 是否失败(与 trajectory 同口径:isError 或 error 兄弟字段). */
function eventFailed(events: readonly SessionEventLike[], callId: string): boolean {
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    const data = asRecord(event.data)
    const message = asRecord(data?.message)
    if (message?.toolCallId !== callId) continue
    return message.isError === true || data?.error !== undefined
  }
  return false
}

/** 裁判窗口上限(提示词字符数;超出取末轮). */
export const JUDGE_WINDOW_MAX_CHARS = 6_000

/** 过程裁判窗口最多看的轮数(末轮 + 前两轮上下文). */
export const JUDGE_WINDOW_MAX_TURNS = 3

/**
 * 把裁判输入渲染成提示词正文(任务 + 指定轮次窗口)。
 * @param input - projectJudgeInput 的产物.
 * @param scope - session=全轮(从末轮往前取到窗口上限) / turn=指定轮及其前 2 轮.
 * @param turn - 过程裁判的目标轮(scope=turn 时必填).
 * @param limits - 窗口覆写(业务指标 judge.window.max_steps 映射到轮数上限).
 * @returns 用户消息正文(已按字符上限截断,超出时标注).
 */
export function renderJudgeUserText(
  input: JudgeInput,
  scope: 'session' | 'turn',
  turn?: number,
  limits: { readonly maxTurns?: number; readonly maxChars?: number } = {},
): string {
  const maxTurns = Math.max(1, Math.min(limits.maxTurns ?? JUDGE_WINDOW_MAX_TURNS, 50))
  const maxChars = Math.max(1_000, Math.min(limits.maxChars ?? JUDGE_WINDOW_MAX_CHARS, JUDGE_WINDOW_MAX_CHARS))
  const header: string[] = []
  header.push(input.task === ''
    ? '## 任务（用户原始要求）\n(未记录到用户原始消息)'
    : `## 任务（用户原始要求）\n${input.task}`)

  const all = scope === 'turn' && turn !== undefined
    ? input.turns.filter(item => item.turn <= turn).slice(-maxTurns)
    : input.turns
  // session 口径:从末轮往前累加到窗口上限(至少保留末轮;截断要显式标注)。
  let selected: readonly JudgeTurnRecord[] = all
  let truncated = false
  if (scope === 'session') {
    const kept: JudgeTurnRecord[] = []
    for (let index = all.length - 1; index >= 0; index -= 1) {
      const candidate = all[index] as JudgeTurnRecord
      const next = [candidate, ...kept]
      if (kept.length > 0 && next.map(renderTurn).join('\n\n').length > maxChars) {
        truncated = true
        break
      }
      kept.unshift(candidate)
    }
    if (kept.length < all.length) truncated = true
    selected = kept
  }

  header.push(truncated
    ? '## 轨迹（已按字符上限从末轮向前截断,较早轮次未列出）'
    : '## 轨迹')
  header.push(selected.length === 0 ? '(该轮次没有可用内容)' : selected.map(renderTurn).join('\n\n'))
  const text = header.join('\n\n')
  return text.length <= maxChars
    ? text
    : `${text.slice(0, maxChars - 1)}…`
}

/** 单轮渲染(用户/助手/工具,紧凑行式). */
function renderTurn(turn: JudgeTurnRecord): string {
  const lines: string[] = [`### 第 ${turn.turn} 轮${turn.endReason === undefined ? '' : `（结束：${turn.endReason}）`}`]
  if (turn.userText !== '') lines.push(`用户：${turn.userText}`)
  if (turn.assistantText !== '') lines.push(`助手：${turn.assistantText}`)
  for (const call of turn.toolCalls) {
    const status = call.ok ? '成功' : '失败'
    lines.push(`工具 ${call.name}(${call.arguments}) → ${status}${call.result === '' ? '' : `：${call.result}`}`)
  }
  return lines.join('\n')
}
