/**
 * 真实通知样本回放(T17,设计文档 18 §6-2):docs/acp-real-6/notifications-sample.jsonl
 * 是 scripts/sample-notifications.mjs 用 python SDK 起真会话采到的原始
 * on_notification 通知({method, payload} 一行一条)。
 *
 * 两层断言:
 * 1. coerceEvents 单元:真实包裹层级(SDK Notification 序列化形 / params.event /
 *    params.sessionEvents 批 / 无事件载荷 method)逐条映射,seq/time 不伪造;
 * 2. AcpAdapter 集成:stub driver 把原始通知行透传进 NDJSON 协议,spawn 管线全流程
 *    (parseDriverLine → coerceEvents → summarize)钉住 turns/tool_calls/approval。
 */
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AcpAdapter, coerceEvents } from '../src/adapters/acp.ts'
import { messageTextOf, summarize } from '../src/events.ts'
import { parseGoldenCase } from '../src/schema.ts'
import type { SessionEventLike } from '../src/types.ts'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const SAMPLE_FILE = path.join(REPO_ROOT, 'docs/acp-real-6/notifications-sample.jsonl')
const STUB_DRIVER = new URL('./fixtures/stub-acp-raw-notifications-driver.mjs', import.meta.url).pathname

interface RawNotification {
  readonly method?: unknown
  readonly payload?: unknown
}

function loadSample(): { readonly lines: readonly string[]; readonly records: readonly RawNotification[] } {
  const lines = readFileSync(SAMPLE_FILE, 'utf8').split('\n').map(line => line.trim()).filter(line => line !== '')
  expect(lines.length).toBeGreaterThanOrEqual(10)
  return { lines, records: lines.map(line => JSON.parse(line) as RawNotification) }
}

function mapAll(records: readonly RawNotification[]): SessionEventLike[] {
  const events: SessionEventLike[] = []
  for (const record of records) events.push(...coerceEvents(record))
  return events
}

describe('coerceEvents:真实通知样本(单元)', () => {
  const { records } = loadSample()

  it('每条 session.event 通知映射出恰好 1 个事件,seq/time/type 与 wire 一致', () => {
    const sessionEventRecords = records.filter(record => record.method === 'session.event')
    expect(sessionEventRecords.length).toBeGreaterThanOrEqual(10)
    const wire = new Set(
      sessionEventRecords.map((record) => {
        const payload = record.payload as { event?: { type?: unknown; seq?: unknown; time?: unknown } }
        const event = payload.event
        return `${String(event?.type)}:${String(event?.seq)}:${String(event?.time)}`
      }),
    )
    let mappedFromSessionEvent = 0
    for (const record of sessionEventRecords) {
      const payload = record.payload as { event?: unknown }
      const mapped = coerceEvents({ method: 'session.event', payload })
      expect(mapped).toHaveLength(1)
      const event = mapped[0]
      if (event === undefined) throw new Error('session.event 通知未映射出事件')
      expect(wire.has(`${event.type}:${event.seq}:${event.time}`)).toBe(true)
      expect(Number.isInteger(event.seq)).toBe(true)
      expect(Number.isInteger(event.time)).toBe(true)
      mappedFromSessionEvent += 1
    }
    expect(mappedFromSessionEvent).toBe(sessionEventRecords.length)
  })

  it('无事件载荷的 method → ignorable driver/notification(不参与断言)', () => {
    const others = records.filter(record => record.method !== 'session.event')
    expect(others.length).toBeGreaterThan(0)
    for (const record of others) {
      const mapped = coerceEvents(record)
      expect(mapped).toHaveLength(1)
      expect(mapped[0]?.type).toBe('driver/notification')
      expect(mapped[0]?.ignorable).toBe(true)
    }
  })

  it('全样本映射 → summarize:turns/tool_calls/approval/token 齐全', () => {
    const summary = summarize(mapAll(records))
    expect(summary.eventCount).toBe(records.length) // 一条通知恰一事件(样本无批形态)
    expect(summary.turns).toBeGreaterThanOrEqual(1)
    const names = summary.toolCalls.map(call => call.name)
    expect(names).toContain('budget_calc')
    expect(names).toContain('pay_deposit')
    expect(summary.approvalsAsked.map(ask => ask.toolName)).toContain('pay_deposit')
    expect(summary.approvalsDecided.map(decision => decision.outcome)).toContain('rejected')
    expect(summary.successfulCallIds.size).toBeGreaterThanOrEqual(1) // budget_calc 成功执行
    expect(summary.totalTokens).toBeGreaterThan(0)
    expect(summary.finalAnswerText.length).toBeGreaterThan(0)
  })

  it('user/message 真实形态(data.content 直挂)能取到文本', () => {
    const userEvents = mapAll(records).filter(event => event.type === 'user/message')
    expect(userEvents.length).toBeGreaterThanOrEqual(2)
    const texts = userEvents.map(event => messageTextOf(event) ?? '')
    expect(texts.some(text => text.includes('budget_calc'))).toBe(true)
    expect(texts.some(text => text.includes('pay_deposit'))).toBe(true)
  })
})

describe('AcpAdapter:真实通知样本经 stub driver 透传(集成)', () => {
  it('spawn 管线:原始通知行 → coerceEvents → summarize 映射不再 turns=0', async () => {
    process.env.STUB_SAMPLE_FILE = SAMPLE_FILE
    const adapter = new AcpAdapter({ pythonBin: process.execPath, driverPath: STUB_DRIVER })
    const result = await adapter.run({
      caseData: parseGoldenCase('id: raw-notification-replay\nuser_input: 样本回放\n', 'memory://raw.yaml'),
      packDir: '/tmp',
      workspaceDir: '/tmp',
    })
    delete process.env.STUB_SAMPLE_FILE
    const summary = summarize(result.events)
    expect(summary.eventCount).toBeGreaterThanOrEqual(10)
    expect(summary.turns).toBeGreaterThanOrEqual(1)
    expect(summary.toolCalls.map(call => call.name)).toEqual(expect.arrayContaining(['budget_calc', 'pay_deposit']))
    expect(summary.approvalsAsked.map(ask => ask.toolName)).toContain('pay_deposit')
    expect(summary.approvalsDecided.map(decision => decision.outcome)).toContain('rejected')
  })
})
