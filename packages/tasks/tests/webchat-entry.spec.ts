/**
 * webchat 委派入口门禁(35-A21 诊断施工清单①/④;34 §4-F channel-adapter 门禁的会话面
 * 补全;35-A21 目标行为:用户在 web 聊天会话里发一条委派消息 → 该消息成为 Trigger
 * (explicit,发送者=会话主人)→ Eval 评估 → accept 出票 → worker session 接手)。
 *
 * 本文件断言三面(诊断清单④「Trigger 归一化 + 工具可见性 + 入口链路」;工具可见性半边
 * 在 tests/tools.spec.ts 的装配面用例):
 * - 归一化(normalizeWebchatTrigger 纯函数,webchat.ts):幂等 id = 会话id+消息id、
 *   human=true、addressed='direct'、主线程=会话、channel/meta 逐字段(诊断清单①原文);
 * - 入口链路(defineTasksPlugin 真实装配 + 模拟宿主 session 服务束,plugin-boot A22 用例
 *   同构):emit 主会话 `session/event` 的用户消息(kind 'user')→ Trigger stored → pass
 *   → Eval 候选 → accept(R3 四要素)→ worker session(`worker-<ticketId>`)建立;
 * - 分面与幂等:同一消息重放 duplicate 收敛;非主会话、本包自投(kind 'eterna-tasks')、
 *   无文本消息不产 Trigger;主会话 id 缺席不接线(fail-safe,不猜主会话);
 *   sessionOwner 端口缺席时主人 = 本栈绑定的 realm(账号);入口异常经健康项上报、
 *   不外溢宿主事件总线。
 */
import { Context } from '@deepseek-ai/cordis'
import { freezeMessage, MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { key } from '../src/core/index.ts'
import type { SourceScope, ScopeResult, Trigger } from '../src/core/index.ts'
import type { SessionHostPorts } from '../src/session/sessions.ts'
import { workerSessionId } from '../src/executor/dsh.ts'
import { WEBSCHAT_SOURCE, normalizeWebchatTrigger, WebchatDelegationEntry } from '../src/sources/webchat.ts'
import { defineTasksPlugin, TASKS_PLUGIN_NAME } from '../src/plugin.ts'
import type { TasksRuntime } from '../src/plugin.ts'

const OWNER = 'u-alice'
const MASTER = 'orchestrator-main'
let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'tasks-webchat-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

/** webchat 源的监听范围(装配注入面;非 webchat 一律不监听——intake filtered 落库)。 */
const webchatScope: SourceScope = {
  scope: ({ source }): ScopeResult => source === WEBSCHAT_SOURCE
    ? { listened: true, observed: false, row: 'master' }
    : { listened: false, reason: 'not_listened' },
}

/** 一条主会话用户消息(session/event `user/message` 载荷;kind 'user' 即用户亲口消息)。 */
const userMessage = (id: string, text: string, kind = 'user'): unknown =>
  freezeMessage({ id: MessageId(id), role: 'user', content: [{ type: 'text', text }], source: { kind } } as never)

/** 在宿主 ctx 上发一条会话用户消息(emit 形态与 fixtures/host.ts 同构;真身事件另带 seq/time)。 */
const emitUserMessage = (ctx: Context, sessionId: string, messageId: string, text: string, kind = 'user',
  time = 1_760_000_000_000): void => {
  ctx.emit('session/event', { id: sessionId } as never,
    { type: 'user/message', time, data: userMessage(messageId, text, kind) } as never)
}

/** 假 agent(本文件的投递/回合模拟面;status 可变以驱动「主会话忙」场景)。 */
interface FakeAgent {
  id: string
  status: 'idle' | 'running'
  session: { id: string }
  inbox: { nextTurn: unknown[]; nextStep: unknown[]; remove(id: string): boolean }
  followup: (message: unknown) => void
  steer: (message: unknown) => void
  inject: (message: unknown) => void
  cancel: (cause: unknown, options?: { keepInbox?: boolean }) => void
  whenIdle: () => Promise<void>
}

/** 假宿主句柄:ports 给插件,agents/claimNextTurn 给测试驱动回合。 */
interface FakeSessionHostHandle {
  readonly ports: SessionHostPorts
  readonly agents: Map<string, FakeAgent>
  /** 下一回合领取 next-turn 的第一条(emit agent/inbox/claimed + session/event)。 */
  readonly claimNextTurn: (sessionId: string) => void
}

/** 模拟宿主 session 服务束(plugin-boot fakeSessionHost 的紧凑版:ensure/launch 消费面)。 */
function fakeSessionHost(ctx: Context): FakeSessionHostHandle {
  const agents = new Map<string, FakeAgent>()
  let workspaceSeq = 0
  const workspaces = new Map<string, string>()
  const claimNextTurn = (sessionId: string): void => {
    const agent = agents.get(sessionId)
    const message = agent?.inbox.nextTurn.shift()
    if (agent === undefined || message === undefined) return
    ctx.emit('agent/inbox/claimed', { agent, message } as never)
    ctx.emit('session/event', agent.session as never, { type: 'user/message', data: message } as never)
  }
  const makeAgent = (id: string): FakeAgent => {
    const agent: FakeAgent = {
      id, status: 'idle', session: { id }, inbox: { nextTurn: [], nextStep: [], remove: (): boolean => false },
      followup: (): void => {}, steer: (): void => {}, inject: (): void => {},
      cancel: (): void => {}, whenIdle: (): Promise<void> => Promise.resolve(),
    }
    const deliver = (mode: 'queue' | 'steer') => (message: unknown): void => {
      ;(mode === 'queue' ? agent.inbox.nextTurn : agent.inbox.nextStep).push(message)
      // 空闲 agent:投递唤醒回合、消息立即被 claim(DSH 语义);忙碌:等下一回合再 claim。
      if (agent.status !== 'idle') return
      agent.status = 'running'
      ctx.emit('agent/status', { agent, status: 'running' } as never)
      const pending = mode === 'queue' ? agent.inbox.nextTurn.shift() : agent.inbox.nextStep.shift()
      if (pending === undefined) return
      ctx.emit('agent/inbox/claimed', { agent, message: pending } as never)
      ctx.emit('session/event', agent.session as never, { type: 'user/message', data: pending } as never)
    }
    agent.followup = deliver('queue')
    agent.steer = deliver('steer')
    return agent
  }
  const ports: SessionHostPorts = {
    controller: {
      resolveAgent: vi.fn(async (sessionId: SessionId) => {
        const agent = agents.get(String(sessionId))
        return agent ? { agent: agent as never } : { error: Object.assign(new Error(`session ${String(sessionId)} not found`), { code: 'session/not-found' }) }
      }),
      create: vi.fn(async (request: { sessionId?: SessionId; workspaceId?: string }) => {
        const id = String(request.sessionId)
        if (agents.has(id)) throw new Error(`session ${id} already exists`)
        agents.set(id, makeAgent(id))
        return { sessionId: SessionId(id) }
      }),
      rename: vi.fn(async (request: { sessionId: SessionId; title: string }) => ({ title: request.title })),
    },
    workspaces: {
      create: vi.fn(async (path: string, title?: string) => {
        const id = `ws-${++workspaceSeq}`
        workspaces.set(id, path)
        return { id, path, title: title ?? path }
      }),
    },
    permissions: { set: vi.fn((_session: { id: string }, _name: string): void => {}) },
    persistence: {
      flush: vi.fn(async (): Promise<void> => {}),
      open: vi.fn(async () => ({
        read: vi.fn(async (): Promise<{ events: readonly unknown[] }> => ({ events: [] })),
        close: vi.fn(async (): Promise<void> => {}),
      })),
    },
  }
  // agents 注册表(Sessions.prompt 的投递目标活性检查与 executor 的注册表面消费同一批对象)。
  ctx.reflect.provide('agents', {
    get: (id: string | SessionId): unknown => agents.get(String(id)),
    list: (): unknown[] => [...agents.values()],
  })
  return { ports, agents, claimNextTurn }
}

/** 装配 webchat 入口的插件(真实 defineTasksPlugin 路径;临时租户根 + 长 pass 周期手动驱动)。 */
function bootWebchat(overrides: {
  masterId?: string
  /** true(缺省)= 注入 glue 同构的会话主人端口(OWNER);false = 端口缺席(缺省主人=realm)。 */
  ownerPort?: boolean
  sessionOwner?: ((sessionId: string) => { source: string; id: string } | undefined) | undefined
  roster?: Array<{ id: string; name?: string }>
  /** 引擎/effect 时钟(ms;测试控制 deadline,不依赖真实时间)。 */
  now?: () => number
  /**
   * true = 不注入显式 masterId,由插件按约定派生 `orchestrator-<realm>` 并 ensure 主会话
   * (「忙碌主会话排队」回归需要真实主会话面;缺省仍钉 MASTER,其余用例零漂移)。
   */
  conventionMaster?: boolean
} = {}): {
  ctx: Context
  runtime: TasksRuntime
  dispose: () => void
  agents: Map<string, FakeAgent>
  claimNextTurn: (sessionId: string) => void
} {
  const ctx = new Context()
  const fake = fakeSessionHost(ctx)
  const ports = fake.ports
  const roster = overrides.roster ?? [{ id: OWNER, name: 'Alice' }]
  // 主人端口:ownerPort=false 即不注入(走「缺省主人=realm」路径);否则注入 glue 同构端口。
  const sessionOwner = (overrides.ownerPort ?? true)
    ? (overrides.sessionOwner ?? ((_sessionId: string) => ({ source: WEBSCHAT_SOURCE, id: OWNER })))
    : overrides.sessionOwner
  const plugin = defineTasksPlugin({
    tenantRoot: root,
    realm: 'alice',
    passIntervalMs: 3_600_000,
    scope: webchatScope,
    ...(overrides.masterId !== undefined ? { masterId: overrides.masterId } : {}),
    ...(sessionOwner !== undefined ? { sessionOwner } : {}),
    ...(overrides.now !== undefined ? { now: overrides.now } : {}),
    // conventionMaster=true 时省略显式 masterId:插件按约定派生并 ensure 主会话。
    sessionHost: {
      context: ctx,
      ...(overrides.conventionMaster === true ? {} : { masterId: overrides.masterId ?? MASTER }),
      ports,
    },
  })
  const dispose = plugin.apply(ctx)
  const runtime = ctx.tasks as TasksRuntime
  // realm 内名单:主人 id 进 webchat 源的 allowed(gate 名单 × direct → explicit 的依据)。
  runtime.store.saveSettings({ policy: { sources: { [WEBSCHAT_SOURCE]: { allowed: roster } } } })
  return { ctx, runtime, dispose, agents: fake.agents, claimNextTurn: fake.claimNextTurn }
}

/** R3 委派四要素(accept 必填;engine.decide 硬约束,35 号 A7)。 */
const DELEGATION = { objective: '为主题层补上深色模式', outputFormat: '代码改动与说明',
  toolGuidance: '仓库内读取与编辑', taskBoundaries: '不改业务逻辑与依赖' }

it('归一化纯函数:幂等 id=会话id+消息id,human/addressed/主线程/channel/meta 逐字段(诊断清单①)', () => {
  const actor = { source: WEBSCHAT_SOURCE, id: OWNER }
  const trigger = normalizeWebchatTrigger({ sessionId: MASTER, messageId: 'm-1', text: '请修复登录回归',
    at: '2026-10-10T08:00:00.000Z', actor })
  // 幂等 id 以稳定内容派生(会话 id + 消息 id;诊断清单①原文「幂等 id=会话id+消息id」)。
  expect(trigger.id).toBe(key('tasks/webchat-trigger', MASTER, 'm-1'))
  // 人写的、对 agent 直接说话(私聊位;gate 名单内 direct → explicit 的依据)。
  expect(trigger.human).toBe(true)
  expect(trigger.addressed).toBe('direct')
  // 主线程 = 会话本身(后续消息与工单订阅落同一线程,Eval 按线程批处理)。
  expect(trigger.threads).toEqual([{ source: WEBSCHAT_SOURCE, id: MASTER }])
  expect(trigger.source).toBe(WEBSCHAT_SOURCE)
  expect(trigger.actor).toEqual(actor)
  // 只写地址指向原会话(回执投回会话的接线位)与 Source 原生 meta。
  expect(trigger.channel).toEqual({ source: WEBSCHAT_SOURCE, thread: `${WEBSCHAT_SOURCE}:${MASTER}`, address: { messageId: 'm-1' } })
  expect(trigger.meta).toEqual({ sessionId: MASTER, messageId: 'm-1' })
  // 相等输入恒产相等 id(重放/重投的到达时刻不同也不参与派生)。
  const replay = normalizeWebchatTrigger({ sessionId: MASTER, messageId: 'm-1', text: '请修复登录回归',
    at: '2026-10-10T09:30:00.000Z', actor })
  expect(replay.id).toBe(trigger.id)
  // 消息 id 不同不得碰撞(另一条消息 = 新事件)。
  const other = normalizeWebchatTrigger({ sessionId: MASTER, messageId: 'm-2', text: '换一件事',
    at: '2026-10-10T08:00:00.000Z', actor })
  expect(other.id).not.toBe(trigger.id)
})

it('入口链路:主会话用户消息 → Trigger stored → Eval 候选 → accept 出票 → worker session 接手', async () => {
  const { ctx, runtime, dispose } = bootWebchat()
  try {
    // 入口已接线(健康项在册;插件级接线不进装配步,boot 序由 plugin-boot 门禁看护)。
    expect(runtime.health().components.webchat).toMatchObject({ state: 'ready' })
    emitUserMessage(ctx, MASTER, 'm-1', '请把深色模式补上,只改主题层')
    // 入口 onStored 即排一轮 pass:候选已就绪(显式请求,不经周期等待)。
    const triggerId = key('tasks/webchat-trigger', MASTER, 'm-1')
    const candidate = runtime.engine.candidate(triggerId)
    expect(candidate).toBeDefined()
    expect(candidate!.strength).toBe('explicit')
    // 发送者=会话主人(注入的 sessionOwner 端口);Trigger 逐字段落库。
    expect(runtime.store.triggers.get(triggerId)).toMatchObject({ source: WEBSCHAT_SOURCE, human: true,
      addressed: 'direct', actor: { source: WEBSCHAT_SOURCE, id: OWNER }, text: '请把深色模式补上,只改主题层' })
    // accept 出票(R3 四要素;评估面交付后由主会话角色裁决——plugin-boot A22 用例同构)。
    runtime.engine.candidateDelivered(candidate!.evalId)
    const decision = runtime.engine.decide(candidate!.triggers[0]!.id, {
      kind: 'accept', title: '补上深色模式', scope: 'Do the work described by the request.', reason: 'explicit request',
      acknowledgement: '好的,这就安排补深色模式。', delegation: DELEGATION,
    })
    expect(decision.kind).toBe('accept')
    expect(decision.ticketId).toBeDefined()
    // worker session 接手:`worker-<ticketId>` 会话经真实宿主 seam 建立,assignment 启动。
    await runtime.effects.idle()
    const ticket = runtime.store.tickets.get(decision.ticketId!)
    expect(ticket?.assignments.at(-1)?.state).toBe('running')
    // ★派发渠道纪律(2026-11-23 线上修复):工单**不**订阅主会话线程——webchat 线程就是主会话
    // 本身,若订阅,人在同一窗口里发的下一条新话题会先扇出成本单的 Input、被 followupOwners
    // 判归本单,候选卡不生成(生产实证:第二张单的调研请求成为第一张单的 handback)。
    // 此前的断言是「工单订阅了发起会话的线程」——正是被推翻的旧语义。
    expect(runtime.store.threads.get(`${WEBSCHAT_SOURCE}:${MASTER}`)?.subscriptions).toEqual([])
    // 订阅计数同样不把派发渠道线程算进去(工作台「N 订阅」读 stats().threads.subscribed):
    // 存量库里旧版 accept 写下的订阅已不再扇出,计数若含它就是显示失效订阅为活跃。
    expect(runtime.stats().threads.subscribed).toBe(0)
    // 反向护栏:普通话题线程上的订阅照常计数(排除逻辑只认派发渠道这一个线程键)。
    runtime.store.threads.save({
      key: `${WEBSCHAT_SOURCE}:topic-1`,
      ref: { source: WEBSCHAT_SOURCE, id: 'topic-1' },
      createdAt: new Date().toISOString(),
      subscriptions: [decision.ticketId!],
      correlated: [], pending: [], meta: {},
    })
    expect(runtime.stats().threads.subscribed).toBe(1)
  } finally { dispose() }
})

it('幂等收敛与后续消息:同一消息重放得 duplicate;accept 后同线程的新话题仍开候选(派发渠道纪律)', () => {
  const { ctx, runtime, dispose } = bootWebchat()
  try {
    emitUserMessage(ctx, MASTER, 'm-1', '请把深色模式补上')
    const triggerId = key('tasks/webchat-trigger', MASTER, 'm-1')
    expect(runtime.store.triggers.get(triggerId)).toBeDefined()
    // 宿主对同一消息的重复事件(重启回放/监听器重挂)恒得同一 id → duplicate 收敛。
    emitUserMessage(ctx, MASTER, 'm-1', '请把深色模式补上')
    expect(runtime.stats().triggers.total).toBe(1)
    const candidate = runtime.engine.candidate(triggerId)
    runtime.engine.candidateDelivered(candidate!.evalId)
    const decision = runtime.engine.decide(triggerId, {
      kind: 'accept', title: '补上深色模式', scope: 'Do the work described by the request.', reason: 'explicit request',
      acknowledgement: '好的,这就安排。', delegation: DELEGATION,
    })
    runtime.pass()
    const firstTicket = decision.ticketId!
    // ★派发渠道纪律(2026-11-23 线上修复):主会话线程上的下一条消息**不是**这张单的后续——
    // 它是新话题,照常落库并开自己的候选卡,由主会话按 dispatch 纪律 accept/attach/ignore。
    // 修复前(工单订阅主会话线程)这条会被扇出成旧单的 Input、followupOwners 判归旧单,
    // 候选不生成——正是「同一窗口发不同任务被绑到上一个工单」的生产缺陷。
    emitUserMessage(ctx, MASTER, 'm-2', '换一件事:调研一下 PDF 阅读器的方案')
    runtime.pass()
    const second = runtime.engine.candidate(key('tasks/webchat-trigger', MASTER, 'm-2'))
    expect(second).toBeDefined()
    expect(second!.strength).toBe('explicit')
    // 没被旧单吞掉:旧单没收到这条 Input,候选卡还能看到本窗口已有的工单(related_tickets 兜底)。
    expect(runtime.store.tickets.get(firstTicket)?.undelivered).toEqual([])
    expect(second!.tickets.map(ticket => ticket.id)).toEqual([firstTicket])
  } finally { dispose() }
})

it('分面过滤:非主会话消息、本包自投消息(eterna-tasks)、无文本消息都不产 Trigger', () => {
  const { ctx, runtime, dispose } = bootWebchat()
  try {
    // 非主会话的 web 聊天会话:不在白名单,不产委派 Trigger。
    emitUserMessage(ctx, 'someone-else-session', 'm-x', '这不归任务内核管')
    // 本包自投的消息(Sessions.prompt 的 'eterna-tasks' 源):不是用户亲口。
    emitUserMessage(ctx, MASTER, 'm-self', 'worker report relay', 'eterna-tasks')
    // 无文本(纯附件)消息:没有可评估的委派文本,跳过。
    ctx.emit('session/event', { id: MASTER } as never,
      { type: 'user/message', time: 1_760_000_000_000, data: freezeMessage({ id: MessageId('m-blank'), role: 'user',
        content: [{ type: 'image', mime: 'image/png', data: '' } as never], source: { kind: 'user' } } as never) } as never)
    expect(runtime.stats().triggers.total).toBe(0)
    // 主会话的正常消息仍接线(过滤不误伤)。
    emitUserMessage(ctx, MASTER, 'm-ok', '在吗')
    expect(runtime.stats().triggers.total).toBe(1)
  } finally { dispose() }
})

it('主会话 id 缺席不接线(fail-safe 不猜主会话)', () => {
  // 裸插件(无 sessionHost、无 masterId、KV 空):不接线,emit 不产 Trigger,健康项无 webchat 条目。
  const bareCtx = new Context()
  const barePlugin = defineTasksPlugin({ tenantRoot: root, realm: 'alice', passIntervalMs: 3_600_000, scope: webchatScope })
  const bareDispose = barePlugin.apply(bareCtx)
  try {
    emitUserMessage(bareCtx, MASTER, 'm-1', '请修复登录回归')
    const tasks = bareCtx.tasks as TasksRuntime
    expect(tasks.masterId).toBeUndefined()
    expect(tasks.stats().triggers.total).toBe(0)
    expect(tasks.health().components.webchat).toBeUndefined()
  } finally { bareDispose() }
})

it('masterId 自 KV 复得即安装监听(三断点①②:profile 裸挂载行的二次启动也接线)', () => {
  // 第一次装配以 config 显式注入落 KV(master 会话引导的持久半边);第二次装配不再带任何
  // masterId 配置、也无 sessionHost —— 引导解析自 KV 复得,webchat 入口按 runtime.masterId
  // 安装,emit 主会话用户消息即入引擎(出票链路的第一环打通)。
  const seed = defineTasksPlugin({ tenantRoot: root, realm: 'alice', passIntervalMs: 3_600_000, masterId: MASTER })
  seed.apply(new Context())()
  const ctx = new Context()
  const plugin = defineTasksPlugin({ tenantRoot: root, realm: 'alice', passIntervalMs: 3_600_000 })
  const dispose = plugin.apply(ctx)
  try {
    const runtime = ctx.tasks as TasksRuntime
    expect(runtime.masterId).toBe(MASTER)
    expect(runtime.health().masterId).toBe(MASTER)
    expect(runtime.stats().masterId).toBe(MASTER)
    expect(runtime.health().components.webchat).toMatchObject({ state: 'ready' })
    runtime.store.saveSettings({ policy: { sources: { [WEBSCHAT_SOURCE]: { allowed: [{ id: 'alice', name: '部署账号' }] } } } })
    emitUserMessage(ctx, MASTER, 'm-1', '请把深色模式补上')
    const triggerId = key('tasks/webchat-trigger', MASTER, 'm-1')
    expect(runtime.store.triggers.get(triggerId)).toBeDefined()
    // 缺省 scope(webchatMasterScope)对主会话 listened → 进 Eval;名单内 direct → explicit。
    expect(runtime.engine.candidate(triggerId)?.strength).toBe('explicit')
    // 非主会话的用户消息仍不产 Trigger(入口白名单)。
    emitUserMessage(ctx, 'someone-else', 'm-2', '这不归任务内核管')
    expect(runtime.stats().triggers.total).toBe(1)
  } finally { dispose() }
})

it('sessionOwner 端口缺席:主人 = 本栈绑定的 realm(单 realm 一账号栈,名单内 direct 仍 explicit)', () => {
  // ownerPort=false:端口不注入,缺省主人=部署账号(realm id);名单里放 realm id 仍可准入。
  const { ctx, runtime, dispose } = bootWebchat({ ownerPort: false, roster: [{ id: 'alice', name: '部署账号' }] })
  try {
    emitUserMessage(ctx, MASTER, 'm-1', '请修复登录回归')
    const stored = runtime.store.triggers.get(key('tasks/webchat-trigger', MASTER, 'm-1'))
    expect(stored?.actor).toEqual({ source: WEBSCHAT_SOURCE, id: 'alice' })
    // 候选照常排队(名单内 direct → explicit)。
    expect(runtime.engine.candidate(key('tasks/webchat-trigger', MASTER, 'm-1'))).toBeDefined()
  } finally { dispose() }
})

it('入口类可独立装配(无插件宿主):install 订阅/退订、actorOf 缺席 fail-closed、异常经 onError 上报不外溢', () => {
  const ctx = new Context()
  const received: string[] = []
  const entry = new WebchatDelegationEntry({
    masterId: MASTER,
    engine: { receive: (trigger: Trigger): 'stored' => { received.push(trigger.id); return 'stored' } },
    actorOf: (sessionId: string) => sessionId === MASTER ? { source: WEBSCHAT_SOURCE, id: OWNER } : undefined,
    now: () => 1_760_000_000_000,
  })
  const disposeEntry = entry.install(ctx)
  emitUserMessage(ctx, MASTER, 'm-1', '请修复登录回归')
  expect(received).toEqual([key('tasks/webchat-trigger', MASTER, 'm-1')])
  // 主人解析失败(undefined)= fail-closed 跳过,不带无主 Trigger 进引擎;非主会话同此。
  emitUserMessage(ctx, 'other-session', 'm-2', '别人的会话')
  expect(received).toHaveLength(1)
  // 退订后不再接收;dispose 幂等。
  disposeEntry()
  entry.dispose()
  emitUserMessage(ctx, MASTER, 'm-3', '退订后的消息')
  expect(received).toHaveLength(1)
  // 引擎抛错不外溢宿主事件总线(onError 回调收到,emit 侧不炸)。
  const failures: unknown[] = []
  const failing = new WebchatDelegationEntry({
    masterId: MASTER,
    engine: { receive: (): 'stored' => { throw new Error('boom') } },
    actorOf: () => ({ source: WEBSCHAT_SOURCE, id: OWNER }),
    onError: (error: unknown) => { failures.push(error) },
  })
  const disposeFailing = failing.install(ctx)
  expect(() => { emitUserMessage(ctx, MASTER, 'm-4', '会炸的消息') }).not.toThrow()
  expect(String(failures[0])).toContain('boom')
  disposeFailing()
})

it('插件名与入口 Source 常量面(回归看护)', () => {
  expect(TASKS_PLUGIN_NAME).toBe('eterna-tasks')
  expect(WEBSCHAT_SOURCE).toBe('webchat')
  expect(workerSessionId('t1')).toBe('worker-t1')
})

it('忙碌主会话:候选卡只排一张,排队期间不消耗评估超时(重复候选卡回归)', async () => {
  let nowMs = Date.parse('2026-11-19T09:36:24.503Z')
  // 约定派生主会话(不钉显式 masterId):走插件真实引导 ensure,主会话面才存在。
  const booted = bootWebchat({ now: () => nowMs, conventionMaster: true })
  const { ctx, runtime, dispose } = booted
  const masterId = runtime.masterId!
  try {
    // 等装配的引导 ensure 建好主会话(宿主 create 是异步 fire-and-forget)。
    await vi.waitFor(() => { expect(booted.agents.has(masterId)).toBe(true) })
    const master = booted.agents.get(masterId)!
    // 主会话正在长回合:followup 只入 next-turn,不 claim(候选卡在排队区等)。
    master.status = 'running'
    emitUserMessage(ctx, masterId, 'm-busy', '帮我调研本产品所有插件的作用')
    const triggerId = key('tasks/webchat-trigger', masterId, 'm-busy')
    const evalId = runtime.engine.candidate(triggerId)!.evalId
    const threadKeyValue = `${WEBSCHAT_SOURCE}:${masterId}`
    await vi.waitFor(() => { expect(master.inbox.nextTurn).toHaveLength(1) })
    // 只入 inbox:排队时间不算送达,评估不该起 deadline。
    expect(runtime.store.threads.get(threadKeyValue)?.evaluating).toMatchObject({ id: evalId })
    expect(runtime.store.threads.get(threadKeyValue)?.evaluating?.delivered).toBeUndefined()
    // 推进 10 分钟并驱动 pass:排队中的卡不超时、不重排、不重投(修复前每 120s 一张)。
    nowMs += 10 * 60_000
    runtime.pass()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(runtime.engine.candidate(triggerId)?.evalId).toBe(evalId)
    expect(master.inbox.nextTurn).toHaveLength(1)
    expect(runtime.store.threads.get(threadKeyValue)?.evaluating?.delivered).toBeUndefined()
    // 主会话下一回合收走卡(claim):deadline 此刻才起算,assessment effect 落定。
    booted.claimNextTurn(masterId)
    await runtime.effects.idle('assessment')
    expect(master.inbox.nextTurn).toHaveLength(0)
    const evaluating = runtime.store.threads.get(threadKeyValue)?.evaluating
    // 投递定稿时刻=claim 之后(引擎时钟为真实时钟:断言关系而非注入值)。
    expect(evaluating?.delivered).toBeTruthy()
    expect(evaluating?.deadline).toBe(new Date(Date.parse(evaluating!.delivered!) + 120_000).toISOString())
  } finally { dispose() }
})
