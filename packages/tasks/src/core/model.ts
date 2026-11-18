/**
 * 领域模型——主动工作 Agent 的概念与不变量,独立于任何 Source、Policy 与 Executor。
 *
 * 设计依据:34 号 §2.1 model 行(SA src/core/model.ts 全量移植,重写级校对);35 号 A3。
 * 改造(34 §2.1 / 24a 拍板 A1「realm 进内核模型」):
 * - Mandate 与 Ticket 增必填 `realm: string`(授权与工单按租户归账,一租户一 SQLite,34 §2.3);
 * - ThreadRef / Trigger 不加(Source 事件天然带渠道与租户上下文,由 intake 经 realmOf 注入后落库);
 * - 谓词 followupOwners(SA model.ts:75-88)与 waitsForPerson(SA model.ts:349-353)原样保留——
 *   P0 Attention 台账与 28 号 §6「等谁」可见化都建在其上。
 */
import type { Reason } from './reasons.ts'

/** Source 自身词汇中的行动者身份;哪些行动者可在该 Source 上发起工作由 Policy 决定。 */
export interface ActorRef { source: string; id: string }
/** 线程身份;从原生事件派生 `id` 的规则属于 Source。 */
export interface ThreadRef { source: string; id: string }
/** 线程上的只写地址;地址格式属于 Source。 */
export interface ChannelRef { source: string; thread: string; address: Record<string, string> }

/** 线程在全域的稳定键。 */
export const threadKey = (ref: ThreadRef): string => `${ref.source}:${ref.id}`
/**
 * 把合法时间戳归一为 `Date#toISOString` 形态,使落库时间戳在内存与 SQL 中可按字典序比较;
 * 无法解析为时间戳的值原样返回。
 */
export function isoTime(value: string): string {
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : value
}

/** Source 产生的一条不可变事件。`text` 与 `meta` 是不可信外部数据。 */
export interface Trigger {
  id: string
  source: string
  /** 该 trigger 所属的全部线程;第一个(`threads[0]`)是承载其评估的主线程。 */
  threads: ThreadRef[]
  actor: ActorRef
  /** Source 声明:该事件由人写出,而非 bot、CI 或本 agent。 */
  human: boolean
  /** Source 声明:发送者以提及或私聊方式对 agent 说话。 */
  addressed?: 'mention' | 'direct'
  at: string
  text: string
  channel?: ChannelRef
  url?: string
  /** 给适配器的 Source 原生细节;内核从不解释它们。 */
  meta: Record<string, unknown>
}

/** trigger 经 intake 后的去向;它不授予任何权力,但决定谁有权裁决一条人的后续消息(见 followupOwners)。 */
export interface TriggerDisposition {
  /** 进入域之前被 Source 的 scope 过滤拒绝,理由归 Source。 */
  filtered?: Reason
  /**
   * ★本仓改造(34 §2.1 intake 行;24a A1「realm 进内核模型」):intake 在 Trigger 首次落库前经
   * `realmOf` 解析并标注的租户 realm——「realm 首参路由」的落库面(35 号 A6);accept 固化 Mandate 时
   * 读取它(35 号 A7)。可选仅为兼容未带 realm 的更早记录,本仓 intake 写入的记录恒有值。
   */
  realm?: string
  evalId?: string
  decisionId?: string
  /** 该 trigger 到达的工单(订阅扇出或主 Session attach);已结束、或非其 worker 接手便无法恢复的工单不再计入。 */
  fanout: string[]
  /** fanout 中仅因 Executor 以 context 跟随该 Thread 而到达的工单:消息对它们只是上下文,不是它们的工单。 */
  context?: string[]
  /** 人、或主 Session(对没有工单认领的消息)把它重发给 Eval;handback 不设置它。 */
  requeued?: true
  /** 把它交回为「超出工单」的工单,各一次、附理由与时间;没有工单认领时它进一次 Eval。 */
  handbacks?: { ticketId: string; reason: string; at: string }[]
  /** 确认或答复了它、把它接进工单范围内的工单。 */
  acked?: string[]
  at: string
}
/** 裁决 followup 归属所读的存量数据:工单、线程与 disposition,即 Store 与内核共同维护的形态。 */
export interface FollowupRecords {
  tickets: { get(id: string): Ticket | undefined }
  threads: { get(key: string): Thread | undefined }
  triggers: { disposition(id: string): TriggerDisposition | undefined }
}
/**
 * 由哪些工单的 worker 裁决一条人的后续消息:即它到达其自有线程、仍能裁决它、且未把它交回的那些工单。
 * 工单在存活期间拥有它;在人撤掉该线程的 Subscription 之后仍拥有;在非被人结束、且该 Trigger 正等待恢复它
 * 期间也拥有。一旦人把它重发给 Eval、或某个 Eval 正持有它(更早版本可能排过队),则不再有 owner。
 * 工单拥有该消息期间,它不进任何 Eval,主 Session 对它只能 stop 该工单的工作。
 */
export function followupOwners(trigger: Pick<Trigger, 'id' | 'human' | 'threads'>, records: FollowupRecords): string[] {
  if (!trigger.human) return []
  const disposition = records.triggers.disposition(trigger.id)
  if (!disposition || disposition.requeued) return []
  // disposition 已排除绝大多数消息,只对可能存在 owner 的才读 Thread 与工单。
  const returned = new Set(disposition.handbacks?.map(item => item.ticketId))
  const reached = disposition.fanout.filter(id => !returned.has(id) && !disposition.context?.includes(id))
  // 主线程恒存在是 Trigger 的不变量(threads[0]);守卫只令畸形输入不炸穿,合法输入语义与 SA 原样一致。
  const primary = trigger.threads[0]
  if (!reached.length || !primary || records.threads.get(threadKey(primary))?.evaluating?.triggerIds.includes(trigger.id)) return []
  return reached.filter((id) => {
    const ticket = records.tickets.get(id)
    return !!ticket && (liveTicket(ticket) || (ticket.ended?.by !== 'human'
      && ticket.inputs.some(input => input.kind === 'trigger' && input.triggerId === trigger.id && ticket.undelivered.includes(input.id))))
  })
}
/**
 * 一个 Decision 是否已裁决人消息所求:对它的 stop(无论执行或拒绝)只裁决该工单的工作,把它路由到某工单
 * 则交给该工单的 worker,unavailable 则什么也没裁决。
 */
export const settled = (decision: Pick<Decision, 'kind' | 'reason'>): boolean => !['stop', 'unavailable'].includes(decision.kind)
  && !decision.reason.some(reason => ['stopNotExplicit', 'stopUnknown', 'routed'].includes(reason.code))

export type Strength = 'explicit' | 'inferred'
/** 准入表中接收 scope 那一行的单元格,按发送者是否在名单内、是否对 agent 说话区分。 */
export type AdmissionCell = 'listedUnaddressed' | 'unlistedAddressed' | 'unlistedUnaddressed'
/**
 * 主动候选的处置档位:评估并接受(`auto`);仍评估、Decision 记录 `would_accept` 但不接受(`observe`,
 * 24a B1 观察模式);不受理(`off`)。
 */
export type AcceptMode = 'off' | 'observe' | 'auto'

/**
 * R1 effort 分级三档(24 §5.5-R1;26 §4.1 effort 段;35 号 A17):一次工单工作的规模档位,
 * 由领域包 effort 档位声明段供给、评估方随 accept 固化(`AssessmentOutcome.effort`)、
 * 进候选卡字段(`Candidate.effort`)与 Mandate 执行契约(`Execution.effort`/assignment 文本)。
 * 档位同时给出 subagent 数量预算(见 `EFFORT_SUBAGENTS`)与预算守卫的分档上限键
 (34 §2.4 dsh 行 R1 落点;settings.budget.caps 按档配置)。
 */
export type EffortTier = 'simple' | 'compare' | 'complex'
/**
 * effort 三档的 subagent 数量预算(24 §5.5-R1 原文分级:简单 1 agent / 比较 2–4 subagent /
 * 复杂 10+;35 号 A17「effort 三档(simple 1 / compare 2–4 / complex 10+)」)。纯数据表,
 * 上界 undefined 表示不设上限(复杂档「10+」)。
 */
export const EFFORT_SUBAGENTS: Readonly<Record<EffortTier, { min: number; max?: number }>> = {
  simple: { min: 1, max: 1 },
  compare: { min: 2, max: 4 },
  complex: { min: 10 },
}
/** Mandate 的 Trigger 在何处被接收:其 Source、Source 记录的接收 scope、及其准入行。 */
interface Received { source?: string; scope?: Record<string, unknown>; row?: string }
/**
 * gate 如何准入了 Mandate 所来自的 Trigger(revalidate 复查之,见 SA docs/002):
 * - `addressed`:Source 名单上的发送者对 agent 说话;
 * - `followup`:一条落在已有工单的 Thread 上的消息;
 * - `admission`:接收 scope 准入行的单元格;推断候选在某 accept 档位下产生时附 `observation`;
 * - `listed`:在 Mandate 记录依据之前接受的,来自一个必须仍在名单上的发送者;更早版本记录的是 `authority`;
 * - `bot`:Source bot 名单上 bot 的消息——至多是推断候选,绝不是显式请求或 stop。
 * `sender` 记录接受当时的合法发送者,`rules` 记录评估命中的规则。
 */
export type MandateBasis = Received & { sender?: string; rules?: string[] } & (
  | { via: 'addressed'; addressed: 'mention' | 'direct' }
  | { via: 'followup'; authority?: string }
  | { via: 'admission'; cell: AdmissionCell; addressed?: 'mention' | 'direct'; observation?: { mode: AcceptMode } }
  | { via: 'listed'; addressed?: 'mention' | 'direct'; observation?: { mode?: AcceptMode }; authority?: string }
  | { via: 'bot'; addressed?: 'mention' | 'direct'; observation: { mode: AcceptMode } }
)

/** accept 决策固化出的不可变授权;执行被它限定,且它永不改变。 */
export interface Mandate {
  strength: Strength
  policyVersion: string
  /** 租户 realm(必填,24a A1「realm 进内核模型」;34 §2.1):accept 固化 Mandate 时由 Eval 写入(34 §2.1 evals 行)。 */
  realm: string
  /** gate 的准入依据,供复查与审计。 */
  basis: MandateBasis
  actor: ActorRef
  scope: string
}

/** 线程上进行中的 trigger 评估;每线程至多一个。 */
export interface Evaluation {
  id: string
  threadKey: string
  triggerIds: string[]
  /** 给批次以强度的那条可受理 Trigger;Eval 开出的工单把它作为 origin。 */
  primary?: string
  strength: Strength
  /** 最强可受理 trigger 的行动者与 gate 依据;accept 时它们生成 Mandate。 */
  actor: ActorRef
  basis: MandateBasis
  policyVersion: string
  startedAt: string
  /** 候选卡到达 assessor Session 的时刻;此前不计时,deadline 从它起算。 */
  delivered?: string
  /** 过期时刻,自送达起算(送达前自开始起算);处理暂停按暂停时长顺延。 */
  deadline: string
  /** 处理暂停开始的时刻;恢复时 deadline 按暂停时长顺延,恢复后清空。 */
  pausedAt?: string
}

/** 线程聚合:Eval 的一致性边界,持有订阅与决策历史。 */
export interface Thread {
  key: string
  ref: ThreadRef
  createdAt: string
  /** 线程上最新 trigger 的时间。 */
  lastAt?: string
  /** 订阅本线程的工单;存活者经扇出收到每条 trigger 作为上下文。 */
  subscriptions: string[]
  /**
   * 订阅工单中,其 Executor 仅为只读上下文而跟随本线程的那些(如它找到的一个 Issue 或另一个 PR):
   * 消息能到达它们,但不授予任何权力;人在这上面的消息不恢复任何已结束的工单。
   */
  context?: string[]
  /** 与本线程共享过 trigger 的线程键;仅为上下文。 */
  correlated: string[]
  /** 等待下一次 Eval 的 trigger(防抖缓冲)。 */
  pending: string[]
  evaluating?: Evaluation
  /** 其排队的 Trigger 连续过期的 Eval 次数,每次过期都重新排队;一个 Decision 会清零。 */
  expired?: number
  /**
   * channels 或读取面需要的 Source 原生属性(如飞书线程 id)。其 Source 也可为人描述该线程:
   * `label` 显示名与 `facts`(见 {@link ThreadFacts})。
   */
  meta: Record<string, unknown>
}
/** 双语文本,或同一文本两写。 */
export type Text = string | { zh: string; en: string }
/** Source 就其线程陈述的一条事实,如 issue 编号或 CI 结果;`problem` 标记需要人处理的一条。 */
export interface ThreadFact { label?: Text; value: Text; problem?: true }
/** 线程的事实,按 id 索引、按展示排序;每个写入方拥有自己的事实 id。 */
export type ThreadFacts = Record<string, ThreadFact>

export type DecisionKind = 'ignore' | 'accept' | 'reopen' | 'stop' | 'unavailable'
/**
 * R3 委派四要素(24 §5.5-R3;34 §2.1 evals 行;35 号 A7):一次 accept 必须把委派说完整——
 * 目标、产出形态、工具指引、任务边界。缺失任一,`decide` 抛 `UserError('delegationIncomplete')`
 * (结构校验,不靠 prompt 约定);业界证据:模糊委派是重复劳动首因(24 §5.5-R3)。
 */
export interface Delegation {
  /** 目标:这件工作要达成什么。 */
  objective: string
  /** 产出形态:结果以什么格式交付(文件/报告/补丁等)。 */
  outputFormat: string
  /** 工具指引:允许与期望使用的工具、路径与做法。 */
  toolGuidance: string
  /** 任务边界:做到哪里为止、不做什么。 */
  taskBoundaries: string
}
/** 一次 Eval 的结论,落在线程上。 */
export interface Decision {
  id: string
  evalId: string
  threadKey: string
  triggerIds: string[]
  policyVersion: string
  at: string
  kind: DecisionKind
  /** 理由,按码:一条理由,或批次中每条 Trigger 各一条。 */
  reason: Reason[]
  strength: Strength
  ticketId?: string
  mandate?: Mandate
  /**
   * ★本仓改造(34 §2.1 evals 行;35 号 A7):accept 携带的 R3 委派四要素随 Decision 落库——
   * 审计 trace「Trigger→候选卡→Decision 理由→四要素→报告→门禁」全链可查的一环(35 号表②-6)。
   */
  delegation?: Delegation
  /** assessor 提供的审计数据(规则评估、方向、证据)。 */
  audit?: Record<string, unknown>
  /**
   * ★本仓改造(24 §5.5-R1;26 §4.1 effort 段;35 号 A17):accept 固化的 effort 档位随 Decision
   * 落库——审计 trace「候选卡→Decision→执行契约→预算守卫」全链可查的一环;R1 预算守卫按它取
   * settings.budget.caps 的分档上限。
   */
  effort?: EffortTier
  /** 人已关闭 unavailable Decision 所示的问题。 */
  dismissed?: true
}

export type AssignmentState = 'pending' | 'running' | 'ended'
/**
 * Assignment 的汇报:工作在进行(`progress`)、其 worker 在等一条 Trigger(`waiting`)、结果就绪(`ready`)、
 * 需要人行动才能解锁或恢复(`blocked`/`failed`)、无事可做(`dropped`)。
 */
export type ReportState = 'progress' | 'waiting' | 'ready' | 'blocked' | 'failed' | 'dropped'
/** 工单与一个 executor 实例之间的绑定。 */
export interface Assignment {
  id: string
  state: AssignmentState
  createdAt: string
  startedAt?: string
  endedAt?: string
  endedReason?: string
  report?: { state: ReportState; summary: string; at: string }
  /** Input 最近到达 worker 的时刻;与之相等或更晚的 report.at 意味着此后 worker 一直在处理 Input。 */
  deliveredAt?: string
  /** 其 worker 上一轮结束且无事可跑、无事可等的时刻:其 Session 此前摄入的步骤内容,worker 已读。 */
  idleAt?: string
}

export type TicketInput =
  /** 其线程上或 attach 到它的一条 Trigger;人写的带 `human`。 */
  | {
    id: string
    kind: 'trigger'
    triggerId: string
    at: string
    note?: string
    human?: true
    /** 它仅因 Executor 以 context 跟随的线程而到达该工单。 */
    context?: true
    /**
     * worker 的 Session 把携带它的消息纳入某步骤的时刻,此后其模型可读到它;在 Session 里等待时为 `null`。
     * 读记录之前送达的没有该字段,视作自 `deliveredAt` 起已读。
     */
    readAt?: string | null
    /** 它最后被投递到的 Assignment。 */
    deliveredTo?: string
    /** 更早版本把它交给 worker 的时刻。 */
    deliveredAt?: string
  }
  /** Policy 发生了影响该工单的变更,如 `effect` 所述;effects 之前的 Input 没有该字段。 */
  | { id: string; kind: 'policy-changed'; from: string; to: string; at: string; effect?: PolicyEffect }
  /** 一个 Decision 重开了该工单;在已结束工单自行恢复之前写入。 */
  | { id: string; kind: 'reopen'; decisionId: string; at: string }
  /** 其线程上的一条人消息在 Mandate 不变的前提下恢复了已结束的工单。 */
  | { id: string; kind: 'resumed'; triggerId: string; at: string }
  | { id: string; kind: 'text'; text: string; at: string }
  /** 主 Session 从其他工作带给该工单的一条事实:上下文,不请求任何事、不授予任何权力。 */
  | { id: string; kind: 'note'; text: string; at: string }

/**
 * Policy 变更如何影响一个工单:它被接受时所依据的规则发生了变更(附现在的指示)或不再适用;
 * 推断工作不再被接受时 `proactive: false`(如 accept 档位离开 auto);它所服务的人(`requester`,
 * 人或 bot)不再可以在该处发起工作时 `requesterAllowed: false`。
 */
export interface PolicyEffect {
  rules?: { id: string; name: string; change: 'changed' | 'disabled'; instruction?: string }[]
  proactive?: false
  requesterAllowed?: false
  requester?: ActorRef
}

export type TicketEndBy = 'executor' | 'human'
/** 工单如何结束:带结果、PR 被合并或未合并关闭、无事可做、或被人 stop。 */
export type TicketOutcome = 'completed' | 'merged' | 'closed' | 'dropped' | 'stopped'
/** 给人的一个问题;`triggerId` 是提出它的人消息,答复也回到那段对话。 */
export interface Attention { id: string; question: string; triggerId?: string }
/** 工单聚合:一件获授权的工作,连同其 assignments、channels、线程绑定与 inputs。 */
export interface Ticket {
  id: string
  title: string
  decisionId: string
  /** 租户 realm(必填,24a A1「realm 进内核模型」;34 §2.1):本工单归属的租户,一租户一 SQLite 按它路由(34 §2.3)。 */
  realm: string
  mandate: Mandate
  /** 它被接受时所来自消息的 channels,回复也发往那里。 */
  channels: ChannelRef[]
  /** 工单何时、由谁、如何结束,附人或宿主在 outcome 之外的缘由;开放工单没有该字段。 */
  ended?: { at: string; by: TicketEndBy; outcome: TicketOutcome; reason?: string }
  /** 给人的开放问题;由 executor 清除,或随工单结束清除。 */
  attention?: Attention
  assignments: Assignment[]
  inputs: TicketInput[]
  /** 尚未交给运行中 assignment 的 inputs。 */
  undelivered: string[]
  /**
   * Source 让工单跟随的线程,如它的 PR 线程:`ready` 报告只在 `followsDone` 成立时结束工单;使其成立的
   * close 以该 outcome 结束工单——除非其工作尚未完成(见 Tickets.unfinished),此时其下一个 `ready` 或
   * `dropped` 报告再结束它。
   */
  follows?: Follow[]
  /** worker 已答的人的提问,其答案可由主 Session 发出。 */
  answers?: string[]
  createdAt: string
  updatedAt: string
  /** 它被接受时所来自的 Triggers:开启它的那条,与其 Eval 持有的批次。 */
  origin: { triggerId: string; triggerIds: string[] }
  /**
   * ★本仓改造(24a 拍板记录·A6;26 §6.2「referenceTaskIds 语义,与 A2A 对齐」;35 号 A8):
   * 交接来源——本工单接手自哪些原工单。新工单 Mandate 独立(不继承原工单授权),原工单订阅
   * 新工单线程(见 Tickets.create 的 handoff 路径);跨工单协调走交接、不走 agent 互聊(27 §2.1-2)。
   */
  references?: string[]
  /** 其 Executor 的选择:短名、目录与任务文本。 */
  execution?: Execution
  /** 最近一次向其 worker 投递 Input 失败的记录,直到某次投递成功。 */
  delivery?: { error: string; at: string }
}
/**
 * 工单跟随的一条线程,按其键:工单自己开的(如自己的 PR)为 `own`,并记录何时、如何关闭。
 * 没有 `own` 线程未关闭、或(无 `own` 线程时)全部跟随线程已关闭,则 `followsDone` 成立;此时工单结束——
 * 除非其工作尚未完成(见 Tickets.unfinished)。
 */
export interface Follow { thread: string; own: boolean; closed?: { at: string; outcome: 'merged' | 'closed' } }
/**
 * 工单与其 Executor 之间的绑定。★本仓改造(35 号 A15/A17):`directory` 为 R4 工单目录
 * `<realm 工作区>/.ticket/<id>/`(24 §5.5-R4 原文目录名,executor/workspace.ts 派生);
 * `assignment` 文本含 R2 门禁执行契约(「ready=门禁通过」,gates.ts 契约条款);
 * ★A17:`effort` 是 accept 固化的 R1 effort 档位(24 §5.5-R1;26 §4.1 effort 段),
 * Executor 以它取 settings.budget.caps 的分档上限。
 */
export interface Execution { name: string; directory: string; assignment: string; effort?: EffortTier }

/** 工单是否存活:尚未结束。 */
export const liveTicket = (ticket: Pick<Ticket, 'ended'>): boolean => !ticket.ended
/** 工单如何结束。 */
export const ticketOutcome = (ticket: Pick<Ticket, 'ended'>): TicketOutcome | undefined => ticket.ended?.outcome
export const runningAssignment = (ticket: Ticket): Assignment | undefined => ticket.assignments.find(assignment => assignment.state === 'running')
/**
 * 一条 Trigger 是否到达了某工单:它开启了该工单、作为 Input 来到它、或落在它订阅的线程上;`context` 为
 * false 时,不算它仅为上下文而跟随的线程——在那里其 worker 可读不可写。
 */
export function reached(ticket: Ticket, trigger: Trigger, thread: (key: string) => Thread | undefined, context = true): boolean {
  if (ticket.origin.triggerId === trigger.id) return true
  const input = ticket.inputs.some(item => item.kind === 'trigger' && item.triggerId === trigger.id)
  return trigger.threads.some((ref) => {
    const current = thread(threadKey(ref))
    return current?.subscriptions.includes(ticket.id) === true && (context || !current.context?.includes(ticket.id))
  }) || (input && (context || !trigger.threads.every(ref => thread(threadKey(ref))?.context?.includes(ticket.id))))
}
export const latestAssignment = (ticket: Ticket): Assignment | undefined => ticket.assignments.at(-1)
/** 工单全部 Assignment 中最新的那条报告,即该工单最后说过的话。 */
export const latestReport = (ticket: Pick<Ticket, 'assignments'>): Assignment['report'] => ticket.assignments.findLast(assignment => assignment.report)?.report
/**
 * 工单的 worker 直到何时有过一轮去读到达它的内容:其最新报告(但 `progress` 为 false 时跳过 progress 报告),
 * 或其最新一轮的结束时刻,取更晚者。
 */
export function readUntil(ticket: Pick<Ticket, 'assignments'>, progress = true): string {
  const report = ticket.assignments.findLast(assignment => assignment.report && (progress || assignment.report.state !== 'progress'))?.report
  return [report?.at ?? '', ...ticket.assignments.map(assignment => assignment.idleAt ?? '')].reduce((a, b) => a > b ? a : b)
}
/**
 * 工单是否在等人(原样保留,35 号 A3):其最新 Assignment 汇报了 blocked 或 failed,且此后没有人的消息
 * 到达它。之后一条别的报告、一条人的消息、或一次重试(开启新 Assignment)都会解除它。
 */
export function waitsForPerson(ticket: Ticket): boolean {
  const report = latestAssignment(ticket)?.report
  if (report?.state !== 'blocked' && report?.state !== 'failed') return false
  return !ticket.inputs.some(input => input.kind === 'trigger' && input.human && !input.context && input.at > report.at)
}
