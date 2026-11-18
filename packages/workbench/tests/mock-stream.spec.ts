/**
 * 浏览器半边 mock 流控制器测试(T5 客户端面;30 号 §3 快照+增量/续传 + F-14
 * 幂等重放)。真实 fetch + 真实服务(与 stream-batching.spec.ts 的服务端面互补):
 * 连接→快照→增量应用、断线重连携带 Last-Event-ID 请求头、重放旧事件跳过
 * (seq ≤ lastSeq)、服务不可达 error 态与 retry() 恢复、stop() 冻结。
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createMockSseServer, DEFAULT_MOCK_ENDPOINT, sseFrame } from '../src/stream/dev-server.ts'
import { initialMockSnapshot, mockTimeline } from '../src/stream/mock-source.ts'
import { createMockStreamController, type WorkbenchStreamState } from '../src/client/mock-stream.ts'
import type { WorkbenchSnapshot, WorkbenchStreamEvent } from '../src/types.ts'

/** 轮询探针直到返回非 undefined(超时抛错;真实定时器,预算按重连延迟 1s 放宽)。 */
async function until<T>(probe: () => T | undefined, ms = 3000): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const value = probe()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error('等待状态超时')
    await new Promise((resolve) => { setTimeout(resolve, 20) })
  }
}

const rawControllers: ReturnType<typeof createMockStreamController>[] = []

/** 按 kind 取 mock 时间线事件(时间线增删条目不改变既有断言的事件面)。 */
function timelineEventOf(kind: 'eval-run' | 'log-appended' | 'worker-updated' | 'ticket-moved') {
  const hit = mockTimeline().find(item => item.event.kind === kind)?.event
  if (hit === undefined) throw new Error(`mock 时间线缺 ${kind}`)
  return hit
}


afterEach(() => {
  for (const controller of rawControllers.splice(0)) controller.stop()
})

/** 控制器就绪态探针:满足谓词才返回 ready 态(收窄联合),否则 undefined 继续轮询。 */
function readyWhen(
  controller: ReturnType<typeof createMockStreamController>,
  predicate: (snapshot: WorkbenchSnapshot) => boolean,
): Extract<WorkbenchStreamState, { status: 'ready' }> | undefined {
  const state = controller.getSnapshot()
  return state.status === 'ready' && predicate(state.snapshot) ? state : undefined
}

describe('连接 → 快照 → 增量(30 号 §3 快照行;真实 dev mock 服务)', () => {
  it('先收全量快照(seq 1),后渐进应用增量:eval-run 追点、log 追行、ticket 流转翻列', async () => {
    const server = createMockSseServer({
      port: 0,
      timeline: [
        { delayMs: 60, event: timelineEventOf('eval-run') },       // eval-run 92.8
        { delayMs: 90, event: timelineEventOf('log-appended') },   // log-appended(同 200ms 窗合批)
        { delayMs: 400, event: timelineEventOf('ticket-moved') },  // ticket-moved T-88b1 → working
      ],
      keepAliveMs: 0,
    })
    const address = await server.start()
    const controller = createMockStreamController(address.url)
    rawControllers.push(controller)
    try {
      // 谓词取 seq-4 的效果(T-88b1 流转)而非中间态,杜绝轮询竞态
      const ready = await until(() => readyWhen(controller, snapshot => snapshot.tickets.find(ticket => ticket.id === 'T-88b1')?.column === 'working'))
      expect(ready.lastSeq).toBe(4)
      expect(ready.snapshot.eval.trend).toHaveLength(8)
      expect(ready.snapshot.eval.trend[7]).toBe(92.8)
      expect(ready.snapshot.logs.map(entry => entry.id)).toContain('t9c81-session-7')
    } finally {
      controller.stop()
      await server.stop()
    }
  })

  it('服务不可达 → error 态带 message;服务就绪后 retry() 重连恢复快照', async () => {
    // 先占位取空闲端口再释放,保证控制器首连必然失败(连接拒绝)
    const placeholder = createMockSseServer({ port: 0, advanceTimeline: false, keepAliveMs: 0 })
    const { port } = await placeholder.start()
    await placeholder.stop()

    const controller = createMockStreamController(`http://127.0.0.1:${port}${DEFAULT_MOCK_ENDPOINT}`)
    rawControllers.push(controller)
    const failed = await until((): Extract<WorkbenchStreamState, { status: 'error' }> | undefined => {
      const state = controller.getSnapshot()
      return state.status === 'error' ? state : undefined
    })
    expect(failed.message).not.toBe('')

    const server = createMockSseServer({ port, advanceTimeline: false, keepAliveMs: 0 })
    await server.start()
    try {
      controller.retry()
      const ready = await until(() => readyWhen(controller, () => true))
      expect(ready.snapshot.tickets).toHaveLength(7)
      expect(ready.lastSeq).toBe(1)
    } finally {
      controller.stop()
      await server.stop()
    }
  })

  it('stop() 后状态冻结在最后已知快照,重复 stop 幂等', async () => {
    const server = createMockSseServer({ port: 0, advanceTimeline: false, keepAliveMs: 0 })
    const address = await server.start()
    const controller = createMockStreamController(address.url)
    try {
      const ready = await until(() => readyWhen(controller, () => true))
      controller.stop()
      controller.stop()
      expect(controller.getSnapshot()).toBe(ready)
    } finally {
      await server.stop()
    }
  })
})

describe('续传与幂等(F-14:Last-Event-ID 请求头 + 旧事件重放跳过)', () => {
  /** 裸 SSE 端点:逐请求记录 Last-Event-ID 请求头,响应交由用例回调驱动。 */
  async function rawEndpoint(respond: (req: IncomingMessage, lastEventId: string | undefined, res: ServerResponse) => void): Promise<{
    close: () => Promise<void>
    seenLastEventIds: string[]
    url: string
  }> {
    const seen: string[] = []
    const server = createServer((req, res) => {
      const header = req.headers['last-event-id']
      const lastEventId = Array.isArray(header) ? header[0] : header
      seen.push(lastEventId ?? '')
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' })
      respond(req, lastEventId, res)
    })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('unexpected address')
    return {
      seenLastEventIds: seen,
      url: `http://127.0.0.1:${address.port}/stream`,
      close: async () => { await new Promise<void>((resolve) => { server.close(() => { resolve() }) }) },
    }
  }

  it(
    '断线重连请求携带 Last-Event-ID(30 号 §3;首连不带)',
    async () => {
      const snapshot = initialMockSnapshot()
      const endpoint = await rawEndpoint((_req, lastEventId, res) => {
        if (lastEventId === undefined) {
          // 首连:推快照后立即断流,逼出 1s 重连
          res.write(sseFrame({ kind: 'snapshot', seq: 1, snapshot }))
          res.end()
        }
        // 续连:保持连接不发帧(验证请求头即止)
      })
      const controller = createMockStreamController(endpoint.url)
      rawControllers.push(controller)
      try {
        await until(() => (endpoint.seenLastEventIds.length >= 2 ? endpoint.seenLastEventIds : undefined))
        expect(endpoint.seenLastEventIds[0]).toBe('')
        expect(endpoint.seenLastEventIds[1]).toBe('1')
      } finally {
        controller.stop()
        await endpoint.close()
      }
    },
    6000,
  )

  it('重放旧事件(seq ≤ lastSeq)跳过,仅应用新事件(幂等重放,图状态不乱)', async () => {
    const snapshot: WorkbenchSnapshot = { ...initialMockSnapshot(), eval: { ...initialMockSnapshot().eval, trend: [90.2] } }
    const events: WorkbenchStreamEvent[] = [
      { kind: 'snapshot', seq: 1, snapshot },
      { kind: 'eval-run', seq: 1, passRate: 50 },  // 重放旧 seq(≤ lastSeq):跳过
      { kind: 'eval-run', seq: 2, passRate: 99 },  // 新事件:应用
    ]
    const endpoint = await rawEndpoint((_req, _lastEventId, res) => {
      res.write(events.map(sseFrame).join(''))
      // 保持连接打开(不再发帧)
    })
    const controller = createMockStreamController(endpoint.url)
    rawControllers.push(controller)
    try {
      const ready = await until(() => readyWhen(controller, snap => snap.eval.trend.length >= 2))
      expect(ready.lastSeq).toBe(2)
      expect(ready.snapshot.eval.trend).toEqual([90.2, 99])
    } finally {
      controller.stop()
      await endpoint.close()
    }
  })
})
