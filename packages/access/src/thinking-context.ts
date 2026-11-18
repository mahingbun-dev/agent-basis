/**
 * 思考强度自动模式——会话上下文信号提取(纯函数,零 I/O 零依赖):
 * 把会话尾部窗口的事件数组折成 `ThinkingSessionSignals`,供评分器叠加。
 *
 * 设计纪律(2026-11-18 V2):
 * - 只读事件结构子集(结构类型,不 import 发布类型——access seam 纪律);
 * - 任何异形事件一律跳过,不抛(事件流来自持久化日志,历史版本可能缺字段);
 * - 时间戳取 `event.at`(ISO);缺失按「同一时刻」处理(间隔 0 分钟),
 *   宁可多判一次同题追问,也不因时间字段缺失退化成 V1;
 * - **当前入箱消息尚未入日志**(监听点在 inbox/inserted,早于 claim/append):
 *   同题追问的重叠对象是窗口内最后一条真人消息,由 `currentText` 传入本函数;
 * - 窗口由调用方裁剪(路由器给尾部 200 事件),本文件不设上限。
 */

/** 会话上下文信号(评分器输入;bias/previousEffortRank 由路由器补齐)。 */
export interface ThinkingSessionSignals {
  /** 最近一轮(最后一条真人 user/message 之后)失败 tool/result 数,计分时封顶。 */
  readonly toolFailureStreak: number
  /** 同一工具连续失败次数(尾部连续段,遇到成功或其它工具即止)。 */
  readonly sameToolFailureStreak: number
  /** 当前入箱消息与上一条真人消息的字符二元组重叠 [0,1](containment 口径)。 */
  readonly followUpOverlap: number
  /** 上一条真人消息与当前入箱消息的间隔(分钟);缺时间戳按 0。 */
  readonly followUpGapMinutes: number
  /** 窗口内事件总数(规模代理)。 */
  readonly windowEvents: number
  /** 最近 3 条有文本消息(user/assistant)的文本总字符数。 */
  readonly recentChars: number
  /** 上轮档位归一 [0,1](0=最低档,1=最高档);无档位声明时缺省。 */
  readonly previousEffortRank?: number
  /** 有效偏置(已按 24h 半衰衰减,见 thinking-score.decayBias)。 */
  readonly bias: number
}

/** 派生信号(尚无偏置与上轮档位——那两项由路由器从 store/selection 读取)。 */
export type DerivedSessionSignals = Omit<ThinkingSessionSignals, 'bias' | 'previousEffortRank'>

/** 事件结构子集(dsh-session `session/event` 的耐久载荷)。 */
export interface SessionEventLike {
  readonly type?: unknown
  /** 事件时间(ISO 字符串;耐久日志恒有,测试替身可缺)。 */
  readonly at?: unknown
  readonly data?: unknown
}

const EMPTY_SIGNALS: DerivedSessionSignals = {
  toolFailureStreak: 0,
  sameToolFailureStreak: 0,
  followUpOverlap: 0,
  followUpGapMinutes: Number.POSITIVE_INFINITY,
  windowEvents: 0,
  recentChars: 0,
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function textOfBlocks(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    const record = asRecord(block)
    if (record === undefined) continue
    if (record.type !== 'text') continue
    if (typeof record.text === 'string') parts.push(record.text)
  }
  return parts.join('\n')
}

/**
 * 一条消息事件或入箱消息的文本。
 * - `user/message` 事件 data 即 UserMessage 本身(data.content 为块数组);
 * - `assistant/message`/`tool/result` 事件 data 是 `{ message: ... }` 包裹。
 */
function messageText(data: Record<string, unknown> | undefined): string {
  if (data === undefined) return ''
  const wrapped = asRecord(data.message)
  if (wrapped !== undefined) {
    const fromWrapped = textOfBlocks(wrapped.content)
    if (fromWrapped !== '') return fromWrapped
    if (typeof wrapped.text === 'string') return wrapped.text
  }
  return textOfBlocks(data.content)
}

/** 仅真人消息(生产者 source.kind==='user';runtime-context/notice 等系统源排除)。 */
function isHumanMessage(data: Record<string, unknown> | undefined): boolean {
  const source = asRecord(data?.source)
  return source?.kind === 'user'
}

function eventTimeMs(event: SessionEventLike, fallback: number): number {
  if (typeof event.at !== 'string') return fallback
  const parsed = Date.parse(event.at)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** 字符二元组集合(去空白;单字符文本退化为一元组)。 */
function bigrams(text: string): Set<string> {
  const compact = text.replace(/\s+/gu, '')
  const grams = new Set<string>()
  if (compact.length === 0) return grams
  if (compact.length === 1) {
    grams.add(compact)
    return grams
  }
  for (let i = 0; i < compact.length - 1; i++) grams.add(compact.slice(i, i + 2))
  return grams
}

/**
 * 字符二元组 containment:交集 / 较短侧大小。
 * 不使用 Jaccard——追问常只是上一句的片段,containment 更能识别"同一诉求"。
 * 任一侧为空 → 0。
 */
export function textOverlap(a: string, b: string): number {
  const left = bigrams(a)
  const right = bigrams(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const gram of left) if (right.has(gram)) shared += 1
  return shared / Math.min(left.size, right.size)
}

/**
 * 把窗口事件折成信号。事件按 seq 递增输入(持久化日志顺序)。
 * @param events 已裁剪的尾部窗口(建议 ≤200 条)。
 * @param nowMs 当前时刻(入箱时刻),用于与上一条真人消息的间隔。
 * @param currentText 当前入箱消息文本(尚未入日志,不参与窗口扫描)。
 */
export function deriveSessionSignals(
  events: readonly SessionEventLike[],
  nowMs: number,
  currentText: string,
): DerivedSessionSignals {
  if (events.length === 0) return { ...EMPTY_SIGNALS, followUpGapMinutes: Number.POSITIVE_INFINITY }

  const toolNames = new Map<string, string>()
  const humanTexts: Array<{ readonly text: string; readonly atMs: number }> = []
  const recentTexts: string[] = []

  for (const event of events) {
    const data = asRecord(event.data)
    const type = typeof event.type === 'string' ? event.type : ''
    const atMs = eventTimeMs(event, nowMs)
    if (type === 'tool/call') {
      const callId = typeof data?.callId === 'string' ? data.callId : undefined
      const name = typeof data?.name === 'string' ? data.name : undefined
      if (callId !== undefined && name !== undefined) toolNames.set(callId, name)
      continue
    }
    if (type === 'user/message') {
      const text = messageText(data)
      if (text !== '' && isHumanMessage(data)) humanTexts.push({ text, atMs })
    }
    if (type === 'user/message' || type === 'assistant/message') {
      const text = messageText(data)
      if (text !== '') recentTexts.push(text)
    }
  }

  // 尾部扫描:最近一轮失败数 + 同一工具连续失败段
  let toolFailureStreak = 0
  let sameToolFailureStreak = 0
  let streakName: string | undefined
  let streakOpen = true
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event === undefined) continue
    const type = event.type
    if (type === 'user/message') break
    if (type !== 'tool/result') continue
    const data = asRecord(event.data)
    const message = asRecord(data?.message)
    if (message?.isError !== true) {
      // 成功结果中断连续失败段(但仍不中断"本轮失败计数":那计数与顺序无关)
      streakOpen = false
      continue
    }
    toolFailureStreak += 1
    if (!streakOpen) continue
    const callId = typeof message.toolCallId === 'string'
      ? message.toolCallId
      : typeof asRecord(message.source)?.callId === 'string' ? asRecord(message.source)?.callId as string : undefined
    const name = callId === undefined ? 'unknown' : toolNames.get(callId) ?? 'unknown'
    if (streakName === undefined) {
      streakName = name
      sameToolFailureStreak = 1
    } else if (streakName === name) {
      sameToolFailureStreak += 1
    } else {
      streakOpen = false
    }
  }

  // 同题追问:最后一条真人消息 vs 当前入箱消息
  let followUpOverlap = 0
  let followUpGapMinutes = Number.POSITIVE_INFINITY
  const previous = humanTexts.length > 0 ? humanTexts[humanTexts.length - 1] : undefined
  if (previous !== undefined) {
    // 当前消息已入日志(重试/回放)时,与前一条比避免自比自得 1.0
    const earlier = humanTexts.length > 1 ? humanTexts[humanTexts.length - 2] : undefined
    const baseline = previous.text === currentText && earlier !== undefined ? earlier : previous
    followUpOverlap = textOverlap(baseline.text, currentText)
    followUpGapMinutes = Math.max(0, (nowMs - baseline.atMs) / 60_000)
  }

  const recentChars = recentTexts.slice(-3).reduce((sum, text) => sum + text.length, 0)

  return {
    toolFailureStreak,
    sameToolFailureStreak,
    followUpOverlap,
    followUpGapMinutes,
    windowEvents: events.length,
    recentChars,
  }
}
