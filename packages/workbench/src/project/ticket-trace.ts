/**
 * 单工单前链 trace(38 号 T9 回放/T10 审计链的数据面;30 号 §2 视图 3「按工单
 * 聚合的 audit trace:Trigger→候选卡→Decision 理由→委派→报告→门禁全链」)。
 *
 * 数据源 = tasks Store 只读面(34 号 §5 audit 行「DomainEvents + reasons 码表」
 * 的落库形态):trigger(发起原文)/decision(kind + reason 码表 + R3 委派四要素)/
 * ticket(建票)/assignment(委派与六态报告)/outbox(回执)。落库行即 trace,零
 * 推断;reason 文案经 tasks `reasonText`(码表模板)。
 */
import type { Ticket } from '@eterna/tasks'
import { reasonText, ticketStage } from '@eterna/tasks'
import type { WorkbenchLogEntry } from '../types.ts'
import { beijingParts } from './time.ts'

/** Store 的结构只读子集(tasks Store 形状;trace 只读,零写入)。 */
export interface TicketTraceStore {
  readonly triggers: { get(id: string): { id: string; at: string; text: string; actor: { id: string } } | undefined }
  readonly decisions: {
    get(id: string): {
      id: string
      kind: string
      at: string
      reason: readonly { code: string }[]
      /** R3 委派四要素(tasks Delegation 的结构子集;trace 行「Decision 理由→委派」一环)。 */
      delegation?: {
        readonly objective?: string
        readonly outputFormat?: string
        readonly toolGuidance?: string
        readonly taskBoundaries?: string
      }
    } | undefined
  }
  readonly db: {
    prepare(sql: string): { all(...parameters: unknown[]): unknown[] }
  }
}

/** ISO 时刻 → 北京时间「HH:mm:ss」;非法值回落「—」(不伪造时刻)。 */
const clock = (iso: string): string => {
  const parts = beijingParts(iso)
  return parts === undefined ? '—' : `${parts.hour}:${parts.minute}:${parts.second}`
}

/** 工单回执行(outbox 表按 ticketId;Receipt 无发送时刻字段——已弃行用 dropped.at,余者如实「—」)。 */
function outboxEntries(store: TicketTraceStore, ticketId: string): WorkbenchLogEntry[] {
  try {
    const rows = store.db.prepare('SELECT value FROM outbox WHERE json_extract(value, \'$.ticketId\') = ? ORDER BY rowid').all(ticketId)
    return rows.flatMap((row, index) => {
      if (typeof row !== 'object' || row === null) return []
      const record = row as { status?: unknown; kind?: unknown; dropped?: { at?: unknown } }
      if (typeof record.status !== 'string') return []
      const label: Record<string, { label: string; tone: 'success' | 'warn' | 'muted' }> = {
        sent: { label: '成功', tone: 'success' },
        pending: { label: '排队中', tone: 'warn' },
        dropped: { label: '已弃', tone: 'muted' },
      }
      const status = label[record.status] ?? { label: record.status, tone: 'muted' as const }
      const droppedAt = typeof record.dropped?.at === 'string' ? record.dropped.at : undefined
      const kind = typeof record.kind === 'string' ? record.kind : 'reply'
      const state = record.status === 'sent' ? '已发回原对话' : record.status === 'pending' ? '挂起等待' : '已丢弃'
      return [{
        id: `outbox-${ticketId}-${index}`,
        ticketId,
        group: 'audit' as const,
        time: droppedAt !== undefined ? clock(droppedAt) : '—',
        source: 'Outbox',
        summary: [{ text: `回执 ${kind} · ${state}` }],
        status,
        duration: '—',
      }]
    })
  } catch {
    return []
  }
}

/**
 * 工单 → 前链 audit 行(Trigger→Decision→Ticket→Assignment/Report→Outbox;
 * 时间升序 = 领域事件序)。store 读取异常的行跳过(不猜)。
 */
export function ticketTraceEntries(store: TicketTraceStore, ticket: Ticket): readonly WorkbenchLogEntry[] {
  const entries: WorkbenchLogEntry[] = []
  const trigger = store.triggers.get(ticket.origin.triggerId)
  if (trigger !== undefined) {
    entries.push({
      id: `trace-trigger-${trigger.id}`,
      ticketId: ticket.id,
      group: 'audit',
      time: clock(trigger.at),
      source: 'Trigger',
      summary: [{ text: `${trigger.actor.id} · ` }, { text: trigger.text.slice(0, 40), mono: true }],
      status: { label: '受理', tone: 'accent' },
      duration: '—',
    })
  }
  const decision = store.decisions.get(ticket.decisionId)
  if (decision !== undefined) {
    const delegation = decision.delegation
    entries.push({
      id: `trace-decision-${decision.id}`,
      ticketId: ticket.id,
      group: 'audit',
      time: clock(decision.at),
      source: 'Decision',
      summary: [{ text: `${decision.kind} → 建票 ` }, { text: ticket.id, mono: true }],
      status: { label: decision.kind, tone: 'accent' },
      duration: '—',
      full: [
        [{ text: `理由：${reasonText(decision.reason)}` }],
        ...(delegation !== undefined
          ? [[{ text: `委派四要素（R3）：目标 ${delegation['objective'] ?? '—'} · 产出 ${delegation['outputFormat'] ?? '—'} · 工具 ${delegation['toolGuidance'] ?? '—'} · 边界 ${delegation['taskBoundaries'] ?? '—'}` }]]
          : []),
      ],
    })
  }
  entries.push({
    id: `trace-ticket-${ticket.id}`,
    ticketId: ticket.id,
    group: 'audit',
    time: clock(ticket.createdAt),
    source: 'Ticket',
    summary: [{ text: '建票 · ' }, { text: `.ticket/${ticket.id}/`, mono: true }],
    status: { label: '受理', tone: 'accent' },
    duration: '—',
  })
  ticket.assignments.forEach((assignment, index) => {
    // 运行时口径(2026-11-23 线上修复):`running` 是领域态,worker 报 waiting 后回合已结束。
    // 故本行只在「该分支是工单最新分支且 ticketStage 判 working(非排队)」时才说执行中;
    // 否则按报告态如实标注停泊,避免 audit 链把停泊工单记成「worker 执行中」。
    const latest = index === ticket.assignments.length - 1
    const live = latest && ticketStage(ticket).stage === 'working'
    const reportState = assignment.report?.state
    entries.push({
      id: `trace-assignment-${assignment.id}`,
      ticketId: ticket.id,
      group: 'audit',
      time: clock(assignment.startedAt ?? assignment.createdAt),
      source: 'Assignment',
      summary: [{ text: `Assignment ${index + 1} · ${live ? 'worker 执行中' : reportState === 'waiting' ? '回合已结束 · 等后续消息' : assignment.state === 'pending' ? '排队待槽位' : `已结束（${assignment.endedReason ?? '完成'}）`}` }],
      status: { label: live ? 'running' : assignment.state, tone: live ? 'accent' : 'muted' },
      duration: '—',
    })
    const report = assignment.report
    if (report !== undefined) {
      const tone = report.state === 'ready' ? 'success' : report.state === 'blocked' || report.state === 'failed' ? 'warn' : 'accent'
      entries.push({
        id: `trace-report-${assignment.id}`,
        ticketId: ticket.id,
        group: 'audit',
        time: clock(report.at),
        source: 'Report',
        summary: [{ text: `${report.state} · ${report.summary}` }],
        status: { label: report.state, tone },
        duration: '—',
      })
    }
  })
  return [...entries, ...outboxEntries(store, ticket.id)]
}
