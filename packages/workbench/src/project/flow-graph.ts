/**
 * 信息流实时图投影(38 号 T9;30 号 §2 视图 2/§2.1):九节点封闭清单的
 * 节点/边模型与状态机、卡点派生、旁挂列表(原型 04)与画布布局(原型 03
 * 静态稿逐字——F-12 三要素:节点布局、卡点态、图例)。
 *
 * 纯函数层(G-11):输入快照 → 视图模型;渲染(画布/列表)与传输(mock SSE)
 * 均只消费本层产出,互不感知。Assignment 卡点/工单计数/worker 槽位由
 * tickets 派生(30 号 §2.1「卡点高亮 = person/* 工单在图上警示色驻留」),
 * 其余节点活况为快照 flow 节数据(原型 04 视图 B 文案逐字)。
 */
import type {
  FlowLiveState, FlowNodeKey, FlowNodeTone, LogSegment, WorkbenchSnapshot, WorkbenchTicket,
} from '../types.ts'

/** 九节点封闭清单(30 号 §2 视图 2 链路原文;F-13 不增删节点)。 */
export const FLOW_NODE_ORDER: readonly FlowNodeKey[] = [
  'trigger', 'thread', 'eval', 'decision', 'ticket', 'assignment', 'worker', 'report', 'outbox',
]

/** 节点显示名(原型 03 ftitle 逐字:「Trigger 触发」…「Outbox 出箱」)。 */
export const FLOW_NODE_TITLE: Readonly<Record<FlowNodeKey, string>> = {
  trigger: 'Trigger 触发',
  thread: 'Thread 线程',
  eval: 'Eval 评估',
  decision: 'Decision 裁决',
  ticket: 'Ticket 工单',
  assignment: 'Assignment 委派',
  worker: 'Worker 执行',
  report: 'Report 报告',
  outbox: 'Outbox 出箱',
}

/** 节点态徽标文案(原型 04 视图 B badge;颜色不单独承载状态——徽标必配文字)。 */
export const FLOW_NODE_STATE_LABEL: Readonly<Record<FlowNodeTone, string>> = {
  idle: '待命',
  active: '活跃',
  stuck: '卡点 · 等人',
  error: '异常',
}

/** 画布布局(原型 03 flow-svg 逐字:960×400 视区,两行各四/五节点,140×60 卡)。 */
export interface FlowNodeLayout {
  readonly key: FlowNodeKey
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export const FLOW_VIEWBOX = { width: 960, height: 400 } as const

/** 节点矩形(原型 03 transform/fnode 尺寸逐字;y=40 第一行,y=210 第二行)。 */
export const FLOW_NODE_LAYOUT: readonly FlowNodeLayout[] = [
  { key: 'trigger', x: 40, y: 40, width: 140, height: 60 },
  { key: 'thread', x: 280, y: 40, width: 140, height: 60 },
  { key: 'eval', x: 520, y: 40, width: 140, height: 60 },
  { key: 'decision', x: 760, y: 40, width: 140, height: 60 },
  { key: 'ticket', x: 760, y: 210, width: 140, height: 60 },
  { key: 'assignment', x: 580, y: 210, width: 140, height: 60 },
  { key: 'worker', x: 400, y: 210, width: 140, height: 60 },
  { key: 'report', x: 220, y: 210, width: 140, height: 60 },
  { key: 'outbox', x: 40, y: 210, width: 140, height: 60 },
]

/** 节点中心点(回放轨迹折线的顶点;原型 03 freplay 同源几何)。 */
export function flowNodeCenter(key: FlowNodeKey): { readonly x: number; readonly y: number } {
  const layout = FLOW_NODE_LAYOUT.find(node => node.key === key)
  if (layout === undefined) throw new Error(`未知信息流节点:${key}`)
  return { x: layout.x + layout.width / 2, y: layout.y + layout.height / 2 }
}

/** 八条事件边(原型 03 fedge 端点对;边即 DomainEvents,30 号 §2.1)。 */
export const FLOW_EDGES: readonly { readonly from: FlowNodeKey; readonly to: FlowNodeKey }[] = [
  { from: 'trigger', to: 'thread' },
  { from: 'thread', to: 'eval' },
  { from: 'eval', to: 'decision' },
  { from: 'decision', to: 'ticket' },
  { from: 'ticket', to: 'assignment' },
  { from: 'assignment', to: 'worker' },
  { from: 'worker', to: 'report' },
  { from: 'report', to: 'outbox' },
]

/** 图例七项(原型 03 图例逐字;F-12 图例要素)。 */
export interface FlowLegendItem {
  readonly label: string
  readonly swatch: 'idle' | 'active' | 'stuck' | 'error' | 'edge' | 'edge-live' | 'replay'
}

export const FLOW_LEGEND: readonly FlowLegendItem[] = [
  { label: '待命节点（默认边框）', swatch: 'idle' },
  { label: '活跃节点（事件流动中）', swatch: 'active' },
  { label: '卡点节点（person/* 等人驻留）', swatch: 'stuck' },
  { label: '异常节点（fail-closed，本稿未触发）', swatch: 'error' },
  { label: '事件边（DomainEvents 流向）', swatch: 'edge' },
  { label: '活跃边（200ms 合批推送）', swatch: 'edge-live' },
  { label: '回放轨迹（单工单事件序列）', swatch: 'replay' },
]

/** 视图节点(九节点全量;派生节点与数据节点同构,渲染不分枝)。 */
export interface FlowNodeView {
  readonly key: FlowNodeKey
  readonly title: string
  readonly state: FlowNodeTone
  readonly stateLabel: string
  /** 画布副行(原型 03 fsub;卡点节点为「3 单等人 · 最长 4h」紧凑式)。 */
  readonly sub: string
  /** 旁挂列表 stat(原型 04 node-stat;卡点节点为「3 单等人 · 最长 4 小时」全式)。 */
  readonly stat: string
  readonly events: readonly (readonly LogSegment[])[]
  /** 事件区标题(原型 04 summary:Assignment=「等待中的工单（N）」、Worker=「在办 worker（N）」,其余=「最近事件（N）」)。 */
  readonly eventsLabel: string
}

/** 视图边(live = 200ms 合批推送中的活跃边,原型 03 fedge-live)。 */
export interface FlowEdgeView {
  readonly from: FlowNodeKey
  readonly to: FlowNodeKey
  readonly live: boolean
}

/** 卡点气泡(person/* 驻留 > 0 时;原型 03 fbubble 两行文案)。 */
export interface FlowBubbleView {
  readonly text: string
  readonly sub: string
}

export interface FlowGraphView {
  readonly nodes: readonly FlowNodeView[]
  readonly edges: readonly FlowEdgeView[]
  readonly bubble: FlowBubbleView | undefined
  readonly legend: readonly FlowLegendItem[]
  /** 单工单回放可选工单(F-10 入口数据;原型 03 select 两项)。 */
  readonly replayOptions: readonly string[]
}

/** 分钟数 → 紧凑时长(卡点节点副行「最长 4h」式;240→4h、80→1h20m、6→6m)。 */
export function compactDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h${rest}m`
}

/** person/* 工单集(卡点派生口径:column === 'person',30 号 §2.1)。 */
export function stuckTickets(tickets: readonly WorkbenchTicket[]): readonly WorkbenchTicket[] {
  return tickets.filter(ticket => ticket.column === 'person')
}

/** 卡点工单事件行(原型 04 Assignment 事件行:「14:18 · T-9c81 person/answer · 等陈默回答」)。
 * 注记文本取工单 metaLine(单一数据源;原型 04 侧措辞与看板 meta 的细微差异以看板 meta 为准)。 */
function stuckEventLine(ticket: WorkbenchTicket): readonly LogSegment[] {
  const stage = ticket.metaLine[1]?.text ?? ''
  const waitNote = ticket.metaLine[2]?.text ?? ''
  const time: LogSegment[] = ticket.sinceTime === undefined ? [] : [{ text: `${ticket.sinceTime} · `, num: true }]
  return [
    ...time,
    { text: ticket.id, mono: true },
    { text: ` ${stage} · ${waitNote}` },
  ]
}

/**
 * 快照 → 信息流图视图(38 号 T9 投影本体)。派生面:
 * - Assignment 节点 = person/* 工单卡点(人数/最长驻留/等待清单事件行);
 * - Ticket 节点计数 = 工单总数;Worker 节点 = 在办/槽位;
 * 其余节点活况/事件行 = 快照 flow 节(原型 04 视图 B 逐字)。
 */
export function flowGraphView(snapshot: WorkbenchSnapshot): FlowGraphView {
  const flow: FlowLiveState = snapshot.flow
  const liveByKey = new Map(flow.nodes.map(node => [node.key, node]))
  const stuck = stuckTickets(snapshot.tickets)
  const maxStuck = stuck.reduce<WorkbenchTicket | undefined>(
    (current, ticket) => (current === undefined || (ticket.waitMinutes ?? 0) > (current.waitMinutes ?? 0) ? ticket : current),
    undefined,
  )
  const liveEdges = new Set(flow.liveEdges.map(edge => `${edge.from}→${edge.to}`))

  const nodes: FlowNodeView[] = FLOW_NODE_ORDER.map((key) => {
    if (key === 'assignment') {
      const count = stuck.length
      const longest = maxStuck === undefined ? '' : compactDuration(maxStuck.waitMinutes ?? 0)
      const longestFull = maxStuck?.metaLine.find(segment => segment.num === true)?.text ?? ''
      const sub = count === 0 ? '0 单等人' : `${count} 单等人 · 最长 ${longest}`
      const stat = count === 0 ? '0 单等人' : `${count} 单等人 · 最长 ${longestFull}`
      return {
        key,
        title: FLOW_NODE_TITLE[key],
        state: count > 0 ? 'stuck' : 'idle',
        stateLabel: FLOW_NODE_STATE_LABEL[count > 0 ? 'stuck' : 'idle'],
        sub,
        stat,
        events: stuck.map(stuckEventLine),
        eventsLabel: count === 0 ? '最近事件（0）' : `等待中的工单（${count}）`,
      }
    }
    const live = liveByKey.get(key)
    if (key === 'ticket') {
      const count = snapshot.tickets.length
      return {
        key,
        title: FLOW_NODE_TITLE[key],
        state: live?.state ?? 'idle',
        stateLabel: FLOW_NODE_STATE_LABEL[live?.state ?? 'idle'],
        sub: `${count} 活跃`,
        stat: `${count} 活跃`,
        events: live?.events ?? [],
        eventsLabel: `最近事件（${live?.events.length ?? 0}）`,
      }
    }
    if (key === 'worker') {
      // 分子取 flow.slotsUsed:真执行面读数(stats().executor.usedSlots),离线面为 ticketStage
      // 派生近似(2026-11-23 线上修复——旧口径按工单领域态数 running,把 waiting 停泊算成在跑)。
      const slots = `${flow.slotsUsed}/${flow.workerSlots} 槽`
      const events = live?.events ?? []
      // 在办清单为快照 flow 数据(原型 04 逐字;在办 worker 集合 ≠ working 工单
      // 集合——event-planning-01 在办但其工单卡点等人,原型即此口径)
      return {
        key,
        title: FLOW_NODE_TITLE[key],
        state: live?.state ?? 'idle',
        stateLabel: FLOW_NODE_STATE_LABEL[live?.state ?? 'idle'],
        sub: slots,
        stat: slots,
        events,
        eventsLabel: `在办 worker（${events.length}）`,
      }
    }
    return {
      key,
      title: FLOW_NODE_TITLE[key],
      state: live?.state ?? 'idle',
      stateLabel: FLOW_NODE_STATE_LABEL[live?.state ?? 'idle'],
      sub: live?.sub ?? '',
      stat: live?.sub ?? '',
      events: live?.events ?? [],
      eventsLabel: `最近事件（${live?.events.length ?? 0}）`,
    }
  })

  const edges: FlowEdgeView[] = FLOW_EDGES.map(edge => ({ ...edge, live: liveEdges.has(`${edge.from}→${edge.to}`) }))

  const bubble = stuck.length > 0 && maxStuck !== undefined
    ? {
      text: `person/* 卡点：${stuck.length} 单等人 · 最长 ${maxStuck.metaLine.find(segment => segment.num === true)?.text ?? ''}`,
      sub: 'person/* 阶段工单在图上以警示色驻留，答复即消（30 §2-1）',
    }
    : undefined

  return { nodes, edges, bubble, legend: FLOW_LEGEND, replayOptions: flow.replayOptions }
}

/** 画布命中测试(F-6 配套①:hover/点击手写交互的几何判定;坐标为布局系)。 */
export function hitTestFlowNode(x: number, y: number): FlowNodeKey | undefined {
  for (const layout of FLOW_NODE_LAYOUT) {
    if (x >= layout.x && x <= layout.x + layout.width && y >= layout.y && y <= layout.y + layout.height) {
      return layout.key
    }
  }
  return undefined
}

/** 旁挂列表方向键漫游(原型 04 键盘约定:上下方向键在行/节点间移动;首尾钳制)。 */
export function moveRovingIndex(current: number, delta: 1 | -1, length: number): number {
  if (length <= 0) return 0
  const next = current + delta
  if (next < 0) return 0
  if (next > length - 1) return length - 1
  return next
}
