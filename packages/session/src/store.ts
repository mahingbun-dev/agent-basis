/**
 * 会话事件存储:append-only(seq 单调、time 毫秒)+ 结构过滤查询 + 可选 JSONL 落盘。
 * 纯实现(不触 ctx):emit 钩子由插件装配层接线(session/event 采集点)。
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SessionEvent, SessionStore } from '@core/contracts'

export interface SessionStoreOptions {
  /** JSONL 落盘文件;缺省仅内存。 */
  readonly file?: string
  /** 事件采集点(插件装配层接 ctx.events.emit('session/event', …))。 */
  readonly onEvent?: (event: SessionEvent) => void
  /** time 时钟(测试注入)。 */
  readonly now?: () => number
}

export class SessionStoreImpl implements SessionStore {
  private seq = 0
  private readonly events: SessionEvent[] = []
  private readonly options: SessionStoreOptions

  constructor(options: SessionStoreOptions = {}) {
    this.options = options
  }

  /** 追加一条事件(分配 seq/time),落盘 + 采集点,返回完整事件包。 */
  append(type: string, data: unknown): SessionEvent {
    const event: SessionEvent = { type, seq: ++this.seq, time: this.options.now?.() ?? Date.now(), data }
    this.events.push(event)
    const file = this.options.file
    if (file !== undefined) {
      mkdirSync(dirname(file), { recursive: true })
      appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8')
    }
    this.options.onEvent?.(event)
    return event
  }

  /** 结构过滤查询(type 精确;seq 边界 [sinceSeq, untilSeq] 闭区间)。 */
  query(filter: { readonly type?: string; readonly sinceSeq?: number; readonly untilSeq?: number } = {}): readonly SessionEvent[] {
    return this.events.filter((event) => {
      if (filter.type !== undefined && event.type !== filter.type) return false
      if (filter.sinceSeq !== undefined && event.seq < filter.sinceSeq) return false
      if (filter.untilSeq !== undefined && event.seq > filter.untilSeq) return false
      return true
    })
  }

  size(): number {
    return this.events.length
  }
}
