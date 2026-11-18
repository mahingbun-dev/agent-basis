/**
 * SSE 服务端流测试(38 号 T5/G2-D3:mock 事件流驱动——200ms 合批 +
 * 快照→增量 + Last-Event-ID 续传;30 号 §3 三行规格)。分两段:
 * ① EventBatcher 单元(fake timers 钉窗口语义);
 * ② dev mock 服务真实 HTTP 集成(node fetch 消费,行为 = scripts/dev-sse.mjs
 *    的 dev 服务本体)。
 * 负向断言(F-11 全局时间轴回放不做)见 panel-workbench-views.spec.tsx。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventBatcher } from '../src/stream/batcher.ts'
import { MOCK_EVENT_NAME, createMockSseServer, sseFrame } from '../src/stream/dev-server.ts'
import { initialMockSnapshot, mockTimeline } from '../src/stream/mock-source.ts'
import { ServerSentEventDecoder, type ServerSentEvent } from '../src/stream/sse-decoder.ts'
import type { WorkbenchStreamEvent } from '../src/types.ts'

const LF = String.fromCharCode(10)

/** 按 kind 取 mock 时间线事件(时间线增删条目不改变既有断言的事件面)。 */
function timelineEventOf(kind: 'eval-run' | 'log-appended' | 'worker-updated' | 'ticket-moved') {
  const hit = mockTimeline().find(item => item.event.kind === kind)?.event
  if (hit === undefined) throw new Error(`mock 时间线缺 ${kind}`)
  return hit
}


describe('EventBatcher:200ms 合批窗口(30 号 §3 频控)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('窗口内多事件合为一批,窗尾一次 flush', () => {
    const batches: (readonly WorkbenchStreamEvent[])[] = []
    const batcher = new EventBatcher<WorkbenchStreamEvent>((batch) => { batches.push(batch) }, 200)
    const a = { kind: 'eval-run', seq: 2, passRate: 92.8 } as const
    const b = { kind: 'eval-run', seq: 3, passRate: 93 } as const
    batcher.push(a)
    batcher.push(b)
    expect(batches).toHaveLength(0) // 窗口未到期不 flush
    expect(batcher.pendingCount).toBe(2)
    vi.advanceTimersByTime(199)
    expect(batches).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(batches).toEqual([[a, b]]) // 同窗两事件一批
    expect(batcher.pendingCount).toBe(0)
  })

  it('首批 flush 后重开窗口;空窗不产生空批;flushNow 立即冲刷;dispose 后丢弃', () => {
    const batches: number[][] = []
    const batcher = new EventBatcher<number>((batch) => { batches.push([...batch]) }, 200)
    batcher.push(1)
    vi.advanceTimersByTime(200)
    batcher.push(2)
    batcher.flushNow() // 未到窗尾强制冲刷
    expect(batches).toEqual([[1], [2]])
    vi.advanceTimersByTime(400) // 空窗:无定时器、无空批
    expect(batches).toEqual([[1], [2]])
    batcher.dispose()
    batcher.push(3)
    vi.advanceTimersByTime(400)
    expect(batches).toEqual([[1], [2]]) // dispose 后 push 为 no-op
  })
})

describe('dev mock SSE 服务(HTTP 集成,dev-sse.mjs 本体)', () => {
  /** 从一条永不结束的 SSE 流读够 count 个事件即取消(SSE 帧累积解码)。 */
  async function readEvents(response: Response, count: number): Promise<ServerSentEvent[]> {
    const decoder = new ServerSentEventDecoder()
    const reader = response.body!.getReader()
    const events: ServerSentEvent[] = []
    try {
      while (events.length < count) {
        const { done, value } = await reader.read()
        if (done) break
        for (const sse of decoder.push(new TextDecoder().decode(value, { stream: true }))) {
          if (sse.event === MOCK_EVENT_NAME) events.push(sse)
        }
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    return events
  }

  it(
    '快照→增量→续传全链(真实 fetch + 解码器消费)',
    async () => {
      const server = createMockSseServer({
        port: 0,
        timeline: [
          { delayMs: 60, event: timelineEventOf('eval-run') },      // eval-run 92.8
          { delayMs: 90, event: timelineEventOf('log-appended') },  // log-appended(与上者同 200ms 窗)
          { delayMs: 400, event: timelineEventOf('ticket-moved') }, // ticket-moved T-88b1
        ],
        batchWindowMs: 200,
        keepAliveMs: 0,
      })
      const address = await server.start()
      try {
        // ── 首连接:先快照(seq 1),再增量(2/3 同窗,4 其后)──
        const first = await fetch(address.url, { headers: { Accept: 'text/event-stream' } })
        expect(first.headers.get('content-type')).toContain('text/event-stream')
        const batch1 = await readEvents(first, 3)
        expect(batch1.map(sse => sse.lastEventId)).toEqual(['1', '2', '3'])
        const snapshotEvent = JSON.parse(batch1[0]!.data) as WorkbenchStreamEvent
        expect(snapshotEvent.kind).toBe('snapshot')
        if (snapshotEvent.kind !== 'snapshot') throw new Error('unreachable')
        expect(snapshotEvent.snapshot.tickets).toHaveLength(7)
        expect(snapshotEvent.snapshot.eval.trend).toEqual([90.2, 91.0, 89.8, 91.5, 92.0, 91.2, 92.4])
        expect(JSON.parse(batch1[1]!.data)).toMatchObject({ kind: 'eval-run', passRate: 92.8 })
        expect(JSON.parse(batch1[2]!.data)).toMatchObject({ kind: 'log-appended' })

        const fourth = await fetch(address.url, { headers: { Accept: 'text/event-stream', 'Last-Event-ID': '3' } })
        const batch2 = await readEvents(fourth, 1)
        expect(batch2[0]!.lastEventId).toBe('4')
        expect(JSON.parse(batch2[0]!.data)).toMatchObject({ kind: 'ticket-moved', ticketId: 'T-88b1', column: 'working' })

        // ── 断线重连 Last-Event-ID: 2:缓冲无缺口 → 只补发 3/4,不重推快照 ──
        const resumed = await fetch(address.url, { headers: { Accept: 'text/event-stream', 'Last-Event-ID': '2' } })
        const replay = await readEvents(resumed, 2)
        expect(replay.map(sse => sse.lastEventId)).toEqual(['3', '4'])
        expect(JSON.parse(replay[0]!.data)).toMatchObject({ kind: 'log-appended' })
        expect(JSON.parse(replay[1]!.data)).toMatchObject({ kind: 'ticket-moved', ticketId: 'T-88b1' })

        // ── 新连接(无 Last-Event-ID):重推快照,且快照已含已发增量(T-88b1 已在 working 列)──
        const fresh = await fetch(address.url, { headers: { Accept: 'text/event-stream' } })
        const freshBatch = await readEvents(fresh, 1)
        const freshSnapshot = JSON.parse(freshBatch[0]!.data) as WorkbenchStreamEvent
        expect(freshSnapshot.kind).toBe('snapshot')
        if (freshSnapshot.kind !== 'snapshot') throw new Error('unreachable')
        expect(freshSnapshot.snapshot.tickets.find(ticket => ticket.id === 'T-88b1')!.column).toBe('working')
        expect(freshSnapshot.snapshot.eval.trend).toHaveLength(8)

        // ── Last-Event-ID ≥ 当前 seq:无可补发,收空(120ms 内无帧即断言)──
        const caughtUp = await fetch(`${address.url}?lastEventId=99`)
        const nothing = await Promise.race([
          readEvents(caughtUp, 1).then(events => events),
          new Promise<ServerSentEvent[]>((resolve) => { setTimeout(() => { resolve([]) }, 120) }),
        ])
        expect(nothing).toEqual([])

        // ── CORS 预检与未知路径 ──
        const preflight = await fetch(address.url, { method: 'OPTIONS' })
        expect(preflight.status).toBe(204)
        expect(preflight.headers.get('access-control-allow-origin')).toBe('*')
        const origin = new URL(address.url).origin
        const notFound = await fetch(`${origin}/api/unknown`)
        expect(notFound.status).toBe(404)
      } finally {
        await server.stop()
      }
    },
    15_000,
  )

  it('sseFrame:id/event/data 三字段 + 空行派发(WHATWG 帧格式)', () => {
    const frame = sseFrame({ kind: 'snapshot', seq: 1, snapshot: initialMockSnapshot() })
    expect(frame.startsWith('id: 1' + LF + 'event: workbench-mock' + LF + 'data: {')).toBe(true)
    expect(frame.endsWith('}' + LF + LF)).toBe(true)
    const decoded = new ServerSentEventDecoder().push(frame)
    expect(decoded).toHaveLength(1)
    expect(decoded[0]!.lastEventId).toBe('1')
  })
})
