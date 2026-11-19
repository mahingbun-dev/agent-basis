/**
 * MasterAssessor(35 号 A19 验收门禁;34 号 §4-D 承接表「assessment.spec.ts → assessor.spec.ts:
 * per-eval 状态隔离、release 清理、上下文加载;★R3 四要素进入候选卡与 outcome 校验」;
 * cache.spec.ts 并入本文件——TextCache 机制由上下文加载测试覆盖,34 §4-C cache 行)。
 *
 * 依据条款:34 号 §2.5 assessor 行(28 号 §1.1 决策局部化不变;Candidate.tickets 含已结束工单,
 * ports.ts:43-51);27 号 §3.3-B;24 §5.3(评估者不拥有领域状态)。
 * 语义自 SA tests/assessment.spec.ts 整承接重写:Commands/feishu 面换 TriggerContext 端口,
 * runtime 宿主换 MemoryRepositories + 假件(34 §4-A 假件模式)。
 */
import { expect, it, vi } from 'vitest'
import {
  Engine, MemoryRepositories, SettingsSchema, UserError, assessmentOutcome,
  type Candidate, type Executor, type Outbox, type Policy, type Settings, type SourceScope, type Ticket, type Trigger,
} from '../src/index.ts'
import { AssessmentSchema, EvalReadSchema, MasterAssessor, TextCache, type AssessorHost, type ThreadPage, type TriggerContext } from '../src/session/assessor.ts'

/** 一条 issue trigger(触发线程 github:<n>;id 的数字位作时间偏移)。 */
const issue = (n: number): Trigger => ({ id: `issue-${n}`, source: 'github', threads: [{ source: 'github', id: String(n) }], actor: { source: 'github', id: 'bob' }, human: true,
  at: new Date(Date.UTC(2026, 8, 9, 0, 0, n)).toISOString(), text: `issue ${n}`, url: `https://github.com/acme/widgets/issues/${n}`, meta: { number: n } })
const signal = new AbortController().signal

/** R3 委派四要素齐备的一份(accept 用)。 */
const DELEGATION = { objective: '修复回归', outputFormat: '补丁', toolGuidance: '读/编辑工具', taskBoundaries: '仅该缺陷' }
/** AdmissionDirection 方向已定的一份。 */
const DIRECTION = { implementation_requested: true, target_basis: 'specified', requires_design_decision: false, evidence: 'asked to fix' }

/**
 * 评估者夹具:内存仓储 + 真 Engine(gate 全放、strength 可调)+ 假 TriggerContext
 * (每消息一页,`next` 游标可配)。返回 assessor、其 per-eval 状态计数与评估编排面。
 */
/** 主会话引擎面(assessor host 的 engine 半边;engine 以闭包惰性取用,循环初始化)。 */
function engineFace(get: () => Engine): Pick<Engine, 'candidate' | 'candidateDelivered' | 'decide'> {
  return {
    candidate: (id: string) => get().candidate(id),
    candidateDelivered: (evalId: string) => { get().candidateDelivered(evalId) },
    decide: (id: string, outcome: Parameters<Engine['decide']>[1]) => get().decide(id, outcome),
  }
}

function setup(strength: 'explicit' | 'inferred' = 'inferred',
  bodies: string[] = Array.from({ length: 5 }, (_, i) => `comment ${i}`),
  threadContext?: (trigger: Trigger) => TriggerContext | undefined, settings?: Record<string, unknown>) {
  const repo = new MemoryRepositories()
  const host: AssessorHost = {
    // engine 在下方以 const 初始化;getter 惰性取用(handler 运行时不早于 engine 就绪)。
    get engine() { return engineFace(() => engine) },
    effects: { enqueue: vi.fn(), handle: vi.fn() },
    settings: () => SettingsSchema.parse(settings ?? {}),
    paused: () => false,
    threadContext: threadContext ?? ((trigger: Trigger): TriggerContext => ({
      messageId: trigger.id,
      async read(part, _cursor): Promise<ThreadPage> {
        expect(part).toBe('thread')
        // 首条是触发消息自身(触发点在已加载消息里,source_found=true),其余为批次前文。
        return { messages: [{ id: trigger.id, from: 'bob', at: trigger.at, text: trigger.text },
          ...bodies.map((body, i) => ({ id: `${trigger.id}#c${i}`, from: 'bob', at: new Date(Date.UTC(2026, 8, 9, 0, 0, i)).toISOString(), text: body }))],
        body: { comments: bodies.length } }
      },
    })),
  }
  const assessor = new MasterAssessor(host)
  const policy: Policy = { version: 'v1', paused: false, evalTimeoutMs: 600_000, gate: () => ({ admissible: true, strength, basis: { via: 'followup' } }),
    revalidate: () => true, admitsInferred: rules => rules.length > 0 }
  const executor: Executor = { start: () => {}, deliver: () => {}, stop: () => {} }
  const scope: SourceScope = { scope: () => ({ listened: true, observed: true }) }
  const outbox: Outbox = { send: () => {}, status: () => undefined, withdraw: () => {} }
  const engine = new Engine({ repo, policy: () => policy, realmOf: () => 'alice', scope, assessor, executor, outbox })
  // per-Eval 状态留存的面(SA kept.evals.size 同构)。
  const kept = (): number => assessor.keptEvals()
  /** 开一次 Eval(receive + pass)并返回其候选。 */
  const evaluate = (trigger: Trigger): Candidate => {
    expect(engine.receive(trigger)).toBe('stored')
    engine.evaluateDue()
    const candidate = engine.candidate(trigger.id)
    if (!candidate) throw new Error('没有候选')
    return candidate
  }
  return { engine, assessor, kept, evaluate, host, repo }
}

it('Eval 已决(或超时)后不留任何状态;每个 Eval 的状态彼此隔离', async () => {
  const s = setup()
  for (let n = 1; n <= 3; n++) {
    s.evaluate(issue(n))
    await s.assessor.context(`issue-${n}`, signal)
    await s.assessor.read(EvalReadSchema.parse({ trigger_id: `issue-${n}`, resource: 'thread', offset: 0 }), signal)
    expect(s.kept()).toBeGreaterThan(0)
    // 决断即释放(Engine 经 release 通知;per-eval 状态隔离:其他 Eval 不受扰)。
    s.engine.decide(`issue-${n}`, { kind: 'ignore', reason: 'not a request' })
    expect(s.kept()).toBe(0)
  }
  // 超时(expired)同样释放。
  s.evaluate(issue(9))
  await s.assessor.context('issue-9', signal)
  const thread = s.repo.threads.get('github:9')!
  s.repo.threads.save({ ...thread, expired: 2, evaluating: { ...thread.evaluating!, delivered: '2000-01-01T00:00:00.000Z', deadline: '2000-01-01T00:00:00.000Z' } })
  s.engine.evaluateDue()
  expect(s.kept()).toBe(0)
})

it('迟到的上下文加载在其 Eval 已决后丢弃结果并报已结束', async () => {
  // 触发消息的上下文读取由受闸的 Promise 卡住,直到 Eval 已决后才放行。
  let gate: ((page: ThreadPage) => void) | undefined
  const held = new Promise<ThreadPage>((resolve) => { gate = resolve })
  const s = setup('inferred', Array.from({ length: 5 }, (_, i) => `comment ${i}`), trigger => ({
    messageId: trigger.id,
    read: async (): Promise<ThreadPage> => held,
  }))
  s.evaluate(issue(1))
  const pending = s.assessor.context('issue-1', signal)
  s.engine.decide('issue-1', { kind: 'ignore', reason: 'not a request' })
  gate!({ messages: [{ id: 'issue-1', from: 'bob', at: '', text: 'late' }] })
  await expect(pending).rejects.toThrow('This assessment has finished')
  expect(s.kept()).toBe(0)
})

it('经 Source 端口读上下文;无线程上下文的 Source 给显式说明、其触发文本仍可读', async () => {
  const s = setup()
  s.evaluate(issue(1))
  const context = await s.assessor.context('issue-1', signal)
  expect(context.thread).toMatchObject({ complete: true, loaded_messages: 6, source_found: true })
  const page = (await s.assessor.read(EvalReadSchema.parse({ trigger_id: 'issue-1', resource: 'thread', offset: 0 }), signal)) as { text: string }
  const threadBody = JSON.parse(page.text) as { next_read: null; messages: { id: string; text: string }[] }
  expect(threadBody.next_read).toBeNull()
  expect(threadBody.messages.some(item => item.text === 'comment 0')).toBe(true)
  // 线程续页:next_read 的游标可续读(初载窗口末尾)。
  // 无端口的 Source:NO_CONTEXT 说明;触发消息全文仍以 message 读取。
  const other: Trigger = { ...issue(2), id: 'other-2', source: 'probe', threads: [{ source: 'probe', id: '2' }], actor: { source: 'probe', id: 'bob' } }
  const none = setup('inferred', [], () => undefined)
  none.evaluate(other)
  const bare = await none.assessor.context('other-2', signal)
  expect((bare.thread as { error: string }).error).toContain('gives no Thread context')
  await expect(none.assessor.read(EvalReadSchema.parse({ trigger_id: 'other-2', resource: 'thread', offset: 0 }), signal)).rejects.toThrow('gives no Thread context')
  expect(await none.assessor.read(EvalReadSchema.parse({ trigger_id: 'other-2', resource: 'message', offset: 0 }), signal)).toMatchObject({ text: 'issue 2' })
})

it('显式候选走路由不走评估:三个 eval 工具位都点名 orchestrator_route', async () => {
  const s = setup('explicit')
  s.evaluate(issue(1))
  const routed = 'use orchestrator_route with its trigger_id and kind accept, attach, stop or ignore'
  await expect(s.assessor.context('issue-1', signal)).rejects.toThrow(routed)
  await expect(s.assessor.read(EvalReadSchema.parse({ trigger_id: 'issue-1', resource: 'message', offset: 0 }), signal)).rejects.toThrow(routed)
  await expect(s.assessor.decide('issue-1', AssessmentSchema.parse({ decision: 'ignore', rule_assessments: [], direction: DIRECTION, title: 't', scope: 's', reason: 'r' }), signal)).rejects.toThrow(routed)
})

it('裁决 schema 只收 ignore/unavailable/accept,不收 reopen/stop,也不收多余键(strict)', () => {
  const result = (decision: string, extra: Record<string, unknown> = {}) =>
    AssessmentSchema.safeParse({ decision, rule_assessments: [], direction: DIRECTION, title: 't', scope: 's', reason: 'r', ...extra }).success
  expect([result('ignore'), result('unavailable'), result('accept'), result('reopen'), result('stop')]).toEqual([true, true, true, false, false])
  // .strict():未知键拒;delegation 仅 accept 读取(schema 上可缺席)。
  expect(result('ignore', { ticket_id: 't' })).toBe(false)
  expect(result('ignore', { delegation: DELEGATION })).toBe(true)
})

it('窗口不带评估指令:触发原文一次、截断附长度、其余存根', async () => {
  // 30 条消息的线程,触发点是 #15(其消息 id 即 c15);长度档位:i%4==0 → 未超限、==1 → 1408(近邻截 1200)、
  // ==2 → 68(未超限)、==3 → 508(窗口截 400)。
  const bodies = Array.from({ length: 30 }, (_, i) => `comment ${i}: ${'the label reads oddly on the settings page. '.repeat([40, 60, 3, 20][i % 4] ?? 3)}`)
  const s = setup('inferred', bodies, trigger => ({
    messageId: trigger.id,
    async read(part): Promise<ThreadPage> {
      expect(part).toBe('thread')
      return { messages: bodies.map((body, i) => ({ id: `c${i}`, from: 'bob', at: new Date(Date.UTC(2026, 8, 9, 0, 0, i)).toISOString(), text: body })) }
    },
  }))
  const trigger = { ...issue(1), id: 'c15', text: bodies[15]!, meta: { number: 1 } }
  s.evaluate(trigger)
  const result = await s.assessor.context('c15', signal) as Record<string, unknown> & { thread: { messages: Record<string, unknown>[] } }
  expect(result).not.toHaveProperty('instructions')
  expect(result.text).toBe(bodies[15])
  const messages = new Map(result.thread.messages.map(entry => [(entry.id as string), entry]))
  const at = (i: number) => messages.get(`c${i}`)!
  // 触发点只标 trigger(其全文已在顶层);近邻 1200、窗口 400、未超限原样、窗外 50 字符存根。
  expect(at(15)).toEqual({ id: 'c15', from: 'bob', at: '2026-09-09T00:00:15.000Z', trigger: true })
  expect(at(16)).toMatchObject({ chars: bodies[16]!.length, text: `${bodies[16]!.slice(0, 1200)}…` })
  expect(at(12)).toMatchObject({ chars: bodies[12]!.length, text: `${bodies[12]!.slice(0, 400)}…` })
  expect(at(14)).toMatchObject({ text: bodies[14] })
  expect(at(14)).not.toHaveProperty('chars')
  expect(at(8)).toEqual({ id: 'c8', from: 'bob', preview: bodies[8]!.slice(0, 50) })
  // 存根全文按 message_id 读。
  const whole = (await s.assessor.read(EvalReadSchema.parse({ trigger_id: 'c15', resource: 'message', message_id: (at(8) as { id: string }).id, offset: 0 }), signal)) as { text: string }
  expect(JSON.stringify(whole)).toContain(bodies[8]!.slice(-40))
  // 卡片总量有界(SA 同款断言形态):逐消息界限是上一组断言(400/1200/50);
  // 总量预算随本夹具实测回填 <12000(28 §1.1 的契约在逐消息界限与触发原文 ≤4000)。
  expect(JSON.stringify(result).length).toBeLessThan(12000)
})

it('候选卡带 Engine 计算的决策局部化事实:related_tickets(含已结束)+ tickets_total + policy_version', async () => {
  const s = setup('inferred')
  s.evaluate(issue(1))
  // 线程上先放一张已结束与一张开放的工单(Candidate.tickets 由 Engine 计算,含已结束——27 §3.3-B)。
  const at = '2026-09-09T00:00:00Z'
  const base = (id: string): Ticket => ({ id, title: id, decisionId: `d-${id}`, realm: 'alice',
    mandate: { strength: 'inferred', policyVersion: 'v1', realm: 'alice', basis: { via: 'followup' }, actor: { source: 'github', id: 'bob' }, scope: 's' },
    channels: [], assignments: [], inputs: [], undelivered: [], origin: { triggerId: id, triggerIds: [id] }, createdAt: at, updatedAt: at })
  s.repo.tickets.save({ ...base('done-ticket'), ended: { at, by: 'human', outcome: 'stopped' } })
  s.repo.tickets.save(base('open-ticket'))
  // Candidate.tickets = Engine 的 ticketsOnThread(线程订阅;含已结束工单——27 §3.3-B)。
  const thread = s.repo.threads.get('github:1')!
  s.repo.threads.save({ ...thread, subscriptions: ['open-ticket', 'done-ticket'] })
  const context = await s.assessor.context('issue-1', signal) as Record<string, unknown>
  expect(context).toMatchObject({ tickets_total: 2, policy_version: 'v1' })
  expect((context.related_tickets as { ticket_id: string; state: string }[]).map(card => [card.ticket_id, card.state]))
    .toEqual([['open-ticket', 'working/queued'], ['done-ticket', 'stopped']])
  // 送达的紧凑候选卡同样带 Engine 计算的相关工单与档位。
  const candidate = s.engine.candidate('issue-1')!
  const cardFace = s.assessor as unknown as { candidateCard: (c: Candidate) => Promise<Record<string, unknown>> }
  const card = await cardFace.candidateCard(candidate)
  expect(card).toMatchObject({ tickets_total: 2, mode: 'observe', strength: 'inferred' })
  expect(String(card.next_action)).toContain('orchestrator_eval_decide')
})

it('R3 四要素进入 outcome 校验:accept 缺任一要素即拒;齐备则 Decision 落库', async () => {
  // 启用一条规则并让评估命中它(accept 需方向已定 + 命中启用规则 + 证据 + 四要素)。
  const s = setup('inferred', Array.from({ length: 5 }, (_, i) => `comment ${i}`), undefined,
    { eval: { mode: 'auto' }, policy: { rules: [{ id: 'copy', name: 'Copy', enabled: true, instruction: 'Fix typos.' }] } })
  s.evaluate(issue(1))
  const decision = async (delegation: unknown): Promise<{ ok: boolean; error?: unknown }> => {
    try {
      await s.assessor.decide('issue-1', {
        decision: 'accept', rule_assessments: [{ rule_id: 'copy', matched: true, reason: 'matches the copy rule' }],
        direction: DIRECTION, title: '修复回归', scope: '修复登录回归的范围',
        reason: 'explicit request', intent_evidence: 'asked to fix the login regression', worktree_name: 'fix-login',
        ...(delegation !== undefined ? { delegation } : {}),
      } as unknown as Parameters<typeof s.assessor.decide>[1], signal)
      return { ok: true }
    } catch (error) { return { ok: false, error } }
  }
  // 缺 delegation → UserError('delegationIncomplete')(assessmentOutcome 校验,结构不靠 prompt)。
  const missing = await decision(undefined)
  expect(missing.ok).toBe(false)
  expect((missing.error as UserError).code).toBe('delegationIncomplete')
  // 四要素任一空白同样拒(zod trim 面校验)。
  expect((await decision({ ...DELEGATION, outputFormat: '  ' })).ok).toBe(false)
  // 齐备 → 工单开出,四要素随 Decision 落库(审计链一环,35 号表②-6)。
  expect(await decision(DELEGATION)).toEqual({ ok: true })
  const recorded = s.engine.candidate('issue-1')
  expect(recorded).toBeUndefined() // Eval 已终结
  const decisions = s.repo.decisions.byThread('github:1')
  expect(decisions[0]).toMatchObject({ kind: 'accept', delegation: DELEGATION })
  expect(s.repo.tickets.get(decisions[0]!.ticketId!)?.realm).toBe('alice')
})

it('observe 档的推断 accept 记 would_accept(评估层),auto 档才真实受理', async () => {
  const assessment = {
    decision: 'accept' as const, rule_assessments: [{ rule_id: 'copy', matched: true, reason: 'matches' }], direction: DIRECTION,
    title: 't', scope: 's', reason: 'r', intent_evidence: 'e', worktree_name: 'w', delegation: DELEGATION,
  }
  const RULES = { policy: { rules: [{ id: 'copy', name: 'Copy', enabled: true, instruction: 'Fix typos.' }] } }
  const settings2 = (mode: Settings['eval']['mode']): Settings => {
    const base = SettingsSchema.parse({})
    return { ...base, eval: { ...base.eval, mode }, policy: { ...base.policy, rules: RULES.policy.rules } }
  }
  // observe(缺省档):转译为 ignore + would_accept 提案(B1 观察模式)。
  const observed = assessmentOutcome(assessment, settings2('observe'), 'inferred')
  expect(observed).toMatchObject({ kind: 'ignore' })
  expect((observed as { audit?: { would_accept?: boolean } }).audit?.would_accept).toBe(true)
  // auto 档:accept 通过(Engine 侧另有同码兜底)。
  const auto = assessmentOutcome(assessment, settings2('auto'), 'inferred')
  expect(auto.kind).toBe('accept')
})

it('候选卡投递:assessment effect 幂等入队;deliver 只在进入回合后 resolve,此前不起算 deadline', async () => {
  const repo = new MemoryRepositories()
  // 未 resolve 的投递 = 候选卡还在主会话 inbox 排队（忙碌回合）；直到被回合收走才 resolve。
  const entered = Promise.withResolvers<undefined>()
  const deliver = vi.fn((_requestId: string, _text: string): Promise<void> => entered.promise.then(() => {}))
  const handlers: ((payload: { triggerId: string }, key: string) => Promise<void>)[] = []
  const host: AssessorHost = {
    // engine 在下方以 const 初始化;getter 惰性取用(handler 运行时不早于 engine 就绪)。
    get engine() { return engineFace(() => engine) },
    effects: {
      enqueue: vi.fn(),
      handle: (_kind: string, handler: (payload: { triggerId: string }, key: string) => Promise<void>): void => { handlers.push(handler) },
    },
    settings: () => SettingsSchema.parse({}),
    paused: () => false,
    deliver,
  } as unknown as AssessorHost
  const assessor = new MasterAssessor(host)
  const policy: Policy = { version: 'v1', paused: false, evalTimeoutMs: 600_000, gate: () => ({ admissible: true, strength: 'inferred', basis: { via: 'followup' } }),
    revalidate: () => true, admitsInferred: rules => rules.length > 0 }
  const engine = new Engine({ repo, policy: () => policy, realmOf: () => 'alice',
    scope: { scope: () => ({ listened: true, observed: true }) },
    assessor, executor: { start: () => {}, deliver: () => {}, stop: () => {} },
    outbox: { send: () => {}, status: () => undefined, withdraw: () => {} } })
  // request:按 evalId 幂等入队('assessment' effect,UPSERT 合并)。
  repo.threads.save({ key: 'github:1', ref: { source: 'github', id: '1' }, createdAt: '', subscriptions: [], correlated: [], pending: [], meta: {} })
  repo.triggers.save(issue(1))
  repo.threads.save({ ...repo.threads.get('github:1')!, evaluating: { id: 'eval-1', threadKey: 'github:1', triggerIds: ['issue-1'], strength: 'inferred',
    actor: { source: 'github', id: 'bob' }, basis: { via: 'followup' }, policyVersion: 'v1', startedAt: '', deadline: '' } })
  assessor.request(engine.candidate('issue-1')!)
  expect(host.effects.enqueue).toHaveBeenCalledWith('assessment', 'eval-1', { triggerId: 'issue-1' })
  // 投递 handler:组装紧凑候选卡、deliver 一次;deliver 未 resolve（卡在排队）时 deadline 不起算。
  expect(handlers).toHaveLength(1)
  const running = handlers[0]!({ triggerId: 'issue-1' }, 'eval-1')
  // handler 里 candidateCard 是 async:等 deliver 真的被调用(仍 await 在未 resolve 的投递上)。
  await vi.waitFor(() => { expect(deliver).toHaveBeenCalledTimes(1) })
  expect(deliver.mock.calls[0]![0]).toBe('candidate:eval-1')
  expect(JSON.parse(deliver.mock.calls[0]![1])).toMatchObject({ kind: 'candidate', tickets_total: 0 })
  expect(repo.threads.get('github:1')?.evaluating?.delivered).toBeUndefined()
  // 被主会话回合收走（deliver resolve）才 candidateDelivered 起算 deadline。
  entered.resolve(undefined)
  await running
  expect(repo.threads.get('github:1')?.evaluating?.delivered).toBeTruthy()
})

it('TextCache:按 UTF-16 码元总量有界,恒保留最近插入项', () => {
  const cache = new TextCache(100)
  cache.set('a', 'x'.repeat(60))
  cache.set('b', 'y'.repeat(60)) // 超限:逐出最旧的 a
  expect(cache.get('a')).toBeUndefined()
  expect(cache.get('b')).toBe('y'.repeat(60))
  cache.set('c', 'z'.repeat(10))
  // 命中触碰为最近使用:b 不被逐出,a(已不在)无影响。
  expect(cache.get('b')).toBeDefined()
  // 从最旧到最新:c(插入后未触碰)在前,b(刚被命中触碰为最新)在后。
  expect([...cache.entries()].map(([key]) => key)).toEqual(['c', 'b'])
})
