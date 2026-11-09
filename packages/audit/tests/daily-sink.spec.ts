import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DailyFileAuditSink } from '../src/daily-sink.ts'
import type { AuditRecord } from '@eterna/governance'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
  tempDirs.length = 0
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'eterna-audit-sink-'))
  tempDirs.push(dir)
  return dir
}

function rec(at: string, kind: AuditRecord['kind'] = 'usage'): AuditRecord {
  return { kind, at }
}

describe('DailyFileAuditSink:按日轮转 NDJSON', () => {
  it('按 at 的 UTC 日分桶落盘,每记录一行合法 JSON', async () => {
    const dir = await tempDir()
    const sink = new DailyFileAuditSink(dir)
    await sink.write(rec('2026-11-06T12:00:00.000Z', 'tool-call'))
    await sink.write(rec('2026-11-06T13:00:00.000Z', 'tool-call'))
    await sink.write(rec('2026-11-07T00:30:00.000Z'))

    expect((await readdir(dir)).sort()).toEqual(['audit-20261106.jsonl', 'audit-20261107.jsonl'])
    const lines = (await readFile(join(dir, 'audit-20261106.jsonl'), 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ kind: 'tool-call', at: '2026-11-06T12:00:00.000Z' })
  })

  it('at 缺席的记录落当前 UTC 日;自定义前缀生效', async () => {
    const dir = await tempDir()
    const sink = new DailyFileAuditSink(dir, 'trace-')
    await sink.write({ kind: 'governance' })
    const names = await readdir(dir)
    expect(names).toHaveLength(1)
    expect(names[0]).toSatisfy((name: string) => /^trace-\d{8}\.jsonl$/.test(name))
    expect(sink.filePathFor(undefined)).toBe(join(dir, names[0] ?? ''))
    expect(sink.filePathFor('2026-01-02T03:04:05.000Z')).toBe(join(dir, 'trace-20260102.jsonl'))
  })

  it('父目录按需创建(目录不存在时不抛)', async () => {
    const dir = join(await tempDir(), 'nested/.eterna')
    const sink = new DailyFileAuditSink(dir)
    await sink.write(rec('2026-11-06T12:00:00.000Z'))
    await expect(readFile(join(dir, 'audit-20261106.jsonl'), 'utf8')).resolves.toContain('"kind":"usage"')
  })
})
