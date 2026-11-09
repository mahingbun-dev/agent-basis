/**
 * C 面留痕查询:分页游标读取按日轮转 NDJSON(企业插件设计 §3.1「防全量物化」)。
 *
 * 游标 = base64url(JSON {f: 文件名, l: 0 基行号}),指向上一页最后一条命中记录所在行;
 * 下一页从该行之后继续。文件按名字典序(即日期序)升序遍历,页内记录按落盘序(时间近似
 * 升序)返回。命中 limit 后继续向后找一条命中记录:找到 → 返回 nextCursor(指向本页最后
 * 一条);全部读完再无命中 → nextCursor 缺省(真正的末页)。
 */
import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { isRecord, matchAnyGlob } from '@eterna/governance'
import type { AuditRecord } from '@eterna/governance'
import type { AuditQuery, AuditQueryPage } from './service.ts'

/** 本仓库写入的 kind 全集(§3.1 AuditRecord;用于行级合法性校验,坏行跳过)。 */
const KINDS: readonly AuditRecord['kind'][] = ['turn-end', 'tool-call', 'usage', 'governance']

/** 轮转文件名形态:<prefix>YYYYMMDD.jsonl。 */
function isAuditFileName(name: string, prefix: string): boolean {
  return name.startsWith(prefix)
    && name.endsWith('.jsonl')
    && /^\d{8}$/.test(name.slice(prefix.length, -'.jsonl'.length))
}

interface Cursor {
  readonly f: string
  readonly l: number
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeCursor(raw: string, filePrefix: string): Cursor {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    throw new RangeError('[eterna/audit] 无效游标:不是合法的 base64url JSON')
  }
  if (!isRecord(parsed)) throw new RangeError('[eterna/audit] 无效游标:载荷不是对象')
  const f = parsed['f']
  const l = parsed['l']
  if (typeof f !== 'string' || !isAuditFileName(f, filePrefix)) {
    throw new RangeError(`[eterna/audit] 无效游标:文件名不在 ${filePrefix}YYYYMMDD.jsonl 形态内`)
  }
  if (typeof l !== 'number' || !Number.isInteger(l) || l < 0) {
    throw new RangeError('[eterna/audit] 无效游标:行号必须是 ≥0 的整数')
  }
  return { f, l }
}

/** 单条过滤(kind 内 OR,条件间 AND);at 缺席的记录不参与时间界。 */
function matches(record: AuditRecord, filter: AuditQuery): boolean {
  if (filter.kinds !== undefined && !filter.kinds.includes(record.kind)) return false
  if (filter.isError !== undefined && record.isError !== filter.isError) return false
  if (filter.tool !== undefined && (record.tool === undefined || !matchAnyGlob(record.tool, filter.tool))) return false
  if (filter.since !== undefined && (record.at === undefined || record.at < filter.since)) return false
  if (filter.until !== undefined && (record.at === undefined || record.at > filter.until)) return false
  return true
}

/** 行 → 记录(只消费本仓库写入的 NDJSON;坏行/未知 kind 跳过,不让单行毒化整页)。 */
function asAuditRecord(value: unknown): AuditRecord | undefined {
  if (!isRecord(value)) return undefined
  const kind = value['kind']
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) return undefined
  return value as unknown as AuditRecord
}

export interface QueryAuditRecordsOptions {
  readonly dir: string
  readonly filePrefix: string
  readonly filter: AuditQuery & { readonly limit: number; readonly cursor?: string }
}

export async function queryAuditRecords(options: QueryAuditRecordsOptions): Promise<AuditQueryPage> {
  const { dir, filePrefix, filter } = options
  const limit = filter.limit
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('[eterna/audit] limit 必须是 ≥1 的整数')
  const start = filter.cursor !== undefined ? decodeCursor(filter.cursor, filePrefix) : undefined

  const dirEntries = await readdir(dir).catch(() => [] as const)
  const files = dirEntries
    .filter(name => isAuditFileName(name, filePrefix))
    .sort()
    .filter(name => start === undefined || name >= start.f)

  const records: AuditRecord[] = []
  let lastHit: Cursor | undefined
  let moreHitsAhead = false

  for (const name of files) {
    const fromLine = start !== undefined && name === start.f ? start.l + 1 : 0
    const stream = createReadStream(join(dir, name), 'utf8')
    const lines = createInterface({ input: stream, crlfDelay: Infinity })
    try {
      let lineNo = 0
      for await (const line of lines) {
        const index = lineNo
        lineNo += 1
        if (index < fromLine) continue
        const text = line.trim()
        if (text === '') continue
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          continue
        }
        const record = asAuditRecord(parsed)
        if (record === undefined) continue
        if (!matches(record, filter)) continue
        if (records.length < limit) {
          records.push(record)
          lastHit = { f: name, l: index }
        } else {
          moreHitsAhead = true
          break
        }
      }
    } finally {
      lines.close()
      stream.destroy()
    }
    if (moreHitsAhead) break
  }

  if (moreHitsAhead && lastHit !== undefined) {
    return { records, nextCursor: encodeCursor(lastHit) }
  }
  return { records }
}
