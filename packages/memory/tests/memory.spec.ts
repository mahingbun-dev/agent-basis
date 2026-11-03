import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PiiFilter } from '@basis/governance'
import { createMemory, estimateTokens, isPiiBlockedError } from '../src/index.ts'

let dir = ''
let dbPath = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'basis-memory-svc-'))
  dbPath = join(dir, 'memory.db')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function openSession(pii?: PiiFilter) {
  return createMemory({ workspaceDir: dir, dbPath, ...(pii !== undefined && { pii }) })
}

describe('验收 ①:跨会话召回(M1 文件 + M2 sqlite 双层)', () => {
  it('会话 1 写入 → dispose → 会话 2(新实例、同库同目录)可读可检', async () => {
    const session1 = openSession()
    session1.writeEntity({
      subject: 'user:alice',
      key: 'prefers-email-summary',
      content: '周报偏好邮件摘要形式,周四上午发送',
      summary: '偏好邮件摘要',
      confidence: 0.9,
    })
    session1.writeEntity({ subject: 'org:acme', key: 'meeting-cadence', content: '双周例会固定周一上午' })
    await session1.writeNote('NOTES.md', '# 项目记忆\n- 场地首选科技园报告厅')
    session1.dispose()

    const session2 = openSession()
    const recalled = session2.readEntity('user:alice', 'prefers-email-summary')
    expect(recalled?.content).toBe('周报偏好邮件摘要形式,周四上午发送')
    expect(recalled?.confidence).toBe(0.9)

    const entityHits = await session2.search('周报 邮件')
    expect(entityHits.some(hit => hit.kind === 'entity' && hit.title === 'user:alice/prefers-email-summary')).toBe(true)
    const noteHits = await session2.notes.search('科技园')
    expect(noteHits[0]?.file).toBe('NOTES.md')
    session2.dispose()
  })

  it('跨会话顶替:会话 2 的新值覆盖会话 1 的旧值,历史保留', () => {
    const session1 = openSession()
    session1.writeEntity({ subject: 'org:acme', key: 'invoice-rule', content: '旧规则' })
    session1.dispose()

    const session2 = openSession()
    session2.writeEntity({ subject: 'org:acme', key: 'invoice-rule', content: '新规则' })
    expect(session2.readEntity('org:acme', 'invoice-rule')?.content).toBe('新规则')
    expect(session2.entities.readAll('org:acme', 'invoice-rule')).toHaveLength(2)
    session2.dispose()
  })
})

describe('验收 ②:遗忘后检索不到(真删而非打标)', () => {
  it('forget 后 read/search/索引全链路不可再得', async () => {
    const session = openSession()
    session.writeEntity({
      subject: 'user:alice',
      key: 'private-note',
      content: '供应商争议点在尾款条款',
      summary: '尾款争议',
      confidence: 0.7,
    })
    expect(session.buildIndex().text).toContain('private-note')

    const { forgotten } = session.forget('user:alice', 'private-note')
    expect(forgotten).toBe(1)

    expect(session.readEntity('user:alice', 'private-note')).toBeNull()
    expect(session.entities.readAll('user:alice', 'private-note')).toHaveLength(0)
    const hits = await session.search('尾款')
    expect(hits.filter(hit => hit.kind === 'entity')).toHaveLength(0)
    expect(session.buildIndex().text).not.toContain('private-note')
    expect(session.entities.count()).toBe(0)
    session.dispose()
  })

  it('写入的 undo 同样让检索不可得(配逆等价性)', async () => {
    const session = openSession()
    const written = session.writeEntity({ subject: 'user:alice', key: 'temp', content: '临时记忆内容' })
    written.undo()
    expect(await session.search('临时记忆')).toHaveLength(0)
    session.dispose()
  })
})

describe('验收 ③:索引预算不超(≤500 token,渐进披露)', () => {
  it('海量记忆下 buildIndex 整段 ≤500 token 且含截断提示', () => {
    const session = openSession()
    for (let index = 0; index < 60; index += 1) {
      session.writeEntity({
        subject: index % 2 === 0 ? 'user:alice' : 'org:acme',
        key: `convention-${index}`,
        content: `约定 ${index} 的完整正文,内容足够长以撑爆预算`,
        summary: `约定${index}的一句话摘要`,
        confidence: 0.3 + (index % 7) / 10,
      })
    }
    const index = session.buildIndex()
    expect(index.total).toBe(60)
    expect(index.included + index.omitted).toBe(60)
    expect(index.omitted).toBeGreaterThan(0)
    expect(estimateTokens(index.text)).toBeLessThanOrEqual(500)
    expect(index.text).toMatch(/\+\d+ 条未列出/)
    session.dispose()
  })

  it('索引只含 key+摘要,不含正文(渐进披露)', () => {
    const session = openSession()
    session.writeEntity({ subject: 'user:alice', key: 'k1', content: '这是不该进入索引的长正文内容', summary: '短摘要' })
    const text = session.buildIndex().text
    expect(text).toContain('k1')
    expect(text).toContain('短摘要')
    expect(text).not.toContain('这是不该进入索引的长正文内容')
    session.dispose()
  })
})

describe('验收 ④:一切写入先过 PII(fail-closed)', () => {
  it('注入 @basis/governance PiiFilter:M2 写入命中即抛,库无残留', () => {
    const session = openSession(new PiiFilter())
    let caught: unknown
    try {
      session.writeEntity({ subject: 'user:alice', key: 'contact', content: '手机 13812345678' })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeDefined()
    expect(isPiiBlockedError(caught)).toBe(true)
    expect((caught as Error).message).toMatch(/PII 拦截/)
    expect(session.entities.count()).toBe(0)
    session.dispose()
  })

  it('注入 governance 过滤:M1 notes 写入命中即抛,文件不落盘', async () => {
    const session = openSession(new PiiFilter())
    await expect(session.writeNote('NOTES.md', '联系 alice@example.com')).rejects.toThrow(/PII 拦截/)
    expect(await session.notes.read('NOTES.md')).toBeNull()
    session.dispose()
  })

  it('未注入 governance:内置降级守卫同样拦截四类通用模式', () => {
    const session = openSession()
    expect(() => session.writeEntity({ subject: 'u', key: 'k', content: '身份证 110101199003077758' })).toThrow(/PII 拦截/)
    expect(session.entities.count()).toBe(0)
    session.dispose()
  })

  it('PII 拦截后干净写入不受影响(不污染后续路径)', () => {
    const session = openSession(new PiiFilter())
    expect(() => session.writeEntity({ subject: 'u', key: 'bad', content: '13812345678' })).toThrow(/PII 拦截/)
    session.writeEntity({ subject: 'u', key: 'good', content: '干净的长期记忆' })
    expect(session.readEntity('u', 'good')?.content).toBe('干净的长期记忆')
    session.dispose()
  })
})

describe('Memory 服务:联合检索与出处', () => {
  it('M2 排序在前、M1 notes 随后,出处锚点带 entity:/notes: 前缀', async () => {
    const session = openSession()
    session.writeEntity({ subject: 'user:alice', key: 'venue-preference', content: '偏好科技园报告厅' })
    await session.writeNote('notes/venue.md', '场地备忘:科技园报告厅容量 200 人')
    const hits = await session.search('科技园')
    expect(hits).toHaveLength(2)
    expect(hits[0]!.kind).toBe('entity')
    expect(hits[0]!.source).toMatch(/^entity:user:alice\/venue-preference#\d+$/u)
    expect(hits[1]!.kind).toBe('note')
    expect(hits[1]!.source).toBe('notes:notes/venue.md#L1')
    session.dispose()
  })

  it('includeNotes:false 只查 M2;subject 过滤透传到 M2', async () => {
    const session = openSession()
    session.writeEntity({ subject: 'org:acme', key: 'k', content: '关键词命中' })
    await session.writeNote('NOTES.md', '关键词也在这里')
    expect(await session.search('关键词', { includeNotes: false })).toHaveLength(1)
    expect(await session.search('关键词', { subject: 'org:acme', includeNotes: false })).toHaveLength(1)
    expect(await session.search('关键词', { subject: 'org:other', includeNotes: false })).toHaveLength(0)
    session.dispose()
  })

  it('limit 作用于合并结果', async () => {
    const session = openSession()
    for (let index = 0; index < 5; index += 1) {
      session.writeEntity({ subject: 'org:acme', key: `k-${index}`, content: `批量关键词 ${index}` })
    }
    expect(await session.search('批量关键词')).toHaveLength(5)
    expect(await session.search('批量关键词', { limit: 2 })).toHaveLength(2)
    session.dispose()
  })
})

describe('Memory 服务:writeNote/appendNote 的配逆', () => {
  it('writeNote undo 恢复原内容;appendNote undo 恢复全文', async () => {
    const session = openSession()
    await session.writeNote('NOTES.md', 'v1')
    const second = await session.writeNote('NOTES.md', 'v2')
    await second.undo()
    expect(await session.notes.read('NOTES.md')).toBe('v1')

    const appended = await session.appendNote('NOTES.md', '追加行')
    await appended.undo()
    expect(await session.notes.read('NOTES.md')).toBe('v1')
    session.dispose()
  })
})
