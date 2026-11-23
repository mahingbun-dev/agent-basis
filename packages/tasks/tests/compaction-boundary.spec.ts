/**
 * 工单边界压缩钩子用例(53 号 §3-D3/§4-P3 具名单测「busy 跳过不重试风暴 / fail-open 不阻断
 * 工单流」;PassDriver 单测同款「导出仅为其单测面」纪律,tests/pass.spec.ts 先例)。
 *
 * 三条判据面(53 号 §4-P3):
 * - busy 静默跳过:compactNow 抛 code='busy'(宿主 idle 闸:非 idle 或有在途投递)→ debug
 *   日志静默跳过,每事件恰一次尝试,无重试风暴(下一工单边界再试);
 * - compaction 服务缺席不接线:compactionFromContext 结构校验(只认有 compactNow 方法的对象)
 *   + createTasks 装配面(端口缺席 → 同链路全绿,无压缩尝试);
 * - idle 才触发:agent 可解析且 compactNow 成功(模拟 idle 主会话)→ 恰一次触发,参数为
 *   解析出的主会话 agent 与装配关停信号。
 *
 * fail-open 不阻断工单流的集成面:createTasks 真装配(模拟宿主 fixture,plugin-boot.spec
 * 的 fakeSessionHost 同构紧凑版)+ 真实引擎链路(accept→launch→stopTicket)——busy 被吞掉
 * 的同时两张工单终态照常落定。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { BoundaryCompaction, compactionFromAgent, compactionFromContext, createTasks, type TasksOptions } from '../src/plugin.ts'
import type { SessionHostPorts } from '../src/session/sessions.ts'
import { MEMBER, SOURCE, humanTrigger } from './fixtures/host.ts'
import type { DomainEvent, ScopeResult, SourceScope } from '../src/core/index.ts'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'tasks-compaction-boundary-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

/** 测试范围内的主会话 agent 假件(结构最小面:钩子只透传,不消费其成员)。 */
const fakeAgent = (id = 'orchestrator-main'): Agent => ({ id, session: { id } } as unknown as Agent)

/** dsh-compaction ManualCompactionError('busy') 的同形错误(判别恒按 code,不 instanceof)。 */
const busyError = (): Error & { readonly code: string } =>
  Object.assign(new Error('manual compaction requires an idle agent with no waking queued work'), { code: 'busy' })

/** ticket.ended 领域事件假件(载荷形状见 core/ports.ts DomainEvents)。 */
const endedEvent = (ticketId: string): DomainEvent =>
  ({ type: 'ticket.ended', at: '2026-11-23T00:00:00.000Z', data: { ticketId, realm: 'alice', by: 'human', outcome: 'stopped' } } as unknown as DomainEvent)

/** 其余领域事件假件(事件过滤面:非 ticket.ended 零开销直返)。 */
const otherEvent = (): DomainEvent =>
  ({ type: 'ticket.created', at: '2026-11-23T00:00:00.000Z', data: { ticketId: 't1', decisionId: 'd1', strength: 'explicit' } } as unknown as DomainEvent)

// ── compactionFromContext:ctx.compaction 的结构子集派生(53 号 §3-D3「只认有 compactNow
// 方法的对象」;sessionHostFromContext 双路反射惯例)───────────────────────────────────

it('compactionFromContext:服务在场且带 compactNow 方法 → 结构端口派生成功', async () => {
  const ctx = new Context()
  const compactNow = vi.fn(async (): Promise<unknown> => null)
  ctx.reflect.provide('compaction', { compactNow })
  const derived = compactionFromContext(ctx)
  expect(derived).toBeDefined()
  // 派生端口直通原服务方法(调用透传断言,兼避 unbound-method 直接引用)。
  await derived?.compactNow(fakeAgent(), new AbortController().signal)
  expect(compactNow).toHaveBeenCalledTimes(1)
})

it('compactionFromContext:服务缺席(裸 ctx,压缩组未挂载常态)→ undefined,fail-open 不接线', () => {
  expect(compactionFromContext(new Context())).toBeUndefined()
})

it('compactionFromContext:服务在但缺 compactNow 方法(旧宿主/结构漂移)→ undefined,不猜不造桩', () => {
  const ctx = new Context()
  ctx.reflect.provide('compaction', { compact: (): void => {} })
  expect(compactionFromContext(ctx)).toBeUndefined()
})

// ── compactionFromAgent + 每触发现读(F3 复审修复):boot 一次性解析钉死实例的两处隐患——
// ①ctx.compaction 晚于 tasks boot 挂载 → D3 永久静默;②boot 解析到宿主树 standard 默认参
// 实例 → orchestrator preset 特化参数(0.7/true,isolate.compaction 会话组)对 D3 不生效。
// 修复后派生路径每触发现读:agent 作用域(会话特化实例所在)优先,宿主 ctx 兜底,缺席 debug 跳过。

it('compactionFromAgent:agent 作用域带压缩服务 → 派生成功且直通;无 ctx 的假 agent → undefined', async () => {
  const compactNow = vi.fn(async (): Promise<unknown> => null)
  const scope = new Context()
  scope.reflect.provide('compaction', { compactNow })
  const agent = { id: 'orchestrator-main', session: { id: 'orchestrator-main' }, ctx: scope } as unknown as Agent
  const derived = compactionFromAgent(agent)
  expect(derived).toBeDefined()
  await derived?.compactNow(agent, new AbortController().signal)
  expect(compactNow).toHaveBeenCalledTimes(1)
  // 裸假件(无 ctx 字段,compaction-boundary 原假件形态)→ undefined,不猜。
  expect(compactionFromAgent(fakeAgent())).toBeUndefined()
})

it('compactionFromAgent:agent 作用域服务结构残缺(缺 compactNow)→ undefined(落宿主 ctx 兜底由调用方组合)', () => {
  const scope = new Context()
  scope.reflect.provide('compaction', { compact: (): void => {} })
  const agent = { id: 'orchestrator-main', session: { id: 'orchestrator-main' }, ctx: scope } as unknown as Agent
  expect(compactionFromAgent(agent)).toBeUndefined()
})

it('派生现读面(F3 修复①):压缩服务晚于 boot 挂载——首触发 debug 跳过,服务就绪后下一边界自愈', async () => {
  // 每触发现读的组合面仿生产 bootTasks 派生(compactionFromAgent ?? compactionFromContext):
  // state.seam 即「当下读到的端口」——boot 时缺席(undefined),压缩组挂载后有值。
  const state: { seam?: { compactNow: (agent: Agent, signal: AbortSignal) => Promise<unknown> } } = {}
  const calls: Agent[] = []
  const logs: string[] = []
  const hook = new BoundaryCompaction({
    resolveCompaction: () => {
      const seam = state.seam
      if (seam === undefined) return undefined
      return {
        compactNow: async (agent: Agent, signal: AbortSignal) => {
          calls.push(agent)
          return seam.compactNow(agent, signal)
        },
      }
    },
    resolveAgent: async () => fakeAgent(),
    signal: new AbortController().signal,
    debug: (message) => { logs.push(message) },
  })
  // 第一边界:端口缺席 → debug 可见跳过(修复前:钩子整体不接线,永久静默零日志)。
  await hook.onEvent(endedEvent('t6'))
  expect(calls).toHaveLength(0)
  expect(logs.some(message => message.includes('端口缺席') && message.includes('t6'))).toBe(true)
  // 压缩组随后挂载(preset 组随首会话装载的常态)。
  state.seam = { compactNow: async () => null }
  await hook.onEvent(endedEvent('t7'))
  expect(calls).toHaveLength(1)
})

it('派生现读面(F3 修复②):agent 作用域实例优先于宿主 ctx——orchestrator 特化参数位先取', async () => {
  const hostNow = vi.fn(async (): Promise<unknown> => null)
  const agentNow = vi.fn(async (): Promise<unknown> => null)
  const hostCtx = new Context()
  hostCtx.reflect.provide('compaction', { compactNow: hostNow })
  const scope = new Context()
  scope.reflect.provide('compaction', { compactNow: agentNow })
  const agent = { id: 'orchestrator-main', session: { id: 'orchestrator-main' }, ctx: scope } as unknown as Agent
  const logs: string[] = []
  // 生产 bootTasks 同款组合:agent 作用域优先,宿主 ctx 兜底。
  const hook = new BoundaryCompaction({
    resolveCompaction: resolved => compactionFromAgent(resolved) ?? compactionFromContext(hostCtx),
    resolveAgent: async () => agent,
    signal: new AbortController().signal,
    debug: (message) => { logs.push(message) },
  })
  await hook.onEvent(endedEvent('t8'))
  expect(agentNow).toHaveBeenCalledTimes(1)
  expect(hostNow).not.toHaveBeenCalled()
  expect(logs).toEqual([])
  // 会话作用域未挂压缩组(如非 preset 会话)→ 落宿主 ctx,不空转。
  const plainAgent = fakeAgent()
  const hookFallback = new BoundaryCompaction({
    resolveCompaction: resolved => compactionFromAgent(resolved) ?? compactionFromContext(hostCtx),
    resolveAgent: async () => plainAgent,
    signal: new AbortController().signal,
  })
  await expect(hookFallback.onEvent(endedEvent('t9'))).resolves.toBeUndefined()
  expect(hostNow).toHaveBeenCalledTimes(1)
})

// ── BoundaryCompaction:边界触发语义单测(53 号 §4-P3 三判据)──────────────────────────

it('idle 才触发:agent 可解析且 compactNow 成功 → 恰一次触发,参数为主会话 agent 与装配信号;非 ticket.ended 事件零开销直返', async () => {
  const agent = fakeAgent()
  const signal = new AbortController().signal
  const calls: Array<{ agent: Agent; signal: AbortSignal }> = []
  const logs: string[] = []
  const hook = new BoundaryCompaction({
    compaction: { compactNow: async (resolved, abort) => { calls.push({ agent: resolved, signal: abort }); return null } },
    resolveAgent: async () => agent,
    signal,
    debug: (message) => { logs.push(message) },
  })
  await hook.onEvent(otherEvent())
  expect(calls).toHaveLength(0)
  await hook.onEvent(endedEvent('t1'))
  expect(calls).toHaveLength(1)
  expect(calls[0]?.agent).toBe(agent)
  expect(calls[0]?.signal).toBe(signal)
  // 成功路径不留日志(busy/失败才有 debug 观测)。
  expect(logs).toEqual([])
})

it('busy 静默跳过:compactNow 抛 code=busy → debug 记一条、不外溢;每事件恰一次尝试,无重试风暴', async () => {
  let calls = 0
  const logs: string[] = []
  const hook = new BoundaryCompaction({
    compaction: { compactNow: async () => { calls += 1; throw busyError() } },
    resolveAgent: async () => fakeAgent(),
    signal: new AbortController().signal,
    debug: (message) => { logs.push(message) },
  })
  // 不外溢:trigger 全捕获,resolves 而非 rejects。
  await expect(hook.onEvent(endedEvent('t1'))).resolves.toBeUndefined()
  expect(calls).toBe(1)
  // 观察窗:busy 之后无第二次尝试(绝不重试风暴,下一工单边界才再试)。
  await new Promise((resolve) => { setTimeout(resolve, 20) })
  expect(calls).toBe(1)
  // debug 观测面:忙碌消息带工单 id 与「下一工单边界再试」口径。
  expect(logs).toHaveLength(1)
  expect(logs[0]).toContain('忙碌')
  expect(logs[0]).toContain('t1')
  expect(logs[0]).toContain('下一工单边界再试')
})

it('agent 不可解析或解析失败 → 不发起压缩、debug 记跳过(缺席口径同 busy:静默、不阻断)', async () => {
  const compactNow = vi.fn(async (): Promise<unknown> => null)
  const logs: string[] = []
  const hook = new BoundaryCompaction({
    compaction: { compactNow },
    resolveAgent: async () => undefined,
    signal: new AbortController().signal,
    debug: (message) => { logs.push(message) },
  })
  await hook.onEvent(endedEvent('t2'))
  expect(compactNow).not.toHaveBeenCalled()
  expect(logs.some(message => message.includes('不可解析') && message.includes('t2'))).toBe(true)
  // 解析抛错(宿主错误)同口径。
  const failing = new BoundaryCompaction({
    compaction: { compactNow },
    resolveAgent: async () => { throw new Error('host unavailable') },
    signal: new AbortController().signal,
    debug: (message) => { logs.push(message) },
  })
  await failing.onEvent(endedEvent('t3'))
  expect(compactNow).not.toHaveBeenCalled()
  expect(logs.some(message => message.includes('解析失败') && message.includes('t3'))).toBe(true)
})

it('其余压缩失败同 fail-open 口径:debug 记失败、不外溢、不重试(与 busy 同一次尝试纪律)', async () => {
  let calls = 0
  const logs: string[] = []
  const hook = new BoundaryCompaction({
    compaction: { compactNow: async () => { calls += 1; throw new Error('summary unavailable') } },
    resolveAgent: async () => fakeAgent(),
    signal: new AbortController().signal,
    debug: (message) => { logs.push(message) },
  })
  await expect(hook.onEvent(endedEvent('t4'))).resolves.toBeUndefined()
  await new Promise((resolve) => { setTimeout(resolve, 20) })
  expect(calls).toBe(1)
  expect(logs.some(message => message.includes('边界压缩失败') && message.includes('t4'))).toBe(true)
})

it('debug 观测面缺席(缺省)→ 静默不抛(观测面可缺席,行为不变)', async () => {
  const hook = new BoundaryCompaction({
    compaction: { compactNow: async () => { throw busyError() } },
    resolveAgent: async () => fakeAgent(),
    signal: new AbortController().signal,
  })
  await expect(hook.onEvent(endedEvent('t5'))).resolves.toBeUndefined()
})

// ── createTasks 装配接线(fail-open 集成面;plugin-boot.spec fakeSessionHost 同构紧凑版)──

/** test Source 的监听范围端口(plugin-boot.spec 同款)。 */
const testScope: SourceScope = {
  scope: ({ source }): ScopeResult =>
    source === SOURCE ? { listened: true, observed: true, row: 'main' } : { listened: false, reason: 'not_listened' },
}

/** 仿 RemoteError 的错误面(判别恒按 `code`)。 */
const remoteError = (code: string, message: string): Error & { readonly code: string } => Object.assign(new Error(message), { code })

/**
 * 宿主 session 服务面假件(plugin-boot.spec fakeSessionHost 紧凑版,签名逐项对齐 A0 §5-C11
 * 钉住的 0.2.2-rc.1 面):worker session 经真实 seam 建在租户工作区;`seed` 预置任意 session
 * (边界钩子解析主会话 agent 用——主会话由宿主/glue 建立,装配不 ensure 显式注入的 id)。
 */
/** fakeSessionHost 返回面(句柄:ports + 已建 agent id 记录 + 主会话预置)。 */
interface FakeSessionHostHandle {
  readonly ports: SessionHostPorts
  readonly agentIds: string[]
  readonly seed: (sessionId: string) => Agent
}

function fakeSessionHost(ctx: Context): FakeSessionHostHandle {
  const agentIds: string[] = []
  const agents = new Map<string, unknown>()
  let workspaceSeq = 0
  const makeAgent = (sessionId: string): unknown => ({
    id: sessionId, status: 'idle', session: { id: sessionId },
    inbox: { nextTurn: [], nextStep: [], remove: (): boolean => false },
    followup: vi.fn(), steer: vi.fn(), inject: vi.fn(),
    model: { select: vi.fn() },
    cancel: vi.fn(), whenIdle: (): Promise<void> => Promise.resolve(),
  })
  const seed = (sessionId: string): Agent => {
    const agent = makeAgent(sessionId)
    agents.set(sessionId, agent)
    return agent as Agent
  }
  const ports = {
    controller: {
      resolveAgent: vi.fn(async (sessionId: string | SessionId) => {
        const agent = agents.get(String(sessionId))
        return agent !== undefined ? { agent } : { error: remoteError('session/not-found', `session ${String(sessionId)} not found`) }
      }),
      create: vi.fn(async (request: { sessionId?: unknown; workspaceId?: string; cwd?: string; agentPreset?: string }) => {
        const id = String(request.sessionId)
        if (agents.has(id)) throw new Error(`session ${id} already exists`)
        agents.set(id, makeAgent(id))
        agentIds.push(id)
        return { sessionId: id as never }
      }),
      rename: vi.fn(async (request: { sessionId: unknown; title: string }) => ({ title: request.title })),
    },
    workspaces: {
      create: vi.fn(async (path: string, title?: string) => ({ id: `ws-${++workspaceSeq}`, path, title: title ?? path })),
    },
    permissions: { set: vi.fn((_session: { id: string }, _name: string): void => {}) },
    persistence: {
      flush: vi.fn(async (): Promise<void> => {}),
      open: vi.fn(async () => ({
        read: vi.fn(async (): Promise<{ events: readonly unknown[] }> => ({ events: [] })),
        close: vi.fn(async (): Promise<void> => {}),
      })),
    },
  } as unknown as SessionHostPorts
  // agents 注册表(Sessions 投递活性检查与 executor 消费)。
  ctx.reflect.provide('agents', { get: (id: string | SessionId): unknown => agents.get(String(id)), list: (): unknown[] => [...agents.values()] })
  return { ports, agentIds, seed }
}

/** accept→出票链路(plugin-boot.spec A22 同款);返回工单 id。 */
const acceptTicket = (runtime: ReturnType<typeof createTasks>, id: string, text: string): string => {
  const trigger = humanTrigger(id, text)
  expect(runtime.engine.receive(trigger)).toBe('stored')
  runtime.pass()
  const candidate = runtime.engine.candidate(trigger.id)
  expect(candidate).toBeDefined()
  runtime.engine.candidateDelivered(candidate!.evalId)
  const decision = runtime.engine.decide(trigger.id, {
    kind: 'accept', title: text, scope: 'Do the work described by the request.', reason: 'explicit request',
    delegation: {
      objective: `Handle: ${text}.`, outputFormat: 'A summary.',
      toolGuidance: 'Use the read/edit/bash tools in the ticket workspace.', taskBoundaries: 'Only the reported request.',
    },
  })
  return decision.ticketId!
}

/** 以临时租户根装配(长 pass 周期:周期驱动不参与,手动 pass;选项可覆写)。 */
const boot = (overrides: Partial<TasksOptions> = {}): ReturnType<typeof createTasks> =>
  createTasks({ tenantRoot: root, realm: 'alice', passIntervalMs: 3_600_000, scope: testScope, ...overrides })

it('装配接线(busy 口径集成面):两张工单先后终态落定,每边界恰一次 compactNow 尝试,工单流不受影响', async () => {
  const ctx = new Context()
  const fake = fakeSessionHost(ctx)
  const master = fake.seed('orchestrator-main')
  // 压缩端口假件:恒抛 busy(模拟主会话非 idle/有在途投递的宿主 idle 闸)。
  const compactNow = vi.fn(async (_agent: Agent, _signal: AbortSignal): Promise<unknown> => { throw busyError() })
  const debugMessages: string[] = []
  const runtime = boot({
    sessionHost: { context: ctx, masterId: 'orchestrator-main', ports: fake.ports },
    compaction: { compactNow },
    compactionDebugLog: (message) => { debugMessages.push(message) },
  })
  try {
    runtime.store.saveSettings({ policy: { sources: { [SOURCE]: { allowed: [{ id: MEMBER, name: 'Alice' }] } } } })
    const first = acceptTicket(runtime, '1', '修复登录回归')
    const second = acceptTicket(runtime, '3', '补齐导出缺字')
    // launch effect 排空(worker session 经真实宿主 seam 建立)——执行面全链不受钩子影响。
    await runtime.effects.idle()
    expect(fake.agentIds).toContain(`worker-${first}`)

    // 两张工单先后进入终态(工单流);每张恰触发一次边界压缩尝试。
    runtime.engine.stopTicket(first, '不再继续')
    runtime.engine.stopTicket(second, '不再继续')
    await vi.waitFor(() => { expect(compactNow).toHaveBeenCalledTimes(2) })
    // 每次尝试都带解析出的主会话 agent;不重试:再等一拍仍两次(无重试风暴)。
    expect(compactNow.mock.calls[0]?.[0]).toBe(master)
    await new Promise((resolve) => { setTimeout(resolve, 20) })
    expect(compactNow).toHaveBeenCalledTimes(2)
    // fail-open:busy 被静默吞掉,两张工单终态照常落定(human stop 不受压缩分支影响)。
    expect(runtime.store.tickets.get(first)?.ended).toMatchObject({ by: 'human', outcome: 'stopped' })
    expect(runtime.store.tickets.get(second)?.ended).toMatchObject({ by: 'human', outcome: 'stopped' })
    // debug 观测面:每边界一条忙碌跳过消息(带工单 id)。
    expect(debugMessages.filter(message => message.includes('忙碌'))).toHaveLength(2)
    expect(debugMessages.some(message => message.includes(first))).toBe(true)
    expect(debugMessages.some(message => message.includes(second))).toBe(true)
  }
  finally { runtime.dispose() }
})

it('compaction 服务缺席不接线:端口缺席(压缩组未挂载常态)→ 同链路全绿,零压缩尝试、零压缩日志', async () => {
  const ctx = new Context()
  const fake = fakeSessionHost(ctx)
  fake.seed('orchestrator-main')
  const debugMessages: string[] = []
  const runtime = boot({
    sessionHost: { context: ctx, masterId: 'orchestrator-main', ports: fake.ports },
    compactionDebugLog: (message) => { debugMessages.push(message) },
  })
  try {
    runtime.store.saveSettings({ policy: { sources: { [SOURCE]: { allowed: [{ id: MEMBER, name: 'Alice' }] } } } })
    const ticket = acceptTicket(runtime, '5', '清理过期脚本')
    await runtime.effects.idle()
    runtime.engine.stopTicket(ticket, '不再继续')
    await new Promise((resolve) => { setTimeout(resolve, 30) })
    // 工单流不受影响:终态照常落定。
    expect(runtime.store.tickets.get(ticket)?.ended).toMatchObject({ by: 'human', outcome: 'stopped' })
    // 不接线:无压缩端口可调,压缩 debug 日志为零(不猜不造桩)。
    expect(debugMessages.filter(message => message.includes('边界压缩'))).toHaveLength(0)
  }
  finally { runtime.dispose() }
})

// ── 派生现读路径装配(F3 复审修复):bootTasks 派生的每触发现读面经 compactionResolve 注入,
// 与显式注入 compaction 的钉死语义并行(createTasks 接线二选一)。

it('派生现读装配(compactionResolve):每触发经现读面调用,工单流不受影响;端口缺席 debug 可见', async () => {
  const ctx = new Context()
  const fake = fakeSessionHost(ctx)
  const master = fake.seed('orchestrator-main')
  const compactNow = vi.fn(async (_agent: Agent, _signal: AbortSignal): Promise<unknown> => { throw busyError() })
  const debugMessages: string[] = []
  // 现读面首两触发返回缺席(压缩组未挂载),其后返回真端口(挂载就绪)——现读语义下钩子自愈。
  let mounted = false
  const runtime = boot({
    sessionHost: { context: ctx, masterId: 'orchestrator-main', ports: fake.ports },
    compactionResolve: _agent => mounted ? { compactNow } : undefined,
    compactionDebugLog: (message) => { debugMessages.push(message) },
  })
  try {
    runtime.store.saveSettings({ policy: { sources: { [SOURCE]: { allowed: [{ id: MEMBER, name: 'Alice' }] } } } })
    const first = acceptTicket(runtime, '7', '整理发布清单')
    await runtime.effects.idle()
    runtime.engine.stopTicket(first, '不再继续')
    await new Promise((resolve) => { setTimeout(resolve, 30) })
    // 挂载前:零 compactNow 调用 + 端口缺席 debug 可见(F3 修复前:无日志的永久静默)。
    expect(compactNow).not.toHaveBeenCalled()
    expect(debugMessages.some(message => message.includes('端口缺席') && message.includes(first))).toBe(true)
    // 工单流不受缺席影响:终态照常落定。
    expect(runtime.store.tickets.get(first)?.ended).toMatchObject({ by: 'human', outcome: 'stopped' })
    // 压缩组挂载后,下一工单边界自愈:compactNow 收到解析出的主会话 agent。
    mounted = true
    const second = acceptTicket(runtime, '8', '补充验收清单')
    await runtime.effects.idle()
    runtime.engine.stopTicket(second, '不再继续')
    await vi.waitFor(() => { expect(compactNow).toHaveBeenCalledTimes(1) })
    expect(compactNow.mock.calls[0]?.[0]).toBe(master)
    expect(debugMessages.some(message => message.includes('忙碌') && message.includes(second))).toBe(true)
  }
  finally { runtime.dispose() }
})
