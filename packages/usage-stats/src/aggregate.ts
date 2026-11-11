/**
 * P3(2026-11-11)用量聚合核心:扫描 $DSH_HOME/sessions/**\/session.v4.jsonl.zstd,
 * 折叠互斥四桶 usage(observe/metrics 同口径),归属=access 账本唯一事实源(X2:
 * 日志路径不含账号;无账本行的历史会话=「未归属」,只计入 admin 全局)。
 * zstd 多帧解码逐帧魔数扫描(与 panel/session-logs 同算法;整包解压只出首帧)。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = 4247762216

function scanZstdFrames(buffer: Buffer): Array<{ start: number; end: number }> {
  const frames: Array<{ start: number; end: number }> = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4 || buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break
    offset += 4
    if (offset === buffer.length) break
    const descriptor = buffer.readUInt8(offset); offset += 1
    if ((descriptor & 24) !== 0) break
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : (1 << contentSizeFlag)
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) break
    offset += remainingHeaderBytes
    let lastBlock = false
    for (;;) {
      if (buffer.length - offset < 3) { lastBlock = true; break }
      const blockHeader = buffer.readUIntLE(offset, 3); offset += 3
      lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) { lastBlock = false; break }
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) { lastBlock = true; break }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (!lastBlock) break
    if (checksum) { if (buffer.length - offset < 4) break; offset += 4 }
    frames.push({ start, end: offset })
  }
  return frames
}

export function decodeZstdLog(buffer: Buffer): string {
  const frames = scanZstdFrames(buffer)
  return frames.map(f => zstdDecompressSync(buffer.subarray(f.start, f.end)).toString('utf8')).join('')
}

/** 单会话折叠(observe/metrics 互斥四桶口径)。 */
export interface SessionUsage {
  readonly sessionId: string
  readonly mtimeMs: number
  turns: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  lastAt: number
  byModel: Record<string, { input: number; output: number; cacheRead: number; turns: number }>
}

export function foldSession(sessionId: string, mtimeMs: number, text: string): SessionUsage {
  const usage: SessionUsage = {
    sessionId, mtimeMs, turns: 0, inputTokens: 0, outputTokens: 0,
    cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, lastAt: 0, byModel: {},
  }
  for (const line of text.split('\n')) {
    if (line.length === 0) continue
    let parsed: unknown
    try { parsed = JSON.parse(line) } catch { continue }
    if (parsed === null || typeof parsed !== 'object') continue
    const event = parsed as { type?: string; time?: number; data?: unknown }
    if (event.type === 'turn/end') usage.turns += 1
    if (event.type === 'assistant/message' && typeof event.time === 'number' && event.time > usage.lastAt) usage.lastAt = event.time
    if (event.type !== 'assistant/message') continue
    const data = event.data as { usage?: Record<string, unknown>; model?: string } | undefined
    const u: Record<string, unknown> | undefined = data?.usage
    if (u === undefined) continue
    const num = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) ? v : 0
    usage.inputTokens += num(u.inputTokens)
    usage.outputTokens += num(u.outputTokens)
    usage.cacheReadTokens += num(u.cacheReadTokens)
    usage.cacheWriteTokens += num(u.cacheWriteTokens)
    usage.reasoningTokens += num(u.reasoningTokens)
    const model = typeof data?.model === 'string' && data.model !== '' ? data.model : 'unknown'
    const existingModelBucket = usage.byModel[model]
    const bucket = existingModelBucket ?? (usage.byModel[model] = { input: 0, output: 0, cacheRead: 0, turns: 0 })
    bucket.input += num(u.inputTokens)
    bucket.output += num(u.outputTokens)
    bucket.cacheRead += num(u.cacheReadTokens)
    bucket.turns += 1
  }
  return usage
}

/** 归属账本最小面(T2 新增的 sessionsOfOwner + sessionOwner)。 */
export interface OwnershipLedger {
  sessionOwner(sessionId: string): number | undefined
  sessionsOfOwner(ownerId: number): string[]
}

export interface AccountOf {
  accountOf(userId: number): string | undefined
}

export interface UsageBucket {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  turns: number
  sessions: number
}

export interface UsageAggregates {
  generatedAt: number
  sessionsScanned: number
  sessionsTotal: number
  /** 全部会话(admin 全局视图;含未归属)。 */
  total: UsageBucket
  /** per-account 视图(账本归属;未归属不进任何账号)。 */
  byAccount: Record<string, UsageBucket>
  /** 按天(ISO 日期,全部会话口径)。 */
  byDay: Record<string, { inputTokens: number; outputTokens: number; turns: number }>
  /** 按模型(全部会话口径)。 */
  byModel: Record<string, { inputTokens: number; outputTokens: number; cacheReadTokens: number; turns: number }>
}

function dayOf(time: number): string {
  return new Date(time).toISOString().slice(0, 10)
}

/** 一次聚合(全量扫描;调用方缓存派生数据,DSH_HOME 语义下持久化由 Host 半边负责)。 */
export function aggregate(
  sessionsRoot: string,
  ledger: OwnershipLedger & AccountOf,
): UsageAggregates {
  const aggregates: UsageAggregates = {
    generatedAt: Date.now(), sessionsScanned: 0, sessionsTotal: 0,
    total: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, turns: 0, sessions: 0 },
    byAccount: {}, byDay: {}, byModel: {},
  }
  let areas: string[] = []
  try { areas = readdirSync(sessionsRoot) } catch { return aggregates }
  for (const area of areas) {
    let sessions: string[] = []
    try { sessions = readdirSync(join(sessionsRoot, area)) } catch { continue }
    for (const dir of sessions) {
      if (!dir.startsWith('session-')) continue
      aggregates.sessionsTotal += 1
      const logPath = join(sessionsRoot, area, dir, 'session.v4.jsonl.zstd')
      let mtimeMs = 0
      try { mtimeMs = statSync(logPath).mtimeMs } catch { continue }
      let text: string
      try { text = decodeZstdLog(readFileSync(logPath)) } catch { continue }
      const usage = foldSession(dir, mtimeMs, text)
      aggregates.sessionsScanned += 1
      if (usage.turns === 0 && usage.inputTokens === 0 && usage.outputTokens === 0) continue
      aggregates.total.inputTokens += usage.inputTokens
      aggregates.total.outputTokens += usage.outputTokens
      aggregates.total.cacheReadTokens += usage.cacheReadTokens
      aggregates.total.cacheWriteTokens += usage.cacheWriteTokens
      aggregates.total.turns += usage.turns
      aggregates.total.sessions += 1
      const day = dayOf(usage.lastAt > 0 ? usage.lastAt : usage.mtimeMs)
      const existingDay = aggregates.byDay[day]
      const dayBucket = existingDay ?? (aggregates.byDay[day] = { inputTokens: 0, outputTokens: 0, turns: 0 })
      dayBucket.inputTokens += usage.inputTokens
      dayBucket.outputTokens += usage.outputTokens
      dayBucket.turns += usage.turns
      for (const [model, bucket] of Object.entries(usage.byModel)) {
        const existingModel = aggregates.byModel[model]
        const modelBucket = existingModel ?? (aggregates.byModel[model] = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, turns: 0 })
        modelBucket.inputTokens += bucket.input
        modelBucket.outputTokens += bucket.output
        modelBucket.cacheReadTokens += bucket.cacheRead
        modelBucket.turns += bucket.turns
      }
      // 归属(X2):账本唯一事实源;未归属只进 total
      const ownerId = ledger.sessionOwner(usage.sessionId)
      if (ownerId === undefined) continue
      const account = ledger.accountOf(ownerId)
      if (account === undefined) continue
      const existingAccount = aggregates.byAccount[account]
      const accountBucket = existingAccount ?? (aggregates.byAccount[account] = {
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, turns: 0, sessions: 0,
      })
      accountBucket.inputTokens += usage.inputTokens
      accountBucket.outputTokens += usage.outputTokens
      accountBucket.cacheReadTokens += usage.cacheReadTokens
      accountBucket.cacheWriteTokens += usage.cacheWriteTokens
      accountBucket.turns += usage.turns
      accountBucket.sessions += 1
    }
  }
  return aggregates
}
