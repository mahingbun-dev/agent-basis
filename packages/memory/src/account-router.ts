/**
 * 多租户分库路由(23 号设计,M-T1):账号 → 独立 Memory 实例(per-account
 * store 池,方案 C)。数据物理落各账号 workspace 目录(`<tenantRoot>/<account>/
 * .eterna/memory.sqlite3`),隔离强度=物理分库——单账号库被攻破不影响他人,
 * T1「用户数据派生自 workspaces/<账号>」天然达标。
 *
 * 三件套:
 * - `MemorySessionResolver`:会话 → 该账号 Memory 的解析面(glue 实现:access
 *   store sessionOwner→getUserById→userRootFor);undefined=解析失败(fail-closed);
 * - `createDeniedMemory()`:解析失败时的 fail-closed Memory(写一律结构化拒绝,
 *   读一律空,索引只有行为头)——23 §3.1「绝不退回全局库」的落点;
 * - `MemoryAccountRouter`:账号 → Memory 的 LRU 池(Q1 决议:8 实例/10 分钟
 *   闲置关库;单账号库轻,内存可控)。实例创建经注入工厂( glue 闭包注入
 *   PII 守卫/写入策略/时钟等 coeffect,本层零旁路全局)。
 *
 * 降级口径(23 §3.4 TS-1 结论):**access store 在场**(多用户部署)才启用
 * 路由;本地单用户(TUI,无 access 插件)沿用全局库——判定在 glue(有无
 * eternaAccessStore),本包只认 resolver 是否提供。
 */
import { join } from 'node:path'
import { MEMORY_SERVICE_ID, createMemory } from './memory.ts'
import type { Memory, MemorySearchHit } from './memory.ts'
import type { MemoryMetricsReport } from './metrics.ts'
import { NotesStore } from './notes.ts'
import { BuiltinPiiGuard } from './pii.ts'
import type { PiiGuard } from './pii.ts'
import { MEMORY_BEHAVIOR_HEADER } from './index-builder.ts'
import type {
  EntityRecord, EntityWriteInput, EntityWriteResult,
} from './entity-store.ts'
import type { CorrectionAuditEntry, DomainResolveAuditEntry } from './audit.ts'
import type { MemoryIndexOptions, MemoryIndexResult } from './index-builder.ts'
import type { NoteWriteResult } from './notes.ts'

/** 账号解析失败的写入拒绝错误(failureOf 映射为 `{ok:false, blocked:'account'}`)。 */
export class MemoryAccountDeniedError extends Error {
  constructor() {
    super('[memory] 记忆归属账号解析失败(多租户 fail-closed):本次不落库;请从工作区内发起会话后重试')
    this.name = 'MemoryAccountDeniedError'
  }
}

export function isMemoryAccountDeniedError(error: unknown): boolean {
  return error instanceof MemoryAccountDeniedError
}

/**
 * fail-closed Memory(23 §3.1):写一律抛 MemoryAccountDeniedError(工具层转
 * 结构化失败,不中断 turn);读一律空(null/[]);索引只有行为头;账本埋点
 * no-op;dispose no-op。PII 守卫用内置降级(从不触达真实过滤器——写入在它
 * 之前就已被拒)。
 */
export function createDeniedMemory(reason = '账号解析失败'): Memory {
  const denied = new MemoryAccountDeniedError()
  const piiGuard = new BuiltinPiiGuard()
  const notes = new NotesStore(join('.eterna-denied', 'NOTES'), piiGuard)
  const deniedMemory: Memory = {
    id: MEMORY_SERVICE_ID,
    notes,
    entities: undefined as never,
    piiGuard,
    writeEntity(_input: EntityWriteInput): EntityWriteResult {
      throw new MemoryAccountDeniedError()
    },
    async writeNote(): Promise<NoteWriteResult> {
      throw denied
    },
    async appendNote(): Promise<NoteWriteResult> {
      throw denied
    },
    readEntity(): EntityRecord | null {
      return null
    },
    async search(): Promise<readonly MemorySearchHit[]> {
      return []
    },
    forget(subject: string, key: string): { forgotten: number; records: readonly EntityRecord[] } {
      void subject
      void key
      return { forgotten: 0, records: [] }
    },
    review(): EntityRecord | null {
      return null
    },
    listForReview(): readonly EntityRecord[] {
      return []
    },
    touch(): number {
      return 0
    },
    supersede(): EntityRecord | null {
      return null
    },
    buildIndex(options: MemoryIndexOptions = {}): MemoryIndexResult {
      const header = options.behaviorHeader ?? MEMORY_BEHAVIOR_HEADER
      const text = `${header}\n## 记忆索引\n(当前会话的记忆归属不可用:多租户隔离生效中,本次不读写记忆)`
      return { text, total: 0, included: 0, omitted: 0, estimatedTokens: 0 }
    },
    recordDomainResolve(_entry: DomainResolveAuditEntry): void {},
    recordCorrection(_entry: CorrectionAuditEntry): void {},
    metrics(): MemoryMetricsReport {
      return {
        reviews: { approved: 0, rejected: 0, acceptanceRate: null },
        reviewLatencyMs: { count: 0, medianMs: null, maxMs: null },
        corrections: { count: 0, portraitEntries: 0, correctionRate: null },
        domainResolves: { total: 0, bound: 0, workspace: 0, merged: 0, promoted: 0, candidate: 0, none: 0 },
      }
    },
    dispose(): void {},
  }
  void reason
  void denied
  return deniedMemory
}

/**
 * 会话 → 账号 Memory 的解析面(glue 实现:access store 三跳解析 + Router 池)。
 * 返回 undefined = 解析失败(调用方 fail-closed:写入拒绝/读取空)。
 */
export interface MemorySessionResolver {
  forSession(sessionId: string | undefined): Memory | undefined
}

/**
 * 账号 → Memory 实例的 LRU 池(23 §3.1,方案 C;Q1 决议参数:8 实例/10 分钟)。
 * - `dirOf(account)`:账号 → workspace 目录绝对路径(glue 按 userRootFor 解析);
 *   返回 undefined = 该账号无目录(不隐式建——目录由 access 登录开通创建);
 * - `create(dir, account)`:实例工厂(glue 注入 PII/写入策略等 coeffect);
 * - 池满按最久未用关库(close 后下次调用重建);显式 dispose 全关。
 * 实例身份键 = account 字符串(Q3 决议:目录名即账号,access account 与
 * workspaces/<account> 一一对应,由登录开通保证)。
 */
export class MemoryAccountRouter {
  readonly #dirOf: (account: string) => string | undefined
  readonly #create: (dir: string, account: string) => Memory
  readonly #maxInstances: number
  readonly #idleMs: number
  readonly #now: () => number
  readonly #pool = new Map<string, { memory: Memory; lastUsedAt: number }>()
  #disposed = false

  constructor(options: {
    readonly dirOf: (account: string) => string | undefined
    readonly create: (dir: string, account: string) => Memory
    /** 池上限(默认 8,Q1 决议;超出逐出最久未用实例并 close)。 */
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
   * 账号 → Memory(池内复用或新建)。目录解析失败/已 dispose 返回 undefined
   * (调用方 fail-closed:换 createDeniedMemory 或拒绝服务,不隐式建目录)。
   * 每次调用先做一轮惰性回收(闲置超时的实例 close 出池)。
   */
  forAccount(account: string): Memory | undefined {
    if (this.#disposed) return undefined
    this.#reapIdle()
    const existing = this.#pool.get(account)
    if (existing !== undefined) {
      existing.lastUsedAt = this.#now()
      // Map 迭代序=插入序:重插把它挪到最新位(LRU 语义)
      this.#pool.delete(account)
      this.#pool.set(account, existing)
      return existing.memory
    }
    const dir = this.#dirOf(account)
    if (dir === undefined) return undefined
    const memory = this.#create(dir, account)
    this.#pool.set(account, { memory, lastUsedAt: this.#now() })
    this.#evictOverCap()
    return memory
  }

  /** 池内当前实例数(测试/巡检面)。 */
  get size(): number {
    return this.#pool.size
  }

  /** 全关(插件配逆;幂等)。 */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const entry of this.#pool.values()) entry.memory.dispose()
    this.#pool.clear()
  }

  #reapIdle(): void {
    const now = this.#now()
    for (const [account, entry] of this.#pool) {
      if (now - entry.lastUsedAt > this.#idleMs) {
        entry.memory.dispose()
        this.#pool.delete(account)
      }
    }
  }

  #evictOverCap(): void {
    while (this.#pool.size > this.#maxInstances) {
      const oldest = this.#pool.keys().next()
      if (oldest.done === true) break
      const entry = this.#pool.get(oldest.value)
      entry?.memory.dispose()
      this.#pool.delete(oldest.value)
    }
  }
}

/** 便捷面:目录 → Memory 的缺省工厂(本地/测试;glue 传入带 PII/策略的闭包)。 */
export function createDefaultAccountMemory(dir: string, pii?: PiiGuard): Memory {
  return createMemory({
    workspaceDir: join(dir, 'NOTES'),
    dbPath: join(dir, '.eterna', 'memory.sqlite3'),
    ...(pii !== undefined ? { pii } : {}),
  })
}
