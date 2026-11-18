/**
 * worker 检查器投影(38 号 T12;30 号 §2 视图 5):单 worker 深视图四要素
 * (33 号 G2-D10 口径)——子代理树(27 号三层结构实况,W-2 不增层)、运行中
 * jobs、工具调用历史、上下文占用 % 与成本累计(R1 预算数据,W-3)。
 *
 * 布局/文案 = 原型 03 视图五(docs/prototypes/03-workbench-views.html #v5)
 * 逐字;纯函数层(G-11),M3 mock 快照驱动,M4 换上游 session/jobs 事件源。
 */
import type { WorkerInspectorSnapshot, WorkerTreeNode } from '../types.ts'

/** 头卡元信息行(原型 03 inspector-meta:工单/运行/preset/槽位/域包)。 */
export interface WorkerHeadMeta {
  readonly id: string
  readonly ticketId: string
  readonly runMinutes: string
  readonly presetNote: string
  readonly slots: string
  readonly domainPack: string
}

/** 树视图节点(展平渲染用;depth 0/1/2 = 组织层/战术层/执行层,27 号 §2)。 */
export interface WorkerTreeLeaf {
  readonly name: string
  readonly role: string
  readonly state: WorkerTreeNode['state']
  readonly current: boolean
  readonly depth: number
}

/** 上下文/成本条(原型 03 meter;threshold = 压缩阈值标线)。 */
export interface MeterView {
  readonly label: string
  readonly percent: number
  readonly thresholdPercent: number | undefined
  readonly note: string
  /** meter 的 role="img" 可达名称(原型 03 aria-label 逐字口径)。 */
  readonly aria: string
}

export interface WorkerInspectorView {
  readonly head: WorkerHeadMeta
  readonly tree: readonly WorkerTreeLeaf[]
  readonly treeNote: string
  readonly jobsRunning: readonly { readonly id: string; readonly name: string; readonly meta: string }[]
  readonly jobsDone: readonly { readonly id: string; readonly name: string; readonly meta: string }[]
  readonly toolRows: WorkerInspectorSnapshot['toolHistory']
  readonly contextMeter: MeterView
  readonly costMeter: MeterView
}

/** 树 → 展平(前序;depth 即层级,渲染按缩进呈现,W-2 三层封闭)。 */
function flattenTree(node: WorkerTreeNode, depth: number, out: WorkerTreeLeaf[]): void {
  out.push({ name: node.name, role: node.role, state: node.state, current: node.current === true, depth })
  for (const child of node.children ?? []) flattenTree(child, depth + 1, out)
}

const RUN_MINUTES = (minutes: number): string => `${minutes} 分钟`

/**
 * worker 检查器快照 → 视图(W-1 四要素投影)。成本条百分比取整(原型 03:
 * 3.42/8.00 → 43%),上下文条带压缩阈值标线(80%,28 号分层压缩)。
 */
export function workerInspectorView(snapshot: WorkerInspectorSnapshot): WorkerInspectorView {
  const tree: WorkerTreeLeaf[] = []
  flattenTree(snapshot.tree, 0, tree)
  const costPercent = Math.round((snapshot.cost.spentYuan / snapshot.cost.budgetYuan) * 100)
  return {
    head: {
      id: snapshot.workerId,
      ticketId: snapshot.ticketId,
      runMinutes: RUN_MINUTES(snapshot.runMinutes),
      presetNote: snapshot.presetNote,
      slots: `${snapshot.slotsUsed}/${snapshot.slotsTotal}`,
      domainPack: snapshot.domainPack,
    },
    tree,
    treeNote: `subagent 借 worker 权限、只向 worker 回复；输出落 .ticket/${snapshot.ticketId}/ 不落消息（27 §2.1 纪律 3）。`,
    jobsRunning: snapshot.jobs.filter(job => job.running).map(job => ({ id: job.id, name: job.name, meta: job.meta })),
    jobsDone: snapshot.jobs.filter(job => !job.running).map(job => ({ id: job.id, name: job.name, meta: job.meta })),
    toolRows: snapshot.toolHistory,
    contextMeter: {
      label: `上下文占用 ${snapshot.context.percent}%`,
      percent: snapshot.context.percent,
      thresholdPercent: snapshot.context.thresholdPercent,
      note: snapshot.context.note,
      aria: `上下文占用 ${snapshot.context.percent}%，压缩阈值 ${snapshot.context.thresholdPercent}%`,
    },
    costMeter: {
      label: `成本累计 ¥${snapshot.cost.spentYuan.toFixed(2)} / 预算 ¥${snapshot.cost.budgetYuan.toFixed(2)}`,
      percent: costPercent,
      thresholdPercent: undefined,
      note: `tokens ${snapshot.cost.tokensNote} · maxTurns ${snapshot.cost.maxTurns} · ${snapshot.cost.note}`,
      aria: `成本 ${snapshot.cost.spentYuan} 元，占预算 ${snapshot.cost.budgetYuan} 元的 ${costPercent}%`,
    },
  }
}

/** 树最大深度(W-2 断言面:27 号三层结构,depth ≤ 2;超出即数据面违约)。 */
export function workerTreeDepth(node: WorkerTreeNode): number {
  const childDepths = (node.children ?? []).map(workerTreeDepth)
  return 1 + (childDepths.length === 0 ? 0 : Math.max(...childDepths))
}
