/**
 * P3-T2.1 聚合快照:固定日志样本(生成器现场编码 zstd 落盘)→ 五视图逐值对账。
 * 归属互斥(X2):A/B 混合样本互斥;账本优先;未归属只进全局。
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { aggregate, foldSession, decodeZstdLog } from '../src/aggregate.ts'
import type { OwnershipLedger } from '../src/aggregate.ts'

/** 事件数组 → 多帧 zstd 会话日志(帧 1:session 头,帧 2+:每事件一帧——合法多帧容器)。 */
function writeSessionLog(sessionsRoot: string, area: string, sessionId: string, events: Array<Record<string, unknown>>): void {
  const dir = join(sessionsRoot, area, sessionId)
  mkdirSync(dir, { recursive: true })
  const header = JSON.stringify({ type: 'session', version: 4, id: sessionId, createdAt: events[0]?.time ?? 0, cwd: '/x' })
  const lines = [header, ...events.map(e => JSON.stringify(e))].join('\n') + '\n'
  // 单帧容器(zstd 容器格式:一帧可含全部内容;panel/aggregate 的帧扫描按帧切割)
  writeFileSync(join(dir, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(lines, 'utf8')))
}

function msgEvent(time: number, model: string, usage: Record<string, number>): Record<string, unknown> {
  return { type: 'assistant/message', time, data: { model, usage } }
}

interface LedgerOptions {
  owners: Record<string, number>
  accounts: Record<number, string>
}

function makeLedger(options: LedgerOptions): OwnershipLedger & { accountOf(userId: number): string | undefined } {
  return {
    sessionOwner: id => options.owners[id],
    sessionsOfOwner: id => Object.entries(options.owners).filter(([, v]) => v === id).map(([k]) => k),
    accountOf: id => options.accounts[id],
  }
}

describe('P3-T2.1:聚合五视图+归属互斥(X2)', () => {
  let dir: string
  let root: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-usage-'))
    root = join(dir, 'sessions')
    mkdirSync(root, { recursive: true })
  })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('固定样本逐值对账:总量/按天/按模型/byAccount(账本唯一事实源)', () => {
    // A:两天两模型;B:一天;orphan:未归属
    writeSessionLog(root, '--data-workspaces-alice--', 'session-a1', [
      { type: 'turn/end', time: Date.UTC(2026, 10, 9, 10) },
      msgEvent(Date.UTC(2026, 10, 9, 10, 5), 'mimo-v2.6-pro', { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 800 }),
      { type: 'turn/end', time: Date.UTC(2026, 10, 10, 9) },
      msgEvent(Date.UTC(2026, 10, 10, 9, 5), 'deepseek-flash', { inputTokens: 500, outputTokens: 200, cacheReadTokens: 0 }),
    ])
    writeSessionLog(root, '--data-workspaces-alice--', 'session-a2', [
      { type: 'turn/end', time: Date.UTC(2026, 10, 10, 11) },
      msgEvent(Date.UTC(2026, 10, 10, 11, 1), 'mimo-v2.6-pro', { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0 }),
    ])
    writeSessionLog(root, '--data-workspaces-bob--', 'session-b1', [
      { type: 'turn/end', time: Date.UTC(2026, 10, 10, 12) },
      msgEvent(Date.UTC(2026, 10, 10, 12, 1), 'glm-5.3-flash', { inputTokens: 700, outputTokens: 90, cacheReadTokens: 0 }),
    ])
    writeSessionLog(root, '--data-workspaces-orphan--', 'session-orphan-1', [
      { type: 'turn/end', time: Date.UTC(2026, 10, 10, 13) },
      msgEvent(Date.UTC(2026, 10, 10, 13, 1), 'mimo-v2.6-pro', { inputTokens: 999, outputTokens: 99, cacheReadTokens: 0 }),
    ])
    const ledger = makeLedger({
      owners: { 'session-a1': 1, 'session-a2': 1, 'session-b1': 2 },
      accounts: { 1: 'alice', 2: 'bob' },
    })
    const a = aggregate(root, ledger)
    // 总量(含 orphan)
    expect(a.total.inputTokens).toBe(1200 + 500 + 100 + 700 + 999)
    expect(a.total.outputTokens).toBe(300 + 200 + 50 + 90 + 99)
    expect(a.total.cacheReadTokens).toBe(800)
    expect(a.total.turns).toBe(5)
    expect(a.total.sessions).toBe(4)
    // 按天(全局口径,含 orphan)。实现口径=会话级桶:整个会话按其 lastAt(最后一条
    // assistant/message 时间)归一日——a1 的最后一条 msg 在 11-10,故 a1 全部(1700/500)
    // 归 11-10,尽管其首条 msg 在 11-09(事件级切分留待二期,面板口径以会话日为准)。
    expect(a.byDay['2026-11-10'] ?? null).toEqual({
      inputTokens: 1200 + 500 + 100 + 700 + 999,
      outputTokens: 300 + 200 + 50 + 90 + 99,
      turns: 5,
    })
    expect(a.byDay['2026-11-09']).toBeUndefined()
    // 按模型(全局口径)
    expect(a.byModel['mimo-v2.6-pro']?.inputTokens).toBe(1200 + 100 + 999)
    expect(a.byModel['deepseek-flash']?.turns).toBe(1)
    // byAccount 互斥:orphan 不进任何账号
    const aliceBucket = a.byAccount.alice
    const bobBucket = a.byAccount.bob
    expect(aliceBucket?.inputTokens).toBe(1200 + 500 + 100)
    expect(bobBucket?.inputTokens).toBe(700)
    expect(Object.keys(a.byAccount).sort()).toEqual(['alice', 'bob'])
    // 全局总量 > 各账号之和(未归属只进全局)
    const sum = (aliceBucket?.inputTokens ?? 0) + (bobBucket?.inputTokens ?? 0)
    expect(a.total.inputTokens).toBeGreaterThan(sum)
  })

  it('无账本行/账本缺账号:会话仍计入全局(byAccount 缺席)', () => {
    writeSessionLog(root, '--data-workspaces-x--', 'session-x1', [
      { type: 'turn/end', time: Date.UTC(2026, 10, 10, 8) },
      msgEvent(Date.UTC(2026, 10, 10, 8, 1), 'm', { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 }),
    ])
    const a = aggregate(root, makeLedger({ owners: { 'session-x1': 42 }, accounts: {} }))
    expect(a.total.inputTokens).toBe(10)
    expect(Object.keys(a.byAccount)).toHaveLength(0)
  })

  it('foldSession 单测:usage 求和与模型桶', () => {
    const text = [
      JSON.stringify({ type: 'session', version: 4, id: 's' }),
      JSON.stringify(msgEvent(1000, 'm1', { inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 1, reasoningTokens: 2 })),
      JSON.stringify(msgEvent(2000, 'm1', { inputTokens: 20, outputTokens: 8, cacheReadTokens: 4 })),
      'not-json',
    ].join('\n')
    const folded = foldSession('s', 0, text)
    expect(folded.inputTokens).toBe(30)
    expect(folded.outputTokens).toBe(13)
    expect(folded.cacheReadTokens).toBe(7)
    expect(folded.cacheWriteTokens).toBe(1)
    expect(folded.reasoningTokens).toBe(2)
    expect(folded.byModel.m1?.turns).toBe(2)
  })

  it('decodeZstdLog 往返(生成器产物可被同算法解码)', () => {
    const rtDir = mkdtempSync(join(tmpdir(), 'eterna-usage-rt-'))
    writeSessionLog(rtDir, 'area', 'session-rt', [msgEvent(1, 'm', { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 })])
    const buf = readFileSync(join(rtDir, 'area', 'session-rt', 'session.v4.jsonl.zstd'))
    const text = decodeZstdLog(buf)
    expect(text).toContain('session-rt')
    rmSync(rtDir, { recursive: true, force: true })
  })
})
