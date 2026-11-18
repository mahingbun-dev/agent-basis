/**
 * @eterna/workbench Host 半边装配出口(38 号 §4)。
 *
 * M4 实接(T15/G2-D11):实时流枢纽(stream/live-hub.ts)装配为 provide 服务
 * (WORKBENCH_STREAM_SERVICE_ID,注册表 + 唯一 ID,可配逆)——消费 ctx.tasks 的
 * DomainEvents 多播与只读快照读数(数据面经 tasks 提供,24a 裁决 dwfq-843ec077-1
 * 口径),投影快照+增量。**SSE 端点路由归 access 守卫面登记**(38 号 O-5/G2-C4:
 * packages/access/src/tenant.ts WORKBENCH_STREAM_ENDPOINT + src/stream.ts 桥),
 * 本包不触碰任何 Web 注册面(tenant-scan route-escapes-gate 铁律 T2)。
 *
 * 本出口同时把 fixture 数据面(mock 时间线/dev 服务)、实时流枢纽、纯投影层与
 * SSE 组装件暴露给 dev 工具与测试;浏览器半边见 ./client(lib/client.js,经
 * dsh.client 声明装载)。
 */
import type { Context } from '@deepseek-ai/cordis'
import { createLiveWorkbenchHub, WORKBENCH_STREAM_SERVICE_ID, type TasksWorldView } from './stream/live-hub.ts'

export { ServerSentEventDecoder, readServerSentEvents, type ServerSentEvent } from './stream/sse-decoder.ts'
export { EventBatcher } from './stream/batcher.ts'
// ── 实时流(T15 真源;路由经 access 登记)────────────────────────────
export {
  BATCH_WINDOW_MS, LIVE_EVENT_NAME, WORKBENCH_STREAM_SERVICE_ID, createLiveWorkbenchHub, liveFrame,
  type TasksWorldView, type WorkbenchLiveHub, type WorkbenchLiveHubOptions,
} from './stream/live-hub.ts'
export {
  conflictSection, evalSection, flowSection, pushRing, traceLogsSection, workerSection,
  type FlowRingItem, type LiveSectionsInputs, type LiveSectionsTasks,
} from './project/live-sections.ts'
export { readAuditFiles, readEvalRuns, type AuditDayFile, type EvalRunReport } from './project/trace-files.ts'
// ── fixture 数据面(M3 mock 时间线与 dev 服务;G2-D11:仅测试/开发工具用,客户端不入)──
export {
  DEFAULT_MOCK_ENDPOINT, MOCK_EVENT_NAME, createMockSseServer, sseFrame,
  type MockSseServer, type MockSseServerOptions,
} from './stream/dev-server.ts'
export { MOCK_PRINCIPAL, initialMockSnapshot, mockTimeline, type MockIncrement } from './stream/mock-source.ts'
export { applyWorkbenchEvent } from './project/state.ts'
export {
  KANBAN_COLUMN_META, ROLE_CHIPS, conflictCards, kanbanBoard, stageCounts, clampTicketsByRole,
  type ConflictCard, type KanbanBoard, type KanbanColumnMeta, type StageFilter,
} from './project/kanban.ts'
export {
  LOG_TICKET_CHIPS, WORKER_SESSION_HEADING, defaultLogsFilter, filterLogs, matchesQuery,
  type LogGroups, type LogsFilter,
} from './project/trace-view.ts'
export { piiFilter, redactParagraphs, redactSegment, redactedFull, type RedactedSegments } from './project/pii-view.ts'
export {
  decayChart, evalMetricCards, trendChart,
  type ChartGridLine, type ChartPoint, type LineChartView, type MetricCard,
} from './project/eval-view.ts'
export {
  FLOW_EDGES, FLOW_LEGEND, FLOW_NODE_LAYOUT, FLOW_NODE_ORDER, FLOW_NODE_STATE_LABEL,
  FLOW_NODE_TITLE, FLOW_VIEWBOX, compactDuration, flowGraphView, flowNodeCenter,
  hitTestFlowNode, moveRovingIndex, stuckTickets,
  type FlowBubbleView, type FlowEdgeView, type FlowGraphView, type FlowLegendItem,
  type FlowNodeLayout, type FlowNodeView,
} from './project/flow-graph.ts'
export {
  replayNarration, replayPointsText, replayTrack, sourceToNode,
  type ReplayStep, type ReplayTrack,
} from './project/replay.ts'
export {
  workerInspectorView, workerTreeDepth,
  type MeterView, type WorkerHeadMeta, type WorkerInspectorView, type WorkerTreeLeaf,
} from './project/worker-view.ts'
export {
  SIDEBAR_GROUP_LABELS, sidebarGroups, sidebarRowLine, branchesFor, activeBranchOf,
  branchChipLabel, branchStateTone, timelineFor, type SidebarGroup,
} from './project/task-sidebar.ts'
export {
  ATTENTION_STAGE_META, attentionStageMeta, formatCountdown, formatWaited, buildAttentionCard,
  type AttentionCardInput,
} from './project/attention.ts'
export type {
  AssignmentBranch, AttentionCardSnapshot, ConflictMetrics, EvalSnapshot, FlowLiveState,
  FlowNodeKey, FlowNodeLiveState, FlowNodeTone, KanbanColumn, LogSegment, LogStatus,
  SidebarSession, StatusTone, TicketTimeline, TimelineBlock, WorkbenchLogEntry, WorkbenchRole,
  WorkbenchSnapshot, WorkbenchStreamEvent, WorkbenchTicket, WorkerInspectorSnapshot,
  WorkerJobItem, WorkerToolRow, WorkerTreeNode,
} from './types.ts'

/**
 * workbench 插件体(T15):装配实时流枢纽并 provide 服务(access 经反射键消费;
 * 官方 seam:ctx 属性必须经 provide 声明后才能赋值,governance/tasks 插件同款;
 * provide disposer 运行时 async,卸载路径 fire-and-forget 不 await 防阻塞宿主)。
 * ctx.tasks 惰性解析(挂载序不定,首连时再取;缺席即 hub.ready()=false,
 * access 端点 fail-closed 503),本插件不解析不持有 webServer 等路由面服务。
 */
const workbenchPlugin = {
  apply(ctx: Context): () => void {
    const hub = createLiveWorkbenchHub({
      tasks: (): TasksWorldView | undefined => {
        // 宿主服务读取(2026-11-18 修正):cordis 过滤上下文对未 inject 属性的直接读取
        // 会抛「cannot get property without inject」(audit.ts:22 同款陷阱)——直读
        // (ctx as any).tasks 被 resolveTasks 的 catch 吞掉 → ready() 恒 false → 端点
        // 503 循环。改用受认可的 ctx.reflect.get(name, false)(access/audit 同款)。
        try {
          const reflect = (ctx as unknown as {
            readonly reflect?: { readonly get: (name: string, fallback: unknown) => unknown }
          }).reflect
          const tasks = reflect?.get('tasks', undefined)
          return tasks === undefined || tasks === null ? undefined : tasks as TasksWorldView
        } catch {
          return undefined
        }
      },
    })
    const disposeProvide = (ctx as unknown as {
      provide?: (name: string, value: unknown) => () => void
    }).provide?.(WORKBENCH_STREAM_SERVICE_ID, hub)
    return () => {
      hub.dispose()
      disposeProvide?.()
    }
  },
}

export default workbenchPlugin
