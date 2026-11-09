import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EntityMemoryStore } from '../src/index.ts'

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
