/**
 * 知识库账号分库路由(对齐 memory 23 号 M-T1 account-router 口径,packages/memory/
 * src/account-router.ts):账号 → 独立 KnowledgeService 实例(每账号 wiki 目录 +
 * sqlite 索引物理分库),数据落各账号 workspace 目录
 * (`<tenantRoot>/<account>/knowledge.wiki` 与 `<tenantRoot>/<account>/.eterna/
 * knowledge.sqlite3`,隔离强度=物理分库)。
 *
 * 三件套:
 * - `KnowledgeSessionResolver`:会话 → 该账号 KnowledgeService 的解析面(glue 实现:
 *   access store sessionOwner→getUserById→account→Router 池);undefined=解析失败
 *   (fail-closed);
 * - `createDeniedService()`:解析失败时的 fail-closed KnowledgeService(检索一律空,
 *   写入/读取一律结构化拒绝,状态如实报 account-unresolved)——多租户下**绝不退回
 *   全局库**(那是最直接的跨账号泄露面);
 * - `KnowledgeAccountRouter`:账号 → KnowledgeService 的 LRU 池(参数沿用 memory
 *   Q1 决议:8 实例/10 分钟闲置;单账号库轻,内存可控)。
 *
 * 降级口径(memory TS-1 同款):**access store 在场**(多用户部署)才启用路由;本地
 * 单用户(TUI,无 access 插件)沿用全局库——判定在 glue(有无 access 库文件),本包
 * 只认 resolver 是否提供。
 */
import { KnowledgeError } from './errors.ts'
import { KNOWLEDGE_SERVICE_ID } from './service.ts'
import type { KnowledgeService } from './service.ts'
import type { BackendStatusReport, DocPatch, DocRef } from './types.ts'

/**
 * 账号解析失败的知识面容错错误(fail-closed):service 层读/写经此错误拒绝,
 * 工具执行器按工具失败呈现(模型可见原因,不中断会话)。
 */
export class KnowledgeAccountDeniedError extends KnowledgeError {
  constructor(message = '知识库归属账号解析失败(多租户 fail-closed):本次操作被拒绝;请从工作区内发起会话后重试') {
    super(message)
    this.name = 'KnowledgeAccountDeniedError'
  }
}

export function isKnowledgeAccountDeniedError(error: unknown): boolean {
  return error instanceof KnowledgeAccountDeniedError
}

/**
 * 会话 → 账号 KnowledgeService 的解析面(glue 实现:access store sessionOwner→
 * getUserById→account + KnowledgeAccountRouter 池)。undefined=解析失败——调用方
 * fail-closed(换 Denied service:写拒绝/读空),绝不退回全局库。
 */
export interface KnowledgeSessionResolver {
  forSession(sessionId: string | undefined): KnowledgeService | undefined
}

/** Denied 单例(无状态,池化共享;读空/写拒绝/状态如实报不可用)。 */
let deniedServiceSingleton: KnowledgeService | undefined

/**
 * fail-closed KnowledgeService(memory createDeniedMemory 同款语义):
 * - search 一律空(附 degraded 原因,模型可见"为何没有结果");
 * - read/propose 抛 KnowledgeAccountDeniedError(结构化拒绝,不静默丢写);
 * - status 单条不可用报告(configured=false,reason 明示);
 * - registerBackend 返回空 disposer(注册面不报错但绝不生效)、dispose no-op。
 */
export function createDeniedService(): KnowledgeService {
  if (deniedServiceSingleton !== undefined) return deniedServiceSingleton
  const reason = '知识库归属账号解析失败(多租户 fail-closed):本次检索为空、写入被拒;请从工作区内发起会话后重试'
  deniedServiceSingleton = {
    id: KNOWLEDGE_SERVICE_ID,
    registerBackend: () => (): void => {},
    listBackends: () => [],
    search: () => Promise.resolve({ hits: [], contributed: [], degraded: [{ backend: 'wiki-local', reason }] }),
    read: (_ref: DocRef) => Promise.reject(new KnowledgeAccountDeniedError()),
    status: () => Promise.resolve<readonly BackendStatusReport[]>([{
      id: 'wiki-local',
      ok: false,
      reason,
      doc_count: 0,
      capabilities: { write: false, deprecate: false, graph: false },
      configured: false,
    }]),
    propose: (_patch: DocPatch) => Promise.reject(new KnowledgeAccountDeniedError()),
    dispose: () => {},
  }
  return deniedServiceSingleton
}

/**
 * 账号 → KnowledgeService 实例的 LRU 池(memory MemoryAccountRouter 同构):
 * - `dirOf(account)`:账号 → workspace 目录绝对路径(glue 按 tenantRoot/account 解析);
 *   返回 undefined = 该账号无目录(不隐式建——目录由 access 登录开通创建);
 * - `create(dir, account)`:实例工厂(glue 注入 wiki/db 路径与 governance 门禁);
 * - 池满按最久未用关库(dispose 后下次调用重建);显式 dispose 全关。
 * 实例身份键 = account 字符串(目录名即账号,一一对应由登录开通保证)。
 */
export class KnowledgeAccountRouter {
  readonly #dirOf: (account: string) => string | undefined
  readonly #create: (dir: string, account: string) => KnowledgeService
  readonly #maxInstances: number
  readonly #idleMs: number
  readonly #now: () => number
  readonly #pool = new Map<string, { service: KnowledgeService; lastUsedAt: number }>()
  #disposed = false

  constructor(options: {
    readonly dirOf: (account: string) => string | undefined
    readonly create: (dir: string, account: string) => KnowledgeService
    /** 池上限(默认 8,memory Q1 决议口径;超出逐出最久未用实例并 dispose)。 */
    readonly maxInstances?: number
    /** 闲置关库时长 ms(默认 600_000;时钟注入驱动惰性回收)。 */
    readonly idleMs?: number
    readonly now?: () => number
  }) {
    this.#dirOf = options.dirOf
    this.#create = options.create
    this.#maxInstances = options.maxInstances ?? 8
    this.#idleMs = options.idleMs ?? 600_000
    this.#now = options.now ?? ((): number => Date.now())
  }

  /**
   * 账号 → KnowledgeService(池内复用或新建)。目录解析失败/已 dispose 返回
   * undefined(调用方 fail-closed:换 createDeniedService,不隐式建目录)。
   * 每次调用先做一轮惰性回收(闲置超时的实例 dispose 出池)。
   */
  forAccount(account: string): KnowledgeService | undefined {
    if (this.#disposed) return undefined
    this.#reapIdle()
    const existing = this.#pool.get(account)
    if (existing !== undefined) {
      existing.lastUsedAt = this.#now()
      // Map 迭代序=插入序:重插把它挪到最新位(LRU 语义)
      this.#pool.delete(account)
      this.#pool.set(account, existing)
      return existing.service
    }
    const dir = this.#dirOf(account)
    if (dir === undefined) return undefined
    const service = this.#create(dir, account)
    this.#pool.set(account, { service, lastUsedAt: this.#now() })
    this.#evictOverCap()
    return service
  }

  /** 池内当前实例数(测试/巡检面)。 */
  get size(): number {
    return this.#pool.size
  }

  /** 全关(插件配逆;幂等)。 */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const entry of this.#pool.values()) entry.service.dispose()
    this.#pool.clear()
  }

  #reapIdle(): void {
    const now = this.#now()
    for (const [account, entry] of this.#pool) {
      if (now - entry.lastUsedAt > this.#idleMs) {
        entry.service.dispose()
        this.#pool.delete(account)
      }
    }
  }

  #evictOverCap(): void {
    while (this.#pool.size > this.#maxInstances) {
      const oldest = this.#pool.keys().next()
      if (oldest.done === true) break
      const entry = this.#pool.get(oldest.value)
      entry?.service.dispose()
      this.#pool.delete(oldest.value)
    }
  }
}
