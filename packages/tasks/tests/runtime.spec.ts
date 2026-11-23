/**
 * runtime 端到端接线用例(★最后一公里;2026-11-18 出票端到端验收三断点①②③④的
 * 装配面判据;34 号 §4-E 承接表「runtime.spec → plugin-boot.spec」之外的单列一文件:
 * 本文件只走**裸挂载形态**——`defineTasksPlugin(config)` 无 sessionHost、无 masterId、
 * 无 scope 显式注入,全部由插件自宿主 ctx 与 KV 引导)。
 *
 * 目标行为(35-A21「用户在 web 聊天会话里发一条委派消息 → 该消息成为 Trigger(explicit,
 * 发送者=会话主人)→ Eval 评估 → accept 出票 → worker session 接手」)在**一条链路**上
 * 四件同时成立:
 * - ① master 会话引导:apply 时自宿主 session 面派生 `orchestrator-<realm>`、经
 *   Sessions.ensure 建出主会话、id 写 KV、health()/stats() 暴露;
 * - ② webchat 入口安装:masterId 就绪(此处来自 ①的派生)即安装,emit 主会话用户消息
 *   (source.kind='user')→ Trigger 入 Engine(dsh `session/event` seam);
 * - ③ 缺省 SourceScope 真实现:`webchatMasterScope` 对主会话的用户消息 listened(explicit
 *   强度由 gate 名单 × addressed='direct' 裁定),余 filtered——无显式 scope 注入;
 * - ④ sessionHost 自宿主 ctx 注入:真实 DshExecutor + Sessions 取代 StubExecutor,
 *   accept 后 worker session `worker-<ticketId>` 在租户 realm 工作区内建出并接手 assignment。
 *
 * 宿主形态:本包 tests/fixtures/host.ts 的同构装配先例(四类宿主事件发射位 + 宿主 session
 * 服务面假件的紧凑版,服务名与 DSH 0.2.2-rc.1 实测一致,经 ctx.reflect.provide 挂载);
 * 差异只在装配入口——fixtures/host.ts 手工装配 Engine/Executor,本文件走 defineTasksPlugin
 * 的真实装配面(接线本身即被测对象)。
 */
import { Context } from '@deepseek-ai/cordis'
import { freezeMessage, MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { key } from '../src/core/index.ts'
import { workerSessionId, DshExecutor } from '../src/executor/dsh.ts'
import { defineTasksPlugin } from '../src/plugin.ts'
import type { TasksRuntime } from '../src/plugin.ts'
import { MASTER_SESSION_TITLE } from '../src/session/sessions.ts'
import { WEBSCHAT_SOURCE } from '../src/sources/webchat.ts'

const REALM = 'alice'
let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'tasks-runtime-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

/** 一条主会话用户消息(session/event `user/message` 载荷;kind 'user' = 用户亲口消息)。 */
const userMessage = (id: string, text: string): unknown =>
  freezeMessage({ id: MessageId(id), role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } } as never)

/** emit 形态与 fixtures/host.ts 同构(真身事件另带 seq;本用例不依赖)。 */
const emitUserMessage = (ctx: Context, sessionId: string, messageId: string, text: string): void => {
  ctx.emit('session/event', { id: sessionId } as never,
    { type: 'user/message', time: 1_760_000_000_000, data: userMessage(messageId, text) } as never)
}

/**
 * 同构宿主装配(fixtures/host.ts 的紧凑版;服务名经 DSH 0.2.2-rc.1 实测核对):
 * 四类宿主事件在投递/领取时发射(agent/status、agent/inbox/claimed、session/event、
 * agent/error 由用例按需),归属 provider 为真实 DSH 服务键。
 */
function startHost(): { ctx: Context; master: string; agentIds: string[]; renamed: Map<string, string> } {
  const ctx = new Context()
  const agents = new Map<string, Record<string, unknown>>()
  const agentIds: string[] = []
  const renamed = new Map<string, string>()
  const workspaces = new Map<string, string>()
  let workspaceSeq = 0, turn = 0
  const makeAgent = (sessionId: string, cwd?: string): Record<string, unknown> => {
    const inbox = { nextTurn: [] as unknown[], nextStep: [] as unknown[], remove: (): boolean => false }
    // 消息唤醒闲着的 agent:其回合开始,第一步领取等待中的消息并纳入历史(DSH 如是说)。
    const deliver = (mode: 'queue' | 'steer') => vi.fn((message: { id: string }) => {
      inbox[mode === 'queue' ? 'nextTurn' : 'nextStep'].push(message)
      const agent = agents.get(sessionId)
      if (!agent || agent.status !== 'idle') return
      agent.status = 'running'
      ctx.emit('agent/status', { agent, status: 'running' } as never)
      turn++
      const message0 = mode === 'queue' ? inbox.nextTurn.shift() : undefined
      if (message0) {
        ctx.emit('agent/inbox/claimed', { agent, message: message0, turn } as never)
        ctx.emit('session/event', { id: sessionId } as never, { type: 'user/message', data: message0 } as never)
      }
    })
    const agent = {
      id: sessionId, status: 'idle', session: { id: sessionId }, cwd, inbox,
      followup: deliver('queue'), steer: deliver('steer'), inject: vi.fn(),
      cancel: vi.fn(() => { const current = agents.get(sessionId); if (current?.status === 'running') current.status = 'idle' }),
      whenIdle: (): Promise<void> => Promise.resolve(),
    }
    agents.set(sessionId, agent)
    agentIds.push(sessionId)
    return agent
  }
  // 宿主 session 服务面假件(A0 §5-C11 钉住的 0.2.2-rc.1 签名;错误按 RemoteError code 判别)。
  const controller = {
    resolveAgent: vi.fn(async (sessionId: SessionId) => {
      const agent = agents.get(String(sessionId))
      return agent ? { agent } : { error: Object.assign(new Error(`session ${String(sessionId)} not found`), { code: 'session/not-found' }) }
    }),
    create: vi.fn(async (request: { sessionId?: SessionId; workspaceId?: string; cwd?: string; agentPreset?: string }) => {
      const id = String(request.sessionId)
      if (agents.has(id)) throw new Error(`session ${id} already exists`)
      makeAgent(id, request.cwd ?? (request.workspaceId !== undefined ? workspaces.get(request.workspaceId) : undefined))
      return { sessionId: SessionId(id) }
    }),
    rename: vi.fn(async (request: { sessionId: SessionId; title: string }) => {
      renamed.set(String(request.sessionId), request.title)
      return { title: request.title }
    }),
  }
  const workspaceRegistry = { create: vi.fn(async (path: string, title?: string) => {
    const id = `ws-${++workspaceSeq}`
    workspaces.set(id, path)
    return { id, path, title: title ?? path }
  }) }
  const permissionPresets = { set: vi.fn() }
  const sessionPersistence = {
    flush: vi.fn(async (): Promise<void> => {}),
    open: vi.fn(async () => ({
      read: vi.fn(async (): Promise<{ events: readonly unknown[] }> => ({ events: [] })),
      close: vi.fn(async (): Promise<void> => {}),
    })),
  }
  ctx.reflect.provide('agents', {
    get: (id: string | SessionId): unknown => agents.get(String(id)),
    list: (): unknown[] => [...agents.values()],
  })
  ctx.reflect.provide('sessionController', controller)
  ctx.reflect.provide('workspaceRegistry', workspaceRegistry)
  ctx.reflect.provide('permissionPresets', permissionPresets)
  ctx.reflect.provide('sessionPersistence', sessionPersistence)
  return { ctx, master: `orchestrator-${REALM}`, agentIds, renamed }
}

/** R3 委派四要素(accept 必填;engine.decide 硬约束,35 号 A7)。 */
const DELEGATION = { objective: '在租户工作区新建说明文件', outputFormat: '文件路径与三行摘要',
  toolGuidance: '租户工作区内的读写工具', taskBoundaries: '只新建一个文件,不改其他内容' }

it('裸挂载全链:master 引导 → webchat 入口安装 → 缺省 scope explicit → accept 出票 → worker session 接手', async () => {
  const host = startHost()
  // 裸挂载形态:无 sessionHost、无 masterId、无 scope —— 四件全部由插件自行引导/派生。
  const plugin = defineTasksPlugin({ tenantRoot: root, realm: REALM, passIntervalMs: 3_600_000 })
  const dispose = plugin.apply(host.ctx)
  try {
    const runtime = host.ctx.tasks as TasksRuntime
    // ① master 会话引导:约定派生 orchestrator-<realm>、写 KV、经 health()/stats() 暴露,
    // 并经宿主 session 面 ensure 出主会话(标题/权限 preset 由 Sessions.ensure 写入)。
    expect(runtime.masterId).toBe(host.master)
    expect(runtime.health().masterId).toBe(host.master)
    expect(runtime.stats().masterId).toBe(host.master)
    await vi.waitFor(() => {
      expect(host.agentIds).toContain(host.master)
      expect(host.renamed.get(host.master)).toBe(MASTER_SESSION_TITLE)
      expect(runtime.health().components.master?.state).toBe('ready')
    })
    // ④ sessionHost 自宿主 ctx 注入:真实执行面(非 StubExecutor)。
    expect(runtime.executor).toBeInstanceOf(DshExecutor)
    // ② 入口已安装(健康项在册,待命)。
    expect(runtime.health().components.webchat).toMatchObject({ state: 'ready' })
    // 名单:会话主人(realm 账号)在 webchat 源的 allowed 里 —— gate 名单 × direct → explicit。
    runtime.store.saveSettings({ policy: { sources: { [WEBSCHAT_SOURCE]: { allowed: [{ id: REALM, name: '部署账号' }] } } } })

    // 用户在 web 聊天(主会话)里发一条委派消息 → Trigger stored。
    emitUserMessage(host.ctx, host.master, 'm-1', '请在租户工作区新建 m4-ticket.md,内容为三行验收步骤')
    const triggerId = key('tasks/webchat-trigger', host.master, 'm-1')
    const stored = runtime.store.triggers.get(triggerId)
    expect(stored).toMatchObject({ source: WEBSCHAT_SOURCE, human: true, addressed: 'direct',
      actor: { source: WEBSCHAT_SOURCE, id: REALM }, text: '请在租户工作区新建 m4-ticket.md,内容为三行验收步骤' })
    // ③ 缺省 scope 对主会话 listened(explicit 强度),候选已就绪(入口 onStored 即排 pass)。
    expect(runtime.store.triggers.disposition(triggerId)?.filtered).toBeUndefined()
    // realm = 会话归属(单 realm 一账号栈:主会话属本栈绑定的租户 realm,随 disposition 落库)。
    expect(runtime.store.triggers.disposition(triggerId)?.realm).toBe(REALM)
    const candidate = runtime.engine.candidate(triggerId)
    expect(candidate).toBeDefined()
    expect(candidate!.strength).toBe('explicit')

    // accept 出票 → worker session 接手(worker-<ticketId>,cwd = R4 目录,assignment running)。
    runtime.engine.candidateDelivered(candidate!.evalId)
    const decision = runtime.engine.decide(triggerId, {
      kind: 'accept', title: '新建验收说明文件', scope: 'Do the work described by the request.', reason: 'explicit request',
      acknowledgement: '好的,这就安排。', delegation: DELEGATION,
    })
    expect(decision.kind).toBe('accept')
    await runtime.effects.idle()
    const ticket = runtime.store.tickets.get(decision.ticketId!)
    expect(ticket?.realm).toBe(REALM)
    expect(host.agentIds).toContain(workerSessionId(decision.ticketId!))
    expect(ticket?.assignments.at(-1)?.state).toBe('running')
    // ★派发渠道纪律(2026-11-23 线上修复):主会话线程是派发渠道而非话题线程,工单不订阅它——
    // 否则同一窗口的下一条新话题会被扇出成这张单的 Input,候选卡不生成(旧断言即被推翻的语义)。
    expect(runtime.store.threads.get(`${WEBSCHAT_SOURCE}:${host.master}`)?.subscriptions).toEqual([])
  } finally { dispose() }
})
