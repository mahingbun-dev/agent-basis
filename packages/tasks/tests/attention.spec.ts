/**
 * Attention 生命周期与工单交接(35 号 A9 验收门禁;34 §4-A assignments 行、§4-D followups 行)。
 *
 * 门禁面(33 号 §1.3 G2-A6 的 tasks 半边,原文):Attention 结构化字段齐全、升级不并发、
 * 结案工单可被追问恢复(A6 交接 Mandate 独立 + 原 Ticket 订阅新工单线程)。依据条款:
 * 24 §2.3-5(六态+Attention 机制)、§2.2 行为律 3 与 §5.3-3(问题只走 Attention 结构化字段、
 * Attention 场景取严为单问)、§5.5-R5(Attention 显式化、追认可恢复结案工单)、24a 拍板记录·A6
 * (交接:Mandate 独立 + 原 Ticket 订阅新工单线程)、34 §5-interact 行(Attention 卡超集与单问)。
 * 本文件对账的断言(交互细节对照表③,消费面归 interact/workbench,本包只保证数据面):
 * - 结构化字段:attention = { id, question, triggerId? },id 内容派生且确定;回执必与当前开放
 *   问题文本一致(notAttention),发往提问消息的渠道;
 * - 升级不并发:一次只问一个——旧问题被替换/清除时,其未发回执从 outbox 撤回;问题不得伴随
 *   ready 结果或答复(questionWithResult),结果与问题不并存;
 * - 回执规则:四种 purpose 中的 result(未就绪拒发 notReady、就绪发工单发起会话)与 attention;
 * - 结案工单可被追问恢复:ready 结束的工单被同线程人的追问恢复(同 Mandate、无新 Eval/Decision);
 *   人 stop 的工单不恢复(stop 是唯一撤销,24 §5.3-2);
 * - 交接:accept 带 handoffOf → 新工单 Mandate 独立(自带 scope/basis,不继承原工单)、记录
 *   references,原工单订阅新工单线程并照常收到其上的动静(跨工单协调走交接不走互聊,27 §2.1-2)。
 */
import { describe, expect, it, vi } from 'vitest'
import { Engine, MemoryRepositories, UserError, key, runningAssignment, ticketOutcome, waitsForPerson } from '../src/index.ts'
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
  const scope: EngineOptions['scope'] = { scope: () => ({ listened: true, observed: false }) }
  const queued: Outbox = {
    send: (message) => { if (!outbox.some(item => item.id === message.id)) outbox.push(message) },
    status: id => outbox.some(item => item.id === id) ? 'pending' : undefined,
    withdraw: (id) => { withdrawn.push(id) },
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
  return { repo, engine, outbox, withdrawn, requests, release, start, stop, delivered, settle, pump, decide,
    setVersion: (value: string) => { version = value }, tick: (seconds: number) => { clock += seconds } }
}
/** 建一张已 accept 并 settle 的工单:trigger `id`(默认 '1')落在线程 `thread`(默认 't1')。 */
function accepted(h: ReturnType<typeof harness>, id = '1', thread = 't1') {
  h.engine.receive(trigger(id, { threads: [{ source: 'chat', id: thread }] })); h.pump()
  const decision = h.decide(h.requests.at(-1)!, { kind: 'accept', title: 'Fix', scope: 'small', reason: 'requested', delegation: DELEGATION })
  h.settle()
  return decision
}

describe('Attention 结构化字段齐全(24 §5.3-3:问题只走结构化字段)', () => {
  it('提问记录 { id, question, triggerId }:id 内容派生(同问题同时刻同 id),triggerId 点名提出它的人的消息', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    const asked = h.engine.report(ticketId, { state: 'progress', summary: 'need a call', question: 'Which color?', askedBy: '1' })
    expect(asked.attention).toEqual({ id: key('attention', ticketId, 'Which color?', '2026-10-23T00:00:00.000Z'), question: 'Which color?', triggerId: '1' })
    // 同一问题重复报告不产生新问题(保留现状):对象逐字段一致。
    const kept = h.engine.report(ticketId, { state: 'waiting', summary: 'still waiting', question: 'Which color?', askedBy: '1' })
    expect(kept.attention).toEqual(asked.attention)
    expect(waitsForPerson(h.repo.tickets.get(ticketId)!)).toBe(false)
  })
  it('attention 回执:必与当前开放问题文本一致(notAttention),发往提问消息被写下的渠道,确定性 id 幂等排队', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    const asked = h.engine.report(ticketId, { state: 'progress', summary: 'need a call', question: 'Which color?', askedBy: '1' })
    expect(() => h.engine.reply({ purpose: 'attention', ticketId, question: 'Which size?', text: '「Which size?」' })).toThrow(new UserError('notAttention'))
    const reply = h.engine.reply({ purpose: 'attention', ticketId, question: 'Which color?', text: '「Which color?」' })
    expect(reply).toEqual({ id: key('attention-reply', asked.attention!.id), status: 'pending', reused: false })
    expect(h.outbox).toEqual([expect.objectContaining({ id: key('attention-reply', asked.attention!.id), kind: 'reply', ticketId,
      channel: trigger('1').channel })])
    expect(h.engine.reply({ purpose: 'attention', ticketId, question: 'Which color?', text: '「Which color?」' }).reused).toBe(true)
    expect(h.outbox).toHaveLength(1)
    // 没有开放问题时报 notAttention。
    h.engine.report(ticketId, { state: 'progress', summary: 'resolved', question: null })
    expect(() => h.engine.reply({ purpose: 'attention', ticketId, question: 'Which color?', text: '「Which color?」' })).toThrow(new UserError('notAttention'))
  })
  it('提问定向到提问渠道:askedBy 点名的消息有自己的渠道时,回执发往那里,而非工单发起会话', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    h.engine.receive(trigger('2', { actor: guest, threads: [{ source: 'chat', id: 't1' }], channel: { source: 'chat', thread: 't1', address: { message: 'dm-9' } } }))
    h.settle()
    const asked = h.engine.report(ticketId, { state: 'progress', summary: 'ask', question: 'Ship it?', askedBy: '2' })
    expect(asked.attention).toMatchObject({ triggerId: '2' })
    h.engine.reply({ purpose: 'attention', ticketId, question: 'Ship it?', text: '「Ship it?」' })
    expect(h.outbox.at(-1)).toMatchObject({ channel: { address: { message: 'dm-9' } }, ticketId })
  })
})

describe('升级不并发(24 §2.2 行为律 3:一次只问一个具体的结构化问题,取严为单问)', () => {
  it('工单同时至多一个开放问题:替换旧问题时撤回其未发回执,新问题单独在位', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    const first = h.engine.report(ticketId, { state: 'progress', summary: 'ask', question: 'Which color?', askedBy: '1' })
    h.engine.reply({ purpose: 'attention', ticketId, question: 'Which color?', text: '「Which color?」' })
    h.tick(1)
    const second = h.engine.report(ticketId, { state: 'progress', summary: 'other question', question: 'Which size?' })
    expect(second.attention).toMatchObject({ question: 'Which size?' })
    // 升级不并发:旧问题的回执(尚未发出)被撤回,人不会再被旧卡打扰。
    expect(h.withdrawn).toEqual([key('attention-reply', first.attention!.id)])
    expect(second.attention!.id).not.toBe(first.attention!.id)
    expect(h.repo.tickets.get(ticketId)!.attention).toEqual(second.attention)
  })
  it('问题不与结果并存:ready 报告清除问题并撤回回执;question 伴随 ready/answers 被拒(questionWithResult)', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    const asked = h.engine.report(ticketId, { state: 'progress', summary: 'ask', question: 'Merge it?' })
    const report = (extra: object) => () => h.engine.report(ticketId, { state: 'progress', summary: 'x', ...extra })
    expect(report({ state: 'ready', question: 'Q?' })).toThrow(new UserError('questionWithResult'))
    expect(report({ question: 'Q?', answers: '1' })).toThrow(new UserError('questionWithResult'))
    // ready 即结果:问题清除、其未发回执撤回。
    h.engine.reply({ purpose: 'attention', ticketId, question: 'Merge it?', text: '「Merge it?」' })
    expect(h.engine.report(ticketId, { state: 'ready', summary: 'done' }).attention).toBeUndefined()
    expect(h.withdrawn).toEqual([key('attention-reply', asked.attention!.id)])
    expect(h.repo.tickets.get(ticketId)).toMatchObject({ ended: { by: 'executor', outcome: 'completed' } })
  })
  it('清除(question: null)与 blocked/failed 保留:失败中的工单问题仍在位(等谁可见化建在台账上)', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    const asked = h.engine.report(ticketId, { state: 'progress', summary: 'ask', question: 'Which color?', askedBy: '1' })
    const cleared = h.engine.report(ticketId, { state: 'progress', summary: 'answered', question: null })
    expect(cleared.attention).toBeUndefined()
    expect(h.withdrawn).toEqual([key('attention-reply', asked.attention!.id)])
    const failed = h.engine.report(ticketId, { state: 'failed', summary: 'broke', question: 'Retry now?', askedBy: '1' })
    expect(failed.attention).toMatchObject({ question: 'Retry now?', triggerId: '1' })
    expect(h.repo.tickets.get(ticketId)).not.toHaveProperty('ended')
    expect(waitsForPerson(h.repo.tickets.get(ticketId)!)).toBe(true)
  })
  it('result 回执规则(四种 purpose 之一):未就绪拒发(notReady),工单结束(completed)后发往其发起会话', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    expect(() => h.engine.reply({ purpose: 'result', ticketId, text: 'done' })).toThrow(new UserError('notReady'))
    h.engine.report(ticketId, { state: 'ready', summary: 'done' })
    h.engine.reply({ purpose: 'result', ticketId, text: '已修复,见补丁。' })
    expect(h.outbox.at(-1)).toMatchObject({ kind: 'reply', ticketId, channel: trigger('1').channel })
    expect(ticketOutcome(h.repo.tickets.get(ticketId)!)).toBe('completed')
  })
})

describe('结案工单可被追问恢复(R5 后半:追可不向 A2A 终态拒收妥协)', () => {
  it('ready 结束的工单被同线程人的追问恢复:同 Mandate 另起 Assignment,无新 Eval/Decision,resumed 注记先行', () => {
    const h = harness()
    const decision = accepted(h)
    const ticketId = decision.ticketId!
    const before = h.repo.tickets.get(ticketId)!.mandate
    h.engine.report(ticketId, { state: 'ready', summary: 'done' })
    expect(ticketOutcome(h.repo.tickets.get(ticketId)!)).toBe('completed')
    const requests = h.requests.length
    h.engine.receive(trigger('2', { actor: guest }))
    expect(h.repo.tickets.get(ticketId)!.ended).toBeUndefined()
    h.pump()
    const ticket = h.repo.tickets.get(ticketId)!
    expect(ticket.assignments).toHaveLength(2)
    expect(ticket.mandate).toEqual(before)
    expect(ticket.inputs.map(input => input.kind)).toEqual(['trigger', 'resumed'])
    // resumed 注记排在等待中的消息之前投递(undelivered 队首),两条都到达 worker。
    const sentToWorker = h.delivered.filter(([id]) => id === ticketId).map(([, input]) => input).sort()
    expect(sentToWorker).toEqual(ticket.inputs.map(input => input.id).sort())
    // 恢复不是新授权:无 Eval、无新 Decision(只有原 accept 一条)。
    expect(h.requests).toHaveLength(requests)
    expect(h.repo.decisions.byThread('chat:t1').filter(item => item.kind !== 'ignore')).toEqual([decision])
  })
  it('人 stop 过的工单不恢复(stop 已撤回 Mandate):追问消息不再扇出、改道进 Eval(候选卡)', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    h.engine.stopTicket(ticketId, '不要了')
    h.engine.receive(trigger('2', { actor: guest }))
    expect(h.repo.tickets.get(ticketId)).toMatchObject({ ended: { by: 'human', outcome: 'stopped' }, inputs: [] })
    h.pump()
    // 没有工单裁决它(工单已死、未接手):照常进 Eval 等主会话(客人的追问是推断候选)。
    expect(h.requests.at(-1)).toMatchObject({ strength: 'inferred', triggers: [expect.objectContaining({ id: '2' })] })
    expect(h.start).toHaveBeenCalledOnce()
  })
  it('Mandate 不再通过当前 Policy 的结案工单保持结束(refuse):追问消息被放开进 Eval,处理暂停期间等待', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    h.engine.report(ticketId, { state: 'ready', summary: 'done' })
    h.setVersion('revoked')
    h.engine.receive(trigger('2', { actor: guest }))
    h.pump()
    expect(h.repo.tickets.get(ticketId)).toMatchObject({ ended: { by: 'executor', outcome: 'completed' }, undelivered: [] })
    // 消息被 refuse 放开:无工单裁决,进 Eval。
    expect(h.requests.at(-1)).toMatchObject({ triggers: [expect.objectContaining({ id: '2' })] })
    // Policy 恢复后再来的追问:同 Mandate 直接恢复(幂等,多次 pass 只恢复一次)。
    h.setVersion('v1')
    h.engine.receive(trigger('3', { actor: guest }))
    h.pump(); h.pump()
    const ticket = h.repo.tickets.get(ticketId)!
    expect(ticket.ended).toBeUndefined()
    expect(ticket.assignments).toHaveLength(2)
    expect(ticket.inputs.filter(input => input.kind === 'resumed')).toHaveLength(1)
  })
})

describe('交接(24a 拍板记录·A6:Mandate 独立 + 原 Ticket 订阅新工单线程)', () => {
  it('accept 带 handoffOf:新工单记录 references、Mandate 自成一体(不继承原工单授权),原工单订阅新工单线程', () => {
    const h = harness()
    const original = accepted(h).ticketId!
    const originalMandate = h.repo.tickets.get(original)!.mandate
    h.engine.receive(trigger('2', { threads: [{ source: 'chat', id: 't2' }] })); h.pump()
    const handed = h.decide(h.requests.at(-1)!, { kind: 'accept', title: '接手收尾', scope: 'handoff-scope', reason: 'handoff', delegation: DELEGATION, handoffOf: original })
    h.settle()
    const ticket = h.repo.tickets.get(handed.ticketId!)!
    expect(ticket.references).toEqual([original])
    // Mandate 独立:自带本次 Eval 的授权(scope/basis 来自本工单的 Trigger),不是原工单授权的延续。
    expect(ticket.mandate).toMatchObject({ realm: REALM, strength: 'explicit', scope: 'handoff-scope' })
    expect(ticket.mandate).not.toEqual(originalMandate)
    // 原 Ticket 订阅新工单线程:新工单线程上的动静作为上下文扇出到原工单(协调走交接、不走互聊)。
    expect(h.repo.threads.get('chat:t2')?.subscriptions).toEqual([ticket.id, original])
    h.engine.receive(trigger('3', { actor: guest, threads: [{ source: 'chat', id: 't2' }] })); h.settle()
    expect(h.repo.triggers.disposition('3')?.fanout).toEqual([ticket.id, original])
    expect(h.repo.tickets.get(original)!.inputs.some(input => input.kind === 'trigger' && input.triggerId === '3')).toBe(true)
    expect(h.repo.tickets.get(ticket.id)!.inputs.some(input => input.kind === 'trigger' && input.triggerId === '3')).toBe(true)
  })
  it('原工单已结束(如被人 stop)即不可交接:accept 整单回滚,新工单不落库', () => {
    const h = harness()
    const original = accepted(h).ticketId!
    h.engine.stopTicket(original)
    h.engine.receive(trigger('2', { threads: [{ source: 'chat', id: 't2' }] })); h.pump()
    expect(() => h.decide(h.requests.at(-1)!, { kind: 'accept', title: '接手', scope: 's', reason: 'handoff', delegation: DELEGATION, handoffOf: original }))
      .toThrow(new UserError('ticketEnded'))
    expect(h.repo.tickets.list()).toHaveLength(1)
    expect(h.repo.tickets.list()[0]).toMatchObject({ id: original })
    expect(h.repo.decisions.byThread('chat:t2')).toEqual([])
  })
})
