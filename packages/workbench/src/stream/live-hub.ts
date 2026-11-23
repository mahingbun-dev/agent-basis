/**
 * 工作台实时流枢纽(38 号 T15/G2-D11 M4 实接;30 号 §3 服务端行「订阅面 = Engine
 * DomainEvents」、快照行「连接先推全量快照,再推增量;断线以 Last-Event-ID 续」、
 * 频控行「200ms 合批」)。
 *
 * 职责边界(T15 传输与装配半边):本枢纽消费 ctx.tasks 的 DomainEvents 多播与
 * 只读读数(packages/tasks/src/plugin.ts subscribe/snapshot/stats/query 面,数据面
 * 经 tasks 提供——24a 裁决 dwfq-843ec077-1 口径),按事件推进事件环
 * (live-sections pushRing,F-3「边即 DomainEvents」)并**整节重投影**(引擎为唯一
 * 真值源:tickets 卡面 = engine-view ticketCardsOf,信息流/冲突/评测/检查器/日志 =
 * live-sections 各节),变更节发整节替换型增量(tickets-updated 等,幂等,引用
 * 不变可跳过重绘);**传输语义** = seq 分配、增量环形缓冲、Last-Event-ID 续传判定、
 * 逐连接 200ms 合批、SSE 帧文本。**路由面归 access 登记**(38 号 O-5/G2-C4,
 * packages/access/src/tenant.ts WORKBENCH_STREAM_ENDPOINT):本包不触碰任何 Web
 * 注册面(tenant-scan route-escapes-gate 铁律 T2),枢纽以 provide 服务
 * (WORKBENCH_STREAM_SERVICE_ID)供 access 经反射结构消费。
 *
 * 接线语义(供 access SSE 桥消费的时序契约):
 * ① subscribe(onFrame) 先注册(此后到达的增量进该连接的 200ms 合批窗);
 * ② snapshotFrame() 或 replayFrames(lastEventId) 随后同步写出(首帧快照/续传补发)——
 *    两步之间无 await,增量不会在「订阅后、快照前」丢失(快照 seq 晚于其载荷时,
 *    客户端按 seq 去重,F-14 幂等);
 * ③ 断线由调用方退订(subscribe 返回的闭包)并停写。
 */
import { EventBatcher } from './batcher.ts'
import { applyWorkbenchEvent } from '../project/state.ts'
import { ticketCardsOf } from '../project/engine-view.ts'
import {
  conflictSection, evalSection, flowSection, pushRing, traceLogsSection, workerSection,
  type FlowRingItem, type LiveSectionsInputs, type LiveSectionsTasks, type WorkbenchBudgetUsage,
} from '../project/live-sections.ts'
import { readAuditFiles, readEvalRuns, type AuditDayFile, type EvalRunReport } from '../project/trace-files.ts'
import { ticketStage } from '@eterna/tasks'
import type { DomainEvent, Thread, Ticket } from '@eterna/tasks'
import type {
  AssignmentBranch, WorkbenchIncrement, WorkbenchSnapshot, WorkbenchStreamEvent,
} from '../types.ts'

/** provide 服务 id(access 经 reflect 解析的反射键;workbench Host 半边装配)。 */
export const WORKBENCH_STREAM_SERVICE_ID = 'eternaWorkbenchStream'

/** live 流 SSE event 字段名(mock fixture 用 workbench-mock,不共用;O-1/O-2 命名纪律)。 */
export const LIVE_EVENT_NAME = 'workbench'

/** 增量环形缓冲上限(断线续传回看窗口;dev-server fixture 同量)。 */
const BUFFER_LIMIT = 100

/** 合批窗口缺省(30 号 §3 拍板值;服务端频控,非客户端节流)。 */
export const BATCH_WINDOW_MS = 200

/** 自刷新周期缺省(24a 拍板 C6「活跃工单清单 pass 周期刷新」;28 号 §8-3 pass 周期同源)。 */
export const REFRESH_INTERVAL_MS = 2000

/**
 * ctx.tasks 消费面(结构子集 = TasksWorld 的读数面:realm/subscribe/snapshot/stats/
 * query;真实实例由 eterna-tasks bundle provide——service face 不暴露 store 写面,
 * 查询走 SELECT-only 的 query 面,写路径唯一经 Engine 事务)。
 */
export interface TasksWorldView {
  readonly realm: string
  subscribe(listener: (event: DomainEvent) => void): () => void
  snapshot(): { readonly realm: string; readonly tickets: readonly Ticket[]; readonly threads: readonly Thread[] }
  stats(): {
    readonly tickets: { readonly open: number; readonly active: number; readonly total: number }
    readonly threads: { readonly active: number; readonly subscribed: number }
    readonly triggers: { readonly total: number }
    readonly decisions: { readonly total: number }
    readonly outbox: { readonly pending: number; readonly dropped: number }
    readonly executor: { readonly maxWorkers: number; readonly usedSlots: number }
    /** orchestrator 主会话 id(「主会话」入口寻址面;未引导时 undefined)。 */
    readonly masterId: string | undefined
  }
  query(sql: string, ...parameters: unknown[]): unknown[]
}

/** SSE 帧文本(id/event/data 三字段 + 空行派发;data = 流事件 JSON)。 */
export function liveFrame(event: WorkbenchStreamEvent): string {
  return `id: ${event.seq}\nevent: ${LIVE_EVENT_NAME}\ndata: ${JSON.stringify(event)}\n\n`
}

/** access SSE 桥消费的枢纽服务面(结构面;载荷语义归投影层,桥零领域知识)。 */
export interface WorkbenchLiveHub {
  /** 服务 id(WORKBENCH_STREAM_SERVICE_ID;注册表形态标记)。 */
  readonly id: typeof WORKBENCH_STREAM_SERVICE_ID
  /** 数据源(ctx.tasks)是否已接上;false 时端点 fail-closed(access 回 503)。 */
  ready(): boolean
  /** 首帧:当前全量快照(分配新 seq;★先 subscribe 后调用——见模块注时序契约)。 */
  snapshotFrame(): string
  /**
   * 断线续传(30 号 §3):Last-Event-ID 之后无缓冲缺口 → 返回 id 更大的缓冲帧
   * (可为空数组 = 已追平);有缺口/从未连接 → undefined(调用方改推快照)。
   */
  replayFrames(lastEventId: number): readonly string[] | undefined
  /** 订阅后续增量帧(200ms 合批后逐帧回调);返回退订闭包。 */
  subscribe(onFrame: (frame: string) => void): () => void
  /** 落盘文件面(audit/evals/drift)重读并重投影(外部落盘后调用;装配时自动首载)。 */
  refresh(): Promise<void>
  /** 关停:退订数据源、清空订阅与缓冲(dispose 后 ready() 恒 false)。 */
  dispose(): void
}

export interface WorkbenchLiveHubOptions {
  /**
   * ctx.tasks 惰性解析(workbench 插件 apply 时点 tasks 可能尚未装载,挂载序不定;
   * 首连时再取,undefined = 未就绪,access 端点 503 fail-closed)。
   */
  readonly tasks: () => TasksWorldView | undefined
  /** audit NDJSON 目录(日志 trace 与 worker 工具史;trace-files.readAuditFiles;缺省不读)。 */
  readonly audit?: { readonly dir: string; readonly filePrefix?: string }
  /** dsh-evals 结果目录(评测监控趋势;trace-files.readEvalRuns;缺省不读)。 */
  readonly evals?: { readonly outDir: string }
  /** observe drift 信号读数(SignalStore kind='drift' 查询;缺省 0 条)。 */
  readonly driftSignals?: () => { readonly count: number; readonly latestAt?: number }
  /** R1 预算读数(governance BudgetGuard.usage;装配后注入)。 */
  readonly budgetUsage?: () => WorkbenchBudgetUsage | undefined
  /** 时钟注入(等待时长/快照投影;缺省 Date.now)。 */
  readonly now?: () => number
  /** 合批窗口 ms(缺省 BATCH_WINDOW_MS=200;测试可调)。 */
  readonly batchWindowMs?: number
  /**
   * 自刷新周期 ms(缺省 REFRESH_INTERVAL_MS=2000,24a 拍板 C6「活跃工单清单
   * pass 周期刷新」的周期口径):报告六态中 progress/blocked/failed/waiting 不发
   * DomainEvent(tasks DomainEvents 无 report 事件),看板阶段迁移/检查器时长/文件
   * 面变化靠本周期重投影追平;0 = 关闭(测试确定性)。
   */
  readonly refreshMs?: number
}

/** TasksWorld 读数面 → live-sections 查询面(LiveSectionsTasks:SELECT-only db + 槽位真读数)。 */
function sectionsTasksOf(tasks: TasksWorldView): LiveSectionsTasks {
  return {
    db: { prepare: (sql: string) => ({ all: (...parameters: unknown[]) => tasks.query(sql, ...parameters) }) },
    // ★占槽真读数(2026-11-23 线上修复):DshExecutor 的 WorkerSlots 计数经 stats() 暴露;
    // 投影层不再按工单领域态推算在跑数(陈旧口径见 live-sections latestRunning 注)。
    usedSlots: tasks.stats().executor.usedSlots,
    // 插队计数挂在 DshExecutor(A22 替换点接线后在册;stub 时缺省——live-sections 如实标注)
  }
}

/** 续传判定:Last-Event-ID 之后无缓冲缺口(最旧缓冲帧紧接其后,或已追平)。 */
function canReplayFrom(buffer: readonly WorkbenchStreamEvent[], lastEventId: number, seq: number): boolean {
  if (lastEventId >= seq) return true
  const oldest = buffer[0]
  return oldest !== undefined && oldest.seq <= lastEventId + 1
}

/** 节值比较(整节 diff;节均为纯数据 JSON,序列化比较成本可忽略——G-11 引用不变跳过重绘的装配侧口径)。 */
function differs(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) !== JSON.stringify(right)
}

/**
 * Assignment 分支投影(T6;退回/重试 = 同工单新分支,24 号 §7.2、27 号 §1.2;仅开放工单)。
 *
 * 运行时口径(2026-11-23 线上修复,同 `live-sections.latestRunning`):`working` 徽标只给
 * **真的在跑**的分支。Assignment 的 `running` 是领域态(pending→running→ended 只由
 * endAssignment/工单 end 迁移),worker 报 `waiting` 后回合早已结束,此前一律投影成
 * `working` 让停泊工单在侧栏看着还在跑(生产实证「运行 2843 分钟」同源)。
 * 判定复用 `ticketStage`:只有该工单最新分支且阶段为 working(非 queued)才是 working;
 * waiting 报告的停泊分支标 `idle`,`pending` 排队的标 `queued`。
 */
function branchesOf(tickets: readonly Ticket[]): AssignmentBranch[] {
  const branches: AssignmentBranch[] = []
  for (const ticket of tickets) {
    if (ticket.ended !== undefined) continue
    const stage = ticketStage(ticket)
    const lastIndex = ticket.assignments.length - 1
    ticket.assignments.forEach((assignment, index) => {
      const report = assignment.report
      const latest = index === lastIndex
      const running = latest && stage.stage === 'working' && stage.action !== 'queued'
      const queued = latest && stage.stage === 'working' && stage.action === 'queued'
      const state: AssignmentBranch['state'] = report?.state === 'ready'
        ? 'ready'
        : report?.state === 'failed'
          ? 'failed'
          : running ? 'working' : 'idle'
      const note = report?.summary
        ?? (running ? '运行中'
          : queued ? '排队等待 worker 槽位'
            : latest ? '空闲 · 回合已结束,等后续消息'
              : assignment.state === 'pending' ? '排队等待 worker 槽位' : assignment.endedReason ?? '—')
      branches.push({ ticketId: ticket.id, seq: index + 1, state, note, active: latest })
    })
  }
  return branches
}

/**
 * 创建实时流枢纽:数据源首连时才解析与装配(挂载序不定);每个 DomainEvent →
 * 事件环推进 + 引擎面整节重投影 + 变更节发增量;对外暴露 SSE 时序契约面
 * (供 access 桥)与文件面 refresh。
 */
export function createLiveWorkbenchHub(options: WorkbenchLiveHubOptions): WorkbenchLiveHub {
  const nowMs = options.now ?? ((): number => Date.now())
  const batchWindowMs = options.batchWindowMs ?? BATCH_WINDOW_MS
  const refreshMs = options.refreshMs ?? REFRESH_INTERVAL_MS
  let detached: (() => void) | undefined
  let disposed = false
  let seq = 0
  let snapshot: WorkbenchSnapshot | undefined
  let ring: readonly FlowRingItem[] = []
  let auditFiles: readonly AuditDayFile[] = []
  let evalRuns: readonly EvalRunReport[] = []
  const buffer: WorkbenchStreamEvent[] = []
  const listeners = new Set<{ readonly onFrame: (frame: string) => void; readonly batcher: EventBatcher<WorkbenchStreamEvent> }>()
  // C6 pass 周期自刷新(24a 拍板):报告驱动的阶段迁移与落盘面变化经本周期追平;
  // 装配(ensureLive)后启动,dispose 清除;定时器 unref,不阻宿主退出。
  let refreshTimer: ReturnType<typeof setInterval> | undefined

  const resolveTasks = (): TasksWorldView | undefined => {
    if (disposed) return undefined
    try {
      return options.tasks()
    } catch {
      return undefined // 宿主服务面缺席(cordis 过滤上下文 get trap 等)——fail-closed
    }
  }

  const emit = (increment: WorkbenchIncrement): void => {
    seq += 1
    const full = { ...increment, seq } as WorkbenchStreamEvent
    buffer.push(full)
    if (buffer.length > BUFFER_LIMIT) buffer.shift()
    const current = snapshot
    // emit 只在快照已装配后发生(ensureLive 先于 subscribe/reproject);守卫仅为判空纪律
    if (current !== undefined) snapshot = applyWorkbenchEvent(current, full)
    for (const listener of listeners) listener.batcher.push(full)
  }

  const allocate = (): number => {
    seq += 1
    return seq
  }

  /** 文件面输入(live-sections LiveSectionsInputs 的可选项;快照投影与节投影共用)。 */
  const sectionInputs = (): LiveSectionsInputs => {
    const budgetUsage = options.budgetUsage?.()
    const tasks = resolveTasks()
    return {
      ...(tasks !== undefined ? { tasks: sectionsTasksOf(tasks) } : {}),
      ...(budgetUsage !== undefined ? { budgetUsage } : {}),
      ...(auditFiles.length > 0 ? { auditFiles } : {}),
      ...(evalRuns.length > 0 ? { evalRuns } : {}),
      drift: options.driftSignals?.() ?? { count: 0 },
      ring,
    }
  }

  /** 引擎面整节重投影(同步;快照全量)。 */
  const projectFull = (): WorkbenchSnapshot => {
    const tasks = resolveTasks()
    if (tasks === undefined) throw new Error('任务内核服务未就绪(ctx.tasks 缺席)')
    const view = tasks.snapshot()
    const stats = tasks.stats()
    const workerSlots = stats.executor.maxWorkers
    return {
      tickets: ticketCardsOf(view.tickets, nowMs()),
      conflict: conflictSection(sectionInputs()),
      logs: traceLogsSection({ tickets: view.tickets, ...(auditFiles.length > 0 ? { auditFiles } : {}) }),
      eval: evalSection(sectionInputs(), nowMs()),
      flow: flowSection(sectionInputs(), view.tickets, workerSlots, view.threads.filter(thread => thread.subscriptions.length > 0).length),
      worker: workerSection(sectionInputs(), view.tickets, workerSlots, nowMs()),
      sessions: [],
      assignments: branchesOf(view.tickets),
      timelines: [],
      // 「主会话」显式入口(2026-11-19):主会话未引导 stats().masterId 为 undefined,
      // 快照不带键(客户端入口不渲染)。
      ...(stats.masterId === undefined ? {} : { masterSessionId: stats.masterId }),
    }
  }

  /**
   * 整节 diff → 变更节发替换型增量并应用进当前快照(幂等;不变化的节保持引用,
   * 客户端可跳过重绘)。assignments 无对应增量词汇,静默进快照(与投影半边口径一致)。
   */
  const reproject = (): void => {
    const previous = snapshot
    if (previous === undefined) return
    const next = projectFull()
    let merged = previous
    type SectionKey = 'tickets' | 'flow' | 'conflict' | 'worker' | 'eval' | 'logs' | 'assignments'
    const withSection = (key: SectionKey): void => {
      if (!differs(previous[key], next[key])) return
      merged = { ...merged, [key]: next[key] }
      if (key === 'tickets') emit({ kind: 'tickets-updated', tickets: next.tickets })
      if (key === 'flow') emit({ kind: 'flow-updated', flow: next.flow })
      if (key === 'conflict') emit({ kind: 'conflict-updated', conflict: next.conflict })
      if (key === 'worker') emit({ kind: 'worker-updated', worker: next.worker })
      if (key === 'eval') emit({ kind: 'eval-updated', eval: next.eval })
      if (key === 'logs') {
        // 日志节:audit 追加语义——按 id 增量补发(旧工单的新 audit 行会插在序列
        // 中段,行数差切片会丢行/错位;id 集合差分不丢不重)
        const known = new Set(previous.logs.map(entry => entry.id))
        for (const entry of next.logs) {
          if (!known.has(entry.id)) emit({ kind: 'log-appended', entry })
        }
      }
    }
    withSection('tickets')
    withSection('flow')
    withSection('conflict')
    withSection('worker')
    withSection('eval')
    withSection('logs')
    withSection('assignments')
    snapshot = merged
  }

  /** 领域事件入口:事件环推进(F-3)+ 整节重投影 + 变更节发增量。 */
  const onDomainEvent = (event: DomainEvent): void => {
    if (disposed) return
    ring = pushRing(ring, event)
    reproject()
  }

  /** 落盘文件面(audit/evals/drift)重读 → 变更节发增量(目录缺失=无记录,不抛错)。 */
  const refresh = async (): Promise<void> => {
    if (disposed) return
    if (options.audit !== undefined) auditFiles = await readAuditFiles(options.audit.dir, options.audit.filePrefix ?? 'audit-')
    if (options.evals !== undefined) evalRuns = await readEvalRuns(options.evals.outDir)
    reproject()
  }

  return {
    id: WORKBENCH_STREAM_SERVICE_ID,
    ready: (): boolean => !disposed && resolveTasks() !== undefined,
    snapshotFrame: (): string => {
      const current = ensureLive()
      const frameSeq = allocate()
      return liveFrame({ kind: 'snapshot', seq: frameSeq, snapshot: current })
    },
    replayFrames: (lastEventId: number): readonly string[] | undefined => {
      ensureLive()
      if (!canReplayFrom(buffer, lastEventId, seq)) return undefined
      return buffer.filter(event => event.seq > lastEventId).map(liveFrame)
    },
    subscribe: (onFrame: (frame: string) => void): (() => void) => {
      ensureLive()
      const listener = { onFrame, batcher: new EventBatcher<WorkbenchStreamEvent>((batch) => {
        for (const event of batch) onFrame(liveFrame(event))
      }, batchWindowMs) }
      listeners.add(listener)
      return () => {
        listener.batcher.dispose()
        listeners.delete(listener)
      }
    },
    refresh: () => refresh(),
    dispose: (): void => {
      if (disposed) return
      disposed = true
      detached?.()
      detached = undefined
      if (refreshTimer !== undefined) clearInterval(refreshTimer)
      refreshTimer = undefined
      for (const listener of listeners) listener.batcher.dispose()
      listeners.clear()
      buffer.length = 0
      snapshot = undefined
      ring = []
      auditFiles = []
      evalRuns = []
    },
  }

  // ── 下方为闭包后置声明(hub 面先立,装配逻辑居后;JS 函数声明提升保证可用)──

  /**
   * 首连装配(幂等):解析 ctx.tasks → 接上 DomainEvents 多播 + 文件面首载
   * (异步,失败不阻服务)→ 首次全量投影。
   */
  function ensureLive(): WorkbenchSnapshot {
    if (snapshot !== undefined) return snapshot
    const tasks = resolveTasks()
    if (tasks === undefined) throw new Error('任务内核服务未就绪(ctx.tasks 缺席)')
    detached = tasks.subscribe(onDomainEvent)
    // 文件面(audit/evals/drift)首载:异步拉取,变更节经重投影推增量;
    // 失败不阻快照服务(引擎面节照常服务)。
    void refresh().catch(() => { /* 落盘面缺席/不可读:引擎面节照常服务 */ })
    if (refreshMs > 0 && refreshTimer === undefined) {
      refreshTimer = setInterval(() => { void refresh().catch(() => { /* 落盘面波动不阻服务 */ }) }, refreshMs)
      refreshTimer.unref()
    }
    snapshot = projectFull()
    return snapshot
  }
}
