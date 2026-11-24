/**
 * 循环轨迹投影(T7.4 正式管线;端点 loopPrompt/trace 与 snapshot.trace.recent 的
 * 数据面,管线标识仍为 'v0-disk-log'——数据源是磁盘会话日志)。
 *
 * 数据源:DSH 会话持久化日志 session.v4.jsonl.zstd(多帧 zstd 容器;帧扫描/解码
 * 算法对齐 packages/panel/src/session-logs.ts 与 persistence-jsonl 公开解码路径,
 * 另加「窗口从帧中间开始」的魔数重同步——尾部读取防御必需)。事件形态以官方
 * SessionEventMap 为准(本仓库实测 0.2.2-rc.1):
 *   - turn/start{turn} / turn/end{turn,reason{kind}}        (dsh-session types)
 *   - step/start{turn,step} / step/end{turn,step}            (一次模型调用 + 它请求的工具)
 *   - tool/call{turn,step,callId,name,arguments(原始 JSON 串)}
 *   - tool/result{turn,step,message{toolCallId,isError},error?{name,code}}
 *   - assistant/message{turn,step,message{content:ContentBlock[]},stream,usage?,interrupted?}
 *     —— 推理文本 = content 中 type:'reasoning' 块(ReasoningBlock{text},dsh-llm)
 *     —— stream = AssistantStreamRecord[](紧凑计时流,T8 起用于首 token/生成时长)
 *   - assistant/attempt{turn,step,stream}                     —— 未提交可见消息的失败尝试
 *   - request/header{header.config{provider,model,maxTokens}} / request/context{provider,model,contextWindow}
 *   - compaction/start{compactionId,turn} / compaction/prune{shadowedRange,shadowedSeqs,shadowedTokenCount}
 *     / compaction/end{compactionId,turn,error?}
 *   - approval/asked{id,toolName,callId?,reason?} / approval/decided{id,outcome}
 *     (@deepseek-ai/dsh-user-approval;审计事件不带 turn,按 callId 归轮、
 *      缺则归「最近一个 turn/start」的轮,再缺归 0 号未知节点)
 *   - session(头行)/ session/title{title,messageSeqs,source} → 会话卡标题(列表折叠;最后一条胜出)
 *
 * 计时口径的三个硬约束(每条都由真实日志验证过,单测钉死):
 * 1. **TTFT 必须用官方 assistantStreamFirstTokenTime**,不能用 `stream[0].time`:
 *    实测 743 条流首记录 100% 是 `block-start`(不是 token delta),59% 的流上二者
 *    不等(最大偏 200ms)。官方函数的语义 = 「第一个非空 text/reasoning delta,或
 *    带 name 的 tool-call delta」,对齐 provider 的实际首 token。
 * 2. **工具配对必须按 callId 严格 FIFO,配对后立刻从表里删除**。压缩
 *    (compaction/prune)会把被裁剪的历史事件重新追加一遍,于是同一个 callId 出现在
 *    两条 tool/result 上;用 `Map.get` 回填会被第二次覆盖,把一次 31ms 的 bash 算成
 *    30249 秒(实测 session-0e93,turn 1 step 15)。
 * 3. **未收尾轮次没有墙钟**。turn/end 缺失时 durationMs=null,四个分量仍然有值;
 *    占比一律由调用方以「已观测分量之和」为分母并显式标注,不得伪造成完整墙钟。
 *
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
import { assistantStreamFirstTokenTime } from '@deepseek-ai/dsh-llm'
import type { AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import type {
  SessionTrace, TraceAnalysis, TraceApprovalPoint, TraceAttempt, TraceCompaction,
  TraceRepeatGroup, TraceSessionCard, TraceStep, TraceTokenBuckets,
  TraceToolStat, TraceTurn, TraceTurnTime,
} from './types.ts'

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
  /** 完整参数字符串(重复调用判等用;不截断)。 */
  argsRaw: string
  turn: number
  step: number
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

/** 单个 step 的累积态(step/start 建,assistant/message 补 ttft/gen,tool/result 补 toolMs)。 */
interface StepAccumulator {
  turn: number
  step: number
  startedAt: number | undefined
  endedAt: number | undefined
  ttftMs: number | null
  genMs: number | null
  toolMs: number
  toolCalls: number
  toolErrors: number
  toolNames: string[]
  tokens: TraceTokenBuckets | null
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
  steps: Map<number, StepAccumulator>
}

function emptyTurn(turn: number): TurnAccumulator {
  return {
    turn, startedAt: undefined, endedAt: undefined, endReason: null, usage: null, reasoning: null,
    tools: new Map(), approvals: [], steps: new Map(),
  }
}

function emptyStep(turn: number, step: number): StepAccumulator {
  return {
    turn, step, startedAt: undefined, endedAt: undefined, ttftMs: null, genMs: null,
    toolMs: 0, toolCalls: 0, toolErrors: 0, toolNames: [], tokens: null,
  }
}

/** 零值时间归因。 */
const ZERO_TIME: TraceTurnTime = { wallMs: null, ttftMs: 0, genMs: 0, toolMs: 0, otherMs: 0, observedSteps: 0 }

/** TokenUsage(互斥四桶)→ 线契约四桶(billed 按 input+cacheRead+cacheWrite+output 派生)。 */
function bucketsOf(usage: unknown): TraceTokenBuckets | null {
  const record = asRecord(usage)
  if (record === null) return null
  const input = asNumber(record['inputTokens']) ?? 0
  const output = asNumber(record['outputTokens']) ?? 0
  const cacheRead = asNumber(record['cacheReadTokens']) ?? 0
  const cacheWrite = asNumber(record['cacheWriteTokens']) ?? 0
  return { input, output, cacheRead, cacheWrite, billed: input + cacheRead + cacheWrite + output }
}

/**
 * 计时流的可观测跨度:`首 token 时刻`(官方语义)与`流末时刻`。
 *
 * 为什么要单独算流末:`assistantStreamFirstTokenTime` 只给首 token;生成时长需要
 * 末端。末端的取法 = 所有记录里最晚的时刻(chunk.time 直接给;打包 run 用
 * time0 + Σdt 还原——AssistantStreamRecord 的紧凑形的语义,见 dsh-llm
 * assistant-stream.d.ts)。
 */
function streamSpan(stream: readonly AssistantStreamRecord[]): { first: number; last: number } | null {
  if (stream.length === 0) return null
  const first = assistantStreamFirstTokenTime(stream)
  let last = Number.NEGATIVE_INFINITY
  for (const record of stream) {
    // 判别联合:chunk 直接带 time;打包 run 用 time0 + Σdt 还原尾部时刻。
    let end: number
    if (record.type === 'chunk') {
      end = record.time
    } else {
      let acc = 0
      for (const dt of record.dt) if (typeof dt === 'number') acc += dt
      end = record.time0 + acc
    }
    if (end > last) last = end
  }
  if (first === undefined || last === Number.NEGATIVE_INFINITY) return null
  return { first, last: Math.max(first, last) }
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

/** 事件行流 → 轮次树 + 会话分析面(容错折叠;坏行计 skipped;事件形态口径见文件头)。 */
export function projectSessionTrace(sessionId: string, lines: readonly string[]): SessionTrace {
  const turns = new Map<number, TurnAccumulator>()
  const order: number[] = []
  const approvalById = new Map<string, MutableApprovalPoint>()
  /**
   * 未配对工具调用(严格 FIFO:配对成功即删)。
   *
   * 为什么必须删:压缩会把被裁剪的历史 tool/result 重新追加一遍,同一 callId 出现
   * 两次。若不删,第二次会覆盖第一次的结论(实测把 31ms 的 bash 算成 30249s)。
   * 用 open 表而不是永久 Map,第二次同 callId 找不到调用方 → 视为未配对丢弃。
   */
  const openTools = new Map<string, { call: MutableToolCall; callAt: number | undefined; acc: TurnAccumulator }>()
  /** 全部配对成功的工具调用(按配对完成序;工具排行/重复检测的数据源)。 */
  const pairedTools: MutableToolCall[] = []
  const attempts: TraceAttempt[] = []
  let currentTurn: number | undefined
  let total = 0
  let projected = 0
  let skipped = 0
  // —— 会话级元数据 ——
  let title = ''
  let createdAt: number | undefined
  let cwd: string | null = null
  let preset: string | null = null
  let origin: string | null = null
  let delegationDepth: number | null = null
  let route: string | null = null
  let contextWindow: number | null = null
  let compactionEvents = 0
  let prunedTokens = 0
  let compactionFailures = 0
  let userMessages = 0
  let approvalsAsked = 0
  let approvalsDecided = 0
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
  /** 取(或建)某轮的某 step 累积器;step 号缺失时不建(无法归位,不计)。 */
  const stepOf = (turn: number | undefined, step: number | undefined): StepAccumulator | undefined => {
    if (step === undefined) return undefined
    const acc = turnOf(turn ?? currentTurn)
    let row = acc.steps.get(step)
    if (row === undefined) {
      row = emptyStep(acc.turn, step)
      acc.steps.set(step, row)
    }
    return row
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
    // 容器头行:挂在行本身而非 data 上(version/id/createdAt/cwd/agentPreset/origin)。
    if (type === 'session') {
      createdAt = asNumber(record['createdAt']) ?? createdAt
      cwd = asString(record['cwd']) ?? cwd
      preset = asString(record['agentPreset']) ?? preset
      origin = asString(record['origin']) ?? origin
      const depth = asNumber(record['delegationDepth'])
      if (depth !== undefined) delegationDepth = depth
      continue
    }
    const data = asRecord(record['data'])
    if (data === null) {
      skipped += 1
      continue
    }
    const time = asNumber(record['time'])
    const turn = asNumber(data['turn'])
    const step = asNumber(data['step'])
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
      case 'step/start': {
        const row = stepOf(turn, step)
        if (row === undefined) {
          skipped += 1
          break
        }
        row.startedAt = time ?? row.startedAt
        projected += 1
        break
      }
      case 'step/end': {
        const row = stepOf(turn, step)
        if (row === undefined) {
          skipped += 1
          break
        }
        row.endedAt = time ?? row.endedAt
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
        const argsRaw = asString(data['arguments']) ?? ''
        const call: MutableToolCall = {
          callId,
          name: asString(data['name']) ?? '',
          at: isoOf(time),
          argsPreview: truncate(argsRaw, TRACE_ARGS_PREVIEW_LIMIT),
          argsRaw,
          turn: acc.turn,
          step: step ?? 0,
          isError: false,
          errorName: null,
          durationMs: null,
        }
        acc.tools.set(callId, { call, callAt: time })
        openTools.set(callId, { call, callAt: time, acc })
        const row = stepOf(acc.turn, step)
        if (row !== undefined) {
          row.toolCalls += 1
          if (!row.toolNames.includes(call.name)) row.toolNames.push(call.name)
        }
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
        // 严格 FIFO:只在「调用仍在等待结果」时才认领;认领后立即删除,
        // 因此压缩重放出来的第二条同 id result 会走「未配对」分支被丢弃。
        const pending = openTools.get(toolCallId)
        if (pending !== undefined) {
          openTools.delete(toolCallId)
          const isError = message?.['isError'] === true
          const error = asRecord(data['error'])
          pending.call.isError = isError
          pending.call.errorName = asString(error?.['name']) ?? null
          if (pending.callAt !== undefined && time !== undefined) {
            pending.call.durationMs = Math.max(0, time - pending.callAt)
            const row = pending.acc.steps.get(pending.call.step)
            if (row !== undefined) row.toolMs += pending.call.durationMs
          }
          const row = pending.acc.steps.get(pending.call.step)
          if (row !== undefined && isError) row.toolErrors += 1
          pairedTools.push(pending.call)
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
        const row = stepOf(turn, step)
        if (row !== undefined) {
          const buckets = bucketsOf(data['usage'])
          if (buckets !== null) row.tokens = buckets
          // 计时只认 assistant/message 的 stream:它是这一步真正提交给模型可见面的
          // 输出;assistant/attempt 走单独分支(失败尝试,不覆盖本步计时)。
          const stream = data['stream']
          if (Array.isArray(stream)) {
            const span = streamSpan(stream as readonly AssistantStreamRecord[])
            if (span !== null && row.startedAt !== undefined) {
              row.ttftMs = Math.max(0, span.first - row.startedAt)
              row.genMs = Math.max(0, span.last - span.first)
            }
          }
        }
        // 推理摘要:多 step 轮次「最后一条 assistant 消息胜出」(确定口径)。
        const reasoning = reasoningPreviewOf(asRecord(data['message']))
        if (reasoning !== null) acc.reasoning = reasoning
        projected += 1
        break
      }
      case 'assistant/attempt': {
        // 失败/重试尝试:不提交可见消息,但有完整计时流(可用于区分「慢」与「失败重试」)。
        const acc = turnOf(turn ?? currentTurn)
        const stream = data['stream']
        const span = Array.isArray(stream)
          ? streamSpan(stream as readonly AssistantStreamRecord[])
          : null
        const stepStart = step !== undefined ? acc.steps.get(step)?.startedAt : undefined
        attempts.push({
          turn: acc.turn,
          step: step ?? 0,
          at: isoOf(time),
          ttftMs: span !== null && stepStart !== undefined ? Math.max(0, span.first - stepStart) : null,
          streamMs: span !== null ? Math.max(0, span.last - span.first) : null,
        })
        projected += 1
        break
      }
      case 'request/header': {
        const header = asRecord(data['header'])
        const config = asRecord(header?.['config'])
        const provider = asString(config?.['provider'])
        const model = asString(config?.['model'])
        if (provider !== undefined && model !== undefined) route = `${provider}/${model}`
        projected += 1
        break
      }
      case 'request/context': {
        const provider = asString(data['provider'])
        const model = asString(data['model'])
        if (provider !== undefined && model !== undefined) route = `${provider}/${model}`
        const window = asNumber(data['contextWindow'])
        if (window !== undefined && window > 0) contextWindow = window
        projected += 1
        break
      }
      case 'compaction/start': {
        compactionEvents += 1
        projected += 1
        break
      }
      case 'compaction/prune': {
        prunedTokens += asNumber(data['shadowedTokenCount']) ?? 0
        projected += 1
        break
      }
      case 'compaction/end': {
        if (asString(data['error']) !== undefined) compactionFailures += 1
        projected += 1
        break
      }
      case 'user/message': {
        userMessages += 1
        projected += 1
        break
      }
      case 'session/title': {
        const next = asString(data['title'])
        if (next !== undefined) title = next
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
        approvalsAsked += 1
        projected += 1
        break
      }
      case 'approval/decided': {
        const askId = asString(data['id'])
        const point = askId !== undefined ? approvalById.get(askId) : undefined
        if (point === undefined) break // 未配对(如 asked 落在读取窗口外):不计 projected
        point.outcome = asString(data['outcome']) ?? point.outcome
        point.decidedAt = isoOf(time)
        approvalsDecided += 1
        projected += 1
        break
      }
      default:
        break // 未折叠事件(session/end-seed、agent/inbox/spliced、job/* 等)不是坏行
    }
  }
  const sorted = [...order].sort((a, b) => a - b)
  const turnViews = sorted.map((key): TraceTurn => {
    const acc = turns.get(key) as TurnAccumulator
    const steps = [...acc.steps.values()].sort((a, b) => a.step - b.step).map(toStepView)
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
      steps,
      tokens: sumBuckets(steps),
      time: sumTime(steps, acc.startedAt !== undefined && acc.endedAt !== undefined
        ? Math.max(0, acc.endedAt - acc.startedAt)
        : null),
    }
  })
  return {
    sessionId,
    turns: turnViews,
    events: { total, projected, skipped },
    analysis: buildAnalysis({
      createdAt, cwd, preset, origin, delegationDepth, title, route, contextWindow,
      turns: turnViews, pairedTools, attempts, compactionEvents, prunedTokens, compactionFailures,
      userMessages, approvalsAsked, approvalsDecided,
    }),
  }
}

/** step 累积态 → 线契约(墙钟/其他开销在此收口)。 */
function toStepView(row: StepAccumulator): TraceStep {
  const wallMs = row.startedAt !== undefined && row.endedAt !== undefined
    ? Math.max(0, row.endedAt - row.startedAt)
    : null
  const otherMs = wallMs === null
    ? null
    : Math.max(0, wallMs - (row.ttftMs ?? 0) - (row.genMs ?? 0) - row.toolMs)
  return {
    step: row.step,
    startedAt: isoOf(row.startedAt),
    endedAt: isoOf(row.endedAt),
    wallMs,
    ttftMs: row.ttftMs,
    genMs: row.genMs,
    toolMs: row.toolMs,
    otherMs,
    tokens: row.tokens,
    promptTokens: row.tokens === null ? null : row.tokens.input + row.tokens.cacheRead + row.tokens.cacheWrite,
    toolCalls: row.toolCalls,
    toolErrors: row.toolErrors,
    toolNames: row.toolNames,
  }
}

/** 各 step 四桶求和。 */
function sumBuckets(steps: readonly TraceStep[]): TraceTokenBuckets {
  let input = 0
  let output = 0
  let cacheRead = 0
  let cacheWrite = 0
  for (const row of steps) {
    if (row.tokens === null) continue
    input += row.tokens.input
    output += row.tokens.output
    cacheRead += row.tokens.cacheRead
    cacheWrite += row.tokens.cacheWrite
  }
  return { input, output, cacheRead, cacheWrite, billed: input + cacheRead + cacheWrite + output }
}

/**
 * 各 step 时间归因求和。`wallMs` 由调用方给(轮的 turn/start→turn/end),
 * 分量只累加有实测值的部分——未收尾轮次 wallMs=null 而分量非空,这是刻意的:
 * 「已观测到多久」与「这一轮总共多久」是两个事实,不能混同。
 */
function sumTime(steps: readonly TraceStep[], wallMs: number | null): TraceTurnTime {
  if (steps.length === 0) return { ...ZERO_TIME, wallMs }
  let ttftMs = 0
  let genMs = 0
  let toolMs = 0
  let otherMs = 0
  let observedSteps = 0
  for (const row of steps) {
    toolMs += row.toolMs
    if (row.ttftMs !== null) {
      ttftMs += row.ttftMs
      observedSteps += 1
    }
    if (row.genMs !== null) genMs += row.genMs
    if (row.otherMs !== null) otherMs += row.otherMs
  }
  return { wallMs, ttftMs, genMs, toolMs, otherMs, observedSteps }
}

/** 工具聚合的输入上下文(见 buildAnalysis)。 */
interface AnalysisInput {
  createdAt: number | undefined
  cwd: string | null
  preset: string | null
  origin: string | null
  delegationDepth: number | null
  title: string
  route: string | null
  contextWindow: number | null
  turns: readonly TraceTurn[]
  pairedTools: readonly MutableToolCall[]
  attempts: readonly TraceAttempt[]
  compactionEvents: number
  prunedTokens: number
  compactionFailures: number
  userMessages: number
  approvalsAsked: number
  approvalsDecided: number
}

/** 最近秩法分位(升序第 ceil(q·n) 个,1-based;不插值,不做分布假设)。 */
function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(q * sorted.length)))
  return sorted[rank - 1] ?? 0
}

/** 工具排行:按工具名归集,只计配对成功的调用。 */
function toolStats(tools: readonly MutableToolCall[]): readonly TraceToolStat[] {
  const byName = new Map<string, { calls: number; errors: number; totalMs: number; maxMs: number; durs: number[] }>()
  for (const tool of tools) {
    let row = byName.get(tool.name)
    if (row === undefined) {
      row = { calls: 0, errors: 0, totalMs: 0, maxMs: 0, durs: [] }
      byName.set(tool.name, row)
    }
    row.calls += 1
    if (tool.isError) row.errors += 1
    if (tool.durationMs !== null) {
      row.totalMs += tool.durationMs
      row.durs.push(tool.durationMs)
      if (tool.durationMs > row.maxMs) row.maxMs = tool.durationMs
    }
  }
  return [...byName.entries()]
    .map(([name, row]): TraceToolStat => ({
      name,
      calls: row.calls,
      errors: row.errors,
      totalMs: row.totalMs,
      avgMs: row.durs.length === 0 ? 0 : Math.round(row.totalMs / row.durs.length),
      p95Ms: percentile(row.durs, 0.95),
      maxMs: row.maxMs,
    }))
    .sort((a, b) => b.totalMs - a.totalMs || b.calls - a.calls || a.name.localeCompare(b.name))
}

/**
 * 重复调用组:工具名 + 完整参数字符串逐字节相等。
 *
 * 刻意不做 JSON 规范化:键序不同的同一逻辑调用不是「重复发起」,规范化会把两次
 * 独立决策误判成一次浪费;反过来,只比预览会漏判(预览被截断)。
 */
function repeatGroups(tools: readonly MutableToolCall[]): readonly TraceRepeatGroup[] {
  const groups = new Map<string, { name: string; argsPreview: string; times: number; at: string[]; totalMs: number }>()
  for (const tool of tools) {
    // 统一分隔符:工具名与参数都可能含任意字符,用长度前缀避免拼接歧义。
    const key = `${tool.name.length}:${tool.name}|${tool.argsRaw}`
    let row = groups.get(key)
    if (row === undefined) {
      row = { name: tool.name, argsPreview: tool.argsPreview, times: 0, at: [], totalMs: 0 }
      groups.set(key, row)
    }
    row.times += 1
    row.at.push(`${tool.turn}.${tool.step}`)
    if (tool.durationMs !== null) row.totalMs += tool.durationMs
  }
  return [...groups.values()]
    .filter(row => row.times > 1)
    .map((row): TraceRepeatGroup => ({
      name: row.name,
      argsPreview: row.argsPreview,
      times: row.times,
      at: row.at,
      totalMs: row.totalMs,
    }))
    .sort((a, b) => b.times - a.times || b.totalMs - a.totalMs || a.name.localeCompare(b.name))
}

/** 会话级分析聚合(纯汇总,不含推断;字段语义见 types.ts TraceAnalysis)。 */
function buildAnalysis(input: AnalysisInput): TraceAnalysis {
  const tokens = sumBucketsAll(input.turns)
  const promptTotal = tokens.input + tokens.cacheRead + tokens.cacheWrite
  let steps = 0
  let modelCalls = 0
  let ttftMs = 0
  let genMs = 0
  let toolMs = 0
  let otherMs = 0
  let observedSteps = 0
  let wallMs: number | null = 0
  const pressure: { turn: number; step: number; promptTokens: number }[] = []
  for (const turn of input.turns) {
    steps += turn.steps.length
    modelCalls += turn.steps.filter(row => row.tokens !== null).length
    ttftMs += turn.time.ttftMs
    genMs += turn.time.genMs
    toolMs += turn.time.toolMs
    otherMs += turn.time.otherMs
    observedSteps += turn.time.observedSteps
    // 任一轮未收尾 → 会话级墙钟也是 null(不能把部分之和冒充总量)。
    if (wallMs !== null) wallMs = turn.time.wallMs === null ? null : wallMs + turn.time.wallMs
    for (const row of turn.steps) {
      if (row.promptTokens !== null) pressure.push({ turn: turn.turn, step: row.step, promptTokens: row.promptTokens })
    }
  }
  const peak = pressure.reduce((max, row) => Math.max(max, row.promptTokens), 0)
  const compaction: TraceCompaction = {
    events: input.compactionEvents,
    prunedTokens: input.prunedTokens,
    failures: input.compactionFailures,
  }
  return {
    session: {
      createdAt: isoOf(input.createdAt),
      cwd: input.cwd,
      preset: input.preset,
      origin: input.origin,
      delegationDepth: input.delegationDepth,
    },
    title: input.title,
    route: input.route,
    contextWindow: input.contextWindow,
    tokens,
    // 未报告过缓存桶 → null(未知),不伪报 0(对齐 @eterna/observe 口径)。
    cacheHitRate: promptTotal > 0 && (tokens.cacheRead > 0 || tokens.cacheWrite > 0)
      ? tokens.cacheRead / promptTotal
      : null,
    counts: {
      turns: input.turns.length,
      steps,
      modelCalls,
      toolCalls: input.pairedTools.length,
      userMessages: input.userMessages,
    },
    time: { wallMs, ttftMs, genMs, toolMs, otherMs, observedSteps },
    tools: toolStats(input.pairedTools),
    repeats: repeatGroups(input.pairedTools),
    compaction,
    attempts: input.attempts,
    pressure,
    pressurePeak: pressure.length === 0 ? null : peak,
    approvals: { asked: input.approvalsAsked, decided: input.approvalsDecided },
  }
}

/** 各轮四桶合计。 */
function sumBucketsAll(turns: readonly TraceTurn[]): TraceTokenBuckets {
  let input = 0
  let output = 0
  let cacheRead = 0
  let cacheWrite = 0
  for (const turn of turns) {
    input += turn.tokens.input
    output += turn.tokens.output
    cacheRead += turn.tokens.cacheRead
    cacheWrite += turn.tokens.cacheWrite
  }
  return { input, output, cacheRead, cacheWrite, billed: input + cacheRead + cacheWrite + output }
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
