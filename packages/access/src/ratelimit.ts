/**
 * 滑动窗限速:登录(每 ip+账号 5/min)与变更类接口(每 ip 30/min)双层。
 * 内存态,重启即清(计划书默认假设)。now 可注入供测试。
 */
export class SlidingWindow {
  readonly max: number
  readonly windowMs: number
  private readonly hits = new Map<string, number[]>()
  private readonly now: () => number

  // 注意:不用 TS 参数属性(readonly max: number 形态)——容器 node strip-only
  // 模式拒绝参数属性(ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX,2026-11-09 容器实测)。
  constructor(max: number, windowMs: number, now: () => number = Date.now) {
    this.max = max
    this.windowMs = windowMs
    this.now = now
  }

  /** 记录一次并返回是否放行。 */
  hit(key: string): boolean {
    const t = this.now()
    const fresh: number[] = []
    for (const stamp of this.hits.get(key) ?? []) {
      if (t - stamp < this.windowMs) fresh.push(stamp)
    }
    if (fresh.length >= this.max) {
      this.hits.set(key, fresh)
      return false
    }
    fresh.push(t)
    this.hits.set(key, fresh)
    if (this.hits.size > 4096) this.prune(t)
    return true
  }

  private prune(t: number): void {
    for (const [key, stamps] of this.hits) {
      const fresh = stamps.filter(stamp => t - stamp < this.windowMs)
      if (fresh.length === 0) this.hits.delete(key)
      else this.hits.set(key, fresh)
    }
  }
}
