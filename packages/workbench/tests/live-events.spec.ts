/**
 * G2-D11 门禁(38 号 T15 M4 实接;33 号 G2-D11「真实事件驱动视图更新 E2E——
 * G3-M4 ② 的验收载体」):tasks 引擎(真实装配:store→effects→outbox→engine
 * 全链 + 可控 stub assessor/executor,★A19/A22 替换点)的 DomainEvents 经
 * live hub(数据面经 tasks 提供)产 SSE 帧 → access 桥同款装载时序的最小 HTTP
 * 服务 → 客户端 live 控制器消费 → 视图投影(看板)随真实领域事件演进。
 *
 * 逐项断言:连接先快照后增量(30 号 §3)、真实事件触发看板重投影(tickets-updated
 * 整节,引擎为唯一真值源)、工单结束移出看板(ticket.ended)、DomainEvents 全类型
 * 留痕(log-appended trace)、200ms 服务端合批、Last-Event-ID 续传与缺口重推快照、
 * 真源端点常量 = access 登记路径(G2-C4)。mock 流仅 fixture(mock-stream.spec),
 * 本文件零 mock 数据(G2-D11:不留 mock 残留)。
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createTasks, type DomainEvent, type SourceScope, type TasksRuntime, type Trigger } from '@eterna/tasks'
import { createLiveWorkbenchHub, type TasksWorldView } from '../src/stream/live-hub.ts'
import { createLiveStreamController, DEFAULT_LIVE_STREAM_PATH, type WorkbenchStreamState } from '../src/client/live-stream.ts'
import type { WorkbenchStreamEvent } from '../src/types.ts'
import { kanbanBoard } from '../src/project/kanban.ts'
import { readAuditFiles, traceEntriesForTicket } from '../src/project/trace-files.ts'
import { ticketTraceEntries } from '../src/project/ticket-trace.ts'
import { replayNarration, replayTrackFromEntries } from '../src/project/replay.ts'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'workbench-live-events-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

/** test Source 监听范围(与 tasks fixtures/host.ts 同款口径的本地副本)。 */
const SOURCE = 'test'
const MEMBER = 'u-alice'
const testScope: SourceScope = {
  scope: ({ source }: { source: string }) =>
    source === SOURCE ? { listened: true, observed: true, row: 'main' } : { listened: false, reason: 'not_listened' },
}

/** 真实装配 tasks 运行时(长 pass 周期,手动 pass 驱动;stub assessor/executor)。 */
const bootTasks = (): TasksRuntime =>
  createTasks({ tenantRoot: root, realm: 'alice', passIntervalMs: 3_600_000, scope: testScope })

/** 人消息触发器(fixtures/host.ts humanTrigger 同款本地副本)。 */
const humanTrigger = (id: string, text: string): Trigger => ({
  id, source: SOURCE, threads: [{ source: SOURCE, id: `thread-${id}` }], actor: { source: SOURCE, id: MEMBER },
  human: true, addressed: 'mention', at: new Date(Date.parse('2026-09-09T00:00:00Z') + Number(id) * 1000).toISOString(),
  text, meta: {},
})

const allowMember = (runtime: TasksRuntime): void => {
  runtime.store.saveSettings({ policy: { sources: { [SOURCE]: { allowed: [{ id: MEMBER, name: 'Alice' }] } } } })
}

/** 开一张工单(触发→Eval→显式 accept,R3 四要素齐备;plugin-boot.spec 同款)。 */
const openTicket = (runtime: TasksRuntime, triggerId: string): string => {
  allowMember(runtime)
  const trigger = humanTrigger(triggerId, '@bot 做点事')
  expect(runtime.engine.receive(trigger)).toBe('stored')
  runtime.pass()
  // A19 后 assessor 为 MasterAssessor:候选经 Engine 的 candidate 面读取(tasks domain-events.spec 同款)
  const candidate = runtime.engine.candidate(trigger.id)
  expect(candidate).toBeDefined()
  if (candidate === undefined) throw new Error('候选缺失')
  runtime.engine.candidateDelivered(candidate.evalId)
  return runtime.engine.decide(trigger.id, {
    kind: 'accept',
    title: '做点事',
    scope: 'Do the work.',
    reason: 'explicit request',
    delegation: { objective: 'Do it.', outputFormat: 'A summary.', toolGuidance: 'Use read tools.', taskBoundaries: 'Only the request.' },
  }).ticketId!
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

/** 解析 SSE 帧的 data 行(测试面;逐帧 JSON)。 */
const parseFrames = (frames: readonly string[]): WorkbenchStreamEvent[] =>
  frames.flatMap((frame) => {
    const data = frame.split('\n').find(line => line.startsWith('data: '))
    return data === undefined ? [] : [JSON.parse(data.slice('data: '.length)) as WorkbenchStreamEvent]
  })

/** access 桥同款装载时序的最小 SSE 服务(守卫在 access 包自测;此处只验传输契约)。 */
const serveHub = (hub: ReturnType<typeof createLiveWorkbenchHub>): Promise<{ server: Server; url: string }> =>
  new Promise((resolve) => {
    const server = createServer((req, res) => {
      const lastEventId = req.headers['last-event-id']
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' })
      const unsubscribe = hub.subscribe((frame) => { res.write(frame) })
      const replay = lastEventId !== undefined ? hub.replayFrames(Number(lastEventId)) : undefined
      for (const frame of replay ?? [hub.snapshotFrame()]) res.write(frame)
      req.on('close', () => { unsubscribe(); res.end() })
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({ server, url: `http://127.0.0.1:${port}${DEFAULT_LIVE_STREAM_PATH}` })
    })
  })

/** 轮询直至断言通过(真实定时器面;超时即失败并抛最后一次断言)。 */
const waitFor = async (assert: () => void, timeoutMs = 3_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (true) {
    try {
      assert()
      return
    } catch (error) {
      if (Date.now() > deadline) throw error
      await sleep(25)
    }
  }
}

it('真实事件驱动视图更新(引擎→hub→SSE→live 控制器→看板投影)', async () => {
  const runtime = bootTasks()
  const hub = createLiveWorkbenchHub({ tasks: (): TasksWorldView | undefined => runtime, batchWindowMs: 30 })
  const { server, url } = await serveHub(hub)
  const controller = createLiveStreamController(url)
  const states: WorkbenchStreamState[] = []
  controller.subscribe(() => { states.push(controller.getSnapshot()) })

  // 连接先快照(空看板):真实装配的引擎当前无工单
  await waitFor(() => {
    const state = controller.getSnapshot()
    expect(state.status).toBe('ready')
    if (state.status === 'ready') expect(state.snapshot.tickets).toHaveLength(0)
  })

  // 真实领域事件:触发→Eval→accept 建票(stub executor 停 pending → working/queued 列)
  const ticketId = openTicket(runtime, '1')
  await waitFor(() => {
    expect(controller.getSnapshot().status).toBe('ready')
    const snapshot = (controller.getSnapshot() as Extract<WorkbenchStreamState, { status: 'ready' }>).snapshot
    expect(snapshot.tickets.map(ticket => ticket.id)).toContain(ticketId)
    // 视图投影随真实事件演进:K-1 看板分列,工单落「排队中」(working/queued)
    const board = kanbanBoard(snapshot.tickets, 'admin', 'principal', 'all')
    expect(board.columns.find(column => column.meta.key === 'queued')!.tickets.map(ticket => ticket.id)).toContain(ticketId)
    // 真实事件驱动信息流(F-3「边即 DomainEvents」):事件环推进 → 节点「最近事件」行非空
    expect(snapshot.flow.nodes.some(node => node.events.length > 0)).toBe(true)
  })

  // 真实事件:人 stop 工单(ticket.ended)→ 工单移出看板(tickets-updated 整节重投影)
  runtime.engine.stopTicket(ticketId, '不用做了')
  await waitFor(() => {
    const latest = (controller.getSnapshot() as Extract<WorkbenchStreamState, { status: 'ready' }>).snapshot
    expect(latest.tickets.map(ticket => ticket.id)).not.toContain(ticketId)
  })

  controller.stop()
  hub.dispose()
  runtime.dispose()
  await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
})

it('断线续传:Last-Event-ID 无缺口补增量、有缺口重推快照(30 号 §3)', async () => {
  const runtime = bootTasks()
  const hub = createLiveWorkbenchHub({ tasks: (): TasksWorldView | undefined => runtime, batchWindowMs: 30 })
  const received: WorkbenchStreamEvent[] = []
  const unsubscribe = hub.subscribe((frame) => { received.push(...parseFrames([frame])) })
  const ticketId = openTicket(runtime, '1')

  await waitFor(() => { expect(received.length).toBeGreaterThan(0) })
  const lastSeq = received.at(-1)!.seq
  // 无缺口:已追平(空数组 = 没有更晚帧)与部分补发皆有定义
  expect(hub.replayFrames(lastSeq)).toEqual([])
  const partial = hub.replayFrames(1)
  expect(partial).toBeDefined()
  expect(parseFrames(partial!).every(event => event.seq > 1)).toBe(true)
  // 有缺口(超回看窗):undefined → 调用方改推快照(快照已含错过增量,F-14)
  expect(hub.replayFrames(Number.MAX_SAFE_INTEGER - 1)).toEqual([])

  // 快照帧:引擎实况整节(工单已入看板投影)
  const snapshotFrame = parseFrames([hub.snapshotFrame()])[0]
  expect(snapshotFrame?.kind).toBe('snapshot')
  if (snapshotFrame?.kind === 'snapshot') {
    expect(snapshotFrame.snapshot.tickets.map(card => card.id)).toContain(ticketId)
  }
  unsubscribe()
  hub.dispose()
  runtime.dispose()
})

it('200ms 服务端合批:同窗事件一次冲刷(30 号 §3 频控;服务端频控非客户端节流)', async () => {
  const runtime = bootTasks()
  const hub = createLiveWorkbenchHub({ tasks: (): TasksWorldView | undefined => runtime, batchWindowMs: 200 })
  const arrivals: { readonly type: string; readonly at: number }[] = []
  hub.subscribe((frame) => {
    for (const event of parseFrames([frame])) arrivals.push({ type: event.kind, at: Date.now() })
  })
  // 同步驱动两张工单开出:两个 tickets-updated 增量进同一 200ms 合批窗,窗尾一次冲刷
  openTicket(runtime, '1')
  openTicket(runtime, '2')
  const driveAt = Date.now()
  await waitFor(() => { expect(arrivals.filter(item => item.type === 'tickets-updated').length).toBeGreaterThanOrEqual(2) })
  const boardFrames = arrivals.filter(item => item.type === 'tickets-updated')
  expect(boardFrames[0]!.at - driveAt).toBeGreaterThanOrEqual(150) // 窗尾冲刷,不逐事件直发
  expect(boardFrames.at(-1)!.at - boardFrames[0]!.at).toBeLessThan(50) // 同批到达
  hub.dispose()
  runtime.dispose()
})

it('真源端点常量 = access 守卫清单登记路径(G2-C4;O-5 落位)', () => {
  expect(DEFAULT_LIVE_STREAM_PATH).toBe('/workbench/api/stream')
})

it('DomainEvents 事件枚举以 WS-A ports.ts 为准(O-1):事件面契约逐类型可投影', () => {
  // hub 经 live-source 消费 ports.ts 全部 13 类事件(ringItemOf 逐支穷尽,TS 层钉住);
  // 此处以编译期枚举核对 + 一次真实 policy.changed 投影留痕收口。
  const runtime = bootTasks()
  const hub = createLiveWorkbenchHub({ tasks: (): TasksWorldView | undefined => runtime, batchWindowMs: 30 })
  const events: DomainEvent[] = []
  runtime.subscribe((event) => { events.push(event) })
  runtime.engine.policyChanged('v1', 'v2')
  expect(events.map(event => event.type)).toContain('policy.changed')
  hub.dispose()
  runtime.dispose()
})

it('C6 pass 周期自刷新:报告驱动的阶段迁移(无 DomainEvent)经刷新周期进看板', async () => {
  const runtime = bootTasks()
  const hub = createLiveWorkbenchHub({ tasks: (): TasksWorldView | undefined => runtime, batchWindowMs: 30, refreshMs: 40 })
  const received: WorkbenchStreamEvent[] = []
  hub.subscribe((frame) => { received.push(...parseFrames([frame])) })
  const ticketId = openTicket(runtime, '1')
  await waitFor(() => {
    const latest = received.filter(event => event.kind === 'tickets-updated').at(-1)
    expect(latest?.kind === 'tickets-updated' && latest.tickets.some(card => card.id === ticketId)).toBe(true)
  })
  // blocked 报告不发 DomainEvent(tasks DomainEvents 无 report 事件)——看板阶段迁移
  // 只经 C6 刷新周期追平(24a 拍板 C6「活跃工单清单 pass 周期刷新」)
  runtime.engine.report(ticketId, { state: 'blocked', summary: '报价口径不一致,等人拍板' })
  await waitFor(() => {
    const latest = received.filter(event => event.kind === 'tickets-updated').at(-1)
    expect(latest?.kind === 'tickets-updated' && latest.tickets.find(card => card.id === ticketId)?.column).toBe('person')
  })
  hub.dispose()
  runtime.dispose()
})

it('单工单回放真源(store 前链 + audit NDJSON R4 归账;F-10/O-4)', async () => {
  const runtime = bootTasks()
  const ticketId = openTicket(runtime, '1')
  // audit 落盘:worker 工具调用带 .ticket/<id>/ 归账证据(投影时 argsPreview 已过 PII)
  const auditDir = join(root, 'audit')
  mkdirSync(auditDir, { recursive: true })
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  const toolCall = {
    kind: 'tool-call', seq: 7, at: new Date().toISOString(), turn: 2, step: 1,
    tool: 'fs.read', callId: 'call-7', argsPreview: `.ticket/${ticketId}/report.md 64k`, isError: false,
  }
  writeFileSync(join(auditDir, `audit-${day}.jsonl`), `${JSON.stringify(toolCall)}\n`, 'utf8')
  const auditFiles = await readAuditFiles(auditDir)

  // 前链 trace(Store 只读面:Trigger→Decision→Ticket→Assignment)→ 回放轨迹
  const traceStore = {
    db: { prepare: (sql: string) => runtime.store.db.prepare(sql) as unknown as { all(...parameters: unknown[]): unknown[] } },
    triggers: { get: (id: string) => runtime.store.triggers.get(id) },
    decisions: { get: (id: string) => runtime.store.decisions.get(id) },
  }
  const ticket = runtime.store.tickets.get(ticketId)
  expect(ticket).toBeDefined()
  const entries = [
    ...ticketTraceEntries(traceStore, ticket!),
    ...traceEntriesForTicket(auditFiles, ticketId).map(entry => ({
      id: entry.id,
      ticketId,
      group: 'worker-session' as const,
      time: entry.time,
      source: entry.source,
      summary: [{ text: entry.summary }],
      status: { label: entry.status, tone: 'success' as const },
      duration: '—',
    })),
  ]
  const track = replayTrackFromEntries(ticketId, entries)
  expect(track.nodeKeys[0]).toBe('trigger') // 链头 = Trigger(发起原文)
  expect(track.nodeKeys).toContain('decision') // Decision 理由(码表)在链上
  expect(track.nodeKeys.at(-1)).toBe('worker') // 链尾 = audit 归账的 worker 工具行
  expect(track.steps.length).toBeGreaterThanOrEqual(4)
  expect(replayNarration(track)).toContain(ticketId)
  // 全局时间轴回放不做(F-11):只有按工单一条路径;无轨迹工单 = 空步播报
  expect(replayTrackFromEntries(ticketId, [])).toEqual({ ticketId, steps: [], nodeKeys: [], points: [] })
  expect(replayNarration(replayTrackFromEntries(ticketId, []))).toContain('暂无回放事件')
  runtime.dispose()
})
