import { appendFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DailyFileAuditSink } from '../src/daily-sink.ts'
import { queryAuditRecords } from '../src/query.ts'
import type { AuditQuery, AuditQueryPage } from '../src/service.ts'
import type { AuditRecord } from '@eterna/governance'

const DAY_A = '2025-10-09T06:00:00.000Z'
const DAY_B = '2025-10-10T09:00:00.000Z'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
  tempDirs.length = 0
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'eterna-audit-query-'))
  tempDirs.push(dir)
  return dir
}

/** 六条基线记录跨两天:tool-call×2(一败一成)、usage×2、turn-end、governance。 */
async function seedSix(dir: string): Promise<void> {
  const sink = new DailyFileAuditSink(dir)
  const records: readonly AuditRecord[] = [
    { kind: 'usage', at: DAY_A, turn: 1 },
    { kind: 'tool-call', at: DAY_A, turn: 1, step: 1, tool: 'budget_calc', callId: 'c1', isError: false },
    { kind: 'usage', at: DAY_A, turn: 2 },
    { kind: 'tool-call', at: DAY_B, turn: 2, step: 3, tool: 'web_fetch', callId: 'c2', isError: true, errorName: 'HTTPError' },
    { kind: 'usage', at: DAY_B, turn: 3 },
    { kind: 'governance', at: DAY_B, detail: { source: 'budget' } },
  ]
  for (const record of records) await sink.write(record)
}

function walkQuery(dir: string, filter: AuditQuery & { limit: number; cursor?: string }): Promise<AuditQueryPage> {
  return queryAuditRecords({ dir, filePrefix: 'audit-', filter })
}

describe('queryAuditRecords:分页游标查询', () => {
  it('kinds 过滤跨文件取全部命中(文件序 = 日期序)', async () => {
    const dir = await tempDir()
    await seedSix(dir)
    const page = await walkQuery(dir, { limit: 10, kinds: ['usage'] })
    expect(page.records.map(r => r.at)).toEqual([DAY_A, DAY_A, DAY_B])
    expect(page.nextCursor).toBeUndefined()
  })

  it('limit 分页走通:cursor 推进到下一页,末页 nextCursor 缺席', async () => {
    const dir = await tempDir()
    await seedSix(dir)
    const page1 = await walkQuery(dir, { limit: 2, kinds: ['usage'] })
    expect(page1.records.map(r => r.at)).toEqual([DAY_A, DAY_A])
    expect(page1.nextCursor).toBeTypeOf('string')

    const page2 = await walkQuery(dir, {
      limit: 2,
      kinds: ['usage'],
      ...(page1.nextCursor !== undefined ? { cursor: page1.nextCursor } : {}),
    })
    expect(page2.records.map(r => r.at)).toEqual([DAY_B])
    expect(page2.nextCursor).toBeUndefined()
  })

  it('游标跨文件:第一页止于 A 日最后一行,第二页从 B 日继续', async () => {
    const dir = await tempDir()
    await seedSix(dir)
    const page1 = await walkQuery(dir, { limit: 3 })
    expect(page1.records).toHaveLength(3)
    expect(page1.nextCursor).toBeTypeOf('string')
    const page2 = await walkQuery(dir, {
      limit: 10,
      ...(page1.nextCursor !== undefined ? { cursor: page1.nextCursor } : {}),
    })
    expect(page2.records).toHaveLength(3)
    expect(page2.records[0]).toMatchObject({ kind: 'tool-call', tool: 'web_fetch' })
  })

  it('tool glob 与 isError 过滤(matchAnyGlob 语义)', async () => {
    const dir = await tempDir()
    await seedSix(dir)
    const budget = await walkQuery(dir, { limit: 10, kinds: ['tool-call'], tool: ['budget_*'] })
    expect(budget.records.map(r => r.tool)).toEqual(['budget_calc'])
    const failed = await walkQuery(dir, { limit: 10, isError: true })
    expect(failed.records.map(r => r.tool)).toEqual(['web_fetch'])
    expect(failed.records[0]).toMatchObject({ errorName: 'HTTPError' })
  })

  it('since/until 时间界(at 缺席的记录不命中)', async () => {
    const dir = await tempDir()
    await seedSix(dir)
    const sinceB = await walkQuery(dir, { limit: 10, since: DAY_B })
    expect(sinceB.records).toHaveLength(3)
    const untilA = await walkQuery(dir, { limit: 10, until: DAY_A })
    expect(untilA.records).toHaveLength(3)
  })

  it('坏行(非 JSON / 未知 kind)跳过,不毒化整页', async () => {
    const dir = await tempDir()
    await seedSix(dir)
    await appendFile(join(dir, 'audit-20251009.jsonl'), 'not-json-at-all\n{"kind":"mystery"}\n', 'utf8')
    const page = await walkQuery(dir, { limit: 10, kinds: ['usage'] })
    expect(page.records.map(r => r.at)).toEqual([DAY_A, DAY_A, DAY_B])
  })

  it('非法游标与非法 limit 抛 RangeError(明确拒绝,不静默从头)', async () => {
    const dir = await tempDir()
    await seedSix(dir)
    await expect(walkQuery(dir, { limit: 2, cursor: 'not-base64!!' })).rejects.toThrow(RangeError)
    const bogus = Buffer.from(JSON.stringify({ f: 'audit-99999999.jsonl', l: -1 })).toString('base64url')
    await expect(walkQuery(dir, { limit: 2, cursor: bogus })).rejects.toThrow(RangeError)
    await expect(walkQuery(dir, { limit: 0 })).rejects.toThrow(RangeError)
  })

  it('空目录返回空页(不抛)', async () => {
    const dir = await tempDir()
    const page = await walkQuery(dir, { limit: 5 })
    expect(page.records).toEqual([])
    expect(page.nextCursor).toBeUndefined()
  })
})
