/**
 * 循环轨迹投影(T7.4 正式管线;端点 loopPrompt/trace 与 snapshot.trace.recent 的
 * 数据面,管线标识仍为 'v0-disk-log'——数据源是磁盘会话日志)。
 *
 * 数据源:DSH 会话持久化日志 session.v4.jsonl.zstd(多帧 zstd 容器;帧扫描/解码
 * 算法对齐 packages/panel/src/session-logs.ts 与 persistence-jsonl 公开解码路径,
 * 另加「窗口从帧中间开始」的魔数重同步——尾部读取防御必需)。事件形态以官方
 * SessionEventMap 为准(本仓库实测 0.2.2-rc.1):
 *   - turn/start{turn} / turn/end{turn,reason{kind}}        (dsh-session types)
 *   - tool/call{turn,step,callId,name,arguments(原始 JSON 串)}
 *   - tool/result{turn,step,message{toolCallId,isError},error?{name,code}}
 *   - assistant/message{turn,step,message{content:ContentBlock[]},usage?,interrupted?}
 *     —— 推理文本 = content 中 type:'reasoning' 块(ReasoningBlock{text},dsh-llm)
 *   - approval/asked{id,toolName,callId?,reason?} / approval/decided{id,outcome}
 *     (@deepseek-ai/dsh-user-approval;审计事件不带 turn,按 callId 归轮、
 *      缺则归「最近一个 turn/start」的轮,再缺归 0 号未知节点)
 *   - session/title{title,messageSeqs,source} → 会话卡标题(列表折叠;最后一条胜出)
 * 容错(T7.4 钉死口径):坏行计 skipped;字段缺失降级(缺 turn 的事件落 0 号未知
 * 节点,缺起止的轮次 durationMs=null,缺标题的会话 title='');容器头行(type=
 * 'session',无 data 字段)与未折叠的已知事件(request/header、agent/inbox/spliced
 * 等)既不计 projected 也不计 skipped;解码坏帧跳过;文件缺失/不可解码 → null/跳过,
 * 一律不抛错。
 * 大文件防御:只读文件尾部 N MB(默认 8MB)窗口——会话日志追加式写,尾部即最近
 * 轮次;窗口起点可能落在帧中间,由魔数重同步恢复,投影计数只反映读取窗口。
 */
import { closeSync, openSync, readSync, readdirSync, statSync, fstatSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import type { SessionTrace, TraceApprovalPoint, TraceSessionCard, TraceTurn } from './types.ts'

/** 列表默认条数(计划书 §4:最近 20 条会话)。 */
export const TRACE_SESSION_LIMIT_DEFAULT = 20

/** 单日志最大读取字节(尾部窗口;超出只读尾部,投影计数反映窗口)。 */
export const TRACE_MAX_LOG_BYTES = 8 * 1024 * 1024

/** 读取窗口选项(测试注入小窗口以钉死尾部防御口径)。 */
export interface TraceReadOptions {
  readonly maxLogBytes?: number
}

/** argsPreview 截断上限(原始 arguments JSON 串;截断补省略号)。 */
export const TRACE_ARGS_PREVIEW_LIMIT = 200

/** reasoningPreview 截断上限(本轮最后一条 assistant 消息的 reasoning 块拼接)。 */
export const TRACE_REASONING_PREVIEW_LIMIT = 240

interface FrameRange { readonly start: number; readonly end: number }

/** zstd 魔数(LE):0xFD2FB528。 */
const ZSTD_MAGIC = 4247762216
const ZSTD_MAGIC_BYTES = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/**
 * 从 start 走查一个完整 zstd 帧,返回帧尾偏移;头部/块结构不完整(torn 或伪魔数)
 * 返回 -1。算法逐行对齐 persistence-jsonl scanZstdFrames(经
 * packages/panel/src/session-logs.ts 转录)。
 */
function frameEndAt(buffer: Buffer, start: number): number {
  let offset = start
  if (buffer.length - offset < 4 || buffer.readUInt32LE(offset) !== ZSTD_MAGIC) return -1
  offset += 4
  if (offset === buffer.length) return -1
  const descriptor = buffer.readUInt8(offset)
  offset += 1
  if ((descriptor & 24) !== 0) return -1
  const contentSizeFlag = descriptor >>> 6
  const singleSegment = (descriptor & 32) !== 0
  const checksum = (descriptor & 4) !== 0
  const dictionaryFlag = descriptor & 3
  const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
  const contentSizeBytes = contentSizeFlag === 0 ? singleSegment ? 1 : 0 : 1 << contentSizeFlag
  const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
  if (buffer.length - offset < remainingHeaderBytes) return -1
  offset += remainingHeaderBytes
  let lastBlock = false
  for (;;) {
    if (buffer.length - offset < 3) return -1
    const blockHeader = buffer.readUIntLE(offset, 3)
    offset += 3
    lastBlock = (blockHeader & 1) !== 0
    const blockType = blockHeader >>> 1 & 3
    const blockSize = blockHeader >>> 3
    if (blockType === 3) return -1
    const payloadBytes = blockType === 1 ? 1 : blockSize
    if (buffer.length - offset < payloadBytes) return -1
    offset += payloadBytes
    if (lastBlock) break
  }
  if (checksum) {
    if (buffer.length - offset < 4) return -1
    offset += 4
  }
  return offset
}

/**
 * 扫描完整 zstd 帧(字节级走查,不解压);起点不是帧头(尾部窗口从帧中间开始)
 * 或帧走查失败时,向后重同步到下一个魔数候选;EOF 落在帧内 = torn 尾巴,忽略。
 */
export function scanZstdFrames(buffer: Buffer): readonly FrameRange[] {
  const frames: FrameRange[] = []
  let offset = 0
  while (offset < buffer.length) {
    if (buffer.length - offset < 4 || buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      const next = buffer.indexOf(ZSTD_MAGIC_BYTES, offset + 1)
      if (next < 0) break
      offset = next
      continue
    }
    const end = frameEndAt(buffer, offset)
    if (end < 0) {
      const next = buffer.indexOf(ZSTD_MAGIC_BYTES, offset + 1)
      if (next < 0) break
      offset = next
      continue
    }
    frames.push({ start: offset, end })
    offset = end
  }
  return frames
}

/** 解码多帧容器(每帧独立 one-shot 解压,拼接为完整文本;坏帧跳过=解析失败降级)。 */
export function decodeZstdLog(buffer: Buffer): string {
  const parts: string[] = []
  for (const frame of scanZstdFrames(buffer)) {
    try {
      parts.push(zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString('utf8'))
    } catch {
      // 坏帧(伪魔数/内部损坏):跳过该帧,投影继续(容错口径,不抛错)
    }
  }
  return parts.join('')
}

/**
 * 尾部读取窗口:文件 ≤ maxBytes 全读;超出只读尾部 maxBytes(追加式日志,尾部即
 * 最近轮次)。位置式读,不整文件载入。
 */
function readLogTail(path: string, maxBytes: number): Buffer {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const want = Math.min(size, maxBytes)
    const buffer = Buffer.alloc(want)
    let got = 0
    while (got < want) {
      const n = readSync(fd, buffer, got, want - got, size - want + got)
      if (n <= 0) break
      got += n
    }
    return got === want ? buffer : buffer.subarray(0, got)
  } finally {
    closeSync(fd)
  }
}

/**
 * 读取+解码一条会话日志(尾部窗口)。无任何可解码帧(文件缺失/空文件/容器损坏/
 * 全坏帧)返回 null——解析失败降级口径:列表跳过该文件,详情返回 null。
 */
function readLogText(path: string, maxBytes: number): string | null {
  try {
    const text = decodeZstdLog(readLogTail(path, maxBytes))
    return text.length > 0 ? text : null
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function isoOf(timeMs: number | undefined): string | null {
  return timeMs !== undefined && timeMs > 0 ? new Date(timeMs).toISOString() : null
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/** 工具调用累积态(可变;投影为 TraceToolCall 前原地补全 result/error/耗时)。 */
interface MutableToolCall {
  callId: string
  name: string
  at: string | null
  argsPreview: string
  isError: boolean
  errorName: string | null
  durationMs: number | null
}

/** 审批点累积态(approval/asked 落位,approval/decided 原地补全)。 */
interface MutableApprovalPoint {
  callId: string
  name: string
  at: string | null
  outcome: string | null
  decidedAt: string | null
}

/** 单个可变轮次累积器。 */
interface TurnAccumulator {
  turn: number
  startedAt: number | undefined
  endedAt: number | undefined
  endReason: string | null
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null
  reasoning: string | null
  tools: Map<string, { call: MutableToolCall; callAt: number | undefined }>
  approvals: MutableApprovalPoint[]
}

function emptyTurn(turn: number): TurnAccumulator {
  return { turn, startedAt: undefined, endedAt: undefined, endReason: null, usage: null, reasoning: null, tools: new Map(), approvals: [] }
}

/** 推理摘要:assistant 消息 content 中 type='reasoning' 块按序拼接并截断。 */
function reasoningPreviewOf(message: Record<string, unknown> | null): string | null {
  const content = message?.['content']
  if (!Array.isArray(content)) return null
  const parts: string[] = []
  for (const block of content) {
    const record = asRecord(block)
    if (record === null || record['type'] !== 'reasoning') continue
    const text = asString(record['text'])
    if (text !== undefined && text.length > 0) parts.push(text)
  }
  if (parts.length === 0) return null
  return truncate(parts.join('\n'), TRACE_REASONING_PREVIEW_LIMIT)
}

/** 事件行流 → 轮次树(容错折叠;坏行计 skipped;事件形态口径见文件头)。 */
export function projectSessionTrace(sessionId: string, lines: readonly string[]): SessionTrace {
  const turns = new Map<number, TurnAccumulator>()
  const order: number[] = []
  const approvalById = new Map<string, MutableApprovalPoint>()
  let currentTurn: number | undefined
  let total = 0
  let projected = 0
  let skipped = 0
  const turnOf = (turn: number | undefined): TurnAccumulator => {
    const key = turn ?? 0
    let acc = turns.get(key)
    if (acc === undefined) {
      acc = emptyTurn(key)
      turns.set(key, acc)
      order.push(key)
    }
    return acc
  }
  for (const line of lines) {
    if (line.trim().length === 0) continue
    total += 1
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      skipped += 1
      continue
    }
    const record = asRecord(event)
    if (record === null) {
      skipped += 1
      continue
    }
    const type = asString(record['type'])
    if (type === undefined) {
      skipped += 1
      continue
    }
    if (type === 'session') continue // 容器头行(version/id/createdAt,无 data 字段):合法行,无折叠面
    const data = asRecord(record['data'])
    if (data === null) {
      skipped += 1
      continue
    }
    const time = asNumber(record['time'])
    const turn = asNumber(data['turn'])
    switch (type) {
      case 'turn/start': {
        const acc = turnOf(turn)
        acc.startedAt = time ?? acc.startedAt
        currentTurn = acc.turn
        projected += 1
        break
      }
      case 'turn/end': {
        const acc = turnOf(turn)
        acc.endedAt = time ?? acc.endedAt
        const reason = asRecord(data['reason'])
        acc.endReason = asString(reason?.['kind']) ?? acc.endReason
        currentTurn = acc.turn
        projected += 1
        break
      }
      case 'tool/call': {
        const callId = asString(data['callId'])
        if (callId === undefined) {
          skipped += 1
          break
        }
        const acc = turnOf(turn ?? currentTurn)
        const argsPreview = truncate(asString(data['arguments']) ?? '', TRACE_ARGS_PREVIEW_LIMIT)
        acc.tools.set(callId, {
          call: {
            callId,
            name: asString(data['name']) ?? '',
            at: isoOf(time),
            argsPreview,
            isError: false,
            errorName: null,
            durationMs: null,
          },
          callAt: time,
        })
        projected += 1
        break
      }
      case 'tool/result': {
        const message = asRecord(data['message'])
        const toolCallId = asString(message?.['toolCallId'])
        if (toolCallId === undefined) {
          skipped += 1
          break
        }
        const acc = turnOf(turn ?? currentTurn)
        const entry = acc.tools.get(toolCallId)
        if (entry !== undefined) {
          entry.call.isError = message?.['isError'] === true
          const error = asRecord(data['error'])
          entry.call.errorName = asString(error?.['name']) ?? null
          if (entry.callAt !== undefined && time !== undefined) {
            entry.call.durationMs = Math.max(0, time - entry.callAt)
          }
        }
        projected += 1
        break
      }
      case 'assistant/message': {
        const acc = turnOf(turn ?? currentTurn)
        const usage = asRecord(data['usage'])
        if (usage !== null) {
          const inputTokens = asNumber(usage['inputTokens']) ?? 0
          const outputTokens = asNumber(usage['outputTokens']) ?? 0
          const totalTokens = asNumber(usage['totalTokens']) ?? (inputTokens + outputTokens)
          acc.usage = { inputTokens, outputTokens, totalTokens }
        }
        // 推理摘要:多 step 轮次「最后一条 assistant 消息胜出」(确定口径)。
        const reasoning = reasoningPreviewOf(asRecord(data['message']))
        if (reasoning !== null) acc.reasoning = reasoning
        projected += 1
        break
      }
      case 'approval/asked': {
        // 审计事件不带 turn:callId 能对上某轮工具调用则归该轮,否则归最近轮,再缺归 0。
        const callId = asString(data['callId'])
        let acc: TurnAccumulator | undefined
        if (callId !== undefined) {
          for (const key of order) {
            if (turns.get(key)?.tools.has(callId) === true) {
              acc = turns.get(key)
              break
            }
          }
        }
        const point: MutableApprovalPoint = {
          callId: callId ?? '',
          name: asString(data['toolName']) ?? '',
          at: isoOf(time),
          outcome: null,
          decidedAt: null,
        }
        const askId = asString(data['id'])
        if (acc === undefined) acc = turnOf(currentTurn)
        acc.approvals.push(point)
        if (askId !== undefined) approvalById.set(askId, point)
        projected += 1
        break
      }
      case 'approval/decided': {
        const askId = asString(data['id'])
        const point = askId !== undefined ? approvalById.get(askId) : undefined
        if (point === undefined) break // 未配对(如 asked 落在读取窗口外):不计 projected
        point.outcome = asString(data['outcome']) ?? point.outcome
        point.decidedAt = isoOf(time)
        projected += 1
        break
      }
      default:
        break // 未折叠事件(session、request/header、session/title 等)不是坏行
    }
  }
  const sorted = [...order].sort((a, b) => a - b)
  return {
    sessionId,
    turns: sorted.map((key): TraceTurn => {
      const acc = turns.get(key) as TurnAccumulator
      return {
        turn: acc.turn,
        startedAt: isoOf(acc.startedAt),
        endedAt: isoOf(acc.endedAt),
        durationMs: acc.startedAt !== undefined && acc.endedAt !== undefined ? Math.max(0, acc.endedAt - acc.startedAt) : null,
        endReason: acc.endReason,
        usage: acc.usage,
        reasoningPreview: acc.reasoning,
        tools: [...acc.tools.values()].map(entry => entry.call),
        approvalPoints: acc.approvals.map((point): TraceApprovalPoint => ({ ...point })),
      }
    }),
    events: { total, projected, skipped },
  }
}

/** 会话日志列表(mtime 新→旧;目录约定 <root>/<area>/session-<id>/,与 panel 一致)。 */
function listSessionLogs(sessionsRoot: string): { sessionId: string; area: string; path: string; mtimeMs: number }[] {
  let areas: string[]
  try {
    areas = readdirSync(sessionsRoot)
  } catch {
    return []
  }
  const logs: { sessionId: string; area: string; path: string; mtimeMs: number }[] = []
  for (const area of areas) {
    const areaPath = join(sessionsRoot, area)
    let sessions: string[]
    try {
      sessions = readdirSync(areaPath)
    } catch {
      continue
    }
    for (const session of sessions) {
      if (!session.startsWith('session-')) continue
      const logPath = join(areaPath, session, 'session.v4.jsonl.zstd')
      try {
        logs.push({ sessionId: session, area, path: logPath, mtimeMs: statSync(logPath).mtimeMs })
      } catch {
        // 会话目录无日志(仅锁文件等):跳过
      }
    }
  }
  return logs.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/** 列表折叠态(usage 求和 + 轮次计数 + 最近时间 + 最后一条标题)。 */
interface CardFold {
  turns: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  lastAt: number
  title: string
}

/** 折叠一条会话日志为列表卡数据(坏行静默跳过,与 panel foldSessionEvents 同款)。 */
function foldSessionCard(lines: readonly string[]): CardFold {
  const fold: CardFold = { turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, lastAt: 0, title: '' }
  for (const line of lines) {
    if (line.trim().length === 0) continue
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    const record = asRecord(event)
    if (record === null) continue
    const time = asNumber(record['time'])
    if (time !== undefined && time > fold.lastAt) fold.lastAt = time
    const type = asString(record['type'])
    if (type === 'turn/end') fold.turns += 1
    if (type === 'assistant/message') {
      const usage = asRecord(asRecord(record['data'])?.['usage'])
      if (usage !== null) {
        fold.inputTokens += asNumber(usage['inputTokens']) ?? 0
        fold.outputTokens += asNumber(usage['outputTokens']) ?? 0
        fold.cacheReadTokens += asNumber(usage['cacheReadTokens']) ?? 0
      }
    }
    if (type === 'session/title') {
      const title = asString(asRecord(record['data'])?.['title'])
      if (title !== undefined) fold.title = title
    }
  }
  return fold
}

/** 列表模式:最近 N 条会话卡(T7.4 增标题;窗口防御同详情)。 */
export function listTraceSessions(
  sessionsRoot: string,
  limit = TRACE_SESSION_LIMIT_DEFAULT,
  opts: TraceReadOptions = {},
): readonly TraceSessionCard[] {
  const maxBytes = opts.maxLogBytes ?? TRACE_MAX_LOG_BYTES
  const cards: TraceSessionCard[] = []
  for (const log of listSessionLogs(sessionsRoot)) {
    if (cards.length >= limit) break
    const text = readLogText(log.path, maxBytes)
    if (text === null) continue
    const fold = foldSessionCard(text.split('\n'))
    cards.push({
      sessionId: log.sessionId,
      area: log.area,
      title: fold.title,
      turns: fold.turns,
      inputTokens: fold.inputTokens,
      outputTokens: fold.outputTokens,
      cacheReadTokens: fold.cacheReadTokens,
      lastAt: fold.lastAt > 0 ? new Date(fold.lastAt).toISOString() : '',
    })
  }
  return cards
}

/** 指定会话的轮次树;日志缺失/不可解码返回 null(轮询容错口径,spike §6)。 */
export function readSessionTrace(
  sessionsRoot: string,
  sessionId: string,
  opts: TraceReadOptions = {},
): SessionTrace | null {
  const maxBytes = opts.maxLogBytes ?? TRACE_MAX_LOG_BYTES
  for (const log of listSessionLogs(sessionsRoot)) {
    if (log.sessionId !== sessionId && log.sessionId !== `session-${sessionId}`) continue
    const text = readLogText(log.path, maxBytes)
    if (text === null) return null
    return projectSessionTrace(log.sessionId, text.split('\n'))
  }
  return null
}
