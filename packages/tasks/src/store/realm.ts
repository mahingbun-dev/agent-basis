/**
 * realm 路由——realm(账号)→ Store 的 LRU 池(35 号 A11;34 号 §2.3 realm 行)。
 *
 * 设计依据:23 号 §3.1 方案 C(per-account store 池)同构,本仓先例
 * packages/memory/src/account-router.ts(MemoryAccountRouter):
 * - `TasksRealmRouter`:realm → Store 的 LRU 池(池上限 8、闲置 10 分钟关库——
 *   23 号 §4-Q1 决议参数,单账号库轻、内存可控;池满逐出最久未用并 close);
 * - 账号解析(`accountOf()` 单一真值,23 号 §3.1:会话侧/mux principal 两路收敛,
 *   glue 唯一实现)经注入的 `dirOf` 进入本层——本包不 import access/gluе 服务实例
 *   (34 号 §1 依赖方向:接线经端口注入);
 * - fail-closed:解析失败(dirOf 返回 undefined)不开库、不隐式建目录——
 *   「宁可拒一次,不可跨租户写」(23 号 §3.1 fail-closed 铁律);
 * - 目录由 access 登录开通创建(userRootFor 先例);本层只消费。
 * 一库一 realm:Store 实例即 34 号 §2.3「A1 拍板一租户一 SQLite」的落地单元。
 */
import { dirname } from 'node:path'
import { Store } from './store.ts'

/** TasksRealmRouter 构造选项。 */
export interface TasksRealmRouterOptions {
  /** realm → 账号工作区目录绝对路径(glue 按 accountOf() + userRootFor 解析);undefined=解析失败(fail-closed)。 */
  readonly dirOf: (realm: string) => string | undefined
  /** 实例工厂(缺省按 `dirname(dir)` 为 tenantRoot 建 Store;glue 可注入 report 等选项)。 */
  readonly create?: (dir: string, realm: string) => Store
  /** 池上限(默认 8,23 号 §4-Q1 决议;超出逐出最久未用实例并 close)。 */
  readonly maxInstances?: number
  /** 闲置关库时长 ms(默认 600_000;时钟注入驱动惰性回收)。 */
  readonly idleMs?: number
  readonly now?: () => number
}

/**
 * realm → Store 的 LRU 池(23 号 §3.1 方案 C 同构;35 号 A11)。
 * - `dirOf(realm)`:realm → 账号工作区目录(glue 解析);返回 undefined=该账号无目录
 *   (不隐式建——目录由 access 登录开通创建);
 * - `create(dir, realm)`:实例工厂(缺省 `new Store(realm, { tenantRoot: dirname(dir) })`,
 *   库落 `<dir>/.eterna/tasks.sqlite3`);
 * - 池满按最久未用关库(close 后下次调用重建);显式 dispose 全关(插件配逆)。
 * 实例身份键 = realm 字符串(账号与 workspaces/<账号> 一一对应,由登录开通保证;
 * Store 构造内另有 realm 名安全断言 assertRealmName)。
 */
export class TasksRealmRouter {
  readonly #dirOf: (realm: string) => string | undefined
  readonly #create: (dir: string, realm: string) => Store
  readonly #maxInstances: number
  readonly #idleMs: number
  readonly #now: () => number
  readonly #pool = new Map<string, { store: Store; lastUsedAt: number }>()
  #disposed = false

  constructor(options: TasksRealmRouterOptions) {
    this.#dirOf = options.dirOf
    this.#create = options.create ?? ((dir, realm) => new Store(realm, { tenantRoot: dirname(dir) }))
    this.#maxInstances = options.maxInstances ?? 8
    this.#idleMs = options.idleMs ?? 600_000
    this.#now = options.now ?? ((): number => Date.now())
  }

  /**
   * realm → Store(池内复用或新建)。目录解析失败/已 dispose 返回 undefined
   * (调用方 fail-closed:拒绝该次服务,不隐式建目录、绝不回落共享库)。
   * 每次调用先做一轮惰性回收(闲置超时的实例 close 出池)。
   */
  forRealm(realm: string): Store | undefined {
    if (this.#disposed) return undefined
    this.#reapIdle()
    const existing = this.#pool.get(realm)
    if (existing !== undefined) {
      existing.lastUsedAt = this.#now()
      // Map 迭代序=插入序:重插把它挪到最新位(LRU 语义)
      this.#pool.delete(realm)
      this.#pool.set(realm, existing)
      return existing.store
    }
    const dir = this.#dirOf(realm)
    if (dir === undefined) return undefined
    const store = this.#create(dir, realm)
    this.#pool.set(realm, { store, lastUsedAt: this.#now() })
    this.#evictOverCap()
    return store
  }

  /** 池内当前实例数(测试/巡检面)。 */
  get size(): number {
    return this.#pool.size
  }

  /** 全关(插件配逆;幂等)。 */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const entry of this.#pool.values()) entry.store.close()
    this.#pool.clear()
  }

  #reapIdle(): void {
    const now = this.#now()
    for (const [realm, entry] of this.#pool) {
      if (now - entry.lastUsedAt > this.#idleMs) {
        entry.store.close()
        this.#pool.delete(realm)
      }
    }
  }

  #evictOverCap(): void {
    while (this.#pool.size > this.#maxInstances) {
      const oldest = this.#pool.keys().next()
      if (oldest.done === true) break
      const entry = this.#pool.get(oldest.value)
      entry?.store.close()
      this.#pool.delete(oldest.value)
    }
  }
}
