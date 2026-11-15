/**
 * 快照组装测试:临时工作区(governance 规则文件/审计 JSONL/memory 与 knowledge
 * sqlite/伪 tools 注册表/伪 session 日志)上钉住各区块字段口径。
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildSnapshot, riskOfTool } from '../src/snapshot.ts'

let workspace = ''
let dshHome = ''

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'eterna-panel-snapshot-'))
  dshHome = mkdtempSync(join(tmpdir(), 'eterna-panel-home-'))
  mkdirSync(join(workspace, '.eterna'), { recursive: true })

  // governance:规则文件(服务未挂载时走文件解析)
  writeFileSync(
    join(workspace, '.eterna', 'governance.rules.yml'),
    ['rules:', '  - id: allow-read', '    effect: allow', '    tools: ["*_search"]', '  - id: deny-transfer', '    effect: deny', '    tools: ["transfer_money"]'].join('\n'),
    'utf8',
  )
  // 审计:两行 JSONL
  writeFileSync(
    join(workspace, '.eterna', 'audit.jsonl'),
    '{"kind":"governance","at":"2026-11-04T00:00:00Z"}\n{"kind":"governance","at":"2026-11-04T00:01:00Z"}\n',
    'utf8',
  )

  // memory:memory_entity 三行(一行已失效;一行待审——T9 审批队列)
  const memory = new DatabaseSync(join(workspace, '.eterna', 'memory.sqlite3'))
  memory.exec(`CREATE TABLE memory_entity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT NOT NULL, key TEXT NOT NULL, content TEXT NOT NULL, summary TEXT,
    valid_at INTEGER NOT NULL, invalid_at INTEGER, confidence REAL NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'semantic', scope TEXT NOT NULL DEFAULT 'domain',
    domain_key TEXT, review_state TEXT NOT NULL DEFAULT 'approved',
    origin_session_id TEXT, origin_turn_ref TEXT, source TEXT NOT NULL DEFAULT 'agent',
    last_used_at INTEGER, use_count INTEGER NOT NULL DEFAULT 0)`)
  memory.prepare('INSERT INTO memory_entity (subject, key, content, valid_at, invalid_at, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('user:me', 'meeting-preference', '用户偏好周五下午开会', 1, null, 0.8, 100, 200)
  memory.prepare('INSERT INTO memory_entity (subject, key, content, valid_at, invalid_at, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('project:demo', 'meeting', '周五下午例会', 1, 300, 0.8, 100, 400)
  // 待审行(整固提案,user+semantic → pending):不计入有效实体,进审批队列
  memory.prepare(`INSERT INTO memory_entity
    (subject, key, content, summary, valid_at, invalid_at, confidence, created_at, updated_at,
     review_state, origin_session_id, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('user', 'weekly-report-language', '周报用中文。', '周报用中文', 500, null, 0.9, 500, 500, 'pending', 'session-a', 'consolidation')
  // 域浏览(M-M3 T12-②):domain_registry 两行(一转正/一候选)+ deploy 域一条待审
  memory.exec(`CREATE TABLE domain_registry (
    domain_key TEXT PRIMARY KEY, label TEXT NOT NULL, source TEXT NOT NULL,
    hit_sessions INTEGER NOT NULL DEFAULT 0, registered INTEGER,
    session_count INTEGER NOT NULL DEFAULT 0, memory_count INTEGER NOT NULL DEFAULT 0,
    last_used_at INTEGER, created_at INTEGER NOT NULL)`)
  memory.prepare('INSERT INTO domain_registry (domain_key, label, source, registered, session_count, memory_count, last_used_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('deploy', '部署', 'workspace', 700, 2, 3, 900, 100)
  memory.prepare('INSERT INTO domain_registry (domain_key, label, source, registered, session_count, memory_count, last_used_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('contract-review', '合同审查', 'free', null, 1, 1, 800, 200)
  memory.prepare(`INSERT INTO memory_entity
    (subject, key, content, summary, valid_at, invalid_at, confidence, created_at, updated_at,
     review_state, domain_key, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('domain:deploy', 'deploy-pending', '部署域待审记忆', '部署待审', 600, null, 0.9, 600, 600, 'pending', 'deploy', 'consolidation')
  memory.close()

  // 画像卡数据面(M-M3 T12-②):portrait.md(与 sqlite 同目录;buildPortrait 产出形态)
  writeFileSync(
    join(workspace, '.eterna', 'portrait.md'),
    [
      '---', 'version: 3', 'generated_at: 2026-11-13T04:00:00.000Z', 'source_memory_ids: [1]', '---',
      '',
      '## 工作习惯',
      '- weekly-meeting — 用户偏好周五下午开会',
      '',
      '## 风格偏好',
      '(暂无)',
    ].join('\n'),
    'utf8',
  )

  // knowledge:pages 一行 + proposals 两行
  const knowledge = new DatabaseSync(join(workspace, '.eterna', 'knowledge.sqlite3'))
  knowledge.exec('CREATE TABLE pages (doc_id TEXT PRIMARY KEY)')
  knowledge.exec('CREATE TABLE proposals (id TEXT PRIMARY KEY)')
  knowledge.prepare('INSERT INTO pages VALUES (?)').run('doc-1')
  knowledge.prepare('INSERT INTO proposals VALUES (?)').run('p-1')
  knowledge.prepare('INSERT INTO proposals VALUES (?)').run('p-2')
  knowledge.close()
})

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true })
  rmSync(dshHome, { recursive: true, force: true })
})

/** 伪 ctx:governance 服务缺席、tools 注册表给 @event 全集。 */
function fakeContext(): { get(name: string): unknown } {
  return {
    get(name: string): unknown {
      if (name === 'tools') {
        return {
          definitions: () => [
            { name: 'bash', description: 'shell' },
            { name: 'budget_calc', description: '预算计算\n第二行' },
            { name: 'pay_deposit', description: '起草付款申请' },
            { name: 'transfer_money', description: '转账' },
            { name: 'send_email', description: '发邮件' },
            { name: 'template_search', description: '模板检索' },
          ],
        }
      }
      return undefined
    },
  }
}

describe('riskOfTool(hitl.yaml 口径)', () => {
  it('资金/法务/定标/预算变更为 R3', () => {
    expect(riskOfTool('pay_deposit')).toBe('R3')
    expect(riskOfTool('budget_change')).toBe('R3')
    expect(riskOfTool('transfer_money')).toBe('R3')
    expect(riskOfTool('sign_contract')).toBe('R3')
    expect(riskOfTool('vendor_award')).toBe('R3')
  })
  it('对外发射 R2、草稿 R1、只读/计算 R0', () => {
    expect(riskOfTool('send_email')).toBe('R2')
    expect(riskOfTool('write_plan')).toBe('R1')
    expect(riskOfTool('budget_calc')).toBe('R0')
    expect(riskOfTool('venue_search')).toBe('R0')
    expect(riskOfTool('schedule_conflict_check')).toBe('R0')
  })
})

describe('buildSnapshot', () => {
  it('governance 读规则文件与审计行数(服务缺席回退)', () => {
    const snapshot = buildSnapshot(fakeContext() as never, workspace, join(dshHome, 'sessions'))
    expect(snapshot.governance.mounted).toBe(false)
    expect(snapshot.governance.ruleCount).toBe(2)
    expect(snapshot.governance.auditEntries).toBe(2)
    expect(snapshot.governance.auditSource).toBe(join(workspace, '.eterna', 'audit.jsonl'))
  })

  it('审计读数含按日轮转文件:@eterna/audit 的 audit-YYYYMMDD.jsonl 与旧版单文件合计', () => {
    const rotated = mkdtempSync(join(tmpdir(), 'eterna-panel-audit-daily-'))
    try {
      mkdirSync(join(rotated, '.eterna'), { recursive: true })
      writeFileSync(join(rotated, '.eterna', 'audit-20261106.jsonl'), '{"kind":"tool-call"}\n{"kind":"tool-call"}\n', 'utf8')
      writeFileSync(join(rotated, '.eterna', 'audit-20261107.jsonl'), '{"kind":"tool-call"}\n', 'utf8')
      writeFileSync(join(rotated, '.eterna', 'audit.jsonl'), '{"kind":"governance"}\n', 'utf8')
      writeFileSync(join(rotated, '.eterna', 'unrelated.txt'), 'not audit\n', 'utf8')
      const snapshot = buildSnapshot(fakeContext() as never, rotated, join(dshHome, 'sessions'))
      expect(snapshot.governance.auditEntries).toBe(4)
      expect(snapshot.governance.auditSource).toBe(join(rotated, '.eterna'))
    } finally {
      rmSync(rotated, { recursive: true, force: true })
    }
  })

  it('memory 只计有效实体并按 updated_at 取最近 key;待审行不混入已生效清单(T9)', () => {
    const snapshot = buildSnapshot(fakeContext() as never, workspace, join(dshHome, 'sessions'))
    expect(snapshot.memory.available).toBe(true)
    expect(snapshot.memory.entityCount).toBe(1)
    expect(snapshot.memory.totalRows).toBe(4)
    expect(snapshot.memory.recentKeys).toHaveLength(4)
    expect(snapshot.memory.recentKeys[0]?.key).toBe('deploy-pending')
    // 有效实体清单(review_state='approved')不含待审行
    expect(snapshot.memory.entities.map(entity => entity.key)).toEqual(['meeting-preference'])
  })

  it('memory 审批队列:pendingCount 与 pending 投影(id/来源/出处会话;updated_at 降序)', () => {
    const snapshot = buildSnapshot(fakeContext() as never, workspace, join(dshHome, 'sessions'))
    expect(snapshot.memory.pendingCount).toBe(2)
    expect(snapshot.memory.pending).toHaveLength(2)
    const pending = snapshot.memory.pending[0]
    expect(pending).toMatchObject({
      id: 4,
      subject: 'domain:deploy',
      key: 'deploy-pending',
      content: '部署域待审记忆',
      summary: '部署待审',
      source: 'consolidation',
      updatedAt: 600,
    })
    const pendingUser = snapshot.memory.pending[1]
    expect(pendingUser).toMatchObject({
      id: 3,
      subject: 'user',
      key: 'weekly-report-language',
      content: '周报用中文。',
      summary: '周报用中文',
      source: 'consolidation',
      originSessionId: 'session-a',
      updatedAt: 500,
    })
  })

  it('画像卡数据面:portrait.md 解析(版本/分节/行;文件缺席 available=false)(T12-②)', () => {
    const snapshot = buildSnapshot(fakeContext() as never, workspace, join(dshHome, 'sessions'))
    expect(snapshot.memory.portrait.available).toBe(true)
    expect(snapshot.memory.portrait.version).toBe(3)
    expect(snapshot.memory.portrait.generatedAt).toBe('2026-11-13T04:00:00.000Z')
    expect(snapshot.memory.portrait.sections.map(section => section.title)).toEqual(['工作习惯', '风格偏好'])
    expect(snapshot.memory.portrait.sections[0]?.lines).toEqual(['weekly-meeting — 用户偏好周五下午开会'])
    expect(snapshot.memory.portrait.sections[1]?.lines).toEqual(['(暂无)'])
  })

  it('域浏览:registry 投影(转正/候选)+ 每域待审数;旧库无表 → 空清单(T12-②)', () => {
    const snapshot = buildSnapshot(fakeContext() as never, workspace, join(dshHome, 'sessions'))
    expect(snapshot.memory.domains.map(domain => domain.domainKey)).toEqual(['deploy', 'contract-review'])
    const deploy = snapshot.memory.domains[0]
    expect(deploy).toMatchObject({ label: '部署', source: 'workspace', registered: 700, sessionCount: 2, memoryCount: 3, lastUsedAt: 900, pendingCount: 1 })
    const candidate = snapshot.memory.domains[1]
    expect(candidate?.registered).toBeNull()
    // 旧库无 domain_registry 表:域浏览为空,其余区块不受影响
    const legacy = mkdtempSync(join(tmpdir(), 'eterna-panel-legacy-domains-'))
    try {
      mkdirSync(join(legacy, '.eterna'), { recursive: true })
      const db = new DatabaseSync(join(legacy, '.eterna', 'memory.sqlite3'))
      db.exec('CREATE TABLE memory_entity (id INTEGER PRIMARY KEY, subject TEXT, key TEXT, content TEXT, valid_at INTEGER, invalid_at INTEGER, confidence REAL, created_at INTEGER, updated_at INTEGER)')
      db.close()
      const legacySnapshot = buildSnapshot(fakeContext() as never, legacy, join(dshHome, 'sessions'))
      expect(legacySnapshot.memory.domains).toEqual([])
      expect(legacySnapshot.memory.portrait.available).toBe(false)
    } finally {
      rmSync(legacy, { recursive: true, force: true })
    }
  })

  it('旧库无 review_state 列:审批队列为空且有效实体回落全量(向后兼容)', () => {
    const legacy = mkdtempSync(join(tmpdir(), 'eterna-panel-legacy-memory-'))
    try {
      mkdirSync(join(legacy, '.eterna'), { recursive: true })
      const db = new DatabaseSync(join(legacy, '.eterna', 'memory.sqlite3'))
      db.exec(`CREATE TABLE memory_entity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL, key TEXT NOT NULL, content TEXT NOT NULL, summary TEXT,
        valid_at INTEGER NOT NULL, invalid_at INTEGER, confidence REAL NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
      db.prepare('INSERT INTO memory_entity (subject, key, content, valid_at, invalid_at, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run('user:me', 'legacy-key', '存量记忆正文', 1, null, 0.8, 100, 200)
      db.close()
      const snapshot = buildSnapshot(fakeContext() as never, legacy, join(dshHome, 'sessions'))
      expect(snapshot.memory.available).toBe(true)
      expect(snapshot.memory.pendingCount).toBe(0)
      expect(snapshot.memory.pending).toEqual([])
      expect(snapshot.memory.entities.map(entity => entity.key)).toEqual(['legacy-key'])
    } finally {
      rmSync(legacy, { recursive: true, force: true })
    }
  })

  it('knowledge 计 wiki 文档与提案数,WeKnora 未挂载如实标注', () => {
    const snapshot = buildSnapshot(fakeContext() as never, workspace, join(dshHome, 'sessions'))
    expect(snapshot.knowledge.available).toBe(true)
    expect(snapshot.knowledge.wikiDocCount).toBe(1)
    expect(snapshot.knowledge.proposalCount).toBe(2)
    expect(snapshot.knowledge.weknora.status).toBe('not-mounted')
  })

  it('@event 工具清单来自注册表活数据,带 R3 标记,非 @event 工具不进清单', () => {
    const snapshot = buildSnapshot(fakeContext() as never, workspace, join(dshHome, 'sessions'))
    const names = snapshot.tools.map(tool => tool.name)
    expect(names).toEqual(['budget_calc', 'template_search', 'pay_deposit', 'send_email', 'transfer_money'])
    const pay = snapshot.tools.find(tool => tool.name === 'pay_deposit')
    expect(pay?.r3).toBe(true)
    expect(pay?.risk).toBe('R3')
    expect(snapshot.tools.find(tool => tool.name === 'budget_calc')?.r3).toBe(false)
  })

  it('无会话日志时可观测区块给占位说明', () => {
    const snapshot = buildSnapshot(fakeContext() as never, workspace, join(dshHome, 'sessions'))
    expect(snapshot.observability.sessions).toEqual([])
    expect(snapshot.observability.note).toBeTruthy()
  })

  it('库文件不存在时各区块 available=false 不抛', () => {
    const empty = mkdtempSync(join(tmpdir(), 'eterna-panel-empty-'))
    try {
      const snapshot = buildSnapshot({ get: () => undefined } as never, empty, join(dshHome, 'sessions'))
      expect(snapshot.memory.available).toBe(false)
      expect(snapshot.memory.entityCount).toBe(0)
      expect(snapshot.knowledge.available).toBe(false)
      expect(snapshot.tools).toEqual([])
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it('T13 指标:审计账本聚合进 memory.metrics(采纳率/纠正/域解析/索引分区)', () => {
    writeFileSync(join(workspace, '.eterna', 'memory-audit.jsonl'), [
      JSON.stringify({ kind: 'proposal', time: '2026-11-15T00:00:00.000Z', sessionId: 's-a', turn: 1, source: 'consolidation', add: 1, update: 0, noop: 0, forgotten: 0, superseded: 0, skipped: 0, skipReasons: [], pending: [{ id: 11, subject: 'user', key: 'prefers-concise', summary: '偏好简洁' }] }),
      JSON.stringify({ kind: 'review', time: '2026-11-15T00:02:00.000Z', id: 11, decision: 'approved', subject: 'user', key: 'prefers-concise' }),
      JSON.stringify({ kind: 'correction', time: '2026-11-15T01:00:00.000Z', section: '风格偏好', keyHint: 'prefers-concise' }),
      JSON.stringify({ kind: 'domain-resolve', time: '2026-11-15T02:00:00.000Z', sessionId: 's-b', domainKey: 'deploy', source: 'merged', bound: true, counted: true }),
      '{"kind":"proposal" 坏行应被忽略}',
    ].join('\n'), 'utf8')
    const snapshot = buildSnapshot(fakeContext() as never, workspace, join(dshHome, 'sessions'))
    const metrics = snapshot.memory.metrics
    expect(metrics.reviews).toEqual({ approved: 1, rejected: 0, acceptanceRate: 1 })
    expect(metrics.reviewLatencyMs).toEqual({ count: 1, medianMs: 120_000, maxMs: 120_000 })
    expect(metrics.corrections.count).toBe(1)
    expect(metrics.domainResolves).toEqual({ total: 1, bound: 1, workspace: 0, merged: 1, promoted: 0, candidate: 0, none: 0 })
    // 索引分区:workspace 种子含已转正域 + portrait.md → 三区形态,画像区非零
    expect(metrics.indexZones).not.toBeNull()
    expect(metrics.indexZones?.portrait).toBeGreaterThan(0)
  })
})
