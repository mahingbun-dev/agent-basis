/**
 * 任务设置面单测(2026-11-19 任务设置分区):TasksWorld.settingsFace 的 read/roles/save。
 *
 * 被测面:policy/face.ts 工厂(纯组参;写路径委托 saveSettingsBlock)。断言:
 * - read:设置快照 + 各块修订 + 主会话/worker session id + 版本口径(wiring.version 优先);
 * - roles:主会话 id + 开放工单 worker session id(徽标 fail-closed 数据源);
 * - save:成功递增块修订、无变化保存不记修订、过期修订 conflict、非法设置 invalid、
 *   暂停块不进版本 hash(不触发 policyChanged);
 * - ★sides 缺省口径:未注入 jointSides 时版本 = tasks 内容 hash,非策略类改动不误报
 *   policy-changed(避免首次面板保存把内容 hash 与联合 hash 误判成版本变化)。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  Engine, Store, createTasksSettingsFace, jointPolicyVersion, policyContent, policyVersion, settingsPolicy,
  type Assessor, type Candidate, type Executor, type Outbox, type OutboundMessage, type PolicyWiring,
  type Settings, type SourceScope, type TasksSettingsFaceDeps,
} from '../src/index.ts'

/** 权限内容 hash 含规则/受理档/来源名单——eval.timeoutSeconds 与 executor 属非授权面。 */
const REALM = 'alice'
const MEMBER = 'ou_alice'

const INITIAL: Settings = {
  paused: false,
  sources: {},
  policy: { rules: [{ id: 'copy', name: 'Copy', enabled: true, instruction: 'Fix typos.' }], sources: { feishu: { allowed: [{ id: MEMBER, name: 'Alice' }], admission: {} } } },
  eval: { mode: 'auto', timeoutSeconds: 120, model: null },
  executor: { model: null, maxWorkers: 3, directory: '', prepare: '', blockedCommands: [] },
  budget: { caps: { simple: {}, compare: {}, complex: {} } },
  gates: { highRiskRules: [] },
}

const scope: SourceScope = { scope: () => ({ listened: true, observed: false }) }

let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'tasks-face-')) })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

/** 真实 Store + Engine 的装配(settings.spec.ts harness 的裁剪面;只测 face 缝)。 */
function harness(initial: Settings = INITIAL) {
  const store = new Store(REALM, { tenantRoot: directory })
  store.saveSettings(initial)
  const wiring: PolicyWiring = {}
  const wiringOf = (): PolicyWiring => wiring
  const requests: Candidate[] = []
  const assessor: Assessor = { request: (candidate) => { requests.push(candidate) } }
  const executor: Executor = { start: () => {}, deliver: () => {}, stop: () => {} }
  const sent: OutboundMessage[] = []
  const outbox: Outbox = {
    send: (message) => { if (!sent.some(item => item.id === message.id)) sent.push(message) },
    status: id => sent.some(item => item.id === id) ? 'pending' : undefined,
    withdraw: (id) => { sent.unshift({ id, channel: { source: 'feishu', thread: 'x', address: {} }, text: '', kind: 'notice' }) },
  }
  const changes: Array<{ from: string; to: string }> = []
  const engine = new Engine({
    repo: store,
    policy: () => settingsPolicy(store.settings(), scope, wiringOf()),
    realmOf: () => REALM,
    scope,
    assessor,
    executor,
    outbox,
    now: () => '2026-11-19T00:00:00Z',
  })
  // policyChanged 记录(from/to):Engine.policyChanged 在真实实例上只记账,不另起副作用。
  const original = engine.policyChanged.bind(engine)
  engine.policyChanged = (from: string, to: string, effects): void => {
    changes.push({ from, to })
    original(from, to, effects)
  }
  const deps: TasksSettingsFaceDeps = {
    host: {
      store,
      engine,
      scope: () => scope,
      wiring: wiringOf,
      setVersion: (next: string): void => { wiring.version = next },
    },
    realm: REALM,
    masterId: () => 'orchestrator-alice',
    masterTitle: 'eterna-tasks orchestrator',
    health: () => ({ state: 'ready', detail: 'ok', at: '2026-11-19T00:00:00Z', components: {} }),
    stats: () => ({
      realm: REALM,
      tickets: { open: 0, active: 0, total: 0 },
      threads: { active: 0, subscribed: 0 },
      triggers: { total: 0 },
      decisions: { total: 0 },
      effects: { waiting: 0, byKind: {} },
      outbox: { pending: 0, dropped: 0 },
      policy: { version: wiring.version ?? '', paused: false, evalMode: 'auto', rules: 1 },
      executor: { maxWorkers: 3, usedSlots: 0 },
      masterId: 'orchestrator-alice',
    }),
    workerSessionIds: () => ['worker-T-1'],
  }
  return { store, engine, wiring, changes, deps }
}

describe('settingsFace read/roles', () => {
  it('read 投影设置/修订/主会话/worker 集,版本缺省内容 hash', () => {
    const h = harness()
    const face = createTasksSettingsFace(h.deps)
    const view = face.read()
    expect(view.realm).toBe(REALM)
    expect(view.masterId).toBe('orchestrator-alice')
    expect(view.masterTitle).toBe('eterna-tasks orchestrator')
    expect(view.paused).toBe(false)
    expect(view.policyVersion).toBe(policyVersion(h.store.settings()))
    expect(view.workerSessionIds).toEqual(['worker-T-1'])
    expect(view.revisions['policy']).toBe(0)
    expect(view.revisions['pause']).toBe(0)
    // 来源实例块已按现设置展开(此初始无实例 → 只有固定六块)。
    expect(Object.keys(view.revisions)).toEqual(['pause', 'policy', 'eval', 'executor', 'budget', 'gates'])
  })

  it('wiring.version 在场时 read 版本取联合 hash 现价', () => {
    const h = harness()
    h.wiring.version = 'joint-v1'
    expect(createTasksSettingsFace(h.deps).read().policyVersion).toBe('joint-v1')
  })

  it('roles 只暴露角色判定面(主会话 + worker session id)', () => {
    const h = harness()
    expect(createTasksSettingsFace(h.deps).roles()).toEqual({
      masterId: 'orchestrator-alice', masterTitle: 'eterna-tasks orchestrator', workerSessionIds: ['worker-T-1'],
    })
  })
})

describe('settingsFace save(分块 CAS 委托 saveSettingsBlock)', () => {
  it('合法保存递增块修订;超时属非授权面(版本不变、不通知)', () => {
    const h = harness()
    const face = createTasksSettingsFace(h.deps)
    const next: Settings = { ...h.store.settings(), eval: { ...h.store.settings().eval, timeoutSeconds: 300 } }
    const result = face.save('eval', next, 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.saved).toBe(true)
    expect(result.revision).toBe(1)
    expect(result.settings.eval.timeoutSeconds).toBe(300)
    // 版本只随授权内容变化(timeoutSeconds 不进 hash):无版本回写、无 policy-changed。
    expect(result.policyVersion).toBe(policyVersion(next))
    expect(h.wiring.version).toBeUndefined()
    expect(h.changes).toHaveLength(0)
    expect(h.store.blockRevision('eval')).toBe(1)
  })

  it('无变化保存不记修订、不发 policy-changed', () => {
    const h = harness()
    const face = createTasksSettingsFace(h.deps)
    const result = face.save('eval', h.store.settings(), 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.saved).toBe(true)
    expect(result.revision).toBe(0)
    expect(h.store.blockRevision('eval')).toBe(0)
    expect(h.changes).toHaveLength(0)
  })

  it('★非策略类改动(executor)在 sides 缺省时不误报 policy-changed(版本口径对称)', () => {
    const h = harness()
    const face = createTasksSettingsFace(h.deps)
    const next: Settings = { ...h.store.settings(), executor: { ...h.store.settings().executor, maxWorkers: 5 } }
    const result = face.save('executor', next, 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.policyVersion).toBe(policyVersion(next))
    // 内容 hash 与旧内容 hash 一致(executor 不进 hash)→ 不发通知。
    expect(h.changes).toHaveLength(0)
    expect(h.store.blockRevision('executor')).toBe(1)
  })

  it('规则改动经 sides 缺省口径仍触发 policy-changed(内容 hash 变)', () => {
    const h = harness()
    const face = createTasksSettingsFace(h.deps)
    const settings = h.store.settings()
    const next: Settings = { ...settings, policy: { ...settings.policy, rules: [...settings.policy.rules, { id: 'visual', name: 'Visual', enabled: true, instruction: 'Match brand.' }] } }
    expect(face.save('policy', next, 0).ok).toBe(true)
    expect(h.changes).toHaveLength(1)
    expect(h.changes[0]?.to).toBe(policyVersion(next))
  })

  it('暂停块保存不改变版本、不通知(pause 不进 hash)', () => {
    const h = harness()
    const face = createTasksSettingsFace(h.deps)
    expect(face.save('pause', { ...h.store.settings(), paused: true }, 0).ok).toBe(true)
    expect(h.store.settings().paused).toBe(true)
    expect(h.store.blockRevision('pause')).toBe(1)
    expect(h.changes).toHaveLength(0)
  })

  it('过期修订 → conflict(什么也不存)', () => {
    const h = harness()
    const face = createTasksSettingsFace(h.deps)
    const settings = h.store.settings()
    expect(face.save('executor', { ...settings, executor: { ...settings.executor, maxWorkers: 4 } }, 0).ok).toBe(true)
    const stale = face.save('executor', { ...settings, executor: { ...settings.executor, maxWorkers: 6 } }, 0)
    expect(stale).toEqual({ ok: false, code: 'conflict', message: '设置已被其他保存更新，请重新加载' })
    expect(h.store.settings().executor.maxWorkers).toBe(4)
  })

  it('非法设置 → invalid(含字段路径,不写库)', () => {
    const h = harness()
    const face = createTasksSettingsFace(h.deps)
    const settings = h.store.settings()
    const invalid = face.save('eval', { ...settings, eval: { ...settings.eval, timeoutSeconds: 5 } }, 0)
    expect(invalid.ok).toBe(false)
    if (invalid.ok) return
    expect(invalid.code).toBe('invalid')
    expect(invalid.message).toContain('eval.timeoutSeconds')
    expect(h.store.blockRevision('eval')).toBe(0)
  })

  it('jointSides 注入时保存切换到联合 hash(A10 原语义:未注入联合版本的装配由此切版)', () => {
    const h = harness()
    const face = createTasksSettingsFace({ ...h.deps, jointSides: () => ({ governance: 'g1', hitl: 'h1' }) })
    const settings = h.store.settings()
    const next: Settings = { ...settings, executor: { ...settings.executor, maxWorkers: 4 } }
    const result = face.save('executor', next, 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.policyVersion).toBe(jointPolicyVersion({ governance: 'g1', hitl: 'h1', tasks: policyContent(next) }))
    expect(h.wiring.version).toBe(result.policyVersion)
    // from = 运行时现版本(内容 hash),to = 联合 hash → 一次切版通知(A10 原语义)。
    expect(h.changes).toEqual([{ from: policyVersion(settings), to: result.policyVersion }])
  })

  it('来源实例块按 source:<name> 计修订(设置块清单展开)', () => {
    const h = harness({ ...INITIAL, sources: { webchat: { enabled: true, config: {} } } })
    const face = createTasksSettingsFace(h.deps)
    expect(face.read().revisions['source:webchat']).toBe(0)
    const next: Settings = { ...h.store.settings(), sources: { webchat: { enabled: false, config: {} } } }
    const result = face.save('source:webchat', next, 0)
    expect(result.ok).toBe(true)
    expect(h.store.blockRevision('source:webchat')).toBe(1)
  })

  it('policyContent 不变时版本相等(冒烟:版本真值源一致性)', () => {
    const h = harness()
    const bumped = { ...h.store.settings(), executor: { ...h.store.settings().executor, maxWorkers: 9 } }
    expect(policyVersion(h.store.settings())).toBe(policyVersion(bumped))
    expect(policyContent(h.store.settings())).not.toBe('')
  })
})
