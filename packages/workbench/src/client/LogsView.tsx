/**
 * 日志监控视图(视图三;38 号 T10/L-1~L-7,布局/状态/文案 = 原型 03 视图三
 * 逐字):摘要行四字段(时间/来源含工具名/参数摘要/结果状态/耗时)+ 展开全文
 * 过 governance pii redact(展示层只过滤不删改,30 号 §7-4)。受控纯组件:
 * 过滤/检索/展开状态由 WorkbenchPage 持有。
 */
import type { ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'
import {
  LOG_TICKET_CHIPS, WORKER_SESSION_HEADING, filterLogs, type LogsFilter,
} from '../project/trace-view.ts'
import { redactedFull } from '../project/pii-view.ts'
import type { WorkbenchLogEntry, WorkbenchSnapshot } from '../types.ts'
import { Segments } from './KanbanView.tsx'

export interface LogsViewProps {
  readonly snapshot: WorkbenchSnapshot
  readonly filter: LogsFilter
  readonly onTicketChange: (ticketId: string) => void
  readonly onQueryChange: (query: string) => void
  readonly expandedIds: ReadonlySet<string>
  readonly onToggleExpand: (entryId: string) => void
  readonly t: (key: string) => string
}

function LogEntry({ entry, expanded, onToggleExpand }: {
  readonly entry: WorkbenchLogEntry
  readonly expanded: boolean
  readonly onToggleExpand: (entryId: string) => void
}): ReactElement {
  const full = expanded ? redactedFull(entry) : undefined
  return (
    <details
      data-eterna-workbench="log-entry"
      data-eterna-workbench-entry={entry.id}
      open={expanded ? true : undefined}
    >
      <summary onClick={() => { onToggleExpand(entry.id) }}>
        <span data-eterna-workbench="log-time" data-eterna-workbench-num="true">{entry.time}</span>
        <span data-eterna-workbench="log-src">{entry.source}</span>
        <span data-eterna-workbench="log-sum"><Segments segments={entry.summary} /></span>
        <span data-eterna-workbench="badge" data-eterna-workbench-tone={entry.status.tone}>{entry.status.label}</span>
        <span data-eterna-workbench="log-dur" data-eterna-workbench-num="true">{entry.duration}</span>
        <Icon className="chev" name="chevron-down" size={16} />
      </summary>
      {full !== undefined && (
        <div data-eterna-workbench="log-full">
          {full.map((paragraph, index) => (
            <p key={index}><Segments segments={paragraph} /></p>
          ))}
        </div>
      )}
    </details>
  )
}

/** 日志监控 · 摘要行 + 展开态(原型 03 视图三)。 */
export function LogsView({ snapshot, filter, onTicketChange, onQueryChange, expandedIds, onToggleExpand, t }: LogsViewProps): ReactElement {
  const groups = filterLogs(snapshot.logs, filter)
  return (
    <section data-eterna-workbench="view" data-eterna-workbench-view="logs" id="wb-v3" aria-labelledby="wb-h-v3">
      <div data-eterna-workbench="view-head">
        <p data-eterna-workbench="kicker">视图三</p>
        <h2 data-eterna-workbench="view-title" id="wb-h-v3">日志监控 · 摘要行 + 展开态</h2>
      </div>
      <p data-eterna-workbench="view-desc">按工单聚合 audit trace（Trigger→候选卡→Decision 理由→委派→报告→门禁全链）+ worker 会话日志，可过滤检索（30 §2）。默认摘要行 = 工具名 / 参数摘要 / 结果状态 / 耗时；展开全文过 governance <code>pii.ts</code> 可插拔正则——原始全文已在 audit NDJSON，展示层<strong>只过滤不删改</strong>（§7-4 拍板）。</p>

      <div data-eterna-workbench="toolbar" role="group" aria-label="日志过滤">
        <p data-eterna-workbench="toolbar-label">{t('toolbar.ticket')}</p>
        {LOG_TICKET_CHIPS.map(ticketId => (
          <button
            key={ticketId}
            type="button"
            data-eterna-workbench="chip"
            data-eterna-workbench-ticket={ticketId}
            data-eterna-workbench-on={filter.ticketId === ticketId ? 'true' : undefined}
            aria-pressed={filter.ticketId === ticketId}
            onClick={() => { onTicketChange(ticketId) }}
          ><span data-eterna-workbench-seg-mono="true">{ticketId}</span></button>
        ))}
        <label data-eterna-workbench="visually-hidden" htmlFor="wb-log-search">{t('toolbar.searchLabel')}</label>
        <input
          id="wb-log-search"
          data-eterna-workbench="log-search"
          type="search"
          placeholder={t('toolbar.searchPlaceholder')}
          value={filter.query}
          onChange={event => { onQueryChange(event.target.value) }}
        />
      </div>

      <div data-eterna-workbench="log-list">
        {groups.audit.length === 0 && <p data-eterna-workbench="placeholder">{t('state.emptyLogs')}</p>}
        {groups.audit.map(entry => (
          <LogEntry key={entry.id} entry={entry} expanded={expandedIds.has(entry.id)} onToggleExpand={onToggleExpand} />
        ))}
      </div>

      <h3 data-eterna-workbench="sub-h">{WORKER_SESSION_HEADING}</h3>
      <div data-eterna-workbench="log-list" data-eterna-workbench-logs="worker-session">
        {groups.workerSession.length === 0 && <p data-eterna-workbench="placeholder">{t('state.emptyLogs')}</p>}
        {groups.workerSession.map(entry => (
          <LogEntry key={entry.id} entry={entry} expanded={expandedIds.has(entry.id)} onToggleExpand={onToggleExpand} />
        ))}
      </div>
    </section>
  )
}
