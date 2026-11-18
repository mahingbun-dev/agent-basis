/**
 * 领域模型代表性用例(35 号 A3「model 代表性用例」)。
 *
 * 覆盖面:
 * - realm 改造的类型面钉住(34 §2.1 model 行):Mandate/Ticket 必含 realm,ThreadRef/Trigger 不含;
 * - 两大不变量谓词原样保留的语义面:followupOwners(SA model.ts:75-88)与 waitsForPerson
 *   (SA model.ts:349-353)逐分支断言——P0 台账与 28 §6「等谁」可见化建在其上;
 * - 其余导出(threadKey/isoTime/settled/reached/readUntil/latestReport/生存期小函数/ids.key)抽查。
 * Engine 全流程用例归 tests/core-engine.spec.ts(35 号 A5)。
 */
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  followupOwners, isoTime, key, latestAssignment, latestReport, liveTicket, readUntil, reached, runningAssignment,
  settled, threadKey, ticketOutcome, waitsForPerson,
  type Assignment, type Decision, type DecisionKind, type Evaluation, type FollowupRecords, type Mandate,
  type Reason, type ReportState, type Thread, type ThreadRef, type Ticket, type TicketInput, type Trigger,
  type TriggerDisposition,
} from '../src/index.ts'

// ── realm 改造(34 §2.1 / 24a A1「realm 进内核模型」)────────────────────────────────────────

describe('realm 字段(类型面钉住)', () => {
  it('Mandate 与 Ticket 必含必填 realm: string', () => {
    expectTypeOf<Mandate>().toHaveProperty('realm').toEqualTypeOf<string>()
    expectTypeOf<Ticket>().toHaveProperty('realm').toEqualTypeOf<string>()
  })
  it('ThreadRef 与 Trigger 不含 realm(由 intake 经 realmOf 注入后落库,不进 Source 事件面)', () => {
    expectTypeOf<ThreadRef>().not.toHaveProperty('realm')
    expectTypeOf<Trigger>().not.toHaveProperty('realm')
  })
})

// ── fixture ────────────────────────────────────────────────────────────────────────────────

const threadOf = (key: string, overrides: Partial<Thread> = {}): Thread => ({
  key,
  ref: { source: 'feishu', id: key },
  createdAt: '',
  subscriptions: [],
  correlated: [],
  pending: [],
  meta: {},
  ...overrides,
})
const evaluation = (triggerIds: string[]): Evaluation => ({
  id: 'ev-1', threadKey: 'feishu:th-1', triggerIds, strength: 'explicit',
  actor: { source: 'feishu', id: 'ou-1' }, basis: { via: 'listed' }, policyVersion: 'v1', startedAt: '', deadline: '',
})
interface RecordSets { tickets?: Ticket[]; threads?: Thread[]; dispositions?: [string, TriggerDisposition][] }
const records = (options: RecordSets = {}): FollowupRecords => {
  const dispositions = new Map<string, TriggerDisposition>(options.dispositions ?? [])
  return {
    tickets: { get: id => options.tickets?.find(ticket => ticket.id === id) },
    threads: { get: key => options.threads?.find(thread => thread.key === key) },
    triggers: { disposition: id => dispositions.get(id) },
  }
}
const trigger = (overrides: Partial<Trigger> = {}): Trigger => ({
  id: 'tg-1', source: 'feishu', threads: [{ source: 'feishu', id: 'th-1' }], actor: { source: 'feishu', id: 'ou-1' },
  human: true, at: '2026-01-01T00:00:00.000Z', text: '帮我看一下', meta: {}, ...overrides,
})
const ticket = (id: string, overrides: Partial<Ticket> = {}): Ticket => ({
  id, title: '工单', decisionId: 'd-1', realm: 'tenant-a',
  mandate: { strength: 'explicit', policyVersion: 'v1', realm: 'tenant-a', basis: { via: 'listed' }, actor: { source: 'feishu', id: 'ou-1' }, scope: '' },
  channels: [], assignments: [], inputs: [], undelivered: [], createdAt: '', updatedAt: '',
  origin: { triggerId: 'tg-0', triggerIds: ['tg-0'] }, ...overrides,
})

// ── followupOwners(SA model.ts:75-88,原样保留)────────────────────────────────────────────

describe('followupOwners', () => {
  const primaryThread = threadOf('feishu:th-1')

  it('bot 消息(非 human)没有 owner', () => {
    const bot = trigger({ human: false })
    const live = ticket('t-live')
    expect(followupOwners(bot, records({ tickets: [live], threads: [primaryThread], dispositions: [[bot.id, { fanout: ['t-live'], at: '' }]] }))).toEqual([])
  })

  it('无 disposition 的消息没有 owner', () => {
    expect(followupOwners(trigger(), records({ tickets: [ticket('t-live')], threads: [primaryThread] }))).toEqual([])
  })

  it('被重发给 Eval(requeued)的消息没有 owner', () => {
    const t = trigger()
    expect(followupOwners(t, records({
      tickets: [ticket('t-live')], threads: [primaryThread],
      dispositions: [[t.id, { fanout: ['t-live'], requeued: true, at: '' }]],
    }))).toEqual([])
  })

  it('被 handback 交回的工单不再是 owner,其余存活工单仍是', () => {
    const t = trigger()
    expect(followupOwners(t, records({
      tickets: [ticket('t-live'), ticket('t-back')], threads: [primaryThread],
      dispositions: [[t.id, { fanout: ['t-live', 't-back'], handbacks: [{ ticketId: 't-back', reason: 'beyond', at: '' }], at: '' }]],
    }))).toEqual(['t-live'])
  })

  it('仅以 context 到达的工单不是 owner', () => {
    const t = trigger()
    expect(followupOwners(t, records({
      tickets: [ticket('t-live'), ticket('t-ctx')], threads: [primaryThread],
      dispositions: [[t.id, { fanout: ['t-ctx', 't-live'], context: ['t-ctx'], at: '' }]],
    }))).toEqual(['t-live'])
  })

  it('fanout 排空(handback 与 context 全排除)后没有 owner', () => {
    const t = trigger()
    expect(followupOwners(t, records({
      tickets: [ticket('t-back')], threads: [primaryThread],
      dispositions: [[t.id, { fanout: ['t-back'], handbacks: [{ ticketId: 't-back', reason: 'beyond', at: '' }], at: '' }]],
    }))).toEqual([])
  })

  it('主线程的 Eval 正持有该消息时没有 owner;Eval 持有的是别的消息时不受影响', () => {
    const t = trigger()
    const holding = records({ tickets: [ticket('t-live')], threads: [threadOf('feishu:th-1', { evaluating: evaluation(['tg-1']) })], dispositions: [[t.id, { fanout: ['t-live'], at: '' }]] })
    expect(followupOwners(t, holding)).toEqual([])
    const other = records({ tickets: [ticket('t-live')], threads: [threadOf('feishu:th-1', { evaluating: evaluation(['tg-other']) })], dispositions: [[t.id, { fanout: ['t-live'], at: '' }]] })
    expect(followupOwners(t, other)).toEqual(['t-live'])
  })

  it('被人结束的工单不再是 owner', () => {
    const t = trigger()
    const endedByHuman = ticket('t-ended', { ended: { at: '', by: 'human', outcome: 'stopped' } })
    expect(followupOwners(t, records({ tickets: [endedByHuman], threads: [primaryThread], dispositions: [[t.id, { fanout: ['t-ended'], at: '' }]] }))).toEqual([])
  })

  it('非人结束、且该 trigger 的 Input 仍未投递的工单仍是 owner(R5:追问可恢复结案工单)', () => {
    const t = trigger()
    const resumable = ticket('t-resume', {
      ended: { at: '', by: 'executor', outcome: 'completed' },
      inputs: [{ id: 'in-1', kind: 'trigger', triggerId: 'tg-1', at: '' }],
      undelivered: ['in-1'],
    })
    expect(followupOwners(t, records({ tickets: [resumable], threads: [primaryThread], dispositions: [[t.id, { fanout: ['t-resume'], at: '' }]] }))).toEqual(['t-resume'])
  })

  it('非人结束、但该 trigger 已投递给 worker 的工单不是 owner', () => {
    const t = trigger()
    const delivered = ticket('t-delivered', {
      ended: { at: '', by: 'executor', outcome: 'completed' },
      inputs: [{ id: 'in-1', kind: 'trigger', triggerId: 'tg-1', at: '' }],
      undelivered: [],
    })
    expect(followupOwners(t, records({ tickets: [delivered], threads: [primaryThread], dispositions: [[t.id, { fanout: ['t-delivered'], at: '' }]] }))).toEqual([])
  })

  it('fanout 里不存在的工单 id 被忽略', () => {
    const t = trigger()
    expect(followupOwners(t, records({ threads: [primaryThread], dispositions: [[t.id, { fanout: ['ghost'], at: '' }]] }))).toEqual([])
  })
})

// ── waitsForPerson(SA model.ts:349-353,原样保留)──────────────────────────────────────────

describe('waitsForPerson', () => {
  const report = (state: ReportState, at = '2026-02-01T00:00:00.000Z'): Assignment => ({ id: 'a-1', state: 'running', createdAt: '', report: { state, summary: '', at } })
  const humanInput = (at: string, extra: Partial<Extract<TicketInput, { kind: 'trigger' }>> = {}): TicketInput => ({ id: 'i-1', kind: 'trigger', triggerId: 'tg-9', at, human: true, ...extra })

  it('最新 Assignment 报 blocked 且其后无人消息 → 等', () => {
    expect(waitsForPerson(ticket('t-1', { assignments: [report('blocked')] }))).toBe(true)
  })
  it('最新 Assignment 报 failed 且其后无人消息 → 等', () => {
    expect(waitsForPerson(ticket('t-1', { assignments: [report('failed')] }))).toBe(true)
  })
  it('blocked 之后有人的非 context 消息 → 不再等(工单交还 executor)', () => {
    expect(waitsForPerson(ticket('t-1', { assignments: [report('blocked')], inputs: [humanInput('2026-03-01T00:00:00.000Z')] }))).toBe(false)
  })
  it('人的消息早于报告 → 仍在等(只有更晚的消息才解除)', () => {
    expect(waitsForPerson(ticket('t-1', { assignments: [report('blocked')], inputs: [humanInput('2026-01-01T00:00:00.000Z')] }))).toBe(true)
  })
  it('人的 context 消息不解除等待', () => {
    expect(waitsForPerson(ticket('t-1', { assignments: [report('failed')], inputs: [humanInput('2026-03-01T00:00:00.000Z', { context: true })] }))).toBe(true)
  })
  it('非人消息(bot)不解除等待', () => {
    const bot: TicketInput = { id: 'i-2', kind: 'trigger', triggerId: 'tg-9', at: '2026-03-01T00:00:00.000Z' }
    expect(waitsForPerson(ticket('t-1', { assignments: [report('failed')], inputs: [bot] }))).toBe(true)
  })
  it.each(['progress', 'ready', 'waiting'] as const)('最新报告为 %s → 不等', (state) => {
    expect(waitsForPerson(ticket('t-1', { assignments: [report(state)] }))).toBe(false)
  })
  it('重试开启的新 Assignment(尚无报告)解除等待——latestAssignment 取最后一个', () => {
    const retried: Assignment[] = [report('failed'), { id: 'a-2', state: 'pending', createdAt: '' }]
    expect(waitsForPerson(ticket('t-1', { assignments: retried }))).toBe(false)
  })
  it('没有 Assignment → 不等', () => {
    expect(waitsForPerson(ticket('t-1'))).toBe(false)
  })
})

// ── settled / threadKey / isoTime / ids.key ────────────────────────────────────────────────

describe('settled', () => {
  const decision = (kind: DecisionKind, reason: Reason[] = []): Pick<Decision, 'kind' | 'reason'> => ({ kind, reason })
  it.each(['stop', 'unavailable'] as const)('%s 未裁决人所求', (kind) => {
    expect(settled(decision(kind))).toBe(false)
  })
  it.each(['stopNotExplicit', 'stopUnknown', 'routed'] as const)('理由 %s 同样未裁决', (code) => {
    expect(settled(decision('accept', [{ code }]))).toBe(false)
  })
  it('accept/ignore/reopen 与开放码表外的理由 → 已裁决', () => {
    expect(settled(decision('accept'))).toBe(true)
    expect(settled(decision('ignore', [{ code: 'said', values: { text: 'x' } }]))).toBe(true)
    expect(settled(decision('reopen', [{ code: 'customGateCode' }]))).toBe(true)
  })
})

describe('threadKey 与 isoTime', () => {
  it('threadKey 为 source:id 形态的稳定键', () => {
    expect(threadKey({ source: 'feishu', id: 'ot_1' })).toBe('feishu:ot_1')
  })
  it('isoTime 把合法时间戳归一为 toISOString,便于字典序比较', () => {
    expect(isoTime('2026-01-02T10:00:00+08:00')).toBe('2026-01-02T02:00:00.000Z')
    expect(isoTime('2026-01-02T02:00:00.000Z')).toBe('2026-01-02T02:00:00.000Z')
  })
  it('无法解析为时间戳的值原样返回', () => {
    expect(isoTime('not-a-timestamp')).toBe('not-a-timestamp')
  })
})

describe('ids.key(内容派生稳定 id)', () => {
  it('同输入同 id、顺序敏感、32 位十六进制', () => {
    expect(key('a', 'b')).toBe(key('a', 'b'))
    expect(key('a', 'b')).not.toBe(key('b', 'a'))
    expect(key('x')).toMatch(/^[0-9a-f]{32}$/)
  })
})

// ── reached / readUntil / latestReport / 生存期小函数 ─────────────────────────────────────

describe('reached', () => {
  it('开启工单的 trigger(origin)到达该工单', () => {
    const origin = trigger({ id: 'tg-7' })
    expect(reached(ticket('t-1', { origin: { triggerId: 'tg-7', triggerIds: ['tg-7'] } }), origin, () => undefined)).toBe(true)
  })
  it('作为 Input 到达工单的 trigger 到达该工单', () => {
    const input = trigger({ id: 'tg-7' })
    const t = ticket('t-1', { inputs: [{ id: 'in-1', kind: 'trigger', triggerId: 'tg-7', at: '' }] })
    expect(reached(t, input, () => undefined)).toBe(true)
  })
  it('落在工单订阅线程上的 trigger 到达该工单;context=false 时 context 线程不算', () => {
    const onThread = trigger({ id: 'tg-7', threads: [{ source: 'feishu', id: 'th-9' }] })
    const t = ticket('t-1')
    const threads = (key: string): Thread | undefined => (key === 'feishu:th-9' ? threadOf(key, { subscriptions: ['t-1'], context: ['t-1'] }) : undefined)
    expect(reached(t, onThread, threads)).toBe(true)
    expect(reached(t, onThread, threads, false)).toBe(false)
  })
  it('trigger 来自工单仅以 context 跟随的线程且非其 Input → context=false 时不到达', () => {
    const contextual = trigger({ id: 'tg-8', threads: [{ source: 'feishu', id: 'th-c' }] })
    const threads = (key: string): Thread | undefined => (key === 'feishu:th-c' ? threadOf(key, { subscriptions: ['t-1'], context: ['t-1'] }) : undefined)
    expect(reached(ticket('t-1'), contextual, threads, false)).toBe(false)
  })
})

describe('readUntil 与 latestReport', () => {
  it('latestReport 取最后一个有报告的 Assignment;readUntil 取其时刻与各轮 idleAt 的最晚者', () => {
    const t = ticket('t-r', {
      assignments: [
        { id: 'a-1', state: 'ended', createdAt: '', report: { state: 'ready', summary: '', at: '2026-01-01T00:00:00.000Z' }, idleAt: '2026-01-01T00:00:00.000Z' },
        { id: 'a-2', state: 'ended', createdAt: '', idleAt: '2026-01-02T00:00:00.000Z' },
      ],
    })
    expect(latestReport(t)?.state).toBe('ready')
    expect(readUntil(t)).toBe('2026-01-02T00:00:00.000Z')
  })
  it('progress=false 时跳过 progress 报告,只算轮次结束', () => {
    const t = ticket('t-p', {
      assignments: [{ id: 'a-1', state: 'running', createdAt: '', report: { state: 'progress', summary: '', at: '2026-03-01T00:00:00.000Z' } }],
    })
    expect(latestReport(t)?.state).toBe('progress')
    expect(readUntil(t)).toBe('2026-03-01T00:00:00.000Z')
    expect(readUntil(t, false)).toBe('')
  })
})

describe('生存期小函数', () => {
  it('liveTicket / ticketOutcome / runningAssignment / latestAssignment', () => {
    const open = ticket('t-1')
    expect(liveTicket(open)).toBe(true)
    expect(ticketOutcome(open)).toBeUndefined()
    expect(runningAssignment(open)).toBeUndefined()
    const closed = ticket('t-2', {
      ended: { at: '', by: 'human', outcome: 'stopped' },
      assignments: [{ id: 'a-9', state: 'running', createdAt: '' }, { id: 'a-10', state: 'pending', createdAt: '' }],
    })
    expect(liveTicket(closed)).toBe(false)
    expect(ticketOutcome(closed)).toBe('stopped')
    expect(runningAssignment(closed)?.id).toBe('a-9')
    expect(latestAssignment(closed)?.id).toBe('a-10')
  })
  it('fixture 携带 realm 改造字段(Mandate 与 Ticket 同租户)', () => {
    const t = ticket('t-realm')
    expect(t.realm).toBe('tenant-a')
    expect(t.mandate.realm).toBe('tenant-a')
  })
})
