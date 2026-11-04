/**
 * session 日志只读投影:读 DSH 宿主的 session.v4.jsonl.zstd(多帧 zstd 容器),
 * 折叠 usage(token/缓存命中)与轮次。容器格式与帧扫描算法对齐
 * dsh-repo packages/session/persistence-jsonl 的 zstd.ts(公开解码路径:
 * 每个完整帧独立 zstdDecompressSync);本模块只读、容错(坏文件跳过)。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import type { SessionUsageCard } from './types.ts'

/** zstd 魔数(LE):0xFD2FB528。 */
const ZSTD_MAGIC = 4247762216
/** 单个日志文件最大读取字节(面板样例用途,超出的完整帧仍被解码,尾部截断按 torn 处理)。 */
const MAX_LOG_BYTES = 8 * 1024 * 1024
/** 面板展示的最近会话数。 */
const RECENT_SESSION_LIMIT = 5

interface FrameRange { readonly start: number; readonly end: number }

/**
 * 扫描完整 zstd 帧(字节级走查,不解压);EOF 落在帧内 = torn 尾巴,忽略。
 * 算法逐行对齐 persistence-jsonl scanZstdFrames(见该包 src/zstd.ts)。
 */
export function scanZstdFrames(buffer: Buffer): readonly FrameRange[] {
  const frames: FrameRange[] = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4 || buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break
    offset += 4
    if (offset === buffer.length) break
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) break
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? singleSegment ? 1 : 0 : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) break
    offset += remainingHeaderBytes
    let lastBlock = false
    for (;;) {
      if (buffer.length - offset < 3) { lastBlock = true; break }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      lastBlock = (blockHeader & 1) !== 0
      const blockType = blockHeader >>> 1 & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) { lastBlock = false; break }
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) { lastBlock = true; break }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (!lastBlock) break
    if (checksum) {
      if (buffer.length - offset < 4) break
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return frames
}

/** 解码多帧容器(每帧独立 one-shot 解压,拼接为完整文本)。 */
export function decodeZstdLog(buffer: Buffer): string {
  const frames = scanZstdFrames(buffer)
  const parts: string[] = []
  for (const frame of frames) {
    parts.push(zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString('utf8'))
  }
  return parts.join('')
}

interface UsageFold {
  turns: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  lastAt: number
}

/** 折叠一条会话日志的 JSONL 事件:usage 求和 + 轮次计数 + 最近时间。 */
export function foldSessionEvents(lines: readonly string[]): UsageFold {
  const fold: UsageFold = { turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, lastAt: 0 }
  for (const line of lines) {
    if (line.length === 0) continue
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof event !== 'object' || event === null) continue
    const record = event as { type?: unknown; time?: unknown; data?: unknown }
    if (typeof record.time === 'number' && record.time > fold.lastAt) fold.lastAt = record.time
    if (record.type === 'turn/end') fold.turns += 1
    if (record.type === 'assistant/message' && typeof record.data === 'object' && record.data !== null) {
      const usage = (record.data as { usage?: unknown }).usage
      if (typeof usage === 'object' && usage !== null) {
        const tokens = usage as Record<string, unknown>
        if (typeof tokens.inputTokens === 'number') fold.inputTokens += tokens.inputTokens
        if (typeof tokens.outputTokens === 'number') fold.outputTokens += tokens.outputTokens
        if (typeof tokens.cacheReadTokens === 'number') fold.cacheReadTokens += tokens.cacheReadTokens
      }
    }
  }
  return fold
}

/** 汇率:缓存命中 = cacheRead / (input + cacheRead);输入总量 0 → null(不显示)。 */
export function cacheHitRate(inputTokens: number, cacheReadTokens: number): number | null {
  const total = inputTokens + cacheReadTokens
  if (total <= 0) return null
  return Math.round((cacheReadTokens / total) * 10000) / 10000
}

function listSessionLogs(sessionsRoot: string): { path: string; mtimeMs: number }[] {
  let areas: string[]
  try {
    areas = readdirSync(sessionsRoot)
  } catch {
    return []
  }
  const logs: { path: string; mtimeMs: number }[] = []
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
        logs.push({ path: logPath, mtimeMs: statSync(logPath).mtimeMs })
      } catch {
        // 会话目录无日志(仅锁文件等):跳过
      }
    }
  }
  return logs.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/** 读最近会话用量(mtime 最新的 N 个日志;任何文件解码失败即跳过该文件)。 */
export function readRecentSessionUsage(sessionsRoot: string, limit = RECENT_SESSION_LIMIT): readonly SessionUsageCard[] {
  const cards: SessionUsageCard[] = []
  for (const log of listSessionLogs(sessionsRoot)) {
    if (cards.length >= limit) break
    let text: string
    try {
      text = decodeZstdLog(readFileSync(log.path).subarray(0, MAX_LOG_BYTES))
    } catch {
      continue
    }
    const fold = foldSessionEvents(text.split('\n'))
    if (fold.turns === 0 && fold.inputTokens === 0 && fold.outputTokens === 0) continue
    const segments = log.path.split('/')
    cards.push({
      id: segments.at(-2) ?? log.path,
      area: segments.at(-3) ?? '',
      turns: fold.turns,
      inputTokens: fold.inputTokens,
      outputTokens: fold.outputTokens,
      cacheReadTokens: fold.cacheReadTokens,
      cacheHitRate: cacheHitRate(fold.inputTokens, fold.cacheReadTokens),
      lastAt: fold.lastAt > 0 ? new Date(fold.lastAt).toISOString() : '',
    })
  }
  return cards
}
