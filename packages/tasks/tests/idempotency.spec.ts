/**
 * intake 幂等三态与幂等键收敛(35 号 A6 验收门禁;34 §4-A intake 行)。
 *
 * 门禁面(33 号 §1.3 G2-E3 的 tasks 半边;35 号 A6 原文):
 * - `receive` 幂等三态 stored/duplicate/filtered 原样(SA intake.ts:19-62);
 * - 重复投递(重试/重放)经幂等键收敛为一单——`Engine.receive → duplicate`(G2-E3 判据原文);
 *   依据条款:24 §5.3-1(幂等 id 不变量)、27 号 §3.2-②(幂等键机制)、§3.3-C(重复投递收敛为一单);
 * - ★realm 标注(24a A1「realm 进内核模型」;34 §2.1 intake 行):Trigger 保存前经 realmOf 标注,
 *   stored 与 filtered 两条路径都标注,duplicate 不重复写(首写为准)。
 * 具名断言(core-engine.spec.ts 的 duplicate 行之外,本文件对账 G2-E3 具名文件):
 * 三态落库、同 id 重投不二扇出不二排队不重写处置、已开票 Trigger 的重放收敛回原工单、
 * 输入与回执的确定性幂等 id 同 id 只排一次。
 */
import { describe, expect, it, vi } from 'vitest'
import { Engine, MemoryRepositories, UserError, key, runningAssignment } from '../src/index.ts'
import type {
  Assignment, Assessor, Candidate, EngineOptions, Executor, Outcome, Outbox, OutboundMessage, Policy, Ticket, Trigger,
} from '../src/index.ts'

const member = { source: 'chat', id: 'alice' }
const guest = { source: 'chat', id: 'guest' }
/** 默认租户 realm;某条 Trigger 的 realm 以 meta.realm 覆盖(harness 的 realmOf 读它)。 */
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
  const withdrawn: string[] = []
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
  const scope: EngineOptions['scope'] = { scope: t => t.meta.blocked ? { listened: false, reason: 'chat not allowed' } : { listened: true, observed: false } }
  const queued: Outbox = {
    send: (message) => { if (!outbox.some(item => item.id === message.id)) outbox.push(message) },
    status: id => outbox.some(item => item.id === id) ? 'pending' : undefined,
    withdraw: (id) => { withdrawn.push(id) },
  }
  const engine = new Engine({ repo, scope, policy: () => policy, assessor, executor, outbox: queued,
    realmOf: t => (typeof t.meta.realm === 'string' ? t.meta.realm : REALM),
    now: () => new Date(Date.UTC(2026, 8, 23, 0, 0, clock)).toISOString() })
  /** 模拟 Executor 启动排队的 Assignment 并投递工单等待中的 Inputs。 */
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
  return { repo, engine, outbox, withdrawn, requests, request, release, start, stop, delivered, settle, pump, decide,
    setVersion: (value: string) => { version = value }, tick: (seconds: number) => { clock += seconds } }
}
/** 建一张已 accept 并 settle 的工单:trigger `id`(默认 '1')落在线程 `thread`(默认 't1')。 */
function accepted(h: ReturnType<typeof harness>, id = '1', thread = 't1') {
  h.engine.receive(trigger(id, { threads: [{ source: 'chat', id: thread }] })); h.pump()
  const decision = h.decide(h.requests.at(-1)!, { kind: 'accept', title: 'Fix', scope: 'small', reason: 'requested', delegation: DELEGATION })
  h.settle()
  return decision
}

describe('receive 幂等三态(stored / duplicate / filtered)', () => {
  it('三态各归其位:同 id 落库一次、Source 过滤以 filtered 处置落库,两者的 disposition 都标注 realm', () => {
    const h = harness()
    expect(h.engine.receive(trigger('1'))).toBe('stored')
    expect(h.engine.receive(trigger('1'))).toBe('duplicate')
    expect(h.engine.receive(trigger('2', { meta: { blocked: true } }))).toBe('filtered')
    expect(h.repo.triggers.disposition('1')).toMatchObject({ fanout: [], realm: REALM })
    expect(h.repo.triggers.disposition('2')).toMatchObject({ filtered: { code: 'chat not allowed' }, fanout: [], realm: REALM })
    // filtered 不扇出、不排队 Eval;stored 在其主线程排一次 Eval。
    expect(h.repo.threads.get('chat:t1')?.pending).toEqual(['1'])
    expect(h.request).not.toHaveBeenCalled()
  })
  it('realm 首参路由:realm 取 meta.realm 经 realmOf 标注落库(stored 与 filtered 两路径)', () => {
    const h = harness()
    expect(h.engine.receive(trigger('1', { meta: { realm: 'tenant-b' } }))).toBe('stored')
    expect(h.engine.receive(trigger('2', { meta: { realm: 'tenant-b', blocked: true } }))).toBe('filtered')
    expect(h.repo.triggers.disposition('1')).toMatchObject({ realm: 'tenant-b' })
    expect(h.repo.triggers.disposition('2')).toMatchObject({ realm: 'tenant-b', filtered: { code: 'chat not allowed' } })
  })
})

describe('重复投递经幂等键收敛(G2-E3 tasks 半边:Engine.receive → duplicate)', () => {
  it('同 id 重投:不重写 disposition(首写为准)、不重复扇出、不重复排队——防抖队列一条不多', () => {
    const h = harness()
    h.engine.receive(trigger('1'))
    h.engine.receive(trigger('1'))
    h.engine.receive(trigger('2', { meta: { blocked: true } }))
    h.engine.receive(trigger('2', { meta: { blocked: true } }))
    expect(h.repo.triggers.disposition('1')).toEqual({ fanout: [], realm: REALM, at: '2026-09-23T00:00:00.000Z' })
    expect(h.repo.triggers.disposition('2')).toEqual({ filtered: { code: 'chat not allowed' }, fanout: [], realm: REALM, at: '2026-09-23T00:00:00.000Z' })
    expect(h.repo.threads.get('chat:t1')?.pending).toEqual(['1'])
  })
  it('duplicate 不重复写 realm:同 id 但 meta.realm 已改的重投,落库标注保持首次值', () => {
    const h = harness()
    h.engine.receive(trigger('1'))
    expect(h.engine.receive(trigger('1', { meta: { realm: 'tenant-z' } }))).toBe('duplicate')
    expect(h.repo.triggers.disposition('1')).toMatchObject({ realm: REALM })
  })
  it('幂等键收敛为一单:已开票 Trigger 的重投不二开票;重放(reevaluate)再 accept 被指回原 Decision,全程一张工单', () => {
    const h = harness()
    const decision = accepted(h)
    expect(h.engine.receive(trigger('1'))).toBe('duplicate')
    h.engine.receive(trigger('1', { meta: { replay: true } }))
    expect(h.repo.tickets.list()).toHaveLength(1)
    // 重试/重放:人把它重发进 Eval,再 accept 也收敛回原工单的 Decision(startedTicket),不开第二张。
    h.tick(1)
    expect(h.engine.reevaluate('1')).toBe(true)
    h.pump()
    expect(h.repo.decisions.byThread('chat:t1').at(-1)).toMatchObject({ kind: 'ignore',
      reason: [{ code: 'startedTicket', triggerId: '1', values: { ticket: decision.ticketId } }] })
    expect(h.engine.decide('1', { kind: 'accept', title: 'Again', scope: 'small', reason: 'again', delegation: DELEGATION })).toEqual(decision)
    expect(h.repo.tickets.list()).toHaveLength(1)
    expect(h.repo.tickets.list()[0]).toMatchObject({ origin: { triggerId: '1' } })
    expect(h.repo.tickets.list()[0]).not.toHaveProperty('ended')
    expect(h.repo.decisions.byThread('chat:t1').filter(item => item.kind === 'accept')).toHaveLength(1)
  })
  it('重投不开第二票也不重复投递:工单对该 Trigger 只有一条 Input,worker 只收到一份', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    h.engine.receive(trigger('2', { actor: guest }))
    h.settle()
    expect(h.engine.receive(trigger('2', { actor: guest }))).toBe('duplicate')
    const ticket = h.repo.tickets.get(ticketId)!
    expect(ticket.inputs.filter(input => input.kind === 'trigger' && input.triggerId === '2')).toHaveLength(1)
    expect(h.delivered.filter(([, input]) => input === key('input', ticketId, 'trigger', '2'))).toHaveLength(1)
    expect(h.repo.triggers.disposition('2')).toMatchObject({ fanout: [ticketId], realm: REALM })
  })
  it('回执幂等 id:确定性 id 同 id 只排一次,后来的请求复用先排的那条(reused)', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    expect(h.engine.reply({ purpose: 'acknowledgement', ticketId, triggerId: '1', text: 'On it' }))
      .toEqual({ id: key('ack', '1'), status: 'pending', reused: false })
    expect(h.engine.reply({ purpose: 'acknowledgement', ticketId, triggerId: '1', text: 'On it, again' }))
      .toEqual({ id: key('ack', '1'), status: 'pending', reused: true })
    expect(h.outbox).toHaveLength(1)
    expect(key('ack', '1')).toBe(key('ack', '1'))
  })
  it('幂等键贯穿到 Eval 与 Decision:重放裁决被指回其原 Eval(evalFinished),新 Eval 在新 id 下落 Decision 不改写历史', () => {
    const h = harness()
    h.engine.receive(trigger('1')); h.pump()
    const first = h.requests[0]!
    h.decide(first, { kind: 'ignore', reason: 'chatter' })
    h.tick(1)
    h.engine.receive(trigger('2')); h.pump()
    const second = h.requests.at(-1)!
    expect(second.evalId).not.toBe(first.evalId)
    expect(() => h.engine.decide('1', { kind: 'ignore', reason: 'again', evalId: first.evalId }))
      .toThrow(new UserError('evalFinished', { eval: first.evalId }))
    h.decide(second, { kind: 'ignore', reason: 'chatter' })
    // Decision 按 id 追加,历史记录不被改写(内容派生 id 的不可变面)。
    const history = h.repo.decisions.byThread('chat:t1')
    expect(history).toHaveLength(2)
    expect(history[0]).toMatchObject({ id: key('decision', first.evalId), reason: [{ code: 'said', values: { text: 'chatter' } }] })
    expect(history[1]).toMatchObject({ id: key('decision', second.evalId) })
  })
})
