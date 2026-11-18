/**
 * settings 分块保存与策略同步(35 号 A10 验收门禁;34 号 §4-G settings 行)。
 *
 * 三判据(34 §4-G settings 行原文:分块保存乐观并发、暂停切换、★策略同步触发联合 hash 重算):
 * - 前两项的被测存储面为 A11 store.ts settings 版本史(store.spec.ts 已有直测断言;两任务并行、
 *   断言随先合入者跑,全绿由 A27 收口)——本 spec 经 saveSettingsBlock 机制面(save.ts,SA
 *   Settings.save 机制并入)重新覆盖同一存储面;
 * - ★第三项为 C3 拍板(24a):版本面 = governance rules.yaml + hitl.yaml + tasks 准入表联合
 *   hash——`saveSettingsBlock`(settings 保存路径)与 `syncPolicyVersion`(rules.yaml/hitl.yaml
 *   热改路径)经 `Engine.policyChanged` 只通知不撤销(27 号 §3.2-④)。
 * 被测装配:真实 Store(SQLite,tmpdir 租户库)+ 真实 Engine(settingsPolicy 随 store.settings()
 * 构建、版本经 PolicyWiring 注入)——glue 层热改组合的实形态,与 policy.spec.ts 的
 * MemoryRepositories 面互补。
 * SA tests/settings.spec.ts 同源移植其机制面(Source/Setup/会话通知面不承接,34 §2.6:
 * sources 注册表不搬、setup 不移植、面板域归 30 号 workbench)。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  Engine, Store, SettingsConflict, SettingsSchema, assessmentOutcome, jointPolicyVersion, policyContent, policyVersion,
  saveSettingsBlock, settingsPolicy, syncPolicyVersion,
  type Assessor, type Candidate, type Delegation, type Executor, type JointSides, type Outbox,
  type OutboundMessage, type PolicySaveHost, type PolicyWiring, type Settings, type SourceScope, type Trigger,
} from '../src/index.ts'

const REALM = 'alice'
const MEMBER = 'ou_alice'
const CHAT = 'oc_team'
/** R3 委派四要素(accept 用例默认带齐;与 policy.spec.ts 同源)。 */
const DELEGATION: Delegation = { objective: '修复登录页在移动端的崩溃', outputFormat: 'Git 补丁', toolGuidance: '仓库内编辑器与测试', taskBoundaries: '不改依赖与公共 API' }
const DIRECTION = { implementation_requested: true, target_basis: 'specified', requires_design_decision: false, evidence: 'asked' }
const COPY = { id: 'copy', name: 'Copy', enabled: true, instruction: 'Fix typos.' }
/** 联合 hash 的另两侧初值(glue 注入面;热改用例按需换)。 */
const SIDES: JointSides = { governance: 'rules-v1', hitl: 'hitl-v1' }

/** 建一份设置(与 policy.spec.ts 同构:feishu 名单 [Alice]、规则表除显式传入外默认空)。 */
const parseSettings = (over: { rules?: { id: string; name: string; enabled: boolean; instruction: string }[]; paused?: boolean } = {},
): Settings => SettingsSchema.parse({
  ...(over.paused ? { paused: true } : {}),
  eval: { mode: 'auto' },
  policy: {
    ...(over.rules ? { rules: over.rules } : {}),
    sources: { feishu: { allowed: [{ id: MEMBER, name: 'Alice' }] }, github: { allowed: [{ id: 'Alice' }] } },
  },
})
/** 行内 SourceScope 桩:feishu 按会话表收听(仅收对准),github 全收;未装 Source 拒收。 */
const scopeOf = (chatId = CHAT): SourceScope => ({
  scope: ({ source, meta }) => {
    if (source === 'github') return { listened: true, observed: false }
    if (source !== 'feishu') return { listened: false, reason: 'source_not_installed' }
    return meta.chatId === chatId ? { listened: true, observed: false, row: chatId } : { listened: false, reason: 'chat_not_allowed' }
  },
})
const feishu = (id: string, thread = 'x'): Trigger =>
  ({ id, source: 'feishu', threads: [{ source: 'feishu', id: thread }], actor: { source: 'feishu', id: MEMBER }, human: true, at: '', text: 'hi',
    addressed: 'mention', meta: { chatId: CHAT, direct: false, mentioned: true } })

let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'tasks-settings-')) })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

/** 真实 Store + 真实 Engine 的装配(版本经 PolicyWiring 注入,glue 热改组合的实形态)。 */
function harness(initial: Settings = parseSettings({ rules: [COPY] })) {
  const store = new Store(REALM, { tenantRoot: directory })
  store.saveSettings(initial)
  let version = jointPolicyVersion({ ...SIDES, tasks: policyContent(initial) })
  const wiring = (): PolicyWiring => ({ version })
  const scope = scopeOf()
  const requests: Candidate[] = []
  const assessor: Assessor = { request: (candidate) => { requests.push(candidate) } }
  const executor: Executor = { start: () => {}, deliver: () => {}, stop: () => {} }
  const sent: OutboundMessage[] = []
  const outbox: Outbox = {
    send: (message) => { if (!sent.some(item => item.id === message.id)) sent.push(message) },
    status: id => sent.some(item => item.id === id) ? 'pending' : undefined,
    withdraw: (id) => { sent.unshift({ id, channel: { source: 'feishu', thread: 'x', address: {} }, text: '', kind: 'notice' }) },
  }
  const engine = new Engine({
    repo: store,
    policy: () => settingsPolicy(store.settings(), scope, wiring()),
    realmOf: () => REALM,
    scope,
    assessor,
    executor,
    outbox,
    now: () => '2026-11-18T00:00:00Z',
  })
  const host: PolicySaveHost = { store, engine, scope: () => scope, wiring, setVersion: (next) => { version = next } }
  /** 收一条名单内成员的提及 → Eval → assessmentOutcome 产 accept → Engine.decide;已在库的 Trigger 不重收;新线程开新 Eval(同线程是后续)。 */
  const accept = (id: string, thread = 'x') => {
    if (!store.triggers.disposition(id)) engine.receive(feishu(id, thread))
    engine.evaluateDue()
    const candidate = requests.at(-1)
    if (!candidate) throw new Error('no candidate evaluated')
    const outcome = assessmentOutcome({ decision: 'accept', rule_assessments: store.settings().policy.rules.filter(rule => rule.enabled).map(rule => ({ rule_id: rule.id, matched: true, reason: '命中' })),
      direction: DIRECTION, title: '修复', scope: '小', reason: 'requested', intent_evidence: 'quote', delegation: DELEGATION }, store.settings(), candidate.strength)
    return engine.decide(id, { ...outcome, evalId: candidate.evalId })
  }
  return { store, engine, host, requests, accept, version: () => version }
}

describe('分块保存乐观并发(34 §4-G;SA settings.spec 用例①)', () => {
  it('过期修订拒存:SettingsConflict,什么也不存(设置/版本史/块修订全不动)', () => {
    const h = harness()
    const stale = h.store.blockRevision('policy')
    // 先把 policy 块存进一版,使 stale 成为过期修订。
    saveSettingsBlock(h.host, 'policy', { ...h.store.settings(), eval: { ...h.store.settings().eval, timeoutSeconds: 300 } }, stale, 'panel', SIDES)
    expect(h.store.blockRevision('policy')).toBe(stale + 1)
    const before = h.store.settings(), history = h.store.settingsHistory().length
    expect(() => saveSettingsBlock(h.host, 'policy', { ...before, eval: { ...before.eval, timeoutSeconds: 60 } }, stale, 'panel', SIDES))
      .toThrow(SettingsConflict)
    expect(h.store.settings()).toEqual(before)
    expect(h.store.settingsHistory().length).toBe(history)
    expect(h.store.blockRevision('policy')).toBe(stale + 1)
    h.store.close()
  })
  it('各块修订独立计数:executor 保存不使 policy/pause 块失效(SA「blocks have separate revisions」)', () => {
    const h = harness()
    saveSettingsBlock(h.host, 'executor', { ...h.store.settings(), executor: { ...h.store.settings().executor, maxWorkers: 5 } },
      h.store.blockRevision('executor'), 'panel', SIDES)
    expect(h.store.blockRevision('executor')).toBe(1)
    // 其它块的修订未被联动:各自按自己的计数继续保存。
    expect(saveSettingsBlock(h.host, 'pause', { ...h.store.settings(), paused: true }, h.store.blockRevision('pause'), 'panel', SIDES).saved).toBe(true)
    expect(h.store.blockRevision('pause')).toBe(1)
    expect(saveSettingsBlock(h.host, 'policy', { ...h.store.settings(), eval: { ...h.store.settings().eval, timeoutSeconds: 300 } },
      h.store.blockRevision('policy'), 'panel', SIDES).saved).toBe(true)
    expect([h.store.blockRevision('policy'), h.store.blockRevision('executor'), h.store.blockRevision('pause')]).toEqual([1, 1, 1])
    h.store.close()
  })
})

describe('暂停切换(34 §4-G;paused 不进版本 hash——version.ts 头注)', () => {
  it('pause 块保存翻转处理暂停:版本不变、不通知工单、块修订进位', () => {
    const h = harness()
    const v = h.version()
    const outcome = saveSettingsBlock(h.host, 'pause', { ...h.store.settings(), paused: true }, h.store.blockRevision('pause'), 'panel', SIDES)
    expect([outcome.saved, outcome.changed, outcome.notified]).toEqual([true, false, []])
    expect([outcome.from, outcome.to]).toEqual([v, v])
    expect(h.store.settings().paused).toBe(true)
    expect(h.store.settingsHistory()[0]).toMatchObject({ source: 'panel', block: 'pause', policyChanged: false, notified: [] })
    h.store.close()
  })
  it('无变化的暂停不记修订(SA「records nothing for a pause that changes nothing」)', () => {
    const h = harness(parseSettings({ rules: [COPY], paused: true }))
    const revision = h.store.blockRevision('pause')
    const history = h.store.settingsHistory().length
    const outcome = saveSettingsBlock(h.host, 'pause', { ...h.store.settings(), paused: true }, revision, 'panel', SIDES)
    expect([outcome.saved, outcome.changed]).toEqual([true, false])
    expect([h.store.blockRevision('pause'), h.store.settingsHistory().length]).toEqual([revision, history])
    h.store.close()
  })
})

describe('★策略同步触发联合 hash 重算(34 §4-G;C3 拍板——24a)', () => {
  it('policy 块保存 → 联合版本重算 → policyChanged:在跑工单钉旧版收 policy-changed 通知,新工单用新版', () => {
    const h = harness()
    const v1 = h.version()
    const decision = h.accept('1')
    if (decision.kind !== 'accept' || !decision.mandate) throw new Error('expected accept')
    const ticketId = decision.ticketId!
    expect(decision.mandate.policyVersion).toBe(v1)
    const next = parseSettings({ rules: [{ ...COPY, instruction: 'Fix typos only.' }] })
    const outcome = saveSettingsBlock(h.host, 'policy', next, h.store.blockRevision('policy'), 'panel', SIDES)
    const v2 = jointPolicyVersion({ ...SIDES, tasks: policyContent(next) })
    expect(outcome.changed).toBe(true)
    expect([outcome.from, outcome.to]).toEqual([v1, v2])
    expect(outcome.notified).toEqual([ticketId])
    expect(outcome.effects.get(ticketId)).toEqual({ rules: [{ id: 'copy', name: 'Copy', change: 'changed', instruction: 'Fix typos only.' }] })
    // ★只通知不撤销(27 号 §3.2-④):工单不结束、Mandate 钉创建时版本、只收一条通知 Input。
    const ticket = h.store.tickets.get(ticketId)!
    expect(ticket.ended).toBeUndefined()
    expect(ticket.mandate.policyVersion).toBe(v1)
    expect(ticket.inputs).toEqual([expect.objectContaining({ kind: 'policy-changed', from: v1, to: v2 })])
    // 版本史记录联合版本与通知面(A11 store settings 版本史)。
    expect(h.store.settingsHistory()[0]).toMatchObject({ source: 'panel', block: 'policy', policyVersion: v2, policyChanged: true, notified: [ticketId] })
    // glue 以 to 更新注入版本后,新工单用新版。
    expect(h.version()).toBe(v2)
    const nextDecision = h.accept('2', 'y')
    expect(nextDecision.kind === 'accept' && nextDecision.mandate?.policyVersion).toBe(v2)
    h.store.close()
  })
  it('另两侧热改(governance/hitl)走 syncPolicyVersion:版本重算、工单不产生通知 Input(任务侧规则未变)、在跑 Eval 重开', () => {
    const h = harness()
    const v1 = h.version()
    const decision = h.accept('1')
    if (decision.kind !== 'accept' || !decision.mandate) throw new Error('expected accept')
    const ticketId = decision.ticketId!
    const synced = syncPolicyVersion(h.host, { governance: 'rules-v2', hitl: 'hitl-v1' })
    const v2 = jointPolicyVersion({ governance: 'rules-v2', hitl: 'hitl-v1', tasks: policyContent(h.store.settings()) })
    expect(synced).toEqual({ from: v1, to: v2, changed: true, effects: new Map(), notified: [] })
    expect(h.version()).toBe(v2)
    const ticket = h.store.tickets.get(ticketId)!
    expect(ticket.ended).toBeUndefined()
    expect(ticket.inputs).toEqual([])
    // 同内容重算幂等:版本不再变化、不再通知。
    expect(syncPolicyVersion(h.host, { governance: 'rules-v2', hitl: 'hitl-v1' })).toEqual({ from: v2, to: v2, changed: false, effects: new Map(), notified: [] })
    h.store.close()
  })
  it('未注入联合版本时回落 settings 内容 hash 口径(与 settingsPolicy 缺省同源),保存后切换到联合版本', () => {
    const h = harness()
    h.host = { ...h.host, wiring: () => ({}), setVersion: () => {} }
    const fallback = policyVersion(h.store.settings())
    const next = parseSettings({ rules: [{ ...COPY, instruction: 'Fix typos only.' }] })
    const outcome = saveSettingsBlock(h.host, 'policy', next, h.store.blockRevision('policy'), 'panel', SIDES)
    expect(outcome.from).toBe(fallback)
    expect(outcome.to).toBe(jointPolicyVersion({ ...SIDES, tasks: policyContent(next) }))
    expect(outcome.changed).toBe(true)
    h.store.close()
  })
})
