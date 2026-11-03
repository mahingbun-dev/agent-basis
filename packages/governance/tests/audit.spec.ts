import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AuditProjector, FileAuditSink, MemoryAuditSink, PiiFilter } from '../src/index.ts'
import type { AuditEventInput, AuditRecord, AuditSink } from '../src/index.ts'

/** 形态对齐 dsh SessionEventMap 的事件构造器(seq/time 含在事件包上)。 */
function ev(type: string, data: unknown, seq: number): AuditEventInput {
  return { type, data, seq, time: 1_760_000_000_000 }
}

function miniSession(): AuditEventInput[] {
  return [
    ev('turn/start', { turn: 1 }, 0),
    ev('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'shell', arguments: '{"cmd":"ls -la"}' }, 1),
    ev('tool/result', { turn: 1, step: 1, message: { toolCallId: 'c1', isError: false } }, 2),
    ev('tool/call', { turn: 1, step: 1, callId: 'c2', name: 'web_fetch', arguments: '{"url":"https://a.b"}' }, 3),
    ev('tool/result', { turn: 1, step: 1, message: { toolCallId: 'c2', isError: true }, error: { name: 'HTTPError', code: '502' } }, 4),
    ev('assistant/message', { turn: 1, step: 1, usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 } }, 5),
    ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 6),
    ev('compaction/start', {}, 7), // 未识别类型:应被跳过
  ]
}

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
  tempDirs.length = 0
})

async function tempFile(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'basis-governance-audit-'))
  tempDirs.push(dir)
  return join(dir, name)
}

describe('审计投影:事件折叠', () => {
  it('tool/call 与 tool/result 配对折叠为单条 tool-call 记录(含错误与参数预览)', () => {
    const projector = new AuditProjector({ sinks: [new MemoryAuditSink()] })
    const records = projector.project(miniSession())
    const toolRecords = records.filter(r => r.kind === 'tool-call')
    expect(toolRecords).toHaveLength(2)

    const ok = toolRecords.find(r => r.callId === 'c1')
    expect(ok).toMatchObject({
      kind: 'tool-call', turn: 1, step: 1, tool: 'shell', isError: false,
      argsPreview: '{"cmd":"ls -la"}', seq: 1,
    })

    const bad = toolRecords.find(r => r.callId === 'c2')
    expect(bad).toMatchObject({ tool: 'web_fetch', isError: true, errorName: 'HTTPError' })
  })

  it('turn/end → turn-end 记录(带 reason kind);assistant/message → usage 记录', () => {
    const projector = new AuditProjector({ sinks: [new MemoryAuditSink()] })
    const records = projector.project(miniSession())
    expect(records.find(r => r.kind === 'turn-end')).toMatchObject({ turn: 1, reason: 'completed', seq: 6 })
    expect(records.find(r => r.kind === 'usage')).toMatchObject({
      turn: 1, step: 1, usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
    })
  })

  it('未识别事件类型被跳过(前向兼容 66+ 事件类型)', () => {
    const projector = new AuditProjector({ sinks: [new MemoryAuditSink()] })
    expect(projector.projectEvent(ev('compaction/start', {}, 7))).toEqual([])
  })

  it('孤立的 tool/result(无配对 tool/call)仍落记录,turn/step 取自结果事件', () => {
    const projector = new AuditProjector({ sinks: [new MemoryAuditSink()] })
    const records = projector.projectEvent(ev('tool/result', { turn: 2, step: 1, message: { toolCallId: 'zz' } }, 9))
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ kind: 'tool-call', turn: 2, step: 1, callId: 'zz' })
  })

  it('参数预览过 PII 脱敏并按上限截断', () => {
    const projector = new AuditProjector({
      sinks: [new MemoryAuditSink()],
      pii: new PiiFilter(),
      argsPreviewLimit: 40,
    })
    const long = `联系电话 13812345678,${'x'.repeat(60)}`
    projector.projectEvent(ev('tool/call', { turn: 1, step: 1, callId: 'c9', name: 'send_sms', arguments: { text: long } }, 1))
    const records = projector.projectEvent(ev('tool/result', { turn: 1, step: 1, message: { toolCallId: 'c9' } }, 2))
    const toolRecord = records.find(r => r.kind === 'tool-call')
    expect(toolRecord?.argsPreview).toContain('[PII:cn-mobile]')
    expect(toolRecord?.argsPreview?.endsWith('…')).toBe(true)
    expect(toolRecord?.argsPreview).toHaveLength(41) // 上限 40 + 省略号
  })
})

describe('审计投影:双 sink', () => {
  it('内存与文件 sink 收到完全一致的记录(NDJSON 每行一条)', async () => {
    const memory = new MemoryAuditSink()
    const file = new FileAuditSink(await tempFile('audit.ndjson'))
    const projector = new AuditProjector({ sinks: [memory, file] })

    projector.project(miniSession())
    await projector.flush()

    const ndjson = await readFile(file.filePath, 'utf8')
    const lines = ndjson.trim().split('\n')
    expect(lines).toHaveLength(memory.records.length)
    const parsed = lines.map(line => JSON.parse(line) as AuditRecord)
    expect(parsed).toEqual(memory.records)
    expect(new Set(parsed.map(r => r.kind))).toEqual(new Set(['tool-call', 'usage', 'turn-end']))
  })

  it('reportGovernance 落 governance 记录(预算违规/PII 拦截入口)', async () => {
    const memory = new MemoryAuditSink()
    const projector = new AuditProjector({ sinks: [memory] })
    projector.reportGovernance({ source: 'budget', dimension: 'turns', actual: 5, limit: 3 })
    await projector.flush()
    expect(memory.records).toHaveLength(1)
    expect(memory.records[0]).toMatchObject({
      kind: 'governance',
      detail: { source: 'budget', dimension: 'turns', actual: 5, limit: 3 },
    })
  })

  it('sink 写失败不静默:flush() 上抛首个错误', async () => {
    const failing: AuditSink = {
      label: 'failing',
      write() {
        throw new Error('disk full')
      },
    }
    const projector = new AuditProjector({ sinks: [failing] })
    projector.projectEvent(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 1))
    await expect(projector.flush()).rejects.toThrow('disk full')
  })

  it('至少需要一个 sink(空 sink 列表构造失败)', () => {
    expect(() => new AuditProjector({ sinks: [] })).toThrow(RangeError)
  })
})
