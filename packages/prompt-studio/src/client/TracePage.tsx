/**
 * 侧栏「循环轨迹」主面板(main keyed slot 占位):最近会话列表(默认 20 条)→
 * 选中会话的轮次树(推理↔工具调用节点、耗时、token、审批点高亮)。
 *
 * 列表/详情两种形态都来自同一端点 loopPrompt/trace(契约:无 sessionId →
 * sessions 列表 selected=null;有 sessionId → selected 轮次树 sessions=[])。
 * DOM 全部带 data-t7-* 结构化锚点,供 E2E 严断言定位。
 */
import { type ReactElement } from 'react'
import type {
  SessionTrace, TraceApprovalPoint, TraceReport, TraceSessionCard, TraceToolCall, TraceTurn,
} from '../types.ts'
import { formatDuration, formatTime, formatTokens, previewText } from './format.ts'

/** 轨迹数据态(裸 observable 源的快照值;hooks 份额 → useTrace)。 */
export type TraceState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly report: TraceReport }

/** 轨迹组件 props(hooks.trace 绑成 useTrace;其余为普通注入值)。 */
export interface TracePageProps {
  /** hooks 份额绑定的选择器钩子(SnapshotSelectorHook 形态)。 */
  readonly useTrace: <S>(selector: (state: TraceState) => S) => S
  /** 回到会话列表(重新拉默认列表)。 */
  readonly refresh: () => void
  /** 选中会话 → 详情形态(宿主带参调用并发布到数据源)。 */
  readonly openSession: (sessionId: string) => void
  /** 标准语言席位。 */
  readonly t: (key: string) => string
}

/** 会话列表卡。 */
function SessionCard({ session, onOpen }: {
  readonly session: TraceSessionCard
  readonly onOpen: (sessionId: string) => void
}): ReactElement {
  return (
    <button
      type="button"
      data-t7-session-item={session.sessionId}
      data-t7-session-area={session.area}
      onClick={() => onOpen(session.sessionId)}
    >
      <span data-t7-session-id>{session.sessionId}</span>
      <span data-t7-session-metrics>
        <span data-t7-session-turns>{formatTokens(session.turns)} 轮</span>
        <span data-t7-session-input>{formatTokens(session.inputTokens)} 入</span>
        <span data-t7-session-output>{formatTokens(session.outputTokens)} 出</span>
        <span data-t7-session-cache>{formatTokens(session.cacheReadTokens)} 缓存</span>
      </span>
      <span data-t7-session-last>{formatTime(session.lastAt)}</span>
    </button>
  )
}

/** 单次工具调用行(错误高亮;耗时/参数预览)。 */
function ToolCallRow({ tool }: { readonly tool: TraceToolCall }): ReactElement {
  return (
    <div
      data-t7-trace-tool={tool.name}
      data-t7-tool-error={tool.isError ? 'true' : 'false'}
    >
      <span data-t7-tool-name>{tool.name}</span>
      <span data-t7-tool-duration>{formatDuration(tool.durationMs)}</span>
      {tool.isError && <span data-t7-tool-error-name>{tool.errorName ?? 'error'}</span>}
      <span data-t7-tool-args>{tool.argsPreview}</span>
    </div>
  )
}

/** 审批点行(高亮;v0 口径=审批类工具调用,T7.4 升级审批事件)。 */
function ApprovalPointRow({ point }: { readonly point: TraceApprovalPoint }): ReactElement {
  return (
    <div data-t7-approval-point={point.name} data-t7-approval-at={point.at ?? ''}>
      <span data-t7-approval-point-name>{point.name}</span>
      <span data-t7-approval-point-time>{formatTime(point.at)}</span>
    </div>
  )
}

/** 单轮节点(耗时/token/工具/审批点)。 */
function TurnNode({ turn }: { readonly turn: TraceTurn }): ReactElement {
  return (
    <div
      data-t7-trace-node={String(turn.turn)}
      data-t7-turn-reason={turn.endReason ?? 'unknown'}
    >
      <div data-t7-trace-node-head>
        <span data-t7-trace-turn>轮次 {turn.turn}</span>
        <span data-t7-trace-duration>{formatDuration(turn.durationMs)}</span>
        <span data-t7-trace-tokens>
          {turn.usage === null
            ? '— token'
            : `${formatTokens(turn.usage.inputTokens)} 入 / ${formatTokens(turn.usage.outputTokens)} 出 · 共 ${formatTokens(turn.usage.totalTokens)}`}
        </span>
        {turn.endReason !== null && <span data-t7-turn-reason-badge>{turn.endReason}</span>}
      </div>
      {turn.tools.length > 0 && (
        <div data-t7-trace-tools>
          {turn.tools.map(tool => <ToolCallRow key={tool.callId} tool={tool} />)}
        </div>
      )}
      {turn.approvalPoints.length > 0 && (
        <div data-t7-trace-approvals>
          {turn.approvalPoints.map(point => <ApprovalPointRow key={point.callId} point={point} />)}
        </div>
      )}
    </div>
  )
}

/** 选中会话的轮次树。 */
function TraceDetail({ selected, onBack, t }: {
  readonly selected: SessionTrace
  readonly onBack: () => void
  readonly t: (key: string) => string
}): ReactElement {
  return (
    <div data-t7-trace-detail data-t7-trace-session={selected.sessionId}>
      <div data-t7-trace-toolbar>
        <button type="button" data-t7-trace-back onClick={onBack}>{t('back')}</button>
        <span data-t7-trace-session-id>{selected.sessionId}</span>
        <span data-t7-trace-events>
          {t('trace.events')} {selected.events.total} · 投影 {selected.events.projected} · 跳过 {selected.events.skipped}
        </span>
      </div>
      {selected.turns.length === 0
        ? <p data-t7-placeholder data-t7-trace-empty="true">{t('trace.detail.empty')}</p>
        : (
          <div data-t7-trace-turns>
            {selected.turns.map(turn => <TurnNode key={turn.turn} turn={turn} />)}
          </div>
        )}
    </div>
  )
}

/** 循环轨迹根组件。 */
export function TracePage({ useTrace, refresh, openSession, t }: TracePageProps): ReactElement {
  const state = useTrace(s => s)

  return (
    <div data-t7-trace-root aria-label={t('trace')}>
      <div data-t7-toolbar>
        <h1 data-t7-heading>{t('trace')}</h1>
        <button type="button" data-t7-refresh onClick={refresh}>{t('refresh')}</button>
      </div>
      <p data-t7-sub>{t('trace.subtitle')}</p>

      {state.status === 'loading' && <p data-t7-placeholder>{t('state.loading')}</p>}
      {state.status === 'error' && <p data-t7-error>{t('state.error')}: {state.message}</p>}

      {state.status === 'ready' && (
        <>
          <p data-t7-trace-pipeline>
            {t('trace.pipeline')}: <span data-t7-trace-pipeline-name>{state.report.pipeline}</span>
            {' · '}{previewText(state.report.sessionsRoot, 80)}
          </p>
          {state.report.selected !== null
            ? (
              <TraceDetail
                selected={state.report.selected}
                onBack={refresh}
                t={t}
              />
            )
            : (
              <div data-t7-session-list>
                {state.report.sessions.length === 0
                  ? <p data-t7-placeholder data-t7-sessions-empty="true">{t('state.empty')}</p>
                  : state.report.sessions.map(session => (
                    <SessionCard key={session.sessionId} session={session} onOpen={openSession} />
                  ))}
              </div>
            )}
        </>
      )}
    </div>
  )
}
