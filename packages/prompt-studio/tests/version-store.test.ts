/**
 * 版本库单测(T7.1 验收标准:版本读写单测过,含并发写串行化):
 * - 并发 append 全部落库、seq 唯一且连续(单写者链);
 * - 只增不删:无删除原语,回滚=追加新版本(parentId 指向被回滚版本);
 * - ensureInitial 只种一次;容错读(坏形状文档跳过);
 * - close 后拒绝使用。
 */
import { describe, expect, it } from 'vitest'
import type { KvUnit } from '@deepseek-ai/dsh-storage'
import { PromptVersionStore, VERSION_UNIT_DESCRIPTOR, VERSIONS_TABLE, VERSION_UNIT_NAME } from '../src/version-store.ts'
import type { VersionStoreOptions } from '../src/version-store.ts'

/** 内存版 KvUnit(只实现本包用到的面;写计数用于串行化断言)。 */
class MemoryUnit {
  readonly tables = new Map<string, Map<string, unknown>>([[VERSIONS_TABLE, new Map()]])
  writeCount = 0

  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: null }> {
    const tables: Record<string, Record<string, unknown>> = {}
    for (const [name, records] of this.tables) tables[name] = Object.fromEntries(records)
    return { tables, global: null }
  }

  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.writeCount += 1
    // 人为交错窗口:让并发写竞争暴露(真实后端的原子写窗口由其自身套件覆盖)。
    await new Promise(resolve => setTimeout(resolve, 1))
    const records = this.tables.get(table)
    if (records === undefined) throw new Error(`no table ${table}`)
    records.set(key, value)
  }

  async close(): Promise<void> {}
}

function asKvUnit(unit: MemoryUnit): KvUnit {
  return unit as unknown as KvUnit
}

function makeStore(unit = new MemoryUnit(), options: VersionStoreOptions = {}): { store: PromptVersionStore; unit: MemoryUnit } {
  return { store: new PromptVersionStore(asKvUnit(unit), options), unit }
}

describe('版本库单元描述符', () => {
  it('per-record 布局、单元/表名合法(UNIT_NAME_RE 口径)', () => {
    expect(VERSION_UNIT_DESCRIPTOR.name).toBe(VERSION_UNIT_NAME)
    expect(VERSION_UNIT_DESCRIPTOR.layout).toBe('per-record')
    expect(VERSION_UNIT_DESCRIPTOR.tables).toEqual([VERSIONS_TABLE])
    expect(VERSION_UNIT_DESCRIPTOR.name).toMatch(/^[a-z][a-z0-9_]*$/u)
    expect(VERSIONS_TABLE).toMatch(/^[a-z][a-z0-9_]*$/u)
  })
})

describe('PromptVersionStore(并发写串行化 + 只增不删)', () => {
  it('并发 append 全部落库:seq 1..N 唯一连续、无丢写', async () => {
    const { store, unit } = makeStore()
    const writes = Array.from({ length: 20 }, (_, i) =>
      store.append({ content: `persona v${i}`, author: 'web', source: 'save' as const, parentId: null, summary: `第 ${i} 版` }))
    const records = await Promise.all(writes)
    expect(records).toHaveLength(20)
    expect(new Set(records.map(record => record.seq)).size).toBe(20)
    expect(new Set(records.map(record => record.id)).size).toBe(20)
    const listed = await store.list()
    expect(listed).toHaveLength(20)
    expect(listed.map(record => record.seq)).toEqual(Array.from({ length: 20 }, (_, i) => 20 - i))
    expect(unit.writeCount).toBe(20)
    await store.close()
  })

  it('append 并发交错时 list/get 仍看到一致视图(读也上链)', async () => {
    const { store } = makeStore()
    const writers = Array.from({ length: 10 }, (_, i) =>
      store.append({ content: `v${i}`, author: 'web', source: 'save' as const, parentId: null, summary: '' }))
    const readers = writers.map(() => store.list(50))
    await Promise.all([...writers, ...readers])
    const final = await store.list()
    expect(final).toHaveLength(10)
    await store.close()
  })

  it('只增不删:回滚是追加新版本(parentId 指向被回滚版本),旧版本仍在', async () => {
    const { store } = makeStore()
    const v1 = await store.append({ content: 'A', author: 'web', source: 'initial' as const, parentId: null, summary: '初始' })
    await store.append({ content: 'B', author: 'web', source: 'save' as const, parentId: v1.id, summary: '' })
    const v3 = await store.append({ content: 'A', author: 'web', source: 'rollback' as const, parentId: v1.id, summary: '回滚到 v1' })
    expect(v3.parentId).toBe(v1.id)
    const all = await store.list()
    expect(all).toHaveLength(3)
    expect(all.map(record => record.content)).toEqual(['A', 'B', 'A'])
    expect((await store.get(v1.id))?.content).toBe('A')
    await store.close()
  })

  it('记录字段齐全:checksum=sha256(content)、bytes=UTF-8 字节、createdAt ISO', async () => {
    const { store } = makeStore()
    const record = await store.append({ content: '你好 persona', author: 'alice', source: 'save' as const, parentId: null, summary: 's' })
    expect(record.checksum).toMatch(/^[0-9a-f]{64}$/u)
    expect(record.bytes).toBe(Buffer.byteLength('你好 persona', 'utf8'))
    expect(Number.isNaN(Date.parse(record.createdAt))).toBe(false)
    expect(record.author).toBe('alice')
    expect(record.id).toMatch(/^[A-Za-z0-9_-]+$/u)
    await store.close()
  })

  it('ensureInitial:空库+非空 persona 种 v1(source=initial);并发双叫只种一次', async () => {
    const { store } = makeStore()
    const first = await store.ensureInitial('基线 persona')
    expect(first?.seq).toBe(1)
    expect(first?.source).toBe('initial')
    const again = await store.ensureInitial('基线 persona')
    expect(again).toBeNull()
    const concurrent = await Promise.all([store.ensureInitial('x'), store.ensureInitial('y')])
    expect(concurrent.every(record => record === null)).toBe(true)
    expect((await store.list())).toHaveLength(1)
    await store.close()
  })

  it('空库+空 persona 不种初始版本', async () => {
    const { store } = makeStore()
    expect(await store.ensureInitial('   ')).toBeNull()
    expect(await store.list()).toHaveLength(0)
    await store.close()
  })

  it('容错读:坏形状文档跳过,不影响其余版本', async () => {
    const { store, unit } = makeStore()
    await store.append({ content: 'good', author: 'web', source: 'save' as const, parentId: null, summary: '' })
    const records = unit.tables.get(VERSIONS_TABLE)
    records?.set('broken-1', { nonsense: true })
    records?.set('broken-2', 'not-an-object')
    const listed = await store.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.content).toBe('good')
    await store.close()
  })

  it('limit 截断(新→旧)', async () => {
    const { store } = makeStore()
    for (let i = 0; i < 5; i += 1) {
      await store.append({ content: `v${i}`, author: 'web', source: 'save' as const, parentId: null, summary: '' })
    }
    const page = await store.list(2)
    expect(page.map(record => record.seq)).toEqual([5, 4])
    await store.close()
  })

  it('close 后拒绝使用', async () => {
    const { store } = makeStore()
    await store.close()
    await expect(store.append({ content: 'x', author: 'w', source: 'save' as const, parentId: null, summary: '' })).rejects.toThrow('版本库已关闭')
    await expect(store.list()).rejects.toThrow('版本库已关闭')
  })

  it('T1.4 按条目分链:各链 seq 各自从 1 连续;记录带 entryId(缺省=默认条目)', async () => {
    const { store } = makeStore()
    await store.append({ content: 'persona-1', author: 'web', source: 'initial' as const, parentId: null, summary: '' })
    const domainA = await store.append({ content: 'domain-a', author: 'web', source: 'initial' as const, parentId: null, summary: '', entryId: 'domain.a' })
    const domainB = await store.append({ content: 'domain-b', author: 'web', source: 'initial' as const, parentId: null, summary: '', entryId: 'domain.b' })
    await store.append({ content: 'persona-2', author: 'web', source: 'save' as const, parentId: null, summary: '' })
    // 各链 seq 各自从 1 起连续;缺省 entryId 归默认条目。
    expect(domainA).toMatchObject({ seq: 1, entryId: 'domain.a' })
    expect(domainB).toMatchObject({ seq: 1, entryId: 'domain.b' })
    const personaChain = await store.list(Number.POSITIVE_INFINITY, 'preset.standard.persona')
    expect(personaChain.map(record => record.seq)).toEqual([2, 1])
    expect(personaChain.every(record => record.entryId === 'preset.standard.persona')).toBe(true)
    const domainChain = await store.list(Number.POSITIVE_INFINITY, 'domain.a')
    expect(domainChain.map(record => record.seq)).toEqual([1])
    await store.close()
  })

  it('T1.4 无 entryId 的 list 顺序契约:按 entryId 字典序降序分组,组内新→旧', async () => {
    const { store } = makeStore()
    await store.append({ content: 'p1', author: 'web', source: 'save' as const, parentId: null, summary: '', entryId: 'a.first' })
    await store.append({ content: 'p2', author: 'web', source: 'save' as const, parentId: null, summary: '', entryId: 'a.first' })
    await store.append({ content: 'd1', author: 'web', source: 'save' as const, parentId: null, summary: '', entryId: 'b.second' })
    const all = await store.list()
    expect(all.map(record => [record.entryId, record.seq])).toEqual([
      ['b.second', 1],
      ['a.first', 2],
      ['a.first', 1],
    ])
    await store.close()
  })

  it('T1.4 id 冲突 fail-closed:确定性工厂跨记录同 id → 第二次 append 抛错,不静默覆盖', async () => {
    const { store, unit } = makeStore(new MemoryUnit(), { idFactory: () => 'fixed-id' })
    await store.append({ content: 'first', author: 'web', source: 'save' as const, parentId: null, summary: '' })
    await expect(store.append({ content: 'second', author: 'web', source: 'save' as const, parentId: null, summary: '' }))
      .rejects.toThrow('版本 id 冲突:fixed-id 已存在')
    // 首条未被覆盖(键=id 的 per-record 布局下静默覆盖=丢版本,必须显式抛错拦截)。
    const records = unit.tables.get(VERSIONS_TABLE)
    expect(records?.get('fixed-id')).toMatchObject({ content: 'first' })
    expect((await store.list()).length).toBe(1)
    await store.close()
  })

  it('T1.4 idFactory 收 (seq, entryId):链内编号+条目 id 同时可见(工厂可保证全局唯一)', async () => {
    const calls: Array<[number, string]> = []
    const { store } = makeStore(new MemoryUnit(), {
      idFactory: (seq, entryId) => {
        calls.push([seq, entryId])
        return `v-${entryId.replace(/\./gu, '_')}-${seq}`
      },
    })
    await store.append({ content: 'x', author: 'web', source: 'save' as const, parentId: null, summary: '', entryId: 'domain.a' })
    await store.append({ content: 'y', author: 'web', source: 'save' as const, parentId: null, summary: '' })
    expect(calls).toEqual([[1, 'domain.a'], [1, 'preset.standard.persona']])
    await store.close()
  })
})
