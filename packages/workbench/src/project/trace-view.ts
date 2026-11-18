/**
 * 日志监控投影(38 号 T10:按工单聚合 audit trace + worker 会话日志,可过滤
 * 检索;摘要行四字段 = 来源(工具名)/参数摘要/结果状态/耗时,30 号 §7-4)。
 */
import type { WorkbenchLogEntry, WorkbenchSnapshot } from '../types.ts'

/** 工单过滤 chip(mock 阶段静态取值 = 原型 03 工具条三 chip:M3 不虚构其余工单日志)。 */
export const LOG_TICKET_CHIPS: readonly string[] = ['T-9c81', 'T-a21f', 'T-3f2a']

export interface LogsFilter {
  readonly ticketId: string
  /** 检索词(匹配 来源/参数摘要/结果状态;原型 placeholder「检索工具 / 参数 / 状态」)。 */
  readonly query: string
}

export interface LogGroups {
  readonly audit: readonly WorkbenchLogEntry[]
  readonly workerSession: readonly WorkbenchLogEntry[]
}

const segmentsText = (segments: readonly { readonly text: string }[]): string =>
  segments.map(segment => segment.text).join('')

/** 检索匹配:来源 / 摘要文本 / 状态徽标 三字段(placeholder 口径)。 */
export function matchesQuery(entry: WorkbenchLogEntry, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return entry.source.toLowerCase().includes(needle)
    || segmentsText(entry.summary).toLowerCase().includes(needle)
    || entry.status.label.toLowerCase().includes(needle)
}

/** 过滤投影:工单 chip + 检索词 → audit / worker 会话 两组(时序保持快照序)。 */
export function filterLogs(logs: readonly WorkbenchLogEntry[], filter: LogsFilter): LogGroups {
  const hit = logs.filter(entry => entry.ticketId === filter.ticketId && matchesQuery(entry, filter.query))
  return {
    audit: hit.filter(entry => entry.group === 'audit'),
    workerSession: hit.filter(entry => entry.group === 'worker-session'),
  }
}

/** worker 会话日志小节标题(原型 03 逐字;mock 数据集 worker = event-planning-01)。 */
export const WORKER_SESSION_HEADING = 'worker 会话日志（event-planning-01）'

/** 快照 → 日志视图默认过滤(首个 chip 工单,空检索)。 */
export function defaultLogsFilter(snapshot: WorkbenchSnapshot): LogsFilter {
  return { ticketId: LOG_TICKET_CHIPS[0] ?? snapshot.tickets[0]?.id ?? '', query: '' }
}
