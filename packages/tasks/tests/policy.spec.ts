/**
 * 策略与准入层全量用例(35 号 A4 验收门禁;34 号 §4-B policy 行)。
 *
 * 五个门禁面(35 号 A4 原文):
 * - gate 三格矩阵(准入表逐格行为);
 * - revalidate 五分支(SA policy.ts:213-240 穷举表,循 SA docs/002);
 * - admitsInferred 仅 auto;
 * - ★联合版本 hash 变更触发 policyEffects(24a C3:governance+hitl+tasks 内容 hash,
 *   经 Engine.policyChanged「只通知不撤销」——27 号 §3.2-④);
 * - ★allowed 判定接 access 名单桩(AllowedRoster 端口注入,A10 接线面)。
 * 另覆盖:SettingsSchema(严格模式/默认值/★DEFAULT_RULES 不搬运默认空表/LIMITS 边界)、
 * assessmentOutcome(四方向/R3 四要素缺一即拒/would_accept 观察模式/B1)、版本 hash 选面。
 * SA tests/policy.spec.ts 同源移植;Source 注册表不搬(34 §0 A5),以行内 SourceScope 桩替代
 * SA 的 SourceRegistry/feishuKind/githubKind;settings 迁移(migrateSettings)属 SA app 层不在承接表,不移植。
 */
import { describe, expect, it } from 'vitest'
import {
  ADMISSION_DEFAULTS, ADMISSION_OPTIONS, Engine, MemoryRepositories, SettingsSchema, UserError, allowedSender, anyoneAllowed,
  assessmentOutcome, jointPolicyVersion, policyContent, policyEffects, policyVersion, settingsPolicy,
  type AllowedRoster, type Admission, type Assessor, type Candidate, type Delegation, type Executor, type Mandate,
  type MandateBasis, type Outbox, type OutboundMessage, type PolicyWiring, type Settings, type SourceScope,
  type Strength, type Ticket, type Thread, type Trigger,
} from '../src/index.ts'

const MEMBER = 'ou_alice'
const STRANGER = 'ou_stranger'
const CHAT = 'oc_team'
const OBSERVED = 'oc_1111111111111111111111111111'
const REALM = 'tenant-a'
/** R3 委派四要素(accept 用例默认带齐;缺要素用例单独构造)。 */
const DELEGATION = { objective: '修复登录页在移动端的崩溃', outputFormat: 'Git 补丁', toolGuidance: '仓库内编辑器与测试', taskBoundaries: '不改依赖与公共 API' }
const DIRECTION = { implementation_requested: true, target_basis: 'specified', requires_design_decision: false, evidence: 'asked' }
const COPY = { id: 'copy', name: 'Copy', enabled: true, instruction: 'Fix typos.' }

/** 建一份设置(全部走 parse,默认:feishu 名单 [Alice]、github 名单 [Alice]、规则表默认空——除显式传入)。 */
const parseSettings = (over: {
  mode?: 'off' | 'observe' | 'auto'
  allowed?: { id: string; name?: string }[]
  admission?: Record<string, Record<string, string>>
  bots?: { id: string; name?: string }[]
  rules?: { id: string; name: string; enabled: boolean; instruction: string }[]
  paused?: boolean
} = {}): Settings => SettingsSchema.parse({
  ...(over.paused ? { paused: true } : {}),
  eval: { mode: over.mode ?? 'auto' },
  policy: {
    ...(over.rules ? { rules: over.rules } : {}),
    sources: {
      feishu: { allowed: over.allowed ?? [{ id: MEMBER, name: 'Alice' }], admission: over.admission ?? {}, ...(over.bots ? { bots: over.bots } : {}) },
      github: { allowed: [{ id: 'Alice' }] },
    },
  },
})
const base = parseSettings({ rules: [COPY] })
/** 行内 SourceScope 桩:feishu 按会话表收听(mentions=仅收对准,all=连未对准也收),github 全收不观察;未装 Source 拒收。 */
const scopeOf = (chats: { chatId: string; listen: 'mentions' | 'all' }[] = [{ chatId: CHAT, listen: 'mentions' }, { chatId: OBSERVED, listen: 'all' }],
  directMessages = true): SourceScope => ({
  scope: ({ source, meta }) => {
    if (source === 'github') return { listened: true, observed: false }
    if (source !== 'feishu') return { listened: false, reason: 'source_not_installed' }
    if (meta.direct === true) return directMessages ? { listened: true, observed: false, row: 'direct' } : { listened: false, reason: 'direct_messages_not_allowed' }
    const chat = chats.find(item => item.chatId === meta.chatId)
    return chat ? { listened: true, observed: chat.listen === 'all', row: chat.chatId } : { listened: false, reason: 'chat_not_allowed' }
  },
})
const setup = (settings: Settings = base, wiring: PolicyWiring = {}) =>
  ({ settings, policy: settingsPolicy(settings, scopeOf(), wiring), version: policyVersion(settings) })
const thread = (subscriptions: string[] = []): Thread =>
  ({ key: 'feishu:x', ref: { source: 'feishu', id: 'x' }, createdAt: '', subscriptions, correlated: [], pending: [], meta: {} })
const feishu = (overrides: Partial<Trigger> & { meta?: Record<string, unknown> } = {}): Trigger =>
  ({ id: 't', source: 'feishu', threads: [{ source: 'feishu', id: 'x' }], actor: { source: 'feishu', id: MEMBER }, human: true, at: '', text: 'hi',
    addressed: 'mention', meta: { chatId: CHAT, direct: false, mentioned: true }, ...overrides })
const unaddressed = (overrides: Partial<Trigger> = {}): Trigger => {
  const { addressed: _addressed, ...rest } = feishu(overrides)
  return rest
}
const github = (login: string, addressed?: 'mention'): Trigger =>
  ({ id: 'g', source: 'github', threads: [{ source: 'github', id: '1' }], actor: { source: 'github', id: login }, human: true, at: '', text: 'x',
    ...addressed ? { addressed } : {}, meta: { number: 1, isPr: true } })
/** mandate 夹具:policyVersion 默认 'v'(revalidate 不读版本值,Engine 集成用例断言真实联合 hash)。 */
const mandateOf = (over: {
  basis: MandateBasis
  strength: Strength
  actor: { source: string; id: string }
  policyVersion?: string
}): Mandate =>
  ({ policyVersion: over.policyVersion ?? 'v', realm: REALM, scope: '', basis: over.basis, strength: over.strength, actor: over.actor })
const ticketOf = (id: string, mandate: Mandate): Ticket => ({ id, mandate } as unknown as Ticket)
const ended = { id: 'ticket', mandate: {} as unknown as Mandate, ended: { at: '', by: 'executor', reason: 'closed', outcome: 'closed' } as Ticket['ended'] } as Ticket

describe('设置 schema(严格模式 / 默认值 / LIMITS)', () => {
  it('parse({}) 产出全默认:规则表默认空(★DEFAULT_RULES 编码示例不搬运)、Eval 默认 observe(B1 观察模式)、执行器默认并发 3;★A17/A15:budget 三档上限全空(缺省维度不设限,换算率默认未定不发明——35 号 §12-17)与 gates 高风险规则空表(抽样层触发配置入库,G2-A4)', () => {
    const defaults = SettingsSchema.parse({})
    expect(defaults).toEqual({
      paused: false, sources: {},
      policy: { rules: [], sources: {} },
      eval: { mode: 'observe', timeoutSeconds: 120, model: null },
      executor: { model: null, maxWorkers: 3, directory: '', prepare: '', blockedCommands: [] },
      budget: { caps: { simple: {}, compare: {}, complex: {} } },
      gates: { highRiskRules: [] },
    })
  })
  it('严格模式拒收未知键(顶层与嵌套)', () => {
    expect(() => SettingsSchema.parse({ paused: false, extra: 1 })).toThrow()
    expect(() => SettingsSchema.parse({ policy: { unknown: true } })).toThrow()
    expect(() => SettingsSchema.parse({ eval: { mode: 'auto', speed: 1 } })).toThrow()
  })
  it('准入表 schema 拒收未对准两格的 explicit(三格×三档矩阵的 schema 面)', () => {
    for (const cell of ['listedUnaddressed', 'unlistedUnaddressed']) {
      expect(() => SettingsSchema.parse({ policy: { sources: { feishu: { allowed: [], admission: { [CHAT]: { [cell]: 'explicit' } } } } } })).toThrow()
    }
    expect(() => SettingsSchema.parse({ policy: { sources: { feishu: { allowed: [], admission: { [CHAT]: { unlistedAddressed: 'explicit' } } } } } })).not.toThrow()
  })
  it('LIMITS 边界内联生效:规则名 100 上限、Eval 超时 30–600、并发 1–16', () => {
    expect(() => SettingsSchema.parse({ policy: { rules: [{ id: 'x', name: 'n'.repeat(101), enabled: true, instruction: 'x' }] } })).toThrow()
    expect(() => SettingsSchema.parse({ eval: { timeoutSeconds: 10 } })).toThrow()
    expect(() => SettingsSchema.parse({ executor: { maxWorkers: 0 } })).toThrow()
  })
  it('三格 × 三档矩阵与 ADMISSION_DEFAULTS 原样(35 号 A4:admission.ts 原样移植)', () => {
    expect(ADMISSION_OPTIONS).toEqual({ listedUnaddressed: ['inferred', 'ignore'], unlistedAddressed: ['explicit', 'inferred', 'ignore'], unlistedUnaddressed: ['inferred', 'ignore'] })
    expect(ADMISSION_DEFAULTS).toEqual({ listedUnaddressed: 'inferred', unlistedAddressed: 'ignore', unlistedUnaddressed: 'ignore' })
  })
})

describe('gate 基础(名单 / 对准 / 后续)', () => {
  it('名单内发送者对 agent 说话 → explicit(mention 与 direct),github 登录名大小写不敏感、无名时以 id 示人', () => {
    const { policy } = setup()
    expect(policy.gate(feishu(), thread(), [])).toMatchObject({ admissible: true, strength: 'explicit', basis: { via: 'addressed', source: 'feishu', sender: 'Alice', addressed: 'mention', scope: { chatId: CHAT } } })
    expect(policy.gate(feishu({ addressed: 'direct', meta: { chatId: 'p2p', direct: true, mentioned: false } }), thread(), [])).toMatchObject({ admissible: true, strength: 'explicit', basis: { addressed: 'direct' } })
    expect(policy.gate(github('alice', 'mention'), thread(), [])).toMatchObject({ admissible: true, strength: 'explicit', basis: { source: 'github', sender: 'Alice' } })
  })
  it('名单按 Source 各自判定:feishu 的 id 在 github 上不批;allowedSender / anyoneAllowed 同源', () => {
    const { settings, policy } = setup()
    expect(policy.gate(github(MEMBER, 'mention'), thread(), [])).toEqual({ admissible: false, reason: 'not_a_member' })
    expect(allowedSender(settings, { source: 'github', id: 'ALICE' })).toEqual({ id: 'Alice' })
    expect(allowedSender(settings, { source: 'feishu', id: 'Alice' })).toBeUndefined()
    expect(anyoneAllowed(settings)).toBe(true)
    expect(anyoneAllowed(SettingsSchema.parse({}))).toBe(false)
  })
  it('有工单线程上的后续消息:名单内 explicit、名单外 inferred;仅上下文跟随的线程不给后续', () => {
    const { policy } = setup()
    const quiet = { meta: { chatId: CHAT, direct: false, mentioned: false } }
    expect(policy.gate(unaddressed({ ...quiet, actor: { source: 'feishu', id: 'ou_guest' } }), thread(['ticket']), [])).toMatchObject({ admissible: true, strength: 'inferred', basis: { via: 'followup' } })
    expect(policy.gate(unaddressed(quiet), thread(['ticket']), [])).toMatchObject({ admissible: true, strength: 'explicit', basis: { via: 'followup', sender: 'Alice' } })
    expect(policy.gate(github('someone'), thread(), [ended])).toMatchObject({ admissible: true, strength: 'inferred' })
    const context = { ...thread(['ticket']), context: ['ticket'] }
    expect(policy.gate(unaddressed(quiet), context, [ended])).toMatchObject({ admissible: false })
  })
  it('Source 连未对准消息也收的 scope 里,名单内发送者的未对准消息 → inferred(带 observation);off 档不受理', () => {
    const observed = unaddressed({ meta: { chatId: OBSERVED, direct: false, mentioned: false } })
    expect(setup().policy.gate(observed, thread(), [])).toMatchObject({ admissible: true, strength: 'inferred', basis: { via: 'admission', observation: { mode: 'auto' } } })
    expect(setup(parseSettings({ mode: 'off', rules: [COPY] })).policy.gate(observed, thread(), [])).toEqual({ admissible: false, reason: 'no_mention' })
  })
  it('名单外发送者的私聊一律拒——即便线程上有工单,也不给后续', () => {
    expect(setup().policy.gate(feishu({ actor: { source: 'feishu', id: 'ou_guest' }, addressed: 'direct', meta: { chatId: 'p2p', direct: true, mentioned: false } }), thread(['ticket']), [])).toEqual({ admissible: false, reason: 'not_a_member' })
  })
  it('拒收 bot 消息(not_human)、名单外的对准者(not_a_member)与仅收对准的会话里名单内未对准者(no_mention)', () => {
    const { policy } = setup()
    expect(policy.gate(feishu({ human: false }), thread(), [])).toEqual({ admissible: false, reason: 'not_human' })
    expect(policy.gate(feishu({ actor: { source: 'feishu', id: 'ou_guest' } }), thread(), [])).toEqual({ admissible: false, reason: 'not_a_member' })
    expect(policy.gate(unaddressed({ meta: { chatId: CHAT, direct: false, mentioned: false } }), thread(), [])).toEqual({ admissible: false, reason: 'no_mention' })
  })
})

describe('gate 三格矩阵(准入表逐格)', () => {
  const withTable = (admission: Record<string, Record<string, string>>, mode: 'off' | 'observe' | 'auto' = 'auto') => parseSettings({ mode, admission, rules: [COPY] })
  const inChat = (chatId: string, sender = MEMBER, addressed = true): Trigger => {
    const message = feishu({ actor: { source: 'feishu', id: sender }, meta: { chatId, direct: false, mentioned: addressed } })
    if (addressed) return message
    const { addressed: _addressed, ...rest } = message
    return rest
  }
  it('全格未设时复现引入矩阵前的行为;名单内对准者恒为 explicit,不查表', () => {
    expect(setup().policy.gate(inChat(OBSERVED, MEMBER, false), thread(), [])).toMatchObject({ admissible: true, strength: 'inferred', basis: { via: 'admission', row: OBSERVED, cell: 'listedUnaddressed', observation: { mode: 'auto' } } })
    expect(setup().policy.gate(inChat(CHAT, STRANGER), thread(), [])).toEqual({ admissible: false, reason: 'not_a_member' })
    expect(setup().policy.gate(feishu({ actor: { source: 'feishu', id: STRANGER }, addressed: 'direct', meta: { chatId: 'p2p', direct: true, mentioned: false } }), thread(), [])).toEqual({ admissible: false, reason: 'not_a_member' })
    expect(setup(withTable({ [CHAT]: { unlistedAddressed: 'ignore' } })).policy.gate(inChat(CHAT), thread(), [])).toMatchObject({ admissible: true, strength: 'explicit' })
  })
  it('名单外的提及按行取 explicit 或 inferred;inferred 须有会评估的档位;行按接收 scope 命中', () => {
    const explicit = setup(withTable({ [CHAT]: { unlistedAddressed: 'explicit' } })).policy.gate(inChat(CHAT, STRANGER), thread(), [])
    expect(explicit).toEqual({ admissible: true, strength: 'explicit', basis: { source: 'feishu', scope: { chatId: CHAT, direct: false, mentioned: true }, row: CHAT, via: 'admission', cell: 'unlistedAddressed', addressed: 'mention' } })
    expect(setup(withTable({ [CHAT]: { unlistedAddressed: 'inferred' } })).policy.gate(inChat(CHAT, STRANGER), thread(), [])).toMatchObject({ admissible: true, strength: 'inferred', basis: { cell: 'unlistedAddressed' } })
    expect(setup(withTable({ [CHAT]: { unlistedAddressed: 'inferred' } }, 'off')).policy.gate(inChat(CHAT, STRANGER), thread(), [])).toEqual({ admissible: false, reason: 'not_a_member' })
    expect(setup(withTable({ direct: { unlistedAddressed: 'explicit' } })).policy.gate(feishu({ actor: { source: 'feishu', id: STRANGER }, addressed: 'direct', meta: { chatId: 'p2p', direct: true, mentioned: false } }), thread(), [])).toMatchObject({ admissible: true, strength: 'explicit', basis: { row: 'direct', cell: 'unlistedAddressed' } })
    expect(setup(withTable({ [OBSERVED]: { unlistedAddressed: 'explicit' } })).policy.gate(inChat(CHAT, STRANGER), thread(), [])).toEqual({ admissible: false, reason: 'not_a_member' })
  })
  it('名单内未对准按行忽略;会话收不到的消息不查表;mentions 会话收不到未对准消息', () => {
    expect(setup(withTable({ [OBSERVED]: { listedUnaddressed: 'ignore' } })).policy.gate(inChat(OBSERVED, MEMBER, false), thread(), [])).toEqual({ admissible: false, reason: 'admission_ignored' })
    expect(setup(withTable({ [CHAT]: { listedUnaddressed: 'inferred' } })).policy.gate(inChat(CHAT, MEMBER, false), thread(), [])).toEqual({ admissible: false, reason: 'no_mention' })
    expect(setup(withTable({ [CHAT]: { unlistedUnaddressed: 'inferred' } })).policy.gate(inChat(CHAT, STRANGER, false), thread(), [])).toEqual({ admissible: false, reason: 'not_a_member' })
  })
  it('off 档不给推断后续与任何推断候选;名单内发送者的后续仍 explicit', () => {
    const quiet = { meta: { chatId: CHAT, direct: false, mentioned: false } }
    const off = setup(parseSettings({ mode: 'off', rules: [COPY] })).policy
    expect(off.gate(unaddressed({ ...quiet, actor: { source: 'feishu', id: 'ou_guest' } }), thread(['ticket']), [])).toEqual({ admissible: false, reason: 'not_a_member' })
    expect(off.gate(unaddressed(quiet), thread(['ticket']), [])).toMatchObject({ admissible: true, strength: 'explicit', basis: { via: 'followup' } })
  })
  it('名单外发送者的 explicit 格在带工单线程上、在每个档位都给出 explicit;非 explicit 格在线程给后续(inferred)', () => {
    for (const mode of ['auto', 'observe', 'off'] as const) {
      const open = setup(withTable({ [CHAT]: { unlistedAddressed: 'explicit' } }, mode))
      expect(open.policy.gate(inChat(CHAT, STRANGER), thread(['ticket']), [])).toMatchObject({ admissible: true, strength: 'explicit', basis: { via: 'admission', cell: 'unlistedAddressed' } })
      const strict = setup(withTable({ [CHAT]: { unlistedAddressed: 'ignore' } }, mode))
      expect(strict.policy.gate(inChat(CHAT, STRANGER), thread(['ticket']), [])).toMatchObject(mode === 'off'
        ? { admissible: false } : { admissible: true, strength: 'inferred', basis: { via: 'followup' } })
    }
  })
  it('有工单线程上的后续不查表:两格都 ignore 的行也不影响后续的 explicit/inferred', () => {
    const strict = setup(withTable({ [OBSERVED]: { listedUnaddressed: 'ignore', unlistedUnaddressed: 'ignore' } }))
    expect(strict.policy.gate(inChat(OBSERVED, MEMBER, false), thread(['ticket']), [])).toMatchObject({ admissible: true, strength: 'explicit', basis: { via: 'followup' } })
    expect(strict.policy.gate(inChat(OBSERVED, STRANGER, false), thread(['ticket']), [])).toMatchObject({ admissible: true, strength: 'inferred', basis: { via: 'followup' } })
  })
  it('格子强度被调低后 Mandate 不再成立(revalidate 对准入格的强度比较)', () => {
    const open = withTable({ [CHAT]: { unlistedAddressed: 'explicit' } })
    const gate = setup(open).policy.gate(inChat(CHAT, STRANGER), thread(), [])
    if (!gate.admissible) throw new Error('expected admission')
    const mandate = mandateOf({ strength: gate.strength, basis: gate.basis, actor: { source: 'feishu', id: STRANGER } })
    expect(setup(open).policy.revalidate(mandate)).toBe(true)
    expect(setup(withTable({ [CHAT]: { unlistedAddressed: 'inferred' } })).policy.revalidate(mandate)).toBe(false)
    expect(setup(withTable({})).policy.revalidate(mandate)).toBe(false)
  })
  it('格子变化即版本变化(内容 hash 选面含准入表)', () => {
    expect(setup(withTable({ [CHAT]: { unlistedAddressed: 'explicit' } })).version).not.toBe(setup().version)
    expect(setup(withTable({})).version).toBe(setup().version)
  })
})

describe('revalidate 五分支(穷举表,循 SA docs/002)', () => {
  type Cell = 'listedUnaddressed' | 'unlistedAddressed' | 'unlistedUnaddressed'
  const cells: Cell[] = ['listedUnaddressed', 'unlistedAddressed', 'unlistedUnaddressed']
  const SENDER = 'ou_sender'
  const origins: { cell: Cell; strength: 'explicit' | 'inferred' }[] = [
    { cell: 'listedUnaddressed', strength: 'inferred' }, { cell: 'unlistedAddressed', strength: 'explicit' },
    { cell: 'unlistedAddressed', strength: 'inferred' }, { cell: 'unlistedUnaddressed', strength: 'inferred' },
  ]
  const cases = origins.flatMap(origin => [true, false].flatMap(listed => (['off', 'observe', 'auto'] as const).flatMap(mode =>
    [true, false].flatMap(rule => (['all', 'mentions', 'none'] as const).flatMap(scope => [true, false].map(holds => ({ ...origin, listed, mode, rule, scope, holds })))))))
  /** docs/002:接收 scope 仍在;名单内对准者恒 explicit;接受后入名单者移入名单格;强度与观察检查按格/档。 */
  function expected({ cell, strength, listed, mode, rule, scope, holds }: (typeof cases)[number]): boolean {
    if (scope === 'none') return false
    if (cell === 'unlistedAddressed' && listed) return true
    const now = cell === 'unlistedUnaddressed' && listed ? 'listedUnaddressed' : cell
    if ((now === 'listedUnaddressed' && !listed) || !holds) return false
    return strength === 'explicit' || (mode === 'auto' && rule)
  }
  it.each(cases)('$cell ($strength), 名单内 $listed, 档 $mode, 规则开 $rule, 会话接收 $scope, 格守 $holds', (item) => {
    const grant = (cell: Cell): Admission => !item.holds ? 'ignore' : cell === 'unlistedAddressed' ? item.strength : 'inferred'
    const chats = item.scope === 'none' ? [] : [{ chatId: CHAT, listen: item.scope }]
    const settings = SettingsSchema.parse({
      eval: { mode: item.mode },
      policy: {
        rules: [{ id: 'copy', name: 'Copy', enabled: item.rule, instruction: 'x' }],
        sources: {
          feishu: {
            allowed: item.listed ? [{ id: SENDER }] : [],
            admission: { [CHAT]: Object.fromEntries(cells.map(cell => [cell, grant(cell)])) },
          },
        },
      },
    })
    const addressed = item.cell === 'unlistedAddressed'
    const observed = item.strength === 'inferred' ? { observation: { mode: 'auto' as const }, rules: ['copy'] } : {}
    const basis: MandateBasis = { via: 'admission', source: 'feishu', scope: { chatId: CHAT, direct: false, mentioned: addressed }, row: CHAT, cell: item.cell,
      ...addressed ? { addressed: 'mention' as const } : {}, ...observed }
    const mandate = mandateOf({ strength: item.strength, basis, actor: { source: 'feishu', id: SENDER } })
    expect(settingsPolicy(settings, scopeOf(chats)).revalidate(mandate)).toBe(expected(item))
  })
  it('名单/收听/规则四支:名单撤走或不再收听即失效;观察/推断 Mandate 仅 auto 且规则仍开时成立;显式后续恒成立', () => {
    const basis: MandateBasis = { via: 'addressed', source: 'feishu', scope: { chatId: CHAT, direct: false }, sender: 'Alice', addressed: 'mention' }
    const actor = { source: 'feishu', id: MEMBER }
    const mandate = mandateOf({ strength: 'explicit', basis, actor })
    expect(setup().policy.revalidate(mandate)).toBe(true)
    const nobody = SettingsSchema.parse({ eval: { mode: 'auto' }, policy: { sources: {} } })
    expect(settingsPolicy(nobody, scopeOf()).revalidate(mandate)).toBe(false)
    // 收听撤走(会话表清空)→ 不成立;旧版 listed 依据同理要求名单与收听俱在。
    expect(settingsPolicy(base, scopeOf([])).revalidate(mandate)).toBe(false)
    const listed: MandateBasis = { via: 'listed', source: 'feishu', scope: { chatId: CHAT, direct: false }, sender: 'Alice' }
    expect(settingsPolicy(base, scopeOf([])).revalidate(mandateOf({ strength: 'explicit', basis: listed, actor }))).toBe(false)
    expect(setup().policy.revalidate(mandateOf({ strength: 'explicit', basis: listed, actor }))).toBe(true)
    const inferred = mandateOf({ strength: 'inferred', basis: { via: 'listed', observation: {}, rules: ['copy'] }, actor })
    expect(setup().policy.revalidate(inferred)).toBe(true)
    expect(setup(parseSettings({ mode: 'observe', rules: [COPY] })).policy.revalidate(inferred)).toBe(false)
    expect(setup(parseSettings({ rules: [{ ...COPY, enabled: false }] })).policy.revalidate(inferred)).toBe(false)
    expect(settingsPolicy(nobody, scopeOf()).revalidate(mandateOf({ strength: 'explicit', basis: { via: 'followup' }, actor }))).toBe(true)
  })
  it('bot Mandate:bot 仍在名单且 auto 档时成立,任一失守即失效', () => {
    const bot = { source: 'feishu', id: 'cli_alerts' }
    const settings = parseSettings({ bots: [{ id: 'cli_alerts' }] })
    const mandate = mandateOf({ strength: 'inferred', basis: { via: 'bot', source: 'feishu', scope: { chatId: OBSERVED, direct: false }, row: OBSERVED, sender: 'cli_alerts', observation: { mode: 'auto' } }, actor: bot })
    expect(setup(settings).policy.revalidate(mandate)).toBe(true)
    expect(setup(parseSettings({ bots: [] })).policy.revalidate(mandate)).toBe(false)
    expect(setup(parseSettings({ mode: 'observe', bots: [{ id: 'cli_alerts' }] })).policy.revalidate(mandate)).toBe(false)
  })
})

describe('bots 与无发送者事件(machine gate)', () => {
  it('名单上的 bot 在 Source 观察的 scope 里作推断候选;未观察的会话里连消息都收不到;名单外 bot 一律 not_human;off 档 admission_ignored', () => {
    const settings = parseSettings({ bots: [{ id: 'cli_alerts', name: 'Alerts' }] })
    const alert = (chatId: string): Trigger => ({ ...unaddressed({ actor: { source: 'feishu', id: 'cli_alerts' }, human: false, meta: { chatId, direct: false, mentioned: false } }) })
    expect(setup(settings).policy.gate(alert(OBSERVED), thread(), [])).toMatchObject({ admissible: true, strength: 'inferred', basis: { via: 'bot', sender: 'Alerts', row: OBSERVED } })
    expect(setup(settings).policy.gate(alert(CHAT), thread(), [])).toEqual({ admissible: false, reason: 'not_human' })
    expect(setup(settings).policy.gate({ ...alert(OBSERVED), actor: { source: 'feishu', id: 'other_bot' } }, thread(), [])).toEqual({ admissible: false, reason: 'not_human' })
    expect(setup(parseSettings({ mode: 'off', bots: [{ id: 'cli_alerts' }] })).policy.gate(alert(OBSERVED), thread(), [])).toEqual({ admissible: false, reason: 'admission_ignored' })
  })
  it('bot 的提及也不是显式请求;在带工单线程上同样不是后续(至多推断候选)', () => {
    const settings = parseSettings({ bots: [{ id: 'cli_alerts' }] })
    const mention: Trigger = { ...feishu({ actor: { source: 'feishu', id: 'cli_alerts' }, human: false }), meta: { chatId: CHAT, direct: false, mentioned: true } }
    expect(setup(settings).policy.gate(mention, thread(['ticket']), [ended])).toMatchObject({ strength: 'inferred', basis: { via: 'bot', addressed: 'mention' } })
  })
  it('无发送者的系统事件走 unlistedUnaddressed 格:行说 inferred 才进来,默认 ignore', () => {
    const ci = (meta: Record<string, unknown>): Trigger => ({ id: 'ci', source: 'feishu', threads: [{ source: 'feishu', id: 'ci:main' }],
      actor: { source: 'feishu', id: '' }, human: false, at: '', text: 'CI failed 1/9 on main', meta: { ci: true, ...meta } })
    const admission = { [OBSERVED]: { unlistedUnaddressed: 'inferred' } }
    expect(setup(parseSettings({ admission })).policy.gate(ci({ chatId: OBSERVED, direct: false }), thread(), [])).toMatchObject({ admissible: true, strength: 'inferred',
      basis: { via: 'admission', cell: 'unlistedUnaddressed', row: OBSERVED, observation: { mode: 'auto' } } })
    expect(setup().policy.gate(ci({ chatId: OBSERVED, direct: false }), thread(), [])).toEqual({ admissible: false, reason: 'admission_ignored' })
    expect(setup(parseSettings({ admission })).policy.gate(ci({ chatId: CHAT, direct: false }), thread(), [])).toEqual({ admissible: false, reason: 'not_human' })
  })
})

describe('admitsInferred 仅 auto', () => {
  const scope = scopeOf()
  it('仅 auto 档、非空且全为启用规则时才认推断候选的命中规则', () => {
    const auto = parseSettings({ rules: [COPY] })
    const observe = parseSettings({ mode: 'observe', rules: [COPY] })
    const disabled = parseSettings({ rules: [{ ...COPY, enabled: false }] })
    expect(settingsPolicy(auto, scope).admitsInferred(['copy'])).toBe(true)
    expect(settingsPolicy(auto, scope).admitsInferred(['unknown'])).toBe(false)
    expect(settingsPolicy(auto, scope).admitsInferred([])).toBe(false)
    expect(settingsPolicy(observe, scope).admitsInferred(['copy'])).toBe(false)
    expect(settingsPolicy(disabled, scope).admitsInferred(['copy'])).toBe(false)
  })
})

describe('评估转译 assessmentOutcome(四方向 / R3 四要素 / would_accept)', () => {
  const judged = (settings: Settings, matched: boolean) =>
    settings.policy.rules.filter(rule => rule.enabled).map(rule => ({ rule_id: rule.id, matched, reason: 'judged' }))
  const accept = (settings: Settings, matched = true, over: Record<string, unknown> = {}) => ({
    decision: 'accept' as const, rule_assessments: judged(settings, matched), direction: DIRECTION,
    title: 'Fix', scope: 'small', reason: 'asked', intent_evidence: 'quote', worktree_name: 'fix-copy', delegation: DELEGATION, ...over,
  })
  it('推断候选仅在 auto 档按命中规则 accept;observe 记 would_accept(B1);未命中 noRuleMatched;评估覆盖不全抛错', () => {
    const auto = parseSettings({ rules: [COPY] })
    const outcome = assessmentOutcome(accept(auto), auto, 'inferred')
    expect(outcome).toMatchObject({ kind: 'accept', rules: ['copy'], delegation: DELEGATION, name: 'fix-copy' })
    const observe = parseSettings({ mode: 'observe', rules: [COPY] })
    expect(assessmentOutcome(accept(observe), observe, 'inferred')).toMatchObject({ kind: 'ignore', reason: { code: 'observed', values: { text: 'asked' } }, audit: { would_accept: true, proposal: { title: 'Fix', scope: 'small', worktree_name: 'fix-copy' } } })
    expect(assessmentOutcome(accept(auto, false), auto, 'inferred')).toMatchObject({ kind: 'ignore', reason: { code: 'noRuleMatched' } })
    expect(() => assessmentOutcome({ ...accept(auto), rule_assessments: [] }, auto, 'inferred')).toThrow('Exactly one assessment for every enabled rule')
    expect(() => assessmentOutcome({ ...accept(auto), intent_evidence: null }, auto, 'inferred')).toThrow('Acceptance requires intent_evidence')
  })
  it('一条启用规则恰评一次:重复评/漏评拒;逐条各评一次后按命中集合 accept', () => {
    const parsed = parseSettings({ rules: [COPY, { id: 'visual', name: 'Visual', enabled: true, instruction: 'Fix colors.' }] })
    const twice = { ...accept(parsed), rule_assessments: [{ rule_id: 'copy', matched: true, reason: 'typo' }, { rule_id: 'copy', matched: false, reason: 'again' }] }
    expect(() => assessmentOutcome(twice, parsed, 'inferred')).toThrow('Exactly one assessment for every enabled rule')
    const once = { ...twice, rule_assessments: [{ rule_id: 'copy', matched: true, reason: 'typo' }, { rule_id: 'visual', matched: false, reason: 'no colors' }] }
    expect(assessmentOutcome(once, parsed, 'inferred')).toMatchObject({ kind: 'accept', rules: ['copy'] })
  })
  it('方向未定(四方向任一失守)→ ignore directionUnsettled', () => {
    const auto = parseSettings({ rules: [COPY] })
    for (const direction of [
      { implementation_requested: false, target_basis: 'specified', requires_design_decision: false, evidence: 'x' },
      { implementation_requested: true, target_basis: 'undetermined', requires_design_decision: false, evidence: 'x' },
      { implementation_requested: true, target_basis: 'specified', requires_design_decision: true, evidence: 'x' },
    ]) expect(assessmentOutcome({ ...accept(auto), direction }, auto, 'inferred')).toMatchObject({ kind: 'ignore', reason: { code: 'directionUnsettled' } })
  })
  it('explicit 候不受档位限制:observe/off 都 accept;inferred 在 observe/off 都只记 would_accept', () => {
    for (const mode of ['observe', 'off'] as const) {
      const settings = parseSettings({ mode, rules: [COPY] })
      expect(assessmentOutcome(accept(settings), settings, 'explicit')).toMatchObject({ kind: 'accept', title: 'Fix' })
      expect(assessmentOutcome(accept(settings), settings, 'inferred')).toMatchObject({ kind: 'ignore', reason: { code: 'observed' } })
    }
  })
  it('★R3 四要素缺一即拒(UserError delegationIncomplete):完全缺失 / 缺一要素 / 空白要素;explicit 同样受制', () => {
    const auto = parseSettings({ rules: [COPY] })
    const { delegation: _omitted, ...withoutDelegation } = accept(auto)
    for (const assessment of [withoutDelegation,
      { ...accept(auto), delegation: { ...DELEGATION, taskBoundaries: '' } satisfies Delegation },
      { ...accept(auto), delegation: { ...DELEGATION, objective: '   ' } satisfies Delegation }]) {
      try {
        assessmentOutcome(assessment, auto, 'inferred')
        expect.unreachable('R3 缺要素应抛 delegationIncomplete')
      } catch (error) {
        expect(error).toBeInstanceOf(UserError)
        expect((error as UserError).code).toBe('delegationIncomplete')
      }
    }
    const observe = parseSettings({ mode: 'observe', rules: [COPY] })
    try {
      assessmentOutcome(withoutDelegation, observe, 'explicit')
      expect.unreachable('explicit 缺四要素同样应抛')
    } catch (error) { expect((error as UserError).code).toBe('delegationIncomplete') }
    expect(assessmentOutcome(accept(auto), auto, 'inferred')).toMatchObject({ kind: 'accept', delegation: DELEGATION })
  })
  it('accept 携带交接来源 handoffOf(A8)与致谢 acknowledgement 透传', () => {
    const auto = parseSettings({ rules: [COPY] })
    expect(assessmentOutcome({ ...accept(auto), acknowledgement: '收到', handoffOf: 'ticket-1' }, auto, 'explicit'))
      .toMatchObject({ kind: 'accept', acknowledgement: '收到', handoffOf: 'ticket-1' })
  })
  it('ignore / unavailable 原样转译(reason 与 audit 保留)', () => {
    const settings = parseSettings({ rules: [COPY] })
    const ignored = { ...accept(settings), decision: 'ignore' as const, reason: 'bot message' }
    expect(assessmentOutcome(ignored, settings, 'explicit')).toEqual({ kind: 'ignore', reason: 'bot message',
      audit: { matches: [{ rule_id: 'copy', reason: 'judged' }], rule_assessments: judged(settings, true), direction: DIRECTION, intent_evidence: 'quote' } })
    expect(assessmentOutcome({ ...ignored, decision: 'unavailable' as const }, settings, 'explicit')).toMatchObject({ kind: 'unavailable', reason: 'bot message' })
  })
})

describe('版本 hash(C3:版本 = 规则内容 hash)', () => {
  it('影响授权的内容变即版本变:规则指示 / 受理档位 / 名单 / 准入格', () => {
    const version = setup().version
    expect(setup(parseSettings({ rules: [{ ...COPY, instruction: 'Fix typos only.' }] })).version).not.toBe(version)
    expect(setup(parseSettings({ mode: 'off', rules: [COPY] })).version).not.toBe(version)
    expect(setup(parseSettings({ allowed: [{ id: MEMBER, name: 'Alice' }, { id: 'ou_bob' }], rules: [COPY] })).version).not.toBe(version)
    expect(setup(parseSettings({ admission: { [CHAT]: { unlistedAddressed: 'explicit' } }, rules: [COPY] })).version).not.toBe(version)
  })
  it('不影响授权的内容不变版本:暂停 / 并发 / 超时 / 模型 / Source 实例配置(SA policy.ts:112-115 语义)', () => {
    const version = setup().version
    const same = SettingsSchema.parse({ ...base, paused: true, executor: { ...base.executor, maxWorkers: 9, model: { provider: 'p', model: 'm' } },
      eval: { ...base.eval, timeoutSeconds: 300, model: { provider: 'p', model: 'm' } }, sources: { github: { enabled: true, config: { pollSeconds: 600 } } } })
    expect(policyVersion(same)).toBe(version)
    expect(setup(parseSettings({ rules: [COPY] })).version).toBe(version)
  })
  it('同内容同版本(内容派生,跨调用稳定)', () => {
    expect(policyVersion(parseSettings({ rules: [COPY] }))).toBe(policyVersion(parseSettings({ rules: [COPY] })))
  })
  it('★联合 hash(24a C3):governance / hitl / tasks 三侧任一变即版本变,同三侧同版本;tasks 侧与 policyContent 同源', () => {
    const parts = { governance: 'rules-v1', hitl: 'hitl-v1', tasks: policyContent(base) }
    expect(jointPolicyVersion(parts)).toBe(jointPolicyVersion({ ...parts }))
    expect(jointPolicyVersion({ ...parts, governance: 'rules-v2' })).not.toBe(jointPolicyVersion(parts))
    expect(jointPolicyVersion({ ...parts, hitl: 'hitl-v2' })).not.toBe(jointPolicyVersion(parts))
    const offTasks = policyContent(parseSettings({ mode: 'off', rules: [COPY] }))
    expect(offTasks).not.toBe(parts.tasks)
    expect(jointPolicyVersion({ ...parts, tasks: offTasks })).not.toBe(jointPolicyVersion(parts))
  })
})

describe('★allowed 判定接 access 名单桩(A10 接线面:端口注入,不 import 服务实例)', () => {
  const roster: AllowedRoster = actor =>
    actor.source === 'feishu' && actor.id.toLowerCase() === MEMBER ? { id: actor.id, name: 'Alice(access)' } : undefined
  it('注入名单生效:settings 名单为空也能凭 access 名单桩 explicit;未注入回退 settings 名单(空 → not_a_member)', () => {
    const settings = parseSettings({ allowed: [], rules: [COPY] })
    expect(setup(settings, { allowed: roster }).policy.gate(feishu(), thread(), [])).toMatchObject({ admissible: true, strength: 'explicit', basis: { via: 'addressed', sender: 'Alice(access)' } })
    expect(setup(settings).policy.gate(feishu(), thread(), [])).toEqual({ admissible: false, reason: 'not_a_member' })
  })
  it('revalidate 的名单判定同走注入源:roster 撤下即不成立', () => {
    const settings = parseSettings({ allowed: [], rules: [COPY] })
    const wired = setup(settings, { allowed: roster }).policy
    const gate = wired.gate(feishu(), thread(), [])
    if (!gate.admissible) throw new Error('expected admission')
    const mandate = mandateOf({ strength: gate.strength, basis: gate.basis, actor: feishu().actor })
    expect(wired.revalidate(mandate)).toBe(true)
    expect(setup(settings, { allowed: () => undefined }).policy.revalidate(mandate)).toBe(false)
  })
  it('注入名单源下 policyEffects 路径照常:settings 侧规则变更的 effects 正常产出(接线不破坏纯函数面)', () => {
    const settings = parseSettings({ allowed: [], rules: [COPY] })
    const roster: AllowedRoster = actor => actor.id === 'ou_alice' ? { id: actor.id } : undefined
    const allObserved = (): SourceScope => ({ scope: () => ({ listened: true, observed: true }) })
    const inferred = ticketOf('t1', mandateOf({ strength: 'inferred', basis: { via: 'listed', rules: ['copy'] }, actor: { source: 'feishu', id: 'ou_alice' } }))
    const next = parseSettings({ allowed: [], rules: [{ ...COPY, instruction: 'Fix typos only.' }] })
    expect(policyEffects([inferred], settings, next, allObserved, { allowed: roster }).get('t1'))
      .toEqual({ rules: [{ id: 'copy', name: 'Copy', change: 'changed', instruction: 'Fix typos only.' }] })
  })
})

describe('policyEffects(规则变更 → 逐工单算 effect → 只通知不撤销)', () => {
  const allObserved = (): SourceScope => ({ scope: () => ({ listened: true, observed: true }) })
  const withRules = (rules: { id: string; name: string; enabled: boolean; instruction: string }[]) => parseSettings({ rules })
  const inferred = ticketOf('t1', mandateOf({ strength: 'inferred', basis: { via: 'listed', rules: ['copy'] }, actor: { source: 'feishu', id: 'ou_guest' } }))
  const explicit = ticketOf('t2', mandateOf({ strength: 'explicit', basis: { via: 'listed', source: 'feishu' }, actor: { source: 'feishu', id: 'ou_alice' } }))
  it('只告知命中的规则变更:未依据的规则、无关名单扩充不扰;指示变 changed、禁用 disabled、名单撤人 requesterAllowed', () => {
    expect(policyEffects([inferred, explicit], base, withRules([COPY, { id: 'visual', name: 'Visual', enabled: false, instruction: 'x' }]), allObserved).size).toBe(0)
    expect(policyEffects([inferred], base, withRules([{ ...COPY, instruction: 'Fix typos only.' }]), allObserved).get('t1'))
      .toEqual({ rules: [{ id: 'copy', name: 'Copy', change: 'changed', instruction: 'Fix typos only.' }] })
    expect(policyEffects([inferred], base, withRules([{ ...COPY, enabled: false }]), allObserved).get('t1')).toEqual({ rules: [{ id: 'copy', name: 'Copy', change: 'disabled' }] })
    const allowed = (list: { id: string }[]) => parseSettings({ allowed: list, rules: [COPY] })
    expect(policyEffects([inferred, explicit], base, allowed([{ id: MEMBER }, { id: 'ou_bob' }]), allObserved).size).toBe(0)
    expect(policyEffects([explicit], base, allowed([]), allObserved).get('t2')).toEqual({ requesterAllowed: false, requester: { source: 'feishu', id: 'ou_alice' } })
  })
  it('auto 离开时告知推断工单 proactive:false(不是撤人);bot 工单因名单撤人而 requesterAllowed', () => {
    const auto = parseSettings({ rules: [COPY] })
    const observe = parseSettings({ mode: 'observe', rules: [COPY] })
    const rule = ticketOf('t3', mandateOf({ strength: 'inferred', basis: { via: 'listed', source: 'feishu', rules: ['copy'], observation: {} }, actor: { source: 'feishu', id: 'ou_alice' } }))
    const effects = policyEffects([rule, explicit], auto, observe, allObserved)
    expect(effects.get('t3')).toEqual({ proactive: false })
    expect(effects.has('t2')).toBe(false)
    const bot = ticketOf('t4', mandateOf({ strength: 'explicit', basis: { via: 'listed', source: 'feishu' }, actor: { source: 'feishu', id: 'cli_ci_bot' } }))
    const botAllowed = parseSettings({ allowed: [{ id: 'cli_ci_bot' }], rules: [COPY] })
    expect(policyEffects([bot], botAllowed, base, allObserved).get('t4')).toEqual({ requesterAllowed: false, requester: { source: 'feishu', id: 'cli_ci_bot' } })
  })
  it('准入格变弱 → requesterAllowed;档位离 auto → proactive:false;规则被删 → disabled', () => {
    const table = (cell: 'inferred' | 'ignore', mode: 'auto' | 'observe' = 'auto') =>
      parseSettings({ mode, admission: { [OBSERVED]: { unlistedUnaddressed: cell } }, rules: [COPY] })
    const observedRow = (): SourceScope => ({ scope: () => ({ listened: true, observed: true, row: OBSERVED }) })
    const proactive = ticketOf('t3', mandateOf({ strength: 'inferred',
      basis: { via: 'admission', cell: 'unlistedUnaddressed', source: 'feishu', scope: { chatId: OBSERVED }, row: OBSERVED, rules: ['copy'], observation: { mode: 'auto' } },
      actor: { source: 'feishu', id: 'ou_guest' } }))
    expect(policyEffects([proactive], table('inferred'), table('inferred'), observedRow).size).toBe(0)
    expect(policyEffects([proactive], table('inferred'), table('ignore'), observedRow).get('t3')).toEqual({ requesterAllowed: false, requester: { source: 'feishu', id: 'ou_guest' } })
    expect(policyEffects([proactive], table('inferred'), table('inferred', 'observe'), observedRow).get('t3')).toEqual({ proactive: false })
    const deleted = parseSettings({ rules: [COPY] })
    const visual = ticketOf('t4', mandateOf({ strength: 'explicit', basis: { via: 'listed', source: 'feishu', rules: ['visual'] }, actor: { source: 'feishu', id: 'ou_alice' } }))
    const withVisual = parseSettings({ rules: [COPY, { id: 'visual', name: 'Visual', enabled: true, instruction: 'Fix colors.' }] })
    expect(policyEffects([visual], withVisual, deleted, allObserved).get('t4')).toEqual({ rules: [{ id: 'visual', name: 'Visual', change: 'disabled' }] })
  })
})

describe('★联合版本 hash 变更触发 policyEffects(Engine 集成:热改 → policyChanged → 只通知不撤销)', () => {
  /** 真引擎 + 设置驱动 Policy(版本 = C3 联合 hash);hot() 模拟 glue 层热改:算 effects → 换版本 → Engine.policyChanged。 */
  function harness() {
    const repo = new MemoryRepositories()
    const requests: Candidate[] = []
    const assessor: Assessor = { request: (candidate) => { requests.push(candidate) } }
    const executor: Executor = { start: () => {}, deliver: () => {}, stop: () => {} }
    const sent: OutboundMessage[] = []
    const outbox: Outbox = {
      send: (message) => { if (!sent.some(item => item.id === message.id)) sent.push(message) },
      status: id => sent.some(item => item.id === id) ? 'pending' : undefined,
      withdraw: (id) => { sent.unshift({ id, channel: { source: 'feishu', thread: 'x', address: {} }, text: '', kind: 'notice' }) },
    }
    const scope = scopeOf()
    let settings = parseSettings({ rules: [COPY] })
    let parts = { governance: 'rules-v1', hitl: 'hitl-v1', tasks: policyContent(settings) }
    let version = jointPolicyVersion(parts)
    const wiring = (): PolicyWiring => ({ version })
    const engine = new Engine({
      repo, policy: () => settingsPolicy(settings, scope, wiring()), realmOf: () => REALM, scope, assessor, executor, outbox,
      now: () => '2026-11-17T00:00:00Z',
    })
    /** 收一条名单内成员的提及 → Eval → assessmentOutcome 产 accept → Engine.decide;已在库的 Trigger(如重开回队的)不重收。 */
    const accept = (id: string) => {
      if (!repo.triggers.disposition(id)) engine.receive(feishu({ id }))
      engine.evaluateDue()
      const candidate = requests.at(-1)
      if (!candidate) throw new Error('no candidate evaluated')
      const outcome = assessmentOutcome({ decision: 'accept', rule_assessments: settings.policy.rules.filter(rule => rule.enabled).map(rule => ({ rule_id: rule.id, matched: true, reason: '命中' })),
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
    return { repo, engine, accept, hot, version: () => version }
  }
  it('建单:Mandate 钉联合版本、realm 归账;规则指示热改 → 工单收 policy-changed 通知(带 effect),Mandate 不撤销、钉旧版', () => {
    const h = harness()
    const decision = h.accept('1')
    const v1 = h.version()
    expect(decision.kind).toBe('accept')
    if (decision.kind !== 'accept' || !decision.mandate) throw new Error('expected accept')
    expect(decision.mandate.policyVersion).toBe(v1)
    expect(decision.mandate.realm).toBe(REALM)
    expect(decision.delegation).toEqual(DELEGATION)
    const { from, to, effects } = h.hot(parseSettings({ rules: [{ ...COPY, instruction: 'Fix typos only.' }] }))
    expect(from).toBe(v1)
    expect(to).not.toBe(v1)
    const ticket = h.repo.tickets.list()[0]
    if (!ticket) throw new Error('no ticket')
    expect(ticket.ended).toBeUndefined()
    expect(ticket.mandate.policyVersion).toBe(v1)
    const input = ticket.inputs.at(-1)
    expect(input).toMatchObject({ kind: 'policy-changed', from: v1, to, effect: { rules: [{ id: 'copy', name: 'Copy', change: 'changed', instruction: 'Fix typos only.' }] } })
    expect(effects.get(ticket.id)).toEqual({ rules: [{ id: 'copy', name: 'Copy', change: 'changed', instruction: 'Fix typos only.' }] })
  })
  it('governance 侧热改(settings 不动 → effects 空):版本仍变、未受影响的工单一概不动,在跑 Eval 重开、事件面宣告;新工单钉新版本', () => {
    const h = harness()
    h.accept('1')
    const v1 = h.version()
    // 在跑 Eval:在新线程上收 '2'(工单 1 的线程上的后续消息归其 worker 裁决,不进 Eval)并开评估(未决)。
    h.engine.receive(feishu({ id: '2', threads: [{ source: 'feishu', id: 'y' }] }))
    h.engine.evaluateDue()
    const { from, to, effects } = h.hot(parseSettings({ rules: [COPY] }), { governance: 'rules-v2' })
    expect(from).toBe(v1)
    expect(to).not.toBe(v1)
    expect(effects.size).toBe(0)
    // 未受影响(effects 未命中)的工单一概不动:无 policy-changed Input(线程上 '2' 的扇出照常)、Mandate 钉旧版。
    const ticket = h.repo.tickets.list()[0]
    if (!ticket) throw new Error('no ticket')
    expect(ticket.ended).toBeUndefined()
    expect(ticket.mandate.policyVersion).toBe(v1)
    expect(ticket.inputs.filter(input => input.kind === 'policy-changed')).toHaveLength(0)
    // 在跑 Eval 重开:'2' 以 policyChanged 记 unavailable 并回队等新版本下的评估。
    const thread = h.repo.threads.get('feishu:y')
    expect(thread?.evaluating).toBeUndefined()
    expect(thread?.pending).toContain('2')
    expect(h.repo.decisions.byThread('feishu:y').at(-1)).toMatchObject({ kind: 'unavailable', reason: [{ code: 'policyChanged' }] })
    // 新规则只影响新工单:热改后的 accept 钉新版本。
    const second = h.accept('2')
    if (second.kind !== 'accept' || !second.mandate) throw new Error('expected accept')
    expect(second.mandate.policyVersion).toBe(to)
  })
})
