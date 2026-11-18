/**
 * plugin-boot 装配用例(35 号 A16;34 号 §4-E 承接表「runtime.spec → plugin-boot.spec」判据):
 * - 装配启动顺序 store→effects→outbox→engine→assessor→executor→sources(sources 留接口位)
 *   与关停配逆(dispose 逆序回放)——34 §4-E 判据原文;
 * - fail-closed:注入的 dirOf 解析失败不开库不建目录(realm.ts 铁律,23 号 §3.1);
 *   缺省派生的部署指名 realm 由 Store 引导自建;
 * - engine 全链经装配走通(trigger→Eval→accept→工单开出→stub executor 记账,★A19/A22 替换点),
 *   realm 标注落库与 R4 执行契约经装配面填入;
 * - ctx.tasks 服务面(defineTasksPlugin + TASKS_SERVICE_ID provide 可配逆;health()/stats()
 *   供工作台与探针,35 号 A16④);
 * - ★master 会话引导与 sessionHost 自主机 ctx 派生(2026-11-18 出票端到端三断点①/④):
 *   masterId 按 config → KV → 约定派生解析、写 KV、health/stats 暴露;约定派生的主会话经
 *   宿主 session 面 ensure 存在;宿主 session 服务缺席时回落 StubExecutor(联合类型保持)。
 *
 * 模拟宿主形态承 34 §4-E「模拟宿主驱动 runtime 级用例」:临时租户根 + 触发器构造复用
 * fixtures/host.ts;不依赖真实 DSH 宿主服务(stub executor 不触 ctx.agents)。
 */
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Engine } from '../src/core/engine.ts'
import { Effects } from '../src/effects/effects.ts'
import { Outbox } from '../src/effects/outbox.ts'
import { Store } from '../src/store/store.ts'
import { TasksRealmRouter } from '../src/store/realm.ts'
import { KV } from '../src/store/kv.ts'
import {
  createTasks, DEFAULT_TASKS_REALM, defineTasksPlugin, PASS_INTERVAL_MS, StubExecutor,
  TASKS_PLUGIN_NAME, TASKS_SERVICE_ID,
} from '../src/plugin.ts'
import { MasterAssessor } from '../src/session/assessor.ts'
import { DshExecutor } from '../src/executor/dsh.ts'
import { workerSessionId } from '../src/executor/dsh.ts'
import { masterSessionId, MASTER_SESSION_TITLE } from '../src/session/sessions.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHostPorts } from '../src/session/sessions.ts'
import type { TasksRuntime, TasksWorld } from '../src/plugin.ts'
import { MEMBER, SOURCE, humanTrigger } from './fixtures/host.ts'
import type { ScopeResult, SourceScope } from '../src/core/index.ts'
import type { TasksOptions } from '../src/plugin.ts'

/** 装配启动序(35 号 A16 交付原文;34 §4-E 判据,sources 留接口位居末)。 */
const BOOT_ORDER = ['store', 'effects', 'outbox', 'engine', 'assessor', 'executor', 'sources']

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'tasks-plugin-boot-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

/** 预先开通一个租户 realm 工作区(access 登录开通语义;缺省 dirOf 为直派生,预先存在或 Store 引导自建皆可)。 */
const openRealm = (realm = 'alice'): string => {
  const dir = join(root, realm)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 以临时租户根装配(长 pass 周期:周期驱动不在本用例触发,手动 pass 驱动;选项可覆写)。 */
const boot = (realm = 'alice', overrides: Partial<TasksOptions> = {}): TasksRuntime =>
  createTasks({ tenantRoot: root, realm, passIntervalMs: 3_600_000, ...overrides })

/** test Source 的监听范围端口(fixture host.ts 同款;A21 落地前经 sources 接口位注入)。 */
const testScope: SourceScope = {
  scope: ({ source }): ScopeResult =>
    source === SOURCE ? { listened: true, observed: true, row: 'main' } : { listened: false, reason: 'not_listened' },
}

it('装配按 store→effects→outbox→engine→assessor→executor→sources 启动,关停配逆(34 §4-E)', () => {
  const dir = openRealm()
  const runtime = boot()

  // 启动序逐位断言(sources 留接口位在末位)
  expect(runtime.boot).toEqual(BOOT_ORDER)
  // 组件为真实装配件:engine 全链(Engine + Intake/Evals/Tickets/Assignments/Replies)
  // + realm router + store/effects/outbox 适配器;assessor/executor 为可控 stub
  expect(runtime.engine).toBeInstanceOf(Engine)
  expect(runtime.store).toBeInstanceOf(Store)
  expect(runtime.effects).toBeInstanceOf(Effects)
  expect(runtime.outbox).toBeInstanceOf(Outbox)
  expect(runtime.router).toBeInstanceOf(TasksRealmRouter)
  expect(runtime.assessor).toBeInstanceOf(MasterAssessor)
  // executor 面按 sessionHost 注入分派(★A22):无宿主服务束装配为可控 stub
  expect(runtime.executor instanceof StubExecutor).toBe(true)
  // ★master 会话引导(三断点①):裸 createTasks(无 sessionHost、无 config.masterId、KV 空)
  // 不猜主会话——masterId 缺省,health()/stats() 如实缺省,webchat 入口无从安装。
  expect(runtime.masterId).toBeUndefined()
  expect(runtime.health().masterId).toBeUndefined()
  expect(runtime.stats().masterId).toBeUndefined()
  // 库路径派生自租户工作区(34 §4-C tenant-scan 级断言;realm router 经 workspaceDir 建 Store)
  expect(runtime.store.path).toBe(join(dir, '.eterna', 'tasks.sqlite3'))
  expect(runtime.store.realm).toBe('alice')
  // realm/周期选项生效;装配健康面就绪,且 outbox 注册的 reply handler 与装配级 tasks 条目在册
  expect(runtime.realm).toBe('alice')
  expect(runtime.health().state).toBe('ready')
  expect(Object.keys(runtime.health().components)).toEqual(expect.arrayContaining(['tasks', 'reply']))

  runtime.dispose()
  // 关停配逆(34 §4-E 判据原文):shutdown 序 = boot 逆序
  expect(runtime.shutdown).toEqual([...BOOT_ORDER].reverse())
  // 幂等:二次 dispose 不再回放
  runtime.dispose()
  expect(runtime.shutdown).toEqual([...BOOT_ORDER].reverse())
})

it('关停收口:store 关闭、tasks 健康项注销、stats 面停用;关停在关停序内执行', () => {
  openRealm()
  const runtime = boot()
  const { engine, store } = runtime
  runtime.dispose()
  // store 已随 router 池关闭(逆序回放的末位):Engine 命令落到已关闭句柄即抛
  expect(() => engine.receive(humanTrigger('1', '你好'))).toThrow()
  expect(existsSync(store.path)).toBe(true) // 数据文件保留(下次 start 重派/effects-resume 语义)
  // 装配级健康项已注销(release;同 SA delete 后缺席语义),聚合面如实报已关停
  expect(runtime.health().components.tasks).toBeUndefined()
  expect(runtime.health().state).toBe('error')
  expect(runtime.health().detail).toContain('已关停')
  // stats 面在关停后显式停用(不返回静默零值)
  expect(() => runtime.stats()).toThrow('已关停')
})

it('fail-closed:注入的 dirOf 解析失败不开库、不隐式建目录(realm.ts 铁律,23 号 §3.1)', () => {
  // 账号级解析(glue 注入面)返回 undefined = 解析失败:不开库、不建目录
  expect(() => createTasks({ tenantRoot: root, realm: 'ghost', dirOf: () => undefined })).toThrow(/ghost/)
  expect(existsSync(join(root, 'ghost'))).toBe(false)
})

it('缺省 realm:部署指名的工作区由 Store 引导自建,库路径派生自 workspaces/<realm>/(34 §4-C)', () => {
  const runtime = boot(DEFAULT_TASKS_REALM)
  expect(runtime.store.path).toBe(join(root, DEFAULT_TASKS_REALM, '.eterna', 'tasks.sqlite3'))
  expect(existsSync(join(root, DEFAULT_TASKS_REALM, '.eterna', 'tasks.sqlite3'))).toBe(true)
  expect(runtime.health().state).toBe('ready')
  runtime.dispose()
})

it('engine 全链经装配走通:trigger→Eval→accept→工单开出→stub executor 记账(★A19/A22 替换点)', () => {
  openRealm()
  const runtime = boot('alice', { scope: testScope })
  // realm 内名单(fixture 同款口径):test Source 上的人消息成为显式请求
  runtime.store.saveSettings({ policy: { sources: { [SOURCE]: { allowed: [{ id: MEMBER, name: 'Alice' }] } } } })

  const trigger = humanTrigger('1', '@bot 修复登录回归')
  expect(runtime.engine.receive(trigger)).toBe('stored')
  // 幂等三态(intake):重复投递收敛,不开新 Eval
  expect(runtime.engine.receive(trigger)).toBe('duplicate')
  // pass 驱动手动一轮:线程 Eval 启动,候选到达可控 assessor(★A19 替换点记账)
  runtime.pass()
  // A19 后 assessor 为 MasterAssessor:候选经 Engine 的 candidate 面读取(deliver 未注入时不投递、不计时)
  const candidate = runtime.engine.candidate(trigger.id)
  expect(candidate).toBeDefined()
  expect(candidate!.triggers.map(item => item.id)).toContain(trigger.id)

  // 显式裁决(R3 四要素齐备):工单开出、realm 标注落库、执行契约经装配面填入
  runtime.engine.candidateDelivered(candidate!.evalId)
  const decision = runtime.engine.decide(trigger.id, {
    kind: 'accept',
    title: '修复登录回归',
    scope: 'Do the work described by the request.',
    reason: 'explicit request',
    delegation: {
      objective: 'Fix the reported regression.',
      outputFormat: 'A patch plus a summary.',
      toolGuidance: 'Use the read/edit/bash tools in the ticket workspace.',
      taskBoundaries: 'Only the reported defect; no refactors.',
    },
  })
  const ticketId = decision.ticketId
  expect(ticketId).toBeTruthy()
  const ticket = runtime.store.tickets.get(ticketId!)
  // realm 进内核模型(24a A1):工单与 Mandate 均落 realm;intake disposition 标注同源
  expect(ticket?.realm).toBe('alice')
  expect(ticket?.mandate.realm).toBe('alice')
  expect(runtime.store.triggers.disposition(trigger.id)?.realm).toBe('alice')
  // R4 执行契约:目录 = <租户 realm 工作区>/.ticket/<id>/(24 号 §5.5-R4;装配面 ticketExecution)
  expect(ticket?.execution).toMatchObject({ name: ticketId, directory: join(runtime.store.workspaceDir, '.ticket', ticketId!) })
  // 可控 executor(★A22 替换点)按 Engine 委托记账;工单停在 pending(stub 不开 worker session)
  const assignmentId = ticket?.assignments.at(-1)?.id
  expect(assignmentId).toBeTruthy()
  expect(runtime.executor instanceof StubExecutor ? runtime.executor.callsOf(ticketId) : []).toContainEqual({ op: 'start', ticketId, assignmentId })
  expect(ticket?.assignments.at(-1)?.state).toBe('pending')

  // 最小状态面(35 号 A16④)反映实况;领域事件经装配 onEvent 位透出
  expect(runtime.stats().tickets).toMatchObject({ open: 1, active: 1, total: 1 })
  expect(runtime.stats().triggers.total).toBe(1)
  expect(runtime.stats().policy.rules).toBe(0)
  runtime.dispose()
})

it('缺省 SourceScope 真实现(三断点③):webchat 主会话 listened,余一律 filtered 落库不进 Eval', () => {
  openRealm()
  // masterId 经 config 注入(引导解析第一序;三断点①),缺省 scope 面即 webchatMasterScope。
  const runtime = boot('alice', { masterId: 'orchestrator-main' })
  runtime.store.saveSettings({ policy: { sources: { [SOURCE]: { allowed: [{ id: MEMBER, name: 'Alice' }] } } } })
  const trigger = humanTrigger('1', '@bot 修复登录回归')
  // 非 webchat 来源:缺省面一律不监听——intake 记 filtered 处置落库(intake.ts:37-40),不排 Eval。
  expect(runtime.engine.receive(trigger)).toBe('filtered')
  runtime.pass()
  expect(runtime.engine.candidate(trigger.id)).toBeUndefined()
  expect(runtime.store.triggers.disposition(trigger.id)?.filtered).toBeDefined()
  // webchat 主会话的用户消息:listened(explicit 强度由 gate 名单 × direct 裁定),进 Eval。
  runtime.store.saveSettings({ policy: { sources: { [SOURCE]: { allowed: [{ id: MEMBER, name: 'Alice' }] },
    webchat: { allowed: [{ id: runtime.realm, name: '部署账号' }] } } } })
  const webchat = humanTrigger('2', '请把深色模式补上', {
    source: 'webchat', threads: [{ source: 'webchat', id: 'orchestrator-main' }],
    actor: { source: 'webchat', id: runtime.realm }, addressed: 'direct',
    meta: { sessionId: 'orchestrator-main', messageId: 'm-1' },
  })
  expect(runtime.engine.receive(webchat)).toBe('stored')
  expect(runtime.store.triggers.disposition(webchat.id)?.filtered).toBeUndefined()
  // 同一 webchat 来源但非主会话:不在白名单,仍 filtered(不猜会话归属)。
  const stranger = humanTrigger('3', '这不是主会话', {
    source: 'webchat', threads: [{ source: 'webchat', id: 'someone-else' }],
    actor: { source: 'webchat', id: runtime.realm }, addressed: 'direct',
    meta: { sessionId: 'someone-else', messageId: 'm-2' },
  })
  expect(runtime.engine.receive(stranger)).toBe('filtered')
  runtime.dispose()
})

it('插件形态:apply(ctx) 以 TASKS_SERVICE_ID provide ctx.tasks 服务,disposer 先撤服务再逆序关停', () => {
  openRealm()
  const ctx = new Context()
  const plugin = defineTasksPlugin({ tenantRoot: root, realm: 'alice', passIntervalMs: 3_600_000 })
  expect(plugin.name).toBe(TASKS_PLUGIN_NAME)

  const dispose = plugin.apply(ctx)
  // 注册表 + 唯一 ID 服务面(26 §2.1-1,与 ctx.audit 消费同构)
  const tasks: TasksWorld | undefined = ctx.tasks
  expect(tasks).toBeDefined()
  expect(tasks!.id).toBe(TASKS_SERVICE_ID)
  expect(tasks!.boot).toEqual(BOOT_ORDER)
  // 服务面 health()/stats()(35 号 A16④:工作台与探针消费)
  expect(tasks!.health().state).toBe('ready')
  expect(tasks!.stats().realm).toBe('alice')
  expect(tasks!.stats().executor.maxWorkers).toBeGreaterThan(0)
  // 手动 pass 与 pass 周期常量面
  expect(() => { tasks!.pass() }).not.toThrow()
  expect(PASS_INTERVAL_MS).toBe(2000)

  // 关停配逆:先撤服务(ctx.tasks 摘除),装配逆序回放(audit/governance disposer 形态)
  dispose()
  expect(ctx.tasks).toBeUndefined()
  expect(tasks!.shutdown).toEqual([...BOOT_ORDER].reverse())
})

// ── A22 真实执行面接线(35 号 A22;34 号 §2.4/§2.5;A0 评审 §5-C11 宿主面)──────────────

/** 宿主 session 服务面假件(签名逐项对齐 A0 §5-C11 钉住的 0.2.2-rc.1 面;fixtures/host.ts 同构假件的紧凑版)。 */
/** 仿 RemoteError 的错误面(extends Error;判别恒按 `code`,A0 §5-C11 注)。 */
const remoteError = (code: string, message: string): Error & { readonly code: string } => Object.assign(new Error(message), { code })

/** fakeSessionHost 的断言面句柄。 */
interface FakeSessionHostHandle {
  readonly ports: SessionHostPorts
  readonly agentIds: string[]
  readonly cwdBySession: Map<string, string | undefined>
  readonly renamed: Map<string, string>
  readonly permissions: Map<string, string>
  readonly workspaces: Map<string, string>
}

function fakeSessionHost(ctx: Context): FakeSessionHostHandle {
  const agentIds: string[] = [], cwdBySession = new Map<string, string | undefined>()
  const renamed = new Map<string, string>(), permissions = new Map<string, string>(), workspaces = new Map<string, string>()
  let workspaceSeq = 0
  const agents = new Map<string, unknown>()
  const makeAgent = (sessionId: string, cwd?: string): unknown => ({
    id: sessionId, status: 'idle', session: { id: sessionId }, cwd,
    inbox: { nextTurn: [], nextStep: [], remove: (): boolean => false },
    followup: vi.fn(), steer: vi.fn(), inject: vi.fn(),
    cancel: vi.fn(), whenIdle: (): Promise<void> => Promise.resolve(),
  })
  const ports = {
    controller: {
      resolveAgent: vi.fn(async (sessionId: string | SessionId) => {
        const agent = agents.get(String(sessionId))
        return agent ? { agent } : { error: remoteError('session/not-found', `session ${String(sessionId)} not found`) }
      }),
      create: vi.fn(async (request: { sessionId?: unknown; workspaceId?: string; cwd?: string; agentPreset?: string }) => {
        const id = String(request.sessionId)
        if (agents.has(id)) throw new Error(`session ${id} already exists`)
        const cwd = request.cwd ?? (request.workspaceId !== undefined ? workspaces.get(request.workspaceId) : undefined)
        agents.set(id, makeAgent(id, cwd))
        cwdBySession.set(id, cwd)
        agentIds.push(id)
        return { sessionId: id as never }
      }),
      rename: vi.fn(async (request: { sessionId: unknown; title: string }) => {
        renamed.set(String(request.sessionId), request.title)
        return { title: request.title }
      }),
    },
    workspaces: {
      create: vi.fn(async (path: string, title?: string) => {
        const id = `ws-${++workspaceSeq}`
        workspaces.set(id, path)
        return { id, path, title: title ?? path }
      }),
    },
    permissions: { set: vi.fn((session: { id: string }, name: string): void => { permissions.set(session.id, name) }) },
    persistence: {
      flush: vi.fn(async (): Promise<void> => {}),
      open: vi.fn(async () => ({
        read: vi.fn(async (): Promise<{ events: readonly unknown[] }> => ({ events: [] })),
        close: vi.fn(async (): Promise<void> => {}),
      })),
    },
  } as unknown as SessionHostPorts
  // agents 注册表(Sessions 的投递目标活性检查与 executor 的 stop/resume/runing 面消费)
  const registry = {
    get: (id: string | SessionId): unknown => agents.get(String(id)),
    list: (): unknown[] => [...agents.values()],
  }
  ctx.reflect.provide('agents', registry)
  return { ports, agentIds, cwdBySession, renamed, permissions, workspaces }
}

it('A22 真实执行面接线:sessionHost 注入即 DshExecutor+Sessions 替换可控 stub,worker session 经真实宿主 seam 建在租户工作区', async () => {
  openRealm()
  const ctx = new Context()
  const fake = fakeSessionHost(ctx)
  const runtime = boot('alice', {
    scope: testScope,
    sessionHost: { context: ctx, masterId: 'orchestrator-main', ports: fake.ports },
  })
  try {
    // executor 步已替换为真实执行面(★A22;stub 面记账语义保留给无宿主服务束的装配,见上例)
    expect(runtime.boot).toEqual(BOOT_ORDER)
    expect(runtime.executor).toBeInstanceOf(DshExecutor)
    expect(runtime.sessions).toBeDefined()
    runtime.store.saveSettings({ policy: { sources: { [SOURCE]: { allowed: [{ id: MEMBER, name: 'Alice' }] } } } })
    const trigger = humanTrigger('1', '@bot 修复登录回归')
    expect(runtime.engine.receive(trigger)).toBe('stored')
    runtime.pass()
    const candidate = runtime.engine.candidate(trigger.id)
    expect(candidate).toBeDefined()
    runtime.engine.candidateDelivered(candidate!.evalId)
    const decision = runtime.engine.decide(trigger.id, {
      kind: 'accept', title: '修复登录回归', scope: 'Do the work described by the request.', reason: 'explicit request',
      delegation: {
        objective: 'Fix the reported regression.', outputFormat: 'A patch plus a summary.',
        toolGuidance: 'Use the read/edit/bash tools in the ticket workspace.', taskBoundaries: 'Only the reported defect; no refactors.',
      },
    })
    const ticketId = decision.ticketId!
    // launch effect 经真实执行面排空:worker session 以 `worker-<ticketId>` 建立并报到 assignmentStarted
    await runtime.effects.idle()
    const sessionId = workerSessionId(ticketId)
    expect(fake.agentIds).toContain(sessionId)
    const ticket = runtime.store.tickets.get(ticketId)
    // worker session cwd = R4 目录(租户 realm 工作区内,A22 交付原文;经 workspaceRegistry.create 登记)
    expect(fake.cwdBySession.get(sessionId)).toBe(ticket?.execution?.directory)
    // 权限 preset 写入(A4 拍板 v1 现有沙箱旋钮;SA sessions.ts:150 同款缺省)与标题 rename
    expect(fake.permissions.get(sessionId)).toBe('danger-full-access')
    expect(fake.renamed.get(sessionId)).toBe('修复登录回归')
    // assignment 已启动(执行面经 lazy engine getter 回报 Engine——接线闭环)
    expect(ticket?.assignments.at(-1)?.state).toBe('running')
  }
  finally { runtime.dispose() }
})

// ── ★master 会话引导与 sessionHost 自宿主 ctx 派生(2026-11-18 出票端到端三断点①/④)─────

it('master 引导·解析序:config.masterId → KV 既有约定 → 约定派生 orchestrator-<realm>;解析结果写 KV 并经 health/stats 暴露', () => {
  openRealm()
  // 第一序:config 显式注入原样采信并写 KV(无宿主 session 面也落 KV——重启可复得)。
  const first = boot('alice', { masterId: 'orchestrator-main' })
  expect(first.masterId).toBe('orchestrator-main')
  expect(first.store.get(KV.master.session)).toBe('orchestrator-main')
  expect(first.health().masterId).toBe('orchestrator-main')
  expect(first.stats().masterId).toBe('orchestrator-main')
  expect(first.executor instanceof StubExecutor).toBe(true)
  first.dispose()

  // 第二序:config 缺席时自 KV 复得既有约定(重启后同一主会话;不重新派生)。
  const second = boot('alice')
  expect(second.masterId).toBe('orchestrator-main')
  expect(second.store.get(KV.master.session)).toBe('orchestrator-main')
  second.dispose()

  // 第三序:宿主 session 面在场且 config/KV 皆缺席 → 确定性约定派生 `orchestrator-<realm>`,
  // 并经 Sessions.ensure 确保主会话存在(SA runtime.ts:210 同构;resolveAgent 已有即复用)。
  const thirdRoot = join(root, 'fresh')
  mkdirSync(thirdRoot, { recursive: true })
  const ctx = new Context()
  const fake = fakeSessionHost(ctx)
  const third = createTasks({ tenantRoot: thirdRoot, realm: 'alice', passIntervalMs: 3_600_000,
    sessionHost: { context: ctx, ports: fake.ports } })
  try {
    expect(third.masterId).toBe(masterSessionId('alice'))
    expect(third.masterId).toBe('orchestrator-alice')
    expect(third.store.get(KV.master.session)).toBe('orchestrator-alice')
    // 主会话经真实宿主 session 面建立(扩展点:fire-and-forget 的 ensure 待落定)。
    return vi.waitFor(() => {
      expect(fake.agentIds).toContain('orchestrator-alice')
      expect(fake.renamed.get('orchestrator-alice')).toBe(MASTER_SESSION_TITLE)
      expect(fake.permissions.get('orchestrator-alice')).toBe('danger-full-access')
      expect(third.health().components.master?.state).toBe('ready')
    }).then(() => { third.dispose() })
  } catch (error) { third.dispose(); throw error }
})

it('sessionHost 自宿主 ctx 派生(三断点④):五服务齐全即真实 DshExecutor;任一缺席回落 StubExecutor', () => {
  openRealm()
  // 齐全:defineTasksPlugin 未显式注入 config.sessionHost,自 ctx 反射读取服务束派生
  // (服务名 = DSH 0.2.2-rc.1 实测键:sessionController/workspaceRegistry/
  // permissionPresets/sessionPersistence/agents,dsh-*/lib/index.js 的 super(ctx, "<name>") 处)。
  const ctx = new Context()
  const fake = fakeSessionHost(ctx)
  ctx.reflect.provide('sessionController', fake.ports.controller)
  ctx.reflect.provide('workspaceRegistry', fake.ports.workspaces)
  ctx.reflect.provide('permissionPresets', fake.ports.permissions)
  ctx.reflect.provide('sessionPersistence', fake.ports.persistence)
  const plugin = defineTasksPlugin({ tenantRoot: root, realm: 'alice', passIntervalMs: 3_600_000, scope: testScope })
  const dispose = plugin.apply(ctx)
  try {
    const runtime = ctx.tasks as TasksRuntime
    expect(runtime.executor).toBeInstanceOf(DshExecutor)
    expect(runtime.sessions).toBeDefined()
    // 约定派生的主会话:宿主 session 面在场 → masterId 就绪(三断点①在该形态下恒成立)。
    expect(runtime.masterId).toBe('orchestrator-alice')
    // worker session 经派生出的宿主面真实建立(worker-<ticketId>,cwd = R4 目录)。
    return (async () => {
      await vi.waitFor(() => { expect(fake.agentIds).toContain('orchestrator-alice') })
      runtime.store.saveSettings({ policy: { sources: { [SOURCE]: { allowed: [{ id: MEMBER, name: 'Alice' }] } } } })
      const trigger = humanTrigger('1', '@bot 修复登录回归')
      expect(runtime.engine.receive(trigger)).toBe('stored')
      runtime.pass()
      const candidate = runtime.engine.candidate(trigger.id)
      expect(candidate).toBeDefined()
      runtime.engine.candidateDelivered(candidate!.evalId)
      const decision = runtime.engine.decide(trigger.id, {
        kind: 'accept', title: '修复登录回归', scope: 'Do the work described by the request.', reason: 'explicit request',
        delegation: { objective: 'Fix it.', outputFormat: 'Patch.', toolGuidance: 'Tools.', taskBoundaries: 'Defect only.' },
      })
      await runtime.effects.idle()
      expect(fake.agentIds).toContain(workerSessionId(decision.ticketId!))
    })().finally(() => { dispose() })
  } catch (error) { dispose(); throw error }
})

it('sessionHost 派生 fail-closed:宿主仅提供部分服务(缺 agents/sessionPersistence)即回落 stub,不造桩', () => {
  openRealm()
  const ctx = new Context()
  // 只给 sessionController + workspaceRegistry + permissionPresets;sessionPersistence 与
  // agents 缺席 —— 派生的结构面不全,按 fail-closed 不派生(投递/建会话路径上缺面即炸内核)。
  ctx.reflect.provide('sessionController', { resolveAgent: async () => ({ error: { code: 'session/not-found' } }),
    create: async () => ({}), rename: async () => ({}) })
  ctx.reflect.provide('workspaceRegistry', { create: async () => ({ id: 'w', path: '/tmp', title: 't' }) })
  ctx.reflect.provide('permissionPresets', { set: () => {} })
  const plugin = defineTasksPlugin({ tenantRoot: root, realm: 'alice', passIntervalMs: 3_600_000 })
  const dispose = plugin.apply(ctx)
  try {
    const runtime = ctx.tasks as TasksRuntime
    expect(runtime.executor).toBeInstanceOf(StubExecutor)
    expect(runtime.sessions).toBeUndefined()
    // 未派生 → 无从派生约定主会话(不猜),webchat 入口不装。
    expect(runtime.masterId).toBeUndefined()
    expect(runtime.health().components.webchat).toBeUndefined()
  } finally { dispose() }
})
