import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { BuiltinPiiGuard, NotesStore } from '../src/index.ts'

let root = ''
let store: NotesStore

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'eterna-memory-notes-'))
  store = new NotesStore(root, new BuiltinPiiGuard())
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('M1 NotesStore:读写', () => {
  it('写入并读回 NOTES.md;不存在返回 null', async () => {
    expect(await store.read('NOTES.md')).toBeNull()
    const result = await store.write('NOTES.md', '# 项目记忆\n- 供应商名单见 vendor.md')
    expect(result.existed).toBe(false)
    expect(await store.read('NOTES.md')).toBe('# 项目记忆\n- 供应商名单见 vendor.md')
  })

  it('覆盖写返回 undo:恢复原内容(effect 配逆)', async () => {
    await store.write('NOTES.md', 'v1 内容')
    const second = await store.write('NOTES.md', 'v2 内容')
    expect(second.existed).toBe(true)
    expect(await store.read('NOTES.md')).toBe('v2 内容')
    await second.undo()
    expect(await store.read('NOTES.md')).toBe('v1 内容')
  })

  it('新建文件 undo:删除文件并清理新建空目录(effect 配逆)', async () => {
    const result = await store.write('notes/venue.md', '场地:科技园报告厅')
    expect(result.file).toBe('notes/venue.md')
    expect(existsSync(join(root, 'notes', 'venue.md'))).toBe(true)
    await result.undo()
    expect(await store.read('notes/venue.md')).toBeNull()
    expect(existsSync(join(root, 'notes'))).toBe(false)
  })

  it('undo 幂等:重复调用无副作用', async () => {
    const result = await store.write('NOTES.md', 'x')
    await result.undo()
    await result.undo()
    expect(await store.read('NOTES.md')).toBeNull()
  })

  it('追加写:不存在则创建,已有内容换行衔接;undo 恢复全文', async () => {
    await store.append('NOTES.md', '第一行')
    await store.append('NOTES.md', '第二行')
    expect(await store.read('NOTES.md')).toBe('第一行\n第二行\n')
    const third = await store.append('NOTES.md', '第三行')
    expect(await store.read('NOTES.md')).toBe('第一行\n第二行\n第三行\n')
    await third.undo()
    expect(await store.read('NOTES.md')).toBe('第一行\n第二行\n')
  })

  it('写入前过 PII:命中即抛且不落盘(fail-closed)', async () => {
    await expect(store.write('NOTES.md', '联系 13812345678')).rejects.toThrow(/PII 拦截/)
    expect(await store.read('NOTES.md')).toBeNull()
  })
})

describe('M1 NotesStore:路径安全', () => {
  it('拒绝绝对路径与 ~', async () => {
    await expect(store.read('/etc/passwd.md')).rejects.toThrow(/相对路径/)
    await expect(store.read('~/secret.md')).rejects.toThrow(/相对路径/)
    await expect(store.write('/tmp/evil.md', 'x')).rejects.toThrow(/相对路径/)
  })

  it('拒绝越出根目录的 ../ 路径', async () => {
    await expect(store.read('../outside.md')).rejects.toThrow(/越出工作区/)
    await expect(store.read('notes/../../outside.md')).rejects.toThrow(/越出工作区/)
    await expect(store.write('../outside.md', 'x')).rejects.toThrow(/越出工作区/)
  })

  it('拒绝非 .md 后缀', async () => {
    await expect(store.read('NOTES.txt')).rejects.toThrow(/\.md/)
    await expect(store.write('NOTES.txt', 'x')).rejects.toThrow(/\.md/)
  })

  it('拒绝空路径', async () => {
    await expect(store.read('')).rejects.toThrow(/不能为空/)
  })

  it('./ 前缀与子目录相对路径合法', async () => {
    const result = await store.write('./notes/a/b.md', '深目录')
    expect(result.file).toBe('notes/a/b.md')
    expect(await store.read('notes/a/b.md')).toBe('深目录')
  })
})

describe('M1 NotesStore:检索', () => {
  beforeEach(async () => {
    await store.write('NOTES.md', '# 项目记忆\n- 场地首选科技园报告厅,备用礼堂\n- 预算上限 50 万')
    await store.write('notes/vendor.md', '供应商:星辰搭建(主)\n供应商:远光音响(备)')
  })

  it('多词 AND 命中,带文件与行号出处', async () => {
    const hits = await store.search('场地 科技园')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.file).toBe('NOTES.md')
    expect(hits[0]!.line).toBe(2)
    expect(hits[0]!.source).toBe('NOTES.md#L2')
    expect(hits[0]!.excerpt).toContain('科技园报告厅')
  })

  it('单词跨文件命中;大小写不敏感', async () => {
    const hits = await store.search('供应商')
    expect(hits).toHaveLength(2)
    expect(hits.every(hit => hit.file === 'notes/vendor.md')).toBe(true)
    expect(hits.map(hit => hit.line)).toEqual([1, 2])
  })

  it('任一词缺失即不命中(AND 语义)', async () => {
    expect(await store.search('场地 不存在词')).toHaveLength(0)
  })

  it('空查询返回空', async () => {
    expect(await store.search('   ')).toHaveLength(0)
  })

  it('limit 截断', async () => {
    expect(await store.search('供应商', { limit: 1 })).toHaveLength(1)
  })

  it('list 列出全部 .md(相对路径排序,忽略隐藏目录)', async () => {
    await store.write('notes/.hidden.md', '隐藏')
    expect(await store.list()).toEqual(['NOTES.md', 'notes/vendor.md'])
  })
})
