/**
 * 全局蒸馏 Phase A(distill.ts;M-M4,18 号 §8)单测:
 * - 授权链:resolveDistillGate(根 overrides 覆写 profile 基线,双缺省 false,Q4);
 * - PII 掩码:命中区间替换(掩码不拒绝),多命中取并集;
 * - 参与 opt-out:accountParticipatesInDistill(缺省 true,损坏 fail-open);
 * - 只读快照:approved/未失效过滤 + last_used_at 降序截断 + 坏库 fail-open;
 * - 聚合报告:≥K 独立账号才列簇、样本不足如实标注、opt-out 计数、坏库账号隔离;
 * - 产物落盘:三件(latest 原子写 / runs.jsonl 追加 / UTC 日期报告)+ 防御读;
 * - 调度执行体:门关 nothing-to-save 不落盘;abort 不落盘。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  DEFAULT_DISTILL_MIN_USERS, DISTILL_MAX_ENTRIES_PER_ACCOUNT, DISTILL_REPORT_SCHEMA,
  accountParticipatesInDistill, aggregateDistillReport, createDistillTask, distillMaskText,
  readApprovedEntitiesForDistill, readLatestDistillReport, resolveDistillGate, writeDistillReport,
} from '../src/distill.ts'

let root = ''

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'eterna-memory-distill-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

/** 单条种子行(只含快照 SELECT 消费的列)。 */
interface SeedRow {
  readonly content: string
  readonly kind?: string
  readonly domainKey?: string | null
  readonly reviewState?: string
  readonly invalidAt?: number | null
  readonly lastUsedAt?: number
}

/** 造一个账号目录 + 最小 memory_entity 表(只含快照 SELECT 消费的列)。 */
function seedAccount(
  name: string,
  rows: readonly SeedRow[],
  options: { overrides?: Record<string, unknown>; corrupt?: boolean } = {},
): string {
  const dir = join(root, name)
  mkdirSync(join(dir, '.eterna'), { recursive: true })
  if (options.corrupt) {
    writeFileSync(join(dir, '.eterna', 'memory.sqlite3'), 'not-a-sqlite-file')
  } else {
    const db = new DatabaseSync(join(dir, '.eterna', 'memory.sqlite3'))
    db.exec(`
      CREATE TABLE memory_entity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        kind TEXT,
        domain_key TEXT,
        review_state TEXT NOT NULL DEFAULT 'pending',
        invalid_at REAL,
        last_used_at REAL
      );
    `)
    for (const row of rows) {
      db.prepare('INSERT INTO memory_entity (content, kind, domain_key, review_state, invalid_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(row.content, row.kind ?? null, row.domainKey ?? null, row.reviewState ?? 'approved', row.invalidAt ?? null, row.lastUsedAt ?? null)
    }
    db.close()
  }
  if (options.overrides !== undefined) {
    writeFileSync(join(dir, '.eterna', 'memory.config.json'), JSON.stringify(options.overrides))
  }
  return dir
}

const SHARED = '每周五下午三点开站会同步项目进度'

describe('授权链(Q4:默认关,overrides 热改键覆写基线)', () => {
  it('resolveDistillGate:双缺省 false;config 基线;overrides 覆写 config', () => {
    expect(resolveDistillGate(undefined, {})).toBe(false)
    expect(resolveDistillGate(false, {})).toBe(false)
    expect(resolveDistillGate(true, {})).toBe(true)
    expect(resolveDistillGate(false, { distillEnabled: true })).toBe(true)
    expect(resolveDistillGate(true, { distillEnabled: false })).toBe(false)
  })

  it('DEFAULT_DISTILL_MIN_USERS = 5(18 §8/Gm2-global 建议值)', () => {
    expect(DEFAULT_DISTILL_MIN_USERS).toBe(5)
  })
})

describe('PII 掩码(掩码而非拒绝)', () => {
  it('手机号/邮箱替换为占位符;干净文本原样', () => {
    const masked = distillMaskText('联系 13800138000 或 ops@example.com 推进')
    expect(masked).not.toContain('13800138000')
    expect(masked).not.toContain('ops@example.com')
    expect(masked).toContain('[脱敏:')
    expect(distillMaskText('每周五开站会')).toBe('每周五开站会')
  })

  it('同段多模式命中取并集不重复掩码', () => {
    const masked = distillMaskText('13800138000')
    expect(masked.match(/\[脱敏:/gu)).toHaveLength(1)
  })
})

describe('参与 opt-out(缺省 true=默认参与可退出)', () => {
  it('overrides 缺席/损坏 → 参与(fail-open);distillParticipate:false → 退出', () => {
    const dir = seedAccount('optout-default', [])
    expect(accountParticipatesInDistill(dir)).toBe(true)
    writeFileSync(join(dir, '.eterna', 'memory.config.json'), '{broken json')
    expect(accountParticipatesInDistill(dir)).toBe(true)
    const out = seedAccount('optout-off', [], { overrides: { distillParticipate: false } })
    expect(accountParticipatesInDistill(out)).toBe(false)
  })
})

describe('单账号只读快照(approved 且未失效;last_used_at 降序截断)', () => {
  it('pending/invalidated 条目不入快照;坏库 fail-open 空表', () => {
    const dir = seedAccount('snapshot-a', [
      { content: '有效记忆一', lastUsedAt: 10 },
      { content: '待审记忆', reviewState: 'pending', lastUsedAt: 20 },
      { content: '已失效记忆', invalidAt: 5, lastUsedAt: 30 },
      { content: '有效记忆二', lastUsedAt: 40 },
    ])
    const rows = readApprovedEntitiesForDistill(dir)
    expect(rows.map(row => row.content)).toEqual(['有效记忆二', '有效记忆一'])
    const corrupt = seedAccount('snapshot-corrupt', [], { corrupt: true })
    expect(readApprovedEntitiesForDistill(corrupt)).toEqual([])
    expect(readApprovedEntitiesForDistill(join(root, 'no-such-account'))).toEqual([])
  })

  it('超过上限按 last_used_at 降序截断(新近记忆优先)', () => {
    const rows = Array.from({ length: DISTILL_MAX_ENTRIES_PER_ACCOUNT + 10 }, (_, index) => ({
      content: `条目 ${index}`,
      lastUsedAt: index,
    }))
    const dir = seedAccount('snapshot-limit', rows)
    expect(readApprovedEntitiesForDistill(dir)).toHaveLength(DISTILL_MAX_ENTRIES_PER_ACCOUNT)
    expect(readApprovedEntitiesForDistill(dir)[0]?.content).toBe(`条目 ${DISTILL_MAX_ENTRIES_PER_ACCOUNT + 9}`)
  })
})

describe('聚合报告(≥K 独立账号;样本不足;opt-out;坏库隔离)', () => {
  it('三账号共享模式 + K=3 → 列簇(计数/掩码/分布);独有内容不成簇', () => {
    seedAccount('agg-a', [{ content: SHARED, kind: 'semantic', domainKey: 'standup' }])
    seedAccount('agg-b', [{ content: `${SHARED}(提前五分钟)`, kind: 'semantic', domainKey: 'standup' }])
    seedAccount('agg-c', [{ content: `${SHARED},线上会议链接见群公告`, kind: 'procedural', domainKey: null }])
    const report = aggregateDistillReport({
      accounts: [
        { account: 'agg-a', dir: join(root, 'agg-a') },
        { account: 'agg-b', dir: join(root, 'agg-b') },
        { account: 'agg-c', dir: join(root, 'agg-c') },
      ],
      minUsers: 3,
      windowStart: 0,
      now: 1,
    })
    expect(report.totals).toEqual({ accounts: 3, participating: 3, optedOut: 0, entities: 3 })
    expect(report.sampleSufficient).toBe(true)
    expect(report.clusters).toHaveLength(1)
    const cluster = report.clusters[0]
    expect(cluster?.userCount).toBe(3)
    expect(cluster?.entriesCount).toBe(3)
    expect(cluster?.accounts).toEqual(['agg-a', 'agg-b', 'agg-c'])
    expect(cluster?.kindCounts).toEqual({ procedural: 1, semantic: 2 })
    expect(cluster?.domainCounts).toEqual({ standup: 2, '(未分域)': 1 })
  })

  it('K=5 而参与仅 3 → sampleSufficient=false 且无达标簇(冷启动如实标注)', () => {
    const report = aggregateDistillReport({
      accounts: [
        { account: 'agg-a', dir: join(root, 'agg-a') },
        { account: 'agg-b', dir: join(root, 'agg-b') },
        { account: 'agg-c', dir: join(root, 'agg-c') },
      ],
      windowStart: 0,
      now: 1,
    })
    expect(report.sampleSufficient).toBe(false)
    expect(report.clusters).toHaveLength(0)
  })

  it('opt-out 账号跳过计数不参与聚类(退出即不聚合)', () => {
    seedAccount('agg-optout', [{ content: SHARED }], { overrides: { distillParticipate: false } })
    const report = aggregateDistillReport({
      accounts: [{ account: 'agg-optout', dir: join(root, 'agg-optout') }],
      minUsers: 1,
      windowStart: 0,
      now: 1,
    })
    expect(report.totals.optedOut).toBe(1)
    expect(report.totals.participating).toBe(0)
    expect(report.clusters).toHaveLength(0)
  })

  it('坏库账号不炸聚合(errors 之外按零条目参与)', () => {
    seedAccount('agg-corrupt', [], { corrupt: true })
    seedAccount('agg-good', [{ content: '独特记忆内容' }])
    const report = aggregateDistillReport({
      accounts: [
        { account: 'agg-corrupt', dir: join(root, 'agg-corrupt') },
        { account: 'agg-good', dir: join(root, 'agg-good') },
      ],
      minUsers: 1,
      windowStart: 0,
      now: 1,
    })
    expect(report.totals.participating).toBe(2)
    expect(report.totals.entities).toBe(1)
  })
})

describe('产物落盘(latest 原子写 / runs 追加 / UTC 日期报告;防御读)', () => {
  it('写三件 → readLatestDistillReport 往返;坏文件/异 schema → null', () => {
    const out = join(root, 'artifacts')
    const report = aggregateDistillReport({
      accounts: [{ account: 'agg-a', dir: join(root, 'agg-a') }],
      minUsers: 1,
      windowStart: 7,
      now: 1_793_760_000_000,
    })
    writeDistillReport(out, report)
    expect(existsSync(join(out, 'latest.json'))).toBe(true)
    expect(existsSync(join(out, `report-${new Date(1_793_760_000_000).toISOString().slice(0, 10)}.json`))).toBe(true)
    const runs = readFileSync(join(out, 'runs.jsonl'), 'utf8').trim().split('\n')
    expect(runs).toHaveLength(1)
    expect(JSON.parse(runs[0] ?? '{}')).toMatchObject({ kind: 'phase-a' })
    const latest = readLatestDistillReport(out)
    expect(latest?.schema).toBe(DISTILL_REPORT_SCHEMA)
    expect(latest?.windowStart).toBe(7)
    expect(latest?.generatedAt).toBe(1_793_760_000_000)
    // 防御读:损坏 JSON / 异 schema / 缺 clusters 一律 null。
    writeFileSync(join(out, 'latest.json'), '{broken')
    expect(readLatestDistillReport(out)).toBeNull()
    writeFileSync(join(out, 'latest.json'), JSON.stringify({ schema: 'other/1', generatedAt: 1, clusters: [] }))
    expect(readLatestDistillReport(out)).toBeNull()
    writeFileSync(join(out, 'latest.json'), JSON.stringify({ schema: DISTILL_REPORT_SCHEMA, generatedAt: 'x', clusters: [] }))
    expect(readLatestDistillReport(out)).toBeNull()
  })

  it('tmp+rename 原子写:同目录不留 .tmp 残留', () => {
    const out = join(root, 'artifacts')
    const report = aggregateDistillReport({ accounts: [], minUsers: 1, windowStart: 0, now: 2 })
    writeDistillReport(out, report)
    const leftovers = readdirSync(out).filter(name => name.endsWith('.tmp'))
    expect(leftovers).toEqual([])
  })
})

describe('调度执行体(SessionEndConsolidator 的 distillTask seam)', () => {
  it('门关 → nothing-to-save 且不落盘(游标推进语义由调度器负责)', async () => {
    const out = join(root, 'task-gate-off')
    const task = createDistillTask({
      accounts: () => [],
      enabled: () => false,
      outputDir: out,
      minUsers: 1,
    })
    const result = await task({ jobKind: 'distill', sessionId: 'distill', logPath: null, lastTurn: 0, endedAt: 1, windowStart: 0, facts: { memoryWriteCalls: 0, maxUserProseWords: 0, approvalAsks: 0 } }, new AbortController().signal)
    expect(result.kind).toBe('nothing-to-save')
    expect(existsSync(out)).toBe(false)
  })

  it('abort → 不写产物;门开 → 落盘且按簇数定 ran/nothing-to-save', async () => {
    const out = join(root, 'task-run')
    const accounts = [{ account: 'agg-a', dir: join(root, 'agg-a') }]
    const task = createDistillTask({ accounts: () => accounts, enabled: () => true, outputDir: out, minUsers: 1 })
    const controller = new AbortController()
    controller.abort()
    const aborted = await task({ jobKind: 'distill', sessionId: 'distill', logPath: null, lastTurn: 0, endedAt: 1, windowStart: 0, facts: { memoryWriteCalls: 0, maxUserProseWords: 0, approvalAsks: 0 } }, controller.signal)
    expect(aborted.kind).toBe('nothing-to-save')
    expect(existsSync(out)).toBe(false)
    // agg-a 持有共享模式(前置 describe 播种),minUsers:1 → 1 簇 → ran。
    const result = await task({ jobKind: 'distill', sessionId: 'distill', logPath: null, lastTurn: 0, endedAt: 1, windowStart: 0, facts: { memoryWriteCalls: 0, maxUserProseWords: 0, approvalAsks: 0 } }, new AbortController().signal)
    expect(result.kind).toBe('ran')
    expect(readLatestDistillReport(out)?.totals.participating).toBe(1)
  })
})
