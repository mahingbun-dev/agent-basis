/**
 * 阶段看板投影(38 号 T8/K-1:工单按阶段分列;原型 03 视图一四列布局 +
 * 列头状态点)。纯函数:分组、视角 realm 钳制、阶段过滤与计数(38 号 G-11)。
 */
import type { KanbanColumn, WorkbenchRole, WorkbenchTicket } from '../types.ts'

/** 列头静态面(原型 03:等人 person 族、进行中 working、排队中 working/queued、空闲 idle)。 */
export interface KanbanColumnMeta {
  readonly key: KanbanColumn
  readonly label: string
  readonly stageCode: string
  /** 状态点词汇表(原型 03 dot-* 统一词汇)。 */
  readonly dot: 'wait-person' | 'working' | 'queued' | 'idle'
  /** person/* 列等人心跳(原型 dot-pulse)。 */
  readonly pulse: boolean
  /** 计数徽标语义色(person=warn,working=accent,其余 muted)。 */
  readonly countTone: 'warn' | 'accent' | 'muted'
}

/** 看板四列(布局以原型 03 为准;30 号 §2 视图 1 分列的行为面)。 */
export const KANBAN_COLUMN_META: readonly KanbanColumnMeta[] = [
  { key: 'person', label: '等人', stageCode: 'person/*', dot: 'wait-person', pulse: true, countTone: 'warn' },
  { key: 'working', label: '进行中', stageCode: 'working', dot: 'working', pulse: false, countTone: 'accent' },
  { key: 'queued', label: '排队中', stageCode: 'working/queued', dot: 'queued', pulse: false, countTone: 'muted' },
  { key: 'idle', label: '空闲', stageCode: 'idle', dot: 'idle', pulse: false, countTone: 'muted' },
]

/** 阶段过滤 chip 取值(原型:「全部/等人/进行中/排队/空闲」)。 */
export type StageFilter = 'all' | KanbanColumn

/** 视角 chip 静态面(原型 03 视角三态;30 号 §4-5/§7-3 拍板文案)。 */
export const ROLE_CHIPS: readonly { readonly role: WorkbenchRole; readonly label: string }[] = [
  { role: 'user', label: '普通用户（仅自己的）' },
  { role: 'approver', label: '审批人（全租户待人）' },
  { role: 'admin', label: '管理员（全量）' },
]

/**
 * 视角 realm 钳制(38 号 T13 消费面):普通用户仅自己的工单、审批人见全租户
 * 待人项(person/* 列)、管理员全量。
 */
export function clampTicketsByRole(
  tickets: readonly WorkbenchTicket[],
  role: WorkbenchRole,
  principal: string,
): readonly WorkbenchTicket[] {
  if (role === 'admin') return tickets
  if (role === 'approver') return tickets.filter(ticket => ticket.column === 'person')
  return tickets.filter(ticket => ticket.owner === principal)
}

/** 各阶段计数(阶段过滤 chip 的 num 徽标;基于视角钳制后的集合)。 */
export function stageCounts(tickets: readonly WorkbenchTicket[]): Record<StageFilter, number> {
  const counts: Record<StageFilter, number> = { all: tickets.length, person: 0, working: 0, queued: 0, idle: 0 }
  for (const ticket of tickets) counts[ticket.column] += 1
  return counts
}

/** 看板列投影(视角钳制 → 阶段过滤 → 分列;空列保留占位,原型四列常显)。 */
export interface KanbanBoard {
  readonly columns: readonly {
    readonly meta: KanbanColumnMeta
    readonly tickets: readonly WorkbenchTicket[]
  }[]
  readonly counts: Record<StageFilter, number>
}

export function kanbanBoard(
  tickets: readonly WorkbenchTicket[],
  role: WorkbenchRole,
  principal: string,
  stage: StageFilter,
): KanbanBoard {
  const visible = clampTicketsByRole(tickets, role, principal)
  const counts = stageCounts(visible)
  const columns = KANBAN_COLUMN_META.map(meta => ({
    meta,
    tickets: (stage === 'all' || stage === meta.key)
      ? visible.filter(ticket => ticket.column === meta.key)
      : [],
  }))
  return { columns, counts }
}

/**
 * 冲突三指标视图行(38 号 K-2/K-3:attach 次数/duplicate 比例/插队次数,
 * 先记录不告警——无告警 UI)。值与副行文案 = 原型 03 逐字;计数点未接线的
 * 指标(M4 实接:unavailable,38 号 T8)如实显示「暂不可采」,不伪报数值。
 */
export interface ConflictCard {
  readonly label: string
  readonly value: string
  readonly sub: string
  readonly badge?: string
}

export function conflictCards(conflict: {
  readonly attach: { readonly count: number; readonly note: string; readonly unavailable?: true }
  readonly duplicate: { readonly percent: number; readonly thresholdPercent: number; readonly note: string; readonly unavailable?: true }
  readonly jump: { readonly count: number; readonly note: string; readonly unavailable?: true }
}): readonly ConflictCard[] {
  return [
    {
      label: 'attach 次数 · 本周',
      value: conflict.attach.unavailable === true ? '暂不可采' : String(conflict.attach.count),
      sub: conflict.attach.note,
    },
    {
      label: 'duplicate 比例',
      ...(conflict.duplicate.unavailable === true
        ? { value: '暂不可采', sub: conflict.duplicate.note }
        : {
          value: `${conflict.duplicate.percent}%`,
          sub: conflict.duplicate.note,
          ...(conflict.duplicate.percent < conflict.duplicate.thresholdPercent ? { badge: '达标' } : {}),
        }),
    },
    {
      label: '插队次数 · 本周',
      value: conflict.jump.unavailable === true ? '暂不可采' : String(conflict.jump.count),
      sub: conflict.jump.note,
    },
  ]
}
