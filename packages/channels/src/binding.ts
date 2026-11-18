/**
 * 渠道绑定存储(channel_user_id ↔ session_id ↔ thread_key/ticket_id ↔ 渠道类型)。
 *
 * 12 号文档 §7.8:渠道会话绑定与续接由 storage-domain 承载;本模块是该数据面的
 * sqlite 直连实现(node:sqlite DatabaseSync,与 deepseek-harness storage-sqlite 同驱动),
 * 并提供 asDomainKvTable() 视图 —— 结构上即 dsh `KvTable<string, ChannelBindingRecord>`
 * (deepseek-harness packages/storage/storage-domain/src/domain.ts:43),可原样挂进
 * storage-domain(seam 钉住见 tests/types.seam-pin.ts)。
 *
 * 收敛语义:绑定主键是 (channel_type, channel_user_id);多个渠道身份可指向同一
 * session_id(多渠道收敛同一会话);同一身份 re-bind 即"移绑续接"(旧会话让位)。
 *
 * 39 号 §3-E1(24 §5.2 Source 行、27 §3.3 情况 A):绑定目标在 `→ session` 之上**增补**
 * `→ thread / ticket`——新增可空列 thread_key / ticket_id 与对称方法
 * (bindThread/resolveThread/threadBindings);session 维度原签名与现行全部行为保留。
 * 多渠道身份收敛同一 thread 沿用现行机制(多行指向同一目标),不做跨源身份映射
 * (24 §2.2 被拒概念)。thread 绑定不因工单结束而解绑(27 §3.1「追问可恢复已结束工单」):
 * 绑定只有显式 re-bind/unbind 才变化。thread_key 以不透明字符串承载(channels 不解释
 * 其内部结构;与 tasks 侧 ThreadRef 的映射是 39 §9-3 开放问题,归一化侧的解析见 source.ts)。
 */
import { DatabaseSync } from 'node:sqlite'

export interface ChannelBindingRecord {
  readonly channelType: string
  readonly channelUserId: string
  /** session 目标;thread-only 绑定(经 bindThread/KV put)无此字段。 */
  readonly sessionId?: string
  /** thread 目标(增补维度,不透明字符串);session-only 绑定无此字段。 */
  readonly threadKey?: string
  /** ticket 目标(增补维度,不透明字符串)。 */
  readonly ticketId?: string
  readonly boundAt: string
  readonly updatedAt: string
}

export interface BindOutcome {
  readonly sessionId: string
  /** true=新建绑定;false=覆盖旧绑定(移绑续接)。 */
  readonly created: boolean
  readonly previousSessionId?: string
}

/** bindThread 的产出(移绑续接语义同 BindOutcome)。 */
export interface ThreadBindOutcome {
  readonly threadKey: string
  /** true=新建绑定;false=覆盖旧 thread(移绑续接,session 维度不动)。 */
  readonly created: boolean
  readonly previousThreadKey?: string
}

/** resolveThread 的产出:该渠道身份当前指向的目标维度(至少一项在场,否则无绑定)。 */
export interface ThreadTarget {
  readonly threadKey?: string
  readonly ticketId?: string
  readonly sessionId?: string
}

export interface ChannelBindingStoreOptions {
  readonly now?: () => Date
}

const MIGRATION = `
CREATE TABLE IF NOT EXISTS channel_bindings (
  channel_type TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,
  session_id TEXT,
  thread_key TEXT,
  ticket_id TEXT,
  bound_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (channel_type, channel_user_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_bindings_session ON channel_bindings(session_id);
`

interface BindingRow {
  channel_type: string
  channel_user_id: string
  session_id: string | null
  thread_key: string | null
  ticket_id: string | null
  bound_at: string
  updated_at: string
}

function rowToRecord(row: BindingRow): ChannelBindingRecord {
  return {
    channelType: row.channel_type,
    channelUserId: row.channel_user_id,
    ...(row.session_id !== null && { sessionId: row.session_id }),
    ...(row.thread_key !== null && { threadKey: row.thread_key }),
    ...(row.ticket_id !== null && { ticketId: row.ticket_id }),
    boundAt: row.bound_at,
    updatedAt: row.updated_at,
  }
}

/** 绑定键的规范形态(storage-domain KV 表视图的 key)。 */
export function bindingKey(channelType: string, channelUserId: string): string {
  return `${channelType}:${channelUserId}`
}

export class ChannelBindingStore {
  private readonly db: DatabaseSync
  private readonly now: () => Date

  constructor(db: DatabaseSync, options: ChannelBindingStoreOptions = {}) {
    this.db = db
    this.now = options.now ?? ((): Date => new Date())
    this.db.exec(MIGRATION)
    this.ensureColumns()
  }

  /**
   * 旧库补列与增补索引(CREATE TABLE IF NOT EXISTS 对已建库不补列,39 §3-E1):
   * 幂等 ALTER TABLE … ADD COLUMN,带存在性检查;thread 索引在补列之后建
   * (对旧库,索引先于列会因列不存在而失败)。已由旧版建出的库 session_id 仍带
   * NOT NULL 约束——其上的 thread-only 插入会显式报错而非静默降级(本仓 0.0.0 预发布,
   * 不做表重建;新库 session_id 可空)。
   */
  private ensureColumns(): void {
    const columns = new Set(
      (this.db.prepare('PRAGMA table_info(channel_bindings)').all() as unknown as { name: string }[])
        .map(column => column.name),
    )
    if (!columns.has('thread_key')) this.db.exec('ALTER TABLE channel_bindings ADD COLUMN thread_key TEXT')
    if (!columns.has('ticket_id')) this.db.exec('ALTER TABLE channel_bindings ADD COLUMN ticket_id TEXT')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_channel_bindings_thread ON channel_bindings(thread_key)')
  }

  /** 打开(或创建)一个 sqlite 库文件;':memory:' 供测试。 */
  static open(path: string, options?: ChannelBindingStoreOptions): ChannelBindingStore {
    return new ChannelBindingStore(new DatabaseSync(path), options)
  }

  /** 绑定或移绑(upsert):同一渠道身份永远只指向一个会话。 */
  bind(channelType: string, channelUserId: string, sessionId: string): BindOutcome {
    if (channelType.length === 0 || channelUserId.length === 0 || sessionId.length === 0) {
      throw new Error('[channels] bind 参数不能为空')
    }
    const existing = this.resolveSession(channelType, channelUserId)
    const now = this.now().toISOString()
    if (existing === undefined) {
      this.db
        .prepare('INSERT INTO channel_bindings (channel_type, channel_user_id, session_id, bound_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(channelType, channelUserId, sessionId, now, now)
      return { sessionId, created: true }
    }
    this.db
      .prepare('UPDATE channel_bindings SET session_id = ?, updated_at = ? WHERE channel_type = ? AND channel_user_id = ?')
      .run(sessionId, now, channelType, channelUserId)
    return { sessionId, created: false, ...(existing !== sessionId && { previousSessionId: existing }) }
  }

  /** 不抢已有绑定:身份已绑定时返回原会话(用于"续接优先于移绑"的场景)。 */
  bindIfAbsent(channelType: string, channelUserId: string, sessionId: string): BindOutcome {
    const existing = this.resolveSession(channelType, channelUserId)
    if (existing !== undefined) return { sessionId: existing, created: false }
    return this.bind(channelType, channelUserId, sessionId)
  }

  resolveSession(channelType: string, channelUserId: string): string | undefined {
    const stmt = this.db
      .prepare('SELECT session_id FROM channel_bindings WHERE channel_type = ? AND channel_user_id = ?')
    const row = stmt.get(channelType, channelUserId) as { session_id: string | null } | undefined
    return row?.session_id ?? undefined
  }

  /**
   * 绑定或移绑 thread 维度(upsert,39 §3-E1):同一渠道身份永远只指向一个 thread;
   * session 维度不动(bind 与 bindThread 是同一条绑定行上的两个正交目标维度)。
   * thread 绑定不因工单结束而解绑(只有显式 re-bind/unbind 才变化)。
   */
  bindThread(channelType: string, channelUserId: string, threadKey: string): ThreadBindOutcome {
    if (channelType.length === 0 || channelUserId.length === 0 || threadKey.length === 0) {
      throw new Error('[channels] bindThread 参数不能为空')
    }
    const existing = this.resolveThread(channelType, channelUserId)
    const now = this.now().toISOString()
    if (existing === undefined) {
      this.db
        .prepare('INSERT INTO channel_bindings (channel_type, channel_user_id, session_id, thread_key, bound_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)')
        .run(channelType, channelUserId, threadKey, now, now)
      return { threadKey, created: true }
    }
    this.db
      .prepare('UPDATE channel_bindings SET thread_key = ?, updated_at = ? WHERE channel_type = ? AND channel_user_id = ?')
      .run(threadKey, now, channelType, channelUserId)
    return {
      threadKey,
      created: false,
      ...(existing.threadKey !== undefined && existing.threadKey !== threadKey && { previousThreadKey: existing.threadKey }),
    }
  }

  /** 解析该渠道身份当前的全部目标维度(thread/ticket/session);无绑定时 undefined。 */
  resolveThread(channelType: string, channelUserId: string): ThreadTarget | undefined {
    const stmt = this.db
      .prepare('SELECT session_id, thread_key, ticket_id FROM channel_bindings WHERE channel_type = ? AND channel_user_id = ?')
    const row = stmt.get(channelType, channelUserId) as
      | { session_id: string | null; thread_key: string | null; ticket_id: string | null }
      | undefined
    if (row === undefined) return undefined
    return {
      ...(row.thread_key !== null && { threadKey: row.thread_key }),
      ...(row.ticket_id !== null && { ticketId: row.ticket_id }),
      ...(row.session_id !== null && { sessionId: row.session_id }),
    }
  }

  /** 多渠道收敛查询(对称 sessionBindings):某 thread 当前由哪些渠道身份收敛而来。 */
  threadBindings(threadKey: string): readonly ChannelBindingRecord[] {
    const stmt = this.db
      .prepare('SELECT channel_type, channel_user_id, session_id, thread_key, ticket_id, bound_at, updated_at FROM channel_bindings WHERE thread_key = ? ORDER BY channel_type, channel_user_id')
    return (stmt.all(threadKey) as unknown as BindingRow[]).map(rowToRecord)
  }

  /** 多渠道收敛查询:某会话当前由哪些渠道身份收敛而来。 */
  sessionBindings(sessionId: string): readonly ChannelBindingRecord[] {
    const stmt = this.db
      .prepare('SELECT channel_type, channel_user_id, session_id, thread_key, ticket_id, bound_at, updated_at FROM channel_bindings WHERE session_id = ? ORDER BY channel_type, channel_user_id')
    return (stmt.all(sessionId) as unknown as BindingRow[]).map(rowToRecord)
  }

  /** 解绑某渠道身份;返回是否确有绑定被移除。 */
  unbind(channelType: string, channelUserId: string): boolean {
    const stmt = this.db
      .prepare('DELETE FROM channel_bindings WHERE channel_type = ? AND channel_user_id = ?')
    return Number(stmt.run(channelType, channelUserId).changes) > 0
  }

  /** 当前绑定总数(收敛度观测用)。 */
  get size(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM channel_bindings').get() as { n: number }
    return row.n
  }

  /**
   * storage-domain KV 表视图:key = `${channelType}:${channelUserId}`。
   * 结构上可赋值给 dsh `KvTable<string, ChannelBindingRecord>`
   * (get/put/delete/deleteMany/update/entries/keys/size)。
   */
  asDomainKvTable(): {
    get(key: string): ChannelBindingRecord | undefined
    entries(): IterableIterator<[string, ChannelBindingRecord]>
    keys(): IterableIterator<string>
    readonly size: number
    put(key: string, value: ChannelBindingRecord): Promise<void>
    delete(key: string): Promise<boolean>
    deleteMany(keys: readonly string[]): Promise<number>
    update(key: string, fn: (current: ChannelBindingRecord) => ChannelBindingRecord): Promise<ChannelBindingRecord>
  } {
    const db = this.db
    const splitKey = (key: string): { channelType: string; channelUserId: string } => {
      const sep = key.indexOf(':')
      if (sep <= 0 || sep === key.length - 1) throw new Error(`[channels] 非法绑定键: ${key}`)
      return { channelType: key.slice(0, sep), channelUserId: key.slice(sep + 1) }
    }
    const allRecords = (): ChannelBindingRecord[] =>
      (db
        .prepare('SELECT channel_type, channel_user_id, session_id, thread_key, ticket_id, bound_at, updated_at FROM channel_bindings ORDER BY channel_type, channel_user_id')
        .all() as unknown as BindingRow[]).map(rowToRecord)
    const selectRow = (channelType: string, channelUserId: string): BindingRow | undefined =>
      db
        .prepare('SELECT channel_type, channel_user_id, session_id, thread_key, ticket_id, bound_at, updated_at FROM channel_bindings WHERE channel_type = ? AND channel_user_id = ?')
        .get(channelType, channelUserId) as BindingRow | undefined
    return {
      get(key: string): ChannelBindingRecord | undefined {
        const { channelType, channelUserId } = splitKey(key)
        const row = selectRow(channelType, channelUserId)
        return row === undefined ? undefined : rowToRecord(row)
      },
      *entries(): IterableIterator<[string, ChannelBindingRecord]> {
        for (const record of allRecords()) {
          yield [bindingKey(record.channelType, record.channelUserId), record]
        }
      },
      *keys(): IterableIterator<string> {
        for (const record of allRecords()) {
          yield bindingKey(record.channelType, record.channelUserId)
        }
      },
      get size(): number {
        const row = db.prepare('SELECT COUNT(*) AS n FROM channel_bindings').get() as { n: number }
        return row.n
      },
      put(key: string, value: ChannelBindingRecord): Promise<void> {
        const { channelType, channelUserId } = splitKey(key)
        if (value.channelType !== channelType || value.channelUserId !== channelUserId) {
          throw new Error('[channels] put 记录与键不一致')
        }
        // 39 §3-E1:put 校验同步扩展——增补维度若在场必须是非空字符串。
        if (value.threadKey !== undefined && value.threadKey.length === 0) {
          throw new Error('[channels] put threadKey 不能为空字符串')
        }
        if (value.ticketId !== undefined && value.ticketId.length === 0) {
          throw new Error('[channels] put ticketId 不能为空字符串')
        }
        if (value.sessionId !== undefined && value.sessionId.length === 0) {
          throw new Error('[channels] put sessionId 不能为空字符串')
        }
        const nowIso = new Date().toISOString()
        // KV put = 整值替换:三个目标维度(session/thread/ticket)均以记录为准覆写。
        db
          .prepare('INSERT INTO channel_bindings (channel_type, channel_user_id, session_id, thread_key, ticket_id, bound_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(channel_type, channel_user_id) DO UPDATE SET session_id = excluded.session_id, thread_key = excluded.thread_key, ticket_id = excluded.ticket_id, updated_at = excluded.updated_at')
          .run(channelType, channelUserId, value.sessionId ?? null, value.threadKey ?? null, value.ticketId ?? null, nowIso, nowIso)
        return Promise.resolve()
      },
      delete(key: string): Promise<boolean> {
        const { channelType, channelUserId } = splitKey(key)
        const removed = Number(db
          .prepare('DELETE FROM channel_bindings WHERE channel_type = ? AND channel_user_id = ?')
          .run(channelType, channelUserId).changes)
        return Promise.resolve(removed > 0)
      },
      async deleteMany(keys: readonly string[]): Promise<number> {
        let removed = 0
        for (const key of keys) {
          if (await this.delete(key)) removed += 1
        }
        return removed
      },
      async update(key: string, fn: (current: ChannelBindingRecord) => ChannelBindingRecord): Promise<ChannelBindingRecord> {
        const current = this.get(key)
        if (current === undefined) throw new Error(`[channels] update 缺键: ${key}`)
        const next = fn(current)
        await this.put(key, next)
        return next
      },
    }
  }

  close(): void {
    this.db.close()
  }
}
