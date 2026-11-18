/**
 * tasks 引擎领域模型 → 工作台视图投影(38 号 T8/T12 的 M4 实接半边;30 号 §2
 * 视图 1/视图 5 数据源列「tasks Engine」)。纯函数层(G-11):输入 = @eterna/tasks
 * 的 Ticket/Decision 与只读计数,输出 = types.ts 视图结构;渲染与传输只消费本层
 * 产出。不改 tasks 内核(38 号 §3「不做」:workbench 只读消费 DomainEvents 与
 * EngineForPeople 面)。
 *
 * 分列依据 = tasks `ticketStage()`(34 号 §2.1 stage 行「供 30 号看板分组」;
 * tests/stage.spec.ts 钉住的分类表):person/delivery|answer|review|blocked|failed
 * → 等人列,working(+queued) → 进行中/排队中,idle → 空闲;已结束工单不进看板
 * (四列为开放工单阶段,30 号 §2 视图 1)。
 */
import type { ReportState, Ticket, TicketStage } from '@eterna/tasks'
import { latestAssignment, latestReport, ticketStage } from '@eterna/tasks'
import type { ConflictMetrics, KanbanColumn, LogSegment, WorkbenchTicket } from '../types.ts'

/** 高层阶段 → 看板列(K-1:person/*、working、working/queued、idle;ended 不进看板)。 */
export function stageColumn(stage: TicketStage): KanbanColumn | undefined {
  if (stage.stage === 'person') return 'person'
  if (stage.stage === 'working') return stage.action === 'queued' ? 'queued' : 'working'
  if (stage.stage === 'idle') return 'idle'
  return undefined
}

/** 阶段码(metaLine 第二段;与原型 03 meta 词汇同源:person/answer、working/queued…)。 */
export function stageCode(stage: TicketStage): string {
  if (stage.stage === 'person') return `person/${stage.action}`
  if (stage.stage === 'working') return stage.action === 'queued' ? 'working/queued' : 'working'
  return stage.stage
}

/** 阶段 → 旁挂列表「当前节点」(原型 04 视图 A node 列;person 族落在等人的节点上)。 */
function stageNode(stage: TicketStage): string {
  switch (stage.stage) {
    case 'person':
      return stage.action === 'delivery' ? 'Outbox 出箱' : 'Assignment 委派'
    case 'working':
      return stage.action === 'queued' ? 'Ticket 工单' : 'Worker 执行'
    case 'idle':
      return '—'
    case 'ended':
      return '—'
  }
}

/** 分钟数 → 人读时长(「4 小时」「1 小时 20 分」「6 分钟」;与原型 meta 数字段同词汇)。 */
export function humanDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`
}

/** ISO 时刻 → HH:MM(meta「14:02」式;非 ISO 原样)。 */
export function clockTime(iso: string): string {
  const at = Date.parse(iso)
  return Number.isFinite(at) ? new Date(at).toTimeString().slice(0, 5) : iso
}

/** person 阶段的等待起算时刻:delivery=投递失败、answer/blocked/failed=最近报告、review=ready 报告。 */
export function personWaitSince(ticket: Ticket): string {
  const delivery = ticket.delivery?.at
  if (delivery !== undefined) return delivery
  const stage = ticketStage(ticket)
  if (stage.stage === 'person' && stage.action === 'answer') {
    // Attention 无自带时刻:等谁 = 最近一次报告(attention 由 executor 在报告上提出/保留)。
    return latestReport(ticket)?.at ?? ticket.updatedAt
  }
  return latestReport(ticket)?.at ?? ticket.updatedAt
}

/** 工单最近事件行(最近报告的六态与摘要;无报告回落建票时刻;恒有值)。 */
function recentNoteOf(ticket: Ticket): { readonly time: string; readonly text: string } {
  const report = latestReport(ticket)
  if (report !== undefined) {
    const label: Record<ReportState, string> = {
      progress: '进度推进', waiting: '等待输入', ready: '结果就绪', blocked: '阻塞等人', failed: '失败待复', dropped: '无事可做',
    }
    return { time: clockTime(report.at), text: `${label[report.state]} · ${report.summary}` }
  }
  const assignment = latestAssignment(ticket)
  if (assignment !== undefined && assignment.state === 'pending') {
    return { time: clockTime(assignment.createdAt), text: '排队等待 worker 槽位' }
  }
  return { time: clockTime(ticket.createdAt), text: '建票完成' }
}

/** 等待注记(person 列「等谁」;28 号 §6 waitsForPerson 的可见化)。 */
function waitNoteOf(ticket: Ticket, stage: TicketStage): string {
  if (stage.stage !== 'person') return ''
  switch (stage.action) {
    case 'delivery': return '投递失败 · 待人工'
    case 'answer': return ticket.attention ? `等 ${ticket.mandate.actor.id} 回答（Attention）` : '等人回答'
    case 'review': return `等 ${ticket.mandate.actor.id} 验收`
    case 'blocked': return '阻塞报告 · 等人处理'
    case 'failed': return '失败报告 · 等人重试'
  }
}

/** 一张开放工单 → 看板卡(K-1;已结束工单返回 undefined——四列为开放工单阶段)。 */
export function ticketCardOf(ticket: Ticket, nowMs: number): WorkbenchTicket | undefined {
  const stage = ticketStage(ticket)
  const column = stageColumn(stage)
  if (column === undefined) return undefined
  const sinceIso = personWaitSince(ticket)
  const waitMinutes = column === 'person' ? Math.max(0, Math.round((nowMs - Date.parse(sinceIso)) / 60_000)) : undefined
  const code = stageCode(stage)
  const sinceTime = clockTime(sinceIso)
  const startedAt = latestAssignment(ticket)?.startedAt ?? ticket.updatedAt
  const runMinutes = Math.max(0, Math.round((nowMs - Date.parse(startedAt)) / 60_000))
  const metaLine: LogSegment[] = [
    { text: ticket.id, mono: true },
    { text: code },
    ...(column === 'person'
      ? [{ text: waitNoteOf(ticket, stage) }, { text: humanDuration(waitMinutes ?? 0), num: true }]
      : stage.stage === 'working' && stage.action !== 'queued'
        ? [{ text: humanDuration(runMinutes), num: true }]
        : [{ text: '等待 worker 槽位' }]),
  ]
  const waiting = column === 'person' ? waitNoteOf(ticket, stage) || '等人' : stage.stage === 'working' ? `worker ${ticket.execution?.name ?? '待分配'}` : stage.stage === 'idle' ? '轮间空闲 · 无待办' : '排队（槽位）'
  return {
    id: ticket.id,
    title: ticket.title,
    column,
    metaLine,
    ...(ticket.attention ? { attention: { id: 0, note: '卡点驻留' } } : {}),
    owner: ticket.mandate.actor.id,
    ...(column === 'person' && waitMinutes !== undefined ? { sinceTime, waitMinutes } : {}),
    recentNote: recentNoteOf(ticket),
    a11yRow: {
      node: stageNode(stage),
      waiting,
      dwell: column === 'person' ? humanDuration(waitMinutes ?? 0) : '—',
    },
    sidebarLine: [
      { text: ticket.id, mono: true },
      { text: code },
      { text: column === 'person' ? waitNoteOf(ticket, stage) : waiting },
      ...(column === 'person' ? [{ text: `已等 ${humanDuration(waitMinutes ?? 0)}`, num: true }] : []),
    ],
  }
}

/** 开放工单集 → 看板卡集(列序稳定:按工单建票时刻升序;ended 剔除)。 */
export function ticketCardsOf(tickets: readonly Ticket[], nowMs: number): readonly WorkbenchTicket[] {
  return [...tickets]
    .filter(ticket => ticket.ended === undefined)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    .map(ticket => ticketCardOf(ticket, nowMs))
    .filter(card => card !== undefined)
}

/**
 * 冲突三指标(27 号 D2;计数暴露位见 35 号表②:attach=evals 的 routed 决策
 * 「挂到已有工单」、duplicate=intake `receive` 幂等三态、插队=WorkerSlots
 * `personBarges()`)。duplicate 的 receive 返回值不落库不发事件(Duplicate 无
 * DomainEvent,intake.ts:32 三态返回即终),进程外无从后验观测——未接线时
 * `unavailable: true` 如实标注(不伪报 0);插队计数挂在 DshExecutor(A22 接线
 * 后可读,plugin.ts 本轮为 StubExecutor)。K-3:只展示,无告警字段。
 */
export const CONFLICT_DUPLICATE_UNAVAILABLE_NOTE = '幂等查重 · 计数接入后展示'
export const CONFLICT_JUMP_UNAVAILABLE_NOTE = '人插队 +1 槽（WorkerSlots）· 执行器 A22 接线后可采'

export function conflictFromTasks(inputs: {
  /** 窗口内 routed 决策数(eval 的 attach 次数;store 只读查询产物)。 */
  readonly attachCount: number
  readonly attachNote: string
  /** store 只读面缺席时给不可采注记(不伪报计数)。 */
  readonly attachUnavailableNote?: string
  /** duplicate:重复投递比例;不可采时 undefined。 */
  readonly duplicatePercent?: number
  readonly duplicateThresholdPercent?: number
  /** 插队次数;执行器未接线时 undefined。 */
  readonly jumpCount?: number
  readonly jumpNote?: string
}): ConflictMetrics {
  const threshold = inputs.duplicateThresholdPercent ?? 5
  const duplicate = inputs.duplicatePercent === undefined
    ? { percent: 0, thresholdPercent: threshold, note: CONFLICT_DUPLICATE_UNAVAILABLE_NOTE, unavailable: true as const }
    : { percent: Math.round(inputs.duplicatePercent * 10) / 10, thresholdPercent: threshold, note: '幂等 trigger id 查重 · 阈值 < 5%' }
  const jump = inputs.jumpCount === undefined
    ? { count: 0, note: inputs.jumpNote ?? CONFLICT_JUMP_UNAVAILABLE_NOTE, unavailable: true as const }
    : { count: inputs.jumpCount, note: inputs.jumpNote ?? '人插队 +1 槽（WorkerSlots），唤醒优先于新 launch' }
  return {
    attach: inputs.attachUnavailableNote === undefined
      ? { count: inputs.attachCount, note: inputs.attachNote }
      : { count: 0, note: inputs.attachUnavailableNote, unavailable: true },
    duplicate,
    jump,
  }
}

/**
 * routed 决策计数(attach 次数的读数面):decisions 中 reason 含 `routed` 码的
 * 条数——`Engine.attach` 经 evals.routed 写 `routed` 理由(evals.ts:262-264,
 * 「挂到已有工单 = 请求重叠的频率」,27 号 §5-2)。窗口按 `since`(ISO 字典序,
 * Decision.at 为 isoTime 归一时刻)。入参为 Decision 的结构子集(只读查询产物)。
 */
export interface DecisionLike {
  readonly at: string
  readonly reason: readonly { readonly code: string }[]
}

export function attachCountOf(decisions: readonly DecisionLike[], since: string): number {
  return decisions.filter(decision => decision.reason.some(reason => reason.code === 'routed') && decision.at >= since).length
}
