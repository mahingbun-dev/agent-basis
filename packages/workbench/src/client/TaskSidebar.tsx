/**
 * 任务侧栏(38 号 T6:client/TaskSidebar.tsx 会话侧任务侧栏 + 分支切换入口、
 * 会话内报告时间线;S-1~S-5,视觉 = 原型一 docs/prototypes/01-task-sidebar.html
 * 逐字)。受控纯组件(无 hook,panel-workbench-views 渲染测试同款纪律):会话/
 * 工单选中、分支切换、答复草稿全由 WorkbenchPage 状态壳持有(G-11 渲染层与
 * 投影层分离);分组/分支/时间线数据经 project/task-sidebar.ts 纯投影。
 *
 * 发起人三件事纪律(24 号 §7.2 关键设计):侧栏有状态点、该我拍板时弹卡、
 * 做完结果回到原对话——侧栏行 = 状态点 + 标题 + id + 阶段 + 等谁 + 耗时;
 * 时间线复用 assistant blocks 范式(24 号 §6 P2 行),块词汇 = 原型一会话面
 * (sysline/message/ask/result);按钮与输入为静态占位,动作经 props 留 M4
 * 实接(EngineForPeople 面,38 号 A-6)。
 */
import type { ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'
import { BRAND_BOLT_PATH } from '@eterna/ui/icon-data'
import { Segments } from './KanbanView.tsx'
import { SIDEBAR_GROUP_LABELS, branchChipLabel, branchStateTone, sidebarGroups, sidebarRowLine } from '../project/task-sidebar.ts'
import type { AssignmentBranch, SidebarSession, TimelineBlock, WorkbenchTicket } from '../types.ts'

/** agent 消息署名闪电(品牌标路径取自 @eterna/ui/icon-data 单一事实源;
 * brand/src/client/index.ts:40 同款 React 内联,非手绘新路径)。 */
function AgentBolt({ size }: { readonly size: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d={BRAND_BOLT_PATH} />
    </svg>
  )
}

export interface TaskSidebarProps {
  /** 会话行(原型一「会话」分区;发起自渠道注记)。 */
  readonly sessions: readonly SidebarSession[]
  /** 工单全集(分组投影见 sidebarGroups;分组依据 = stage 列,34 号 §2.1)。 */
  readonly tickets: readonly WorkbenchTicket[]
  /** 当前会话(原型一 aria-current 行)。 */
  readonly activeSessionId: string
  readonly onSessionSelect: (sessionId: string) => void
  /** 当前工单(侧栏行 is-active;联动右侧报告时间线)。 */
  readonly activeTicketId: string
  readonly onTicketSelect: (ticketId: string) => void
  /** 语言键(panel 标准席位)。 */
  readonly t: (key: string) => string
}

/** 单张工单行(原型一 task-item:状态点 + 标题 + meta 行 + 右箭头)。 */
function TaskItem({ ticket, active, onSelect }: {
  readonly ticket: WorkbenchTicket
  readonly active: boolean
  readonly onSelect: (ticketId: string) => void
}): ReactElement {
  const waitPerson = ticket.column === 'person'
  return (
    <button
      type="button"
      data-eterna-workbench="task-item"
      data-eterna-workbench-ticket={ticket.id}
      data-eterna-workbench-active={active ? 'true' : undefined}
      aria-current={active ? 'true' : undefined}
      onClick={() => { onSelect(ticket.id) }}
    >
      <span
        data-eterna-workbench="dot"
        data-eterna-workbench-dot={waitPerson ? 'wait-person' : ticket.column === 'working' ? 'working' : ticket.column === 'queued' ? 'queued' : 'idle'}
        data-eterna-workbench-pulse={waitPerson ? 'true' : undefined}
        aria-hidden="true"
      />
      <span data-eterna-workbench="t-body">
        <span data-eterna-workbench="t-title">{ticket.title}</span>
        <span data-eterna-workbench="t-meta">
          <Segments segments={sidebarRowLine(ticket)} />
          {ticket.attention !== undefined && <span>{`（Attention #${String(ticket.attention.id)}）`}</span>}
        </span>
      </span>
      <Icon name="chevron-right" size={16} />
    </button>
  )
}

/** 会话侧栏(原型一 side-panel:「会话」+「我的工单」两分区同栏堆叠;
 * 分组按 stage,组头状态点与计数徽标语义色配文字)。 */
export function TaskSidebar({ sessions, tickets, activeSessionId, onSessionSelect, activeTicketId, onTicketSelect, t }: TaskSidebarProps): ReactElement {
  const groups = sidebarGroups(tickets)
  return (
    <aside data-eterna-workbench="side-panel" aria-label="会话与工单侧栏">
      <section data-eterna-workbench="side-section" aria-label={t('sidebar.sessions')}>
        <div data-eterna-workbench="side-h">
          <h2>{t('sidebar.sessions')}</h2>
          <span data-eterna-workbench="badge" data-eterna-workbench-tone="muted">{String(sessions.length)}</span>
        </div>
        <ul data-eterna-workbench="session-list">
          {sessions.map(session => (
            <li key={session.id} data-eterna-workbench="session-item">
              <button
                type="button"
                data-eterna-workbench="session-row"
                data-eterna-workbench-session={session.id}
                data-eterna-workbench-active={session.id === activeSessionId ? 'true' : undefined}
                aria-current={session.id === activeSessionId ? 'true' : undefined}
                onClick={() => { onSessionSelect(session.id) }}
              >
                <Icon name="globe" size={16} />
                <span>{`${session.title} · ${session.channel}`}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section data-eterna-workbench="side-section" aria-label={t('sidebar.tickets')}>
        <div data-eterna-workbench="side-h">
          <h2>{t('sidebar.tickets')}</h2>
          <span data-eterna-workbench="badge" data-eterna-workbench-tone="accent">{String(tickets.length)}</span>
        </div>
        {groups.map(group => (
          <div key={group.meta.key} data-eterna-workbench="task-group" data-eterna-workbench-group={group.meta.key}>
            <h3 data-eterna-workbench="task-group-h">
              <span
                data-eterna-workbench="dot"
                data-eterna-workbench-dot={group.meta.dot}
                data-eterna-workbench-pulse={group.meta.pulse ? 'true' : undefined}
                aria-hidden="true"
              />
              {SIDEBAR_GROUP_LABELS[group.meta.key]}
              <span data-eterna-workbench="stage-code">{group.meta.stageCode}</span>
              <span data-eterna-workbench="count" data-eterna-workbench-tone={group.meta.countTone}>{String(group.tickets.length)}</span>
            </h3>
            <ul data-eterna-workbench="task-list">
              {group.tickets.map(ticket => (
                <li key={ticket.id}>
                  <TaskItem ticket={ticket} active={ticket.id === activeTicketId} onSelect={onTicketSelect} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </aside>
  )
}

export interface TicketTimelineProps {
  /** 时间线归属工单(缺省 = 未选中,渲染占位)。 */
  readonly ticket: WorkbenchTicket | undefined
  /** 该工单的分支集(多 Assignment 分支切换,24 号 §7.2 T+21min/27 号 §1.2)。 */
  readonly branches: readonly AssignmentBranch[]
  /** 展示中的分支号(切换态由壳持有;缺省 = 活跃分支)。 */
  readonly activeBranchId: number
  readonly onBranchChange: (branchSeq: number) => void
  /** 当前分支的 blocks(assistant blocks 范式投影)。 */
  readonly blocks: readonly TimelineBlock[]
  /** 答复草稿(ask 卡输入受控值;壳持有)。 */
  readonly answerDraft: string
  readonly onAnswerChange: (text: string) => void
  readonly onAnswerSubmit: () => void
  /** 结果卡动作(M4 实接 EngineForPeople 面,38 号 A-6;mock 为静态占位)。 */
  readonly onAccept: () => void
  readonly onReturn: () => void
  /** 语言键。 */
  readonly t: (key: string) => string
}

/** 时间线块(原型一会话面逐字渲染;ask/result 静态占位动作经 props)。 */
function TimelineItem({ block, answerDraft, onAnswerChange, onAnswerSubmit, onAccept, onReturn, t }: {
  readonly block: TimelineBlock
  readonly answerDraft: string
  readonly onAnswerChange: (text: string) => void
  readonly onAnswerSubmit: () => void
  readonly onAccept: () => void
  readonly onReturn: () => void
  readonly t: (key: string) => string
}): ReactElement {
  if (block.kind === 'sysline') {
    return (
      <p data-eterna-workbench="sysline" role="note">
        <span data-eterna-workbench-num="true">{block.time}</span>
        <span> · {block.text}</span>
      </p>
    )
  }
  if (block.kind === 'message') {
    return (
      <div data-eterna-workbench="msg" data-eterna-workbench-side={block.side}>
        <p data-eterna-workbench="who">
          {block.side === 'user' ? <Icon name="worker" size={14} /> : <AgentBolt size={14} />}
          <span>{`${block.who} · `}</span>
          <span data-eterna-workbench-num="true">{block.time}</span>
        </p>
        {block.text !== '' && <div data-eterna-workbench="bubble"><p>{block.text}</p></div>}
        {block.files !== undefined && block.files.length > 0 && (
          <div data-eterna-workbench="bubble">
            <ul data-eterna-workbench="file-row">
              {block.files.map(file => (
                <li key={file.name}>
                  <span data-eterna-workbench="file-chip" data-eterna-workbench-file={file.name}>
                    <Icon name="paperclip" size={14} />
                    <span>{file.name}</span>
                    {file.meta !== undefined && <span data-eterna-workbench="file-meta">{file.meta}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )
  }
  if (block.kind === 'ask') {
    return (
      <div data-eterna-workbench="ask-card" data-eterna-workbench-ask="attention">
        <p data-eterna-workbench="ask-title"><Icon name="bell" size={16} />{block.title}</p>
        <p data-eterna-workbench="ask-q">{block.question}</p>
        <div data-eterna-workbench="reply-row">
          <label data-eterna-workbench="visually-hidden" htmlFor="wb-reply-input">{t('timeline.answerLabel')}</label>
          <input
            id="wb-reply-input"
            type="text"
            data-eterna-workbench="reply-input"
            placeholder={block.placeholder}
            value={answerDraft}
            onChange={event => { onAnswerChange(event.currentTarget.value) }}
          />
          <button type="button" data-eterna-workbench="btn" data-eterna-workbench-action="answer" onClick={onAnswerSubmit}>
            <Icon name="check" size={16} />{t('timeline.answerSubmit')}
          </button>
        </div>
        <p data-eterna-workbench="ask-foot"><Icon name="clock" size={14} />{block.foot}</p>
      </div>
    )
  }
  return (
    <div data-eterna-workbench="result-card" data-eterna-workbench-result="outbox">
      <p data-eterna-workbench="result-head"><Icon name="check" size={16} />{block.title}</p>
      <div data-eterna-workbench="result-body">
        <ul data-eterna-workbench="file-row">
          {block.files.map(file => (
            <li key={file.name}>
              <span data-eterna-workbench="file-chip" data-eterna-workbench-file={file.name}>
                <Icon name="paperclip" size={14} />
                <span>{file.name}</span>
                {file.meta !== undefined && <span data-eterna-workbench="file-meta">{file.meta}</span>}
              </span>
            </li>
          ))}
        </ul>
        <ul data-eterna-workbench="result-summary">
          {block.summary.map(line => <li key={line}>{line}</li>)}
        </ul>
        <div data-eterna-workbench="result-actions">
          <button type="button" data-eterna-workbench="btn" data-eterna-workbench-action="accept" onClick={onAccept}>
            <Icon name="check" size={16} />{t('timeline.accept')}
          </button>
          <button type="button" data-eterna-workbench="btn-secondary" data-eterna-workbench-action="return" onClick={onReturn}>
            <Icon name="comment" size={16} />{t('timeline.return')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 报告时间线 + 多 Assignment 分支切换(38 号 S-4:复用 assistant blocks 范式;
 * 退回 = 同工单新 Assignment 新分支——结果卡「退回并说明」即新分支入口,
 * failed 重试 = 新分支,27 号 §1.2)。分支 chip 行 = 原型 03 chip 词汇,不引入
 * 新视觉语言(分支切换原型缺位,38 号 O-9;见包内 notes)。 */
export function TicketTimeline({ ticket, branches, activeBranchId, onBranchChange, blocks, answerDraft, onAnswerChange, onAnswerSubmit, onAccept, onReturn, t }: TicketTimelineProps): ReactElement {
  return (
    <div data-eterna-workbench="ticket-timeline" data-eterna-workbench-timeline={ticket?.id}>
      <div data-eterna-workbench="chat-head">
        <div>
          <h2 data-eterna-workbench="chat-title">{ticket === undefined ? t('timeline.emptyTitle') : ticket.title}</h2>
          <p data-eterna-workbench="chat-sub">
            {ticket === undefined
              ? t('timeline.emptySub')
              : <span>{t('timeline.ticketPrefix')}<span data-eterna-workbench-seg-mono="true">{ticket.id}</span> · {t('timeline.branchPrefix')}<span data-eterna-workbench-num="true">{String(activeBranchId)}</span></span>}
          </p>
        </div>
        {branches.length > 1 && (
          <div data-eterna-workbench="toolbar" role="group" aria-label={t('timeline.branchGroup')}>
            {branches.map(branch => (
              <button
                key={branch.seq}
                type="button"
                data-eterna-workbench="chip"
                data-eterna-workbench-branch={String(branch.seq)}
                data-eterna-workbench-on={branch.seq === activeBranchId ? 'true' : undefined}
                aria-pressed={branch.seq === activeBranchId}
                onClick={() => { onBranchChange(branch.seq) }}
              >
                {branchChipLabel(branch)}
                <span data-eterna-workbench="badge" data-eterna-workbench-tone={branchStateTone(branch.state)}>{branch.state}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div data-eterna-workbench="chat-body">
        {blocks.map((block, index) => (
          <TimelineItem
            key={index}
            block={block}
            answerDraft={answerDraft}
            onAnswerChange={onAnswerChange}
            onAnswerSubmit={onAnswerSubmit}
            onAccept={onAccept}
            onReturn={onReturn}
            t={t}
          />
        ))}
        {blocks.length === 0 && <p data-eterna-workbench="placeholder">{t('timeline.emptyBlocks')}</p>}
      </div>
      <footer data-eterna-workbench="chat-foot">{t('timeline.foot')}</footer>
    </div>
  )
}
