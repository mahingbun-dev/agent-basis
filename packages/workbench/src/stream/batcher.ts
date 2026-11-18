/**
 * 服务端 200ms 合批(38 号 T5;30 号 §3 频控行「事件聚合窗口 200ms 合批,
 * 避免高频 report 事件打爆渲染」——服务端频控,非客户端节流)。
 *
 * 窗口语义:首个事件到达即开窗,窗口内后续事件并入同批,窗尾一次 flush;
 * 窗内无事件则不产生空批。快照帧不走合批(连接先推全量快照,30 号 §3)。
 */
export class EventBatcher<T> {
  readonly #flush: (events: readonly T[]) => void
  readonly #windowMs: number
  #pending: T[] = []
  #timer: ReturnType<typeof setTimeout> | undefined
  #disposed = false

  constructor(flush: (events: readonly T[]) => void, windowMs = 200) {
    this.#flush = flush
    this.#windowMs = windowMs
  }

  /** 进入聚合窗口;首事件开窗计时(dispose 后丢弃)。 */
  push(event: T): void {
    if (this.#disposed) return
    this.#pending.push(event)
    if (this.#timer === undefined) {
      this.#timer = setTimeout(() => { this.flushNow() }, this.#windowMs)
    }
  }

  /** 窗内事件数(0 = 无待 flush 批)。 */
  get pendingCount(): number {
    return this.#pending.length
  }

  /** 立即冲刷窗内事件(窗口到期/连接关闭时调用;空窗为 no-op)。 */
  flushNow(): void {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer)
      this.#timer = undefined
    }
    if (this.#pending.length === 0) return
    const batch = this.#pending
    this.#pending = []
    this.#flush(batch)
  }

  /** 丢弃未冲刷窗口并停用(连接断开;此后 push 为 no-op)。 */
  dispose(): void {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer)
      this.#timer = undefined
    }
    this.#pending = []
    this.#disposed = true
  }
}
