import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EntityMemoryStore } from '../src/index.ts'
import type { EntityKind, EntityReviewState, EntityScope, EntitySource } from '../src/index.ts'

let dir = ''
let store: EntityMemoryStore
let clock = 0

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eterna-memory-entity-'))
  clock = 1_000
  store = new EntityMemoryStore(':memory:', { now: () => clock })
})

afterEach(async () => {
  store.close()
  await rm(dir, { recursive: true, force: true })
})

describe('M2 EntityMemoryStore:写入与读取', () => {
  it('写入后读到 live 行,六列齐备', () => {
    const { record } = store.write({
      subject: 'user:alice',
      key: 'prefers-email-summary',
      content: '周报偏好邮件摘要形式',
      summary: '偏好邮件摘要',
      confidence: 0.9,
    })
    expect(record.subject).toBe('user:alice')
    expect(record.key).toBe('prefers-email-summary')
    expect(record.validAt).toBe(1_000)
    expect(record.invalidAt).toBeNull()
    expect(record.confidence).toBe(0.9)

    const live = store.read('user:alice', 'prefers-email-summary')
    expect(live?.content).toBe('周报偏好邮件摘要形式')
    expect(live?.summary).toBe('偏好邮件摘要')
  })

  it('默认 confidence 0.8;subject/content 去首尾空白', () => {
    const { record } = store.write({ subject: ' project:demo ', key: 'k', content: ' v ' })
    expect(record.confidence).toBe(0.8)
    expect(record.subject).toBe('project:demo')
    expect(record.content).toBe('v')
  })

  it('同键顶替:旧行打 invalid_at,新行 live;历史保留可审计', () => {
    store.write({ subject: 'org:acme', key: 'invoice-rule', content: '旧规则', validAt: 1_000 })
    clock = 2_000
    store.write({ subject: 'org:acme', key: 'invoice-rule', content: '新规则', validAt: 2_000 })

    const history = store.readAll('org:acme', 'invoice-rule')
    expect(history).toHaveLength(2)
    expect(history[0]!.invalidAt).toBe(2_000)
    expect(history[1]!.invalidAt).toBeNull()
    expect(store.read('org:acme', 'invoice-rule')?.content).toBe('新规则')
  })

  it('write 返回的应用逆闭包精确恢复写入前状态(顶替场景)', () => {
    store.write({ subject: 'org:acme', key: 'k', content: 'v1', confidence: 0.9 })
    clock = 2_000
    const second = store.write({ subject: 'org:acme', key: 'k', content: 'v2' })
    expect(second.superseded).toHaveLength(1)
    expect(store.read('org:acme', 'k')?.content).toBe('v2')

    second.undo()
    const restored = store.read('org:acme', 'k')
    expect(restored?.content).toBe('v1')
    expect(restored?.confidence).toBe(0.9)
    expect(restored?.invalidAt).toBeNull()
    expect(store.readAll('org:acme', 'k')).toHaveLength(1)
    expect(store.count()).toBe(1)
  })

  it('undo 幂等;新建场景 undo 后全空', () => {
    const written = store.write({ subject: 'user:bob', key: 'k', content: 'x' })
    written.undo()
    written.undo()
    expect(store.read('user:bob', 'k')).toBeNull()
    expect(store.count()).toBe(0)
  })

  it('入参校验:空字段/key 含空白/confidence 越界均拒绝', () => {
    expect(() => store.write({ subject: ' ', key: 'k', content: 'v' })).toThrow(RangeError)
    expect(() => store.write({ subject: 's', key: '', content: 'v' })).toThrow(RangeError)
    expect(() => store.write({ subject: 's', key: 'has space', content: 'v' })).toThrow(/空白/)
    expect(() => store.write({ subject: 's', key: 'k', content: '' })).toThrow(RangeError)
    expect(() => store.write({ subject: 's', key: 'k', content: 'v', confidence: 1.5 })).toThrow(/confidence/)
    expect(() => store.write({ subject: 's', key: 'k', content: 'v', confidence: Number.NaN })).toThrow(/confidence/)
  })

  it('subject 超长拒绝(≤256)', () => {
    expect(() => store.write({ subject: 'x'.repeat(257), key: 'k', content: 'v' })).toThrow(/超长/)
  })
})

describe('M2 EntityMemoryStore:检索', () => {
  beforeEach(() => {
    store.write({ subject: 'user:alice', key: 'prefers-email-summary', content: '周报偏好邮件摘要', summary: '邮件摘要', confidence: 0.6 })
    store.write({ subject: 'org:acme', key: 'meeting-cadence', content: '双周例会固定周一上午', summary: '双周例会', confidence: 0.95 })
    store.write({ subject: 'user:alice', key: 'timezone', content: '常驻上海时区', confidence: 0.8 })
  })

  it('多词 AND 命中 key/content/summary/subject 任意字段', () => {
    const hits = store.search('alice 周报')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.record.key).toBe('prefers-email-summary')
    expect(hits[0]!.matchedIn).toContain('subject')
    expect(hits[0]!.matchedIn).toContain('content')
  })

  it('排序:confidence DESC 优先', () => {
    const hits = store.search('alice')
    expect(hits.map(hit => hit.record.key)).toEqual(['timezone', 'prefers-email-summary'])
  })

  it('subject 过滤限定主体', () => {
    const hits = store.search('摘要', { subject: 'user:alice' })
    expect(hits.every(hit => hit.record.subject === 'user:alice')).toBe(true)
  })

  it('limit 截断;空查询返回空;只检索 live 行', () => {
    clock = 9_000
    store.write({ subject: 'org:acme', key: 'meeting-cadence', content: '改为单周例会' })
    const hits = store.search('例会')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.record.content).toBe('改为单周例会')
    expect(store.search('  ')).toHaveLength(0)
    expect(store.search('例会', { limit: 0 })).toHaveLength(0)
  })

  it('listLive:全量与按主体,排序 confidence DESC', () => {
    const all = store.listLive()
    expect(all).toHaveLength(3)
    expect(all[0]!.key).toBe('meeting-cadence')
    expect(store.listLive('user:alice')).toHaveLength(2)
  })
})

describe('M2 EntityMemoryStore:遗忘 = 真删', () => {
  it('forget 物理 DELETE 全部行(live+历史),检索不可再得', () => {
    store.write({ subject: 'user:alice', key: 'k', content: 'v1', validAt: 1_000 })
    clock = 2_000
    store.write({ subject: 'user:alice', key: 'k', content: 'v2' })
    expect(store.count()).toBe(2)

    const { forgotten, records } = store.forget('user:alice', 'k')
    expect(forgotten).toBe(2)
    expect(records).toHaveLength(2)
    expect(store.count()).toBe(0)
    expect(store.read('user:alice', 'k')).toBeNull()
    expect(store.readAll('user:alice', 'k')).toHaveLength(0)
    expect(store.search('v1')).toHaveLength(0)
  })

  it('forget 不存在的键:forgotten 0', () => {
    expect(store.forget('user:nobody', 'k').forgotten).toBe(0)
  })

  it('forget 只影响目标 (subject,key)', () => {
    store.write({ subject: 'user:alice', key: 'a', content: 'va' })
    store.write({ subject: 'user:alice', key: 'b', content: 'vb' })
    store.forget('user:alice', 'a')
    expect(store.read('user:alice', 'b')?.content).toBe('vb')
    expect(store.count()).toBe(1)
  })
})

describe('M2 EntityMemoryStore:生命周期', () => {
  it('close 幂等;关闭后操作拒绝', () => {
    store.close()
    store.close()
    expect(() => store.read('s', 'k')).toThrow(/已关闭/)
  })

  it('文件库跨实例持久化(同一 dbPath 重开可见)', async () => {
    const fileStore = new EntityMemoryStore(join(dir, 'entity.db'))
    fileStore.write({ subject: 'project:demo', key: 'venue', content: '科技园报告厅' })
    fileStore.close()

    const reopened = new EntityMemoryStore(join(dir, 'entity.db'))
    expect(reopened.read('project:demo', 'venue')?.content).toBe('科技园报告厅')
    reopened.close()
  })
})

// ---------- M-M1 T1(19 号 §3):幂等列迁移 + 存量 subject 前缀迁移 + review/touch ----------

/**
 * 迁移前的旧表结构(T1 之前 EntityMemoryStore 的建表语句,逐字保留)——
 * 用于造「T1 上线前用户数据」形态的存量库,验证开库迁移。
 */
const LEGACY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS memory_entity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT NOT NULL,
    key TEXT NOT NULL,
    content TEXT NOT NULL,
    summary TEXT,
    valid_at INTEGER NOT NULL,
    invalid_at INTEGER,
    confidence REAL NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`

/** 造一个旧十列存量库(无新列),按给定 subject 顺序写入 key-N/content-N 行。 */
function seedLegacyDatabase(dbPath: string, subjects: readonly string[]): void {
  const db = new DatabaseSync(dbPath)
  db.exec(LEGACY_SCHEMA)
  const insert = db.prepare(
    'INSERT INTO memory_entity (subject, key, content, valid_at, invalid_at, confidence, created_at, updated_at) VALUES (?, ?, ?, 1_000, NULL, 0.8, 1_000, 1_000)',
  )
  for (const [index, subject] of subjects.entries()) insert.run(subject, `key-${index}`, `content-${index}`)
  db.close()
}

describe('M-M1 T1:存量 subject 前缀迁移四分支', () => {
  it('user:*→scope=user(subject 不动);project:*→domain+改写 subject;org:*→legacy-org 只留档;无前缀→domain:default', () => {
    const dbPath = join(dir, 'legacy-four.db')
    seedLegacyDatabase(dbPath, ['user:alice', 'project:demo', 'org:acme', '个人备忘'])

    const legacy = new EntityMemoryStore(dbPath, { now: () => clock })
    // user:* → scope='user',subject 保持原值(检索按 scope 列)
    const userRow = legacy.read('user:alice', 'key-0')
    expect(userRow?.scope).toBe('user')
    expect(userRow?.subject).toBe('user:alice')
    expect(userRow?.domainKey).toBeNull()
    // project:* → scope='domain',domain_key=<原名>,subject 改写为 domain:<原名>
    const domainRow = legacy.read('domain:demo', 'key-1')
    expect(domainRow?.scope).toBe('domain')
    expect(domainRow?.domainKey).toBe('demo')
    expect(legacy.read('project:demo', 'key-1')).toBeNull()
    // org:* → legacy-org 只留档:行保留可审计,但检索/索引默认排除
    const orgRow = legacy.read('org:acme', 'key-2')
    expect(orgRow?.scope).toBe('legacy-org')
    expect(legacy.search('content-2')).toHaveLength(0)
    expect(legacy.listLive().map(row => row.key).sort()).toEqual(['key-0', 'key-1', 'key-3'])
    // 无前缀 → domain:default(subject 不动)
    const bareRow = legacy.read('个人备忘', 'key-3')
    expect(bareRow?.scope).toBe('domain')
    expect(bareRow?.domainKey).toBe('default')
    // 迁移行的列默认值齐备(kind/review_state/source/use_count/last_used_at)
    for (const row of [userRow, domainRow, orgRow, bareRow]) {
      expect(row?.kind).toBe('semantic')
      expect(row?.reviewState).toBe('approved')
      expect(row?.source).toBe('agent')
      expect(row?.useCount).toBe(0)
      expect(row?.lastUsedAt).toBeNull()
    }
    expect(legacy.count()).toBe(4)
    legacy.close()
  })

  it('迁移幂等:重开不再迁移(project 域不被 default 覆盖),缺列补列不重复执行', () => {
    const dbPath = join(dir, 'legacy-idem.db')
    seedLegacyDatabase(dbPath, ['project:demo', 'user:alice'])

    const first = new EntityMemoryStore(dbPath, { now: () => clock })
    expect(first.read('domain:demo', 'key-0')?.domainKey).toBe('demo')
    first.close()

    const second = new EntityMemoryStore(dbPath, { now: () => clock })
    expect(second.read('domain:demo', 'key-0')?.domainKey).toBe('demo')
    expect(second.read('user:alice', 'key-1')?.scope).toBe('user')
    expect(second.count()).toBe(2)
    second.close()
  })

  it(':memory: 新库直接建全列,写入缺省值齐备', () => {
    const { record } = store.write({ subject: 'user', key: 'k', content: 'v' })
    expect(record.kind).toBe('semantic')
    expect(record.scope).toBe('domain')
    expect(record.domainKey).toBe('default')
    expect(record.reviewState).toBe('approved')
    expect(record.source).toBe('agent')
    expect(record.originSessionId).toBeNull()
    expect(record.originTurnRef).toBeNull()
    expect(record.lastUsedAt).toBeNull()
    expect(record.useCount).toBe(0)
  })
})

describe('M-M1 T1:review 软失效与命中强化 touch', () => {
  it('review(id,"rejected") 打 invalid_at 软失效:检索/索引/读取不可见,物理行仍在', () => {
    const { record } = store.write({ subject: 'user', key: 'prefers-zh', content: '周报用中文', summary: '周报中文' })
    clock = 2_000
    const reviewed = store.review(record.id, 'rejected')
    expect(reviewed?.reviewState).toBe('rejected')
    expect(reviewed?.invalidAt).toBe(2_000)
    expect(store.search('周报')).toHaveLength(0)
    expect(store.listLive()).toHaveLength(0)
    expect(store.read('user', 'prefers-zh')).toBeNull()
    expect(store.count()).toBe(1)
    expect(store.readAll('user', 'prefers-zh')).toHaveLength(1)
  })

  it('pending 默认不入检索/索引;review(id,"approved") 后可见', () => {
    const { record } = store.write({ subject: 'user', key: 'style', content: '代码风格偏好简洁', reviewState: 'pending' })
    expect(record.reviewState).toBe('pending')
    expect(store.search('简洁')).toHaveLength(0)
    expect(store.listLive()).toHaveLength(0)
    clock = 2_000
    const approved = store.review(record.id, 'approved')
    expect(approved?.reviewState).toBe('approved')
    expect(approved?.invalidAt).toBeNull()
    expect(store.search('简洁')).toHaveLength(1)
  })

  it('review 未知 id 返回 null', () => {
    expect(store.review(999_999, 'approved')).toBeNull()
  })

  it('touch(ids):use_count+1、last_used_at=now、updated_at 不动;只作用 live 行;重复 id 去重', () => {
    const first = store.write({ subject: 'domain:deploy', key: 'a', domainKey: 'deploy', content: 'va' }).record
    const second = store.write({ subject: 'domain:deploy', key: 'b', domainKey: 'deploy', content: 'vb' }).record
    clock = 2_000
    expect(store.touch([first.id])).toBe(1)
    let row = store.read('domain:deploy', 'a')
    expect(row?.useCount).toBe(1)
    expect(row?.lastUsedAt).toBe(2_000)
    expect(row?.updatedAt).toBe(1_000)
    clock = 3_000
    expect(store.touch([first.id, first.id, second.id, 42_424])).toBe(2)
    row = store.read('domain:deploy', 'a')
    expect(row?.useCount).toBe(2)
    expect(row?.lastUsedAt).toBe(3_000)
    expect(store.read('domain:deploy', 'b')?.useCount).toBe(1)
    expect(store.touch([])).toBe(0)
    // 软失效行不再计强化
    store.review(second.id, 'rejected')
    clock = 4_000
    expect(store.touch([second.id])).toBe(0)
    const history = store.readAll('domain:deploy', 'b')
    expect(history[0]?.useCount).toBe(1)
    expect(history[0]?.lastUsedAt).toBe(3_000)
  })
})

describe('M-M1 T1:EntityWriteInput 扩展与校验', () => {
  it('新字段全量写入并读回', () => {
    const { record } = store.write({
      subject: 'domain:deploy',
      key: 'release-flow',
      content: '发布先过 packctl 预检',
      kind: 'procedural',
      scope: 'domain',
      domainKey: 'deploy',
      reviewState: 'pending',
      originSessionId: 'session-42',
      originTurnRef: 'call_00_ab',
      source: 'consolidation',
    })
    expect(record.kind).toBe('procedural')
    expect(record.scope).toBe('domain')
    expect(record.domainKey).toBe('deploy')
    expect(record.reviewState).toBe('pending')
    expect(record.originSessionId).toBe('session-42')
    expect(record.originTurnRef).toBe('call_00_ab')
    expect(record.source).toBe('consolidation')
  })

  it('domainKey 解析:显式优先;scope=domain 可从 subject domain:<键> 推导;缺省落 default', () => {
    expect(store.write({ subject: 'domain:deploy', key: 'a', content: 'v' }).record.domainKey).toBe('deploy')
    expect(store.write({ subject: '工作区', key: 'b', content: 'v' }).record.domainKey).toBe('default')
    const userRow = store.write({ subject: 'user', key: 'c', content: 'v', scope: 'user' }).record
    expect(userRow.domainKey).toBeNull()
  })

  it('校验:非 domain scope 携带 domainKey 拒绝;枚举/provenance/domainKey 非法值拒绝', () => {
    expect(() => store.write({ subject: 'user', key: 'k', content: 'v', scope: 'user', domainKey: 'deploy' })).toThrow(/domainKey/)
    expect(() => store.write({ subject: 'user', key: 'k', content: 'v', kind: 'fake' as EntityKind })).toThrow(/kind/)
    expect(() => store.write({ subject: 'user', key: 'k', content: 'v', scope: 'org' as EntityScope })).toThrow(/scope/)
    expect(() => store.write({ subject: 'user', key: 'k', content: 'v', reviewState: 'maybe' as EntityReviewState })).toThrow(/reviewState/)
    expect(() => store.write({ subject: 'user', key: 'k', content: 'v', source: 'dream' as EntitySource })).toThrow(/source/)
    expect(() => store.write({ subject: 'user', key: 'k', content: 'v', originSessionId: ' ' })).toThrow(/originSessionId/)
    expect(() => store.write({ subject: 'user', key: 'k', content: 'v', originTurnRef: 'x'.repeat(257) })).toThrow(/originTurnRef/)
    expect(() => store.write({ subject: 'user', key: 'k', content: 'v', domainKey: 'Not_Kebab' })).toThrow(/domainKey/)
    expect(() => store.write({ subject: 'user', key: 'k', content: 'v', domainKey: 'd'.repeat(65) })).toThrow(/domainKey/)
  })

  it('同键顶替携带新列:旧行保留自身新列值打 invalid_at,(subject,key) 唯一性不变', () => {
    store.write({
      subject: 'domain:deploy', key: 'flow', domainKey: 'deploy',
      kind: 'episodic', content: 'v1', originSessionId: 's1',
    })
    clock = 2_000
    const { record, superseded } = store.write({
      subject: 'domain:deploy', key: 'flow', domainKey: 'deploy',
      kind: 'semantic', content: 'v2', originSessionId: 's2',
    })
    // superseded 是写入前快照(捕获时仍 live);历史打点以 readAll 为准
    expect(superseded).toHaveLength(1)
    expect(superseded[0]?.kind).toBe('episodic')
    expect(superseded[0]?.originSessionId).toBe('s1')
    const history = store.readAll('domain:deploy', 'flow')
    expect(history).toHaveLength(2)
    expect(history[0]?.invalidAt).toBe(2_000)
    expect(history[0]?.kind).toBe('episodic')
    expect(history[0]?.originSessionId).toBe('s1')
    expect(record.kind).toBe('semantic')
    expect(record.originSessionId).toBe('s2')
    expect(store.read('domain:deploy', 'flow')?.originSessionId).toBe('s2')
  })
})
