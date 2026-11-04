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
  workspace = mkdtempSync(join(tmpdir(), 'basis-panel-snapshot-'))
  dshHome = mkdtempSync(join(tmpdir(), 'basis-panel-home-'))
  mkdirSync(join(workspace, '.basis'), { recursive: true })

  // governance:规则文件(服务未挂载时走文件解析)
  writeFileSync(
    join(workspace, '.basis', 'governance.rules.yml'),
    ['rules:', '  - id: allow-read', '    effect: allow', '    tools: ["*_search"]', '  - id: deny-transfer', '    effect: deny', '    tools: ["transfer_money"]'].join('\n'),
    'utf8',
  )
  // 审计:两行 JSONL
  writeFileSync(
    join(workspace, '.basis', 'audit.jsonl'),
    '{"kind":"governance","at":"2026-11-04T00:00:00Z"}\n{"kind":"governance","at":"2026-11-04T00:01:00Z"}\n',
    'utf8',
  )

  // memory:memory_entity 两行(一行已失效)
  const memory = new DatabaseSync(join(workspace, '.basis', 'memory.sqlite3'))
  memory.exec(`CREATE TABLE memory_entity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT NOT NULL, key TEXT NOT NULL, content TEXT NOT NULL, summary TEXT,
    valid_at INTEGER NOT NULL, invalid_at INTEGER, confidence REAL NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
  memory.prepare('INSERT INTO memory_entity (subject, key, content, valid_at, invalid_at, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('user:me', 'meeting-preference', '用户偏好周五下午开会', 1, null, 0.8, 100, 200)
  memory.prepare('INSERT INTO memory_entity (subject, key, content, valid_at, invalid_at, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('project:demo', 'meeting', '周五下午例会', 1, 300, 0.8, 100, 400)
  memory.close()

  // knowledge:pages 一行 + proposals 两行
  const knowledge = new DatabaseSync(join(workspace, '.basis', 'knowledge.sqlite3'))
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
    expect(snapshot.governance.auditSource).toBe(join(workspace, '.basis', 'audit.jsonl'))
  })

  it('memory 只计有效实体并按 updated_at 取最近 key', () => {
    const snapshot = buildSnapshot(fakeContext() as never, workspace, join(dshHome, 'sessions'))
    expect(snapshot.memory.available).toBe(true)
    expect(snapshot.memory.entityCount).toBe(1)
    expect(snapshot.memory.totalRows).toBe(2)
    expect(snapshot.memory.recentKeys).toHaveLength(2)
    expect(snapshot.memory.recentKeys[0]?.key).toBe('meeting')
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
    const empty = mkdtempSync(join(tmpdir(), 'basis-panel-empty-'))
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
})
