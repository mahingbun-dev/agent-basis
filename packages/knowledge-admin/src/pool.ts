/**
 * 后端实例池(**按绝对路径 keyed**,LRU + 闲置关库,cap 8 缺省)。
 *
 * 与 glue knowledge-plugin 的全局服务**不共享实例**:同路径也不复用——两处各自
 * `new WikiLocalBackend`(SQLite 各自连接),因此本包的任何写都不会与 agent 工具的
 * 写路径共享连接/事务(冲突面只剩文件系统层,与既有单库形态一致)。
 *
 * 纪律(Cordis):池是 effect——`dispose()` 即配逆(逐个 backend.dispose + 关 sqlite)。
 * 每次取用先做惰性回收(闲置超时先出池再取),取用后再逐个淘汰直到 ≤ cap。
 */
import type { WikiLocalBackend } from '@eterna/knowledge'

/** 池条目(backend + 关库闭包 + 最后使用时刻)。 */
interface PoolEntry {
  readonly backend: WikiLocalBackend
  readonly dispose: () => void
  lastUsedAt: number
}

/** 按绝对路径 keyed 的后端池。 */
export class BackendPool {
  readonly #pool = new Map<string, PoolEntry>()
  readonly #create: (cacheKey: string) => { backend: WikiLocalBackend; dispose: () => void }
  readonly #maxInstances: number
  readonly #idleMs: number
  readonly #now: () => number
  #disposed = false

  constructor(options: {
    readonly create: (cacheKey: string) => { backend: WikiLocalBackend; dispose: () => void }
    readonly maxInstances?: number | undefined
    readonly idleMs?: number | undefined
    readonly now?: (() => number) | undefined
  }) {
    this.#create = options.create
    this.#maxInstances = options.maxInstances ?? 8
    this.#idleMs = options.idleMs ?? 600_000
    this.#now = options.now ?? (() => Date.now())
  }

  /** 取(或建)某路径的后端;已 dispose 的池返回 undefined(调用方 fail-closed)。 */
  acquire(cacheKey: string): WikiLocalBackend | undefined {
    if (this.#disposed) return undefined
    this.#reapIdle()
    const existing = this.#pool.get(cacheKey)
    if (existing !== undefined) {
      existing.lastUsedAt = this.#now()
      // Map 迭代序=插入序:重插把它挪到最新位(LRU 语义)
      this.#pool.delete(cacheKey)
      this.#pool.set(cacheKey, existing)
      return existing.backend
    }
    const created = this.#create(cacheKey)
    this.#pool.set(cacheKey, { backend: created.backend, dispose: created.dispose, lastUsedAt: this.#now() })
    this.#evictOverCap()
    return created.backend
  }

  /** 池内当前条目数(测试/巡检面)。 */
  get size(): number {
    return this.#pool.size
  }

  /** 某路径是否在池内(测试面;不入池)。 */
  has(cacheKey: string): boolean {
    return this.#pool.has(cacheKey)
  }

  /** 全关(插件配逆;幂等)。 */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const entry of this.#pool.values()) entry.dispose()
    this.#pool.clear()
  }

  #reapIdle(): void {
    const now = this.#now()
    for (const [key, entry] of this.#pool) {
      if (now - entry.lastUsedAt > this.#idleMs) {
        entry.dispose()
        this.#pool.delete(key)
      }
    }
  }

  #evictOverCap(): void {
    while (this.#pool.size > this.#maxInstances) {
      const oldest = this.#pool.keys().next()
      if (oldest.done === true) break
      this.#pool.get(oldest.value)?.dispose()
      this.#pool.delete(oldest.value)
    }
  }
}
