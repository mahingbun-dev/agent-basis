/**
 * Sessions——orchestrator 与 worker 两条 DSH session 的生命周期与消息投递面
 * (35 号 A22;34 号 §2.5 sessions 行「ensure/prompt/promptedId/relay/holds 契约保留,
 * 实现按本仓 DSH session 面重写」;A0 评审 tasks-engine-review.md §5-C11 宿主面钉住)。
 *
 * 真实 seam(A0 §5-C11:resolveAgent/create/rename/agents/workspaceRegistry/
 * permissionPresets/sessionPersistence 在 DSH 0.2.2-rc.1 全部存在且签名与 SA 用法
 * 吻合;逐字签名见其 §5 表,编译期钉住见 tests/types.seam-pin.ts):
 * - `ensure(id, cwd, title, role)`(SA app/sessions.ts:138-155 同路径):resolveAgent
 *   → `'session/not-found'` 判新建 → `workspaceRegistry.create(cwd)`(标题解耦:rc.1
 *   的 create 同 canonical path 幂等复用既有登记且不改其 title,workspace 标题回落宿主
 *   缺省=目录末段,会话标题不作 workspace 标题)→
 *   `sessionController.create({ sessionId, workspaceId, agentPreset })`(rc.1 的
 *   SessionCreateRequest.agentPreset「replacing a reused Session's recorded preset」
 *   即 SA 的 preset 重选兜底)→ 复解析 → `permissionPresets.set(session, preset)`
 *   (A4 拍板 v1 现有沙箱旋钮;缺省 workspace-write,见 permissionPreset 注)→ `rename(sessionId, title)`;
 * - worker session id 约定 `worker-<ticketId>`(SA dsh.ts:24;executor/dsh.ts 定义)保留;
 *   worker session cwd 一律由调用方(executor)从租户 realm 工作区派生(A22 交付原文
 *   「worker session 一律建在租户 realm 工作区内」;R4 目录 `.ticket/<id>/`)。
 * - 投递幂等(A0 §2-C8/处置 D3「AgentDelivery at-most-once 模式照搬」):消息 id 自
 *   requestId 确定(每次重试同一 id);已入史(session/event 实时跟踪 ∪
 *   sessionPersistence 持久史逐页回读)或已在 inbox 等待的不重发;投递落定后再 flush
 *   持久化——重启后同一 requestId 恒至多一次(SA app/delivery.ts 重写级校对移植)。
 *
 * 宿主服务面(本文件 `SessionHostPorts`)为结构端口:glue 组合层按 access 包
 * tenant.ts `serviceOf`(ctx.reflect 反射,audit-bridge 同款惯例)从宿主 ctx 取
 * 'sessionController'/'workspaceRegistry'/'permissionPresets'/'sessionPersistence'
 * 适配注入(tasks 不 import 其服务实例,34 号 §1 依赖方向行「接线经端口注入」);
 * 签名逐字对齐 A0 §5 实测的 0.2.2-rc.1 面,形状漂移由 fixtures/host.ts 的假件
 * (按同一结构实现)与 types.seam-pin.ts 看护。
 *
 * 消息源(kind 'eterna-tasks')仿 SA 'dsh-superagent' 源声明:投递的消息永不被人写的
 * 消息混淆;executor 的 inputsRead 订阅按同一 kind 识别(见 executor/dsh.ts)。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { freezeMessage, MessageId, type ContextFormed } from '@deepseek-ai/dsh-llm'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { key } from '../core/ids.ts'
import type { Effects } from '../effects/effects.ts'

/** 本包投递的消息在 DSH 里的生产者身份(executor 的 inputsRead 订阅按它识别)。 */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'eterna-tasks': { kind: 'eterna-tasks' } & ContextFormed
  }
}

/**
 * 宿主 session 服务面的结构端口(A0 §5-C11 钉住的 0.2.2-rc.1 签名;glue 以
 * ctx.reflect 反射适配注入,签名漂移即 fixtures/verify 的结构断言失败):
 * - `controller`:SessionController 的调用面(resolveAgent/create/rename;错误分支
 *   按 `code` 判别——「Discrimination is always by `code`,never by instanceof」,
 *   RemoteError 本体 extends Error 故原样可抛);`'session/not-found'` 是新建判据,
 *   其余错误原样抛出;
 * - `workspaces`:WorkspaceRegistry.create(path, title?) → { id, path, title }
 *   (rc.1 index.d.ts:146;title 仅新建时生效,同 path 幂等复用既有登记且不改其 title——
 *   ensure 只传 path,workspace 标题回落宿主缺省,与会话标题解耦);
 * - `permissions`:PermissionPresetService.set(session, name)(rc.1 index.d.ts:177);
 * - `persistence`:SessionPersistence.flush() + open(id, 'read') → 句柄
 *   read(offset, length) → { events } / close()(rc.1 index.d.ts:133/145、
 *   handle.d.ts:75;close 即唯一释放面,Symbol.asyncDispose 委托于它)。
 */
/** 宿主 Remote 失败面(判别恒按 `code`,「Discrimination is always by `code`, never by instanceof」)。 */
export interface RemoteErrorSeam extends Error {
  readonly code: string
}

export interface SessionHostPorts {
  readonly controller: {
    resolveAgent(sessionId: SessionId): Promise<{ readonly agent: Agent } | { readonly error: RemoteErrorSeam }>
    create(request: {
      readonly sessionId?: SessionId
      readonly workspaceId?: string
      readonly cwd?: string
      readonly agentPreset?: string
    }): Promise<{ readonly sessionId: SessionId; readonly agentPreset?: string }>
    rename(request: { readonly sessionId: SessionId; readonly title: string }): Promise<{ readonly title: string }>
  }
  readonly workspaces: {
    create(path: string, title?: string): Promise<{ readonly id: string; readonly path: string; readonly title: string }>
  }
  readonly permissions: {
    set(session: Session, name: string): void
  }
  readonly persistence: {
    flush(): Promise<void>
    open(id: SessionId, access: 'read'): Promise<{
      read(offset?: number, length?: number): Promise<{ readonly events: readonly unknown[] }>
      close(): Promise<void>
    }>
  }
}

/** `prompt` 在 `requestId` 下投递的消息 id——每次重试都是同一个(SA messageId 同构)。 */
export const messageId = (requestId: string): ReturnType<typeof MessageId> => MessageId(`eterna-tasks:${requestId}`)

/**
 * master 会话的缺省 id 约定:`orchestrator-<realm>`(★master 会话引导,2026-11-18 出票端到端
 * 三断点①;SA app/runtime.ts:104 `orchestrator-${key(stateDir)}` 同构——确定性派生 + KV
 * 持久,重启复用同一 id;worker 侧 `worker-<ticketId>` 约定的主会话半边)。仅宿主 session
 * 面在场且 config/KV 三处皆缺席时由装配派生;config/sessionHost 显式注入的 id 原样采信。
 */
export const masterSessionId = (realm: string): string => `orchestrator-${realm}`
/** master 会话标题(Sessions.ensure 的 rename 半边;SA ensure(masterId, …, 'dsh-superagent orchestrator') 同构)。 */
export const MASTER_SESSION_TITLE = 'eterna-tasks orchestrator'

/** 会话角色:orchestrator(主会话)或 worker(工单的 Executor session)。 */
export type SessionRole = 'orchestrator' | 'worker'

/** Sessions 的宿主依赖。 */
export interface SessionsHost {
  /** DSH Cordis context:agents 注册表(ctx.agents)与其事件。 */
  readonly context: Context
  /** 宿主 session 服务面(结构端口,见 `SessionHostPorts` 注)。 */
  readonly ports: SessionHostPorts
  /** 持久 effect 队列:relay 经它按序投递到主会话。 */
  readonly effects: Pick<Effects, 'enqueue' | 'handle'>
  /** 主会话(orchestrator)的 session id(装配注入)。 */
  readonly masterId: string
  /** 宿主生命周期信号:停止后拒绝投递。 */
  readonly lifetime: AbortSignal
  /** 各角色创建 session 时选用的 agent preset 名(A25 cordis.patch.yml 落地后由装配注入;未注入用宿主默认)。 */
  readonly presets?: Partial<Record<SessionRole, string>>
  /** 建会话写入的权限 preset 名(A4 拍板 v1 现有沙箱旋钮;缺省 'workspace-write'——worker
   * 要在租户工作区写工单目录,workspace-write 正是其语义;★2026-11-18 改缺省:SA 同款
   * 'danger-full-access' 非标准部署 preset(permission-presets 按部署 config.presets 配置,
   * 标准面仅 read-only/workspace-write),worker 首启即 `permission: unknown preset` 失败
   * (M4 真实链路实测);glue 可按部署显式覆写)。 */
  readonly permissionPreset?: string
}

/** 每个 session 的已入史消息 id 集合:实时跟踪 ∪ 持久史回读,按 Session 对象跟踪。 */
interface SeenState {
  ids: Set<string>
  /** 持久史回读的一次性装载(SA delivery.ts loaded 同款);失败置回 undefined 允许重试。 */
  loaded?: Promise<Set<string>> | undefined
}

/**
 * 取、建 orchestrator 与 worker 的 DSH session,并按 requestId 幂等地向其投递消息;
 * 主会话的 relay 经 `Effects` 有序排队。Executor、装配面与人行路由用它 ensure
 * session、投递去重消息、处理 relay。
 */
export class Sessions {
  private readonly ctx: Context
  private readonly host: SessionsHost
  /** 每 session 的已入史消息 id(实时 ∪ 持久),按 Session 对象跟踪(SA delivery.ts seen 同构)。 */
  private readonly seen = new WeakMap<Session, SeenState>()
  private readonly disposers: (() => void)[] = []
  constructor(host: SessionsHost) {
    this.host = host
    this.ctx = host.context
    // relay 按入队序一次一个地投给主会话(SA Sessions 构造器同款 ordered handler)。
    host.effects.handle('relay', ({ text }, requestId) => this.prompt(host.masterId, requestId, text, 'steer'), { ordered: true })
    // 实时半边:本包消息被 session 纳入步骤(session/event)即记入已持有
    // (SA AgentDelivery 构造器同款;持久半边见 loadHistory)。
    this.disposers.push(this.ctx.on('session/event', (session, event) => {
      if (event.type !== 'user/message' || event.data.source.kind !== 'eterna-tasks') return
      this.seenStateFor(session).ids.add(String(event.data.id))
    }))
  }
  /**
   * 取或建 session `id`,工作区为 `cwd`(A22「worker session 一律建在租户 realm 工作
   * 区内」——cwd 由调用方(executor)从 store.workspaceDir 派生 R4 目录):
   * resolveAgent 已有即取(宿主重启后由它 resume 持久化的会话);`session/not-found`
   * 则建 workspace → create(sessionId + agentPreset) → 复解析;再写权限 preset 与标题。
   * @throws resolveAgent/create 的宿主错误(仅 'session/not-found' 被新建路径消费)。
   */
  async ensure(id: string, cwd: string, title: string, role: SessionRole): Promise<Agent> {
    const { controller, workspaces, permissions } = this.host.ports
    let result = await controller.resolveAgent(SessionId(id))
    if ('error' in result && result.error.code === 'session/not-found') {
      // workspace 标题与会话标题解耦(43-M4 §四『workspace 组名重名』根因):rc.1 的
      // create 同 canonical path 幂等复用且 title 仅新建时生效,这里只登记 cwd——
      // workspace 标题回落宿主缺省(目录末段);会话标题照旧走下方 rename。
      const workspace = await workspaces.create(cwd)
      const preset = this.host.presets?.[role]
      await controller.create({ sessionId: SessionId(id), workspaceId: workspace.id,
        ...(preset !== undefined ? { agentPreset: preset } : {}) })
      result = await controller.resolveAgent(SessionId(id))
    }
    if ('error' in result) throw result.error
    permissions.set(result.agent.session, this.host.permissionPreset ?? 'workspace-write')
    await controller.rename({ sessionId: SessionId(id), title })
    return result.agent
  }
  /**
   * session `sessionId` 是否已持有 `requestId` 的消息(在 inbox 里等,或已入史)。
   * session 不存在返回 false(SA holds 同款——不存在的会话谈不上持有)。
   */
  async holds(sessionId: string, requestId: string): Promise<boolean> {
    const result = await this.host.ports.controller.resolveAgent(SessionId(sessionId))
    if ('error' in result) return false
    const seen = await this.seenOf(result.agent)
    return this.holdsMessage(result.agent, seen.ids, key(requestId))
  }
  /**
   * 按 `requestId` 幂等投递一条消息:到下一回合(queue)、当前回合(steer),或以
   * `{ inject }` 注入史中而不唤醒;已在 inbox 或已入史(含持久史回读)的不重发。
   * `authorize` 在投递前、`accepted` 在(唯一一次)投递落下后调用——executor 用前者
   * 撤销过期的启动授权;投递落定后 flush 持久化(SA delivery.ts send 同序)。
   * @throws session 不存在或已被处置、或宿主错误时。
   */
  async prompt(sessionId: string, requestId: string, text: string, mode: 'queue' | 'steer' | { inject: string },
    authorize?: () => void, accepted?: () => void): Promise<void> {
    this.host.lifetime.throwIfAborted()
    const result = await this.host.ports.controller.resolveAgent(SessionId(sessionId))
    if ('error' in result) throw result.error
    const agent = result.agent
    // 投递目标已被处置(经 Web UI 删除等):重试无意义,让上层按失败处理。
    if (this.ctx.agents.get(agent.id) !== agent) throw new Error(`Session ${sessionId} 已被处置,投递目标失效`)
    const seen = await this.seenOf(agent)
    this.host.lifetime.throwIfAborted()
    authorize?.()
    this.send(agent, seen, key(requestId), text, mode)
    accepted?.()
    // 收据半边:投递落定后冲刷持久化,重启后的回读才不漏这条(SA delivery.ts 同款)。
    await this.host.ports.persistence.flush()
  }
  /** `prompt` 在 `requestId` 下投递的消息 id:DSH 的 inbox 事件以它点名消息。 */
  promptedId(requestId: string): ReturnType<typeof MessageId> { return messageId(key(requestId)) }
  /** 排队一条到主会话的 steering relay:持久、由 Effects 重试至送达,每 requestId 至多一次。 */
  relay(requestId: string, text: string): void { this.host.effects.enqueue('relay', requestId, { text }) }
  /** 退订宿主 session 事件(装配关停配逆用)。 */
  dispose(): void { for (const dispose of this.disposers.splice(0)) dispose() }
  /** session 是否已持有 `deliveryId` 的消息:已入史(实时/持久)或已在 inbox 等待。 */
  private holdsMessage(agent: Agent, seenIds: Set<string>, deliveryId: string): boolean {
    const id = String(messageId(deliveryId))
    return seenIds.has(id)
      || [...agent.inbox.nextTurn, ...agent.inbox.nextStep].some(message =>
        message.source.kind === 'eterna-tasks' && String(message.id) === id)
  }
  /** 投递一次到所选 inbox,或不唤醒地注入史中(SA AgentDelivery.send 的重写半边)。 */
  private send(agent: Agent, seen: SeenState, deliveryId: string, text: string, mode: 'queue' | 'steer' | { inject: string }): void {
    if (this.holdsMessage(agent, seen.ids, deliveryId)) return
    const source = typeof mode === 'object'
      ? { kind: 'eterna-tasks' as const, form: 'notice' as const, summary: mode.inject }
      : { kind: 'eterna-tasks' as const, form: 'relay' as const }
    const message = freezeMessage({ id: messageId(deliveryId), role: 'user' as const, content: [{ type: 'text' as const, text }], source })
    if (typeof mode === 'object') {
      agent.inject(message)
      // inject 不经 inbox、不必然产 session/event,立即记为已持有(SA 同款)。
      seen.ids.add(String(message.id))
    }
    else if (mode === 'steer') agent.steer(message)
    else agent.followup(message)
  }
  /** 每 session 的实时状态(无则建)。 */
  private seenStateFor(session: Session): SeenState {
    let state = this.seen.get(session)
    if (!state) { state = { ids: new Set() }; this.seen.set(session, state) }
    return state
  }
  /** 每 session 的已持有全集:实时集合 ∪ 持久史回读(一次性装载,失败可重试)。 */
  private seenOf(agent: Agent): Promise<SeenState> {
    const state = this.seenStateFor(agent.session)
    state.loaded ??= this.loadHistory(agent, state).catch((error: unknown) => { state.loaded = undefined; throw error })
    return state.loaded.then((): SeenState => state)
  }
  /**
   * 持久史半边:flush 后以只读句柄逐页回读该 session 的 user/message 事件,把本包
   * 消息 id 并入实时集合——宿主重启后(进程内实时跟踪清零)由持久史兜底,同一
   * requestId 恒不重发(A0-C8「宿主无幂等投递原语,照搬 SA AgentDelivery」)。
   */
  private async loadHistory(agent: Agent, state: SeenState): Promise<Set<string>> {
    const { persistence } = this.host.ports
    await persistence.flush()
    const handle = await persistence.open(SessionId(agent.id), 'read')
    try {
      for (let offset = 0; ;) {
        const { events } = await handle.read(offset, 512)
        if (!events.length) break
        offset += events.length
        for (const event of events) {
          const data = event as { type?: unknown; data?: unknown }
          if (data.type !== 'user/message') continue
          const id = deliveryIdOf(data.data)
          if (id !== undefined) state.ids.add(id)
        }
      }
    }
    finally { await handle.close() }
    return state.ids
  }
}

/** 从一条(持久史里的)消息取本包投递的幂等键;非 'eterna-tasks' 源返回 undefined。 */
function deliveryIdOf(message: unknown): string | undefined {
  const shape = message as { source?: { kind?: unknown }; id?: unknown } | undefined
  return shape?.source?.kind === 'eterna-tasks' && typeof shape.id === 'string' ? shape.id : undefined
}
