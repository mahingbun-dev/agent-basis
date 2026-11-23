/**
 * 四视图实接节投影(38 号 T8/T9/T11/T12 的 M4 实接半边;30 号 §2 视图 1/2/4/5
 * 数据源列)。纯函数层(G-11):输入 = tasks 只读面 + 落盘数据面(audit NDJSON/
 * dsh-evals 结果/漂移信号)+ 事件环,输出 = types.ts 快照节;live-projection.ts
 * (传输词汇)与本层(真实数据装配)分离——本层不发传输帧。
 *
 * 诚实呈现纪律(AGENTS.md「数字必须实测可追溯,不编造」):计数点未接线处
 * (duplicate 只在 intake receive 返回值不落库、插队计数挂 DshExecutor、R1 预算
 * 与会话面未装配、路由金集两次 run 未产出)以 `unavailable`/空集 + 注记如实
 * 标注,不伪报数值。
 */
import type { DomainEvent, DomainEvents, Ticket } from '@eterna/tasks'
import { attachCountOf, conflictFromTasks } from './engine-view.ts'
import type { AuditDayFile, EvalRunReport } from './trace-files.ts'
import { evalSnapshotFromRuns, toolHistoryForTicket, traceEntriesForTicket } from './trace-files.ts'
import { ticketTraceEntries, type TicketTraceStore } from './ticket-trace.ts'
import { beijingParts } from './time.ts'
import { ticketStage } from '@eterna/tasks'
import type {
  ConflictMetrics, EvalSnapshot, FlowLiveState, FlowNodeKey, FlowNodeLiveState, LogSegment,
  WorkbenchLogEntry, WorkerInspectorSnapshot, WorkerJobItem, WorkerTreeNode,
} from '../types.ts'

/** R1 预算读数(governance BudgetGuard.usage 形态;装配接线后注入,缺省不可采)。 */
export interface WorkbenchBudgetUsage {
  readonly turns: number
  readonly totalTokens: number
  readonly maxTurns?: number
  readonly maxTokens?: number
  readonly cost: number
  readonly maxCost?: number
}

/** 事件环容量(节点「最近事件」行上限;超界淘汰最旧)。 */
export const FLOW_RING_LIMIT = 12
/** routed 决策计数窗口(attach「本周」):只读查询最近 500 条决策再按周窗过滤。 */
const DECISION_WINDOW = 500

/** 节点「最近事件」行(北京时间 HH:mm + mono id + 文本;原型 04 event-list 词汇)。 */
function ringLine(at: string, id: string, text: string): readonly LogSegment[] {
  const parts = beijingParts(at)
  return [{ text: `${parts === undefined ? '--:--' : `${parts.hour}:${parts.minute}`} · `, num: true },
    { text: id, mono: true }, { text: ` ${text}` }]
}

/** 事件环条目(信息流图活跃边与节点事件行的来源;真事件流驱动,F-3)。 */
export interface FlowRingItem {
  readonly at: string
  readonly type: keyof DomainEvents
  readonly line: readonly LogSegment[]
  readonly edge: readonly { readonly from: FlowNodeKey; readonly to: FlowNodeKey }[]
}

/** DomainEvent → 环条目(事件名 = ports.ts 枚举逐支,不虚构;O-1 实接面)。 */
export function flowRingItemOf(event: DomainEvent): FlowRingItem {
  const at = event.at
  switch (event.type) {
    case 'trigger.received':
      return { at, type: event.type, line: ringLine(at, event.data.triggerId, 'trigger 到达'), edge: [{ from: 'trigger', to: 'thread' }] }
    case 'eval.started':
      return { at, type: event.type, line: ringLine(at, event.data.evalId, `Eval 开始 · ${event.data.triggerIds.length} trigger`), edge: [{ from: 'thread', to: 'eval' }] }
    case 'decision.recorded':
      return { at, type: event.type, line: ringLine(at, event.data.decisionId, `Decision ${event.data.kind}`), edge: [{ from: 'eval', to: 'decision' }] }
    case 'ticket.created':
      return { at, type: event.type, line: ringLine(at, event.data.ticketId, '建票'), edge: [{ from: 'decision', to: 'ticket' }] }
    case 'ticket.resumed':
      return { at, type: event.type, line: ringLine(at, event.data.ticketId, '人工消息恢复'), edge: [] }
    case 'ticket.ended':
      return { at, type: event.type, line: ringLine(at, event.data.ticketId, `工单结束 ${event.data.outcome}`), edge: [{ from: 'report', to: 'outbox' }] }
    case 'assignment.started':
      return { at, type: event.type, line: ringLine(at, event.data.assignmentId, 'Assignment 启动'), edge: [{ from: 'ticket', to: 'assignment' }, { from: 'assignment', to: 'worker' }] }
    case 'assignment.ended':
      return { at, type: event.type, line: ringLine(at, event.data.assignmentId, `Assignment 结束（${event.data.reason}）`), edge: [] }
    case 'thread.subscribed':
      return { at, type: event.type, line: ringLine(at, event.data.ticketId, '订阅线程'), edge: [] }
    case 'thread.unsubscribed':
      return { at, type: event.type, line: ringLine(at, event.data.ticketId, `退订线程（${event.data.by}）`), edge: [] }
    case 'trigger.requeued':
      return { at, type: event.type, line: ringLine(at, event.data.triggerId, '重新排队等 Eval'), edge: [{ from: 'trigger', to: 'thread' }] }
    case 'trigger.followup':
      return { at, type: event.type, line: ringLine(at, event.data.triggerId, '人消息已达工单，离开队列'), edge: [] }
    case 'policy.changed':
      return { at, type: event.type, line: ringLine(at, event.data.to, `策略版本变更（自 ${event.data.from}）`), edge: [] }
  }
}

/** 事件环推进(容量钳制;返回新环,不可变)。 */
export function pushRing(ring: readonly FlowRingItem[], event: DomainEvent): readonly FlowRingItem[] {
  return [...ring, flowRingItemOf(event)].slice(-FLOW_RING_LIMIT)
}

/** 结构化决策读数(store 只读查询产物;Decision 的结构子集)。 */
interface DecisionRead {
  readonly at: string
  readonly reason: readonly { readonly code: string }[]
}

/** tasks 只读面(结构子集;TasksWorldView 经 live-hub adaptTasks 适配——只有 SELECT 查询面)。 */
export interface LiveSectionsTasks {
  /** node:sqlite 只读查询面(routed 决策计数/工单 trace);workbench 只 SELECT,异常不猜。 */
  readonly db?: {
    prepare(sql: string): { all(...parameters: unknown[]): unknown[] }
  }
  /** DshExecutor 计数暴露位(A22 接线后在册;stub 时缺省——如实标注)。 */
  readonly executor?: { readonly personBarges?: () => number }
  /**
   * 真实占槽读数(stats().executor.usedSlots;2026-11-23 线上修复)。
   * 在场时槽位显示以它为唯一权威;缺席(离线快照/mock)才回退 ticketStage 派生近似。
   */
  readonly usedSlots?: number
}

/**
 * 前链 trace 读数面组装(SELECT-only:trigger/decision 落库行即 trace,经查询面
 * 读取;db 缺席 = 无 trace 面,undefined)。
 */
export function traceStoreOf(tasks: LiveSectionsTasks | undefined): TicketTraceStore | undefined {
  const db = tasks?.db
  if (db === undefined) return undefined
  const fullRow = (sql: string, id: string): Record<string, unknown> | undefined => {
    try {
      const row = db.prepare(sql).all(id)[0]
      if (row === undefined) return undefined
      // node:sqlite TEXT 列回 JSON 字符串;任务侧 query 面可能已解析——两者都接
      const value = typeof row === 'object' && row !== null && 'value' in row ? (row).value : row
      if (typeof value === 'string') {
        try {
          const parsed: unknown = JSON.parse(value)
          return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
        } catch {
          return undefined
        }
      }
      return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
    } catch {
      return undefined
    }
  }
  return {
    db,
    triggers: { get: (id: string) => fullRow('SELECT value FROM trigger WHERE id = ?', id) as unknown as ReturnType<TicketTraceStore['triggers']['get']> },
    decisions: { get: (id: string) => fullRow('SELECT value FROM decision WHERE id = ?', id) as unknown as ReturnType<TicketTraceStore['decisions']['get']> },
  }
}

/** 四视图实接节的装配输入(全部可选;缺省的节按各自中立/空态如实呈现)。 */
export interface LiveSectionsInputs {
  readonly tasks?: LiveSectionsTasks
  /** audit NDJSON 按日文件(trace-files.readAuditFiles 产物)。 */
  readonly auditFiles?: readonly AuditDayFile[]
  /** dsh-evals run 序列(trace-files.readEvalRuns 产物)。 */
  readonly evalRuns?: readonly EvalRunReport[]
  /** observe drift 信号读数(SignalStore kind='drift' 查询产物)。 */
  readonly drift?: { readonly count: number; readonly latestAt?: number }
  /** R1 预算读数(governance BudgetGuard.usage;装配后注入)。 */
  readonly budgetUsage?: WorkbenchBudgetUsage
  /** 领域事件环(live hub 持有并推进)。 */
  readonly ring?: readonly FlowRingItem[]
}

/** 行值 → 记录对象(node:sqlite TEXT 列回 JSON 字符串,任务侧 query 面可能已解析;两者都接)。 */
function asRecord(row: unknown): Record<string, unknown> | undefined {
  const parse = (candidate: unknown): Record<string, unknown> | undefined => {
    if (typeof candidate === 'string') {
      try {
        const parsed: unknown = JSON.parse(candidate)
        return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
      } catch {
        return undefined
      }
    }
    return typeof candidate === 'object' && candidate !== null ? candidate as Record<string, unknown> : undefined
  }
  if (typeof row === 'object' && row !== null && 'value' in row) {
    const record = parse((row).value)
    if (record !== undefined && typeof record['at'] === 'string') return record
  }
  return parse(row)
}

/** 决策只读查询(近窗,行序 = rowid 降序,坏行跳过;异常返回空,不猜)。 */
function recentDecisions(tasks: LiveSectionsTasks | undefined): readonly DecisionRead[] {
  const db = tasks?.db
  if (db === undefined) return []
  try {
    const rows = db.prepare('SELECT value FROM decision ORDER BY rowid DESC LIMIT ?').all(DECISION_WINDOW)
    return rows.flatMap((row) => {
      const record = asRecord(row)
      if (record === undefined) return []
      if (typeof record['at'] !== 'string' || !Array.isArray(record['reason'])) return []
      const reason = (record['reason'] as unknown[]).flatMap((item) => {
        if (typeof item !== 'object' || item === null || typeof (item as { code?: unknown }).code !== 'string') return []
        return [{ code: (item as { code: string }).code }]
      })
      return [{ at: record['at'], reason }]
    })
  } catch {
    return []
  }
}

/** 决策 kind 计数(decision 表只读查询;异常不猜,给 0)。 */
function decisionKindCounts(tasks: LiveSectionsTasks | undefined): { accept: number; stop: number } {
  const db = tasks?.db
  if (db === undefined) return { accept: 0, stop: 0 }
  try {
    const rows = db.prepare('SELECT json_extract(value, \'$.kind\') AS kind, COUNT(*) AS n FROM decision GROUP BY kind').all() as { kind: unknown; n: unknown }[]
    const counts = { accept: 0, stop: 0 }
    for (const row of rows) {
      if (row.kind === 'accept') counts.accept = Number(row.n ?? 0)
      if (row.kind === 'stop') counts.stop = Number(row.n ?? 0)
    }
    return counts
  } catch {
    return { accept: 0, stop: 0 }
  }
}

/** trigger 只读计数(trigger 表近 7 日到达数;异常不猜,undefined)。 */
export function triggerReceivedSince(tasks: LiveSectionsTasks | undefined, sinceIso: string): number | undefined {
  const db = tasks?.db
  if (db === undefined) return undefined
  try {
    const rows = db.prepare('SELECT SUM(json_extract(t.value, \'$.at\') >= ?) AS received FROM trigger t').all(sinceIso) as { received: unknown }[]
    return rows.reduce<number>((sum, row) => sum + Number(row.received ?? 0), 0)
  } catch {
    return undefined
  }
}

/**
 * T8 冲突三指标(27 号 D2;计数暴露位见 35 号表②:attach = evals routed 决策
 * 「挂到已有工单」,duplicate = intake receive 幂等三态,插队 = WorkerSlots
 * `personBarges()`)。store/db 面缺席(数据端点未经 tasks 实例装配)时 attach
 * 如实 `unavailable`;duplicate/插队未接线恒如实标注。K-3:只展示,无告警。
 */
export function conflictSection(inputs: LiveSectionsInputs): ConflictMetrics {
  const tasks = inputs.tasks
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const jumpCount = tasks?.executor?.personBarges?.()
  return conflictFromTasks({
    attachCount: attachCountOf(recentDecisions(tasks), weekAgo),
    attachNote: '同线程候选挂接 · 7 日（routed 决策）',
    ...(tasks?.db === undefined ? { attachUnavailableNote: '计数接入后展示' } : {}),
    ...(jumpCount !== undefined ? { jumpCount } : {}),
  })
}

/**
 * 工单是否真的占着 worker 槽——**运行时口径**,不是领域态口径(2026-11-23 线上修复)。
 *
 * 陈旧事实(2026-11-23 生产实证):本文件此前一律用 `assignments.at(-1).state === 'running'`
 * 当运行中,jobs「运行中 N 分钟」与「槽位 n/m」由此失真——worker 报 `waiting` 后其回合早已
 * 结束(executor/dsh.ts:455 `running()` 只看 `agent.status === 'running' || settling`),但
 * Assignment 的领域态仍是 `running`(pending→running→ended 只由 endAssignment/工单 end 迁移,
 * core/model.ts:269),于是「运行 2843 分钟」的假象出现在检查器上。真实口径 = core/stage.ts
 * 的 `ticketStage()`:`working` 且非排队才算跑着,`waiting` 报告的工单落 `idle` 不算。
 *
 * executor 的真实占槽面仍是唯一权威(`DshExecutor.usedSlots()`);本派生用于投影层无该读数
 * 时(kiosk/mock/离线快照)的诚实近似。
 */
export const latestRunning = (ticket: Ticket): boolean => {
  if (ticket.ended !== undefined) return false
  const stage = ticketStage(ticket)
  return stage.stage === 'working' && stage.action !== 'queued'
}

/**
 * 占槽数的唯一取数口径(2026-11-23 线上修复):**真实执行面读数优先**
 * (`stats().executor.usedSlots`,DshExecutor 的 WorkerSlots:在跑回合 + 正在启动的 launch),
 * 缺席(离线快照/mock/数据端点未接线)才回退 `latestRunning` 派生近似。
 *
 * 为什么优先真读数:派生近似只能看领域数据,看不到「回合真的在跑没有」;真读数是执行面
 * 自己记的账,不会把 waiting 停泊的工单算成在跑。
 */
export const slotsUsedOf = (inputs: LiveSectionsInputs, tickets: readonly Ticket[]): number =>
  inputs.tasks?.usedSlots ?? tickets.filter(latestRunning).length

/**
 * T9 信息流活况(F-1/F-3:节点即领域对象、边即 DomainEvents;真事件流驱动)。
 * 事件环给活跃边与节点「最近事件」行;计数面(trigger/线程/决策/槽位)给副行。
 * Assignment 节点由看板卡派生(flow-graph.ts stuckTickets),不入本节(快照口径:
 * 非派生八节点;卡点 = person/* 工单,由快照工单列派生,30 号 §2.1)。
 */
export function flowSection(
  inputs: LiveSectionsInputs,
  tickets: readonly Ticket[],
  workerSlots: number,
  subscribedThreads: number,
): FlowLiveState {
  const ring = inputs.ring ?? []
  const eventsOn = (key: FlowNodeKey): readonly (readonly LogSegment[])[] =>
    ring.filter(item => item.edge.some(edge => edge.from === key)).slice(-3).map(item => item.line)
  const decisions = decisionKindCounts(inputs.tasks)
  const weekReceived = triggerReceivedSince(inputs.tasks, new Date(Date.now() - 7 * 86_400_000).toISOString())
  // 槽位 n/m:真读数优先(slotsUsedOf 注);节点活跃态同口径。
  const used = slotsUsedOf(inputs, tickets)
  const node = (key: Exclude<FlowNodeKey, 'assignment'>, sub: string, active: boolean): FlowNodeLiveState => {
    const events = eventsOn(key)
    return { key, state: events.length > 0 || active ? 'active' : 'idle', sub, events }
  }
  return {
    nodes: [
      node('trigger', weekReceived === undefined ? '计数接入后展示' : `7 日 ${weekReceived} 次`, false),
      node('thread', `${subscribedThreads} 订阅`, subscribedThreads > 0),
      node('eval', '合批 200ms', false),
      node('decision', `accept ${decisions.accept} · stop ${decisions.stop}`, false),
      node('worker', `${used}/${workerSlots} 槽`, used > 0),
      node('report', '工单报告面', false),
      node('outbox', '回执投递面', false),
    ],
    liveEdges: [...new Set(ring.flatMap(item => item.edge).map(edge => `${edge.from}→${edge.to}`))]
      .map(key => (key.split('→') as [FlowNodeKey, FlowNodeKey]))
      .map(([from, to]) => ({ from, to })),
    workerSlots,
    slotsUsed: used,
    replayOptions: tickets.filter(ticket => ticket.ended === undefined).map(ticket => ticket.id),
  }
}

/**
 * T11 评测监控节(E-1 趋势/规模/周跑数 = dsh-evals run 序列;E-2 衰减 = 路由
 * 金集两次 run(G2-A9,产出前空序列如实);E-3 漂移 = observe drift 信号计数;
 * E-4 金集即验收——口径对齐 dsh-evals,不另建指标;E-5 不按模型分叉)。
 */
export function evalSection(inputs: LiveSectionsInputs, nowMs: number): EvalSnapshot {
  const latestDriftAt = inputs.drift?.latestAt
  return evalSnapshotFromRuns({
    runs: inputs.evalRuns ?? [],
    driftSignalCount: inputs.drift?.count ?? 0,
    ...(latestDriftAt !== undefined ? { latestDriftAt } : {}),
    nowMs,
  })
}

/**
 * T12 worker 检查器节(W-1 四要素;引擎实况 + 落盘工具史 + R1 预算):
 * - 子代理树:组织层 + 战术层(每张在办工单一个 worker 节点);执行层 subagent
 *   需上游 session 事件(A22 宿主事件装配后),未接线不呈现该层(W-2 不增层;
 *   O-6 粒度拍板前不虚构);
 * - jobs:开放工单的 Assignment 面(running/pending;worker session 后台 job 需
 *   A22 宿主事件,未接线不列);
 * - 工具史:audit NDJSON 按 R4 目录归账(有落盘即真值,无则空);
 * - 上下文/成本:R1 预算读数注入时计算(token 口径分母 = maxTokens,28 号压缩
 *   阈值口径拍板前以预算上限计并在注记披露),未注入如实标注为 0 + 注记。
 */
export function workerSection(
  inputs: LiveSectionsInputs,
  tickets: readonly Ticket[],
  workerSlots: number,
  nowMs: number,
): WorkerInspectorSnapshot {
  // 运行时口径(latestRunning):waiting/blocked/failed/ready 报告的工单已结束本回合,不再占槽
  // (2026-11-23 线上修复;陈旧口径见 latestRunning 注)。
  const working = tickets.filter(latestRunning)
  const focused = working[0]
  const runMinutes = focused === undefined
    ? 0
    : Math.max(0, Math.round((nowMs - Date.parse(focused.assignments.at(-1)?.startedAt ?? focused.updatedAt)) / 60_000))
  const tree: WorkerTreeNode = {
    name: 'Orchestrator',
    role: '主 Session · 组织层',
    state: 'idle',
    children: working.map(ticket => ({
      name: `worker ${ticket.execution?.name ?? ticket.id}`,
      role: `${ticket.id} · 战术层`,
      state: 'working' as const,
      current: true,
    })),
  }
  const jobs: WorkerJobItem[] = tickets
    .filter(ticket => ticket.ended === undefined)
    .flatMap((ticket) => {
      const assignment = ticket.assignments.at(-1)
      if (assignment === undefined) return []
      // 运行时口径:领域态 running 但 worker 回合已结束(waiting/blocked/failed)的工单不再
      // 计入「运行中 jobs」,而按 stage 的 wait 面如实标注停泊(2026-11-23 线上修复)。
      const live = latestRunning(ticket)
      const stage = ticketStage(ticket)
      const idleMinutes = Math.max(0, Math.round((nowMs
        - Date.parse(assignment.idleAt ?? assignment.report?.at ?? assignment.startedAt ?? assignment.createdAt)) / 60_000))
      const meta = live
        ? `运行 ${Math.max(0, Math.round((nowMs - Date.parse(assignment.startedAt ?? assignment.createdAt)) / 60_000))} 分钟`
        : stage.stage === 'working' && stage.action === 'queued' ? '排队 · 待 worker 槽位'
          : stage.stage === 'person' ? `停泊 · 等${stage.action === 'review' ? '评审' : stage.action === 'answer' ? '回答' : stage.action === 'delivery' ? '投递' : '人'} · 已 ${idleMinutes} 分钟`
            : assignment.state === 'ended' ? `已结束 · ${assignment.endedReason ?? '完成'}`
              // waiting 报告(idle):回合已结束,等后续消息。
              : `空闲 · 已 ${idleMinutes} 分钟`
      return [{ id: assignment.id, name: `${ticket.id} · Assignment ${ticket.assignments.length}`, meta, running: live }]
    })
  const toolHistory = focused === undefined ? [] : toolHistoryForTicket(inputs.auditFiles ?? [], focused.id)
  const budget = inputs.budgetUsage
  const contextPercent = budget !== undefined && budget.maxTokens !== undefined && budget.maxTokens > 0
    ? Math.min(100, Math.round((budget.totalTokens / budget.maxTokens) * 100))
    : 0
  return {
    workerId: focused?.execution?.name ?? focused?.id ?? '—',
    ticketId: focused?.id ?? '—',
    runMinutes,
    presetNote: 'preset 将在任务开始执行时显示',
    // 真读数优先(slotsUsedOf 注):在线时是执行面记的账,离线面回退 ticketStage 派生。
    slotsUsed: slotsUsedOf(inputs, tickets),
    slotsTotal: workerSlots,
    domainPack: '待接入',
    tree,
    jobs,
    toolHistory,
    context: {
      percent: contextPercent,
      thresholdPercent: 80,
      note: budget === undefined
        ? '预算接入后将展示用量 · 超过 80% 会提示压缩'
        : '按 token 口径 · 80% 为压缩提示线',
    },
    cost: {
      spentYuan: budget?.cost ?? 0,
      budgetYuan: budget?.maxCost ?? 0,
      tokensNote: budget === undefined ? '预算读数待接入' : `${Math.round(budget.totalTokens / 1000)}k（输入+输出合计）`,
      maxTurns: budget === undefined ? '—' : budget.maxTurns === undefined ? '不设限' : `${budget.turns}/${budget.maxTurns}`,
      note: '预算守卫',
    },
  }
}

/**
 * 日志监控节(T9 回放/T10 audit trace 数据面):前链(store:Trigger→Decision→
 * Ticket→Assignment/Report→Outbox)+ audit NDJSON 归账行(worker 半边,R4 目录
 * 归账;argsPreview 投影时已过 PII 脱敏)。工单全集(含已结束——trace 是历史,
 * 结束不抹行);store 面缺省时只有 audit 归账行。id 稳定(落库行/文件行号),
 * 追加式重投影不丢不重。
 */
export function traceLogsSection(inputs: {
  readonly tasks?: LiveSectionsTasks
  readonly tickets: readonly Ticket[]
  readonly auditFiles?: readonly AuditDayFile[]
}): readonly WorkbenchLogEntry[] {
  const entries: WorkbenchLogEntry[] = []
  const store = traceStoreOf(inputs.tasks)
  for (const ticket of inputs.tickets) {
    if (store !== undefined) entries.push(...ticketTraceEntries(store, ticket))
    for (const entry of traceEntriesForTicket(inputs.auditFiles ?? [], ticket.id)) {
      entries.push({
        id: entry.id,
        ticketId: ticket.id,
        group: 'worker-session',
        time: entry.time,
        source: entry.source,
        summary: [{ text: entry.summary }],
        status: { label: entry.status, tone: entry.status === '失败' ? 'danger' : entry.status === '治理' ? 'warn' : 'success' },
        duration: '—',
      })
    }
  }
  return entries
}
