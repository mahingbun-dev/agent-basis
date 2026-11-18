/**
 * 任务侧栏投影(38 号 T6/S-1~S-4:会话侧任务分组 + 状态点 + 报告时间线 +
 * 多 Assignment 分支切换)。分组依据 tasks stage.ts 的 ticketStage 口径
 * (34 号 §2.1 stage 行「供 30 号看板分组」——快照工单已带 column 派生列,
 * 本层只按列归组,不重新分档);状态点词汇 = 全原型统一 dot-* 词汇表
 * (原型 01 标注二)。纯函数(G-11:派生状态不改数据)。
 */
import { KANBAN_COLUMN_META, type KanbanColumnMeta } from './kanban.ts'
import type { AssignmentBranch, KanbanColumn, TicketTimeline, TimelineBlock, WorkbenchTicket } from '../types.ts'

/**
 * 侧栏组名(原型一 task-group 逐字:等我处理/进行中/排队中/空闲;与看板
 * KANBAN_COLUMN_META 的「等人」差异 = 侧栏为发起人自视角——24 号 §7.2
 * 「等我处理」以「我」称,看板 03 为管理面词汇「等人」)。
 */
export const SIDEBAR_GROUP_LABELS: Record<KanbanColumn, string> = {
  person: '等我处理',
  working: '进行中',
  queued: '排队中',
  idle: '空闲',
}

/** 侧栏分组(原型 01 task-group:组头 = 状态点 + 组名 + 阶段码 + 计数徽标)。 */
export interface SidebarGroup {
  readonly meta: KanbanColumnMeta
  readonly tickets: readonly WorkbenchTicket[]
}

/**
 * 按 stage 分组(S-1:24 号 §6 P2 行;四组常显与看板同源,计数 = 组内工单数;
 * 空组保留占位——原型 01 四组齐显,均非空时形态一致)。
 */
export function sidebarGroups(tickets: readonly WorkbenchTicket[]): readonly SidebarGroup[] {
  return KANBAN_COLUMN_META.map(meta => ({
    meta,
    tickets: tickets.filter(ticket => ticket.column === meta.key),
  }))
}

/** 侧栏行 meta 段(工单自带 sidebarLine(原型 01 逐字)缺省回落看板 metaLine)。 */
export function sidebarRowLine(ticket: WorkbenchTicket): WorkbenchTicket['metaLine'] {
  return ticket.sidebarLine ?? ticket.metaLine
}

/** 某工单的分支集(按序号升序;多 Assignment 分支切换的入口数据)。 */
export function branchesFor(assignments: readonly AssignmentBranch[], ticketId: string): readonly AssignmentBranch[] {
  return assignments
    .filter(branch => branch.ticketId === ticketId)
    .sort((left, right) => left.seq - right.seq)
}

/** 工单当前活跃分支(在办 Assignment;无登记时返回 undefined)。 */
export function activeBranchOf(assignments: readonly AssignmentBranch[], ticketId: string): AssignmentBranch | undefined {
  return branchesFor(assignments, ticketId).find(branch => branch.active)
}

/** 分支 chip 文案(原型 01 词汇:分支 N + 态注记;态徽标语义色配文字)。 */
export function branchChipLabel(branch: AssignmentBranch): string {
  return `分支 ${String(branch.seq)} · ${branch.note}`
}

/** 分支态徽标语义色(failed=danger、ready=success、working=accent)。 */
export function branchStateTone(state: AssignmentBranch['state']): 'accent' | 'success' | 'danger' {
  switch (state) {
    case 'failed': return 'danger'
    case 'ready': return 'success'
    case 'working': return 'accent'
  }
}

/**
 * 取某工单某分支的报告时间线(S-4:退回 = 新 Assignment = 新分支,切换后
 * 时间线随分支换轨);目标分支无时间线时回落活跃分支(重试分支建票早期
 * 尚无 blocks 的占位口径)。
 */
export function timelineFor(
  timelines: readonly TicketTimeline[],
  ticketId: string,
  branchSeq: number,
  assignments: readonly AssignmentBranch[],
): readonly TimelineBlock[] {
  const hit = timelines.find(line => line.ticketId === ticketId && line.branchSeq === branchSeq)
  if (hit !== undefined) return hit.blocks
  const fallback = activeBranchOf(assignments, ticketId)
  const fallbackLine = fallback === undefined
    ? undefined
    : timelines.find(line => line.ticketId === ticketId && line.branchSeq === fallback.seq)
  return fallbackLine?.blocks ?? []
}
