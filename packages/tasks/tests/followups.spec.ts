/**
 * 人的后续消息直达 worker 与交回(35 号 A9 验收门禁;34 §4-D followups 行)。
 *
 * 门禁面(34 §4-D 原文):人消息直达 worker 不起 Eval、handback 回 Eval、结束工单被追问恢复
 * (R5 后半:追认可恢复结案工单)。依据条款:24 §5.1 三条约束·Report←Assignment(工人只报
 * 六态、消息经工单扇出)、§5.3-3、27 号 §1.2 表「汇报对象」与 §3.3-C(重复投递收敛)、
 * 34 §2.1 model 行(谓词 followupOwners 原样保留——P0 Attention 台账建在其上)。
 * 本文件对账的断言(语义自 SA tests/followups.spec.ts 重写级校对移植为 Engine 级:
 * SA 的 relay/notice/card 面属其 app 层,34 §0 明确不移植;本包保证数据面):
 * - 直达:订阅线程上人的后续消息作为 Input 到达在跑工单并投递其 worker,不进 Eval、无
 *   Decision、防抖队列保持空闲;主会话对它只能 stop(workerDecides);
 * - 对照面:到达不了任何工单的人消息(只有被人 stop 的工单、或无人订阅的线程)照常进 Eval;
 *   bot/CI 的消息即使扇出给在跑工单也进 Eval(followupOwners 只认人的消息);
 * - handback:worker 判定超出工单 → 记录 handback(一次、附理由)、放开裁决权,无其他工单
 *   裁决时排回 Eval(gate 强度);二交拒绝、未到达拒绝、订阅保留、不可 attach 回原工单;
 * - 恢复:ready 结束的工单被同线程人的追问恢复(R5 后半;stop 的不恢复)。
 */
import { describe, expect, it, vi } from 'vitest'
import { Engine, MemoryRepositories, UserError, followupOwners, runningAssignment } from '../src/index.ts'
import type {
  Assignment, Assessor, Candidate, EngineOptions, Executor, Outcome, Outbox, OutboundMessage, Policy, Ticket, Trigger,
} from '../src/index.ts'

const member = { source: 'chat', id: 'alice' }
const guest = { source: 'chat', id: 'guest' }
const REALM = 'tenant-a'
/** R3 委派四要素(35 号 A7):本 spec 的 accept 一律带齐。 */
const DELEGATION = { objective: '修复登录页在移动端的崩溃', outputFormat: 'Git 补丁', toolGuidance: '仓库内编辑器与测试', taskBoundaries: '不改依赖与公共 API' }

function trigger(id: string, overrides: Partial<Trigger> = {}): Trigger {
  return { id, source: 'chat', threads: [{ source: 'chat', id: 't1' }], actor: member, human: true, at: `2026-09-23T00:00:${id.padStart(2, '0')}Z`, text: `message ${id}`,
    channel: { source: 'chat', thread: 't1', address: { message: id } }, meta: {}, ...overrides }
}
function harness(policyOverrides: Partial<Policy> = {}) {
  const repo = new MemoryRepositories()
  const outbox: OutboundMessage[] = []
  const requests: Candidate[] = []
  const request = vi.fn((candidate: Candidate) => { requests.push(candidate) })
  const release = vi.fn()
  const assessor: Assessor = { request, release }
  const launches: [Ticket, Assignment][] = []
  const delivered: [string, string][] = []
  const deliveries = new Set<string>()
  const start = vi.fn((ticket: Ticket, assignment: Assignment) => { launches.push([ticket, assignment]) })
  const deliver = vi.fn((ticket: Ticket) => { deliveries.add(ticket.id) })
  const stop = vi.fn()
  const executor: Executor = { start, deliver, stop }
  const paused = false
  let version = 'v1'
  const policy: Policy = {
    get version() { return version }, get paused() { return paused }, evalTimeoutMs: 60_000,
    gate: (t, thread) => !t.human ? { admissible: false, reason: 'not human' }
      : t.actor.id === 'alice' ? { admissible: true, strength: 'explicit', basis: { via: 'listed' } }
        : thread.subscriptions.length ? { admissible: true, strength: 'inferred', basis: { via: 'followup' } } : { admissible: false, reason: 'not a member' },
    revalidate: () => version !== 'revoked',
    admitsInferred: rules => rules.length > 0,
    ...policyOverrides,
  }
  let clock = 0
  const scope: EngineOptions['scope'] = { scope: () => ({ listened: true, observed: false }) }
  const queued: Outbox = {
    send: (message) => { if (!outbox.some(item => item.id === message.id)) outbox.push(message) },
    status: id => outbox.some(item => item.id === id) ? 'pending' : undefined,
    withdraw: vi.fn(),
  }
  const engine = new Engine({ repo, scope, policy: () => policy, assessor, executor, outbox: queued,
    realmOf: () => REALM, now: () => new Date(Date.UTC(2026, 9, 23, 0, 0, clock)).toISOString() })
  function settle() {
    for (;;) {
      const next = launches.shift()
      if (next) { engine.assignmentStarted(next[0].id, next[1].id); continue }
      const [ticketId] = deliveries
      if (ticketId === undefined) return
      deliveries.delete(ticketId)
      const ticket = repo.tickets.get(ticketId)!
      const assignment = runningAssignment(ticket)
      if (ticket.ended || !assignment) continue
      for (const inputId of ticket.undelivered) {
        delivered.push([ticketId, inputId]); engine.inputsDelivered(ticketId, assignment.id, [inputId])
      }
    }
  }
  const pump = () => { engine.evaluateDue(); settle() }
  const decide = (candidate: Candidate, outcome: Outcome) =>
    engine.decide(candidate.triggers[0]!.id, { ...outcome, evalId: candidate.evalId })
  return { repo, engine, outbox, requests, release, start, stop, delivered, settle, pump, decide,
    setVersion: (value: string) => { version = value }, tick: (seconds: number) => { clock += seconds } }
}
/** 建一张已 accept 并 settle 的工单:trigger `id`(默认 '1')落在线程 `thread`(默认 't1')。 */
function accepted(h: ReturnType<typeof harness>, id = '1', thread = 't1') {
  h.engine.receive(trigger(id, { threads: [{ source: 'chat', id: thread }] })); h.pump()
  const decision = h.decide(h.requests.at(-1)!, { kind: 'accept', title: 'Fix', scope: 'small', reason: 'requested', delegation: DELEGATION })
  h.settle()
  return decision
}

describe('人消息直达 worker,不起 Eval(34 §4-D 第一句)', () => {
  it('订阅线程上人的后续消息(含名单外)直达在跑工单:Input 投递 worker,无候选、无 Decision、队列空闲', () => {
    const h = harness()
    const decision = accepted(h)
    const requests = h.requests.length
    h.engine.receive(trigger('2', { actor: guest }))
    h.settle()
    const ticket = h.repo.tickets.get(decision.ticketId!)!
    const input = ticket.inputs[0]
    expect(input).toMatchObject({ kind: 'trigger', triggerId: '2', human: true })
    expect(input && input.kind === 'trigger' ? input.context : undefined).toBeUndefined()
    expect(input && input.kind === 'trigger' ? input.readAt : undefined).toBeNull()
    expect(h.delivered).toEqual([[ticket.id, input!.id]])
    expect(h.repo.triggers.disposition('2')).toEqual({ fanout: [ticket.id], realm: REALM, at: '2026-10-23T00:00:00.000Z' })
    // 不起 Eval:无候选请求,防抖队列空闲,无新 Decision;裁决权在 worker(followupOwners)。
    expect(h.requests).toHaveLength(requests)
    expect(h.repo.threads.get('chat:t1')).toMatchObject({ pending: [] })
    expect(h.repo.threads.get('chat:t1')).not.toHaveProperty('evaluating')
    expect(followupOwners(h.repo.triggers.get('2')!, h.repo)).toEqual([ticket.id])
    expect(h.repo.decisions.byThread('chat:t1')).toHaveLength(1)
  })
  it('主会话对直达消息只能 stop 该工单(workerDecides);stop 后同一消息可作新工作开票', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    h.engine.receive(trigger('2')); h.settle()
    const acceptY = { kind: 'accept' as const, title: 'Y', scope: 'small', reason: 'requested', delegation: DELEGATION }
    expect(() => h.engine.decide('2', acceptY)).toThrow(new UserError('workerDecides', { tickets: ticketId }))
    expect(h.engine.decide('2', { kind: 'stop', ticketId, reason: 'asked to stop' }).kind).toBe('stop')
    expect(h.repo.tickets.get(ticketId)).toMatchObject({ ended: { by: 'human', outcome: 'stopped' } })
    expect(h.engine.decide('2', acceptY)).toMatchObject({ kind: 'accept', triggerIds: ['2'] })
    expect(h.repo.tickets.list()).toHaveLength(2)
  })
  it('对照面:到达不了任何工单的人消息照常进 Eval——被人 stop 的工单的线程上,或无人订阅的线程上', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    h.engine.stopTicket(ticketId)
    h.engine.receive(trigger('2')); h.pump()
    expect(h.requests.at(-1)).toMatchObject({ triggers: [expect.objectContaining({ id: '2' })] })
    h.engine.receive(trigger('3', { threads: [{ source: 'chat', id: 'elsewhere' }] })); h.pump()
    expect(h.requests.at(-1)).toMatchObject({ triggers: [expect.objectContaining({ id: '3' })] })
    expect(h.repo.tickets.get(ticketId)).toMatchObject({ ended: { by: 'human' }, inputs: [] })
  })
  it('对照面:bot/CI 的消息即使扇出给在跑工单也进 Eval(followupOwners 只认人的消息),worker 仍可读它', () => {
    const h = harness()
    const decision = accepted(h)
    const requests = h.requests.length
    h.engine.receive(trigger('2', { human: false }))
    h.settle()
    const ticket = h.repo.tickets.get(decision.ticketId!)!
    // 扇出照常(worker 可读),但照常排队等 Eval(gate 拒之 → 直接记 ignore,不起 assessor),不产生工单。
    expect(ticket.inputs.some(input => input.kind === 'trigger' && input.triggerId === '2')).toBe(true)
    expect(followupOwners(h.repo.triggers.get('2')!, h.repo)).toEqual([])
    h.pump()
    expect(h.requests).toHaveLength(requests)
    expect(h.repo.decisions.byThread('chat:t1').at(-1)).toMatchObject({ kind: 'ignore', triggerIds: ['2'] })
    expect(h.repo.tickets.list()).toHaveLength(1)
  })
})

describe('handback 回 Eval(34 §4-D 第二句:worker 判定超出工单)', () => {
  it('交回记录一次(附理由与时刻)并排回 Eval:gate 按消息强度给候选;订阅保留,消息仍归原线程防抖队列', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    h.engine.receive(trigger('2')); h.engine.receive(trigger('3', { actor: guest })); h.pump()
    expect(h.engine.handback(ticketId, '2', 'A new request')).toBe(true)
    h.pump()
    expect(h.repo.triggers.disposition('2')!.handbacks).toEqual([{ ticketId, reason: 'A new request', at: '2026-10-23T00:00:00.000Z' }])
    expect(h.requests.at(-1)).toMatchObject({ strength: 'explicit', triggers: [expect.objectContaining({ id: '2' })] })
    // 订阅保留:工单仍收到该线程上的消息(每张工单对收到过的消息保有裁决记录)。
    expect(h.repo.threads.get('chat:t1')!.subscriptions).toContain(ticketId)
    // 裁决掉 '2' 的候选,释放线程;'3' 的交回才能重排(每线程至多一个进行中 Eval)。
    h.decide(h.requests.at(-1)!, { kind: 'ignore', reason: 'chat' })
    // 第二条:guest 的消息交回后以推断强度进 Eval。
    expect(h.engine.handback(ticketId, '3', 'A guest asks for more')).toBe(true)
    h.pump()
    expect(h.requests.at(-1)).toMatchObject({ strength: 'inferred', triggers: [expect.objectContaining({ id: '3' })] })
  })
  it('拒绝面:二交拒绝(handedBack)、未到达该工单拒绝(notReached)、交回后不可 attach 回原工单(handedBackHere)', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    h.engine.receive(trigger('2')); h.pump()
    expect(h.engine.handback(ticketId, '2', 'Beyond this ticket')).toBe(true); h.pump()
    expect(() => h.engine.handback(ticketId, '2', 'Again')).toThrow(new UserError('handedBack'))
    h.engine.receive(trigger('3', { threads: [{ source: 'chat', id: 'elsewhere' }] }))
    expect(() => h.engine.handback(ticketId, '3', 'Not mine')).toThrow(new UserError('notReached'))
    expect(() => h.engine.handback('missing', '2', 'x')).toThrow(new UserError('unknownTicket'))
    expect(() => h.engine.attach(ticketId, '2')).toThrow(new UserError('handedBackHere'))
  })
  it('仅上下文跟随线程上的消息:交回只记录不重排(从未裁决过它),消息在候选卡上交由主会话评估', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    h.engine.followForContext(ticketId, { source: 'chat', id: 'issue' })
    h.engine.receive(trigger('2', { threads: [{ source: 'chat', id: 'issue' }] })); h.pump()
    expect(followupOwners(h.repo.triggers.get('2')!, h.repo)).toEqual([])
    expect(h.engine.handback(ticketId, '2', 'Not this ticket')).toBe(false)
    expect(h.repo.triggers.disposition('2')!.handbacks).toEqual([{ ticketId, reason: 'Not this ticket', at: '2026-10-23T00:00:00.000Z' }])
    expect(h.requests.at(-1)).toMatchObject({ triggers: [expect.objectContaining({ id: '2' })] })
  })
})

describe('结束工单被追问恢复(34 §4-D 第三句:R5 后半)', () => {
  it('ready 结束的工单被同线程人的追问恢复:同 Mandate、无新 Eval/Decision,resumed 注记先于消息投递', () => {
    const h = harness()
    const decision = accepted(h)
    const ticketId = decision.ticketId!
    h.engine.report(ticketId, { state: 'ready', summary: 'done' })
    const requests = h.requests.length
    h.engine.receive(trigger('2', { actor: guest }))
    expect(h.repo.tickets.get(ticketId)!.ended).toBeUndefined()
    h.pump()
    const ticket = h.repo.tickets.get(ticketId)!
    expect(ticket.assignments).toHaveLength(2)
    expect(ticket.mandate).toEqual(decision.mandate)
    expect(ticket.inputs.map(input => input.kind)).toEqual(['trigger', 'resumed'])
    expect(h.requests).toHaveLength(requests)
    expect(h.repo.decisions.byThread('chat:t1').filter(item => item.kind !== 'ignore')).toEqual([decision])
  })
  it('被人 stop 的工单保持结束;Mandate 失效的结案工单也保持结束(refuse),追问消息改道进 Eval', () => {
    const h = harness()
    const stopped = accepted(h).ticketId!
    h.engine.stopTicket(stopped)
    const completed = accepted(h, '3', 't3').ticketId!
    h.engine.report(completed, { state: 'ready', summary: 'done' })
    h.setVersion('revoked')
    h.engine.receive(trigger('2')); h.pump()
    h.engine.receive(trigger('4', { threads: [{ source: 'chat', id: 't3' }] })); h.pump()
    expect(h.repo.tickets.get(stopped)).toMatchObject({ ended: { by: 'human' }, inputs: [] })
    expect(h.repo.tickets.get(completed)).toMatchObject({ ended: { by: 'executor', outcome: 'completed' }, undelivered: [] })
    // 两条追问都没有工单裁决:都进了 Eval 等主会话。
    expect(h.requests.slice(-2).map(item => item.triggers[0]!.id)).toEqual(['2', '4'])
  })
  it('Policy 恢复后的追问恢复结案工单:幂等(多次 pass 只恢复一次),同一 Mandate 另起 Assignment', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    h.engine.report(ticketId, { state: 'ready', summary: 'done' })
    h.setVersion('revoked')
    h.engine.receive(trigger('2', { actor: guest })); h.pump()
    expect(h.repo.tickets.get(ticketId)!.ended).toBeDefined()
    h.setVersion('v1')
    h.engine.receive(trigger('3', { actor: guest }))
    h.pump(); h.pump()
    const ticket = h.repo.tickets.get(ticketId)!
    expect(ticket.ended).toBeUndefined()
    expect(ticket.assignments).toHaveLength(2)
    expect(ticket.inputs.filter(input => input.kind === 'resumed')).toHaveLength(1)
    expect(h.start).toHaveBeenCalledTimes(2)
  })
})
