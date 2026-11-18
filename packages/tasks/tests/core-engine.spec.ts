/**
 * Engine 内核代表性用例(35 号 A5 验收门禁;34 §4-A core-engine 行)。
 *
 * 语义自 SA tests/core-engine.spec.ts 移植(假件模式:MemoryRepositories + 假 Policy/Assessor/
 * Executor/Outbox,34 §4-A「core-engine 的假件模式」),按本仓改造面适配:
 * - ★realm(35 号 A5 门禁「realm 标注落库断言」;34 §2.1):harness 注入 realmOf,断言
 *   disposition/mandate/ticket/ticket.ended 载荷四处 realm 一致与双 realm 隔离归账;
 * - ★R3 四要素(35 号 A7):accept 一律携带 delegation 四要素;缺要素 → delegationIncomplete;
 * - ★A5 门禁五断言逐条落例:duplicate 不二开票、followup 不进 Eval、stop 唯一撤销、
 *   policyChanged 不撤销在跑授权、realm 标注落库;
 * - ★A8 交接(handoffOf)与单写者事务回滚(全或无)。
 * 覆盖:幂等/建单/attach 恢复/stop/report 六态/waitsForPerson/policyChanged(任务书点名七面)。
 */
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { Engine, MemoryRepositories, UserError, followupOwners, key, runningAssignment, ticketOutcome, ticketStage, waitsForPerson } from '../src/index.ts'
import type {
  Assessor, Assignment, Candidate, EngineForExecutor, EngineForMainSession, EngineForPeople, EngineForSettings, EngineForSources,
  EngineOptions, Executor, OutboundMessage, Outcome, Policy, Ticket, Trigger,
} from '../src/index.ts'

const member = { source: 'chat', id: 'alice' }
const guest = { source: 'chat', id: 'guest' }
/** 默认租户 realm;某条 Trigger 的 realm 以 meta.realm 覆盖(harness 的 realmOf 读它)。 */
const REALM = 'tenant-a'
/** R3 委派四要素(35 号 A7):本 spec 的 accept 一律带齐;缺要素用例单独构造。 */
const DELEGATION = { objective: '修复登录页在移动端的崩溃', outputFormat: 'Git 补丁', toolGuidance: '仓库内编辑器与测试', taskBoundaries: '不改依赖与公共 API' }

function trigger(id: string, overrides: Partial<Trigger> = {}): Trigger {
  return { id, source: 'chat', threads: [{ source: 'chat', id: 't1' }], actor: member, human: true, at: `2026-09-23T00:00:${id.padStart(2, '0')}Z`, text: `message ${id}`,
    channel: { source: 'chat', thread: 't1', address: { message: id } }, meta: {}, ...overrides }
}
interface Hooks {
  emit?: (event: { type: string; data: Record<string, unknown> }) => void
  prepareTicket?: EngineOptions['prepareTicket']
}
function harness(policyOverrides: Partial<Policy> = {}, { emit, prepareTicket }: Hooks = {}) {
  const repo = new MemoryRepositories()
  const outbox: OutboundMessage[] = []
  const withdrawn: string[] = []
  const requests: Candidate[] = []
  // 假件以独立 vi.fn 常量给出(带参类型),断言与 mockClear 都引用常量本身。
  const request = vi.fn((candidate: Candidate) => { requests.push(candidate) })
  const release = vi.fn()
  const assessor: Assessor = { request, release }
  const launches: [Ticket, Assignment][] = []
  const deliveries = new Set<string>()
  /** Executor 已交给运行中 Assignment 的 Inputs,形如 [工单 id, Input id]。 */
  const delivered: [string, string][] = []
  const start = vi.fn((ticket: Ticket, assignment: Assignment) => { launches.push([ticket, assignment]) })
  const deliver = vi.fn((ticket: Ticket) => { deliveries.add(ticket.id) })
  const stop = vi.fn()
  const executor: Executor = { start, deliver, stop }
  let version = 'v1', paused = false
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
  const queued: EngineOptions['outbox'] = {
    send: (message) => { if (!outbox.some(item => item.id === message.id)) outbox.push(message) },
    status: id => outbox.some(item => item.id === id) ? 'pending' : undefined,
    withdraw: (id) => { withdrawn.push(id) },
  }
  const engine = new Engine({ repo, scope, policy: () => policy, assessor, executor, outbox: queued,
    // ★realm 首参路由(A5/A6):Trigger 保存前经 realmOf 标注 realm(默认 tenant-a,meta.realm 可覆盖)。
    realmOf: t => (typeof t.meta.realm === 'string' ? t.meta.realm : REALM),
    ...emit ? { emit } : {}, ...prepareTicket ? { prepareTicket } : {},
    now: () => new Date(Date.UTC(2026, 8, 23, 0, 0, clock)).toISOString() })
  /** 模拟 Executor 启动排队的 Assignment(除非 launch=false)并投递工单等待中的 Inputs。 */
  function settle({ launch = true } = {}) {
    for (;;) {
      const next = launch ? launches.shift() : undefined
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
  return { repo, engine, outbox, withdrawn, requests, assessor, executor, delivered, settle, pump, decide,
    start, deliver, stop, request, release,
    setVersion: (value: string) => { version = value }, setPaused: (value: boolean) => { paused = value },
    tick: (seconds: number) => { clock += seconds } }
}
/** 建一张已 accept 并 settle 的工单:trigger `id`(默认 '1')落在线程 `thread`(默认 't1')。 */
function accepted(h: ReturnType<typeof harness>, id = '1', thread = 't1') {
  h.engine.receive(trigger(id, { threads: [{ source: 'chat', id: thread }] })); h.pump()
  const decision = h.decide(h.requests.at(-1)!, { kind: 'accept', title: 'Fix', scope: 'small', reason: 'requested', acknowledgement: 'ok', delegation: DELEGATION })
  h.settle()
  return decision
}

describe('intake 与幂等(receive 三态 / duplicate 不二开票)', () => {
  it('一条 Trigger 只落库一次;Source 过滤以 filtered 处置落库——stored 与 filtered 两条路径都标注 realm', () => {
    const h = harness()
    expect(h.engine.receive(trigger('1'))).toBe('stored')
    expect(h.engine.receive(trigger('1'))).toBe('duplicate')
    expect(h.engine.receive(trigger('2', { meta: { blocked: true } }))).toBe('filtered')
    expect(h.repo.triggers.disposition('1')).toMatchObject({ fanout: [], realm: REALM })
    expect(h.repo.triggers.disposition('2')?.filtered).toEqual({ code: 'chat not allowed' })
    expect(h.repo.triggers.disposition('2')).toMatchObject({ fanout: [], realm: REALM })
    expect(h.repo.threads.get('chat:t1')?.pending).toEqual(['1'])
  })
  it('duplicate 不二开票:重投收敛为一单,已开票 Trigger 的重放进 Eval 即被指回原工单,再 accept 返回旧 Decision', () => {
    const h = harness()
    const decision = accepted(h)
    expect(h.engine.receive(trigger('1'))).toBe('duplicate')
    h.tick(1)
    expect(h.engine.reevaluate('1')).toBe(true)
    h.pump()
    expect(h.repo.decisions.byThread('chat:t1').at(-1)).toMatchObject({ kind: 'ignore',
      reason: [{ code: 'startedTicket', triggerId: '1', values: { ticket: decision.ticketId } }] })
    expect(h.engine.decide('1', { kind: 'accept', title: 'Again', scope: 'small', reason: 'again', delegation: DELEGATION })).toEqual(decision)
    expect(h.repo.tickets.list()).toHaveLength(1)
  })
  it('多线程 Trigger 记录线程关联,只在主线程上排 Eval', () => {
    const h = harness()
    h.engine.receive(trigger('1', { threads: [{ source: 'gh', id: 'pr-7' }, { source: 'gh', id: 'run-9' }] }))
    expect(h.repo.threads.get('gh:pr-7')).toMatchObject({ pending: ['1'], correlated: ['gh:run-9'] })
    expect(h.repo.threads.get('gh:run-9')).toMatchObject({ pending: [], correlated: ['gh:pr-7'] })
  })
  it('回执幂等:同一确认 id 永不排队两次,后来的请求复用先排的那条', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    expect(h.engine.reply({ purpose: 'acknowledgement', ticketId, triggerId: '1', text: 'On it' })).toEqual({ id: key('ack', '1'), status: 'pending', reused: true })
    expect(h.outbox.map(message => message.text)).toEqual(['ok'])
    h.engine.receive(trigger('2', { actor: guest }))
    expect(h.engine.reply({ purpose: 'acknowledgement', ticketId, triggerId: '2', text: 'Looking' })).toEqual({ id: key('ack', '2'), status: 'pending', reused: false })
    expect(h.outbox).toHaveLength(2)
  })
  it('ticket.ended 载荷带 realm(★A5 表②-2:记忆整固与冲突指标按 realm 归账)', () => {
    const events: { type: string; data: Record<string, unknown> }[] = []
    const h = harness({}, { emit: event => events.push(event) })
    const ticketId = accepted(h).ticketId!
    h.engine.stopTicket(ticketId, 'done')
    expect(events.filter(event => event.type === 'ticket.ended').map(event => event.data))
      .toEqual([{ ticketId, realm: REALM, by: 'human', outcome: 'stopped', reason: 'done' }])
  })
})

describe('Eval 与建单', () => {
  it('gate 无可受理 Trigger 时不起 assessor,直接记 ignore Decision', () => {
    const h = harness()
    h.engine.receive(trigger('1', { human: false })); h.pump()
    expect(h.request).not.toHaveBeenCalled()
    expect(h.repo.decisions.byThread('chat:t1')).toEqual([expect.objectContaining({ kind: 'ignore', triggerIds: ['1'] })])
    expect(h.repo.triggers.disposition('1')?.decisionId).toBeDefined()
  })
  it('accept 建单:固化 Mandate(★realm 随 origin Trigger 落库)、订阅线程、排队确认回执并启动 Assignment;四要素随 Decision 落库', () => {
    const h = harness()
    const decision = accepted(h)
    const ticket = h.repo.tickets.get(decision.ticketId!)!
    expect(ticket).toMatchObject({ title: 'Fix', realm: REALM,
      mandate: { strength: 'explicit', policyVersion: 'v1', basis: { via: 'listed' }, actor: member, scope: 'small', realm: REALM },
      channels: [trigger('1').channel], origin: { triggerId: '1', triggerIds: ['1'] } })
    expect(ticket).not.toHaveProperty('ended')
    expect(ticket.assignments).toHaveLength(1)
    expect(ticket.assignments[0]).toMatchObject({ state: 'running' })
    expect(ticket.assignments[0]!.startedAt).toEqual('2026-09-23T00:00:00.000Z')
    expect(h.repo.threads.get('chat:t1')?.subscriptions).toEqual([ticket.id])
    expect(h.outbox).toEqual([{ id: key('ack', '1'), channel: trigger('1').channel, text: 'ok', kind: 'acknowledgement', ticketId: ticket.id }])
    expect(h.start).toHaveBeenCalledOnce()
    // ★A7:四要素随 Decision 落库(审计 trace「Trigger→候选卡→Decision→四要素」链)。
    expect(decision.delegation).toEqual(DELEGATION)
  })
  it('R3 四要素硬约束:accept 缺任一要素或要素空白 → UserError(delegationIncomplete),且不动 Eval 状态', () => {
    const h = harness()
    h.engine.receive(trigger('1')); h.pump()
    const vague = { kind: 'accept' as const, title: 'F', scope: 's', reason: 'r' }
    expect(() => h.decide(h.requests[0]!, vague as unknown as Outcome)).toThrow(new UserError('delegationIncomplete'))
    expect(() => h.decide(h.requests[0]!, { ...vague, delegation: { objective: '  ', outputFormat: 'patch', toolGuidance: 'x', taskBoundaries: 'y' } }))
      .toThrow(new UserError('delegationIncomplete'))
    expect(h.engine.candidate('1')?.evalId).toBe(h.requests[0]!.evalId)
    expect(h.repo.tickets.list()).toEqual([])
  })
  it('建单全或无:prepareTicket 抛错则 Decision、工单、订阅与回执一并回滚(单写者事务)', () => {
    const h = harness({}, { prepareTicket: () => { throw new Error('No directory for the ticket') } })
    h.engine.receive(trigger('1')); h.pump()
    const evalId = h.requests[0]!.evalId
    expect(() => h.decide(h.requests[0]!, { kind: 'accept', title: 'Fix', scope: 'small', reason: 'requested', acknowledgement: 'ok', delegation: DELEGATION }))
      .toThrow('No directory')
    expect(h.repo.decisions.byThread('chat:t1')).toEqual([])
    expect(h.repo.tickets.list()).toEqual([])
    expect(h.repo.threads.get('chat:t1')).toMatchObject({ evaluating: { id: evalId }, subscriptions: [] })
    expect(h.outbox).toEqual([])
  })
  it('线程上的 Eval 串行:进行中时到达的 Trigger 防抖合并进下一次', () => {
    const h = harness()
    h.engine.receive(trigger('1')); h.pump()
    h.engine.receive(trigger('2')); h.engine.receive(trigger('3')); h.pump()
    expect(h.requests).toHaveLength(1)
    expect(h.repo.threads.get('chat:t1')?.pending).toEqual(['2', '3'])
    h.decide(h.requests[0]!, { kind: 'ignore', reason: 'chatter' })
    h.pump()
    expect(h.requests[1]!.triggers.map(t => t.id)).toEqual(['2', '3'])
    expect(h.requests[1]!.strength).toBe('explicit')
  })
  it('deadline 自候选送达起算:过期重排两次,第三次记 unavailable(undelivered 的 Eval 永不过期)', () => {
    const h = harness()
    h.engine.receive(trigger('1')); h.pump()
    // 候选未到达 assessor Session 的 Eval 不过期。
    h.tick(600); h.pump()
    expect(h.engine.candidate('1')?.evalId).toBe(h.requests[0]!.evalId)
    const deliver = () => { h.engine.candidateDelivered(h.requests.at(-1)!.evalId) }
    deliver()
    h.tick(59); h.pump()
    expect(h.requests).toHaveLength(1)
    h.tick(2); h.pump()
    expect(h.repo.decisions.byThread('chat:t1')).toEqual([])
    expect(h.release).toHaveBeenCalledWith(h.requests[0]!.evalId)
    expect(h.requests.map(item => item.triggers.map(each => each.id))).toEqual([['1'], ['1']])
    deliver(); h.tick(61); h.pump()
    expect(h.requests).toHaveLength(3)
    deliver(); h.tick(61); h.pump()
    expect(h.repo.decisions.byThread('chat:t1')).toEqual([expect.objectContaining({ kind: 'unavailable', reason: [{ code: 'timeout' }] })])
    expect(h.repo.threads.get('chat:t1')).toMatchObject({ pending: [] })
    expect(h.repo.threads.get('chat:t1')).not.toHaveProperty('evaluating')
    expect(h.repo.threads.get('chat:t1')).not.toHaveProperty('expired')
  })
  it('评估期间 Policy 版本变了:Decision 记 unavailable 并把 Trigger 重排等新 Eval', () => {
    const h = harness()
    h.engine.receive(trigger('1')); h.pump()
    h.setVersion('v2')
    const decision = h.decide(h.requests[0]!, { kind: 'accept', title: 'x', scope: 'x', reason: 'x', delegation: DELEGATION })
    expect(decision.kind).toBe('unavailable')
    expect(h.repo.tickets.list()).toEqual([])
    expect(h.repo.threads.get('chat:t1')?.pending).toEqual(['1'])
  })
  it('推断候选仅在 Policy 准入的启用规则上可 accept,谁点名规则都一样(notExplicit)', () => {
    const h = harness({ admitsInferred: rules => rules.includes('enabled') })
    accepted(h)
    h.engine.receive(trigger('2', { actor: guest })); h.engine.reevaluate('2'); h.pump()
    const candidate = h.requests.at(-1)!
    expect(() => h.decide(candidate, { kind: 'accept', title: 'Fix', scope: 'small', reason: 'rule', delegation: DELEGATION, rules: ['disabled'] }))
      .toThrow(new UserError('notExplicit'))
    expect(h.decide(candidate, { kind: 'accept', title: 'Fix', scope: 'small', reason: 'rule', delegation: DELEGATION, rules: ['enabled'] })).toMatchObject({ kind: 'accept' })
  })
  it('直接 Eval:无 Eval 持有的显式请求当场 accept,一次为限(重复 decide 返回同一 Decision)', () => {
    const h = harness()
    h.engine.receive(trigger('1'))
    const decision = h.engine.decide('1', { kind: 'accept', title: 'Fix', scope: 'small', reason: 'routed', delegation: DELEGATION })
    expect(decision).toMatchObject({ kind: 'accept', triggerIds: ['1'], strength: 'explicit' })
    expect(h.repo.threads.get('chat:t1')).toMatchObject({ pending: [] })
    expect(h.repo.threads.get('chat:t1')).not.toHaveProperty('evaluating')
    expect(h.engine.decide('1', { kind: 'accept', title: 'Again', scope: 'small', reason: 'routed', delegation: DELEGATION })).toEqual(decision)
    expect(() => h.engine.decide('missing', { kind: 'ignore', reason: 'x' })).toThrow(new UserError('unknownTrigger'))
  })
  it('晚到的 Eval 取代旧的:拒绝对旧 Eval 的裁决(evalFinished),新的可裁决', () => {
    const h = harness()
    h.engine.receive(trigger('1')); h.pump()
    const first = h.requests[0]!
    h.setVersion('v2'); h.engine.policyChanged('v1', 'v2'); h.pump()
    const second = h.requests[1]!
    expect(() => h.decide(first, { kind: 'ignore', reason: 'chatter' })).toThrow('has finished or a later eval replaced it')
    expect(h.decide(second, { kind: 'ignore', reason: 'chatter' })).toMatchObject({ kind: 'ignore', evalId: second.evalId })
  })
})

describe('followup 不进 Eval(工单存活期间拥有其线程上人的后续消息)', () => {
  it('订阅线程上人的后续消息直达在跑工单为 Input,不进 Eval、不产生 Decision', () => {
    const h = harness()
    const decision = accepted(h)
    const requests = h.requests.length
    h.engine.receive(trigger('2', { actor: guest })); h.pump()
    const ticket = h.repo.tickets.get(decision.ticketId!)!
    expect(ticket.inputs).toEqual([expect.objectContaining({ kind: 'trigger', triggerId: '2' })])
    expect(ticket.undelivered).toEqual([])
    expect(h.delivered).toEqual([[ticket.id, ticket.inputs[0]!.id]])
    expect(h.repo.triggers.disposition('2')).toEqual({ fanout: [ticket.id], realm: REALM, at: '2026-09-23T00:00:00.000Z' })
    // 无 Eval 则无 Decision 也无超时,线程队列保持空闲。
    expect([h.requests.length, h.repo.threads.get('chat:t1')!.pending, h.repo.decisions.byThread('chat:t1').length]).toEqual([requests, [], 1])
  })
  it('主会话对后续消息只能 stop 该工单:accept 被拒(workerDecides);stop 后同一消息可作为新工作接手', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    h.engine.receive(trigger('2')); h.settle()
    const acceptY = { kind: 'accept' as const, title: 'Y', scope: 'small', reason: 'requested', delegation: DELEGATION }
    expect(() => h.engine.decide('2', acceptY)).toThrow(new UserError('workerDecides', { tickets: ticketId }))
    expect(h.engine.decide('2', { kind: 'stop', ticketId, reason: 'asked to stop' }).kind).toBe('stop')
    // 「停下这个,改做 Y」:stop 终结了裁决该消息的工单,accept 作为独立 Decision 与之并存。
    expect(h.engine.decide('2', acceptY)).toMatchObject({ kind: 'accept', triggerIds: ['2'] })
    expect(h.repo.decisions.byThread('chat:t1').filter(item => item.triggerIds.includes('2')).map(item => item.kind)).toEqual(['stop', 'accept'])
  })
  it('旧版本遗留队列中的 followup 被取出队列且不留 Decision(trigger.followup),被重发的保持排队', () => {
    const events: { type: string; data: Record<string, unknown> }[] = []
    const h = harness({}, { emit: event => events.push(event) })
    accepted(h)
    h.engine.receive(trigger('2', { actor: guest })); h.engine.receive(trigger('3', { actor: guest }))
    // 模拟更早版本留下的状态:两条都在队列里;人把第二条重发进 Eval。
    const thread = h.repo.threads.get('chat:t1')!
    h.repo.threads.save({ ...thread, pending: ['2', '3'] })
    h.engine.reevaluate('3'); h.pump()
    expect(h.requests.at(-1)!.triggers.map(item => item.id)).toEqual(['3'])
    expect(h.repo.threads.get('chat:t1')!.pending).toEqual([])
    expect(h.repo.decisions.byThread('chat:t1').flatMap(decision => decision.triggerIds)).toEqual(['1'])
    expect(events.filter(event => event.type === 'trigger.followup').map(event => event.data)).toEqual([{ triggerId: '2' }])
  })
  it('bot 的消息仍进 Eval;已结束的工单不因它复活也不收它', () => {
    const h = harness()
    const decision = accepted(h)
    h.engine.report(decision.ticketId!, { state: 'ready', summary: 'done' })
    h.engine.receive(trigger('2', { human: false })); h.pump()
    // Executor 恢复时会重读线程,故 bot/CI 不唤醒已结束工单;它仍被评估(gate 拒之)。
    expect(h.repo.tickets.get(decision.ticketId!)).toMatchObject({ ended: { by: 'executor', outcome: 'completed' }, undelivered: [] })
    expect(h.repo.decisions.byThread('chat:t1').at(-1)).toMatchObject({ kind: 'ignore', triggerIds: ['2'] })
    expect(h.start).toHaveBeenCalledOnce()
  })
  it('handback:到达工单的消息交回一次即进 Eval(gate 强度),二交拒绝、未到达拒绝、订阅保留', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    h.engine.receive(trigger('2')); h.engine.receive(trigger('3', { actor: guest })); h.pump()
    expect(h.engine.handback(ticketId, '2', 'A new request')).toBe(true); h.pump()
    expect(h.requests.at(-1)).toMatchObject({ strength: 'explicit', triggers: [{ id: '2' }] })
    expect(h.repo.triggers.disposition('2')!.handbacks).toEqual([{ ticketId, reason: 'A new request', at: '2026-09-23T00:00:00.000Z' }])
    h.decide(h.requests.at(-1)!, { kind: 'ignore', reason: 'chat' })
    expect(() => h.engine.handback(ticketId, '2', 'Again')).toThrow(new UserError('handedBack'))
    expect(h.engine.handback(ticketId, '3', 'A guest asks for more')).toBe(true); h.pump()
    expect(h.requests.at(-1)).toMatchObject({ strength: 'inferred', triggers: [{ id: '3' }] })
    expect(h.repo.threads.get('chat:t1')!.subscriptions).toContain(ticketId)
    // 只有到达过该工单的消息才能交回。
    h.engine.receive(trigger('4', { threads: [{ source: 'chat', id: 'elsewhere' }] }))
    expect(() => h.engine.handback(ticketId, '4', 'Not mine')).toThrow(new UserError('notReached'))
  })
})

describe('stop 唯一撤销(授权只在 Mandate 里,只有人的 stop 才撤销)', () => {
  it('stop 需显式指令:推断消息上的 stop 记 ignore(stopNotExplicit),显式的终结工单', () => {
    const h = harness()
    const decision = accepted(h)
    h.engine.receive(trigger('2', { actor: guest })); h.pump()
    expect(h.engine.decide('2', { kind: 'stop', ticketId: decision.ticketId!, reason: 'x' })).toMatchObject({ kind: 'ignore',
      strength: 'inferred', reason: [{ code: 'stopNotExplicit' }] })
    h.engine.receive(trigger('3')); h.pump()
    expect(h.engine.decide('3', { kind: 'stop', ticketId: decision.ticketId!, reason: 'human said stop' }).kind).toBe('stop')
    expect(h.repo.tickets.get(decision.ticketId!)).toMatchObject({ ended: { by: 'human', outcome: 'stopped' } })
    expect(h.stop).toHaveBeenCalledOnce()
  })
  it('人 stop 过的工单保持结束:stop 已撤回其 Mandate,后续消息不再扇出、不再恢复', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    h.engine.stopTicket(ticketId)
    expect(h.stop).toHaveBeenCalledOnce()
    h.engine.receive(trigger('2')); h.pump()
    expect(h.repo.tickets.get(ticketId)).toMatchObject({ ended: { by: 'human' } })
    expect(h.repo.tickets.get(ticketId)!.inputs).toEqual([])
    expect(h.start).toHaveBeenCalledOnce()
  })
  it('policyChanged 不撤销在跑授权:在跑工单钉住创建时策略版本,只收到一条 policy-changed 通知 Input', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    const effect = { rules: [{ id: 'copy', name: 'Copy', change: 'changed' as const, instruction: '只修错别字。' }] }
    h.setVersion('v2')
    h.engine.policyChanged('v1', 'v2', new Map([[ticketId, effect]]))
    h.settle()
    const ticket = h.repo.tickets.get(ticketId)!
    // 只通知不撤销(27 号 §3.2-④):工单不结束、Mandate 原样、Executor 不被叫停。
    expect(ticket.ended).toBeUndefined()
    expect(ticket.mandate).toMatchObject({ policyVersion: 'v1', realm: REALM })
    expect(h.stop).not.toHaveBeenCalled()
    expect(ticket.inputs).toEqual([expect.objectContaining({ kind: 'policy-changed', from: 'v1', to: 'v2', effect })])
    expect(h.delivered).toEqual([[ticketId, ticket.inputs[0]!.id]])
    // 订阅未动:后续人的消息照旧直达工单。
    h.engine.receive(trigger('2', { actor: guest })); h.pump()
    expect(h.repo.tickets.get(ticketId)!.inputs).toHaveLength(2)
  })
  it('attach 拒止:人 stop 过的工单(ticketStopped)、Mandate 已失效的已结束工单(mandateRevoked)、未知工单', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    h.engine.report(ticketId, { state: 'ready', summary: 'done' })
    const stopped = accepted(h, '3', 't3').ticketId!
    h.engine.stopTicket(stopped)
    h.setVersion('revoked')
    expect(() => h.engine.attach(ticketId, '1')).toThrow(new UserError('mandateRevoked'))
    h.setVersion('v1')
    expect(() => h.engine.attach(stopped, '1')).toThrow(new UserError('ticketStopped'))
    expect(() => h.engine.attach('missing', '1')).toThrow(new UserError('unknownTicket'))
  })
})

describe('attach 恢复与被打断恢复', () => {
  it('attach 即刻恢复已结束工单:新 Assignment 排队启动,工单回到开放', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    h.engine.report(ticketId, { state: 'ready', summary: 'done' })
    h.engine.receive(trigger('2', { actor: guest, threads: [{ source: 'chat', id: 'elsewhere' }] }))
    const subject = h.engine.attach(ticketId, '2')
    expect(subject).toMatchObject({ assignments: [expect.objectContaining({ state: 'ended' }), expect.objectContaining({ state: 'pending' })] })
    expect(subject).not.toHaveProperty('ended')
  })
  it('attach 带路由注记:持有该消息的 Eval 以 routed ignore 终结;worker 已持有的消息连同注记再来一次', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    h.engine.receive(trigger('2', { actor: guest })); h.pump()
    expect(h.delivered.map(([, input]) => input)).toEqual([key('input', ticketId, 'trigger', '2')])
    // 后续消息未进 Eval 时归 worker 裁决,主会话不可 attach;人重发进 Eval 后才可。
    expect(h.engine.candidate('2')).toBeUndefined()
    expect(() => h.engine.attach(ticketId, '2')).toThrow(new UserError('workerDecides', { tickets: ticketId }))
    expect(h.engine.reevaluate('2')).toBe(true); h.pump()
    expect(h.engine.candidate('2')).toBeDefined()
    const attached = h.engine.attach(ticketId, '2', '客人要的是同一个修复'); h.settle()
    expect(attached.inputs).toEqual([expect.objectContaining({ triggerId: '2' }),
      expect.objectContaining({ triggerId: '2', note: '客人要的是同一个修复' })])
    expect(h.delivered.map(([, input]) => input)).toEqual(attached.inputs.map(input => input.id))
    expect(h.engine.candidate('2')).toBeUndefined()
    expect(h.repo.decisions.byThread('chat:t1').at(-1)).toMatchObject({ kind: 'ignore', reason: [{ code: 'routed', values: { ticket: ticketId } }] })
  })
  it('attach 结束持有该消息的批次 Eval:其余 Trigger 重评(unavailable + routed),消息留给该工单', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!, other = accepted(h, '5', 't5').ticketId!
    const elsewhere = { threads: [{ source: 'chat', id: 'x' }] }
    h.engine.receive(trigger('2', elsewhere)); h.engine.receive(trigger('3', elsewhere)); h.pump()
    h.engine.attach(ticketId, '3'); h.pump()
    expect(h.repo.decisions.byThread('chat:x')).toEqual([expect.objectContaining({ kind: 'unavailable', triggerIds: ['2', '3'],
      reason: [{ code: 'routed', triggerId: '3', values: { ticket: ticketId } }] })])
    expect(h.engine.candidate('2')?.triggers.map(item => item.id)).toEqual(['2'])
    expect(followupOwners(h.repo.triggers.get('3')!, h.repo)).toEqual([ticketId])
    expect(() => h.engine.attach(other, '3')).toThrow(new UserError('workerDecides', { tickets: ticketId }))
  })
  it('worker 交回过的消息不可 attach 回原工单(handedBackHere)', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    h.engine.followForContext(ticketId, { source: 'chat', id: 'issue' })
    h.engine.receive(trigger('4', { threads: [{ source: 'chat', id: 'issue' }] })); h.pump()
    h.decide(h.requests.at(-1)!, { kind: 'ignore', reason: 'chat' })
    // 该工单从未裁决过它(context 线程):交回被记录但不重排;主会话不可再 attach 回它。
    expect(h.engine.handback(ticketId, '4', 'Not this ticket')).toBe(false)
    expect(() => h.engine.attach(ticketId, '4')).toThrow(new UserError('handedBackHere'))
  })
  it('人的消息到达已结束工单的线程:同 Mandate 直接恢复,无 Eval 也无新 Decision(resumed Input 在前)', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    h.engine.report(ticketId, { state: 'ready', summary: 'done' })
    const decisions = h.repo.decisions.byThread('chat:t1').length
    h.engine.receive(trigger('2', { actor: guest }))
    expect(h.repo.tickets.get(ticketId)!.ended).toBeUndefined()
    h.pump()
    const ticket = h.repo.tickets.get(ticketId)!
    expect(ticket.assignments).toHaveLength(2)
    expect(ticket.mandate.policyVersion).toBe('v1')
    expect(ticket.inputs.map(input => input.kind)).toEqual(['trigger', 'resumed'])
    expect(h.start).toHaveBeenCalledTimes(2)
    // 消息仍作为 followup 到达,但无需(也不可能)有 reopen Decision。
    expect(h.repo.decisions.byThread('chat:t1').filter(decision => decision.kind !== 'ignore')).toHaveLength(decisions)
  })
  it('恢复幂等:多次 pass 只恢复一次;Mandate 不再通过当前 Policy 时保持结束并放开等待中的消息', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    h.engine.report(ticketId, { state: 'ready', summary: 'done' })
    h.setVersion('revoked')
    h.engine.receive(trigger('2', { actor: guest })); h.pump()
    expect(h.repo.tickets.get(ticketId)).toMatchObject({ ended: { by: 'executor', outcome: 'completed' }, undelivered: [] })
    h.setVersion('v1')
    h.pump()
    expect(h.repo.tickets.get(ticketId)!.ended).toBeDefined()
    h.engine.receive(trigger('3', { actor: guest })); h.pump(); h.pump()
    const ticket = h.repo.tickets.get(ticketId)!
    expect(ticket.assignments).toHaveLength(2)
    expect(ticket.inputs.filter(input => input.kind === 'resumed')).toHaveLength(1)
  })
  it('assignmentInterrupted:进行中的工作带恢复注记重启;waiting 的 worker 保住 Session 并补投等待中的 Inputs', () => {
    const h = harness()
    const interrupted = accepted(h).ticketId!
    const first = h.repo.tickets.get(interrupted)!.assignments[0]!
    const waiting = accepted(h, '2', 't2').ticketId!
    h.engine.report(waiting, { state: 'waiting', summary: 'done for now' })
    h.engine.receive(trigger('3', { threads: [{ source: 'chat', id: 't2' }] }))
    h.start.mockClear(); h.deliver.mockClear()
    // Executor 对每条运行中 Assignment 报告事实;不再运行的事实被丢弃。
    for (const id of [interrupted, waiting]) h.engine.assignmentInterrupted(id, runningAssignment(h.repo.tickets.get(id)!)!.id)
    h.engine.assignmentInterrupted(interrupted, first.id)
    const ticket = h.repo.tickets.get(interrupted)!
    expect(ticket.assignments).toEqual([expect.objectContaining({ id: first.id, state: 'ended', endedReason: 'hostRestarted' }),
      expect.objectContaining({ state: 'pending' })])
    const recovery = ticket.inputs.at(-1)
    expect(recovery?.kind).toBe('text')
    if (recovery?.kind === 'text') expect(recovery.text).toContain('The host restarted')
    expect(ticket.undelivered).toEqual([ticket.inputs.at(-1)!.id])
    expect(h.start).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: interrupted }), ticket.assignments[1])
    expect(h.repo.tickets.get(waiting)!.assignments).toHaveLength(1)
    expect(h.deliver).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: waiting }), expect.objectContaining({ state: 'running' }))
  })
})

describe('report 六态与 Attention', () => {
  it('progress/waiting 不断单;requestStatus 只请 waiting 的 worker 汇报状态', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    h.engine.report(ticketId, { state: 'progress', summary: 'working' })
    expect(h.repo.tickets.get(ticketId)).not.toHaveProperty('ended')
    h.engine.report(ticketId, { state: 'waiting', summary: 'done for now' })
    expect(h.repo.tickets.get(ticketId)).not.toHaveProperty('ended')
    expect(h.engine.requestStatus(ticketId)).toBe(true)
    const status = h.repo.tickets.get(ticketId)!.inputs.at(-1)!
    expect(status).toMatchObject({ kind: 'text' })
    expect(h.repo.tickets.get(ticketId)!.undelivered).toContain(status.id)
    h.engine.report(ticketId, { state: 'progress', summary: 'back to work' })
    expect(h.engine.requestStatus(ticketId)).toBe(false)
  })
  it('终结报告:dropped 弃单;ready 无跟随线程 completed、有未收尾跟随线程不断单、followsDone 后按其 outcome(取最晚)收尾;ready 清除 Attention', () => {
    const outcome = (state: 'ready' | 'dropped' | 'failed', follows: boolean, closed = false) => {
      const h = harness()
      const ticketId = accepted(h).ticketId!
      h.engine.report(ticketId, { state: 'progress', summary: 'asking', question: 'Merge it?' })
      if (follows) {
        h.engine.bindThread(ticketId, { source: 'gh', id: 'pr-9' }, false)
        h.engine.bindThread(ticketId, { source: 'gh', id: 'pr-10' }, true)
      }
      if (closed) {
        h.engine.threadClosed({ source: 'gh', id: 'pr-9' }, 'closed', '2026-09-22T00:00:00Z')
        h.engine.threadClosed({ source: 'gh', id: 'pr-10' }, 'merged', '2026-09-22T00:00:01Z')
      }
      h.engine.report(ticketId, { state, summary: 'done' })
      return h.repo.tickets.get(ticketId)!
    }
    expect(outcome('dropped', true)).toMatchObject({ ended: { by: 'executor', outcome: 'dropped' } })
    expect(outcome('dropped', true).ended).not.toHaveProperty('reason')
    expect(outcome('ready', false)).toMatchObject({ ended: { outcome: 'completed' } })
    expect(outcome('ready', false)).not.toHaveProperty('attention')
    expect(ticketOutcome(outcome('ready', false))).toBe('completed')
    expect(outcome('ready', true)).toMatchObject({ follows: [{ thread: 'gh:pr-9', own: false }, { thread: 'gh:pr-10', own: true }] })
    expect(outcome('ready', true)).not.toHaveProperty('ended')
    expect(outcome('ready', true)).not.toHaveProperty('attention')
    expect(outcome('ready', true, true)).toMatchObject({ ended: { outcome: 'merged' } })
    expect(ticketOutcome(outcome('ready', true, true))).toBe('merged')
    // failed 保留给人的问题,且不结束工单。
    expect(outcome('failed', false)).toMatchObject({ attention: { question: 'Merge it?' } })
    expect(outcome('failed', false)).not.toHaveProperty('ended')
  })
  it('blocked/failed 压住自动 Input:等待中的与之后到的都扣在工单上,直到人的消息到来', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    const bot = (id: string) => trigger(id, { human: false })
    h.engine.receive(bot('2'))
    h.engine.report(ticketId, { state: 'blocked', summary: 'needs a decision' })
    h.engine.receive(bot('3')); h.settle()
    expect(h.repo.tickets.get(ticketId)).toMatchObject({ undelivered: [],
      inputs: [expect.objectContaining({ triggerId: '2' }), expect.objectContaining({ triggerId: '3' })] })
    expect(h.delivered).toEqual([])
    h.tick(1)
    h.engine.receive(trigger('4', { actor: guest })); h.engine.receive(bot('5')); h.settle()
    expect(h.delivered.map(([, input]) => input)).toEqual([key('input', ticketId, 'trigger', '4'), key('input', ticketId, 'trigger', '5')])
  })
  it('Attention 生命周期:提出(附提问消息)、保留、替换(未发回执被撤回)、清除;ready 报告也清除', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    const asked = h.engine.report(ticketId, { state: 'progress', summary: 'need a call', question: 'Which color?', askedBy: '1' })
    expect(asked.attention).toMatchObject({ question: 'Which color?', triggerId: '1' })
    expect(h.engine.report(ticketId, { state: 'blocked', summary: 'still waiting' }).attention).toEqual(asked.attention)
    expect(h.withdrawn).toEqual([])
    const replaced = h.engine.report(ticketId, { state: 'progress', summary: 'other question', question: 'Which size?' })
    expect(replaced.attention).toMatchObject({ question: 'Which size?' })
    expect(replaced.attention).not.toHaveProperty('triggerId')
    expect(h.withdrawn).toEqual([key('attention-reply', asked.attention!.id)])
    const cleared = h.engine.report(ticketId, { state: 'progress', summary: 'answered', question: null })
    expect(cleared).not.toHaveProperty('attention')
    expect(h.withdrawn).toEqual([key('attention-reply', asked.attention!.id), key('attention-reply', replaced.attention!.id)])
    // 换个问题再由 ready 清除。
    const again = h.engine.report(ticketId, { state: 'progress', summary: 'ask again', question: 'Ship?' })
    expect(again.attention).toMatchObject({ question: 'Ship?' })
    expect(h.engine.report(ticketId, { state: 'ready', summary: 'done' })).not.toHaveProperty('attention')
  })
  it('报告拒绝面:问题不得伴随 ready 结果或答复;提问/答复必须点名人写的、到达本工单的消息;已结束工单拒绝报告', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    h.engine.receive(trigger('2', { human: false, threads: [{ source: 'chat', id: 't1' }] }))
    h.engine.receive(trigger('4', { threads: [{ source: 'chat', id: 'elsewhere' }] }))
    const report = (extra: object) => () => h.engine.report(ticketId, { state: 'progress', summary: 'x', ...extra })
    expect(report({ state: 'ready', question: 'Q?' })).toThrow(new UserError('questionWithResult'))
    expect(report({ question: 'Q?', answers: '1' })).toThrow(new UserError('questionWithResult'))
    expect(report({ askedBy: '1' })).toThrow(new UserError('askerWithoutQuestion'))
    expect(report({ question: 'Q?', askedBy: '2' })).toThrow(new UserError('notAsker'))
    expect(report({ answers: '4' })).toThrow(new UserError('notAnswerable'))
    expect(report({ answers: '1' })()).toMatchObject({ answers: ['1'] })
    h.engine.stopTicket(ticketId)
    expect(() => h.engine.report(ticketId, { state: 'progress', summary: 'x' })).toThrow(new UserError('ticketEnded'))
  })
})

describe('waitsForPerson 与重试', () => {
  it('等人解除的三条路:人的消息、后续非 blocked/failed 报告、重试;期间 stage 可见化(person/blocked)', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    const ticket = () => h.repo.tickets.get(ticketId)!
    h.engine.report(ticketId, { state: 'blocked', summary: 'needs a decision' })
    expect(waitsForPerson(ticket())).toBe(true)
    expect(ticketStage(ticket())).toEqual({ stage: 'person', action: 'blocked' })
    h.tick(1); h.engine.receive(trigger('2', { actor: guest })); h.settle()
    expect(waitsForPerson(ticket())).toBe(false)
    expect(ticketStage(ticket())).toEqual({ stage: 'working' })
    h.tick(1); h.engine.report(ticketId, { state: 'failed', summary: 'broke' })
    expect(waitsForPerson(ticket())).toBe(true)
    h.tick(1); h.engine.report(ticketId, { state: 'progress', summary: 'found a way' })
    expect(waitsForPerson(ticket())).toBe(false)
    h.tick(1); h.engine.report(ticketId, { state: 'blocked', summary: 'needs access' })
    h.engine.retryTicket(ticketId)
    expect(waitsForPerson(ticket())).toBe(false)
  })
  it('重试:卡住的 Assignment 结束,同一 Mandate 下另起新的', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    h.engine.report(ticketId, { state: 'failed', summary: 'broke' })
    const before = h.repo.tickets.get(ticketId)!
    const after = h.engine.retryTicket(ticketId)
    expect(after.assignments.map(assignment => assignment.state)).toEqual(['ended', 'pending'])
    expect(after.mandate).toEqual(before.mandate)
    expect(after).not.toHaveProperty('ended')
    expect(h.repo.tickets.get(ticketId)).not.toHaveProperty('ended')
  })
  it('不可重试:failed 报告之后人已再发言(工单已回 executor),或工单已被人 stop', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    h.engine.report(ticketId, { state: 'failed', summary: 'x' })
    h.tick(1)
    h.engine.receive(trigger('2', { actor: guest }))
    expect(() => h.engine.retryTicket(ticketId)).toThrow(new UserError('notRetryable'))
    const other = accepted(h, '3', 't3').ticketId!
    h.engine.report(other, { state: 'failed', summary: 'x' })
    h.engine.stopTicket(other)
    expect(() => h.engine.retryTicket(other)).toThrow(new UserError('notRetryable'))
  })
})

describe('policyChanged(只通知不撤销)', () => {
  it('effects 命中的开放工单收到 policy-changed Input 并投递,未命中的不动;在飞 Eval 换新版重评', () => {
    const h = harness()
    const decision = accepted(h)
    const other = accepted(h, '3', 't3').ticketId!
    h.engine.receive(trigger('2', { threads: [{ source: 'chat', id: 't2' }] })); h.pump()
    const effect = { rules: [{ id: 'copy', name: 'Copy', change: 'changed' as const, instruction: 'Fix typos only.' }] }
    h.setVersion('v2'); h.engine.policyChanged('v1', 'v2', new Map([[decision.ticketId!, effect]])); h.settle()
    expect(h.repo.tickets.get(decision.ticketId!)!.inputs).toEqual([expect.objectContaining({ kind: 'policy-changed', from: 'v1', to: 'v2', effect })])
    expect(h.repo.tickets.get(other)!.inputs.filter(input => input.kind === 'policy-changed')).toEqual([])
    expect(h.repo.decisions.byThread('chat:t2')).toEqual([expect.objectContaining({ kind: 'unavailable', reason: [{ code: 'policyChanged' }] })])
    expect(h.repo.threads.get('chat:t2')?.pending).toEqual(['2'])
    h.pump()
    expect(h.requests.at(-1)).toMatchObject({ policyVersion: 'v2', triggers: [expect.objectContaining({ id: '2' })] })
    const told = h.repo.tickets.get(decision.ticketId!)!.inputs.find(input => input.kind === 'policy-changed')!
    expect(h.delivered).toContainEqual([decision.ticketId, told.id])
  })
  it('投递失败的 pending Assignment 不因 Policy 变更重启,人的消息才重启它', () => {
    const h = harness()
    h.engine.receive(trigger('1')); h.pump()
    const ticketId = h.decide(h.requests.at(-1)!, { kind: 'accept', title: 'Fix', scope: 'small', reason: 'requested', delegation: DELEGATION }).ticketId!
    h.engine.report(ticketId, { state: 'failed', summary: 'The prepare command failed' })
    h.start.mockClear()
    h.setVersion('v2'); h.engine.policyChanged('v1', 'v2')
    expect(h.start).not.toHaveBeenCalled()
    h.tick(1); h.engine.receive(trigger('2', { actor: guest }))
    expect(h.start).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: ticketId }), expect.objectContaining({ state: 'pending' }))
  })
  it('同一对版本的反复切换仍各记一条新 policy-changed Input', () => {
    const h = harness()
    const ticketId = accepted(h).ticketId!
    const effect = { proactive: false as const }
    h.setVersion('v2'); h.engine.policyChanged('v1', 'v2', new Map([[ticketId, effect]]))
    h.tick(1); h.setVersion('v1'); h.engine.policyChanged('v2', 'v1', new Map([[ticketId, effect]]))
    const ticket = h.repo.tickets.get(ticketId)!
    expect(ticket.inputs.filter(input => input.kind === 'policy-changed')).toHaveLength(2)
    expect(ticket.mandate.policyVersion).toBe('v1')
  })
})

describe('realm 首参路由(realm 标注落库断言)', () => {
  it('一处标注、四处一致:disposition.realm → mandate.realm / ticket.realm / ticket.ended 载荷', () => {
    const events: { type: string; data: Record<string, unknown> }[] = []
    const h = harness({}, { emit: event => events.push(event) })
    expect(h.engine.receive(trigger('1', { meta: { realm: 'tenant-b' } }))).toBe('stored')
    expect(h.repo.triggers.disposition('1')).toMatchObject({ realm: 'tenant-b' })
    h.pump()
    const decision = h.decide(h.requests[0]!, { kind: 'accept', title: 'Fix', scope: 'small', reason: 'requested', delegation: DELEGATION })
    h.settle()
    const ticket = h.repo.tickets.get(decision.ticketId!)!
    expect(ticket.realm).toBe('tenant-b')
    expect(ticket.mandate.realm).toBe('tenant-b')
    h.engine.stopTicket(ticket.id)
    expect(events.at(-1)).toMatchObject({ type: 'ticket.ended', data: { ticketId: ticket.id, realm: 'tenant-b', by: 'human', outcome: 'stopped' } })
  })
  it('双 realm 并行:realm 取 origin Trigger 的标注,各工单各自归账、互不串租', () => {
    const h = harness()
    const a = accepted(h).ticketId!
    h.engine.receive(trigger('2', { threads: [{ source: 'chat', id: 't2' }], meta: { realm: 'tenant-c' } })); h.pump()
    const b = h.decide(h.requests.at(-1)!, { kind: 'accept', title: '另一租户的活', scope: 'small', reason: 'requested', delegation: DELEGATION }).ticketId!
    h.settle()
    expect(h.repo.tickets.get(a)!.realm).toBe(REALM)
    expect(h.repo.tickets.get(a)!.mandate.realm).toBe(REALM)
    expect(h.repo.tickets.get(b)!.realm).toBe('tenant-c')
    expect(h.repo.tickets.get(b)!.mandate.realm).toBe('tenant-c')
    expect(h.repo.triggers.disposition('2')).toMatchObject({ realm: 'tenant-c' })
  })
})

describe('单写者与五角色接口', () => {
  it('五个角色 Pick 接口键集与 SA engine.ts:261-270 一致(签名不变),Engine 实例可分别代入', () => {
    expectTypeOf<EngineForSources>().toEqualTypeOf<Pick<Engine, 'receive' | 'bindThread' | 'threadClosed'>>()
    expectTypeOf<EngineForMainSession>().toEqualTypeOf<Pick<Engine, 'candidate' | 'candidateDelivered' | 'decide' | 'attach' | 'reply' | 'requestStatus' | 'note'>>()
    expectTypeOf<EngineForPeople>().toEqualTypeOf<Pick<Engine, 'stopTicket' | 'retryTicket' | 'reevaluate' | 'unsubscribe' | 'dismiss'>>()
    expectTypeOf<EngineForSettings>().toEqualTypeOf<Pick<Engine, 'policyChanged'>>()
    expectTypeOf<EngineForExecutor>().toEqualTypeOf<Pick<Engine, 'assignmentStarted' | 'inputsDelivered' | 'inputsRead' | 'turnEnded' | 'deliveryFailed'
      | 'assignmentInterrupted' | 'report' | 'markUnrelated' | 'handback' | 'followForContext' | 'reply'>>()
    const h = harness()
    const forSources: EngineForSources = h.engine
    const forMain: EngineForMainSession = h.engine
    const forPeople: EngineForPeople = h.engine
    const forSettings: EngineForSettings = h.engine
    const forExecutor: EngineForExecutor = h.engine
    expect([typeof forSources.receive, typeof forMain.attach, typeof forPeople.stopTicket,
      typeof forSettings.policyChanged, typeof forExecutor.report])
      .toEqual(['function', 'function', 'function', 'function', 'function'])
  })
  it('交接 handoffOf 指向未知原工单:accept 整单回滚(Decision/工单/订阅全无,Eval 仍在)', () => {
    const h = harness()
    h.engine.receive(trigger('1')); h.pump()
    const evalId = h.requests[0]!.evalId
    expect(() => h.decide(h.requests[0]!, { kind: 'accept', title: 'H', scope: 's', reason: 'r', delegation: DELEGATION, handoffOf: 'missing' }))
      .toThrow(new UserError('unknownTicket'))
    expect(h.repo.decisions.byThread('chat:t1')).toEqual([])
    expect(h.repo.tickets.list()).toEqual([])
    expect(h.repo.threads.get('chat:t1')).toMatchObject({ evaluating: { id: evalId }, subscriptions: [] })
  })
  it('交接 handoffOf 有效:新工单 Mandate 独立并记录 references,原工单订阅新工单线程;原工单已结束则整单回滚', () => {
    const h = harness()
    const original = accepted(h).ticketId!
    h.engine.receive(trigger('2', { threads: [{ source: 'chat', id: 't2' }] })); h.pump()
    const handed = h.decide(h.requests.at(-1)!, { kind: 'accept', title: '接手', scope: 'small', reason: 'handoff', delegation: DELEGATION, handoffOf: original })
    h.settle()
    const ticket = h.repo.tickets.get(handed.ticketId!)!
    expect(ticket.references).toEqual([original])
    expect(ticket.mandate).toMatchObject({ realm: REALM, strength: 'explicit' })
    expect(h.repo.threads.get('chat:t2')!.subscriptions).toEqual([ticket.id, original])
    h.engine.stopTicket(original)
    h.engine.receive(trigger('3', { threads: [{ source: 'chat', id: 't3' }] })); h.pump()
    expect(() => h.decide(h.requests.at(-1)!, { kind: 'accept', title: '再接', scope: 'small', reason: 'handoff', delegation: DELEGATION, handoffOf: original }))
      .toThrow(new UserError('ticketEnded'))
  })
  it('无线程的 Trigger 拒收且库内无残留(事务内校验先于一切落库)', () => {
    const h = harness()
    expect(() => h.engine.receive(trigger('1', { threads: [] }))).toThrow('at least one thread')
    expect(h.repo.triggers.get('1')).toBeUndefined()
    expect(h.repo.threads.list()).toEqual([])
  })
})
