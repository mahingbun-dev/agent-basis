/**
 * 浏览器半边的真源流客户端(38 号 T15/G2-D11 M4 实接;30 号 §3 客户端行)。
 *
 * 真源 = access 路由面登记的 SSE 端点(38 号 O-5/G2-C4:GET 同源路径,常量
 * DEFAULT_LIVE_STREAM_PATH;数据面经 tasks 引擎 DomainEvents——workbench Host
 * 半边 live hub 投影,access 仅守卫与装载帧,24a 裁决 dwfq-843ec077-1 口径
 * 「数据面经 tasks 提供、路由经 access 登记」)。同源相对路径,无跨域、无
 * window 覆写开关(mock 时代的 dev 覆写键随 G2-D11 拆除;mock-stream.ts 降为
 * 测试 fixture,不在客户端装载路径)。
 *
 * 传输 = fetch + SSE 解码器(30 号 §3 客户端行:解码器照搬 chat-demo 的
 * WHATWG 规范实现,src/stream/sse-decoder.ts),非 EventSource——断线重连
 * 自持(Last-Event-ID 请求头,30 号 §3 快照行)且请求头可带。WorkbenchPage
 * 与 project/ 投影层不感知本文件(38 号 §9 解耦对策:实接只换数据源)。
 */
import { readServerSentEvents } from '../stream/sse-decoder.ts'
import { applyWorkbenchEvent } from '../project/state.ts'
import type { WorkbenchSnapshot, WorkbenchStreamEvent } from '../types.ts'

/** 真源流端点(access 登记的同源路径;单一事实源在 packages/access/src/tenant.ts)。 */
export const DEFAULT_LIVE_STREAM_PATH = '/workbench/api/stream'

/** 解析真源流地址:同源相对路径(无覆写开关;测试经参数显式传入完整 URL)。 */
export function resolveLiveStreamUrl(): string {
  return DEFAULT_LIVE_STREAM_PATH
}

export type WorkbenchStreamState =
  | { readonly status: 'connecting' }
  | { readonly status: 'ready'; readonly snapshot: WorkbenchSnapshot; readonly lastSeq: number }
  | { readonly status: 'error'; readonly message: string }

export interface WorkbenchStreamController {
  getSnapshot(): WorkbenchStreamState
  subscribe(listener: () => void): () => void
  /** 手动重连(错误态「重试」按钮;连接中/已连接为 no-op 重开)。 */
  retry(): void
  /** 停止(插件卸载)。 */
  stop(): void
}

const RECONNECT_DELAY_MS = 1000

/**
 * 真源流控制器:裸 observable 源(panel inject 面保留 hooks 份额纪律:
 * 可变事实只有流状态一个,不建 store)。事件应用走共享纯 reducer
 * (applyWorkbenchEvent),seq ≤ lastSeq 的重放事件跳过(F-14 幂等)。
 * @param url - 显式地址(测试注入临时端口;缺省同源 DEFAULT_LIVE_STREAM_PATH)。
 */
export function createLiveStreamController(url?: string): WorkbenchStreamController {
  let state: WorkbenchStreamState = { status: 'connecting' }
  const listeners = new Set<() => void>()
  // 闭包内可变停止位:stop() 写、connect() 读;静态分析视 closure 内赋值不可达,
  // 读点以定向 disable 注释豁免(compaction/src/basic/index.ts:427 同款先例)
  let stopped = false
  let controller: AbortController | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined

  const publish = (next: WorkbenchStreamState): void => {
    state = next
    for (const listener of listeners) listener()
  }

  const scheduleReconnect = (): void => {
    if (stopped) return
    if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(() => { void connect() }, RECONNECT_DELAY_MS)
  }

  const connect = async (): Promise<void> => {
    if (stopped) return
    controller = new AbortController()
    const lastSeq = state.status === 'ready' ? state.lastSeq : 0
    try {
      // 每次连接重新解析(缺省 = 常量;显式 url(测试)优先)。
      const target = url ?? resolveLiveStreamUrl()
      const response = await fetch(target, {
        headers: {
          Accept: 'text/event-stream',
          // 断线重连以 Last-Event-ID 续(30 号 §3);首连不带
          ...(lastSeq > 0 ? { 'Last-Event-ID': String(lastSeq) } : {}),
        },
        signal: controller.signal,
      })
      if (!response.ok || response.body === null) {
        publish({ status: 'error', message: `HTTP ${String(response.status)}` })
        scheduleReconnect()
        return
      }
      for await (const sse of readServerSentEvents(response.body, controller.signal)) {
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- stop() 可能在流读取间隙置位,闭包赋值对静态分析不可达
        if (stopped) return
        let event: WorkbenchStreamEvent
        try {
          event = JSON.parse(sse.data) as WorkbenchStreamEvent
        } catch {
          continue // 坏帧丢弃,不断流
        }
        if (event.kind === 'snapshot') {
          publish({ status: 'ready', snapshot: event.snapshot, lastSeq: event.seq })
          continue
        }
        // 续传重放的旧事件(seq ≤ lastSeq)跳过:状态已是其应用结果
        if (state.status === 'ready' && event.seq <= state.lastSeq) continue
        if (state.status === 'ready') {
          publish({ status: 'ready', snapshot: applyWorkbenchEvent(state.snapshot, event), lastSeq: event.seq })
        }
      }
      // 流正常结束(服务端关闭即重连)
      scheduleReconnect()
    } catch (error) {
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- stop() 可能在 await 间隙置位,闭包赋值对静态分析不可达
      if (stopped || controller.signal.aborted) return
      publish({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      scheduleReconnect()
    }
  }

  void connect()

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    retry: () => {
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
      controller?.abort()
      publish(state.status === 'ready' ? state : { status: 'connecting' })
      void connect()
    },
    stop: () => {
      stopped = true
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
      controller?.abort()
    },
  }
}
