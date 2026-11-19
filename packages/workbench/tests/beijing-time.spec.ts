/**
 * 北京时间展示(2026-11-19 用户反馈「时间戳也有问题,我需要北京时间」):
 * 工作台的日志、工单前链 trace 与事件环时间一律按北京时间(UTC+8)显示,
 * 不再直接切 ISO 串的 UTC 段。
 */
import { expect, it } from 'vitest'
import type { AuditRecord } from '@eterna/governance'
import type { DomainEvent, Ticket } from '@eterna/tasks'
import { beijingParts } from '../src/project/time.ts'
import { traceEntriesForTicket, type AuditDayFile } from '../src/project/trace-files.ts'
import { ticketTraceEntries, type TicketTraceStore } from '../src/project/ticket-trace.ts'
import { flowRingItemOf } from '../src/project/live-sections.ts'

it('beijingParts:UTC ISO → 北京时间(恒 UTC+8,跨日进位)', () => {
  expect(beijingParts('2026-11-19T09:36:24.503Z')).toEqual({
    year: '2026', month: '11', day: '19', hour: '17', minute: '36', second: '24',
  })
  expect(beijingParts('2026-11-19T16:30:00.000Z')).toMatchObject({ month: '11', day: '20', hour: '00', minute: '30' })
  expect(beijingParts(undefined)).toBeUndefined()
  expect(beijingParts('not-a-date')).toBeUndefined()
})

it('audit trace 行与事件环显示北京时间(不是 UTC 切片)', () => {
  const records = [{ kind: 'tool-call', at: '2026-11-19T09:36:24.503Z', tool: 'bash', argsPreview: '.ticket/T-1/ ls' }]
  const files: AuditDayFile[] = [{ name: 'audit-20261119.jsonl', records: records as unknown as readonly AuditRecord[] }]
  const entries = traceEntriesForTicket(files, 'T-1')
  expect(entries).toHaveLength(1)
  expect(entries[0]!.time).toBe('11-19 17:36')

  const event = { type: 'trigger.received', at: '2026-11-19T09:36:24.503Z', data: { triggerId: 't-1' } } as unknown as DomainEvent
  expect(flowRingItemOf(event).line[0]).toEqual({ text: '17:36 · ', num: true })
})

it('工单前链 trace 的 clock 为北京时间 HH:mm:ss', () => {
  const store = {
    triggers: { get: () => ({ id: 't-1', at: '2026-11-19T09:36:24.503Z', text: 'x', actor: { id: 'a' } }) },
    decisions: { get: () => undefined },
    db: { prepare: () => ({ all: () => [] }) },
  } as unknown as TicketTraceStore
  const ticket = {
    id: 'T-1', decisionId: 'd-1', origin: { triggerId: 't-1' },
    createdAt: '2026-11-19T10:00:00.000Z', assignments: [],
  } as unknown as Ticket
  expect(ticketTraceEntries(store, ticket).map(entry => entry.time)).toEqual(['17:36:24', '18:00:00'])
})
