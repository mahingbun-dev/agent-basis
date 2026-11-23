/**
 * plugin 装配——createTasks() 真实装配为 `ctx.tasks` 服务(35 号 A16;34 号 §1 plugin.ts 行、
 * §2.6 runtime 胶水行「pass 驱动/健康面/notice 合并等机制并入装配,按需重写」)。
 *
 * 设计依据:35 号 A16 交付原文(启动顺序 store→effects→outbox→engine→assessor→executor,
 * sources 留接口位,关停配逆);34 号 §4-E runtime.spec→plugin-boot.spec 判据;26 号 §2.1-1
 * (tasks 对外暴露 ctx.tasks 服务,与消费 ctx.audit 同构);24 号 §5.3-5/6(横切不拥有业务状态、
 * 每状态单写者)。插件形态参照 glue governance-plugin(provide/ctx.on/disposer 形态,
 * packages/glue/src/plugins/governance-plugin.ts)与 compaction basic-plugin 宿主消费形态
 * (packages/compaction/src/basic);Cordis 纪律:组合层以服务(注册表 + 唯一 SERVICE_ID)
 * provide、可配逆(34 号 §2 通用要点④,packages/governance/src/index.ts:1-13 先例)。
 *
 * 装配顺序(begin 记录,dispose 逆序回放,34 §4-E 判据):
 * ① store —— TasksRealmRouter 按 realm 解析租户库(注入的 dirOf 解析失败即 fail-closed 不开库,
 *    23 号 §3.1;缺省派生的部署指名 realm 由 Store 引导自建目录);
 * ② effects —— Effects 持久副作用队列并在装配步内 start(handler 由 outbox 等随后注册时 kick 重派);
 * ③ outbox —— 回执投递(channels 适配器经 TasksOptions.channels 端口注入;★A1 已接线:
 *    glue 未显式注入时自宿主 ctx 机会派生 effects/channels-delivery.ts,宿主无 channels
 *    服务才回落 UNWIRED 挂起);
 * ④ engine —— Engine + Intake/Evals/Tickets/Assignments/Replies 全链真实装配(policy/realmOf/
 *    scope/prepareTicket 由装配面供给;pass 驱动随 engine 步启动,28 号 §8-3 pass 周期);
 * ⑤ assessor —— ★A19 已接线:MasterAssessor(per-eval 状态隔离/候选卡投递 'assessment'
 *    持久 effect/TextCache;线程上下文与投递面经 TasksOptions 端口注入,缺省不投递不计时);
 *    ⑥ executor —— ★A22 已接线:TasksOptions.sessionHost(宿主 DSH session 服务束,A0 §5-C11
 *    结构端口)在场即真实 DshExecutor+Sessions(每工单一条 `worker-<ticketId>` DSH session、
 *    install() 四类宿主事件 + resume() 对账;A0 处置 D3/D4)替换可控 stub;★最后一公里接线
 *    (2026-11-18 出票端到端验收三断点④):glue 未显式注入 config.sessionHost 时,插件
 *    apply 自宿主 ctx 机会读取 session 服务束(reflect.get 反射惯例,access tenant.ts
 *    serviceOf 同款;fixtures/host.ts 同构装配)派生注入——宿主服务缺席(测试裸宿主)回落
 *    stub,TasksRuntime.executor 联合类型保持(34 §4-E 假件记账语义);⑦ sources ——
 *    ★A21 已接线:ChannelTriggerAdapter(channels 事件 → Engine 的被动汇,无注册表无轮询,
 *    34 §0-A5;glue 注给 channels 网关 sink 位);缺省 SourceScope 同步真实现(三断点③:
 *    webchatMasterScope 替换 UNWIRED_SCOPE——webchat 主会话用户消息 listened,余 filtered)。
 *    ★webchat 委派入口(35-A21 诊断清单①)为插件面接线(非装配步,boot 序不变):master
 *    会话引导(三断点①:masterId 按 config → KV → 约定派生解析并写 KV,health()/stats()
 *    暴露;宿主 session 面在场且约定派生时以 Sessions.ensure 确保主会话存在)就绪后,
 *    WebchatDelegationEntry 监听主会话用户消息归一化为 Trigger 进 Engine.receive
 *    (sources/webchat.ts);工具可见性(诊断清单②)同步收敛为主会话白名单。
 *
 * ★T2 路由面独占(docs/PLUGIN-AUTHORING §1.1-2,packctl tenant-scan CI 强制):本插件不占用
 * 宿主 Web 路由面(T2 点名的各注册面一律不调用)——数据端点唯一正路是 access 守卫清单登记
 * (归 WS-C),健康面/状态面以服务形态暴露(ctx.tasks.health()/stats(),供工作台与探针消费);
 * 宿主 webServer 等路由面服务不在本插件解析持有,glue 层接线经 TasksOptions 端口注入
 * (34 号 §1 依赖方向行)。
 * ★T15 数据面(38 号 M4 实接;24a 裁决 dwfq-843ec077-1 口径「数据面经 tasks 提供、路由经
 * access 登记」):DomainEvents 经 ctx.tasks.subscribe() 多播暴露、当前工单/线程领域态经
 * ctx.tasks.snapshot() 只读暴露——工作台 live hub(workbench 包,Tier2→Tier2 依赖不受约束,
 * 33 号 G0-6④)据此投影 SSE 快照+增量;SSE 端点本体由 access 守卫面登记(38 号 O-5,
 * packages/access/src/tenant.ts WORKBENCH_STREAM_ENDPOINT),本插件不碰任何注册面。
 */
import { join } from 'node:path'
import type { SQLInputValue } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { Engine } from './core/engine.ts'
import type { DomainEvent, EffortTier, EngineForMainSession, Executor, SourceScope, Thread, Ticket, Trigger } from './core/index.ts'
import { Effects, HealthBoard, type Health, type HealthEntry } from './effects/effects.ts'
import { channelsDeliveryFromContext } from './effects/channels-delivery.ts'
import { Outbox, type ChannelsDelivery } from './effects/outbox.ts'
import { DshExecutor, ticketExecution, type ExecutorHost } from './executor/dsh.ts'
import { DEFAULT_SUBAGENT_POLICIES, validateSubagentPolicies, type SubagentPolicies } from './executor/subagent-policies.ts'
import { MasterAssessor, type TriggerContext } from './session/assessor.ts'
import { Prompts } from './session/prompts.ts'
import { orchestratorTools, type OrchestratorToolsHost } from './tools/orchestrator.ts'
import { toDshTool } from './tools/tool.ts'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { ticketOfSession, workerSessionId } from './executor/dsh.ts'
import { MASTER_SESSION_TITLE, masterSessionId, Sessions, type SessionHostPorts, type SessionRole, type SessionsHost } from './session/sessions.ts'
import { ORCHESTRATOR_PRESET_ID, WORKER_PRESET_ID } from './session/presets.ts'
import { ChannelTriggerAdapter } from './sources/channel-adapter.ts'
import { WEBSCHAT_SOURCE, webchatMasterScope, WebchatDelegationEntry } from './sources/webchat.ts'
import type { ActorRef } from './core/index.ts'
import { settingsPolicy, type AllowedRoster, type PolicyWiring } from './policy/gate.ts'
import type { RoleModel, Settings } from './policy/settings.ts'
import { policyVersion } from './policy/version.ts'
import { createTasksSettingsFace, type TasksSettingsFace } from './policy/face.ts'
import type { JointSides } from './policy/save.ts'
import { activeTicketsFace, ACTIVE_TICKETS_SECTION_NAME, type ActiveTicketsSection } from './session/sections.ts'
import { TasksRealmRouter } from './store/realm.ts'
import { KV } from './store/kv.ts'
import { defaultTenantRoot, Store } from './store/store.ts'

/** 组合层注册 ctx.tasks 服务时的唯一 ID(注册表 + 唯一 ID,provide 可交换;34 §2 通用要点④)。 */
export const TASKS_SERVICE_ID = 'tasks'
/** bundle 装载行 id(cordis.patch.yml 的 eterna-tasks 行;随 A25 预设一并登记)。 */
export const TASKS_PLUGIN_NAME = 'eterna-tasks'
/** 缺省租户 realm(单 realm 栈;多 realm 分栈随 A21 sources 归属接线扩展,35 号 §12-2)。 */
export const DEFAULT_TASKS_REALM = 'default'
/** pass 周期(28 号 §8-3「pass 周期(2s)刷新」,24a C6 拍板采纳后者;清单/时钟秒级延迟无害)。 */
export const PASS_INTERVAL_MS = 2000

/**
 * realm 工作区目录缺省解析:部署指名的 realm 直接派生 `<tenantRoot>/<realm>`——Store 引导
 * 时自建 `.eterna/` 库目录(mode 0700,store.ts 同款),与 access 登录开通的账号工作区同布局。
 * fail-closed 铁律(23 号 §3.1「宁可拒一次,不可跨租户写」)由**注入的** dirOf 承担:glue 按
 * access accountOf()/userRootFor 注入账号级解析(其 existsSync 语义见 realm.ts 头注),
 * 返回 undefined 即不开库;缺省派生不设目录存在闸——进程级 realm 是部署指名,不存在
 * 账号身份解析失败的跨租户歧义。
 */
export function defaultTasksDirOf(tenantRoot: string): (realm: string) => string | undefined {
  return (realm: string): string => join(tenantRoot, realm)
}

/** A21 接口位:未注入 channels 适配器时的投递面——一律「不可用」,回执以 Later 挂起等待(outbox.ts 语义),不落 dropped、不丢消息。 */
const UNWIRED_CHANNELS: ChannelsDelivery = {
  available: () => false,
  channelAllowed: () => false,
  send: (): Promise<'waiting'> => Promise.resolve('waiting'),
}

// A21 接口位的缺省监听面(★真实现,2026-11-18 出票端到端三断点③):旧 `UNWIRED_SCOPE`
// 「一律不监听」已由 sources/webchat.ts 的 `webchatMasterScope` 替换——webchat 来源、
// orchestrator 主会话(引导解析的 masterId,getter 动态现读)的用户消息 listened,
// 其余一律 filtered(reason 'sources_unwired' 原码,intake 记 filtered 落库不进 Eval)。
// 两处消费(createTasks 的 Engine 构造 + 工具面 OrchestratorToolsHost.scope)同用该面。

/** 一次 Executor 委托的记账(start/deliver/stop 三类,reason 仅 stop 携带)。 */
export interface ExecutorCall { op: 'start' | 'deliver' | 'stop'; ticketId: string; assignmentId: string; reason?: string }

/**
 * 宿主 ctx → session 服务束的机会读取(★最后一公里,2026-11-18 出票端到端三断点④
 * 「sessionHost 未注入 → StubExecutor → 票停 pending」):按 access 包 tenant.ts
 * `serviceOf` 的 `ctx.reflect.get(name, false)` 反射惯例(非严格机会语义,tasks 不
 * import 宿主服务实例,34 号 §1 依赖方向行),从宿主 ctx 取
 * sessionController / workspaceRegistry / permissionPresets / sessionPersistence
 * 四服务与 agents 注册表,按 `SessionHostPorts` 结构端口装配。
 *
 * fail-closed:任一服务缺席或缺少所消费的方法(裸 cordis ctx、测试裸宿主)即返回
 * undefined——装配面回落 StubExecutor(`TasksRuntime.executor` 联合保持,
 * 34 §4-E 假件记账语义);不猜、不造桩。逐签名结构对齐 A0 评审 §5-C11 钉住的
 * 0.2.2-rc.1 面(tests/types.seam-pin.ts)与 fixtures/host.ts 的同构装配先例。
 */
export function sessionHostFromContext(ctx: Context): Omit<SessionsHost, 'effects' | 'lifetime' | 'masterId'> | undefined {
  const reflect = (ctx as unknown as { readonly reflect?: { get(name: string, strict?: boolean): unknown } }).reflect
  const ctxAny = ctx as unknown as Record<string, unknown>
  // 双路解析(2026-11-18 实证修正):access/plugin.ts:290 注记 reflect 键与 provide
  // 名在宿主侧并不总是一致('client-connection' 反射键实测不可得)——cordis provide
  // 面的 ctx 属性直取是实证可行的主路径,reflect 兜底。
  const service = (name: string): Record<string, unknown> | undefined => {
    // cordis 过滤上下文对未 inject 属性的直读会抛(cannot get property without inject,
    // 本函数直读实测栈)——直读必须包 try/catch;reflect.get(name, false) 非抛语义兜底。
    try {
      const direct = ctxAny[name]
      if (typeof direct === 'object' && direct !== null) return direct as Record<string, unknown>
    } catch { /* filtered ctx 直读抛错=未注入,落 reflect 兜底 */ }
    const value = reflect?.get(name, false)
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
  }
  const missing: string[] = []
  const callable = (target: Record<string, unknown> | undefined, ...names: string[]): boolean =>
    target !== undefined && names.every(name => typeof target[name] === 'function')
  const controller = service('sessionController'), workspaces = service('workspaceRegistry')
  const permissions = service('permissionPresets'), persistence = service('sessionPersistence')
  const agents = service('agents')
  // 四端口 + agents 注册表全在才派生(Sessions/DshExecutor 的消费面:resolveAgent/
  // create/rename、workspaceRegistry.create、permissionPresets.set、persistence.flush+open、
  // agents.get;缺一即在投递/建会话路径上炸内核,不如不派生)。
  for (const [name, target] of [['sessionController', controller], ['workspaceRegistry', workspaces], ['permissionPresets', permissions], ['sessionPersistence', persistence], ['agents', agents]] as const) {
    if (target === undefined) missing.push(name)
  }
  if (missing.length > 0) {
    // 诊断可见性(宿主 logger 缺席场景):console 契合 audit store 报错先例。
    console.error(`[tasks] sessionHost 派生失败:宿主服务缺席 ${missing.join(', ')}(reflect=${reflect !== undefined})`)
    return undefined
  }
  if (!callable(controller, 'resolveAgent', 'create', 'rename')) return undefined
  if (!callable(workspaces, 'create') || !callable(permissions, 'set')) return undefined
  if (!callable(persistence, 'flush', 'open') || !callable(agents, 'get')) return undefined
  return {
    context: ctx,
    ports: { controller, workspaces, permissions, persistence } as unknown as SessionHostPorts,
    // ★角色 preset 装配闭合(53 号 §4-P0):派生束自带双角色 preset 值(同包常量,与
    // cordis.patch.yml 两组 preset 的 config.id 交叉钉住)——生产 glue 不注入
    // config.sessionHost,本派生分支即生产路径,主/worker 建会话请求自此带 agentPreset。
    // 优先级不在此处:派生只在 config.sessionHost 缺席时产出(bootTasks 派生分支),
    // 显式注入的 config.sessionHost.presets 经 createTasks 侧 options.sessionHost.presets
    // 覆写语义恒优先。
    presets: { orchestrator: ORCHESTRATOR_PRESET_ID, worker: WORKER_PRESET_ID },
  }
}

/**
 * ctx.compaction 的结构子集(53 号 §3-D3/§4-P3 结构端口纪律:不 import @eterna/compaction
 * 与 dsh-compaction,tasks-access-bridge 的 AccessStoreBridgeFace 同款——只认 compactNow
 * 一键,结构面残缺即不接线)。compactNow 即 dsh-compaction seam 的手动压缩面:要求会话
 * idle 且无 waking queued work(在途/排队投递),否则抛 code='busy' 的 ManualCompactionError
 * ——判别恒按 `code` 字符串,不 instanceof(「Discrimination is always by `code`,never by
 * instanceof」,sessions.ts RemoteErrorSeam 同款纪律;本包不 import 该错误类)。
 * 返回值只透传不计型(dsh CompactionResult;任务侧只发起不消费)。
 */
export interface CompactionSeam {
  compactNow(agent: Agent, signal: AbortSignal): Promise<unknown>
}

/**
 * 宿主 ctx → compaction 服务的机会读取(53 号 §3-D3 结构端口;sessionHostFromContext 同款
 * 双路反射惯例:直读 try/catch + reflect.get(name, false) 兜底)。宿主压缩组未挂载(compaction
 * preset 组缺席)或服务缺 compactNow 方法(旧宿主/结构漂移)即返回 undefined——任务边界触发
 * 压缩静默不接线(fail-open,不报错不阻断工单流);显式注入 options.compaction 恒优先。
 */
export function compactionFromContext(ctx: Context): CompactionSeam | undefined {
  const reflect = (ctx as unknown as { readonly reflect?: { get(name: string, strict?: boolean): unknown } }).reflect
  const ctxAny = ctx as unknown as Record<string, unknown>
  let service: unknown
  try {
    const direct = ctxAny['compaction']
    if (typeof direct === 'object' && direct !== null) service = direct
  } catch { /* filtered ctx 直读抛错=未注入,落 reflect 兜底(sessionHostFromContext 同款) */ }
  if (service === undefined) {
    const value = reflect?.get('compaction', false)
    if (typeof value === 'object' && value !== null) service = value
  }
  if (service === undefined || typeof (service as Record<string, unknown>)['compactNow'] !== 'function') return undefined
  return service as unknown as CompactionSeam
}

/**
 * 会话 agent 自身作用域的 compaction 结构端口(F3 复审修复的现读主路径):dsh Agent 暴露
 * agent 作用域 ctx(@deepseek-ai/dsh-agent runtime-types「Agent-scoped context;its
 * contributions are agent-local」),会话按角色 preset 挂载的压缩组(isolate.compaction,
 * orchestrator 特化参数 0.7/true 所在)即在该作用域内可见——宿主树展平的 standard 默认参
 * 实例不是会话的压缩引擎。每触发现读、不缓存实例:preset 组晚于 tasks boot 装载/换挂时,
 * 下一次边界触发即取到当下实例(D2 特化参数作用于 D3 边界压缩的前提)。
 * 读不到(测试假 agent 无 ctx / 会话作用域未挂压缩组 / 结构漂移)返回 undefined,由调用方
 * 落宿主 ctx 兜底;agent.ctx 直读不抛(属性在类型面恒声明,防御面仅挡裸对象假件)。
 * 残余口径(诚实登记):「orchestrator preset 压缩组在 agent 作用域可见」依据 isolate 语义
 * (composition-reference:「a preset plugin that provides a service isolates the provider
 * and all consumers together」+ Agent-scoped ctx)静态推得,离线环境无活宿主未做生产实测
 * (P3 验收「session log 出现 compaction/start-end 标记对」待真实链路);现读面使「当次触发
 * 实际取到哪个实例」成为可观测问题——作用域缺席即自动落宿主 ctx,行为不劣于修复前的钉死。
 */
export function compactionFromAgent(agent: Agent): CompactionSeam | undefined {
  const scope: unknown = (agent as { readonly ctx?: unknown }).ctx
  if (typeof scope !== 'object' || scope === null) return undefined
  return compactionFromContext(scope as Context)
}

/**
 * 可控 Executor stub(35 号 A16③「executor 本轮用可控 stub」):只按序记录 Engine 委托的
 * start/deliver/stop,不建 worker session、不碰 Effects/槽位——工单在领域内开出并停在
 * pending,执行契约(R4 目录 + assignment 文本)已由装配面 prepareTicket 经 ticketExecution
 * 纯函数填入。★A22 替换点(35 号 A22 实现类已落地):DshExecutor+Sessions 需要宿主
 * ctx.agents 注册表与四类事件(agent/status、agent/inbox/claimed、session/event、agent/error),
 * 装配接线在本 'executor' 步替换本类(ExecutorHost 的 store/effects/health/sessions 由
 * 装配供给,tests/fixtures/host.ts 有同构装配先例)。
 */
export class StubExecutor implements Executor {
  /** Engine 委托记录(时间序;探针与 plugin-boot 断言面)。 */
  readonly calls: ExecutorCall[] = []
  start(ticket: Parameters<Executor['start']>[0], assignment: Parameters<Executor['start']>[1]): void {
    this.calls.push({ op: 'start', ticketId: ticket.id, assignmentId: assignment.id })
  }
  deliver(ticket: Parameters<Executor['deliver']>[0], assignment: Parameters<Executor['deliver']>[1]): void {
    this.calls.push({ op: 'deliver', ticketId: ticket.id, assignmentId: assignment.id })
  }
  stop(ticket: Parameters<Executor['stop']>[0], assignment: Parameters<Executor['stop']>[1], reason: string): void {
    this.calls.push({ op: 'stop', ticketId: ticket.id, assignmentId: assignment.id, reason })
  }
  /** 某工单(或缺省全部)的委托记录(探针面)。 */
  callsOf(ticketId?: string): ExecutorCall[] {
    return ticketId === undefined ? [...this.calls] : this.calls.filter(call => call.ticketId === ticketId)
  }
}

/** createTasks() 装配选项(全部可选;glue 层接线经端口注入,34 号 §1 依赖方向行)。 */
export interface TasksOptions {
  /** 任务栈绑定的租户 realm(账号;缺省 DEFAULT_TASKS_REALM。多 realm 分栈随 A21 扩展,35 号 §12-2)。 */
  readonly realm?: string
  /** realm → 工作区目录(glue 按 access accountOf()/userRootFor 注入账号级解析,返回 undefined 即 fail-closed 不开库;缺省 defaultTasksDirOf——部署指名 realm 的直派生)。 */
  readonly dirOf?: (realm: string) => string | undefined
  /** 租户根基目录(缺省 defaultTenantRoot():$ETERNA_TENANT_ROOT → $DSH_HOME/workspaces → cwd/workspaces)。 */
  readonly tenantRoot?: string
  /** Source 监听范围端口(sources 接口位,A21 接线;缺省 webchatMasterScope——webchat 主会话用户消息 listened,余 filtered 落库)。 */
  readonly scope?: SourceScope
  /** A10 名单查询端口(access 用户表 + realm 准入表;缺省 settings 自带的 realm 内名单)。 */
  readonly allowed?: AllowedRoster
  /** C3 联合 hash(governance rules.yaml + hitl.yaml + tasks 准入表;glue 热改重算后注入,缺省 settings 内容 hash)。 */
  readonly policyVersion?: string
  /**
   * C3 联合 hash 的另两侧内容现读面(2026-11-19 任务设置分区):glue 接 governance/hitl 后
   * 注入,面板保存时与 tasks 侧内容一起现算联合版本;缺省(未注入)= tasks 内容 hash
   * (save.ts 可选 sides 口径,避免首次面板保存把内容 hash 误判成联合 hash 变化)。
   */
  readonly jointSides?: () => JointSides
  /**
   * R1 effort 档位(24 §5.5-R1;26 §4.1 effort 段;35 号 A17):领域包 effort 档位声明段
   * (五段之一,schema 待 G2-A18 拍板)经 glue 解析后注入——进候选卡字段(EngineOptions.effort)
   * 与 Mandate 执行契约;声明缺席 = 工单不带档,预算守卫不设分档上限(内核不发明默认档)。
   */
  readonly effort?: EffortTier
  /**
   * D1 subagent_policies(24a 拍板记录·D1;26 §4.1 worker 段;35 号 A18):worker 声明段的
   * `subagent_policies` 消费面(types seam,**不预设 YAML 格式**——26 §7-1 schema 待拍板,
   * 领域包声明的解析在 glue/packctl 侧)。缺省 DEFAULT_SUBAGENT_POLICIES(只读 reviewer 类,
   * 引用 @eterna/extra reviewer preset 平台资产);注入值经 validateSubagentPolicies 校验,
   * fail-closed 拒收违规声明(装配期抛错)。
   */
  readonly subagentPolicies?: SubagentPolicies
  /** channels 回执投递适配器(A21 接线;缺省经 defineTasksPlugin 自宿主 ctx 派生
   *  (channels-delivery.ts),宿主亦无 channels 服务时回落 UNWIRED_CHANNELS——回执挂起等待,不落 dropped)。 */
  readonly channels?: ChannelsDelivery
  /**
   * 主会话边界压缩端口(53 号 §3-D3/§4-P3「任务边界触发」):ctx.compaction 的结构子集
   *  (CompactionSeam)。显式注入恒优先;缺席时 defineTasksPlugin 自宿主 ctx 机会派生
   *  (compactionFromContext),派生不出(裸宿主/压缩组未挂/结构残缺)即不接线——工单边界
   *  触发压缩静默不生效(fail-open,不阻断工单流)。接线后行为:工单终态(ticket.ended)落定
   *  → 主会话 id 已引导且 agent 可解析 → compactNow(主会话 agent,装配关停信号);busy
   *  (非 idle/在途投递)或失败 → debug 日志静默跳过,绝不重试(BoundaryCompaction 注)。
   */
  readonly compaction?: CompactionSeam
  /**
   * 派生压缩端口的每触发现读面(53 号 F3 复审修复):boot 一次性解析 compactionFromContext
   * 会让钩子钉死 boot 时的实例——ctx.compaction 晚于 tasks boot 挂载即 D3 永久静默,先挂载
   * 的宿主级(standard 默认参)实例会顶住后挂载的会话特化组。本面在每次边界触发时现读:
   * 入参 = 已解析的主会话 agent(实现应先读 agent.ctx——会话按角色 preset 挂载的压缩组
   * isolate.compaction 在 agent 作用域可见,orchestrator 特化参数由此作用于 D3),落空再
   * 落宿主 ctx;返回 undefined = 端口缺席(debug 跳过,fail-open 不阻断工单流)。
   * 显式注入 options.compaction 恒优先——两者同时在位时本面不消费;defineTasksPlugin 派生
   * 路径注入本面(不再落 compaction),显式注入走 compaction 钉死语义(glue 决策)。
   */
  readonly compactionResolve?: (agent: Agent) => CompactionSeam | undefined
  /**
   * 边界压缩钩子的 debug 日志面(53 号 §3-D3「busy 静默跳过」的观测位):busy/agent 不可
   * 解析/压缩失败都只经本面记一条 debug,绝不重试、绝不外溢。缺省静默——观测面可缺席,
   * 行为不变(fail-open 纪律);defineTasksPlugin 自宿主 ctx.logger 派生注入。
   */
  readonly compactionDebugLog?: (message: string) => void
  /**
   * 候选评估的线程上下文读取端口(A19/A21 接线位;缺省不提供——候选评估只用触发文本与批次,
   * 候选卡与 context 的 thread 节给「该 Source 无线程上下文」的显式说明)。
   */
  readonly threadContext?: (trigger: Trigger) => TriggerContext | undefined
  /**
   * 候选卡到主会话的投递面(A19/A22 接线位:Sessions.promptHeld(masterId, requestId, …, 'queue');
   * ★最后一公里(2026-11-18):glue 未显式注入且 sessionHost 在场时自派生同式注入
   * (Sessions 就绪后接线,见 assessor/sessionHost 两处装配注)——候选卡送达主会话,
   * **resolve 即已进入主会话回合**(不是仅入 inbox),deadline 此刻才启动;忙碌主会话的
   * 排队时间不消耗评估超时(2026-11-19 重复候选卡修复)。glue 与 sessionHost 皆缺席时
   * 才保持「不投递、候选由调用方显式 decide」的测试语义。
   */
  readonly deliverCandidate?: (requestId: string, text: string) => Promise<void>
  /** 候选评估的有界仓库读取端口(A21 接线位;缺省不可用——orchestrator_eval_read 的 file/directory 显式报缺)。 */
  readonly readPath?: (path: string, kind: 'file' | 'directory', signal?: AbortSignal) => Promise<string>
  /** 一条 Trigger 的来源消息链接(A21 sources 接线;缺省不带链接)。 */
  readonly sourceLink?: (trigger: Trigger, signal?: AbortSignal) => Promise<{ source_url?: string; source_url_read?: string }>
  /** `trigger` 在回复某条已存 Trigger 时,那条被回复的 Trigger(A21 接线位;缺省未知)。 */
  readonly repliedTo?: (trigger: Trigger) => Trigger | undefined
  /** 名单同步端口(orchestrator_policy_sync 的后端;A21 接线位,缺省该工具报 nothingToSync)。 */
  readonly syncSource?: (source: string, signal?: AbortSignal) => Promise<{ id: string; name?: string }[]>
  /**
   * A22 真实执行面接线端口(35 号 A22;34 号 §2.4/§2.5):宿主 DSH session 服务束
   * (context + SessionHostPorts 结构端口;glue 按 access 包 tenant.ts `serviceOf` 的
   * ctx.reflect 反射惯例从宿主 ctx 适配注入)。
   * 在场时 'executor' 装配步以真实 **DshExecutor+Sessions** 替换 StubExecutor
   * (每工单一条 `worker-<ticketId>` DSH session、租户 realm 工作区内建会话;install()
   * 四类宿主事件 + resume() 对账,A0 评审处置 D3/D4);缺席时保持可控 stub
   * (34 §4-E 假件记账语义,plugin-boot 判据面)。★最后一公里(2026-11-18 三断点④):
   * defineTasksPlugin 在 glue 未显式注入时自宿主 ctx 机会读取 sessionController/
   * workspaceRegistry/permissionPresets/sessionPersistence/agents 服务束派生注入
   * (任一缺席/缺方法即不派生,回落 stub;`TasksRuntime.executor` 联合类型保持)。
   * `masterId` 就绪可缺(sessionHost.masterId 可选):装配的 master 会话引导解析
   * (config.masterId → 本键 → KV 既有约定 → 约定派生 orchestrator-<realm>)兜底;
   * 仅注入面:worker session 由 executor 按需 ensure;显式注入 masterId 的主会话建立
   * 仍归 glue 装配(工作区根与标题属部署决策),master session 缺席时 relay 投递按
   * Effects 重试等待,不炸内核;约定派生的 id 由装配经 Sessions.ensure 确保存在。
   */
  readonly sessionHost?: Omit<SessionsHost, 'effects' | 'lifetime' | 'masterId'> & { readonly masterId?: string }
  /** pass 周期 ms(缺省 PASS_INTERVAL_MS=2000,28 号 §8-3)。 */
  readonly passIntervalMs?: number
  /**
   * 主会话(orchestrator)的 session id([active-tickets] section 的会话过滤面,A24;SA
   * masterId 模式,SA app/sessions.ts ROUTER_PRESET 同位):master 会话引导解析的最高优先级
   * 来源(config 显式 > sessionHost.masterId > KV 既有约定 > 约定派生;解析结果恒写 KV,
   * 重启复用)。在场时 [active-tickets] section 的 text provider 按装配上下文的 agent id
   * fail-closed 过滤——只在主会话装配渲染(28 号 §6「给主 Session 增加」);缺席(宿主
   * session 面不在场且 KV 空)时不做会话过滤,过滤交由注册面的 scope。仅注入面:本键
   * 自身不触发建会话(约定派生的会话建立由 sessionHost 在场路径经 Sessions.ensure 承担)。
   * ★webchat 委派入口(35-A21 诊断清单①/②)共用本面:主会话白名单——入口只监听本会话的
   * 用户消息,orchestrator 工具面只在主会话可见;解析后仍缺席(裸宿主且无 KV)时不接
   * 入口、工具面退回「非 worker 会话」基线(不猜主会话)。
   */
  readonly masterId?: string
  /**
   * 会话主人解析端口(webchat 委派入口的发送者面,35-A21 目标行为「发送者=会话主人」;
   * glue 按 access 账号面注入,与 dirOf 的 accountOf 同源):主会话用户消息归一化为 Trigger
   * 时解析其行动者;返回 undefined 即跳过该消息(fail-closed,不带无主 Trigger 进引擎)。
   * 缺省以本栈绑定的 realm(账号)为主人——单 realm 一账号栈,主会话的主人是部署账号本身;
   * 准入仍由 gate 按名单 × addressed='direct' 裁定,本端口只回答「谁说的」。
   */
  readonly sessionOwner?: (sessionId: string) => ActorRef | undefined
  /** 领域事件装配位订阅(observe/测试用既有接口位;先于 TasksWorld.subscribe 订阅方到达;每事件回调一次,载荷见 core/ports.ts DomainEvents)。 */
  readonly onEvent?: (event: DomainEvent) => void
  /** 时钟注入(Effects 退避/健康时刻;缺省 Date.now)。 */
  readonly now?: () => number
}

/** 聚合健康面(35 号 A16④「health() 供工作台与探针」):aggregate 单值 + 组件明细(HealthBoard.all)。 */
export interface TasksHealth {
  /** 聚合态:任一组件 error → error;处理暂停(settings.paused)→ paused;否则 ready。 */
  readonly state: Health['state']
  readonly detail: string
  readonly at: string
  /** 组件健康明细(键 = 装配级 'tasks' 与各 effect kind;Effects/HealthBoard 认领制)。 */
  readonly components: Readonly<Record<string, Health | undefined>>
  /**
   * orchestrator 主会话 id(★master 会话引导,2026-11-18 出票端到端三断点①:masterId
   * 经 health()/stats() 暴露,工作台与探针消费;未引导——宿主 session 面不在场且
   * config/KV 皆缺席——时缺省,不猜主会话)。
   */
  readonly masterId?: string
}

/** 任务内核最小状态面(35 号 A16④;工作台与探针消费,26 §2.1-1):全部为只读计数,不含领域载荷。 */
export interface TasksStats {
  readonly realm: string
  readonly tickets: { readonly open: number; readonly active: number; readonly total: number }
  readonly threads: { readonly active: number; readonly subscribed: number }
  readonly triggers: { readonly total: number }
  readonly decisions: { readonly total: number }
  readonly effects: { readonly waiting: number; readonly byKind: Readonly<Record<string, number>> }
  readonly outbox: { readonly pending: number; readonly dropped: number }
  readonly policy: { readonly version: string; readonly paused: boolean; readonly evalMode: Settings['eval']['mode']; readonly rules: number }
  readonly executor: {
    /** 配置的并发槽上限(settings.executor.maxWorkers)。 */
    readonly maxWorkers: number
    /**
     * ★当前真实占用的槽数(2026-11-23 线上修复):DshExecutor 的 WorkerSlots 读数——
     * 在跑回合 + 正在启动的 launch。缺席(stub 执行面/未接线)时如实 0。
     *
     * 为什么补这一项:工作台此前只能用工单领域态推算占槽数,而 Assignment 的 `running`
     * 是领域态(`pending→running→ended`,只由 endAssignment/工单 end 迁移),worker 报
     * `waiting` 后回合早已结束,槽位「n/m」与「运行 N 分钟」因此虚高(生产实证 2843 分钟)。
     * 投影层仍保留 ticketStage 派生作离线/快照面的诚实近似,但在线读数以本项为唯一权威。
     */
    readonly usedSlots: number
  }
  /** orchestrator 主会话 id(★master 会话引导;undefined = 未引导,不猜主会话)。 */
  readonly masterId: string | undefined
}

/**
 * 只读快照读取面返回(38 号 T15 SSE 快照;30 号 §3 快照范围「当前工单/线程/worker 状态」中
 * tasks 内核可供给的工单/线程两节,领域态原样;worker 节归上游 session/jobs 事件,
 * ★A22 替换点接线后由消费面扩)。读走 store 仓储面,写者唯一纪律不破
 * (34 号 §3「read 面只读投影走 store/reads.ts,不经 Engine」同款纪律)。
 */
export interface TasksSnapshotView {
  /** 本栈绑定的租户 realm(载荷按 realm 归账;38 号 §6.12「ticket.ended 载荷带 realm」同源)。 */
  readonly realm: string
  /** 当前全部工单(含已结束;开放/卡点分面由消费方投影,分类口径 = core/stage.ts ticketStage)。 */
  readonly tickets: readonly Ticket[]
  /** 当前全部线程(含订阅关系;信息流图 Thread 节点与订阅面的投影输入)。 */
  readonly threads: readonly Thread[]
}

/** `ctx.tasks` 服务面(26 §2.1-1 与 ctx.audit 同构;注册表 + TASKS_SERVICE_ID 唯一 ID)。 */
export interface TasksWorld {
  /** 服务 id(TASKS_SERVICE_ID;注册表形态标记)。 */
  readonly id: typeof TASKS_SERVICE_ID
  /** 本栈绑定的租户 realm。 */
  readonly realm: string
  /** 装配启动序(store→effects→outbox→engine→assessor→executor→sources;34 §4-E 观测面)。 */
  readonly boot: readonly string[]
  /** 关停执行序(= boot 逆序;dispose 逐 stop 回放时记录)。 */
  readonly shutdown: readonly string[]
  /** 领域引擎(EngineForSources/MainSession/People/Settings/Executor 角色面经 Pick 消费)。 */
  readonly engine: Engine
  /** 聚合健康面(供工作台与探针)。 */
  health(): TasksHealth
  /** 最小状态面(供工作台与探针)。 */
  stats(): TasksStats
  /**
   * 领域事件订阅面(38 号 T15 M4 实接的数据面;observe 冲突指标/工作台 live hub 的
   * 桥接接口位):多播,每事件回调一次,载荷见 core/ports.ts DomainEvents
   * (13 类事件,枚举以该端口清单为准——38 号 O-1);返回退订闭包;dispose 退订全部。
   * 订阅方异常不外溢(不破内核事务);装配位 onEvent(TasksOptions)先于订阅方到达。
   */
  subscribe(listener: (event: DomainEvent) => void): () => void
  /** 只读快照读取面(38 号 T15 SSE 快照;30 号 §3「连接先推全量快照」):本 realm 当前工单/线程领域态。 */
  snapshot(): TasksSnapshotView
  /**
   * 只读查询面(38 号 T15 工作台 live 源的计数读数:7 日 trigger/routed 决策/kind
   * 计数等;store/reads.ts 之外的即席只读查询)。仅接受 SELECT(白名单校验,
   * fail-closed)——写路径唯一经 Engine 事务(34 号 §2.1 单写者),本面零写入。
   * @throws 非 SELECT 语句或内核已关停时。
   */
  query(sql: string, ...parameters: unknown[]): unknown[]
  /** 手动排一次 pass(Engine.evaluateDue + [active-tickets] 缓存刷新;探针与测试用;周期驱动由 PassDriver 承担)。 */
  pass(): void
  /**
   * [active-tickets] 活跃工单清单 section(35 号 A24;28 号 §6;34 号 §2.5 sections 行):
   * pass 周期刷新的缓存文本面,经 prompt section seam 注入(defineTasksPlugin 在宿主
   * system-prompt 服务在场时注册;缺席则由宿主装配经本面自取注册)。刷新=runtime.pass()。
   */
  readonly activeTickets: ActiveTicketsSection
  /**
   * orchestrator 主会话 id(★master 会话引导解析结果,2026-11-18 出票端到端三断点①;
   * 恒已写 KV `KV.master.session`):config.masterId → sessionHost.masterId → KV 既有约定
   * → 宿主 session 面在场时的约定派生(`masterSessionId(realm)`);四者皆不可得(裸宿主
   * 且无 config)时 undefined,不猜主会话。webchat 入口安装、缺省 scope 监听、
   * [active-tickets] 会话过滤与 orchestrator 工具面可见性共用本面;服务形态暴露供
   * 工作台与探针消费(health()/stats() 同时带同值)。
   */
  readonly masterId: string | undefined
  /**
   * 任务设置面(2026-11-19 会话级 super 标记 + 任务设置分区):面板/宿主面经
   * `ctx.tasks.settingsFace` 读写设置——写只经 saveSettingsBlock(分块 CAS + policyChanged
   * 原子面),读为纯投影。access 路由面经反射键 'tasks' 结构解析(见 access/routes.ts
   * TasksSettingsFace 结构面,不 import 本包)。
   */
  readonly settingsFace: TasksSettingsFace
  /** 关停:装配逆序回放(34 §4-E「关停配逆」);幂等。 */
  dispose(): void
}

/** createTasks() 装配产物:TasksWorld 服务面 + 组件句柄(测试与 glue 深消费用)。 */
export interface TasksRuntime extends TasksWorld {
  readonly router: TasksRealmRouter
  readonly store: Store
  /**
   * 生效的策略接线(Listing 名单 + 版本注入面;2026-11-19 起为装配内**唯一可变对象**——
   * 面板保存经 settingsFace 回写 version,Engine/工具宿主共用同一实例,消除版本漂移)。
   */
  readonly wiring: PolicyWiring
  readonly effects: Effects
  readonly outbox: Outbox
  readonly assessor: MasterAssessor
  /** 执行面:sessionHost 注入即真实 DshExecutor(★A22 接线),否则可控 stub(34 §4-E)。 */
  readonly executor: StubExecutor | DshExecutor
  /** worker session 面(sessionHost 注入时在场;A22;glue/测试深消费)。 */
  readonly sessions: Sessions | undefined
  /** 生效的角色 preset 选择(53 号 §4-P0 探针面):主/worker 建会话请求 agentPreset 的实际
   * 取值——显式注入 > 派生束常量(值即 src/session/presets.ts,boot 日志 presets 段同源);
   * stub 装配(无宿主 session 面,不建会话)为 undefined。 */
  readonly presets: Partial<Record<SessionRole, string>> | undefined
  /** A21 channels 入站汇(被动;glue 注给 channels webhook 网关 sink 位,39 §3-E3)。 */
  readonly sources: ChannelTriggerAdapter
  readonly board: HealthBoard
  /** 生效的 D1 subagent_policies(35 号 A18;缺省 DEFAULT_SUBAGENT_POLICIES;A20 worker 派生工具消费)。 */
  readonly subagentPolicies: SubagentPolicies
}

/** ctx.tasks 服务属性(governance-plugin 的 declare module 增广同款;provide('tasks') → ctx.tasks)。 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** tasks 服务(注册表 + TASKS_SERVICE_ID 唯一 ID;defineTasksPlugin 装配)。 */
    tasks?: TasksWorld
  }
}

/**
 * pass 驱动——pass 周期合并调度 Engine.evaluateDue(35 号 A16「pass 驱动…机制并入装配」;
 * 34 §2.6 第二行 SA passes.ts 不整体移植、机制按需重写)。
 * 依据:28 号 §8-3(pass 周期 2s,24a C6 拍板)——Engine 时钟([active-tickets] 清单刷新、
 * evaluateDue 的到期重排/线程 Eval 启动/已结束工单恢复)由本驱动按周期触发;合并语义:
 * 上一轮在跑时不重入(欠账一次,跑完即清,下个周期照常);处理暂停期间照常驱动(暂停的
 * deadline 顺延与恢复重排在 Engine/evals 内部)。定时器 unref,不阻宿主退出。
 * 导出仅为其单测面(35 号 A27 具名门禁 tests/pass.spec.ts 以假件直测合并/停驱语义;
 * 生产面仍由 createTasks 装配持有,不改任何行为语义)。
 */
export class PassDriver {
  private timer: ReturnType<typeof setInterval> | undefined
  private running = false
  private readonly engine: Pick<Engine, 'evaluateDue'>
  private readonly intervalMs: number
  constructor(engine: Pick<Engine, 'evaluateDue'>, intervalMs: number) {
    this.engine = engine
    this.intervalMs = intervalMs
  }
  start(): void {
    if (this.timer !== undefined) return
    const timer = setInterval(() => { this.pass() }, this.intervalMs)
    timer.unref()
    this.timer = timer
  }
  /** 一轮 pass;合并:在跑时欠账一次(不排队堆积),跑完即清。 */
  pass(): void {
    if (this.running) return
    this.running = true
    try { this.engine.evaluateDue() } finally { this.running = false }
  }
  stop(): void {
    if (this.timer === undefined) return
    clearInterval(this.timer)
    this.timer = undefined
  }
}

/** BoundaryCompaction 的装配依赖(compaction/resolveCompaction 二选一——createTasks 仅在接线条件齐备时构造)。 */
export interface BoundaryCompactionDeps {
  /** 显式注入的 compaction 端口(glue 决策恒优先;与 resolveCompaction 同时在位时本面优先)。 */
  readonly compaction?: CompactionSeam
  /**
   * 派生端口的每触发现读面(F3 复审修复;入参 = 已解析的主会话 agent)。实现应先读
   * agent 作用域(compactionFromAgent,会话特化压缩实例所在)再落宿主 ctx;返回 undefined =
   * 端口缺席(debug 跳过,不阻断)。与 compaction 二选一。
   */
  readonly resolveCompaction?: (agent: Agent) => CompactionSeam | undefined
  /** 主会话 agent 解析面(masterId → 宿主 Agent;不可解析返回 undefined)。 */
  readonly resolveAgent: () => Promise<Agent | undefined>
  /** 装配关停信号(lifetime;dispose 中止在跑的压缩尝试)。 */
  readonly signal: AbortSignal
  /** debug 观测面(缺省静默——观测面可缺席,行为不变)。 */
  readonly debug?: (message: string) => void
}

/**
 * 工单边界压缩钩子(53 号 §3-D3/§4-P3「任务边界触发」;20 号 §3.1 附加触发):工单进入终态
 * (`ticket.ended` 落定)时,若主会话在场且 agent 可解析,经结构端口发起一次 compactNow——
 * 让压缩 checkpoint 落在任务干净边界,摘要质量最高。
 *
 * idle 与「无在途投递」的裁决在宿主 compactNow 内部(dsh runMaintenance 保留 next-turn
 * admission:会话非 idle 或有 waking queued work——在途/排队投递——即抛 code='busy'),本钩子
 * 不预判不复制该闸;busy 即预期分支:debug 日志静默跳过,下一工单边界再试。fail-open 纪律:
 * 每事件恰一次尝试,任何失败(busy/解析失败/压缩报错/关停中止)只记 debug,绝不重试(无重试
 * 风暴)、绝不外溢、绝不阻断工单流(emitEvent 分发器事务内同步回调,本钩子首行即异步让路,
 * 不碰内核事务)。
 * 导出仅为其单测面(53 号 §4-P3 具名单测;PassDriver 同款纪律),生产面由 createTasks 装配持有。
 */
export class BoundaryCompaction {
  private readonly deps: BoundaryCompactionDeps
  constructor(deps: BoundaryCompactionDeps) {
    this.deps = deps
  }
  /**
   * 领域事件入口(createTasks 的 emitEvent 装配位调用):只认 `ticket.ended`,其余事件零开销
   * 直返。返回的 promise 供单测 await;生产面以 `void` 消化(fire-and-forget,trigger 不拒)。
   */
  onEvent(event: DomainEvent): Promise<void> {
    if (event.type !== 'ticket.ended') return Promise.resolve()
    return this.trigger(event.data.ticketId)
  }
  /** 一次边界压缩尝试:每事件恰一次,失败不重试(下一工单边界再试);任何失败不外溢。 */
  async trigger(ticketId: string): Promise<void> {
    const { resolveAgent, signal } = this.deps
    let agent: Agent
    try {
      const resolved = await resolveAgent()
      if (resolved === undefined) {
        this.log(`主会话 agent 不可解析,工单 ${ticketId} 的边界压缩跳过(下一工单边界再试)`)
        return
      }
      agent = resolved
    } catch (error) {
      this.log(`主会话 agent 解析失败,工单 ${ticketId} 的边界压缩跳过(不重试,不阻断工单流):${String(error)}`)
      return
    }
    // 端口解析(显式注入钉死 / 派生现读,见 BoundaryCompactionDeps 注):缺席即 debug 跳过
    // ——F3 修复前「boot 缺席 = 钩子整体不接线」的永久静默,收敛为每次触发的可见跳过。
    let seam: CompactionSeam | undefined
    try {
      seam = this.deps.compaction ?? this.deps.resolveCompaction?.(agent)
    } catch (error) {
      this.log(`compaction 端口现读失败,工单 ${ticketId} 的边界压缩跳过(不重试,不阻断工单流):${String(error)}`)
      return
    }
    if (seam === undefined) {
      this.log(`compaction 端口缺席(压缩组未挂载),工单 ${ticketId} 的边界压缩跳过(下一工单边界再试)`)
      return
    }
    try {
      await seam.compactNow(agent, signal)
    } catch (error) {
      // busy = 宿主 idle 闸(会话非 idle 或有在途投递)——预期分支,静默跳过(53 号 §3-D3
      // 「下一边界再试」);其余失败同口径记 debug。判别按 code,不 instanceof(CompactionSeam 注)。
      const code = (error as { code?: unknown } | null | undefined)?.code
      this.log(code === 'busy'
        ? `主会话忙碌(非 idle 或有在途投递),工单 ${ticketId} 的边界压缩静默跳过,下一工单边界再试`
        : `工单 ${ticketId} 边界压缩失败(不重试,不阻断工单流):${String(error)}`)
    }
  }
  private log(message: string): void {
    this.deps.debug?.(`[tasks] ${message}`)
  }
}

/**
 * createTasks() 装配入口(35 号 A16;34 §1「门面 re-export + createTasks() 装配入口」)。
 *
 * 按序装配 store→effects→outbox→engine→assessor→executor→sources(sources 留接口位),
 * 每步以 `begin` 记录启动序并登记其关停回调;`dispose()` 按登记逆序回放(34 §4-E
 * 「装配启动顺序…与关停配逆」)。fail-closed:**注入的** dirOf 解析失败(realm 工作区不存在)
 * 即抛错不开库(23 号 §3.1「宁可拒一次,不可跨租户写」;realm.ts 头注同款铁律)——缺省派生
 * (defaultTasksDirOf)的部署指名 realm 由 Store 引导自建目录,不在此闸内。
 *
 * 关停语义:'effects' 步的关停为 fire-and-forget drain(宿主 disposer 不可 await,
 * audit/memory 插件同款)——在跑 attempt 的落库可能因 store 随后关闭而失败,行已持久、
 * 下次 start 重派(effects-resume 语义;34 §2.3「drain 留行等下次 start」)。
 * @throws 当注入的 dirOf 解析失败(fail-closed,23 号 §3.1)或 Store 开库失败时。
 */
export function createTasks(options: TasksOptions = {}): TasksRuntime {
  const realm = options.realm ?? DEFAULT_TASKS_REALM
  const tenantRoot = options.tenantRoot ?? defaultTenantRoot()
  const dirOf = options.dirOf ?? defaultTasksDirOf(tenantRoot)
  const intervalMs = options.passIntervalMs ?? PASS_INTERVAL_MS
  const nowMs = options.now ?? ((): number => Date.now())
  const nowIso = (): string => new Date(nowMs()).toISOString()
  // D1 subagent_policies(35 号 A18):缺省只读 reviewer 类;注入声明 fail-closed 校验——
  // 违规声明(词汇表外工具/变更型工具/非 false 嵌套)装配期即拒,不带病上岗。
  const subagentPolicies = options.subagentPolicies ?? DEFAULT_SUBAGENT_POLICIES
  const policyErrors = validateSubagentPolicies(subagentPolicies)
  if (policyErrors.length) {
    throw new Error(`subagent_policies 声明段未过校验(fail-closed,24a D1):${policyErrors.join('; ')}`)
  }
  const board = new HealthBoard()
  // 装配级健康项(34 §2.6「健康面并入装配与 effects」):starting → ready;dispose 时注销。
  const self = board.claim('tasks', { state: 'starting', detail: '任务内核装配中', at: nowIso() })
  /** 启动序记录(34 §4-E 观测面)。 */
  const boot: string[] = []
  /** 关停执行序记录(= 逆序回放)。 */
  const shutdownLog: string[] = []
  /** 各装配步的关停回调(登记序 = 启动序;dispose 逆序回放)。 */
  const steps: { name: string; stop: () => void }[] = []
  const begin = (name: string, stop: () => void = (): void => {}): void => {
    boot.push(name)
    steps.push({ name, stop })
  }
  let disposed = false
  /**
   * 领域事件多播分发(38 号 T15 订阅面的装配实现):装配位 onEvent(TasksOptions,
   * 既有接口位)先达;subscribe() 的订阅方随 Set 迭代序后达。订阅方异常就地吞没——
   * Engine 在事务内同步回调 emit(core/part.ts emit 行),订阅方异常外溢会破内核事务
   * (24 号 §5.3-5/6「横切不拥有业务状态」的服务化表达);dispose 时退订全部。
   */
  const eventListeners = new Set<(event: DomainEvent) => void>()
  const emitEvent = (event: DomainEvent): void => {
    options.onEvent?.(event)
    for (const listener of eventListeners) {
      try { listener(event) } catch { /* 订阅方异常不外溢(见上注) */ }
    }
  }

  // ── ① store:realm → 租户库(TasksRealmRouter 池;一租户一 SQLite,24a A1)────────
  const router = new TasksRealmRouter({
    dirOf,
    create: (dir, realmName) => new Store(realmName, { workspaceDir: dir, report: (error): void => { self.set({ state: 'error', detail: `afterCommit 回调失败:${String(error)}`, at: nowIso() }) } }),
  })
  const store = router.forRealm(realm)
  if (store === undefined) {
    throw new Error(`任务内核 realm「${realm}」的工作区目录不存在(fail-closed 不开库,23 号 §3.1):${join(tenantRoot, realm)}`)
  }
  // 库由 router 池持有:store 是首个装配步,其关停(全池 close)在逆序回放中最后执行。
  begin('store', (): void => { router.dispose() })

  // ★master 会话引导·解析半边(①;2026-11-18 出票端到端三断点①「masterId 缺席 → 入口
  // 不装 → Trigger 未入」):orchestrator 主会话 id 按「config.masterId 显式 → sessionHost
  // .masterId 显式 → KV 既有约定 → 宿主 session 面在场时的确定性约定派生
  // (orchestrator-<realm>,SA app/runtime.ts:104 KV runtime.masterId 同序同构)」解析;
  // 解析结果恒写 KV(KV.master.session)——重启后 config 缺席也恒可复得同一主会话。四者
  // 皆不可得(裸宿主且无 config)时 undefined:不猜主会话,webchat 入口不装、scope 对
  // webchat 恒 filtered、工具面退回「非 worker 会话」基线(fail-closed)。会话本体的确保
  // 存在(ensure)在 sessionHost 在场路径的引导半边(下方 executor 步)承担。
  const kvMaster = store.get(KV.master.session)
  const masterId: string | undefined = options.masterId ?? options.sessionHost?.masterId ?? kvMaster
    ?? (options.sessionHost !== undefined ? masterSessionId(realm) : undefined)
  if (masterId !== undefined && masterId !== kvMaster) store.set(KV.master.session, masterId)

  // ── ② effects:持久副作用队列(本步内 start;handler 由 outbox 等随后注册时 kick 重派)──
  const effects = new Effects(store, board, nowMs)
  effects.start()
  begin('effects', (): void => { void effects.drain().catch(() => { /* 关停竞态的错误不阻宿主 */ }) })

  // ── ③ outbox:回执投递(channels 适配器端口注入;缺省自宿主 ctx 派生,无 channels 服务保持挂起)──
  const outbox = new Outbox({
    store,
    effects,
    channels: options.channels ?? UNWIRED_CHANNELS,
    paused: (): boolean => store.settings().paused,
  })
  begin('outbox')

  // ── ④ engine:Intake/Evals/Tickets/Assignments/Replies 全链 + pass 驱动(28 号 §8-3)────
  // sources 接口位的端口面:scope 是 Engine 的构造输入(纯函数),随本步消费;'sources' 装配步
  // (⑤后)留待 A21 启动 Source 适配器/轮询。缺省面为 webchatMasterScope 真实现(三断点③,
  // 替换旧 UNWIRED_SCOPE 一律不监听):masterId 经 getter 现读——引导解析已在上文落定,
  // 后续重启自 KV 复得也恒走同一闭包。
  const scope = options.scope ?? webchatMasterScope((): string | undefined => masterId)
  const wiring: PolicyWiring = {
    ...(options.allowed !== undefined ? { allowed: options.allowed } : {}),
    ...(options.policyVersion !== undefined ? { version: options.policyVersion } : {}),
  }
  // ★A19 替换点(35 号 A19):MasterAssessor 接线——per-eval 状态隔离/候选卡投递('assessment'
  // 持久 effect)/TextCache。线程上下文为端口注入(A21 接线位;缺省候选卡带「无线程上下文」
  // 说明);投递面注入优先,glue 缺席且 sessionHost 在场时惰性自派生(★最后一公里·候选卡,
  // 2026-11-18:assessor 构造早于 Sessions 实例,故经 deliverRef 现读——Sessions 就绪后
  // `deliverCandidate = Sessions.promptHeld(masterId, requestId, text, 'queue')`,候选卡由此
  // 送达主会话、**被回合收走**才 resolve、deadline 才启动(仅入 inbox 的排队时间不消耗
  // 评估超时);两者皆缺席保持「不投递、未送达永不过期」原语义)。
  // 实例先于 engine 构造(Engine 构造输入),engine 以 getter 惰性取用——handler 首次运行
  // (effects 已 start,见②)不早于 engine 就绪;'assessor' 装配步标注其关停(stop 中断在跑读取)。
  const deliverRef: { value?: (requestId: string, text: string) => Promise<void> } = {}
  const assessor = new MasterAssessor({
    get engine(): Pick<EngineForMainSession, 'candidate' | 'candidateDelivered' | 'decide'> { return engine },
    effects,
    settings: (): Settings => store.settings(),
    paused: (): boolean => store.settings().paused,
    ...(options.threadContext ? { threadContext: options.threadContext } : {}),
    ...(options.deliverCandidate !== undefined || options.sessionHost !== undefined
      ? { deliver: options.deliverCandidate ?? ((requestId: string, text: string) => {
        const impl = deliverRef.value
        if (impl === undefined) return Promise.reject(new Error('候选卡投递面未就绪(Sessions 尚未装配)'))
        return impl(requestId, text)
      }) }
      : {}),
    ...(options.readPath ? { readPath: options.readPath } : {}),
    ...(options.sourceLink ? { sourceLink: options.sourceLink } : {}),
    ...(options.repliedTo ? { repliedTo: options.repliedTo } : {}),
    store,
  })
  // ★A22 替换点(35 号 A22;34 号 §2.4/§2.5):sessionHost 注入即真实执行面接线——
  // Sessions(A0 §5-C11 宿主 session 服务面的结构端口:resolveAgent/create/rename +
  // workspaceRegistry + permissionPresets + sessionPersistence)+ DshExecutor(每工单一条
  // `worker-<ticketId>` DSH session、租户 realm 工作区内建会话)。缺席保持可控 stub
  // (34 §4-E 假件记账语义,plugin-boot 判据面)。Engine 需 executor 于构造输入、
  // ExecutorHost 需 engine 于事件回调:engine 以 getter 惰性供给(fixtures/host.ts 同构
  // 先例;effects 在②已 start,handler 首跑不早于 engine 就绪)。
  const lifetime = new AbortController()
  const engineRef: { value?: Engine } = {}
  const stubExecutor = new StubExecutor()
  let executor: StubExecutor | DshExecutor = stubExecutor
  let sessions: Sessions | undefined
  let dshExecutor: DshExecutor | undefined
  /** 生效的角色 preset 选择(53 号 §4-P0 探针面):建会话请求 agentPreset 的实际取值(executor 步赋值)。 */
  let rolePresets: Partial<Record<SessionRole, string>> | undefined
  /** master 会话引导健康项('master';仅约定派生路径认领,见下——采信 id 的建立归 glue)。 */
  let masterHealth: HealthEntry | undefined
  if (options.sessionHost !== undefined) {
    // 引导解析保证 sessionHost 在场时 masterId 就绪(约定派生分支);?? 兜底同式,仅类型收窄。
    // ★角色模型播种(46 号;A25 role-models 消费端):宿主 sessionHost 未显式带 roleModel
    // 时,按角色现读租户 settings——eval.model = orchestrator(主会话),executor.model =
    // worker(工单执行);null = 不播种、随宿主会话默认。每次 ensure 现读(getter),设置在
    // 主会话/面板热改后下一次建/取会话即生效,不需重启。显式注入恒优先(同 deliverCandidate)。
    const roleModel = options.sessionHost.roleModel ?? ((role: SessionRole): RoleModel | null =>
      role === 'orchestrator' ? store.settings().eval.model : store.settings().executor.model)
    // ★R22 preset/prompt 接线(2026-11-21;交付审计 §2.1 修复方案落地):
    // - presets:双角色建会话即选 tasks 专属 preset(orchestrator 只含路由工具面、
    //   worker 只含执行工具面;A25 cordis.patch.yml 两组行,restatement 已进 super
    //   模板与开发档 profile——registry 由 preset 行的 config.id 解析,常量即
    //   src/session/presets.ts,preset.spec 交叉钉住)。显式注入恒优先。
    // - rolePrompt:每次 ensure 经该 agent 自己的 agent.ctx.systemPrompt.section
    //   注册(additive,order 0,provider 现算——Policy 段按当前 settings,热改即生效;
    //   每 agent 一次,见 sessions.ts registerRoleSection)。组合面用与设置面板同一
    //   的 Prompts(同一 store,读支无状态),使面板改的团队段/覆盖件对角色 prompt
    //   立即生效。既有主会话(标准 preset 记账)随 ensure 复用即获得角色 section;
    //   其 recorded preset 的替换归会话重建(见审计 §2.1 备注)。
    const rolePrompts = new Prompts(store)
    // 生效 preset 选择(53 号 §4-P0):显式注入的 options.sessionHost.presets 恒优先(可为
    // Partial——只注入一角色,另一角色随宿主缺省);缺席时回双角色常量。派生束自 P0 起已
    // 自带同值(本行对派生路径幂等取同),对 glue 显式注入但不带 presets 的路径为回退面。
    rolePresets = options.sessionHost.presets ?? { orchestrator: ORCHESTRATOR_PRESET_ID, worker: WORKER_PRESET_ID }
    sessions = new Sessions({ ...options.sessionHost, effects, lifetime: lifetime.signal,
      masterId: masterId ?? masterSessionId(realm), roleModel,
      presets: rolePresets,
      rolePrompt: (role: SessionRole): string => rolePrompts.compose(rolePrompts.current().config, role) })
    // ★候选卡投递面·自派生(★最后一公里·候选卡,2026-11-18):glue 未显式注入
    // deliverCandidate 时,Sessions 就绪即接线——候选卡经 Sessions.promptHeld 投到主会话
    // ('queue';kind 'eterna-tasks' 的投递消息不与用户亲口消息混淆,sessions.ts 头注)。
    // promptHeld 等到消息被回合收走才 resolve:主会话忙碌时卡只在排队区等,**不**起评估
    // deadline(修复同一触发每 120s 超时重投的重复候选卡)。主会话模型经
    // orchestrator_eval_decide 裁决(A19/A20 回路)。显式注入恒优先。
    if (options.deliverCandidate === undefined) {
      const wiredSessions = sessions
      deliverRef.value = (requestId, text): Promise<void> =>
        wiredSessions.promptHeld(masterId ?? masterSessionId(realm), requestId, text, 'queue')
    }
    dshExecutor = new DshExecutor({
      context: options.sessionHost.context,
      get engine() { return engineRef.value as ExecutorHost['engine'] },
      store,
      outbox,
      effects,
      health: board.claim('worker'),
      lifetime: lifetime.signal,
      sessions,
      closing: (): boolean => lifetime.signal.aborted,
      paused: (): boolean => store.settings().paused,
      ...(options.sourceLink !== undefined ? { sourceLink: options.sourceLink } : {}),
      ...(options.repliedTo !== undefined ? { repliedTo: options.repliedTo } : {}),
    })
    executor = dshExecutor
    // ★master 会话引导·确保存在半边(①):仅当 id 未由 config/sessionHost 显式注入、且解析
    // 结果即本装配的确定性约定(`orchestrator-<realm>`)时经宿主 session 面建立
    // (Sessions.ensure = resolveAgent → 缺则建 → 权限 preset → rename;SA
    // runtime.ts:210 ensure(masterId, …, 'orchestrator') 同构,resolveAgent 已有即复用
    // 故幂等——首次引导派生与重启自 KV 复得两条路径同走此处)。显式注入/采信 id
    // (config/sessionHost)的会话建立归 glue 装配(工作区根与标题属部署决策,
    // TasksOptions.sessionHost 注:本装配不改写其标题)——缺席时 relay 投递按 Effects
    // 重试等待,不炸内核。fire-and-forget:宿主 disposer 不可 await(effects 步同款);
    // 失败经 'master' 健康项上报,不外溢装配;关停在 executor 步释放健康项
    // (ensure 晚于关停落定时 set 为 no-op,认领制 held 闸)。
    if (options.masterId === undefined && options.sessionHost.masterId === undefined
      && masterId === masterSessionId(realm)) {
      masterHealth = board.claim('master', { state: 'starting', detail: 'master 会话引导中', at: nowIso() })
      const bootstrapping = masterId
      void sessions.ensure(bootstrapping, store.workspaceDir, MASTER_SESSION_TITLE, 'orchestrator')
        .then(() => { masterHealth?.set({ state: 'ready', detail: `master 会话 ${bootstrapping} 就绪`, at: nowIso() }) })
        .catch((error: unknown) => { masterHealth?.set({ state: 'error', detail: `master 会话引导失败:${String(error)}`, at: nowIso() }) })
    }
  }
  const engine = new Engine({
    repo: store,
    policy: (): ReturnType<typeof settingsPolicy> => settingsPolicy(store.settings(), scope, wiring),
    realmOf: (): string => realm,
    // R1 effort 档位(35 号 A17):领域包声明经装配注入,进候选卡字段;缺席不带档。
    effort: (): EffortTier | undefined => options.effort,
    // ★派发渠道纪律(2026-11-23;见 EngineOptions.isDispatchThread):webchat 主会话线程 =
    // 派发渠道,不是话题线程——accept/attach 不为工单订阅它,其上每条消息都走候选卡。
    // 内核不认 webchat/masterId 词汇,装配面在此注入;masterId 经 getter 现读(引导可晚于装配)。
    isDispatchThread: (ref): boolean => ref.source === WEBSCHAT_SOURCE && masterId !== undefined && ref.id === masterId,
    scope,
    assessor,
    executor,
    outbox,
    // 执行契约(R4 目录 + assignment 文本):真实执行面走 executor.prepare(同一实现,
    // executor/dsh.ts ticketExecution 纯函数读现值);stub 面走装配面同款纯函数。
    prepareTicket: (ticket, outcome) => dshExecutor !== undefined
      ? dshExecutor.prepare(ticket, outcome)
      : { ...ticket, execution: ticketExecution(ticket, outcome, store.settings(), store.workspaceDir) },
    // 领域事件恒经多播分发(38 号 T15 订阅面;装配位 onEvent 在分发器内先达——
    // 既有 onEvent 语义不变,引擎 emit 由条件接线改为恒接线是本行的唯一变化)
    emit: emitEvent,
  })
  engineRef.value = engine
  // ★评估对账(boot resume,2026-11-18):重启后持 evaluating 且从未 delivered 的线程,其
  // 'assessment' effect 已随旧装配丢失——deliver 面已就绪(deliverRef 已接线),此处重排,
  // 下一轮 pass 开新 Eval 重投候选卡(Engine.resumeAssessments 注)。engineRef 赋值后立即
  // 执行(先于 passDriver.start,对账开的新 Eval 由 pass 周期评估)。
  engine.resumeAssessments()
  // ★工单边界压缩钩子(53 号 §3-D3/§4-P3「任务边界触发」):压缩端口(显式注入
  // TasksOptions.compaction,或派生现读面 TasksOptions.compactionResolve——F3 复审修复后
  // 派生路径走后者,boot 缺席不再等于永久静默)与主会话解析面(sessionHost 在场且 masterId
  // 已引导)双在场才接线——任一缺席即不接线,静默不报错(fail-open:裸宿主/测试装配常态缺席)。
  // 接线后:ticket.ended 落定 → 解析主会话 agent → 端口解析(显式钉死/每触发现读,缺席
  // debug 跳过)→ compactNow;busy(非 idle/在途投递)或失败 → debug 静默跳过,绝不重试
  // (BoundaryCompaction 注:idle 与在途投递的裁决在宿主闸内)。订阅随 eventListeners
  // (emitEvent 分发,订阅方异常不外溢),dispose 时 clear 收口;生产面的 promise 以 void
  // 消化(trigger 全捕获不拒)。
  if (options.sessionHost !== undefined && masterId !== undefined) {
    const sessionHost = options.sessionHost
    // 每事件现解析主会话 agent(resolveAgent 已有即取,宿主重启后由它复得;失败按 undefined
    // 记 debug 跳过——不缓存宿主 Agent 实例,跨宿主重启不悬挂)。
    const base = {
      resolveAgent: async (): Promise<Agent | undefined> => {
        const result = await sessionHost.ports.controller.resolveAgent(SessionId(masterId))
        return 'error' in result ? undefined : result.agent
      },
      signal: lifetime.signal,
      ...(options.compactionDebugLog !== undefined ? { debug: options.compactionDebugLog } : {}),
    }
    // 显式注入恒优先(glue 决策,钉死语义);派生路径走每触发现读(compactionResolve 注)。
    if (options.compaction !== undefined) {
      const boundaryCompaction = new BoundaryCompaction({ ...base, compaction: options.compaction })
      eventListeners.add((event: DomainEvent): void => { void boundaryCompaction.onEvent(event) })
    }
    else if (options.compactionResolve !== undefined) {
      const boundaryCompaction = new BoundaryCompaction({ ...base, resolveCompaction: options.compactionResolve })
      eventListeners.add((event: DomainEvent): void => { void boundaryCompaction.onEvent(event) })
    }
  }
  // [active-tickets] 活跃工单清单 section(35 号 A24;28 号 §6;24a C6 拍板 pass 周期刷新):
  // 数据源全部现读(store 活跃面/executor.maxWorkers);缓存由 pass 驱动重算——PassDriver
  // 每轮 pass 在 evaluateDue 之后调 refresh(清单是提示不是协议,秒级延迟无害,28 §8-3);
  // usedSlots 由真实执行面的 WorkerSlots.used() 供给(★A22 替换点接线),stub 面缺省恒 0。
  const activeTickets = activeTicketsFace({
    tickets: (): readonly Ticket[] => store.tickets.active(),
    maxWorkers: (): number => store.settings().executor.maxWorkers,
    ...(dshExecutor !== undefined ? { usedSlots: (): number => dshExecutor.usedSlots() } : {}),
    // 主会话过滤面(①):引导解析的 masterId 动态现读;undefined = 未引导,不做会话过滤
    // (sections.ts「masterId 缺席 → 过滤交由注册面 scope」原语义)。
    masterId: (): string | undefined => masterId,
    now: nowMs,
  })
  // pass 驱动的引擎面包装:evaluateDue 后追加重算清单缓存(合并语义不变,PassDriver 不感知)。
  const passDriver = new PassDriver({ evaluateDue: (): void => { engine.evaluateDue(); activeTickets.refresh() } }, intervalMs)
  passDriver.start()
  begin('engine', (): void => { passDriver.stop() })

  // ── ⑤ assessor(★A19 已接线)/ ⑥ executor(★A22 已接线)/ ⑦ sources(A21 已接线)────
  begin('assessor', (): void => { assessor.stop() }) // 关停中断在跑的候选上下文读取(assessor.stop)
  if (dshExecutor !== undefined && sessions !== undefined) {
    // install():agent/status、agent/inbox/claimed、session/event、agent/error 四类宿主事件
    // 订阅(34 §2.4 dsh 行;A0 评审 §4 逐签名钉住,tests/types.seam-pin.ts);resume():
    // 宿主重启对账(在跑 assignmentInterrupted + pending 重排,A0 处置 D3)。关停:限时
    // 停后台工作(shutdown fire-and-forget,同 effects 步口径)、退订事件与 session 面配逆。
    const wiredExecutor = dshExecutor, wiredSessions = sessions
    wiredExecutor.install()
    wiredExecutor.resume()
    begin('executor', (): void => {
      void wiredExecutor.shutdown().catch(() => { /* 关停竞态的错误不阻宿主(effects 步同款) */ })
      wiredExecutor.dispose()
      wiredSessions.dispose()
      // master 引导健康项随 executor 步配逆注销(认领制:不释放则集合恒占位);未认领时为 no-op。
      masterHealth?.release()
      masterHealth = undefined
    })
  }
  else { begin('executor') }
  // sources:A21 channels 适配器(34 §2.5 channel-adapter 行)——被动汇,无注册表无轮询
  // (34 §0-A5;24a A5「channels 统一接收面」);glue 组合层把它按结构类型注给 channels
  // webhook 网关的 sink 位(39 §3-E3)与 SourceRegistry.deliverLifecycle 的转发目标。
  const sources = new ChannelTriggerAdapter({ engine })
  begin('sources')

  self.set({ state: 'ready', detail: `realm ${realm} 就绪(pass ${intervalMs}ms)`, at: nowIso() })

  /** 聚合健康面(runtime.health 与 settingsFace.read 共用;组件认领制见 board.claim)。 */
  const healthOf = (): TasksHealth => {
    const components = board.all
    const master = masterId === undefined ? {} : { masterId }
    if (disposed) return { state: 'error', detail: '任务内核已关停', at: nowIso(), components, ...master }
    const failing = Object.entries(components).filter(([, entry]) => entry?.state === 'error')
    if (failing.length > 0) {
      return { state: 'error', detail: `组件异常:${failing.map(([name]) => name).join(', ')}`, at: nowIso(), components, ...master }
    }
    if (store.settings().paused) return { state: 'paused', detail: '处理暂停中(settings.paused)', at: nowIso(), components, ...master }
    return { state: 'ready', detail: `realm ${realm} 就绪`, at: nowIso(), components, ...master }
  }
  /** 最小状态面(runtime.stats 与 settingsFace.read 共用;只读计数)。 */
  const statsOf = (): TasksStats => {
    if (disposed) throw new Error('任务内核已关停:stats 面不再可用')
    const db = store.db
    // 单值计数读取(COUNT 恒非空,SUM 空表为 null;node:sqlite 默认返回 number)。
    const count = (sql: string): number => {
      const row = db.prepare(sql).get() as { n: number | null } | undefined
      return row?.n ?? 0
    }
    const kindRows = db.prepare('SELECT kind, COUNT(*) AS n FROM effect GROUP BY kind').all() as Array<{ kind: string; n: number }>
    const byKind: Record<string, number> = {}
    let waiting = 0
    for (const row of kindRows) { byKind[row.kind] = row.n; waiting += row.n }
    const ticketRow = db.prepare('SELECT COUNT(*) AS n, SUM(open = 1) AS open, SUM(active = 1) AS active FROM ticket').get() as
      { n: number | null; open: number | null; active: number | null } | undefined
    const settings = store.settings()
    return {
      realm,
      tickets: { open: ticketRow?.open ?? 0, active: ticketRow?.active ?? 0, total: ticketRow?.n ?? 0 },
      threads: {
        active: count('SELECT COUNT(*) AS n FROM thread WHERE active = 1'),
        subscribed: count('SELECT COUNT(*) AS n FROM thread WHERE subscribed IS NOT NULL'),
      },
      triggers: { total: count('SELECT COUNT(*) AS n FROM trigger') },
      decisions: { total: count('SELECT COUNT(*) AS n FROM decision') },
      effects: { waiting, byKind },
      outbox: {
        pending: count("SELECT COUNT(*) AS n FROM outbox WHERE value ->> '$.status' = 'pending'"),
        dropped: count('SELECT COUNT(*) AS n FROM outbox WHERE dropped IS NOT NULL'),
      },
      policy: {
        version: wiring.version ?? policyVersion(settings),
        paused: settings.paused,
        evalMode: settings.eval.mode,
        rules: settings.policy.rules.length,
      },
      // usedSlots(2026-11-23 线上修复):真实执行面的 WorkerSlots 读数(stub 面缺席时如实 0)。
      executor: { maxWorkers: settings.executor.maxWorkers, usedSlots: dshExecutor?.usedSlots() ?? 0 },
      masterId,
    }
  }
  // ★任务设置面(2026-11-19 任务设置分区):面板/未来宿主面的唯一设置读写缝——写路径只经
  // saveSettingsBlock(分块 CAS),版本更新回写同一 wiring(Engine 现读,热生效不重启)。
  const settingsFace: TasksSettingsFace = createTasksSettingsFace({
    host: {
      store,
      engine,
      scope: () => scope,
      wiring: () => wiring,
      setVersion: (version: string): void => { wiring.version = version },
    },
    realm,
    masterId: () => masterId,
    masterTitle: MASTER_SESSION_TITLE,
    health: healthOf,
    stats: statsOf,
    workerSessionIds: () => store.tickets.open().map(ticket => workerSessionId(ticket.id)),
    ...(options.jointSides === undefined ? {} : { jointSides: options.jointSides }),
  })

  const runtime: TasksRuntime = {
    id: TASKS_SERVICE_ID,
    realm,
    boot,
    shutdown: shutdownLog,
    router,
    store,
    effects,
    outbox,
    assessor,
    executor,
    sessions,
    presets: rolePresets,
    sources,
    board,
    engine,
    subagentPolicies,
    masterId,
    wiring,
    settingsFace,
    health: healthOf,
    stats: statsOf,
    pass: (): void => { passDriver.pass() },
    activeTickets,
    subscribe: (listener): (() => void) => {
      if (disposed) throw new Error('任务内核已关停:subscribe 面不再可用')
      eventListeners.add(listener)
      return () => { eventListeners.delete(listener) }
    },
    snapshot: (): TasksSnapshotView => {
      if (disposed) throw new Error('任务内核已关停:snapshot 面不再可用')
      return { realm, tickets: store.tickets.list(), threads: store.threads.list() }
    },
    query: (sql: string, ...parameters: unknown[]): unknown[] => {
      if (disposed) throw new Error('任务内核已关停:query 面不再可用')
      // 只读白名单(fail-closed):非 SELECT 一律拒绝——写路径唯一经 Engine 事务
      // (34 号 §2.1 单写者;read 面只读投影纪律,34 号 §3)。
      if (!sql.trim().toLowerCase().startsWith('select')) {
        throw new Error('query 面只读:仅接受 SELECT 语句(写路径唯一经 Engine 事务)')
      }
      return store.db.prepare(sql).all(...(parameters as SQLInputValue[]))
    },
    dispose: (): void => {
      if (disposed) return
      disposed = true
      // 宿主生命周期先行中止:在跑的 Sessions.prompt/投递拒绝继续(lifetime.throwIfAborted)。
      lifetime.abort()
      // 订阅面收口:退订全部(关停后不再有多播;订阅方持有退订闭包亦为 no-op)。
      eventListeners.clear()
      // 关停配逆(34 §4-E):按装配登记逆序回放;每步执行后记入 shutdown 序。
      for (const step of [...steps].reverse()) {
        step.stop()
        shutdownLog.push(step.name)
      }
      self.release()
    },
  }
  return runtime
}

/** tasks 插件配置(TasksOptions 全量透传给 createTasks;glue 层按部署注入 realm/dirOf/端口)。 */
export type TasksPluginConfig = TasksOptions

/**
 * tasks 插件(35 号 A16②;34 §1 plugin.ts 行):createTasks() 真实装配为 ctx.tasks 服务
 * (注册表 + TASKS_SERVICE_ID 唯一 ID,provide 可配逆——34 §2 通用要点④)。
 *
 * 形态参照:glue governance-plugin(provide/ctx.on/disposer 形态,官方 seam——ctx 属性必须
 * 经 provide 声明后才能赋值,服务名 = ctx 属性名:provide('tasks') → ctx.tasks)与
 * compaction basic-plugin(宿主消费面)。健康面注册:装配级 'tasks' 健康项(HealthBoard
 * 认领制,effects 各 kind 自报,34 §2.6「健康面并入装配与 effects」)+ 服务面
 * health()/stats()(35 号 A16④,供工作台与探针)。宿主服务解析:本插件只机会读取
 * ctx.logger 观测(memory-plugin 同款结构面,测试 ctx 可缺席);webServer 等路由面服务
 * 不解析不持有——★T2 路由面独占(docs/PLUGIN-AUTHORING §1.1-2),tasks 的数据端点唯一
 * 正路是 access 守卫清单登记,健康/状态面以服务形态暴露即可满足工作台(38 号,WS-D)
 * 与探针的消费;channels/access 名单等接线经 TasksOptions 端口由 glue 层注入
 * (34 号 §1 依赖方向行:接线经端口注入,不 import 服务实例)。
 */
export function defineTasksPlugin(config: TasksPluginConfig = {}) {
  return {
    name: TASKS_PLUGIN_NAME,
    // ★inject 声明(2026-11-18 修复 apply 时点宿主服务面缺席):cordis 语义=全部注入服务
    // 就绪才 apply(fiber._refresh 对 INACTIVE 挂起等待,服务 provide 后自动激活)——
    // 宿主服务面注册晚于插件 apply 的时序问题由机制原生解决,替代手写重试定时器。
    inject: ['sessionController', 'workspaceRegistry', 'permissionPresets',
      'sessionPersistence', 'agents', 'tools', 'systemPrompt'],
    apply(ctx: Context, rowConfig?: Partial<TasksPluginConfig>): () => void {
      // ★延迟引导(2026-11-18 实测修复):apply 时点宿主 session 服务面(sessionController 等)
      // 可能尚未注册——sessionHostFromContext 得 undefined → StubExecutor 装配、masterId 恒
      // 缺席、webchat 入口不装(出票端到端实测阻断点)。改为有界重试引导:2s×45(≈90s 窗口),
      // 解析成功即整栈装配;stopped 防关停竞态;显式 config.sessionHost 无需等待。
      let stopped = false
      let disposeTasks: (() => void) | undefined
      const bootTasks = (): void => {
        // inject 已声明(见 defineTasksPlugin):apply 时点五服务+宿主面均就绪,无需重试。
        if (stopped) return
        const derived = config.sessionHost === undefined ? sessionHostFromContext(ctx) : undefined
        // ★channels 投递面自派生(★A1 回执接线,2026-11-19):glue 未显式注入 config.channels
        // 时,自宿主 ctx 机会读取 channels 服务束(channels-delivery.ts 结构端口,双路反射
        // 惯例同 sessionHostFromContext)派生 ChannelsDelivery 注入。服务缺席(boot 时序常态:
        // 清单行序 eterna-tasks 先于 eterna-channels,bootTasks 一次性执行)仍派生惰性面——
        // 方法逐调用现读,reply effect 的 Later 重试吸收挂载时序;结构面残缺 fail-closed
        // 不派生,回落 UNWIRED_CHANNELS。显式注入恒优先(glue 的适配面可按需覆写)。
        const channelsDerived = config.channels === undefined ? channelsDeliveryFromContext(ctx) : undefined
        // 宿主 logger 机会读取(结构面,缺席静默——memory-plugin 同款口径,测试 ctx 可缺席;
        // 提前到 resolved 构造前:compactionDebugLog 自其 debug 面派生注入)。
        const logger = (ctx as unknown as { readonly logger?: {
          readonly info?: (...args: unknown[]) => void
          readonly debug?: (...args: unknown[]) => void } }).logger
        // ★compaction 结构端口自派生(53 号 §3-D3/§4-P3;F3 复审修复:boot 一次性解析改为
        // 每触发现读):glue 未显式注入 config.compaction(或行配置 compaction)时,不再在
        // boot 时把 ctx.compaction 钉死进 options——旧实现两处隐患:①宿主压缩组晚于 tasks
        // boot 挂载(preset 组随首会话装载的常态)→ 派生不出,D3 永久静默无日志;②boot 时
        // 解析到的是宿主树展平的 standard 默认参实例(isolate.compaction 的会话特化组不可
        // 见),钩子持该引用后 preset 特化参数(orchestrator 0.7/true)对 D3 边界压缩不生效。
        // 改为派生「每触发现读」面注入 compactionResolve:agent 作用域压缩实例
        // (compactionFromAgent,会话特化参数所在)优先,宿主 ctx.compaction 兜底;两处缺席
        // = 每次触发一条 debug 跳过(fail-open,工单流不受影响,端口就绪即自愈)。显式注入
        // 恒优先(钉死语义,glue 决策)。
        let compactionDerived: { resolveCompaction: (agent: Agent) => CompactionSeam | undefined } | undefined
        if (config.compaction === undefined && rowConfig?.compaction === undefined) {
          compactionDerived = {
            resolveCompaction: (agent: Agent): CompactionSeam | undefined =>
              compactionFromAgent(agent) ?? compactionFromContext(ctx),
          }
        }
        // debug 日志面自宿主 logger 派生(53 号 §3-D3「busy 静默跳过」的观测位;缺席即静默)。
        // ★必须经 receiver 调用:把方法先提取到局部变量再裸调会丢 this,首次触发即
        // TypeError(this is not a function)且以未处理拒绝炸宿主(隔离容器 E2E 实测:
        // 首个工单终态即 fatal)。bind 保 receiver,TS 收窄也跨闭包成立。
        const loggerDebug = logger?.debug
        const compactionDebugLog = typeof loggerDebug === 'function'
          ? (message: string): void => { loggerDebug.call(logger, message) }
          : undefined
        // 行配置注入(cordis loader apply(ctx, config) 第二参):realm/effort 等部署面
        // 从 super 模板 eterna-tasks 行 config 传入(优先于包内缺省)。
        const resolved: TasksPluginConfig = {
          ...config,
          ...(rowConfig ?? {}),
          // 派生注入(sessionHost/channels/compaction 均为只读字段,经展开覆写而非属性赋值)。
          ...(rowConfig?.sessionHost === undefined && config.sessionHost === undefined && derived !== undefined
            ? { sessionHost: derived }
            : {}),
          ...(rowConfig?.channels === undefined && config.channels === undefined && channelsDerived !== undefined
            ? { channels: channelsDerived }
            : {}),
          ...(rowConfig?.compaction === undefined && config.compaction === undefined && compactionDerived !== undefined
            ? { compactionResolve: compactionDerived.resolveCompaction }
            : {}),
          ...(rowConfig?.compactionDebugLog === undefined && config.compactionDebugLog === undefined && compactionDebugLog !== undefined
            ? { compactionDebugLog }
            : {}),
        }
        // ★sessionHost 装配面注入(④;2026-11-18 三断点④):glue 未显式注入 config.sessionHost
        // 时,自宿主 ctx 机会读取 session 服务束(反射惯例,见 sessionHostFromContext 注)派生
        // 注入——宿主服务缺席(裸 cordis ctx/测试裸宿主)即不派生,createTasks 回落
        // StubExecutor(TasksRuntime.executor 联合保持,34 §4-E)。显式注入恒优先(glue 的
        // 适配面可按需覆写,masterId 等部署决策照旧归 glue)。
        // fail-closed:注入的 dirOf 解析失败时 createTasks 抛错 → 插件装载失败(宿主日志可见),
        // 不静默降级为无内核的空服务(23 号 §3.1 铁律的服务化表达);缺省派生的部署指名
        // realm 由 Store 引导自建目录(defaultTasksDirOf 注)。
        const runtime = createTasks(resolved)
        // 主会话白名单(35-A21 诊断清单①/②共用的注入面;★master 会话引导①):取 createTasks
        // 的解析结果——config.masterId → config.sessionHost.masterId → KV 既有约定 →
        // 宿主 session 面在场时的约定派生(orchestrator-<realm>),解析结果已写 KV
        // (KV.master.session)并经 health()/stats() 暴露。undefined(裸宿主且无 config)=
        // webchat 入口不接线、scope 对 webchat 恒 filtered、工具面退回「非 worker 会话」基线
        // (fail-closed,不猜主会话)。
        const masterId = runtime.masterId
        // ★A20 注册面(35 号表⑤-7「注册即 ctx.tools.register(def),disposer 必须进 ctx.effect」;
        // B4 先例 packages/memory/src/tools.ts:282):orchestrator 14 工具面注册进宿主 ctx.tools
        // (dsh-tools 服务,机会读取——裸 cordis ctx/测试宿主缺席即跳过,不炸装配)。角色分面
        // (24 §8.3-4;34 §4-D tools 行)经注册 when 谓词钉住:worker session(id 约定
        // worker-<ticketId>,executor/dsh.ts ticketOfSession)的步骤里主会话面不可见。
        // worker 工具面(tools/worker.ts)由 executor 每 agent 安装(DshExecutor.installWorkerTools,
        // 2026-11-23 线上修复:launch/delivery 必经点经 agent.ctx 作用域注册;此前「随 executor
        // 建 worker session 时装入」只存在于注释,workerTools 全仓无消费方,worker 会话自始
        // 没有 report/ack/handback 工具——工单 4e348403 的 answer/report 通道不可用即此根因;
        // worker cwd 是工单子目录(R4),全局/realm 层注册对它不可见——隔离容器 E2E 实测
        // master 51 工具含全部 orchestrator_* 而 worker 43 个零 orchestrator_*)。
        try {
          const tools = (ctx as unknown as { readonly tools?: { register(definition: ToolDefinition,
            options?: { when?: (activation: { readonly agent: { readonly id: string } }) => boolean }): () => void } }).tools
          if (tools !== undefined && typeof tools.register === 'function') {
            const host: OrchestratorToolsHost = {
              engine: runtime.engine,
              store: runtime.store,
              settings: (): Settings => runtime.store.settings(),
              assessor: runtime.assessor,
              outbox: runtime.outbox,
              prompts: new Prompts(runtime.store),
              resources: { store: runtime.store },
              // 与 Engine 同一 scope 面(三断点③):注入面优之,缺省即 webchatMasterScope 真实现
              // (masterId 动态现读;policyEffects 热改重算走同一闭包)。
              scope: config.scope ?? webchatMasterScope((): string | undefined => masterId),
              // ★同一 wiring 实例(2026-11-19 任务设置分区):面板保存回写 runtime.wiring.version,
              // Engine 与工具宿主现读同一对象——旧实现另建副本,面板保存后工具面版本漂移。
              wiring: runtime.wiring,
              ...(config.syncSource !== undefined ? { syncSource: config.syncSource } : {}),
              requestPass: (): void => { runtime.pass() },
              policyChanged: (from, to, effects): void => { runtime.engine.policyChanged(from, to, effects) },
            }
            ctx.effect(function* (): Generator<() => void, void, void> {
              for (const definition of orchestratorTools(host)) {
                // ★orchestrator_read 双模共享(2026-11-23 worker 工具面接线):worker 面同名词
                // (全局层同名词注册即抛错"already registered"),故 read 单独注册——when 对
                // 主会话与 worker session 双向放行,execute 按执行主体现分窄(worker 只读其
                // 工单子树,orchestrator.ts 的 read 闭包)/全表;其余 13 个工具面只在主会话
                // 可见(主会话 id 缺席时退回既有基线「非 worker 会话」,分面不破)。
                const isSharedRead = definition.name === 'orchestrator_read'
                yield tools.register(toDshTool(definition), {
                  when: isSharedRead
                    ? ({ agent }) => ticketOfSession(agent.id) !== undefined
                      || masterId === undefined || agent.id === masterId
                    : ({ agent }) => masterId !== undefined
                      ? agent.id === masterId
                      : ticketOfSession(agent.id) === undefined,
                })
              }
            }, 'tasks orchestrator tools')
            logger?.info?.('[tasks] orchestrator 工具面已注册(14,read 双模共享)')
            // worker 工具面不在此全局注册:worker session 的 cwd 是工单子目录(R4),其工具
            // 作用域与 realm 工作区不同层,全局/realm 层注册对它不可见(2026-11-23 隔离容器
            // E2E 实测:master 51 工具含全部 orchestrator_*,worker 43 个零 orchestrator_*),
            // 且 orchestrator_read 两面同名、全局层重复注册即抛错。安装点在 executor 的
            // 每 agent 作用域(DshExecutor.installWorkerTools,launch/delivery 必经;宿主报错
            // 信息即此正解:"register through that agent's agent.ctx instead")。
          }
        } catch (error) {
          logger?.info?.(`[tasks] orchestrator 工具面注册跳过:${String(error)}`)
        }
        // ★webchat 委派入口接线(35-A21 诊断清单①;35 号 A16「sources 留接口位」的宿主事件
        // 半边):宿主 ctx 的 session 事件 seam 在场(机会读取,tools 注册同款口径)且主会话
        // 白名单已注入时,监听主会话的用户消息归一化为 Trigger 进 Engine.receive——用户在
        // web 聊天会话里发的委派消息由此成为 explicit Trigger(发送者=会话主人),经 Eval
        // 评估、accept 出票、worker session 接手。准入不在入口裁决(scope 监听过滤 + gate
        // 名单 × direct,webchat.ts 头注)。健康项 'webchat' 上报处理失败;装配关停先退订。
        let disposeWebchat: (() => void) | undefined
        let webchatHealth: HealthEntry | undefined
        try {
          const host = ctx as unknown as { readonly on?: (event: 'session/event',
            listener: (session: { readonly id: string }, event: never) => void) => () => void }
          if (masterId !== undefined && typeof host.on === 'function') {
            const at = (): string => new Date((config.now ?? (() => Date.now()))()).toISOString()
            webchatHealth = runtime.board.claim('webchat', { state: 'ready', detail: 'webchat 委派入口待命', at: at() })
            const entry = new WebchatDelegationEntry({
              masterId,
              engine: runtime.engine,
              actorOf: config.sessionOwner ?? ((): ActorRef => ({ source: WEBSCHAT_SOURCE, id: runtime.realm })),
              ...(config.now !== undefined ? { now: config.now } : {}),
              onStored: (): void => {
                // 入引擎即排一轮 pass:评估与候选卡投递不等到下一周期(orchestrator_route 的
                // requestPass 同款口径);若曾报错,处理成功即回 ready(executor background 同款)。
                if (webchatHealth?.get()?.state === 'error') webchatHealth.set({ state: 'ready', detail: 'webchat 委派入口处理恢复', at: at() })
                runtime.pass()
              },
              onError: (failure: unknown): void => {
                webchatHealth?.set({ state: 'error', detail: `webchat 委派入口处理失败:${String(failure)}`, at: at() })
              },
            })
            disposeWebchat = entry.install(ctx)
            logger?.info?.(`[tasks] webchat 委派入口已接线(master=${masterId})`)
          }
        } catch (error) {
          // 认领后未接线的半途失败也要释放健康项(认领制:不释放则集合恒占位)。
          webchatHealth?.release()
          webchatHealth = undefined
          logger?.info?.(`[tasks] webchat 委派入口接线跳过:${String(error)}`)
        }
        // [active-tickets] section 注入(35 号 A24;28 号 §6「经 prompt section seam 注入,同
        // dsh-memory 渐进披露」):宿主 system-prompt 服务在场(机会读取,memory-plugin 的
        // inject systemPrompt 同款消费面;测试/无宿主 ctx 缺席或未就绪即跳过)时注册,
        // disposer 进插件关停链(effect 配逆);`systemPrompt.section` 即官方 seam
        // (@deepseek-ai/dsh-system-prompt SystemPrompt.section,提示词注册表条目
        // runtime.tasks.active-tickets)。注册失败不炸装配——清单缺席只是少了保底摘要。
        let disposeSection: (() => void) | undefined
        try {
          const systemPrompt = (ctx as unknown as { readonly systemPrompt?: { section(section: unknown): () => void } }).systemPrompt
          if (systemPrompt !== undefined && typeof systemPrompt.section === 'function') {
            disposeSection = systemPrompt.section(runtime.activeTickets)
            logger?.info?.(`[tasks] ${ACTIVE_TICKETS_SECTION_NAME} section 已注册`)
          }
        } catch (error) {
          logger?.info?.(`[tasks] ${ACTIVE_TICKETS_SECTION_NAME} section 注册跳过:${String(error)}`)
        }
        // 官方 seam:ctx 属性必须经 provide 声明后才能赋值(cordis Context set 陷阱,
        // governance-plugin.ts:100-103 同款);provide 的 disposer 运行时是 async
        // (reflect.ts:311-321),关停路径裸调用不 await,防阻塞宿主(audit 插件同款)。
        const disposeService = ctx.provide(TASKS_SERVICE_ID, runtime)
        // preset 选择可见面(53 号 §4-P0 探针):boot 行尾附 presets 段——主/worker 建会话
        // 请求的 agentPreset 取值(显式注入/派生束/缺省常量,值即 src/session/presets.ts
        // 常量,与 runtime.presets 同源);stub 装配无宿主 session 面(不建会话)时为 '-'。
        const presetLabel = ((): string => {
          const presets = runtime.presets
          if (presets === undefined) return '-'
          const parts: string[] = []
          for (const role of ['orchestrator', 'worker'] as const) {
            const preset = presets[role]
            if (preset !== undefined) parts.push(`${role}:${preset}`)
          }
          return parts.join(',')
        })()
        logger?.info?.(`[tasks] realm=${runtime.realm} boot=${runtime.boot.join('→')} presets=${presetLabel !== '' ? presetLabel : '-'}`)
        // 关停配逆(34 §4-E):先撤 webchat 入口订阅面与 section 注入面、ctx 服务(反注册面),
        // 再按装配逆序回放组件关停;装配配逆移交外层 disposer(stopped/disposeTasks 闭包态,
        // bootTasks 无返回值)。
        disposeTasks = () => {
          disposeWebchat?.()
          webchatHealth?.release()
          disposeSection?.()
          disposeService()
          runtime.dispose()
        }
      }
      bootTasks()
      return (): void => { stopped = true; disposeTasks?.() }
    },
  }
}

// DSH bundle loader 取 default export 插件实例(漏写 = 静默不装载,docs/PLUGIN-AUTHORING §1-1)
export default defineTasksPlugin()
