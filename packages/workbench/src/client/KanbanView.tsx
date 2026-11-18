/**
 * 工作监控视图(视图一;38 号 T8/K-1~K-7,布局/状态/文案 = 原型 03 视图一
 * 逐字)。受控纯组件:过滤状态与回调全由 WorkbenchPage 持有(渲染测试直接
 * 驱动 props;38 号 G-11 渲染层与投影层分离)。
 */
import type { ReactElement, ReactNode } from 'react'
import { Icon } from '@eterna/ui/icons'
import {
  ROLE_CHIPS, conflictCards, kanbanBoard,
  type ConflictCard, type KanbanColumnMeta, type StageFilter,
} from '../project/kanban.ts'
import type { LogSegment, WorkbenchRole, WorkbenchSnapshot, WorkbenchTicket } from '../types.ts'

export interface KanbanViewProps {
  readonly snapshot: WorkbenchSnapshot
  readonly role: WorkbenchRole
  readonly principal: string
  readonly stage: StageFilter
  readonly onRoleChange: (role: WorkbenchRole) => void
  readonly onStageChange: (stage: StageFilter) => void
  /** 语言键(panel 标准席位;阶段 chip 组标签)。 */
  readonly t: (key: string) => string
}

const STAGE_CHIPS: readonly { readonly key: StageFilter; readonly label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'person', label: '等人' },
  { key: 'working', label: '进行中' },
  { key: 'queued', label: '排队' },
  { key: 'idle', label: '空闲' },
]

function Chip({ on, pressed, children, onClick }: {
  readonly on: boolean
  readonly pressed: boolean
  readonly children: ReactNode
  readonly onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      data-eterna-workbench="chip"
      data-eterna-workbench-on={on ? 'true' : undefined}
      aria-pressed={pressed}
      onClick={onClick}
    >{children}</button>
  )
}

/** meta 行 spans 渲染(mono/num 标记 → 等宽/表格数字)。 */
export function Segments({ segments }: { readonly segments: readonly LogSegment[] }): ReactElement {
  return (
    <>
      {segments.map((segment, index) => (
        <span
          key={index}
          data-eterna-workbench-seg-mono={segment.mono === true ? 'true' : undefined}
          data-eterna-workbench-seg-num={segment.num === true ? 'true' : undefined}
        >{segment.text}</span>
      ))}
    </>
  )
}

function KanbanCard({ ticket }: { readonly ticket: WorkbenchTicket }): ReactElement {
  return (
    <div
      data-eterna-workbench="kan-card"
      data-eterna-workbench-card={ticket.id}
      data-eterna-workbench-stuck={ticket.column === 'person' ? 'true' : undefined}
      role="listitem"
    >
      <span data-eterna-workbench="kan-title">{ticket.title}</span>
      <span data-eterna-workbench="kan-meta"><Segments segments={ticket.metaLine} /></span>
      {ticket.attention !== undefined && (
        <span data-eterna-workbench="kan-meta">
          <span data-eterna-workbench="badge" data-eterna-workbench-tone="warn">
            <Icon name="bell" size={12} />{`Attention #${ticket.attention.id}`}
          </span>
          <span>{ticket.attention.note}</span>
        </span>
      )}
    </div>
  )
}

function KanbanColumnView({ meta, tickets }: {
  readonly meta: KanbanColumnMeta
  readonly tickets: readonly WorkbenchTicket[]
}): ReactElement {
  return (
    <div data-eterna-workbench="kanban-col" data-eterna-workbench-col={meta.key} role="list" aria-labelledby={`wb-col-${meta.key}`}>
      <h3 data-eterna-workbench="kanban-col-h" id={`wb-col-${meta.key}`}>
        <span
          data-eterna-workbench="dot"
          data-eterna-workbench-dot={meta.dot}
          data-eterna-workbench-pulse={meta.pulse ? 'true' : undefined}
          aria-hidden="true"
        />
        {meta.label}
        <span data-eterna-workbench="stage-code">{meta.stageCode}</span>
        <span data-eterna-workbench="count" data-eterna-workbench-tone={meta.countTone}>{tickets.length}</span>
      </h3>
      <div data-eterna-workbench="kan-cards">
        {tickets.map(ticket => <KanbanCard key={ticket.id} ticket={ticket} />)}
      </div>
    </div>
  )
}

function ConflictMetric({ card }: { readonly card: ConflictCard }): ReactElement {
  return (
    <div data-eterna-workbench="metric-card">
      <p data-eterna-workbench="metric-label">{card.label}</p>
      <p data-eterna-workbench="metric-value" data-eterna-workbench-num="true">{card.value}</p>
      <p data-eterna-workbench="metric-sub">
        {card.sub}
        {card.badge !== undefined && (
          <span data-eterna-workbench="badge" data-eterna-workbench-tone="success">{card.badge}</span>
        )}
      </p>
    </div>
  )
}

/** 工作监控 · 工单看板(原型 03 视图一:视角/阶段过滤 + 四列看板 + 冲突三指标)。 */
export function KanbanView({ snapshot, role, principal, stage, onRoleChange, onStageChange, t }: KanbanViewProps): ReactElement {
  const board = kanbanBoard(snapshot.tickets, role, principal, stage)
  return (
    <section data-eterna-workbench="view" data-eterna-workbench-view="monitor" id="wb-v1" aria-labelledby="wb-h-v1">
      <div data-eterna-workbench="view-head">
        <p data-eterna-workbench="kicker">视图一</p>
        <h2 data-eterna-workbench="view-title" id="wb-h-v1">工作监控 · 工单看板</h2>
      </div>
      <p data-eterna-workbench="view-desc">工单按阶段分列：<code>person/*</code>（等人）、<code>working</code>（进行中）、<code>working/queued</code>（排队）、<code>idle</code>（空闲）。数据按 access realm 钳制：普通用户仅自己的工单，审批人见全租户待人项，管理员全量（30 §4-5、§7-3 拍板）。</p>

      <div data-eterna-workbench="toolbar" role="group" aria-label="看板过滤">
        <p data-eterna-workbench="toolbar-label">{t('toolbar.role')}</p>
        {ROLE_CHIPS.map(chip => (
          <Chip key={chip.role} on={role === chip.role} pressed={role === chip.role} onClick={() => { onRoleChange(chip.role) }}>{chip.label}</Chip>
        ))}
        <p data-eterna-workbench="toolbar-label">{t('toolbar.stage')}</p>
        {STAGE_CHIPS.map(chip => (
          <Chip key={chip.key} on={stage === chip.key} pressed={stage === chip.key} onClick={() => { onStageChange(chip.key) }}>
            {chip.label} <span data-eterna-workbench-num="true">{board.counts[chip.key]}</span>
          </Chip>
        ))}
      </div>

      <div data-eterna-workbench="kanban" role="list" aria-label="工单按阶段分列">
        {board.columns.map(column => <KanbanColumnView key={column.meta.key} meta={column.meta} tickets={column.tickets} />)}
      </div>

      <h3 data-eterna-workbench="sub-h">冲突三指标（27 号 D2）</h3>
      <div data-eterna-workbench="metrics">
        {conflictCards(snapshot.conflict).map(card => <ConflictMetric key={card.label} card={card} />)}
      </div>
    </section>
  )
}
