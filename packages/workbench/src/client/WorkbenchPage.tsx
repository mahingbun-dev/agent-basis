/**
 * 工作台主页面(main keyed slot 的 occupant;38 号 T3/T6/T7/T8/T9/T10/T11/T12):
 * 顶部驻留 Attention 横幅(站内横幅形态,原型二「驻留在工作台顶部」)+ 五视图
 * 一检查器单页纵排(工作监控/信息流实时图/日志监控/评测监控/worker 检查器)
 * + 会话侧区(T6 任务侧栏 + 报告时间线 + 多 Assignment 分支切换;32 号 §3
 * 「工作台与会话内表面统一做」——M3 落本页,M4 实接换会话内表面)。
 *
 * 状态壳:mock 流状态(inject hooks 份额)+ 看板视角/阶段过滤 + 日志过滤/
 * 检索/展开集 + 视图二暂停/回放(FlowStage 内聚)+ T6 选中态(会话/工单/分支/
 * 答复草稿)+ T7 两击臂态/拒绝理由/补充说明;各视图为受控纯组件(渲染测试
 * 直接驱动,不进本壳)。DOM 带 data-eterna-workbench* 结构化锚点(panel 先例:
 * E2E 严断言定位)。
 */
import { useState, type ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'
import type { StageFilter } from '../project/kanban.ts'
import type { WorkbenchRole } from '../types.ts'
import { LOG_TICKET_CHIPS } from '../project/trace-view.ts'
import { activeBranchOf, branchesFor, timelineFor } from '../project/task-sidebar.ts'
import type { WorkbenchStreamState } from './mock-stream.ts'
import { KanbanView } from './KanbanView.tsx'
import { FlowStage } from './FlowCanvas.tsx'
import { LogsView } from './LogsView.tsx'
import { EvalView } from './EvalView.tsx'
import { WorkerInspector } from './WorkerInspector.tsx'
import { TaskSidebar, TicketTimeline } from './TaskSidebar.tsx'
import { AttentionBanner, type AttentionBannerProps } from './AttentionBanner.tsx'
import { MOCK_PRINCIPAL } from '../stream/mock-source.ts'

export interface WorkbenchPageProps {
  /** hooks 份额绑定的选择器钩子(流状态裸 observable 源;panel 先例形态)。 */
  readonly useSnapshot: <S>(selector: (state: WorkbenchStreamState) => S) => S
  /** 语言键(ctx.locale.bind 标准席位)。 */
  readonly t: (key: string) => string
  /** 手动重连(错误态重试按钮)。 */
  readonly retry: () => void
}

interface ViewNavItem {
  readonly view: WorkbenchView
  readonly icon: 'gauge' | 'flow' | 'log' | 'chart' | 'worker' | 'kanban'
  readonly key: 'nav.session' | 'nav.monitor' | 'nav.flow' | 'nav.logs' | 'nav.eval' | 'nav.worker'
}

/** 视图导航(原型 03 view-nav 五项;38 号 T9 视图二、T12 视图五;T6 会话侧区
 * 置首——32 号 §3 工作台与会话内表面统一做)。 */
/** 工作台视图(真 tab 切换——30 号 §2 五视图+会话侧区,一屏一视图;2026-11-18
 * 视觉验收修正:原实现为页内锚点全量堆叠,与 30 号 §2「tab 切换」不符)。 */
type WorkbenchView = 'session' | 'monitor' | 'flow' | 'logs' | 'eval' | 'worker'

const VIEW_NAV: readonly { view: WorkbenchView; icon: ViewNavItem['icon']; key: ViewNavItem['key'] }[] = [
  { view: 'session', icon: 'kanban', key: 'nav.session' },
  { view: 'monitor', icon: 'gauge', key: 'nav.monitor' },
  { view: 'flow', icon: 'flow', key: 'nav.flow' },
  { view: 'logs', icon: 'log', key: 'nav.logs' },
  { view: 'eval', icon: 'chart', key: 'nav.eval' },
  { view: 'worker', icon: 'worker', key: 'nav.worker' },
]

/** 流状态行(连接中/已连接/失败;已连接文案 = 原型 03 sse-chip 逐字)。 */
function StreamStatus({ state, t, retry }: {
  readonly state: WorkbenchStreamState
  readonly t: (key: string) => string
  readonly retry: () => void
}): ReactElement {
  if (state.status === 'connecting') {
    return <p data-eterna-workbench="sse-chip" data-eterna-workbench-sse="connecting">{t('state.connecting')}</p>
  }
  if (state.status === 'error') {
    return (
      <p data-eterna-workbench="sse-chip" data-eterna-workbench-sse="error" role="alert">
        <span data-eterna-workbench="dot" data-eterna-workbench-dot="error" aria-hidden="true" />
        {t('state.error')}：<span data-eterna-workbench="sse-error-message">{state.message}</span>
        <button type="button" data-eterna-workbench="retry" onClick={retry}>{t('state.retry')}</button>
      </p>
    )
  }
  return (
    <p data-eterna-workbench="sse-chip" data-eterna-workbench-sse="ready">
      <span data-eterna-workbench="dot" data-eterna-workbench-dot="ready" aria-hidden="true" />
      {t('state.ready')}
    </p>
  )
}

/** Attention 横幅交互态(两击臂态/拒绝理由/补充说明;壳持有,横幅为纯组件)。 */
interface AttentionBannerUi {
  readonly arm: 'none' | 'approve' | 'reject'
  readonly rejectReason: string
  readonly supplementOpen: boolean
  readonly supplementText: string
}

const BANNER_UI_INITIAL: AttentionBannerUi = { arm: 'none', rejectReason: '', supplementOpen: false, supplementText: '' }

/** 面板根组件(状态壳;受控纯视图见 KanbanView/TaskSidebar/AttentionBanner 等)。 */
export function WorkbenchPage({ useSnapshot, t, retry }: WorkbenchPageProps): ReactElement {
  const stream = useSnapshot(state => state)
  const [role, setRole] = useState<WorkbenchRole>('admin')
  const [stage, setStage] = useState<StageFilter>('all')
  const [logTicket, setLogTicket] = useState<string>(LOG_TICKET_CHIPS[0] ?? '')
  const [query, setQuery] = useState('')
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set(['t9c81-decision']))
  // T6 会话侧选中态(会话/工单/分支切换/答复草稿;分支未手动切换时回落活跃分支)
  const [activeSessionId, setActiveSessionId] = useState('sess-1')
  const [activeTicketId, setActiveTicketId] = useState('T-9c81')
  const [branchOverride, setBranchOverride] = useState<number | undefined>(undefined)
  const [answerDraft, setAnswerDraft] = useState('')
  // T7 横幅交互态(两击臂态;R3 双确认走两击,frontend-style §1-4)
  const [bannerUi, setBannerUi] = useState<AttentionBannerUi>(BANNER_UI_INITIAL)
  // 当前视图(真 tab 切换;默认会话侧区——发起人视角首屏)
  const [view, setView] = useState<WorkbenchView>('session')

  const ready = stream.status === 'ready' ? stream.snapshot : undefined
  const logsFilter = { ticketId: logTicket, query }

  const toggleExpand = (entryId: string): void => {
    setExpandedIds(previous => {
      const next = new Set(previous)
      if (next.has(entryId)) next.delete(entryId)
      else next.add(entryId)
      return next
    })
  }

  // T6 投影(分支/时间线;选中工单变化时分支回落其活跃分支——G-11 纯投影)
  const branches = ready === undefined ? [] : branchesFor(ready.assignments, activeTicketId)
  const activeBranch = ready === undefined ? undefined : activeBranchOf(ready.assignments, activeTicketId)
  const activeBranchId = branchOverride ?? activeBranch?.seq ?? branches[0]?.seq ?? 1
  const timelineBlocks = ready === undefined ? [] : timelineFor(ready.timelines, activeTicketId, activeBranchId, ready.assignments)
  const activeTicket = ready?.tickets.find(ticket => ticket.id === activeTicketId)

  const selectTicket = (ticketId: string): void => {
    setActiveTicketId(ticketId)
    setBranchOverride(undefined)
    setAnswerDraft('')
  }

  // T7 动作(两击确认判定在壳:批准第二击放行;拒绝第二击需一句理由,
  // frontend-style §1-4;M4 经 Host 半边调 EngineForPeople 面,38 号 A-6)
  const bannerActions: Pick<AttentionBannerProps, 'onArm' | 'onApprove' | 'onReject' | 'onRejectReasonChange' | 'onSupplementToggle' | 'onSupplementChange' | 'onSupplementSubmit' | 'onOpenConversation'> = {
    onArm: (target) => { setBannerUi({ ...BANNER_UI_INITIAL, arm: target }) },
    onApprove: () => { setBannerUi(BANNER_UI_INITIAL) },
    onReject: () => {
      setBannerUi(previous => (previous.rejectReason.trim() === '' ? previous : BANNER_UI_INITIAL))
    },
    onRejectReasonChange: (text) => { setBannerUi(previous => ({ ...previous, rejectReason: text })) },
    onSupplementToggle: () => { setBannerUi(previous => ({ ...previous, supplementOpen: !previous.supplementOpen })) },
    onSupplementChange: (text) => { setBannerUi(previous => ({ ...previous, supplementText: text })) },
    onSupplementSubmit: () => { setBannerUi(previous => ({ ...previous, supplementOpen: false, supplementText: '' })) },
    onOpenConversation: () => { setActiveSessionId('sess-1'); selectTicket(ready?.attention?.ticketId ?? activeTicketId) },
  }

  return (
    <div data-eterna-workbench="root" aria-label={t('panel')}>
      <div data-eterna-workbench="toolbar">
        <h1 data-eterna-workbench="heading">{t('panel')}</h1>
        <StreamStatus state={stream} t={t} retry={retry} />
      </div>

      {ready?.attention !== undefined && <AttentionBanner card={ready.attention} arm={bannerUi.arm} rejectReason={bannerUi.rejectReason} supplementOpen={bannerUi.supplementOpen} supplementText={bannerUi.supplementText} {...bannerActions} t={t} />}

      <nav data-eterna-workbench="view-nav" aria-label="工作台视图导航">
        {VIEW_NAV.map(item => (
          <button key={item.view} type="button" data-eterna-workbench="view-tab" data-eterna-workbench-view-active={view === item.view || undefined} aria-current={view === item.view ? 'page' : undefined} onClick={() => { setView(item.view) }}>
            <Icon name={item.icon} size={16} />{t(item.key)}
          </button>
        ))}
      </nav>

      {ready === undefined && stream.status !== 'ready' && (
        <p data-eterna-workbench="placeholder" data-eterna-workbench-sse={stream.status === 'error' ? 'error' : 'connecting'}>
          {stream.status === 'error' ? `${t('state.error')}：${stream.message}` : t('state.connecting')}
        </p>
      )}

      {ready !== undefined && (
        <>
          <section data-eterna-workbench="view" data-eterna-workbench-view="session" id="wb-session" hidden={view !== 'session'} aria-labelledby="wb-h-session">
            <div data-eterna-workbench="view-head">
              <h2 data-eterna-workbench="view-title" id="wb-h-session">任务侧栏 · 报告时间线</h2>
            </div>
            <p data-eterna-workbench="view-desc">左侧按状态查看你的任务；选中工单即可查看执行时间线。退回或重试会生成新的执行记录，无需重新发起。</p>
            <div data-eterna-workbench="chat-shell">
              <TaskSidebar
                sessions={ready.sessions}
                tickets={ready.tickets}
                activeSessionId={activeSessionId}
                onSessionSelect={setActiveSessionId}
                activeTicketId={activeTicketId}
                onTicketSelect={selectTicket}
                t={t}
              />
              <TicketTimeline
                ticket={activeTicket}
                branches={branches}
                activeBranchId={activeBranchId}
                onBranchChange={setBranchOverride}
                blocks={timelineBlocks}
                answerDraft={answerDraft}
                onAnswerChange={setAnswerDraft}
                onAnswerSubmit={() => { setAnswerDraft('') }}
                onAccept={() => {}}
                onReturn={() => {}}
                t={t}
              />
            </div>
          </section>
          {view === 'monitor' && (
          <KanbanView
            snapshot={ready}
            role={role}
            principal={MOCK_PRINCIPAL}
            stage={stage}
            onRoleChange={setRole}
            onStageChange={setStage}
            t={t}
          />
          )}
          {view === 'flow' && <FlowStage snapshot={ready} t={t} />}
          {view === 'logs' && (
          <LogsView
            snapshot={ready}
            filter={logsFilter}
            onTicketChange={setLogTicket}
            onQueryChange={setQuery}
            expandedIds={expandedIds}
            onToggleExpand={toggleExpand}
            t={t}
          />
          )}
          {view === 'eval' && <EvalView snapshot={ready} />}
          {view === 'worker' && <WorkerInspector snapshot={ready.worker} />}
        </>
      )}
    </div>
  )
}
