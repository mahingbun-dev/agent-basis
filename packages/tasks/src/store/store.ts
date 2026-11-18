/**
 * 领域聚合、KV、settings 版本史与渠道回执的 SQLite 持久化(35 号 A11;34 号 §2.3 store 行)。
 *
 * 语义自 SA src/app/store.ts 重写级校对移植,不变量原样(34 号 §2.3):
 * - 表结构 trigger/disposition/thread/ticket/decision/outbox/trigger_thread/effect/kv
 *   与索引逐表对齐;生成列工作集(ticket.open/active、thread.active/subscribed、
 *   outbox.dropped/pending)令 pass 只扫活跃行,旧库缺列时开库补列并由 SQLite 从
 *   存量 JSON 行回填;
 * - savepoint 嵌套 atomic(内层失败只回滚自己)+ afterCommit(最外层提交后才跑,
 *   回滚层的回调被丢弃)——27 号机制①单写者可串行化的物理基础;
 * - settings 版本史:每保存递增修订号、按块记修订计数(乐观并发),当前 settings
 *   即当前修订的快照、不另存(SA store.ts:183-199 的机制,Versions 泛型类并入本文件);
 *   保存与读取都过 SettingsSchema.parse(类型与 schema 自 policy/settings.ts 来,
 *   35 号 A4 已落地——本层不复制 schema 定义);
 * - receipts:outbox 回执自入队即跟踪(pending/sent/dropped),投递尝试计数在
 *   `reply` effect 行上;`behind` 以「工单+会话」复合键保回执顺序(34 号 §2.3 outbox 行)。
 *
 * 本仓改造(34 号 §2.3「A1 拍板一租户一 SQLite」;23 号 §3.1 先例):
 * - 构造签名增加 realm,库路径派生自租户工作区 `<tenantRoot>/<realm>/.eterna/tasks.sqlite3`
 *   (tenantRoot 缺省 $ETERNA_TENANT_ROOT,再退 $DSH_HOME/workspaces,对齐 access
 *   TenantDeps 惯例)——库路径必须派生自 workspaces/<账号>/ 是 tenant-scan 级断言(34 §4-C);
 * - realm 路由(realm → Store 的 LRU 池)在 realm.ts(TasksRealmRouter),本类绑定单 realm;
 * - schema 迁移机制保留但本仓首版直接建 v1(schema.ts),不搬 SA 10→11 迁移史。
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { threadKey, type Decision, type OutboundMessage, type ReplyStatus, type Repositories, type Thread, type ThreadFact, type ThreadFacts, type Ticket, type Trigger, type TriggerDisposition } from '../core/index.ts'
import { SettingsSchema, type Settings, type SettingsOrigin, type SettingsSave } from '../policy/settings.ts'
import { KV, type Family, type Key } from './kv.ts'
import { OLDEST_SCHEMA, SCHEMA_VERSION, tooOld } from './schema.ts'
import { storeReads } from './reads.ts'

/** 一条 Trigger 在其线程时间线上的位置:先按时间戳、再以 `id` 决胜。 */
export interface TimelinePlace { at: string; id: string }
/** 回执为何被丢弃:其会话永远收不到(`channelGone`),或其 Source 不再监听它(`channelIgnored`)。 */
export type DropReason = 'channelGone' | 'channelIgnored'
/** 自入队即跟踪的出站回执(pending/sent/dropped);投递尝试计数在其 `reply` effect 行上。 */
export interface Receipt extends OutboundMessage { status: ReplyStatus; dropped?: { at: string; reason: DropReason } }
/** 已丢弃的回执,带丢弃时刻与理由。 */
export type Dropped = Receipt & { dropped: { at: string; reason: DropReason } }
/** 已保存的 settings 快照,连同它产生的策略版本与工单通知(`internal` 保存无来源)。 */
export interface SettingsVersion {
  revision: number
  savedAt: string
  source: SettingsOrigin | 'internal'
  block?: SettingsSave
  policyVersion: string
  policyChanged: boolean
  notified: string[]
  settings: Settings
}

/**
 * 生成列与部分索引定义的活跃工作集,使 pass 只扫活跃行。
 * 旧库缺列时开库补列,并由 SQLite 从存量 JSON 行回填。
 */
const SETS: Record<string, Record<string, string>> = {
  ticket: {
    open: "INTEGER AS (CASE WHEN value -> '$.ended' IS NULL THEN 1 END)",
    // 只有最新 Assignment 能 pending/running:Engine 在加下一个之前关掉上一个。
    active: `INTEGER AS (CASE WHEN json_array_length(value, '$.undelivered') > 0
      OR value ->> '$.assignments[#-1].state' IN ('pending', 'running') THEN 1 END)`,
  },
  thread: {
    active: "INTEGER AS (CASE WHEN json_array_length(value, '$.pending') > 0 OR value -> '$.evaluating' IS NOT NULL THEN 1 END)",
    subscribed: "TEXT AS (CASE WHEN json_array_length(value, '$.subscriptions') > 0 THEN value ->> '$.ref.source' END)",
  },
  // 复合键(工单 + 会话)用于保每会话的回执顺序。
  outbox: {
    dropped: "TEXT AS (value ->> '$.dropped.at')",
    pending: `TEXT AS (CASE WHEN value ->> '$.status' = 'pending'
      AND value ->> '$.ticketId' IS NOT NULL THEN (value ->> '$.ticketId') || ' ' || (value ->> '$.channel.thread') END)`,
  },
}

/** realm 必须是安全的账号目录名(非空、非 `.`/`..`、无路径分隔符与 NUL)——fail-closed,防路径逃逸。 */
export function assertRealmName(realm: string): void {
  if (realm === '' || realm === '.' || realm === '..' || realm.includes('/') || realm.includes('\\') || realm.includes('\0')) {
    throw new Error(`非法租户 realm「${realm}」:必须是非空、不含路径分隔符的账号目录名`)
  }
}

/** 租户根基目录:先 $ETERNA_TENANT_ROOT,再 $DSH_HOME/workspaces,末退 cwd/workspaces(access TenantDeps 惯例)。 */
export function defaultTenantRoot(): string {
  return process.env.ETERNA_TENANT_ROOT ?? join(process.env.DSH_HOME ?? process.cwd(), 'workspaces')
}

/** 账号工作区目录 → 本包库文件路径(与 memory 的 `.eterna/memory.sqlite3` 同目录惯例,23 号 §3.1)。 */
export function tasksDbPath(workspaceDir: string): string {
  return join(workspaceDir, '.eterna', 'tasks.sqlite3')
}

/** Store 构造选项。 */
export interface StoreOptions {
  /** 账号工作区目录;显式给定即覆盖 tenantRoot+realm 派生(realm 路由默认工厂与 glue 用)。 */
  readonly workspaceDir?: string
  /** 租户根基目录;缺省 defaultTenantRoot()(库路径派生自 workspaces/<账号>/ 的断言基)。 */
  readonly tenantRoot?: string
  /** 接收 afterCommit 回调抛出的错误,不让已提交事务失败。 */
  readonly report?: (error: unknown) => void
}

/** 以重组建替动态 delete(oxlint no-dynamic-delete 仓规):JSON 对象语义与键序无关。 */
function withoutKeys(source: Record<string, unknown>, drop: ReadonlySet<string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([name]) => !drop.has(name)))
}

/**
 * SQLite 落地 Store:实现领域 `Repositories`、只读视图查询、版本化 settings、outbox 回执与 KV。
 * Runtime 锁定状态目录后开库,并在打开时自动迁移受支持的旧 schema。
 * Engine 在 `atomic` 事务内改领域聚合;Sources、视图与 Outbox 读状态或更新各自的记录。
 * 一库一 realm:查询天然按租户过滤,无需 SQL 改造(34 号 §2.3 reads 行)。
 */
export class Store implements Repositories {
  readonly db: DatabaseSync
  /** 库文件绝对路径(派生自租户工作区;tenant-scan 断言与路由面共用)。 */
  readonly path: string
  /** 本库绑定的租户 realm(一租户一 SQLite;路由见 realm.ts)。 */
  readonly realm: string
  /** 该租户的账号工作区目录(库路径的派生基;35 号 A22:worker session 一律建在租户 realm 工作区内)。 */
  readonly workspaceDir: string
  private readonly report: (error: unknown) => void
  /**
   * 打开(或创建)realm 的 SQLite 库;schema 守卫与建表在一个事务内完成。
   * @throws 当库 schema 旧于 `OLDEST_SCHEMA`(tooOld 拒开)、新于 `SCHEMA_VERSION`
   *   (前向守卫)或建表/迁移失败时;任何失败都不改库文件并关闭句柄,使同进程稍后可重试。
   */
  constructor(realm: string, options: StoreOptions = {}) {
    assertRealmName(realm)
    this.realm = realm
    this.report = options.report ?? (() => {})
    const workspace = options.workspaceDir ?? join(options.tenantRoot ?? defaultTenantRoot(), realm)
    this.workspaceDir = workspace
    this.path = tasksDbPath(workspace)
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(this.path)
    this.read = storeReads(this.db)
    try {
      chmodSync(this.path, 0o600)
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
      const version = this.get(KV.store.schema)
      if (version !== undefined && version > SCHEMA_VERSION) throw new Error(`不支持的 tasks 数据库版本 ${version}`)
      if (version !== undefined && version < OLDEST_SCHEMA) throw new Error(tooOld(version))
      const migrating = version !== undefined && version < SCHEMA_VERSION
      try {
        this.atomic(() => {
          this.db.exec(`
            CREATE TABLE IF NOT EXISTS trigger (id TEXT PRIMARY KEY, value TEXT NOT NULL, at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS disposition (id TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS thread (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS ticket (id TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS decision (id TEXT PRIMARY KEY, thread TEXT NOT NULL, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS trigger_thread (thread TEXT NOT NULL, id TEXT NOT NULL, at TEXT NOT NULL, human INTEGER NOT NULL,
              PRIMARY KEY (thread, id));
            CREATE TABLE IF NOT EXISTS effect (kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, seq INTEGER NOT NULL,
              generation INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', due INTEGER NOT NULL,
              since TEXT NOT NULL, PRIMARY KEY (kind, key));
            CREATE INDEX IF NOT EXISTS trigger_at ON trigger(at);
            CREATE INDEX IF NOT EXISTS trigger_thread_at ON trigger_thread(thread, at);
            CREATE INDEX IF NOT EXISTS decision_thread ON decision(thread);
            CREATE INDEX IF NOT EXISTS effect_due ON effect(kind, due, seq);
          `)
          this.addColumns()
          // 本仓首版为 v1、OLDEST_SCHEMA=1:migrating 恒为 false。未来升版在此按 version
          // 逐级迁移(机制见 schema.ts 文件头;SA migrateTo11 的同构位)。
          if (version !== SCHEMA_VERSION) this.set(KV.store.schema, SCHEMA_VERSION)
        })
      } catch (error) {
        if (!migrating) throw error
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(`tasks 数据库停在 schema ${version} 未被改动:迁移到 schema ${SCHEMA_VERSION} 失败:${reason}`, { cause: error })
      }
    } catch (error) {
      this.db.close()
      throw error
    }
  }
  /** 打开早期版本创建的库时,对账生成列工作集与索引。 */
  private addColumns(): void {
    const columns = (table: string) => new Set(this.db.prepare('SELECT name FROM pragma_table_xinfo(?)').all(table).map(row => String(row.name)))
    for (const [table, definitions] of Object.entries(SETS)) {
      // 定义变更或已移除的生成列连同其索引先删,再补当前定义。
      const sql = (this.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { sql?: string } | undefined)?.sql ?? ''
      const generated = this.db.prepare('SELECT name FROM pragma_table_xinfo(?) WHERE hidden IN (2, 3)').all(table).map(row => String(row.name))
      for (const name of generated) {
        if (definitions[name] !== undefined && sql.includes(`${name} ${definitions[name]}`)) continue
        this.db.exec(`DROP INDEX IF EXISTS ${table}_${name}; ALTER TABLE ${table} DROP COLUMN ${name}`)
      }
      const existing = columns(table)
      for (const [name, definition] of Object.entries(definitions)) {
        if (!existing.has(name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
        this.db.exec(`CREATE INDEX IF NOT EXISTS ${table}_${name} ON ${table}(${name}) WHERE ${name} IS NOT NULL`)
      }
    }
    if (!columns('effect').has('generation')) this.db.exec('ALTER TABLE effect ADD COLUMN generation INTEGER NOT NULL DEFAULT 0')
  }
  /** 关闭底层 SQLite 连接。 */
  close(): void { this.db.close() }
  /** 解析 `sql` 返回行的 JSON `value` 列。 */
  private values<T>(sql: string, ...parameters: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...parameters).map(row => JSON.parse(String(row.value)) as T)
  }
  /** 重建某 Trigger 的线程索引,替换同一 Trigger 早前保存留下的行。 */
  private indexThreads(trigger: Trigger): void {
    this.db.prepare('DELETE FROM trigger_thread WHERE id=?').run(trigger.id)
    const insert = this.db.prepare('INSERT OR IGNORE INTO trigger_thread VALUES (?,?,?,?)')
    for (const ref of trigger.threads) insert.run(threadKey(ref), trigger.id, trigger.at, trigger.human ? 1 : 0)
  }
  private depth = 0
  /** 按保存点层级索引的提交后回调队列;回滚某层即丢弃该层回调。 */
  private readonly committed: (() => void)[][] = []
  /**
   * 在保存点事务内执行 `operation`(若已在事务内则嵌套);失败回滚其变更。
   * 提交后回调只在外层事务提交后运行,回调错误经 `report` 上报、不失败已提交事务。
   */
  atomic<T>(operation: () => T): T {
    const level = this.depth++
    const name = `tasks_atomic_${level}`
    const queued: (() => void)[] = []
    this.committed[level] = queued
    this.db.exec(`SAVEPOINT ${name}`)
    let value: T
    try { value = operation(); this.db.exec(`RELEASE ${name}`) }
    catch (error) { this.db.exec(`ROLLBACK TO ${name}`); this.db.exec(`RELEASE ${name}`); throw error }
    finally { this.depth-- }
    // 失败路径在 catch 已 rethrow,不会到达这里:回滚层的回调(queued)就此丢弃。
    const actions = this.committed.splice(level)[0] ?? queued
    const parent = level > 0 ? this.committed[level - 1] : undefined
    if (parent) parent.push(...actions)
    else for (const action of actions) { try { action() } catch (error) { this.report(error) } }
    return value
  }
  /**
   * 安排 `action` 在最外层事务提交后运行;事务外立即运行。
   * 被回滚的事务内排入的回调永不运行。afterCommit 用于提交后的即时内存跟进(如刷新健康面、
   * 取消内存中的回合)——不能等 effect 队列、也无需熬过重启的跟进;熬过崩溃的持久副作用用 Effects。
   */
  afterCommit(action: () => void): void {
    const current = this.depth > 0 ? this.committed[this.depth - 1] : undefined
    if (current) current.push(action)
    else action()
  }
  /** 按 `KV` 中的键读一条类型化 KV 记录。 */
  get<V>(name: Key<V>): V | undefined {
    const row = this.db.prepare('SELECT value FROM kv WHERE key=?').get(name)
    return row === undefined ? undefined : JSON.parse(String(row.value)) as V
  }
  /** 在 `name` 下写一条类型化 KV 记录。 */
  set<V>(name: Key<V>, value: V): void {
    this.db.prepare('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(name, JSON.stringify(value))
  }
  /** 删除 `name` 处的 KV 记录。 */
  delete(name: string): void { this.db.prepare('DELETE FROM kv WHERE key=?').run(name) }
  /** 枚举 `family`(或前缀)下的全部 KV 键。 */
  keys<V>(family: Family<V, never>): Key<V>[]
  keys(prefix: string): string[]
  keys(family: string | { prefix: string }): string[] {
    const prefix = typeof family === 'string' ? family : family.prefix
    const pattern = `${prefix.replace(/[\\%_]/g, match => `\\${match}`)}%`
    return this.db.prepare("SELECT key FROM kv WHERE key LIKE ? ESCAPE '\\'").all(pattern).map(row => String(row.key))
  }

  /** 版本化记录的泛型存储:KV 表内的编号快照 + 当前修订指针(SA src/app/versions.ts 并入,34 §2.3)。 */
  private readonly settingsVersions = new Versions<SettingsVersion>(this, KV.settings.revision, KV.settings.version)
  /** 当前已校验 settings(=当前修订快照的载荷);未有快照时取全默认的出厂形态(SettingsSchema.parse({}))。 */
  settings(): Settings { return SettingsSchema.parse(this.settingsVersions.current()?.settings ?? {}) }
  /** 某配置块的修订号;每页配置对各自的块做乐观并发保存。 */
  blockRevision(block: SettingsSave): number { return this.get(KV.settings.block(block)) ?? 0 }
  /** 把 settings 校验后存为下一修订(并成为当前);`record.block` 存在时递增该块的修订计数。 */
  saveSettings(value: unknown, record: Omit<SettingsVersion, 'revision' | 'savedAt' | 'settings'> = { source: 'internal', policyVersion: '', policyChanged: false, notified: [] }): Settings {
    const settings = SettingsSchema.parse(value)
    return this.atomic(() => {
      this.settingsVersions.save(revision => ({ ...record, revision, savedAt: new Date().toISOString(), settings }))
      if (record.block !== undefined) this.set(KV.settings.block(record.block), this.blockRevision(record.block) + 1)
      return settings
    })
  }
  /** 已保存的 settings 修订,最新在前;早于 settings 版本史的修订不存在。 */
  settingsHistory(limit = 20): SettingsVersion[] { return this.settingsVersions.list(limit) }

  readonly triggers = {
    get: (id: string): Trigger | undefined => {
      const row = this.db.prepare('SELECT value FROM trigger WHERE id=?').get(id)
      return row === undefined ? undefined : JSON.parse(String(row.value)) as Trigger
    },
    save: (trigger: Trigger): void => {
      this.atomic(() => {
        this.db.prepare('INSERT INTO trigger VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value, at=excluded.at').run(trigger.id, JSON.stringify(trigger), trigger.at)
        this.indexThreads(trigger)
      })
    },
    disposition: (id: string): TriggerDisposition | undefined => {
      const row = this.db.prepare('SELECT value FROM disposition WHERE id=?').get(id)
      return row === undefined ? undefined : JSON.parse(String(row.value)) as TriggerDisposition
    },
    saveDisposition: (id: string, value: TriggerDisposition): void => {
      this.db.prepare('INSERT INTO disposition VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(id, JSON.stringify(value))
    },
  }
  readonly threads = {
    get: (key: string): Thread | undefined => {
      const row = this.db.prepare('SELECT value FROM thread WHERE key=?').get(key)
      return row === undefined ? undefined : JSON.parse(String(row.value)) as Thread
    },
    save: (thread: Thread): void => {
      this.db.prepare('INSERT INTO thread VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(thread.key, JSON.stringify(thread))
    },
    list: (): Thread[] => this.db.prepare('SELECT value FROM thread ORDER BY rowid').all().map(row => JSON.parse(String(row.value)) as Thread),
    active: (): Thread[] => this.values('SELECT value FROM thread WHERE active = 1 ORDER BY rowid'),
    /** 更新人可读的线程元数据(`label`、`url` 与 `facts`,`null` 按 id 删一条事实);线程不存在时 no-op。 */
    describe: (key: string, patch: { label?: string; url?: string; facts?: Record<string, ThreadFact | null> }): void => {
      const thread = this.threads.get(key)
      if (!thread) return
      const entries = Object.entries(patch.facts ?? {})
      const removed = new Set(entries.filter(([, fact]) => fact === null).map(([id]) => id))
      const facts = { ...withoutKeys((thread.meta.facts as ThreadFacts | undefined) ?? {}, removed) } as ThreadFacts
      for (const [id, fact] of entries) { if (fact !== null) facts[id] = fact }
      const label = patch.label === undefined ? {} : { label: patch.label }
      const url = patch.url === undefined ? {} : { url: patch.url }
      const meta = { ...thread.meta, ...label, ...url, facts }
      if (JSON.stringify(meta) !== JSON.stringify(thread.meta)) this.threads.save({ ...thread, meta })
    },
    /** 重读线程后原子地设置(或以 `undefined` 移除)若干 Source 专属元数据键;线程不存在时 no-op。 */
    patchMeta: (key: string, patch: Record<string, unknown>): void => {
      this.atomic(() => {
        const thread = this.threads.get(key)
        if (!thread) return
        const entries = Object.entries(patch)
        const dropped = new Set(entries.filter(([, value]) => value === undefined).map(([name]) => name))
        const kept = Object.fromEntries(entries.filter(([, value]) => value !== undefined))
        const meta = withoutKeys({ ...thread.meta, ...kept }, dropped)
        if (JSON.stringify(meta) !== JSON.stringify(thread.meta)) this.threads.save({ ...thread, meta })
      })
    },
  }
  readonly tickets = {
    get: (id: string): Ticket | undefined => {
      const row = this.db.prepare('SELECT value FROM ticket WHERE id=?').get(id)
      return row === undefined ? undefined : JSON.parse(String(row.value)) as Ticket
    },
    save: (ticket: Ticket): void => {
      this.db.prepare('INSERT INTO ticket VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(ticket.id, JSON.stringify(ticket))
    },
    /** 最新在前。 */
    list: (): Ticket[] => this.values('SELECT value FROM ticket ORDER BY rowid DESC'),
    /** 最新在前。 */
    open: (): Ticket[] => this.values('SELECT value FROM ticket WHERE open = 1 ORDER BY rowid DESC'),
    /** 最新在前。 */
    active: (): Ticket[] => this.values('SELECT value FROM ticket WHERE active = 1 ORDER BY rowid DESC'),
  }
  readonly decisions = {
    get: (id: string): Decision | undefined => {
      const row = this.db.prepare('SELECT value FROM decision WHERE id=?').get(id)
      return row === undefined ? undefined : JSON.parse(String(row.value)) as Decision
    },
    save: (decision: Decision): void => {
      this.db.prepare('INSERT INTO decision VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value, thread=excluded.thread').run(decision.id, decision.threadKey, JSON.stringify(decision))
    },
    byThread: (key: string): Decision[] => this.db.prepare('SELECT value FROM decision WHERE thread=? ORDER BY rowid').all(key).map(row => JSON.parse(String(row.value)) as Decision),
  }
  /** 管理视图、orchestrator 工具与 Source 轮询的只读查询(见 reads.ts)。 */
  readonly read: ReturnType<typeof storeReads>

  /** 队列中某条消息的投递状态;回执永久保留,消息 id 因此幂等。 */
  replyStatus(id: string): ReplyStatus | undefined { return this.receipts.get(id)?.status }
  /** 渠道投递的回执;只有 `Outbox` 写 receipts。 */
  readonly receipts = {
    get: (id: string): Receipt | undefined => this.values<Receipt>('SELECT value FROM outbox WHERE id = ?', id)[0],
    /** pending 回执,最旧在前。 */
    waiting: (): Receipt[] => this.values("SELECT value FROM outbox WHERE value ->> '$.status' = 'pending' ORDER BY rowid"),
    /** 同一工单、同一会话是否还有更早的 pending 消息(且其 `reply` effect 连续失败少于 `failures` 次)。 */
    behind: (id: string, failures: number): boolean => {
      const earlier = this.db.prepare(`SELECT 1 FROM outbox earlier
        JOIN outbox message ON message.id = ? LEFT JOIN effect ON effect.kind = 'reply' AND effect.key = earlier.id
        WHERE earlier.pending = message.pending AND earlier.rowid < message.rowid AND IFNULL(effect.attempts, 0) < ? LIMIT 1`).get(id, failures)
      return earlier !== undefined
    },
    /**
     * 记录一条新的 pending 回执;已记录过的消息 id 保留其原始回执。
     * @returns 该消息 id 是否为新记录。
     */
    add: (message: OutboundMessage): boolean => {
      const receipt: Receipt = { ...message, status: 'pending' }
      return this.db.prepare('INSERT OR IGNORE INTO outbox (id, value) VALUES (?, ?)').run(message.id, JSON.stringify(receipt)).changes > 0
    },
    /**
     * 把一条 pending 回执标记为 sent 或 dropped(带理由与时刻);消息在发送中被撤回时重建回执,
     * 使其 id 不能再次入队。
     */
    settle: (message: OutboundMessage, outcome: 'sent' | DropReason): void => {
      const settled = outcome === 'sent' ? { status: 'sent' } : { status: 'dropped', dropped: { at: new Date().toISOString(), reason: outcome } }
      const { id, channel, text, kind, ticketId } = message
      const updated = this.db.prepare("UPDATE outbox SET value = json_patch(value, ?) WHERE id = ? AND value ->> '$.status' = 'pending'")
        .run(JSON.stringify(settled), id)
      if (updated.changes === 0) this.db.prepare('INSERT OR IGNORE INTO outbox (id, value) VALUES (?, ?)')
        .run(id, JSON.stringify({ id, channel, text, kind, ...ticketId !== undefined ? { ticketId } : {}, ...settled }))
    },
    /**
     * 撤回一条尚未发出的 pending 消息。
     * @returns 是否确有一条 pending 的该 id 消息被移除。
     */
    withdraw: (id: string): boolean =>
      this.db.prepare("DELETE FROM outbox WHERE id = ? AND value ->> '$.status' = 'pending'").run(id).changes > 0,
  }
}

/**
 * 版本化记录存储:Store KV 表内的编号快照 + 当前修订指针(34 号 §2.3「Versions 泛型
 * 版本史类保留在 store 内部」)。每次保存写新快照并原子推进指针——保留全史且不复制当前记录。
 * Store 的 settings 版本史与 Prompts 的配置版本史(35 号 A23)各持有一个实例。
 */
export class Versions<V extends { revision: number }> {
  private readonly store: Pick<Store, 'get' | 'set' | 'keys' | 'atomic'>
  private readonly pointer: Key<number>
  private readonly family: Family<V, [revision: number]>
  constructor(store: Pick<Store, 'get' | 'set' | 'keys' | 'atomic'>, pointer: Key<number>, family: Family<V, [revision: number]>) {
    this.store = store
    this.pointer = pointer
    this.family = family
  }
  /** 当前修订号;首次保存前为 0。 */
  revision(): number { return this.store.get(this.pointer) ?? 0 }
  /** 当前快照;首次保存前 undefined。 */
  current(): V | undefined {
    const revision = this.store.get(this.pointer)
    return revision === undefined ? undefined : this.get(revision)
  }
  get(revision: number): V | undefined { return this.store.get(this.family(revision)) }
  save(make: (revision: number) => V): V {
    return this.store.atomic(() => {
      const version = make(this.revision() + 1)
      this.store.set(this.family(version.revision), version)
      this.store.set(this.pointer, version.revision)
      return version
    })
  }
  /** 存一份快照但不推进当前修订指针(如记录初始基线)。 */
  keep(version: V): void { this.store.set(this.family(version.revision), version) }
  list(limit = Infinity): V[] {
    return this.store.keys(this.family).flatMap(name => this.store.get(name) ?? []).sort((a, b) => b.revision - a.revision).slice(0, limit)
  }
}
