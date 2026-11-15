/**
 * T13 指标聚合(metrics.ts,19 号 §5-T13/§9-6):
 * - buildMemoryMetrics:配对口径(引入行→裁决行)、空语义(null≠0)、域解析分布、
 *   indexZones 透传;
 * - computeIndexZoneTokens:只读打开(不改写库内容)、三区形态/单区缺席;
 * - 账本新事件(domain-resolve/correction)往返与 facade metrics() 组装。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildMemoryMetrics, computeIndexZoneTokens, createMemory, DomainRegistryStore,
  EntityMemoryStore, MemoryAuditLedger, readMemoryAuditEvents,
} from '../src/index.ts'
import type { MemoryAuditEvent } from '../src/index.ts'

const T0 = 1_793_760_000_000
const iso = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString()

/** 手工事件行(字段取各自载荷的最小合法形态;time 由 kind 包装)。 */
function event(kind: 'proposal' | 'dream', pendingIds: number[], offsetMs: number): MemoryAuditEvent {
  return {
    kind,
    time: iso(offsetMs),
    ...(kind === 'proposal'
      ? { sessionId: 's-a', turn: 1, source: 'consolidation', add: pendingIds.length, update: 0, noop: 0, forgotten: 0, superseded: 0, skipped: 0, skipReasons: [], pending: pendingIds.map(id => ({ id, subject: 'user', key: `k-${id}`, summary: '' })) }
      : { runAt: T0 + offsetMs, promotions: pendingIds.length, preferences: 0, retractions: 0, conflictFlags: 0, expired: 0, evicted: 0, portraitRegenerated: false, llmCalls: 0, skipped: 0, skipReasons: [], pending: pendingIds.map(id => ({ id, subject: 'user', key: `k-${id}`, summary: '' })) }),
  } as MemoryAuditEvent
}

describe('buildMemoryMetrics(纯聚合)', () => {
  it('采纳率与响应时长:proposal/dream 引入行与 review 行按 id 配对', () => {
    const events: readonly MemoryAuditEvent[] = [
      event('proposal', [7], 0),
      { kind: 'review', time: iso(90_000), id: 7, decision: 'approved', subject: 'user', key: 'k-7' },
      event('dream', [9], 10_000),
      { kind: 'review', time: iso(40_000), id: 9, decision: 'rejected', subject: 'user', key: 'k-9' },
    ]
    const report = buildMemoryMetrics(events, { portraitEntries: 4 })
    expect(report.reviews).toEqual({ approved: 1, rejected: 1, acceptanceRate: 0.5 })
    // 时长:proposal(+0)→+90s;dream(+10s)→+30s;升序 [30s, 90s] → 中位 = (30+90)/2
    expect(report.reviewLatencyMs).toEqual({ count: 2, medianMs: 60_000, maxMs: 90_000 })
  })

  it('空语义:零裁决采纳率 null;画像分母 0 纠正率 null(即便有纠正动作);未配对裁决照进采纳率但不进时长', () => {
    const events: readonly MemoryAuditEvent[] = [
      { kind: 'review', time: iso(0), id: 999, decision: 'approved', subject: 'user', key: 'ghost' },
      { kind: 'correction', time: iso(1_000), section: '风格偏好', keyHint: 'prefers-concise' },
    ]
    const report = buildMemoryMetrics(events, { portraitEntries: 0 })
    // 未配对裁决(账本缺引入行)仍是真实裁决:采纳率照算;时长无分母不计
    expect(report.reviews.acceptanceRate).toBe(1)
    expect(report.reviewLatencyMs).toEqual({ count: 0, medianMs: null, maxMs: null })
    expect(report.corrections).toEqual({ count: 1, portraitEntries: 0, correctionRate: null })
  })

  it('域解析分布:按 source/bound 计数(total 含 none/candidate)', () => {
    const resolves: readonly MemoryAuditEvent[] = [
      { kind: 'domain-resolve', time: iso(0), sessionId: 's1', domainKey: 'deploy', source: 'merged', bound: true, counted: true },
      { kind: 'domain-resolve', time: iso(1), sessionId: 's2', domainKey: 'ws-9f2a1b', source: 'workspace', bound: true, counted: false },
      { kind: 'domain-resolve', time: iso(2), sessionId: 's3', domainKey: 'new-thing', source: 'candidate', bound: false, counted: true },
      { kind: 'domain-resolve', time: iso(3), sessionId: 's4', domainKey: null, source: 'none', bound: false, counted: false },
    ]
    const report = buildMemoryMetrics(resolves, { portraitEntries: 0 })
    expect(report.domainResolves).toEqual({ total: 4, bound: 2, workspace: 1, merged: 1, promoted: 0, candidate: 1, none: 1 })
  })

  it('indexZones 透传(缺席时字段不出现)', () => {
    const withZones = buildMemoryMetrics([], { portraitEntries: 0, indexZones: { portrait: 10, domain: 20, fallback: 5, total: 35 } })
    expect(withZones.indexZones).toEqual({ portrait: 10, domain: 20, fallback: 5, total: 35 })
    const without = buildMemoryMetrics([], { portraitEntries: 0 })
    expect(without.indexZones).toBeUndefined()
  })
})

describe('computeIndexZoneTokens(只读现算)', () => {
  let dir = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-memory-metrics-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('三区形态:画像+域区+兜底各有 token,合计=三区之和;且**不改写库内容**(只读防线)', () => {
    const dbPath = join(dir, 'memory.sqlite3')
    const entities = new EntityMemoryStore(dbPath, { now: () => T0 })
    const domains = new DomainRegistryStore(dbPath, { now: () => T0 })
    try {
      domains.ensureWorkspaceDomain('deploy', '部署')
      entities.write({ subject: 'user', key: 'prefers-concise', content: '偏好简洁回复', kind: 'semantic', scope: 'user', source: 'explicit' })
      entities.write({ subject: 'domain:deploy', key: 'blue-green', content: '部署用蓝绿发布', kind: 'semantic', scope: 'domain', domainKey: 'deploy', source: 'agent' })
    } finally {
      entities.close()
      domains.close()
    }
    writeFileSync(join(dir, 'portrait.md'), '---\nversion: 1\n---\n## 风格偏好\n- prefers-concise — 偏好简洁回复\n', 'utf8')
    const before = readFileSync(dbPath)

    const zones = computeIndexZoneTokens(dbPath, { now: () => T0 })
    expect(zones).not.toBeNull()
    expect(zones?.portrait).toBeGreaterThan(0)
    expect(zones?.domain).toBeGreaterThan(0)
    // 只读防线:指标现算不得改写库文件(曾因经 EntityMemoryStore 打开触发迁移写)
    expect(readFileSync(dbPath).equals(before)).toBe(true)
  })

  it('单区形态(无已转正域且无画像)→ null;库缺席 → null', () => {
    const dbPath = join(dir, 'memory.sqlite3')
    const entities = new EntityMemoryStore(dbPath, { now: () => T0 })
    try {
      entities.write({ subject: 'user', key: 'solo', content: '唯一一条 user 记忆', kind: 'semantic', scope: 'user', source: 'explicit' })
    } finally {
      entities.close()
    }
    expect(computeIndexZoneTokens(dbPath, { now: () => T0 })).toBeNull()
    expect(computeIndexZoneTokens(join(dir, 'absent.sqlite3'))).toBeNull()
  })
})

describe('T13 账本事件与 facade 组装', () => {
  let dir = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-memory-metrics-audit-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('recordDomainResolve/recordCorrection 往返:同路径新实例可读(readMemoryAuditEvents)', () => {
    const path = join(dir, 'memory-audit.jsonl')
    const ledger = new MemoryAuditLedger({ path, now: () => T0 })
    ledger.recordDomainResolve({ sessionId: 's-a', domainKey: 'deploy', source: 'merged', bound: true, counted: true })
    ledger.recordCorrection({ section: '协作要求', keyHint: 'weekly-report-language' })
    const events = readMemoryAuditEvents(path)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ kind: 'domain-resolve', sessionId: 's-a', domainKey: 'deploy', bound: true })
    expect(events[1]).toMatchObject({ kind: 'correction', section: '协作要求' })
  })

  it('facade metrics():注入账本同源;portraitEntries=user 层 approved semantic live 行数', () => {
    const dbPath = join(dir, 'memory.sqlite3')
    const ledger = new MemoryAuditLedger({ path: join(dir, 'memory-audit.jsonl'), now: () => T0 })
    const memory = createMemory({
      workspaceDir: join(dir, 'NOTES'),
      dbPath,
      audit: ledger,
      now: () => T0,
    })
    try {
      memory.writeEntity({ subject: 'user', key: 'prefers-concise', content: '偏好简洁回复', kind: 'semantic', scope: 'user', source: 'explicit' })
      memory.writeEntity({ subject: 'user', key: 'draft-note', content: '待审不进画像', kind: 'semantic', scope: 'user', source: 'agent' })
      memory.recordCorrection({ section: '风格偏好', keyHint: 'prefers-concise' })
      const report = memory.metrics()
      expect(report.corrections).toEqual({ count: 1, portraitEntries: 1, correctionRate: 1 })
      expect(report.reviews).toEqual({ approved: 0, rejected: 0, acceptanceRate: null })
      // 单区形态(无域无画像文件):分区缺席
      expect(report.indexZones).toBeUndefined()
    } finally {
      memory.dispose()
    }
  })
})
