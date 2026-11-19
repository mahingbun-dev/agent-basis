/**
 * 工作台共享数据面(38 号 §4):Host 半边(mock 事件源/dev 服务)与浏览器半边
 * (面板页渲染)共用的快照/事件结构。M3 阶段由 mock 事件流驱动(30 号 §6);
 * M4 切换 Engine DomainEvents 时仅换数据源,投影层不动(38 号 §9 解耦对策)。
 *
 * 事件命名纪律(38 号 §10 O-1/O-2):mock 事件一律 `workbench-mock` 命名空间
 * + kind 判别,不冒充 Engine 的 11 个 DomainEvents(其枚举以 WS-A 落地的
 * packages/tasks/src/core/ports.ts 为准,mock 阶段不得虚构事件名)。
 */
import type { ApprovalCard } from '@eterna/interact/card'

/** 看板列(30 号 §2 视图 1 分列;原型 03 四列布局:等人/进行中/排队中/空闲)。 */
export type KanbanColumn = 'person' | 'working' | 'queued' | 'idle'

/** 可见性视角(30 号 §4-5/§7-3 拍板;原型 03 视角过滤 chip 三态)。 */
export type WorkbenchRole = 'user' | 'approver' | 'admin'

/** 日志摘要行/全文中的文本段(mono = 等宽代码体,num = 表格数字)。 */
export interface LogSegment {
  readonly text: string
  readonly mono?: boolean
  readonly num?: boolean
}

/** 结果状态徽标(语义色配文字,frontend-style §3 徽标行)。 */
export type StatusTone = 'accent' | 'success' | 'warn' | 'danger' | 'muted'

export interface LogStatus {
  readonly label: string
  readonly tone: StatusTone
}

/** 看板工单卡(原型 03 视图一;metaLine = 卡片中行 spans 逐字)。 */
export interface WorkbenchTicket {
  readonly id: string
  readonly title: string
  readonly column: KanbanColumn
  /** 中行 meta spans(工单号/阶段码或 worker 注记/等待注记/驻留时长)。 */
  readonly metaLine: readonly LogSegment[]
  /** Attention 徽标行(person/* 卡点卡;原型「Attention #12 · 卡点驻留」)。 */
  readonly attention?: { readonly id: number; readonly note: string }
  /** 发起人(mock realm 钳制用;30 号 §4-5 普通用户仅自己的工单)。 */
  readonly owner: string
  /** person/* 等待起算时刻(HH:mm;卡点行「最近事件」与 Assignment 节点事件行)。 */
  readonly sinceTime?: string
  /** person/* 已等待分钟数(卡点「最长」比较口径;非 person 工单缺省)。 */
  readonly waitMinutes?: number
  /** 最近事件行(原型 04 视图 A「最近事件」列;无则渲染「—」)。 */
  readonly recentNote?: { readonly time: string; readonly text: string }
  /** 旁挂列表行三列(原型 04 视图 A:当前节点/等待谁/停留;mock 逐字,
   * M4 实接由真实 stage/worker 数据派生)。 */
  readonly a11yRow?: { readonly node: string; readonly waiting: string; readonly dwell: string }
  /** 会话侧栏行 meta(原型 01 侧栏行「id + 阶段 + 等谁 + 耗时」逐字——侧栏为
   * 发起人自视角,等谁以「你」称;缺省回落 metaLine(看板面)。a11yRow 同款
   * 逐表面 mock 文案惯例)。 */
  readonly sidebarLine?: readonly LogSegment[]
}

/**
 * 冲突三指标(27 号 D2;38 号 K-2/K-3 先记录不告警)。
 * M4 实接(38 号 T8):计数点为 tasks 内核的计数暴露位(35 号表②——attach=
 * evals routed 决策、duplicate=intake 幂等三态返回值、插队=WorkerSlots.personBarges);
 * 某计数点未接线(如 duplicate 只在 receive 返回值里、不落库不发事件)时以
 * `unavailable: true` 如实标注,不伪报 0(AGENTS.md「数字必须实测可追溯,不编造」)。
 */
export interface ConflictMetrics {
  readonly attach: { readonly count: number; readonly note: string; readonly unavailable?: true }
  readonly duplicate: { readonly percent: number; readonly thresholdPercent: number; readonly note: string; readonly unavailable?: true }
  readonly jump: { readonly count: number; readonly note: string; readonly unavailable?: true }
}

/** 单条日志(视图三摘要行四字段:来源(工具名)/参数摘要/结果状态/耗时)。 */
export interface WorkbenchLogEntry {
  readonly id: string
  /** 归属工单(工单过滤 chip;worker 会话日志归 'session' 组)。 */
  readonly ticketId: string
  readonly group: 'audit' | 'worker-session'
  readonly time: string
  readonly source: string
  readonly summary: readonly LogSegment[]
  readonly status: LogStatus
  readonly duration: string
  /** 展开全文段(原始文本,展示层经 governance pii redact,只过滤不删改)。 */
  readonly full?: readonly (readonly LogSegment[])[]
}

/** 评测监控快照(视图四;数据源 dsh-evals + observe,30 号 §2 视图 4)。 */
export interface EvalSnapshot {
  /** 金集通过率趋势(近 N 次跑批,百分比)。 */
  readonly trend: readonly number[]
  /** 最近跑批环比(百分点;原型口径为独立数据字段,非趋势末两值之差)。 */
  readonly passDelta: number
  /** 金集规模(条)。 */
  readonly suiteSize: number
  /** 路由金集衰减序列(会话深度 1..N,单位 pp;28 号 §5 阈值 2pp)。 */
  readonly decaySeries: readonly number[]
  /** 最近一次衰减读数(独立数据字段,非序列末值;原型口径)。 */
  readonly decayLatestPp: number
  readonly decayThresholdPp: number
  /** 漂移检测(observe;无警报时 label='无警报')。 */
  readonly drift: { readonly label: string; readonly days: number }
  /** 本周回归跑批次数。 */
  readonly weeklyRuns: number
}

/** 信息流图九节点 key(30 号 §2 视图 2 活图链路;38 号 F-13 封闭清单,不增删)。 */
export type FlowNodeKey =
  | 'trigger'
  | 'thread'
  | 'eval'
  | 'decision'
  | 'ticket'
  | 'assignment'
  | 'worker'
  | 'report'
  | 'outbox'

/** 节点态词汇(原型 03 图例:待命/活跃/卡点/异常 fail-closed)。 */
export type FlowNodeTone = 'idle' | 'active' | 'stuck' | 'error'

/** 非派生节点的活况(38 号 F-3:节点即领域对象;stuck 只属于 Assignment——
 * 卡点 = person/* 工单驻留,30 号 §2.1,由快照工单列派生,不入静态数据)。 */
export interface FlowNodeLiveState {
  readonly key: Exclude<FlowNodeKey, 'assignment'>
  readonly state: Exclude<FlowNodeTone, 'stuck'>
  /** 画布节点副行(原型 03 fsub,如「今日 23 次」)。 */
  readonly sub: string
  /** 旁挂列表「最近事件」展开行(原型 04 视图 B event-list;mono/num 段标记)。 */
  readonly events: readonly (readonly LogSegment[])[]
}

/** 信息流图活况快照节(快照成员;增量事件只动 tickets,派生节点随投影刷新)。 */
export interface FlowLiveState {
  /** 八个非派生节点(Assignment 由 tickets 派生;ticket/worker 计数亦派生)。 */
  readonly nodes: readonly FlowNodeLiveState[]
  /** 活跃边端点对(原型 03 fedge-live;200ms 合批推送中的 DomainEvents 流向)。 */
  readonly liveEdges: readonly { readonly from: FlowNodeKey; readonly to: FlowNodeKey }[]
  /** WorkerSlots 容量(worker 节点「N/4 槽」分母)。 */
  readonly workerSlots: number
  /** 单工单回放可选工单(原型 03 回放 select 两项;M4 由 audit trace 可回放性决定)。 */
  readonly replayOptions: readonly string[]
}

/** worker 检查器 · 子代理树节点(27 号三层结构的实况;38 号 W-2 不增层)。 */
export interface WorkerTreeNode {
  readonly name: string
  /** 层注(如「主 Session · 组织层」/「T-9c81 · 战术层」/「运行中 · 2 分钟 · 执行层」)。 */
  readonly role: string
  readonly state: 'idle' | 'working' | 'queued' | 'ready'
  /** 当前 worker 节点标记(原型 tree-node is-current)。 */
  readonly current?: boolean
  readonly children?: readonly WorkerTreeNode[]
}

/** worker 检查器 · job 条目(运行中/已结束同构;meta 如「后台 job #31 · 运行 2 分钟」)。 */
export interface WorkerJobItem {
  readonly id: string
  readonly name: string
  readonly meta: string
  readonly running: boolean
}

/** worker 检查器 · 工具调用史行(五字段:时间/工具/参数摘要/状态/耗时;原型 03 v5 表)。 */
export interface WorkerToolRow {
  readonly id: string
  readonly time: string
  readonly tool: string
  readonly params: string
  readonly status: LogStatus
  readonly duration: string
}

/** worker 检查器快照(30 号 §2 视图 5;数据源上游 session/jobs 事件 + R1 预算,M3 mock)。 */
export interface WorkerInspectorSnapshot {
  readonly workerId: string
  readonly ticketId: string
  readonly runMinutes: number
  readonly presetNote: string
  readonly slotsUsed: number
  readonly slotsTotal: number
  readonly domainPack: string
  readonly tree: WorkerTreeNode
  readonly jobs: readonly WorkerJobItem[]
  readonly toolHistory: readonly WorkerToolRow[]
  /** 上下文占用 %(R1 预算数据;压缩阈值 28 号)。 */
  readonly context: { readonly percent: number; readonly thresholdPercent: number; readonly note: string }
  /** 成本累计(R1 预算守卫;tokens/maxTurns 为其组成注记)。 */
  readonly cost: {
    readonly spentYuan: number
    readonly budgetYuan: number
    readonly tokensNote: string
    readonly maxTurns: string
    readonly note: string
  }
}

/** 会话侧栏 · 会话行(原型 01「会话」分区;发起自渠道注记,24 号 §7.2 原对话)。 */
export interface SidebarSession {
  readonly id: string
  readonly title: string
  readonly channel: string
}

/** 多 Assignment 分支(38 号 T6/S-4:退回 = 同工单新 Assignment = 新分支,
 * 24 号 §7.2 T+21min 行;failed 重试 = 新分支,27 号 §1.2 失败语义行)。
 * M3 为 mock 脚本数据;M4 由 tasks Assignment 面投影。 */
export interface AssignmentBranch {
  readonly ticketId: string
  /** Assignment 序号(分支号,1 起)。 */
  readonly seq: number
  /** 分支态(Assignment/Report 六态的侧栏词汇:working/ready/failed;blocked 归入 working 注记)。 */
  readonly state: 'working' | 'ready' | 'failed'
  /** 分支注记(侧栏 chip 副行,如「退回：口径复核」/「首轮 · failed 重试」)。 */
  readonly note: string
  /** 当前活跃分支(工单在办 Assignment;切换入口高亮基准)。 */
  readonly active: boolean
}

/** 报告时间线块(38 号 T6/S-4:复用 assistant blocks 范式——24 号 §3.3/§6 P2 行;
 * 块词汇 = 原型 01 会话面逐字:sysline 阶段线 / message 消息 / ask 单问卡 /
 * result 结果卡。静态按钮/输入为占位,动作经 props 留 M4 接口)。 */
export type TimelineBlock =
  | { readonly kind: 'sysline'; readonly time: string; readonly text: string }
  | {
    readonly kind: 'message'
    readonly side: 'user' | 'agent'
    readonly who: string
    readonly time: string
    readonly text: string
    /** 附件 chips(发起人上传/产出文件;原型 01 file-chip)。 */
    readonly files?: readonly { readonly name: string; readonly meta?: string }[]
  }
  | { readonly kind: 'ask'; readonly title: string; readonly question: string; readonly placeholder: string; readonly foot: string }
  | { readonly kind: 'result'; readonly title: string; readonly files: readonly { readonly name: string; readonly meta?: string }[]; readonly summary: readonly string[] }

/** 单工单单分支的报告时间线(快照节;按 ticketId + 分支号寻址)。 */
export interface TicketTimeline {
  readonly ticketId: string
  readonly branchSeq: number
  readonly blocks: readonly TimelineBlock[]
}

/**
 * Attention 卡快照(38 号 T7:站内横幅形态,interact card.ts 管线**超集**——
 * B7/A-1:payload 构造走 packages/interact/src/card.ts buildApprovalCard,
 * 不另起管线;附加面 = 单问/倒计时/超时升级三阶段/渠道注记)。一次仅驻留
 * 一张待答卡(原型 02「一次一问」;面板健康态不占版面,30 号 §1)。
 */
export interface AttentionCardSnapshot {
  /** 归属工单(横幅徽标行 mono 段;与看板 T-a21f 卡同源)。 */
  readonly ticketId: string
  /** 单问(24 号 §2.1 行为律 3「一次只问一个具体的结构化问题」;横幅主问逐字)。 */
  readonly question: string
  /** 风险徽标行(原型 02 badge-danger,如「资金红线 R3」)。 */
  readonly riskLabel: string
  /** 风险档(card.ts 只允许 R2|R3 出卡)。 */
  readonly grade: 'R2' | 'R3'
  /** 发起人 / 渠道 / Mandate 注记(原型 02 attn-meta 三段)。 */
  readonly originator: string
  readonly channel: string
  readonly mandateNote: string
  /** 上下文行(原型 02 attn-context:预算/命中规则/冷静期)。 */
  readonly contextNote: string
  /** 已等待分钟数(attn-meta「已等待」段)。 */
  readonly waitedMinutes: number
  /** 距超时剩余分钟数(负值 = 已超时,倒计时转「已超时 N 分钟」);超时窗口 = 4 小时(原型 02)。 */
  readonly remainingMinutes: number
  /** 升级阶段(原型 02 三阶段:常规/临近超时/已升级;阶段阈值未拍板,M3 为数据字段)。 */
  readonly stage: 'normal' | 'urgent' | 'escalated'
  /** 超时升级提示(attn-escalate 行逐字;升级不撤销工单,24 号 §7.6)。 */
  readonly escalateNote: string
  /** 回原对话入口注记(横幅 ghost 链接;M4 跳原对话)。 */
  readonly conversationNote: string
  /** card.ts 管线超集载体:五必备字段 + R3 附加(buildApprovalCard 产物,含 renderedDetail)。 */
  readonly card: ApprovalCard
}

/** 工作台全量快照(SSE 连接先推全量,30 号 §3 快照行)。 */
export interface WorkbenchSnapshot {
  readonly tickets: readonly WorkbenchTicket[]
  readonly conflict: ConflictMetrics
  readonly logs: readonly WorkbenchLogEntry[]
  readonly eval: EvalSnapshot
  readonly flow: FlowLiveState
  readonly worker: WorkerInspectorSnapshot
  /** 会话侧栏会话行(T6;原型 01「会话」分区)。 */
  readonly sessions: readonly SidebarSession[]
  /** 多 Assignment 分支(T6;退回/重试 = 新分支,24 号 §7.2、27 号 §1.2)。 */
  readonly assignments: readonly AssignmentBranch[]
  /** 报告时间线(T6;assistant blocks 范式,按工单 + 分支寻址)。 */
  readonly timelines: readonly TicketTimeline[]
  /** 驻留 Attention 卡(T7;一次仅一张;缺省 = 无待人卡,健康态不占版面)。 */
  readonly attention?: AttentionCardSnapshot
  /**
   * orchestrator 主会话 id(工作台「主会话」显式入口,2026-11-19):空主会话在
   * 侧栏只以「新会话」占位行出现,本字段给入口一个稳定寻址面;来源 =
   * tasks stats().masterId(主会话未引导时缺省,入口不渲染)。
   */
  readonly masterSessionId?: string
}

/**
 * 流事件(SSE 帧载荷;seq 即 SSE id,单调递增)。
 * M3 mock 半边:snapshot/ticket-moved/log-appended/eval-run/worker-updated 五支。
 * M4 实接(38 号 T15/G2-D11)增四支整节替换型:tickets-updated(看板工单全集,
 * 引擎为唯一真值源,由 DomainEvents 触发重投影)、flow-updated(信息流活况,
 * 真事件流驱动)、conflict-updated(冲突三指标,G2-A10 计数)、eval-updated
 * (评测监控整节,dsh-evals 结果/漂移刷新)。mock 命名空间纪律不变:载荷 kind
 * 判别,不冒充 Engine 的 DomainEvents(其枚举见 packages/tasks/src/core/ports.ts)。
 */
export type WorkbenchStreamEvent =
  | { readonly kind: 'snapshot'; readonly seq: number; readonly snapshot: WorkbenchSnapshot }
  | {
    readonly kind: 'ticket-moved'
    readonly seq: number
    readonly ticketId: string
    readonly column: KanbanColumn
    readonly metaLine: readonly LogSegment[]
  }
  | { readonly kind: 'log-appended'; readonly seq: number; readonly entry: WorkbenchLogEntry }
  | { readonly kind: 'eval-run'; readonly seq: number; readonly passRate: number }
  | { readonly kind: 'worker-updated'; readonly seq: number; readonly worker: WorkerInspectorSnapshot }
  | { readonly kind: 'tickets-updated'; readonly seq: number; readonly tickets: readonly WorkbenchTicket[] }
  | { readonly kind: 'flow-updated'; readonly seq: number; readonly flow: FlowLiveState }
  | { readonly kind: 'conflict-updated'; readonly seq: number; readonly conflict: ConflictMetrics }
  | { readonly kind: 'eval-updated'; readonly seq: number; readonly eval: EvalSnapshot }

/** 分发型 Omit(联合上逐支剔除,保留各支判别字段)。 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** 增量事件(未分配 seq 的形态;mock 时间线与实时源的 emitIncrement 入参)。 */
export type WorkbenchIncrement = DistributiveOmit<
  Extract<WorkbenchStreamEvent, { kind: 'ticket-moved' | 'log-appended' | 'eval-run' | 'worker-updated'
    | 'tickets-updated' | 'flow-updated' | 'conflict-updated' | 'eval-updated' }>,
  'seq'
>
