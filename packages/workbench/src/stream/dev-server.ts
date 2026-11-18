/**
 * dev 用 SSE mock 服务(38 号 T5「mock 事件源先行」;本任务范围:SSE mock
 * 服务 dev 用)。独立 node 进程(scripts/dev-sse.mjs 启动),不经宿主路由面
 * 注册——工作台插件的新数据端点为 0(G2-D6;生产 SSE 端点由 access 登记,
 * 38 号 O-5/G2-C4,载荷 = live-hub.ts 投影)。M4 后本服务与 mock 时间线
 * (mock-source.ts)同为 fixture/dev 工具定位——客户端装载路径只走真源
 * (client/live-stream.ts),不存在 mock 切换开关(G2-D11)。
 *
 * 行为(30 号 §3):
 * - 连接先推全量快照,再推增量事件;
 * - 增量经 200ms 合批(EventBatcher)下发;
 * - 断线重连带 Last-Event-ID:缓冲区无缺口则按 id 续传增量,有缺口(或新连
 *   接)则重推当前快照(快照已含错过增量,图状态不因重连错乱,F-14);
 * - 15s 保活注释行(「: keep-alive」);
 * - 时间线走完即静默(指标心跳频率未拍板,38 号 O-7,不发明)。
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { EventBatcher } from './batcher.ts'
import { initialMockSnapshot, mockTimeline, type MockIncrement } from './mock-source.ts'
import { applyWorkbenchEvent } from '../project/state.ts'
import type { WorkbenchIncrement, WorkbenchSnapshot, WorkbenchStreamEvent } from '../types.ts'

/** SSE event 字段(38 号 O-1/O-2:mock 命名空间,不冒充 DomainEvents)。 */
export const MOCK_EVENT_NAME = 'workbench-mock'

/** 默认流端点(dev 工具路径;生产端点由 access 登记,38 号 O-5)。 */
export const DEFAULT_MOCK_ENDPOINT = '/api/workbench-mock/stream'

export interface MockSseServerOptions {
  /** 监听端口;缺省 8788,0 = 临时端口(测试)。 */
  readonly port?: number
  /** 监听地址;缺省 127.0.0.1(dev 工具不对外)。 */
  readonly host?: string
  /** 流端点路径;缺省 DEFAULT_MOCK_ENDPOINT。 */
  readonly endpoint?: string
  /** 增量时间线;缺省 mockTimeline()。 */
  readonly timeline?: readonly MockIncrement[]
  /** 是否推进增量时间线;测试可关(只验快照/续传)。 */
  readonly advanceTimeline?: boolean
  /** 保活注释行间隔;缺省 15000ms,<=0 关闭。 */
  readonly keepAliveMs?: number
  /** 合批窗口;缺省 200ms(30 号 §3 频控拍板值)。 */
  readonly batchWindowMs?: number
}

interface Connection {
  readonly res: ServerResponse
  readonly batcher: EventBatcher<WorkbenchStreamEvent>
  readonly keepAlive: ReturnType<typeof setInterval> | undefined
}

/** 单个 SSE 帧文本(id/event/data 三字段 + 空行派发)。 */
export function sseFrame(event: WorkbenchStreamEvent): string {
  return `id: ${event.seq}\nevent: ${MOCK_EVENT_NAME}\ndata: ${JSON.stringify(event)}\n\n`
}

export interface MockSseServer {
  readonly server: Server
  /** 启动并返回实际监听地址(url 为流端点绝对地址)。 */
  start(): Promise<{ readonly port: number; readonly url: string }>
  stop(): Promise<void>
}

/** 创建 dev mock SSE 服务(不监听;start() 后可用)。 */
export function createMockSseServer(options: MockSseServerOptions = {}): MockSseServer {
  const endpoint = options.endpoint ?? DEFAULT_MOCK_ENDPOINT
  const timeline = options.timeline ?? mockTimeline()
  const batchWindowMs = options.batchWindowMs ?? 200
  const keepAliveMs = options.keepAliveMs ?? 15_000

  // 全局 mock 态:seq 分配、当前快照(增量即时应用)、增量环形缓冲(续传)。
  let seq = 0
  let snapshot: WorkbenchSnapshot = initialMockSnapshot()
  const buffer: WorkbenchStreamEvent[] = []
  const BUFFER_LIMIT = 100
  const connections = new Set<Connection>()
  const timers: ReturnType<typeof setTimeout>[] = []
  let timelineStarted = false

  const allocate = (): number => {
    seq += 1
    return seq
  }

  /** 增量事件:进环形缓冲 + 应用到当前快照 + 广播到各连接的合批窗口。 */
  const emitIncrement = (event: WorkbenchIncrement): WorkbenchStreamEvent => {
    const full: WorkbenchStreamEvent = { ...event, seq: allocate() }
    buffer.push(full)
    if (buffer.length > BUFFER_LIMIT) buffer.shift()
    snapshot = applyWorkbenchEvent(snapshot, full)
    for (const connection of connections) connection.batcher.push(full)
    return full
  }

  const startTimeline = (): void => {
    if (timelineStarted || options.advanceTimeline === false) return
    timelineStarted = true
    for (const increment of timeline) {
      const timer = setTimeout(() => { emitIncrement(increment.event) }, increment.delayMs)
      timers.push(timer)
    }
  }

  /** 续传判定:Last-Event-ID 之后无缓冲缺口 → 纯增量续传;否则重推快照。 */
  const canReplayFrom = (lastEventId: number): boolean => {
    if (lastEventId >= seq) return true
    const oldest = buffer[0]
    return oldest !== undefined && oldest.seq <= lastEventId + 1
  }

  const handleStream = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const headerId = req.headers['last-event-id']
    const queryId = url.searchParams.get('lastEventId')
    const parsedId = queryId ?? (Array.isArray(headerId) ? headerId[0] : headerId)
    const lastEventId = parsedId !== undefined && parsedId !== '' && Number.isFinite(Number(parsedId)) ? Number(parsedId) : undefined

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    // 无帧可发的连接(已追平的 Last-Event-ID 续传)也立即下发响应头,
    // 否则客户端 fetch 在等首字节时挂起
    res.flushHeaders()

    const batcher = new EventBatcher<WorkbenchStreamEvent>((batch) => {
      res.write(batch.map(sseFrame).join(''))
    }, batchWindowMs)
    const connection: Connection = {
      res,
      batcher,
      keepAlive: keepAliveMs > 0
        ? setInterval(() => { res.write(': keep-alive\n\n') }, keepAliveMs)
        : undefined,
    }
    connections.add(connection)

    if (lastEventId !== undefined && canReplayFrom(lastEventId)) {
      // 续传:只补发 id > lastEventId 的缓冲增量(快照客户端已有)
      for (const event of buffer) {
        if (event.seq > lastEventId) res.write(sseFrame(event))
      }
    } else {
      // 新连接 / 缓冲有缺口:先推全量快照(30 号 §3)
      res.write(sseFrame({ kind: 'snapshot', seq: allocate(), snapshot }))
    }
    startTimeline()

    req.on('close', () => {
      connections.delete(connection)
      batcher.dispose()
      if (connection.keepAlive !== undefined) clearInterval(connection.keepAlive)
      res.end()
    })
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    // dev 工具:面板页经 fetch 直连(跨源),放开 CORS;仅此用途
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Last-Event-ID')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    if (url.pathname === endpoint && (req.method === 'GET' || req.method === 'HEAD')) {
      handleStream(req, res)
      return
    }
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: false, message: `not found (stream endpoint: ${endpoint})` }))
  })

  return {
    server,
    start: async () => {
      const port = options.port ?? 8788
      const host = options.host ?? '127.0.0.1'
      await new Promise<void>((resolve) => { server.listen(port, host, resolve) })
      const address = server.address() as AddressInfo
      return { port: address.port, url: `http://${host}:${address.port}${endpoint}` }
    },
    stop: async () => {
      for (const timer of timers) clearTimeout(timer)
      for (const connection of connections) {
        connection.batcher.dispose()
        if (connection.keepAlive !== undefined) clearInterval(connection.keepAlive)
        connection.res.destroy()
      }
      connections.clear()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    },
  }
}
