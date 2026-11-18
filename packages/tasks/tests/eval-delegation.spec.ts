/**
 * R3 委派四要素硬约束与评估批次/Decision(35 号 A7 验收门禁;34 §4-A evals 行)。
 *
 * 门禁面(33 号 §1.3 G2-A5 原文):候选卡缺 objective / output format / tool guidance /
 * task boundaries 任一项 → Eval 拒绝(结构校验,不靠 prompt)。依据条款:24 §5.5-R3
 * (缺项则 Eval 拒绝;业界证据:模糊委派是重复劳动首因)、24a 拍板记录·B1。
 * 本文件对账的断言(35 号 A7 交付条款逐处):
 * - R3 落点双层:评估转译层(assessmentOutcome,候选卡面)与内核兜底层(Engine.decide 的
 *   completeDelegation)同码拒绝——`UserError('delegationIncomplete')`;「缺失」含字段缺席、
 *   非字符串值与纯空白;结构校验先于一切状态读取,拒后 Eval 状态原封不动;
 * - 批次与 Decision:一批排队 Trigger 合成一次 Eval,accept 产出一条 Decision(全批 triggerIds)
 *   与一张工单(origin 为全批),四要素随 Decision 落库(35 号表②-6 审计链);
 * - accept 固化 Mandate 时写入 realm(取 intake 落库标注);
 * - inferred 只在 auto 档按启用规则可 accept(内核半边;observe 档 would_accept 在评估层,policy.spec 对账)。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  Engine, MemoryRepositories, SettingsSchema, UserError, assessmentOutcome, settingsPolicy,
  type Assignment, type Assessor, type Candidate, type Delegation, type Executor, type Outcome, type Outbox,
  type OutboundMessage, type Settings, type SourceScope, type Ticket, type Trigger,
} from '../src/index.ts'

const MEMBER = 'ou_alice'
const STRANGER = 'ou_guest'
const CHAT = 'oc_team'
const REALM = 'tenant-a'
/** R3 委派四要素(35 号 A7);缺项用例逐字段单独构造。 */
const DELEGATION = { objective: '修复登录页在移动端的崩溃', outputFormat: 'Git 补丁', toolGuidance: '仓库内编辑器与测试', taskBoundaries: '不改依赖与公共 API' }
/** 四要素名(逐项缺席用例的索引面)。 */
const ELEMENTS = ['objective', 'outputFormat', 'toolGuidance', 'taskBoundaries'] as const
type Element = (typeof ELEMENTS)[number]
/** 缺少某一个要素的委派:字段整体缺席(结构校验要拒的不只是空白值,还有缺失)。 */
const without = (field: Element): Record<string, unknown> => {
  const partial: Record<string, unknown> = { ...DELEGATION }
  partial[field] = undefined
  return partial
}
/** AdmissionDirection 四方向中「方向已定」的一份(24 §5.5-R3 的方向面)。 */
const DIRECTION = { implementation_requested: true, target_basis: 'specified', requires_design_decision: false, evidence: 'asked' }
const COPY = { id: 'copy', name: 'Copy', enabled: true, instruction: 'Fix typos.' }

/** 建一份设置(默认:feishu 名单 [Alice]、规则表 [COPY]、auto 档;unlistedAddressed 准入格可覆盖)。 */
const parseSettings = (over: {
  mode?: 'off' | 'observe' | 'auto'
  rules?: { id: string; name: string; enabled: boolean; instruction: string }[]
  admission?: Record<string, Record<string, string>>
} = {}): Settings => SettingsSchema.parse({
  eval: { mode: over.mode ?? 'auto' },
  policy: {
    ...(over.rules ? { rules: over.rules } : { rules: [COPY] }),
    sources: { feishu: { allowed: [{ id: MEMBER, name: 'Alice' }], admission: over.admission ?? {} } },
  },
})
/** 行内 SourceScope 桩:feishu 按 CHAT 会话收听(仅对准),其余拒收。 */
const scopeOf = (): SourceScope => ({
  scope: ({ source, meta }) => source === 'feishu' && meta.chatId === CHAT
    ? { listened: true, observed: false, row: CHAT }
    : { listened: false, reason: 'chat_not_allowed' },
})
const feishu = (overrides: Partial<Trigger> = {}): Trigger =>
  ({ id: 't', source: 'feishu', threads: [{ source: 'feishu', id: 'x' }], actor: { source: 'feishu', id: MEMBER }, human: true,
    addressed: 'mention', at: '', text: 'hi', meta: { chatId: CHAT, direct: false, mentioned: true }, ...overrides })

function harness(settings: Settings = parseSettings()) {
  const repo = new MemoryRepositories()
  const outbox: OutboundMessage[] = []
  const requests: Candidate[] = []
  const assessor: Assessor = { request: (candidate) => { requests.push(candidate) } }
  const launches: [Ticket, Assignment][] = []
  const stop = vi.fn()
  const executor: Executor = {
    start: vi.fn((ticket: Ticket, assignment: Assignment) => { launches.push([ticket, assignment]) }),
    deliver: vi.fn(), stop,
  }
  const queued: Outbox = {
    send: (message) => { if (!outbox.some(item => item.id === message.id)) outbox.push(message) },
    status: id => outbox.some(item => item.id === id) ? 'pending' : undefined,
    withdraw: vi.fn(),
  }
  const engine = new Engine({ repo, policy: () => settingsPolicy(settings, scopeOf()), realmOf: () => REALM, scope: scopeOf(),
    assessor, executor, outbox: queued, now: () => '2026-11-17T00:00:00Z' })
  /** 收一条 trigger 并开 Eval(假 assessor 请求面);返回最新候选。 */
  const evaluate = (trigger: Trigger): Candidate => {
    engine.receive(trigger)
    engine.evaluateDue()
    const candidate = requests.at(-1)
    if (!candidate) throw new Error('没有候选被请求')
    return candidate
  }
  /** 用评估转译层(候选卡面)产出 accept 并交 Engine.decide。 */
  const accept = (id: string, over: { delegation?: unknown; rules?: string[] } = {}) => {
    const candidate = evaluate(feishu({ id }))
    const outcome = assessmentOutcome({
      decision: 'accept', rule_assessments: settings.policy.rules.filter(rule => rule.enabled)
        .map(rule => ({ rule_id: rule.id, matched: true, reason: '命中' })),
      direction: DIRECTION, title: '修复', scope: '小', reason: 'requested', intent_evidence: 'quote',
      ...'delegation' in over ? { delegation: over.delegation as never } : { delegation: DELEGATION },
      ...(over.rules ? { rules: over.rules } : {}),
    }, settings, candidate.strength)
    return engine.decide(id, { ...outcome, evalId: candidate.evalId })
  }
  return { repo, engine, outbox, requests, launches, stop, evaluate, accept, settings }
}
/** 手造一份不带完整四要素的 accept outcome(主会话直路由的形态;绕过评估转译层)。 */
const vague = (over: Record<string, unknown> = {}): Outcome =>
  ({ kind: 'accept', title: 'F', scope: 's', reason: 'r', ...over }) as unknown as Outcome

describe('R3 四要素硬约束——内核兜底层(Engine.decide 的结构校验)', () => {
  it('候选卡缺任一要素 → UserError(delegationIncomplete),且不动 Eval 状态(逐字段缺席)', () => {
    const h = harness()
    h.evaluate(feishu({ id: '1' }))
    for (const field of ELEMENTS) {
      expect(() => h.engine.decide('1', vague({ delegation: without(field) }))).toThrow(new UserError('delegationIncomplete'))
      // 结构校验拒在一切状态变化之前:Eval 仍持有该候选。
      expect(h.engine.candidate('1')?.evalId).toBe(h.requests[0]!.evalId)
    }
    expect(h.repo.threads.get('feishu:x')).toMatchObject({ evaluating: { id: h.requests[0]!.evalId }, subscriptions: [] })
    expect(h.repo.decisions.byThread('feishu:x')).toEqual([])
    expect(h.repo.tickets.list()).toEqual([])
  })
  it('「缺失」同样拒:delegation 整个缺席、字段为非字符串值、纯空白——都不是可执行的委派', () => {
    const h = harness()
    h.evaluate(feishu({ id: '1' }))
    expect(() => h.engine.decide('1', vague())).toThrow(new UserError('delegationIncomplete'))
    expect(() => h.engine.decide('1', vague({ delegation: { ...DELEGATION, objective: 42 } }))).toThrow(new UserError('delegationIncomplete'))
    expect(() => h.engine.decide('1', vague({ delegation: { ...DELEGATION, taskBoundaries: '   ' } }))).toThrow(new UserError('delegationIncomplete'))
    expect(h.repo.tickets.list()).toEqual([])
  })
  it('结构校验先于一切状态读取:未知 Trigger 上的缺项 accept 也报 delegationIncomplete(而非 unknownTrigger)', () => {
    const h = harness()
    expect(() => h.engine.decide('missing', vague({ delegation: DELEGATION }))).toThrow(new UserError('unknownTrigger'))
    expect(() => h.engine.decide('missing', vague())).toThrow(new UserError('delegationIncomplete'))
  })
})

describe('R3 四要素硬约束——评估转译层(候选卡面 assessmentOutcome,双层同码)', () => {
  it('accept 缺任一要素 → assessmentOutcome 抛 UserError(delegationIncomplete)', () => {
    const h = harness()
    for (const field of ELEMENTS) {
      expect(() => assessmentOutcome({ decision: 'accept', rule_assessments: [{ rule_id: 'copy', matched: true, reason: '命中' }],
        direction: DIRECTION, title: '修复', scope: '小', reason: 'requested', intent_evidence: 'quote',
        delegation: without(field) as unknown as Delegation }, h.settings, 'explicit')).toThrow(new UserError('delegationIncomplete'))
    }
  })
  it('四要素齐备才转译为 accept,并携带命中规则;四要素随 Decision 落库(审计链 Trigger→候选卡→Decision→四要素)', () => {
    const h = harness()
    const outcome = assessmentOutcome({ decision: 'accept', rule_assessments: [{ rule_id: 'copy', matched: true, reason: '命中' }],
      direction: DIRECTION, title: '修复', scope: '小', reason: 'requested', intent_evidence: 'quote', delegation: DELEGATION },
    h.settings, 'explicit')
    expect(outcome).toMatchObject({ kind: 'accept', delegation: DELEGATION, rules: ['copy'] })
    const decision = h.accept('1')
    expect(decision).toMatchObject({ kind: 'accept', delegation: DELEGATION })
  })
})

describe('评估批次与 Decision(34 §4-A evals 行)', () => {
  it('一批排队 Trigger 合成一次 Eval:候选带全批与最强强度;accept 产出一条全批 Decision 与一张工单', () => {
    const h = harness()
    h.engine.receive(feishu({ id: '1' }))
    h.engine.receive(feishu({ id: '2', text: '还有日志里这个报错' }))
    h.engine.evaluateDue()
    expect(h.requests).toHaveLength(1)
    const candidate = h.requests[0]!
    expect(candidate.triggers.map(item => item.id)).toEqual(['1', '2'])
    expect(candidate.strength).toBe('explicit')
    const decision = h.accept('1')
    expect(decision).toMatchObject({ kind: 'accept', triggerIds: ['1', '2'], strength: 'explicit', delegation: DELEGATION })
    const tickets = h.repo.tickets.list()
    expect(tickets).toHaveLength(1)
    expect(tickets[0]).toMatchObject({ origin: { triggerIds: ['1', '2'] } })
    expect(h.repo.triggers.disposition('2')).toMatchObject({ evalId: candidate.evalId, decisionId: decision.id })
  })
  it('accept 固化 Mandate 时写入 realm:取 intake 落库标注(meta.realm → realmOf),Mandate 与 Ticket 同 realm', () => {
    const h = harness()
    const decision = h.accept('1')
    expect(decision.kind).toBe('accept')
    if (decision.kind !== 'accept' || !decision.mandate) throw new Error('expected accept')
    expect(decision.mandate).toMatchObject({ strength: 'explicit', realm: REALM })
    expect(decision.mandate.policyVersion).toBeTruthy()
    expect(h.repo.tickets.list()[0]).toMatchObject({ realm: REALM, mandate: { realm: REALM, strength: 'explicit' } })
  })
})

describe('inferred 只在 auto 档按启用规则 accept(内核半边;observe 档 would_accept 见 policy.spec)', () => {
  it('推断候选命中启用规则(auto 档)→ accept;点名的规则未启用 → notExplicit,状态不动', () => {
    const h = harness(parseSettings({ admission: { [CHAT]: { unlistedAddressed: 'inferred' } } }))
    const guest = feishu({ id: '1', actor: { source: 'feishu', id: STRANGER } })
    const candidate = h.evaluate(guest)
    expect(candidate.strength).toBe('inferred')
    const decision = h.accept('1')
    expect(decision).toMatchObject({ kind: 'accept', strength: 'inferred', mandate: { strength: 'inferred' } })
    // 主会话点名一条未启用/未命中规则:结构校验同样拒绝(notExplicit),Eval 状态不动。
    const again = h.evaluate(feishu({ id: '2', actor: { source: 'feishu', id: STRANGER }, threads: [{ source: 'feishu', id: 'y' }] }))
    expect(() => h.engine.decide('2', { ...vague({ delegation: DELEGATION, rules: ['nope'] }), evalId: again.evalId }))
      .toThrow(new UserError('notExplicit'))
    expect(h.engine.candidate('2')?.evalId).toBe(again.evalId)
    expect(h.repo.tickets.list()).toHaveLength(1)
  })
})
