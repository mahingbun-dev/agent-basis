/**
 * C9(22 号 §4)admin 观测扩展单测:
 * - scanCompactionStats 事件扫描面:compaction/summary|prune 基础计数、
 *   compaction/end.error 的 `invalid-summary:` 前缀计数(C3 约定)、L2 stale
 *   占位符与相邻 shadow-price 事件配对的 stalePruneCount/staleSavedTokens、
 *   多帧 zstd 解码、60s 进程内缓存与 resetStatsCache 失效;
 * - state 文件合并面:rapidRefillCount/lastRapidRefillAt(C7 写入)与
 *   summarization 目标(C8b 落值后由引擎写入;缺省=跟随会话模型)经
 *   EternaCompactionGateway.state() 汇出。
 *
 * 日志fixture 逐行与 dsh SessionEvent 同构({type,seq,time,data[,surfaceOp]}),
 * 每帧独立 zstd 压缩后拼接(admin 的 decodeSessionLog 逐偏移扫 magic)。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  EternaCompactionGateway,
  resetStatsCache,
  scanCompactionStats,
  scanRecentCheckpoints,
} from '../src/admin-plugin.ts'
import { STALE_PRUNE_MARKER } from '../src/stale/config.ts'

let homeDir = ''
let sessionsRoot = ''

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'eterna-compaction-admin-'))
  process.env.DSH_HOME = homeDir
  sessionsRoot = join(homeDir, 'sessions')
  resetStatsCache()
})

afterEach(async () => {
  delete process.env.DSH_HOME
  resetStatsCache()
  await rm(homeDir, { recursive: true, force: true })
})

// ── fixture 构造 ──

/** 会话事件行(dsh SessionEvent 持久化形态的可测投影)。 */
type FixtureEvent = Record<string, unknown>

function writeSessionLog(sessionId: string, frames: FixtureEvent[][]): void {
  const dir = join(sessionsRoot, sessionId)
  mkdirSync(dir, { recursive: true })
  const chunks = frames.map(frame => Buffer.from(`${frame.map(line => JSON.stringify(line)).join('\n')}\n`, 'utf8'))
  writeFileSync(join(dir, 'session.v4.jsonl.zstd'), Buffer.concat(chunks.map(chunk => zstdCompressSync(chunk))))
}

let nextSeq = 0
function seq(): number {
  nextSeq += 1
  return nextSeq
}

function summaryEvent(time: number, shadowedTokenCount: number): FixtureEvent {
  return { type: 'compaction/summary', seq: seq(), time, data: { compactionId: 'c', turn: 1, shadowedTokenCount } }
}

function pruneEvent(time: number, shadowedSeq: number, shadowedTokenCount: number): FixtureEvent {
  return {
    type: 'compaction/prune',
    seq: seq(),
    time,
    data: { shadowedRange: { start: shadowedSeq, end: shadowedSeq }, shadowedSeqs: [shadowedSeq], shadowedTokenCount },
  }
}

function staleReplacementEvent(time: number, startSeq: number): FixtureEvent {
  return {
    type: 'tool/result',
    seq: seq(),
    time,
    data: {
      turn: 1, step: 1,
      message: { role: 'tool', content: [{ type: 'text', text: STALE_PRUNE_MARKER }], toolCallId: 'c1' },
    },
    surfaceOp: { op: 'replace', startSeq, endSeq: startSeq },
    sourceEventSeqs: [startSeq],
  }
}

/** L1 pruner 的替换事件:非占位符 content(截断原文),不得计入 stale。 */
function plainReplacementEvent(time: number, startSeq: number, body: string): FixtureEvent {
  return {
    type: 'tool/result',
    seq: seq(),
    time,
    data: {
      turn: 1, step: 1,
      message: { role: 'tool', content: [{ type: 'text', text: body }], toolCallId: 'c1' },
    },
    surfaceOp: { op: 'replace', startSeq, endSeq: startSeq },
    sourceEventSeqs: [startSeq],
  }
}

function endEvent(time: number, error?: string): FixtureEvent {
  const data: Record<string, unknown> = { compactionId: 'c', turn: 1 }
  if (error !== undefined) data.error = error
  return { type: 'compaction/end', seq: seq(), time, data }
}

// ── 事件扫描面 ──

describe('scanCompactionStats 事件扫描', () => {
  it('summary/prune/shadowedTokenCount/lastCompactedAt 基础计数', () => {
    writeSessionLog('s1', [[
      summaryEvent(1_000, 3_000),
      pruneEvent(2_000, 7, 500),
      endEvent(3_000),
    ]])
    const stats = scanCompactionStats(sessionsRoot)
    expect(stats.summaryCount).toBe(1)
    expect(stats.pruneCount).toBe(1)
    expect(stats.shadowedTokenCount).toBe(3_500)
    // lastCompactedAt 沿既有语义:只统计 summary|prune 事件时间,end 不参与。
    expect(stats.lastCompactedAt).toBe(new Date(2_000).toISOString())
    expect(stats.invalidSummaryCount).toBe(0)
    expect(stats.stalePruneCount).toBe(0)
    expect(stats.staleSavedTokens).toBe(0)
  })

  it('invalidSummaryCount 只数 compaction/end.error 带 invalid-summary: 前缀的失败', () => {
    writeSessionLog('s1', [[
      endEvent(1_000, 'invalid-summary: missing section "## Current Work"'),
      endEvent(2_000, 'invalid-summary: section "Primary Request and Intent" is empty'),
      endEvent(3_000, 'llm quota exceeded'),
      endEvent(4_000),
    ]])
    const stats = scanCompactionStats(sessionsRoot)
    expect(stats.invalidSummaryCount).toBe(2)
    // 失败的 end 不计入 lastCompactedAt(压缩未成功;现有语义只统计成功面)。
    expect(stats.lastCompactedAt).toBeNull()
  })

  it('stale 配对:prune + 相邻占位符替换 → stalePruneCount/staleSavedTokens', () => {
    writeSessionLog('s1', [[
      pruneEvent(1_000, 3, 1_200),
      staleReplacementEvent(1_001, 3),
      pruneEvent(2_000, 9, 2_400),
      staleReplacementEvent(2_001, 9),
    ]])
    const stats = scanCompactionStats(sessionsRoot)
    expect(stats.pruneCount).toBe(2)
    expect(stats.stalePruneCount).toBe(2)
    expect(stats.staleSavedTokens).toBe(3_600)
  })

  it('L1 pruner 的非占位符替换不计入 stale(同协议,内容区分)', () => {
    writeSessionLog('s1', [[
      pruneEvent(1_000, 5, 800),
      plainReplacementEvent(1_001, 5, 'head of original output...'),
    ]])
    const stats = scanCompactionStats(sessionsRoot)
    expect(stats.pruneCount).toBe(1)
    expect(stats.stalePruneCount).toBe(0)
    expect(stats.staleSavedTokens).toBe(0)
  })

  it('占位符替换与 prune 非相邻/seq 不匹配时不配对(防误配)', () => {
    writeSessionLog('s1', [[
      pruneEvent(1_000, 3, 900),
      // startSeq=5 不在上一 prune 的 shadowedSeqs 里,且两行不相邻。
      staleReplacementEvent(1_001, 5),
      // 无任何前置 prune 的占位符结果(如工具原文逐字回显)。
      staleReplacementEvent(2_000, 11),
    ]])
    const stats = scanCompactionStats(sessionsRoot)
    expect(stats.stalePruneCount).toBe(0)
    expect(stats.staleSavedTokens).toBe(0)
  })

  it('多帧 zstd 日志全部解码计数', () => {
    writeSessionLog('s1', [
      [summaryEvent(1_000, 1_000)],
      [summaryEvent(2_000, 2_000)],
    ])
    const stats = scanCompactionStats(sessionsRoot)
    expect(stats.summaryCount).toBe(2)
    expect(stats.shadowedTokenCount).toBe(3_000)
    expect(stats.lastCompactedAt).toBe(new Date(2_000).toISOString())
  })

  it('60s 缓存命中:文件变化不反映,resetStatsCache 后重新扫描', () => {
    writeSessionLog('s1', [[summaryEvent(1_000, 1_000)]])
    expect(scanCompactionStats(sessionsRoot).summaryCount).toBe(1)
    writeSessionLog('s2', [[summaryEvent(2_000, 2_000)]])
    expect(scanCompactionStats(sessionsRoot).summaryCount).toBe(1)
    resetStatsCache()
    expect(scanCompactionStats(sessionsRoot).summaryCount).toBe(2)
  })

  it('sessions 根不存在时返回零值统计', () => {
    const stats = scanCompactionStats(join(homeDir, 'no-such-sessions'))
    expect(stats.summaryCount).toBe(0)
    expect(stats.lastCompactedAt).toBeNull()
  })
})

// ── state 文件合并面(gateway.state()) ──

function stateFilePath(): string {
  return join(homeDir, '.eterna', 'compaction.state.json')
}

function writeStateFile(content: Record<string, unknown>): void {
  mkdirSync(join(homeDir, '.eterna'), { recursive: true })
  writeFileSync(stateFilePath(), JSON.stringify(content))
}

function makeGateway(): EternaCompactionGateway {
  return new EternaCompactionGateway(new Context(), { sessionsRoot })
}

describe('state() 的熔断与摘要模型汇出', () => {
  it('rapidRefillCount/lastRapidRefillAt 从 state 文件合并进 stats', () => {
    writeStateFile({ thresholdRatio: 0.8, retainRatio: 0.16, auto: true, rapidRefillCount: 3, lastRapidRefillAt: '2026-11-13T08:00:00.000Z' })
    const view = makeGateway().state()
    expect(view.ok).toBe(true)
    if (!view.ok) return
    expect(view.stats.rapidRefillCount).toBe(3)
    expect(view.stats.lastRapidRefillAt).toBe('2026-11-13T08:00:00.000Z')
  })

  it('state 文件缺席/字段类型异常时熔断计数回退 0 与 null', () => {
    const missing = makeGateway().state()
    if (!missing.ok) throw new Error('state() should succeed')
    expect(missing.stats.rapidRefillCount).toBe(0)
    expect(missing.stats.lastRapidRefillAt).toBeNull()

    writeStateFile({ rapidRefillCount: 'many', lastRapidRefillAt: 42 })
    const garbage = makeGateway().state()
    if (!garbage.ok) throw new Error('state() should succeed')
    expect(garbage.stats.rapidRefillCount).toBe(0)
    expect(garbage.stats.lastRapidRefillAt).toBeNull()
  })

  it('summarization 目标:C8b 落值后展示,缺省为 null 对(跟随会话模型)', () => {
    const absent = makeGateway().state()
    if (!absent.ok) throw new Error('state() should succeed')
    expect(absent.config.summarization).toEqual({ provider: null, model: null })

    writeStateFile({ summarizationProvider: 'deepseek', summarizationModel: 'mimo-v2.6-flash' })
    const configured = makeGateway().state()
    if (!configured.ok) throw new Error('state() should succeed')
    expect(configured.config.summarization).toEqual({ provider: 'deepseek', model: 'mimo-v2.6-flash' })
  })

  it('updateConfig 合并保存路径返回值带全量新统计字段', () => {
    writeStateFile({ auto: true, thresholdRatio: 0.8, retainRatio: 0.16, rapidRefillCount: 1, lastRapidRefillAt: '2026-11-13T08:00:00.000Z' })
    const view = makeGateway().updateConfig({ auto: false })
    expect(view.ok).toBe(true)
    if (!view.ok) return
    expect(view.config.auto).toBe(false)
    expect(view.stats.rapidRefillCount).toBe(1)
    expect(view.stats.summaryCount).toBe(0)
    expect(view.stats.invalidSummaryCount).toBe(0)
    expect(view.stats.stalePruneCount).toBe(0)
    expect(view.stats.staleSavedTokens).toBe(0)
    // overrides 文件落盘(auto 单键合并,threshold/retain 不受牵连)。
    const overrides = JSON.parse(readFileSync(join(homeDir, '.eterna', 'compaction.config.json'), 'utf8')) as Record<string, unknown>
    expect(overrides).toEqual({ auto: false })
  })
})

// ── M-C4:scanRecentCheckpoints(最近压缩 checkpoint 视图数据面) ──

describe('scanRecentCheckpoints', () => {
  it('跨会话收集 compaction/summary,时间降序,摘要截 400 字,session 取目录名', () => {
    const longSummary = Array.from({ length: 60 }, (_, index) => ({ type: 'text', text: `第${index}段摘要内容补充足够长度以触发截断边界` })).map(block => block.text).join('\n')
    writeSessionLog('sess-aaa', [[
      { type: 'compaction/summary', seq: seq(), time: 1_000, data: { shadowedTokenCount: 5137, provider: 'deepseek', model: 'deepseek-flash', summary: [{ type: 'text', text: longSummary }] } },
    ]])
    writeSessionLog('sess-bbb', [[
      { type: 'compaction/prune', seq: seq(), data: { shadowedTokenCount: 999, shadowedSeqs: [1] } },
      { type: 'compaction/summary', seq: seq(), time: 2_000, data: { shadowedTokenCount: 1444, provider: 'deepseek', model: 'deepseek-flash', summary: [{ type: 'text', text: '简短摘要' }] } },
    ]])

    const rows = scanRecentCheckpoints(sessionsRoot, 8)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ session: 'sess-bbb', shadowedTokenCount: 1444, provider: 'deepseek', model: 'deepseek-flash', summary: '简短摘要' })
    expect(rows[1]).toMatchObject({ session: 'sess-aaa', shadowedTokenCount: 5137 })
    // prune 事件不进列表;摘要截断生效。
    expect(rows[1]?.summary.length).toBeLessThanOrEqual(400)
    expect(rows[1]?.summary).not.toContain('段落39')
  })

  it('limit 截断与空目录', () => {
    writeSessionLog('sess-ccc', [[
      { type: 'compaction/summary', seq: seq(), time: 3_000, data: { shadowedTokenCount: 10, provider: 'p', model: 'm', summary: [{ type: 'text', text: 'x' }] } },
    ]])
    expect(scanRecentCheckpoints(sessionsRoot, 1)).toHaveLength(1)
    expect(scanRecentCheckpoints(join(homeDir, 'sessions-empty'), 8)).toEqual([])
  })
})
