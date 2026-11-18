/**
 * Mandate 版本钉住与规则热改「只通知不撤销」(35 号 A8 验收门禁;34 §4-B policy 行)。
 *
 * 门禁面(33 号 §1.3 G2-A15 的 tasks 半边,24a 拍板记录·C3 原文):规则版本 = 规则文件内容
 * hash;Mandate 固化创建时策略版本;规则热改 → 新版本 → 新工单用新版、在跑工单钉旧版且收到
 * policyChanged 通知(只通知不撤销)。依据条款:27 号 §3.2-④(权力层级:策略新版本只通知不
 * 撤销)、24 号 §5.3-2(授权只在 Mandate 里,只有人的 stop 才撤销)、35 号 A8(tickets 行)。
 * 本文件对账的断言(core-engine.spec.ts 的 policyChanged 行之外,G2-A15 具名文件):
 * - C3 联合 hash 的引擎面:任一侧内容热改 → 新版本;同内容回滚 → 同版本;不影响授权的
 *   变化(如 paused)不换版本;
 * - Mandate 固化创建时版本:Decision.mandate 与 Ticket.mandate 钉住当时的联合 hash;
 * - 热改后:在跑工单不撤销(Mandate 钉旧版)、只收一条带 effect 的 policy-changed 通知 Input、
 *   订阅与投递不受扰;在跑 Eval 记 unavailable(policyChanged) 回队;新工单用新版;
 *   governance/hitl 侧热改(tasks 设置不动)→ 无 effect、工单一概不动、版本仍换。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  Engine, MemoryRepositories, SettingsSchema, assessmentOutcome, jointPolicyVersion, policyContent, policyEffects,
  settingsPolicy, type Assessor, type Candidate, type Executor, type Outbox, type OutboundMessage, type PolicyWiring,
  type Settings, type SourceScope, type Trigger,
} from '../src/index.ts'

const MEMBER = 'ou_alice'
const CHAT = 'oc_team'
const REALM = 'tenant-a'
/** R3 委派四要素(35 号 A7):accept 一律带齐。 */
const DELEGATION = { objective: '修复登录页在移动端的崩溃', outputFormat: 'Git 补丁', toolGuidance: '仓库内编辑器与测试', taskBoundaries: '不改依赖与公共 API' }
const DIRECTION = { implementation_requested: true, target_basis: 'specified', requires_design_decision: false, evidence: 'asked' }
const COPY = { id: 'copy', name: 'Copy', enabled: true, instruction: 'Fix typos.' }

/** 建一份设置(默认:feishu 名单 [Alice]、规则表 [COPY]——影响授权的内容面)。 */
const parseSettings = (over: {
  rules?: { id: string; name: string; enabled: boolean; instruction: string }[]
  paused?: boolean
} = {}): Settings => SettingsSchema.parse({
  ...(over.paused ? { paused: true } : {}),
  eval: { mode: 'auto' },
  policy: { ...(over.rules ? { rules: over.rules } : { rules: [COPY] }),
    sources: { feishu: { allowed: [{ id: MEMBER, name: 'Alice' }] } } },
})
const scopeOf = (): SourceScope => ({
  scope: ({ source, meta }) => source === 'feishu' && meta.chatId === CHAT ? { listened: true, observed: false, row: CHAT }
    : { listened: false, reason: 'chat_not_allowed' },
})
const feishu = (overrides: Partial<Trigger> = {}): Trigger =>
  ({ id: 't', source: 'feishu', threads: [{ source: 'feishu', id: 'x' }], actor: { source: 'feishu', id: MEMBER }, human: true,
    addressed: 'mention', at: '', text: 'hi', meta: { chatId: CHAT, direct: false, mentioned: true }, ...overrides })

/**
 * 真引擎 + 设置驱动 Policy(版本 = C3 联合 hash);`hot()` 模拟 glue 层热改:先按新旧设置算
 * effects,再换设置与联合版本,最后 Engine.policyChanged(from, to, effects)(35 号 A10 接线口径)。
 */
function harness() {
  const repo = new MemoryRepositories()
  const outbox: OutboundMessage[] = []
  const requests: Candidate[] = []
  const assessor: Assessor = { request: (candidate) => { requests.push(candidate) } }
  const stop = vi.fn()
  const executor: Executor = { start: vi.fn(), deliver: vi.fn(), stop }
  const queued: Outbox = {
    send: (message) => { if (!outbox.some(item => item.id === message.id)) outbox.push(message) },
    status: id => outbox.some(item => item.id === id) ? 'pending' : undefined,
    withdraw: vi.fn(),
  }
  const scope = scopeOf()
  let settings = parseSettings()
  let parts = { governance: 'rules-v1', hitl: 'hitl-v1', tasks: policyContent(settings) }
  let version = jointPolicyVersion(parts)
  const wiring = (): PolicyWiring => ({ version })
  const engine = new Engine({ repo, policy: () => settingsPolicy(settings, scope, wiring()), realmOf: () => REALM, scope,
    assessor, executor, outbox: queued, now: () => '2026-11-17T00:00:00Z' })
  /** 收一条名单内成员的提及 → Eval → assessmentOutcome 产 accept → Engine.decide;已在库的 Trigger(如重开回队的)不重收。 */
  const accept = (id: string, thread = 'x') => {
    if (!repo.triggers.disposition(id)) engine.receive(feishu({ id, threads: [{ source: 'feishu', id: thread }] }))
    engine.evaluateDue()
    const candidate = requests.at(-1)
    if (!candidate) throw new Error('no candidate evaluated')
    const outcome = assessmentOutcome({ decision: 'accept', rule_assessments: settings.policy.rules.filter(rule => rule.enabled)
      .map(rule => ({ rule_id: rule.id, matched: true, reason: '命中' })),
    direction: DIRECTION, title: '修复', scope: '小', reason: 'requested', intent_evidence: 'quote', delegation: DELEGATION }, settings, candidate.strength)
    return engine.decide(id, { ...outcome, evalId: candidate.evalId })
  }
  /** glue 层热改:先按新旧设置算 effects,再换设置与联合版本,最后 Engine.policyChanged(from, to, effects)。 */
  const hot = (next: Settings, part: Partial<{ governance: string; hitl: string }> = {}) => {
    const effects = policyEffects(repo.tickets.open(), settings, next, () => scope, wiring())
    const from = version
    parts = { ...parts, ...part, tasks: policyContent(next) }
    settings = next
    version = jointPolicyVersion(parts)
    engine.policyChanged(from, version, effects)
    return { from, to: version, effects }
  }
  return { repo, engine, outbox, requests, executor, stop, accept, hot, version: () => version }
}

describe('Mandate 固化创建时策略版本(C3:版本 = 联合内容 hash)', () => {
  it('建单:Decision.mandate 与 Ticket.mandate 钉住创建时的联合 hash 版本', () => {
    const h = harness()
    const v1 = h.version()
    const decision = h.accept('1')
    expect(decision.kind).toBe('accept')
    if (decision.kind !== 'accept' || !decision.mandate) throw new Error('expected accept')
    expect(decision.policyVersion).toBe(v1)
    expect(decision.mandate.policyVersion).toBe(v1)
    expect(decision.mandate.realm).toBe(REALM)
    const ticket = h.repo.tickets.list()[0]
    if (!ticket) throw new Error('no ticket')
    expect(ticket.mandate).toEqual(decision.mandate)
  })
  it('版本 = 内容 hash(C3):同内容回滚 → 同版本;不影响授权的变化(paused)不换版本;任一侧热改即换', () => {
    const h = harness()
    const v1 = h.version()
    const back = h.hot(parseSettings({ rules: [{ ...COPY, instruction: 'Fix typos only.' }] }))
    expect(back.to).not.toBe(v1)
    // 内容改回与 v1 完全一致 → 版本回到 v1(内容 hash,不是递增号)。
    expect(h.hot(parseSettings()).to).toBe(v1)
    // paused 不进授权内容面(policyContent 只含 rules/mode/sources):版本不变。
    expect(h.hot(parseSettings({ paused: true })).to).toBe(v1)
    // 联合 hash 的另一侧(governance)热改:tasks 设置不动,版本仍换(任一侧热改即新版本)。
    const v2 = h.version()
    expect(h.hot(parseSettings({ paused: true }), { governance: 'rules-v2' }).to).not.toBe(v2)
  })
})

describe('规则热改 → 在跑工单钉旧版且收到 policyChanged 通知(只通知不撤销;27 号 §3.2-④)', () => {
  it('规则指示热改:在跑工单 Mandate 钉旧版、不结束、Executor 不叫停;收到一条带 effect 的 policy-changed Input', () => {
    const h = harness()
    h.accept('1')
    const v1 = h.version()
    const { from, to, effects } = h.hot(parseSettings({ rules: [{ ...COPY, instruction: 'Fix typos only.' }] }))
    expect(from).toBe(v1)
    expect(to).not.toBe(v1)
    const ticket = h.repo.tickets.list()[0]
    if (!ticket) throw new Error('no ticket')
    // 只通知不撤销:工单未结束、Mandate 原样钉旧版、Executor 未被叫停。
    expect(ticket.ended).toBeUndefined()
    expect(ticket.mandate.policyVersion).toBe(v1)
    expect(h.stop).not.toHaveBeenCalled()
    // 唯一的告知面:一条 policy-changed Input,带新规则的指示(effects 计算结果)。
    const input = ticket.inputs.at(-1)
    expect(input).toMatchObject({ kind: 'policy-changed', from: v1, to,
      effect: { rules: [{ id: 'copy', name: 'Copy', change: 'changed', instruction: 'Fix typos only.' }] } })
    expect(effects.get(ticket.id)).toEqual(input?.kind === 'policy-changed' ? input.effect : undefined)
  })
  it('通知不扰工作面:订阅保留,后续人的消息照旧直达 worker;两轮热改各记一条新 Input,Mandate 始终钉住创建版', () => {
    const h = harness()
    h.accept('1')
    const v1 = h.version()
    h.hot(parseSettings({ rules: [{ ...COPY, instruction: 'Fix typos only.' }] }))
    h.hot(parseSettings({ rules: [{ ...COPY, instruction: 'Fix only typos.' }] }))
    const ticket = h.repo.tickets.list()[0]
    if (!ticket) throw new Error('no ticket')
    expect(ticket.inputs.filter(input => input.kind === 'policy-changed')).toHaveLength(2)
    // 只通知不撤销:两轮热改后 Mandate 仍钉住创建时版本,工单未结束。
    expect(ticket.mandate.policyVersion).toBe(v1)
    expect(ticket.mandate.policyVersion).not.toBe(h.version())
    expect(ticket.ended).toBeUndefined()
    // 订阅未动:线程上人的后续消息照旧直达工单(worker 裁决),主会话不可为它再开票。
    h.engine.receive(feishu({ id: '2', text: '顺带改一下标题', threads: [{ source: 'feishu', id: 'x' }] }))
    h.engine.evaluateDue()
    const latest = h.repo.tickets.list()[0]
    if (!latest) throw new Error('no ticket')
    expect(latest.inputs.some(input => input.kind === 'trigger' && input.triggerId === '2')).toBe(true)
    expect(h.repo.threads.get('feishu:x')?.pending).toEqual([])
    expect(h.repo.decisions.byThread('feishu:x').filter(item => item.kind === 'accept')).toHaveLength(1)
  })
  it('在跑 Eval 在热改下重开:Decision 记 unavailable(policyChanged)、Trigger 回队,新版本下重评后 accept 钉新版', () => {
    const h = harness()
    h.accept('1')
    const v1 = h.version()
    h.engine.receive(feishu({ id: '2', threads: [{ source: 'feishu', id: 'y' }] }))
    h.engine.evaluateDue()
    expect(h.repo.threads.get('feishu:y')?.evaluating).toBeDefined()
    const { to } = h.hot(parseSettings({ rules: [{ ...COPY, instruction: 'Fix typos only.' }] }))
    expect(h.repo.decisions.byThread('feishu:y').at(-1)).toMatchObject({ kind: 'unavailable', reason: [{ code: 'policyChanged' }] })
    expect(h.repo.threads.get('feishu:y')).toMatchObject({ pending: ['2'] })
    expect(h.repo.threads.get('feishu:y')).not.toHaveProperty('evaluating')
    // 回队后在新版本下重评:新 Eval 带新版,accept 固化新版本 Mandate(新工单用新版)。
    h.engine.evaluateDue()
    const second = h.requests.at(-1)
    if (!second) throw new Error('no requeued candidate')
    expect(second.policyVersion).toBe(to)
    const decision = h.accept('2', 'y')
    expect(decision.kind).toBe('accept')
    if (decision.kind !== 'accept' || !decision.mandate) throw new Error('expected accept')
    expect(decision.mandate.policyVersion).toBe(to)
    expect(decision.mandate.policyVersion).not.toBe(v1)
  })
  it('governance 侧热改(tasks 设置不动 → effects 空):版本仍换、未受影响的工单一概不动,新工单用新版', () => {
    const h = harness()
    h.accept('1')
    const v1 = h.version()
    const { from, to, effects } = h.hot(parseSettings(), { governance: 'rules-v2' })
    expect(from).toBe(v1)
    expect(to).not.toBe(v1)
    expect(effects.size).toBe(0)
    const ticket = h.repo.tickets.list()[0]
    if (!ticket) throw new Error('no ticket')
    expect(ticket.ended).toBeUndefined()
    expect(ticket.mandate.policyVersion).toBe(v1)
    expect(ticket.inputs.filter(input => input.kind === 'policy-changed')).toHaveLength(0)
    // 新规则只影响新工单:热改后的 accept 钉新版本。
    const second = h.accept('2', 'y')
    if (second.kind !== 'accept' || !second.mandate) throw new Error('expected accept')
    expect(second.mandate.policyVersion).toBe(to)
  })
})
