/**
 * 模拟 DSH 宿主 fixture(35 号 A14/A22;34 号 §4-E「模拟宿主」模式)。
 *
 * 参照 SA tests/fixtures/host.ts 的模拟宿主模式重写级移植(本仓 seam 面版):
 * - fake agent 注册表(ctx.agents:get/list/create/resume)+ 每 session 的 inbox
 *   (nextTurn/nextStep/remove)、queue/steer/inject 投递记录、cancel(保/清 inbox)与
 *   whenIdle——覆盖 Executor/Sessions 消费的全部 Agent 面;
 * - 四类宿主事件的发射位(agent/status、agent/inbox/claimed、session/event、
 *   agent/error),`step`/`claim` 模拟 DSH inbox 的领取语义(回合起领首条排队消息、
 *   步骤领等待中的消息;被取消截断的领取不进历史);
 * - jobRegistry / subagentRuntime:DSH 的 job 注册表与 subagent 面(background.ts 的
 *   结构 seam),自 SA fixtures/host.ts 同构移植;
 * - 宿主 session 服务面假件(35 号 A22 真实 seam):sessionController(resolveAgent/
 *   create/rename,错误按 RemoteError code 判别)、workspaceRegistry、permissionPresets、
 *   sessionPersistence(flush + 只读句柄逐页回读持久史)——签名逐项对齐 A0 评审 §5-C11
 *   钉住的 0.2.2-rc.1 面,经 ctx.reflect.provide 挂真实服务名;
 * - 装配:Store(一租户一 SQLite,临时目录)+ HealthBoard + Effects + Sessions +
 *   DshExecutor + Engine(假 assessor、settingsPolicy、realmOf 恒 REALM、ChannelOutbox
 *   接 fake channels)——A16 plugin 装配落地前的 runtime 级测试装配面。
 */
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { vi, type Mock } from 'vitest'
import { freezeMessage, MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { Engine } from '../../src/core/engine.ts'
import { DshExecutor, workerSessionId, type ExecutorHost } from '../../src/executor/dsh.ts'
import { Sessions, type SessionHostPorts } from '../../src/session/sessions.ts'
import { Outbox } from '../../src/effects/outbox.ts'
import { Effects, HealthBoard, Store } from '../../src/index.ts'
import { settingsPolicy } from '../../src/policy/gate.ts'
import type { RoleModel } from '../../src/policy/settings.ts'
import type { Assessor, Candidate, DomainEvent, SourceScope, Trigger } from '../../src/core/index.ts'

export const REALM = 'alice'
export const MEMBER = 'u-alice'
export const SOURCE = 'test'
export const MAIN = 'orchestrator-main'

/** 构造一条 MEMBER 在 SOURCE 上的对准 agent 的人消息 trigger;`id` 的数字位作时间偏移(秒)。 */
export function humanTrigger(id: string, text: string, overrides: Record<string, unknown> = {}): Trigger {
  const at = new Date(Date.parse('2026-09-09T00:00:00Z') + Number(id.replace(/\D/g, '') || 0) * 1000).toISOString()
  return {
    id, source: SOURCE, threads: [{ source: SOURCE, id: `thread-${id}` }], actor: { source: SOURCE, id: MEMBER },
    human: true, addressed: 'mention', at, text, meta: {},
    ...overrides,
  } as unknown as Trigger
}

type RegisteredAgent = {
  id: string
  status: 'idle' | 'running'
  session: { id: string }
  cwd: string | undefined
  inbox: { nextTurn: UserMessage[]; nextStep: UserMessage[]; remove(id: string): boolean }
  cancel: Mock
  inject: Mock<(message: UserMessage) => void>
  steer: Mock<(message: UserMessage) => void>
  followup: Mock<(message: UserMessage) => void>
  /** 宿主 Agent.model 面(Sessions.seedModel 的播种消费端,46 号);select 记录进 modelSelections。 */
  model: { select: Mock<(selection: RoleModel) => void> }
  whenIdle(): Promise<void>
}
/** 一条文本 user 消息(job 工具与 subagent 的通知同款)。 */
/** DSH 的 job/subagent 通知源 kind 不在本包声明面;fake 里按原样构造(仅作 fixture 驱动)。 */
const notice = (id: string, text: string): UserMessage =>
  freezeMessage({ id: MessageId(id), role: 'user', content: [{ type: 'text', text }],
    source: { kind: 'tool-jobs', form: 'notice' } } as unknown as UserMessage)

export type Delivery = { sessionId: string; mode: 'queue' | 'steer' | 'inject'; id: string; text: string }

/**
 * DSH 的 job 注册表,如 Executor 用它的面:list/wait/kill/events。`run` 起一个某 session
 * 拥有的 job,`output` 让它打印一次,`end` 结束它(如其进程那样);没有被等待收集的结束
 * 到达其 owner——owner 闲着则唤醒它,如 job 工具递送的那样。`released` 计被释放的等待数。
 */
export function jobRegistry(owner: (sessionId: string) => RegisteredAgent | undefined = () => undefined) {
  type Job = { id: string; owner: string; status: string; label: string | undefined }
  const jobs = new Map<string, Job>()
  const listeners = new Set<{ owner: string; listener: (event: { type: string }) => void }>()
  const waits = new Map<string, ((job: Job) => void)[]>()
  let released = 0
  const emit = (job: Job, type: string): void => {
    for (const listener of [...listeners]) if (listener.owner === job.owner) listener.listener({ type })
  }
  const end = (id: string, status = 'completed'): void => {
    const job = jobs.get(id)
    if (!job) return
    job.status = status
    const waiting = waits.get(id) ?? []
    waits.delete(id); released += waiting.length
    for (const wake of waiting) wake({ ...job })
    emit(job, 'settled')
    const agent = waiting.length ? undefined : owner(job.owner)
    const ended = notice(`notice-${id}`, `Job ${id} ended: ${status}`)
    if (agent?.status === 'idle') agent.followup(ended)
    else agent?.inject(ended)
  }
  const service = {
    list: vi.fn((caller: string) => [...jobs.values()].filter(job => job.owner === caller)),
    // 等待随 job 结束;signal 中止则失败,job 的结束不被收集。
    wait: vi.fn((id: string, _timeoutMs: number, _caller: string, signal?: AbortSignal) =>
      new Promise<Job>((resolve, reject) => {
        const wake = (job: Job): void => { signal?.removeEventListener('abort', abort); resolve(job) }
        const abort = (): void => {
          waits.set(id, (waits.get(id) ?? []).filter(item => item !== wake))
          reject(new Error('wait aborted'))
        }
        waits.set(id, [...waits.get(id) ?? [], wake])
        signal?.addEventListener('abort', abort, { once: true })
      })),
    // 被 kill 的 job 片刻后结束,如其进程那样;测试的 fake timers 之下也一样。
    kill: vi.fn((id: string) => { queueMicrotask(() => { end(id, 'killed') }); return 'requested' }) as Mock<(id: string) => string>,
    events: {
      subscribe: (filter: { owner: string }, listener: (event: { type: string }) => void) => {
        const entry = { owner: filter.owner, listener }
        listeners.add(entry)
        return () => { listeners.delete(entry) }
      },
    },
  }
  return {
    service, end,
    output: (id: string): void => { const job = jobs.get(id); if (job) emit(job, 'output') },
    get released() { return released },
    run: (owner: string, label = ''): string => {
      const id = `bash-${jobs.size + 1}`
      jobs.set(id, { id, owner, status: 'running', label })
      return id
    },
  }
}

/**
 * DSH 的 subagent 面,如 Executor 用它的。`spawn` 起某 session 的一个 child(活着时是
 * agent),此后对该 session 后代的 drain 拒绝它;`settle` 结束一个,其结束唤醒闲着的
 * 父,或在等待其 children 返回前 steer 在跑的那个。释放或打断一个 child 也会 settle 它;
 * 后代的 drain 注入它们的结束。目录列出该 session 有过的每个 child。
 */
export function subagentRuntime(agents: Map<string, RegisteredAgent>) {
  const children = new Map<string, { parent: string; live: boolean; settled: PromiseWithResolvers<undefined> }>()
  const closed = new Set<string>()
  const settle = (id: string, wake = true): void => {
    const child = children.get(id)
    if (!child?.live) return
    child.live = false
    agents.delete(id)
    const parent = agents.get(child.parent)
    const ended = notice(`settled-${id}`, `Subagent ${id} settled`)
    if (!wake) parent?.inject(ended)
    else if (parent?.status === 'idle') parent.followup(ended)
    else parent?.steer(ended)
    child.settled.resolve(undefined)
  }
  const service = {
    waitForChildren: vi.fn(async (parent: { id: string }) => {
      const live = [...children.values()].filter(child => child.parent === parent.id && child.live)
      await Promise.all(live.map(child => child.settled.promise))
      return live.length > 0
    }),
    listChildren: vi.fn(async (id: string) =>
      [...children].filter(([, child]) => child.parent === id).map(([childId]) => ({ id: childId }))),
    drainChildren: vi.fn(async (_parent: { id: string }, ids: readonly string[]) => { for (const id of ids) settle(id) }),
  }
  const spawn = (parent: string): string => {
    if (closed.has(parent)) throw new Error('DRAINING: the Session admits no new subagents')
    const id = `child-${children.size + 1}`
    children.set(id, { parent, live: true, settled: Promise.withResolvers<undefined>() })
    agents.set(id, {
      id, status: 'running', session: { id }, cwd: undefined,
      inbox: { nextTurn: [], nextStep: [], remove: () => false },
      cancel: vi.fn(), inject: vi.fn(), steer: vi.fn(), followup: vi.fn(),
      model: { select: vi.fn() },
      whenIdle: () => Promise.resolve(),
    })
    return id
  }
  return { service, settle, spawn, live: (id: string) => !!children.get(id)?.live }
}

/**
 * 起一个模拟 DSH 宿主:装配 Store/Effects/Sessions/DshExecutor/Engine(假 assessor、
 * settingsPolicy、fake channels),`stop()` 收摊。返回的 `step`/`claim`/`idle`/`wake`
 * 驱动 fake session 的回合与步骤语义。
 */
export async function startHost() {
  const directory = mkdtempSync(join(tmpdir(), 'tasks-host-'))
  const ctx = new Context()
  const agents = new Map<string, RegisteredAgent>()
  /** 每个 session 的下一步;它领取等待步骤的消息。 */
  const steps = new Map<string, () => void>(), claims = new Map<string, () => void>()
  const deliveries = vi.fn<(request: Delivery) => void>()
  /** session id → 最近一次角色模型播种(Sessions.ensure 的 select 落点,46 号断言面)。 */
  const modelSelections = new Map<string, RoleModel>()
  /** 角色模型注入面的可变值(测试按角色置值;null=不播种=随宿主默认)。 */
  const roleModels: { orchestrator: RoleModel | null; worker: RoleModel | null } = { orchestrator: null, worker: null }
  let turn = 0
  /** 每 session 的 whenIdle 等待者;回合结束(idle)时全部唤醒。 */
  const idleWakers = new Map<string, (() => void)[]>()
  const becomeIdle = (sessionId: string): void => {
    const agent = agents.get(sessionId)
    if (!agent || agent.status === 'idle') return
    agent.status = 'idle'
    for (const wake of idleWakers.get(sessionId) ?? []) wake()
    idleWakers.set(sessionId, [])
    ctx.emit('agent/status', { agent, status: 'idle' } as never)
  }
  const makeAgent = (sessionId: string, cwd?: string): RegisteredAgent => {
    const inbox = {
      nextTurn: [] as UserMessage[], nextStep: [] as UserMessage[],
      // 等待中的消息按其 id 被取出,如 DSH 的 inbox 那样。
      remove: (id: string): boolean => [inbox.nextTurn, inbox.nextStep].some((list) => {
        const at = list.findIndex(message => message.id === id)
        if (at >= 0) list.splice(at, 1)
        return at >= 0
      }),
    }
    // 一步领取每条消息一次:领取所有等步骤的、以及(回合起)排队的下一条,并把它们
    // 纳入 session 历史——除非此前被 cancel 截断;DSH 对每条都有事件,被纳入的追加进
    // 持久史(sessionPersistence 的回读面,A22 at-most-once 的持久半边)。
    const taken = new Set<string>()
    const take = (starts: boolean, cut = false): void => {
      const agent = agents.get(sessionId)
      if (!agent) return
      const queued = starts ? inbox.nextTurn.filter(message => !taken.has(message.id)).slice(0, 1) : []
      for (const message of [...inbox.nextStep.filter(item => !taken.has(item.id)), ...queued]) {
        taken.add(message.id)
        ctx.emit('agent/inbox/claimed', { agent, message, turn } as never)
        if (!cut) {
          ctx.emit('session/event', agent.session as never, { type: 'user/message', data: message } as never)
          persisted.set(sessionId, [...persisted.get(sessionId) ?? [], { type: 'user/message', data: message }])
        }
      }
    }
    steps.set(sessionId, () => { take(false) })
    claims.set(sessionId, () => { take(false, true) })
    const deliver = (mode: 'queue' | 'steer'): Mock<(message: UserMessage) => void> => vi.fn((message: UserMessage) => {
      inbox[mode === 'queue' ? 'nextTurn' : 'nextStep'].push(message)
      deliveries({
        sessionId, mode, id: message.id,
        text: message.content.map(block => block.type === 'text' ? block.text : '').join(''),
      })
      // 消息唤醒闲着的 agent:其回合立即开始(DSH 如是说),第一步领取等待中的。
      const agent = agents.get(sessionId)
      if (!agent || agent.status !== 'idle') return
      agent.status = 'running'
      ctx.emit('agent/status', { agent, status: 'running' } as never)
      turn++
      take(true)
    })
    // cancel 清掉 inbox(除非保留),其停止的回合片刻后结束——DSH 如是说。
    const cancel = vi.fn((_cause: unknown, options?: { keepInbox?: boolean }) => {
      if (!options?.keepInbox) { inbox.nextTurn.length = 0; inbox.nextStep.length = 0 }
      const agent = agents.get(sessionId)
      if (!agent || agent.status === 'idle') return
      queueMicrotask(() => { becomeIdle(sessionId) })
    })
    const agent: RegisteredAgent = {
      id: sessionId, status: 'idle', session: { id: sessionId }, cwd,
      inbox, followup: deliver('queue'), steer: deliver('steer'), inject: vi.fn((message: UserMessage) => {
        deliveries({
          sessionId, mode: 'inject', id: message.id,
          text: message.content.map(block => block.type === 'text' ? block.text : '').join(''),
        })
      }), cancel,
      model: { select: vi.fn((selection: RoleModel) => { modelSelections.set(sessionId, { ...selection }) }) },
      whenIdle: () => agents.get(sessionId)?.status === 'idle'
        ? Promise.resolve()
        : new Promise<void>((resolve) => { idleWakers.set(sessionId, [...idleWakers.get(sessionId) ?? [], resolve]) }),
    }
    agents.set(sessionId, agent)
    return agent
  }
  const registry = {
    get: (id: string | SessionId) => agents.get(String(id)),
    list: () => [...agents.values()],
    // 模拟宿主无持久化:resume 一律 not-found(Ensure 落回 create)。
    resume: vi.fn(async () => { throw new Error('session/not-found') }),
    create: vi.fn(async ({ sessionId, meta }: { sessionId: string | SessionId; meta?: { cwd?: string } }) => {
      const id = String(sessionId)
      if (agents.has(id)) throw new Error(`session ${id} already exists`)
      makeAgent(id, meta?.cwd)
      return { agent: agents.get(id), dispose: vi.fn(async () => { agents.delete(id) }) }
    }),
  }
  // ── 宿主 session 服务面假件(35 号 A22 真实 seam;签名逐项对齐 A0 评审 §5-C11 钉住的
  //    0.2.2-rc.1 面:resolveAgent/create/rename + workspaceRegistry + permissionPresets +
  //    sessionPersistence;错误判别按 RemoteError 的 code「Discrimination is always by
  //    `code`, never by instanceof」)───────────────────────────────────────────────
  /** workspace id → 已登记工作区(create(path, title) 的登记面,Session cwd 由它解析)。 */
  const workspaces = new Map<string, { id: string; path: string; title: string }>()
  /** session id → 最近一次 rename 的标题(ensure 的标题半边断言面)。 */
  const renamed = new Map<string, string>()
  /** session id → 已写入的权限 preset(A4 拍板 v1 现有沙箱旋钮)。 */
  const permissionPresetBySession = new Map<string, string>()
  /** session id → create 时选用的 agent preset(preset 重选兜底断言面)。 */
  const selectedPresets = new Map<string, string>()
  /** session id → 持久 user/message 事件(被纳入步骤的消息;被 cancel 截断的不进)。 */
  const persisted = new Map<string, unknown[]>()
  let workspaceSeq = 0
  const workspaceRegistry = {
    // rc.1 createCanonical 幂等语义(dsh-workspace「Repeated calls for the same canonical
    // path return the existing entity without changing its title」):同 path 已登记即原样
    // 复用(不改 title),仅新建时取 title ?? basename(path)。
    create: vi.fn(async (path: string, title?: string) => {
      const existing = [...workspaces.values()].find(workspace => workspace.path === path)
      if (existing) return existing
      const workspace = { id: `ws-${++workspaceSeq}`, path, title: title ?? basename(path) }
      workspaces.set(workspace.id, workspace)
      return workspace
    }),
  }
  const sessionController = {
    resolveAgent: vi.fn(async (sessionId: string | SessionId) => {
      const agent = agents.get(String(sessionId))
      return agent ? { agent } : { error: { code: 'session/not-found', message: `session ${String(sessionId)} not found` } }
    }),
    create: vi.fn(async (request: { sessionId?: string | SessionId; workspaceId?: string; cwd?: string; agentPreset?: string }) => {
      const id = String(request.sessionId)
      if (agents.has(id)) throw new Error(`session ${id} already exists`)
      const cwd = request.cwd ?? (request.workspaceId !== undefined ? workspaces.get(request.workspaceId)?.path : undefined)
      if (request.agentPreset !== undefined) selectedPresets.set(id, request.agentPreset)
      makeAgent(id, cwd)
      return { sessionId: SessionId(id), ...(request.agentPreset !== undefined ? { agentPreset: request.agentPreset } : {}) }
    }),
    rename: vi.fn(async (request: { sessionId: string | SessionId; title: string }) => {
      renamed.set(String(request.sessionId), request.title)
      return { title: request.title }
    }),
  }
  const permissionPresets = {
    set: vi.fn((session: { id: string }, name: string): void => { permissionPresetBySession.set(session.id, name) }),
  }
  const sessionPersistence = {
    flush: vi.fn(async (): Promise<void> => {}),
    open: vi.fn(async (id: string | SessionId, _access: 'read') => {
      const sessionId = String(id)
      return {
        read: vi.fn(async (offset: number = 0, length: number = 512): Promise<{ events: readonly unknown[] }> =>
          ({ events: (persisted.get(sessionId) ?? []).slice(offset, offset + length) })),
        close: vi.fn(async (): Promise<void> => {}),
      }
    }),
  }
  // 结构端口装配(RegisteredAgent→Agent 的结构差与本 fixture 既有口径一致,经 unknown 收敛)。
  const sessionPorts = { controller: sessionController, workspaces: workspaceRegistry, permissions: permissionPresets,
    persistence: sessionPersistence } as unknown as SessionHostPorts
  ctx.reflect.provide('sessionController', sessionController)
  ctx.reflect.provide('workspaceRegistry', workspaceRegistry)
  ctx.reflect.provide('permissionPresets', permissionPresets)
  ctx.reflect.provide('sessionPersistence', sessionPersistence)
  const jobs = jobRegistry(id => agents.get(id))
  const subagents = subagentRuntime(agents)
  ctx.reflect.provide('agents', registry)
  ctx.reflect.provide('jobs', jobs.service)
  ctx.reflect.provide('subagents', subagents.service)

  const board = new HealthBoard()
  const store = new Store(REALM, { tenantRoot: directory })
  store.saveSettings({ policy: { ...store.settings().policy, sources: { [SOURCE]: { allowed: [{ id: MEMBER, name: 'Alice' }] } } } })
  const effects = new Effects(store, board)
  const lifetime = new AbortController()
  const scope: SourceScope = {
    scope: ({ source }): { listened: true; observed: boolean; row?: string } | { listened: false; reason: string } =>
      source === SOURCE ? { listened: true, observed: true, row: 'main' } : { listened: false, reason: 'not_listened' },
  }
  const sessions = new Sessions({ context: ctx, ports: sessionPorts, effects, masterId: MAIN, lifetime: lifetime.signal,
    // 角色模型播种面(46 号):现读 roleModels,测试按角色置值后再 ensure/dispatch 即断言。
    roleModel: role => roleModels[role] })
  const channels = {
    available: () => true,
    channelAllowed: () => true,
    send: vi.fn(async () => 'sent' as const),
  }
  const outbox = new Outbox({ store, effects, channels, paused: () => store.settings().paused })
  const requested: Candidate[] = []
  const assessor: Assessor = { request: (candidate) => { requested.push(candidate) }, release: vi.fn() }
  /** Engine 发出的领域事件(时间序)。 */
  const emitted: DomainEvent[] = []
  const executorHost: ExecutorHost = {
    context: ctx,
    get engine() { return engine },
    store, effects, health: board.claim('worker'), lifetime: lifetime.signal, sessions,
    closing: () => lifetime.signal.aborted,
    paused: () => store.settings().paused,
  }
  const executor = new DshExecutor(executorHost)
  executor.install()
  const engine = new Engine({
    repo: store,
    policy: () => settingsPolicy(store.settings(), scope),
    realmOf: () => REALM,
    scope,
    assessor,
    executor,
    outbox,
    prepareTicket: (ticket, outcome) => executor.prepare(ticket, outcome),
    emit: (event) => { emitted.push(event) },
  })
  makeAgent(MAIN)
  effects.start()

  /** 某个 session 的模型走了下一步:领取自上次以来 steer 进来的消息。 */
  const step = (sessionId: string): void => { steps.get(sessionId)?.() }
  /** 某个 session 的一步领取等待中的消息、却在纳入前被截断。 */
  const claim = (sessionId: string): void => { claims.get(sessionId)?.() }
  /** 某 session 的回合结束,DSH 如是说(idle 事件)。 */
  const idle = (sessionId: string): void => { becomeIdle(sessionId) }
  /** worker 的最后一段话(assistant 文本)——经 session 事件进入 `said` 跟踪。 */
  const say = (sessionId: string, text: string): void => {
    const agent = agents.get(sessionId)
    if (!agent) return
    ctx.emit('session/event', agent.session as never,
      { type: 'assistant/message', data: { turn, step: 0, message: { role: 'assistant', content: [{ type: 'text', text }] } } } as never)
  }
  /** 等待效果队列静止:没有在跑的、也没有能开始的。 */
  const settle = (): Promise<void> => effects.idle()
  /** 以标准四要素接受一条 trigger 的 decision,返回其工单与 worker session id。 */
  const accept = async (trigger: Trigger, overrides: Record<string, unknown> = {}) => {
    engine.receive(trigger)
    engine.evaluateDue()
    const candidate = requested.at(-1)
    if (!candidate) throw new Error('没有候选被请求')
    engine.candidateDelivered(candidate.evalId)
    const primary = candidate.triggers[0]
    if (!primary) throw new Error('候选没有 trigger')
    const decision = engine.decide(primary.id, {
      kind: 'accept',
      title: `Fix ${trigger.id}`,
      scope: 'Do the work described by the request.',
      reason: 'explicit request',
      delegation: {
        objective: 'Fix the reported regression.',
        outputFormat: 'A patch plus a summary.',
        toolGuidance: 'Use the read/edit/bash tools in the ticket workspace.',
        taskBoundaries: 'Only the reported defect; no refactors.',
      },
      ...overrides,
    })
    await settle()
    const ticketId = decision.ticketId
    if (!ticketId) throw new Error('accept 未开出工单')
    return { trigger, decision, ticket: store.tickets.get(ticketId)!, sessionId: workerSessionId(ticketId) }
  }
  async function stop(): Promise<void> {
    await executor.shutdown()
    await effects.drain()
    executor.dispose()
    sessions.dispose()
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
  return {
    REALM, MAIN, ctx, directory, agents, controller: registry, deliveries, requested, emitted, jobs, subagents, channels,
    store, effects, board, engine, executor, sessions, lifetime, outbox,
    /** 宿主 session 服务面假件(A22 真实 seam;plugin-boot 接线用例与 session 断言用)。 */
    sessionController, workspaceRegistry, permissionPresets, sessionPersistence, sessionPorts,
    /** session 面断言面:工作区登记/标题/权限 preset/选用的 agent preset/持久史。 */
    workspaces, renamed, permissionPresetBySession, selectedPresets, persisted,
    /** 角色模型面(46 号):播种落点与可变的 roleModel 注入值。 */
    modelSelections, roleModels,
    step, claim, idle, say, settle, accept, stop,
    /** 手动排一次 pass(Engine 时钟)。 */
    pass: (): void => { engine.evaluateDue() },
  }
}
export type Host = Awaited<ReturnType<typeof startHost>>
