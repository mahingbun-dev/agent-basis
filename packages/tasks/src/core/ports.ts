/**
 * 内核端口——core 依赖的外部形状:策略、评估者、执行者、回执与仓储。
 *
 * Sources、策略实现、评估者、执行者与渠道都属项目侧具体实现,内核只认本文件钉住的接口
 * (语义自 SA/src/core/ports.ts 重写级校对移植,不变量原样)。
 * 设计依据:34 号 §2.1 ports 行、§3 五角色接口清单;35 号 A5。
 * 本仓拍板改造仅一处:`DomainEvents` 的 `ticket.ended` 载荷增加 `realm` 字段
 * (34 §2.1;24a A1「realm 进内核模型」)——记忆整固钩子与 observe 冲突指标按 realm 归账(35 号表②-2)。
 */
import type {
  Assignment, ChannelRef, Delegation, Decision, DecisionKind, EffortTier, Mandate, MandateBasis, Strength,
  Thread, Ticket, TicketEndBy, TicketOutcome, Trigger, TriggerDisposition,
} from './model.ts'
import type { Reason } from './reasons.ts'

/** 准入门判定结果:不可准入并给理由码;或可准入,并给强度与 MandateBasis。 */
export type GateResult = { admissible: false; reason: string } | { admissible: true; strength: Strength; basis: MandateBasis }

/**
 * 某 Source 是否收到一条 Trigger:`observed` 表示它连并非发给 agent 的消息也收;
 * `row` 是 Policy 准入表所指的接收范围行,例如某个会话。
 */
export type ScopeResult = { listened: true; observed: boolean; row?: string } | { listened: false; reason: string }
/** 领域视角的 Source 配置:按 Trigger、或按已记录的 Mandate basis,给出监听范围。 */
export interface SourceScope {
  scope(input: { source: string; meta: Record<string, unknown> }): ScopeResult
}

/** 带版本的规则;`gate` 决定谁可以发起工作。Source 监听范围不属于 Policy。 */
export interface Policy {
  version: string
  paused: boolean
  gate(trigger: Trigger, thread: Thread, tickets: Ticket[]): GateResult
  /** 在当前策略下复核某 Mandate 的门层依据,例如已结束工单恢复之前(docs/002)。 */
  revalidate(mandate: Mandate): boolean
  /** 推断候选能否按其评估命中的规则被接受:评估方 accept 且每条规则都启用。 */
  admitsInferred(rules: readonly string[]): boolean
  /** 评估者最多可用多久,超时该 Eval 记为 unavailable。 */
  evalTimeoutMs: number
}

/** 评估者拿到的东西:有界的事实,绝不是权力。 */
export interface Candidate {
  evalId: string
  thread: Thread
  triggers: Trigger[]
  strength: Strength
  policyVersion: string
  /** 该线程上的全部工单,含已结束的,供重复判定(27 号 §3.3-B)。 */
  tickets: Ticket[]
  /**
   * ★本仓改造(24 §5.5-R1;26 §4.1 effort 段;35 号 A17):R1 effort 档位进候选卡字段——
   * 由 `EngineOptions.effort` 注入(领域包 effort 档位声明段经装配供给,tasks 消费);
   * 评估方在 accept 时把它固化进 `AssessmentOutcome.effort` → Decision → Mandate 执行契约。
   * 声明缺席时缺席:档位不设默认(26 §4.1 由领域包声明,内核不发明)。
   */
  effort?: EffortTier
}

export type AssessmentOutcome =
  | { kind: 'ignore'; reason: string | Reason; audit?: Record<string, unknown> }
  | { kind: 'unavailable'; reason: string | Reason; audit?: Record<string, unknown> }
  /**
   * 一次 accept:`rules` 是评估命中的规则,`name` 是工单请求的短名,`note` 是给其 worker 的路由备注。
   * ★本仓改造(34 §2.1 evals 行;35 号 A7):`delegation` 为 R3 委派四要素,必填——缺任一要素
   * `Engine.decide` 抛 `UserError('delegationIncomplete')`(结构校验不靠 prompt)。
   * ★本仓改造(24a 拍板记录·A6;35 号 A8):`handoffOf` 命名交接来源的原工单——新工单 Mandate 独立,
   * 原工单订阅新工单线程(见 Tickets.create)。
   */
  | {
    kind: 'accept'
    title: string
    scope: string
    reason: string | Reason
    /** R3 委派四要素:objective / outputFormat / toolGuidance / taskBoundaries,缺一不可。 */
    delegation: Delegation
    /**
     * ★本仓改造(24 §5.5-R1;26 §4.1 effort 段;35 号 A17):accept 固化的 R1 effort 档位——
     * 评估方回填候选卡上的档位(或按领域包规则改判),随 Decision 落库并进 Mandate 执行契约;
     * R1 预算守卫(35 号 A17)按它取分档上限。缺席即该工单不设档(内核不发明默认档)。
     */
    effort?: EffortTier
    /** 交接来源:本 accept 接手自哪张原工单(可选;26 §6.2 跨工单协调走交接不走 agent 互聊)。 */
    handoffOf?: string
    acknowledgement?: string
    rules?: string[]
    audit?: Record<string, unknown>
    name?: string
    note?: string
  }
  | { kind: 'stop'; ticketId: string; reason: string | Reason; audit?: Record<string, unknown> }

/** 语义判定。`request` 把评估排队,按 `evalId` 幂等;结果经 `Engine.decide` 返回。 */
export interface Assessor {
  request(candidate: Candidate): void
  /** 每当某次 Eval 结束(无论是否已决)都会调用,评估者据此释放它为之留存的状态。 */
  release?(evalId: string): void
}

/**
 * 执行 Assignment 的角色;并发与工作区管理是它自己的事。Engine 在自己的命令内调用它,
 * 因此它的每个方法都只是把工作排队,结果经 Engine 的回调报告回来。
 */
export interface Executor {
  /** 把一个待启动 Assignment 排队启动;结果经 `Engine.assignmentStarted` 或一份 `failed` 报告回来。 */
  start(ticket: Ticket, assignment: Assignment): void
  /**
   * 把工单等待中的 Inputs 投递给其运行中的 Assignment 排队;结果经 `Engine.inputsDelivered`
   * 或 `Engine.deliveryFailed` 回来,且其 worker 的 Session 把它们读进一个 step 后经 `Engine.inputsRead` 回来。
   */
  deliver(ticket: Ticket, assignment: Assignment): void
  /** 结束一个 Assignment 的工作,例如取消其 Session 的当前回合;在工单或 Assignment 已在领域内结束后调用。 */
  stop(ticket: Ticket, assignment: Assignment, reason: string): void
}

/** 发往某渠道的消息;`ticketId` 指明它属于哪张工单(如果有)。 */
export interface OutboundMessage { id: string; channel: ChannelRef; text: string; kind: 'acknowledgement' | 'reply' | 'notice'; ticketId?: string }
/** 排队中的消息在等待(`pending`)、已发出(`sent`)、或因其会话永远收不到而被丢弃(`dropped`)。 */
export type ReplyStatus = 'pending' | 'sent' | 'dropped'
/** 为渠道排队的消息;Engine 在自己的命令内入队,发送方稍后投递。 */
export interface Outbox {
  /** 幂等入队一条消息;先前已入队的 id 保留其第一条消息。 */
  send(message: OutboundMessage): void
  /** 某条消息是否入过队,以及它后来怎样了。 */
  status(id: string): ReplyStatus | undefined
  /** 撤回一条尚未发出的消息。 */
  withdraw(id: string): void
}

/** Engine 在每次变更之后按事件类型报告的东西。 */
export interface DomainEvents {
  'trigger.received': { triggerId: string; threads: string[] }
  'eval.started': { evalId: string; threadKey: string; triggerIds: string[]; strength: Strength }
  'decision.recorded': { decisionId: string; kind: DecisionKind; threadKey: string }
  'ticket.created': { ticketId: string; decisionId: string; strength: Strength }
  'ticket.resumed': { ticketId: string; triggerId: string }
  /** ★本仓改造(34 §2.1):载荷带 `realm`——记忆整固与冲突指标按 realm 归账。 */
  'ticket.ended': { ticketId: string; realm: string; by: TicketEndBy; outcome: TicketOutcome; reason?: string }
  'assignment.started': { ticketId: string; assignmentId: string }
  'assignment.ended': { ticketId: string; assignmentId: string; reason: string }
  'thread.subscribed': { threadKey: string; ticketId: string }
  /** 某人丢掉了每张工单的订阅,或某工单的 Executor 丢掉自己的订阅,理由为 `reason`。 */
  'thread.unsubscribed': { threadKey: string; ticketId: string; by: 'person' | 'executor'; reason?: string }
  'trigger.requeued': { triggerId: string }
  /** 某人的后续消息已到达工单,而旧版本还会把它排进 Eval;现在它离开了队列。 */
  'trigger.followup': { triggerId: string }
  'policy.changed': { from: string; to: string }
}
export type DomainEvent = { [K in keyof DomainEvents]: { type: K; at: string; data: DomainEvents[K] } }[keyof DomainEvents]

/**
 * 持久状态。每个方法都是同步的,`atomic` 才能把一个工作单元整个包住——
 * 全同步契约是单写者可串行化的根基(27 号 §3.2-①;34 号 §2.1「Repositories 全同步契约保留」)。
 *
 * realm 路由适配位(34 §2.3/A11):一租户一 SQLite,realm → Store 的路由落在 src/store/realm.ts
 * (TasksRealmRouter,LRU 池);本端口契约本身不含路由——Engine 命令先按 realm 路由到对应实例的聚合,
 * 再落到这套同步仓储契约上。内存实现见 memory.ts。
 */
export interface Repositories {
  atomic<T>(work: () => T): T
  triggers: {
    get(id: string): Trigger | undefined
    save(trigger: Trigger): void
    disposition(id: string): TriggerDisposition | undefined
    saveDisposition(id: string, value: TriggerDisposition): void
  }
  threads: {
    get(key: string): Thread | undefined
    save(thread: Thread): void
    list(): Thread[]
    /** 有 Trigger 在等 Eval、或有 Eval 正在跑的线程。 */
    active(): Thread[]
  }
  tickets: {
    get(id: string): Ticket | undefined
    save(ticket: Ticket): void
    list(): Ticket[]
    open(): Ticket[]
    /** 有未交付 Inputs、或有 pending/running Assignment(总是最新那个)的工单。 */
    active(): Ticket[]
  }
  decisions: {
    get(id: string): Decision | undefined
    save(decision: Decision): void
    byThread(key: string): Decision[]
  }
}
