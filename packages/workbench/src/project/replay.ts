/**
 * 单工单回放投影(38 号 T9/F-10;30 号 §7-2 拍板):选中工单 → 图上重放其
 * 事件序列。数据源 = audit trace——M3 即快照 logs 面(按工单聚合的 audit
 * 行,30 号 §2 视图 3);audit NDJSON 精确字段名 M4 固化(38 号 O-4,不虚构)。
 *
 * 全局时间轴回放不做(F-11/30 号 §7-2):本模块只有按工单过滤一条路径,
 * 无跨工单时间轴面。
 */
import type { FlowNodeKey, WorkbenchLogEntry, WorkbenchSnapshot } from '../types.ts'
import { FLOW_NODE_TITLE, flowNodeCenter } from './flow-graph.ts'

/** audit 来源 → 图节点(链路九节点;工具调用与 worker 会话都发生在 Worker 执行)。 */
const SOURCE_NODE: Readonly<Record<string, FlowNodeKey>> = {
  Trigger: 'trigger',
  Thread: 'thread',
  Eval: 'eval',
  Decision: 'decision',
  Ticket: 'ticket',
  Assignment: 'assignment',
  Report: 'report',
  Outbox: 'outbox',
}

/** 日志来源归节点:「工具 fs.read」/「session」→ Worker 执行;未知来源不进轨迹。 */
export function sourceToNode(source: string): FlowNodeKey | undefined {
  if (source.startsWith('工具 ') || source === 'session') return 'worker'
  return SOURCE_NODE[source]
}

/** 回放单步(一个 audit 事件在其节点上的呈现)。 */
export interface ReplayStep {
  readonly entryId: string
  readonly time: string
  readonly source: string
  readonly nodeKey: FlowNodeKey
  /** 步进播报行(aria-live;摘要段拼接)。 */
  readonly announce: string
}

/** 回放轨迹(节点去重保序 + 折线顶点;原型 03 freplay 几何同源)。 */
export interface ReplayTrack {
  readonly ticketId: string
  readonly steps: readonly ReplayStep[]
  readonly nodeKeys: readonly FlowNodeKey[]
  readonly points: readonly { readonly x: number; readonly y: number }[]
}

function announceOf(entry: WorkbenchLogEntry): string {
  return `${entry.time} ${entry.source} → ${entry.summary.map(segment => segment.text).join('')}`
}

/**
 * 工单 → 回放轨迹(audit 事件按时间序映射到链路节点;连续同节点合并为一段
 * 折线)。工单无 audit 行 → steps 为空(入口仍可用,播报「暂无回放事件」);
 * 未知工单返回 undefined。
 */
export function replayTrack(snapshot: WorkbenchSnapshot, ticketId: string): ReplayTrack | undefined {
  const hit = snapshot.tickets.some(ticket => ticket.id === ticketId)
  if (!hit) return undefined
  // 时间序(HH:MM:SS 字典序即时间序;同刻保持快照内顺序——audit 面分组归档,
  // worker 会话行不在 audit 组,须按时间重排才是事件序列)
  const entries = snapshot.logs
    .map((entry, index) => ({ entry, index }))
    .filter(item => item.entry.ticketId === ticketId)
    .sort((left, right) => left.entry.time.localeCompare(right.entry.time) || left.index - right.index)
    .map(item => item.entry)
  return replayTrackFromEntries(ticketId, entries)
}

/**
 * 轨迹构建(M4 实接入口,38 号 T9/O-4):工单 id + 该工单的 audit 轨迹条目 →
 * 回放轨迹。M4 的条目来自真实 trace 面——tasks Store 前链(Trigger→Decision→
 * Ticket→Assignment/Report→Outbox)与 audit NDJSON 归账条目(R4 目录归账,
 * trace-files.ts traceEntriesForTicket),source 词汇与快照 logs 面一致,经
 * sourceToNode 同一张映射落节点。全局时间轴回放不做(F-11):只有按工单一条
 * 路径。
 */
export function replayTrackFromEntries(ticketId: string, entries: readonly WorkbenchLogEntry[]): ReplayTrack {
  const steps: ReplayStep[] = []
  for (const entry of entries) {
    const nodeKey = sourceToNode(entry.source)
    if (nodeKey === undefined) continue
    steps.push({ entryId: entry.id, time: entry.time, source: entry.source, nodeKey, announce: announceOf(entry) })
  }
  const nodeKeys: FlowNodeKey[] = []
  for (const step of steps) {
    if (nodeKeys[nodeKeys.length - 1] !== step.nodeKey) nodeKeys.push(step.nodeKey)
  }
  return {
    ticketId,
    steps,
    nodeKeys,
    points: nodeKeys.map(key => flowNodeCenter(key)),
  }
}

/** 轨迹折线的坐标串(画布绘制与 a11y 叙述共用;如「110,70 350,70 …」)。 */
export function replayPointsText(track: ReplayTrack): string {
  return track.points.map(point => `${point.x},${point.y}`).join(' ')
}

/** 轨迹叙述(a11y;画布无 DOM 可读,回放等价文案走旁挂列表/播报)。 */
export function replayNarration(track: ReplayTrack): string {
  if (track.steps.length === 0) return `${track.ticketId} 暂无回放事件`
  const chain = track.nodeKeys.map(key => FLOW_NODE_TITLE[key]).join('→')
  return `${track.ticketId} 回放轨迹：${chain}（共 ${track.steps.length} 个事件）`
}
