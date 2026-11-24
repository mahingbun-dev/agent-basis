/**
 * 用户存储:node:sqlite 单文件(knowledge 先例,零原生依赖),WAL;users 表落
 * ETERNA_ACCESS_DIR(默认 $DSH_HOME/access,卷上)。删除护栏(不能删自己/
 * 最后一个 admin)在 store 层强制。D11:管理员建号遇重名自动追加数字后缀
 * (base→base01→base02…两位零填充,99 满进三位,超 32 位截基座保后缀)。
 * pwv:password_version 随改密递增,会话载荷比对实现改密即全端下线。
 */
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { hashPassword, validateAccount, validatePassword, verifyPassword } from './password.ts'
import { decayBias } from './thinking-score.ts'

/** WS-C(37 号 M-1):审批人第三角色。中文「审批人」仅 UI 文案层(index.tsx i18n),
 *  此处沿英文小写枚举先例。B2 领域专家角色复用时只改此联合类型 + CHECK 迁移函数
 *  参数(37 号 §3 M-5 锚①/§7 缺口 8;tests/role-expansion-anchor.spec.ts 防旁路)。 */
export type UserRole = 'admin' | 'approver' | 'user'

export interface UserRow {
  readonly id: number
  readonly account: string
  readonly nickname: string
  readonly role: UserRole
  readonly passwordVersion: number
}

export interface UserSummary {
  readonly id: number
  readonly account: string
  readonly nickname: string
  readonly role: UserRole
  readonly createdAt: string
  readonly hasAvatar: boolean
}

export class AccountExistsError extends Error {}
export class SelfDeleteError extends Error {}
export class LastAdminError extends Error {}
export class UserNotFoundError extends Error {}
export class OldPasswordMismatchError extends Error {}
export class NicknamePolicyError extends Error {}
export class SuffixExhaustedError extends Error {}
/** MCP 个人层:目标行不存在或不属于本人(路由层统一映射 403,不区分二者防枚举)。 */
export class McpServerNotFoundError extends Error {}
/** MCP 个人层:serverName 已占用(含与全局/插件命名空间冲突)。 */
export class McpServerNameConflictError extends Error {}

/** MCP 个人层传输(与 47 §7 schema 的两值域一致)。 */
export type McpTransport = 'stdio' | 'streamable-http'

/** mcp_personal_server 行(仅 access 库,按 user_id 隔离)。 */
export interface McpServerRow {
  readonly id: string
  readonly userId: number
  readonly name: string
  readonly serverName: string
  readonly transport: McpTransport
  readonly catalogId: string | undefined
  readonly command: string | undefined
  readonly args: readonly string[] | undefined
  readonly url: string | undefined
  readonly headers: Readonly<Record<string, string>> | undefined
  readonly enabled: boolean
  readonly createdAt: number
  readonly updatedAt: number
}

/** upsert 收口输入(serverName 由路由层生成;command/args 只来自管理员目录)。 */
export interface McpServerInput {
  readonly id?: string
  readonly name: string
  readonly serverName: string
  readonly transport: McpTransport
  readonly catalogId?: string | null
  readonly command?: string | null
  readonly args?: readonly string[] | null
  readonly url?: string | null
  readonly headers?: Readonly<Record<string, string>> | null
  readonly enabled?: boolean
}

const NICKNAME_MAX = 32
const ACCOUNT_MAX = 32
const SUFFIX_MAX_N = 9999

/** 角色值 CHECK 子句(建表语句与迁移重建共用同一生成源,防两处字面漂移)。 */
function roleCheckOf(allowedRoles: readonly string[]): string {
  return `CHECK(role IN (${allowedRoles.map(role => `'${role}'`).join(',')}))`
}

/**
 * M-1(37 号 §3):存量库 users 表 CHECK 约束迁移——SQLite 的 CHECK 不可 ALTER,
 * 按官方 ALTER TABLE §7 十二步流程的必要子集重建表壳:
 * - 判定:sqlite_master 的建表 SQL 缺任一允许角色值 ⇒ 旧形态(新库/已迁移库跳过,幂等);
 * - 重建:事务外存 `PRAGMA foreign_keys` 原值并 OFF(事务内设置是 no-op)→ 事务内
 *   CREATE 新表(新 CHECK,列集与现表一致)→ 显式列名拷行(**禁 `SELECT *`**——两表
 *   列序若漂移即错位)→ DROP 旧表 → RENAME → 提交 → `PRAGMA foreign_key_check`
 *   核对(空)→ 恢复原 foreign_keys 值。任何一步失败抛出(fail-loud——启动失败
 *   优于静默半迁移库);
 * - 子表(workspaces/sessions/approvals/notifications/user_plugins)不动:重建仅换
 *   父表壳,行 id 与 FK 引用不变。
 * 运维形态(37 号 §7 缺口 4,未拍板):「构造器内静默幂等迁移」系自选默认;若评审定
 * 部署窗口+卷快照(23 §3.3/§4 Q4 先例),本函数前移为显式脚本——代码同源,可直接复用。
 * allowedRoles 参数化(§7 缺口 8):B2 领域专家角色二次迁移时复用。
 */
export function migrateRoleConstraint(db: DatabaseSync, allowedRoles: readonly string[] = ['admin', 'approver', 'user']): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as
    | { sql: string }
    | undefined
  if (row === undefined) return
  if (allowedRoles.every(role => row.sql.includes(`'${role}'`))) return
  const fkBefore = (db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys
  db.exec('PRAGMA foreign_keys = OFF')
  try {
    db.exec('BEGIN IMMEDIATE')
    db.exec(`CREATE TABLE users_m (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_version INTEGER NOT NULL DEFAULT 1,
      role TEXT NOT NULL ${roleCheckOf(allowedRoles)},
      avatar BLOB,
      avatar_mime TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    db.exec(
      'INSERT INTO users_m (id, account, nickname, password_hash, password_version, role, avatar, avatar_mime, created_at) ' +
      'SELECT id, account, nickname, password_hash, password_version, role, avatar, avatar_mime, created_at FROM users',
    )
    db.exec('DROP TABLE users')
    db.exec('ALTER TABLE users_m RENAME TO users')
    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* 事务已不在(如 BEGIN 即失败) */ }
    db.exec(`PRAGMA foreign_keys = ${fkBefore}`)
    throw error
  }
  const violations = db.prepare('PRAGMA foreign_key_check').all()
  if (violations.length > 0) {
    db.exec(`PRAGMA foreign_keys = ${fkBefore}`)
    throw new Error(`users 表角色约束迁移后 foreign_key_check 非空: ${JSON.stringify(violations)}`)
  }
  db.exec(`PRAGMA foreign_keys = ${fkBefore}`)
}

/**
 * 思考强度自动模式列迁移(2026-11-18):sessions 补 `thinking_auto`(默认 1)。
 * SQLite 的 ADD COLUMN 不可重复执行,以 pragma table_info 判定幂等;失败抛出
 * (fail-loud,与 migrateRoleConstraint 同纪律)。默认开启系用户拍板:存量与新
 * 会话均自动选档,按会话可关(模型菜单「自动」chip → /api/session/thinkingAuto)。
 */
export function migrateSessionsThinkingAuto(db: DatabaseSync): void {
  const columns = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
  if (columns.some(column => column.name === 'thinking_auto')) return
  db.exec('ALTER TABLE sessions ADD COLUMN thinking_auto INTEGER NOT NULL DEFAULT 1')
}

/**
 * 思考强度反馈偏置列迁移(V2,2026-11-18):sessions 补 `thinking_bias`(REAL,默认 0)
 * 与 `thinking_bias_at`(INTEGER epoch ms,默认 0=从未反馈)。
 * 读时按 24h 半衰衰减(thinking-score.decayBias),写入只存原始值与时间戳 ⇒
 * 衰减口径可随代码调整而不必回改历史数据。幂等判定同 thinking_auto(fail-loud)。
 */
export function migrateSessionsThinkingBias(db: DatabaseSync): void {
  const columns = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
  if (!columns.some(column => column.name === 'thinking_bias')) {
    db.exec('ALTER TABLE sessions ADD COLUMN thinking_bias REAL NOT NULL DEFAULT 0')
  }
  if (!columns.some(column => column.name === 'thinking_bias_at')) {
    db.exec('ALTER TABLE sessions ADD COLUMN thinking_bias_at INTEGER NOT NULL DEFAULT 0')
  }
}

/**
 * B14(2026-11-20):MCP 个人层两表迁移。user_version 门闩(0→1),旧库重开幂等;
 * 建表 DDL 严格照 47 §7(未增删列):server 行只存 server_name/transport/目录解析后的
 * command/args 或 http url/headers 占位,secret 行只存 AES-256-GCM 密文 BLOB。
 * 迁移失败抛错(fail-loud:半迁移库不可继续服务)。
 */
export const MCP_PERSONAL_SCHEMA_VERSION = 1

export function migrateMcpPersonalSchema(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
  if ((row?.user_version ?? 0) >= MCP_PERSONAL_SCHEMA_VERSION) return
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS mcp_personal_server (
      id            TEXT PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(id),
      name          TEXT NOT NULL,
      server_name   TEXT NOT NULL,
      transport     TEXT NOT NULL CHECK(transport IN ('stdio','streamable-http')),
      catalog_id    TEXT,
      command       TEXT,
      args_json     TEXT,
      url           TEXT,
      headers_json  TEXT,
      enabled       INTEGER NOT NULL DEFAULT 1,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      UNIQUE(user_id, server_name)
    )`)
    db.exec(`CREATE TABLE IF NOT EXISTS mcp_personal_secret (
      id          TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      ref         TEXT NOT NULL,
      ciphertext  BLOB NOT NULL,
      created_at  INTEGER NOT NULL,
      UNIQUE(user_id, ref)
    )`)
    db.exec(`PRAGMA user_version = ${MCP_PERSONAL_SCHEMA_VERSION}`)
    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* BEGIN 即失败时事务不存在 */ }
    throw error
  }
}

export interface CreateUserInput {
  readonly account: string
  readonly password: string
  readonly role?: UserRole
  readonly nickname?: string
}

/** D11 候选序列:基名 → 基名01…基名09 → 基名10…基名99 → 基名100…;超 32 位截基座保后缀。 */
export function* accountCandidates(base: string): Generator<string> {
  yield base
  for (let n = 1; n <= SUFFIX_MAX_N; n++) {
    const suffix = String(n).padStart(2, '0')
    const trimmed = base.length + suffix.length > ACCOUNT_MAX ? base.slice(0, ACCOUNT_MAX - suffix.length) : base
    yield trimmed + suffix
  }
}

interface StoredRow {
  readonly id: number
  readonly account: string
  readonly nickname: string
  readonly role: string
  readonly password_hash: string
  readonly password_version: number
}

export class UserStore {
  private readonly db: DatabaseSync

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_version INTEGER NOT NULL DEFAULT 1,
      role TEXT NOT NULL ${roleCheckOf(['admin', 'approver', 'user'])},
      avatar BLOB,
      avatar_mime TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    this.db.exec(`CREATE TABLE IF NOT EXISTS workspaces (
      workspace_id TEXT PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      path TEXT NOT NULL
    )`)
    this.db.exec(`CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      requester_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      decided_by INTEGER,
      decided_at TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    this.db.exec(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    // 55 号:版本更新介绍已读账(每账号每版一行;任何关闭路径都记,55 号 D2)。
    this.db.exec(`CREATE TABLE IF NOT EXISTS release_notes_seen (
      user_id  INTEGER NOT NULL REFERENCES users(id),
      version  TEXT    NOT NULL,
      via      TEXT    NOT NULL,
      seen_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, version)
    )`)
    this.db.exec(`CREATE TABLE IF NOT EXISTS user_plugins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      plugin_id TEXT NOT NULL UNIQUE,
      dir TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      promoted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, dir)
    )`)
    this.db.exec(`CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      workspace_id TEXT,
      thinking_auto INTEGER NOT NULL DEFAULT 1,
      thinking_bias REAL NOT NULL DEFAULT 0,
      thinking_bias_at INTEGER NOT NULL DEFAULT 0
    )`)
    // 子代理父子归属(2026-11-24):子会话**不入 sessions 归属账本**(沿既有设计意图
    // ——thinking_auto/usage 归属等口径不因 subagent 而变),只记父子边;归属判定
    // 在读取时沿父链上溯(见 resolveSessionOwner)。表存在的唯一理由:一元守卫与
    // mux 流绑定都要在同步判定里拿到父链,而上游 wire 的 parentSessionId 只在
    // session/list 响应里出现——故落库缓存,来源=subagent/start 生命周期 + list 回填。
    this.db.exec(`CREATE TABLE IF NOT EXISTS session_children (
      session_id TEXT PRIMARY KEY,
      parent_session_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    // T6 装载器(2026-11-18):公共层共享插件记账(转内置产物;拷贝制,与个人行解耦——
    // 原作者删除不影响共享存续,隔离计划 §T7-B「已转内置的插件存续于公共层」)。
    this.db.exec(`CREATE TABLE IF NOT EXISTS shared_plugins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plugin_id TEXT NOT NULL UNIQUE,
      dir TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    // M-1:存量库 CHECK 迁移(建表语句之后;插件每次启动都走构造器——幂等,新库跳过)
    migrateRoleConstraint(this.db)
    // 思考强度自动模式(2026-11-18):存量库补列——SQLite 的 ADD COLUMN 幂等以
    // pragma table_info 判定;默认 1 = 存量与新会话均默认自动(用户拍板),可按会话关闭。
    migrateSessionsThinkingAuto(this.db)
    // V2(2026-11-18):反馈偏置两列(读时衰减;写入只存原始值与时间戳)
    migrateSessionsThinkingBias(this.db)
    // B14(2026-11-20):MCP 个人层两表(user_version 门闩;旧库升级幂等)
    migrateMcpPersonalSchema(this.db)
  }

  close(): void {
    this.db.close()
  }

  /** 表空且传入预置值时播种 admin(直用基名,不走后缀);幂等,返回是否播种。 */
  seedAdmin(account: string | undefined, password: string | undefined): boolean {
    if (account === undefined || password === undefined || account === '' || password === '') return false
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }
    if (row.n > 0) return false
    this.insert(account, password, 'admin', account)
    return true
  }

  private insert(account: string, password: string, role: UserRole, nickname: string): UserRow {
    validateAccount(account)
    validatePassword(password)
    if (nickname.length < 1 || nickname.length > NICKNAME_MAX) {
      throw new NicknamePolicyError(`昵称长度须在 1-${NICKNAME_MAX} 位之间`)
    }
    try {
      this.db.prepare('INSERT INTO users (account, nickname, password_hash, role) VALUES (?, ?, ?, ?)')
        .run(account, nickname, hashPassword(password), role)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('UNIQUE')) throw new AccountExistsError('账号已存在')
      throw error
    }
    const row = this.db.prepare('SELECT id, password_version FROM users WHERE account = ?').get(account) as
      { id: number; password_version: number }
    return { id: row.id, account, nickname, role, passwordVersion: row.password_version }
  }

  /**
   * D11:基名可用则直用;重名逐个尝试数字后缀候选(手工占用的同后缀号自动跳过),
   * UNIQUE 约束为最终仲裁。昵称默认=最终账号。
   */
  createUserWithSuffix(input: CreateUserInput): { user: UserRow; finalAccount: string } {
    for (const candidate of accountCandidates(input.account)) {
      try {
        const user = this.insert(candidate, input.password, input.role ?? 'user', input.nickname ?? candidate)
        return { user, finalAccount: candidate }
      } catch (error) {
        if (!(error instanceof AccountExistsError)) throw error
      }
    }
    throw new SuffixExhaustedError(`账号 ${input.account} 的后缀候选已耗尽`)
  }

  /** 登录校验:无此号/密码错一律 null(不区分,防枚举)。 */
  verifyLogin(account: string, password: string): UserRow | null {
    const row = this.db.prepare(
      'SELECT id, account, nickname, role, password_hash, password_version FROM users WHERE account = ?',
    ).get(account) as StoredRow | undefined
    if (row === undefined) return null
    if (!verifyPassword(password, row.password_hash)) return null
    return {
      id: row.id,
      account: row.account,
      nickname: row.nickname,
      role: row.role as UserRole,
      passwordVersion: row.password_version,
    }
  }

  getPasswordVersion(id: number): number | undefined {
    const row = this.db.prepare('SELECT password_version FROM users WHERE id = ?').get(id) as
      | { password_version: number }
      | undefined
    return row === undefined ? undefined : row.password_version
  }

  /** 按账号名查用户 id(归属登记的 realm→账号映射读取面;单查询不验密,不暴露行本体)。 */
  userIdByAccount(account: string): number | undefined {
    const row = this.db.prepare('SELECT id FROM users WHERE account = ?').get(account) as
      | { id: number }
      | undefined
    return row === undefined ? undefined : row.id
  }

  getUserById(id: number): UserRow | undefined {
    const row = this.db.prepare('SELECT id, account, nickname, role, password_version FROM users WHERE id = ?').get(id) as
      | { id: number; account: string; nickname: string; role: string; password_version: number }
      | undefined
    if (row === undefined) return undefined
    return {
      id: row.id,
      account: row.account,
      nickname: row.nickname,
      role: row.role as UserRole,
      passwordVersion: row.password_version,
    }
  }

  listUsers(): UserSummary[] {
    const rows = this.db.prepare(
      'SELECT id, account, nickname, role, created_at, avatar FROM users ORDER BY id',
    ).all() as Array<{ id: number; account: string; nickname: string; role: string; created_at: string; avatar: unknown }>
    return rows.map(row => ({
      id: row.id,
      account: row.account,
      nickname: row.nickname,
      role: row.role as UserRole,
      createdAt: row.created_at,
      hasAvatar: row.avatar !== null && row.avatar !== undefined,
    }))
  }

  setNickname(id: number, nickname: string): void {
    if (nickname.length < 1 || nickname.length > NICKNAME_MAX) {
      throw new NicknamePolicyError(`昵称长度须在 1-${NICKNAME_MAX} 位之间`)
    }
    this.requireRow(id)
    this.db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run(nickname, id)
  }

  /** 改密须验旧密;新密走完整策略校验;password_version 递增 → 旧会话全部失效。 */
  setPassword(id: number, oldPassword: string, newPassword: string): void {
    const row = this.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id) as
      | { password_hash: string }
      | undefined
    if (row === undefined) throw new UserNotFoundError(`用户 ${id} 不存在`)
    if (!verifyPassword(oldPassword, row.password_hash)) throw new OldPasswordMismatchError('旧密码不正确')
    this.db.prepare('UPDATE users SET password_hash = ?, password_version = password_version + 1 WHERE id = ?')
      .run(hashPassword(newPassword), id)
  }

  /** M-3(37 号 §3)角色写面:store 层不判角色语义(值域与护栏在 routes 层),
   *  沿 setPassword 形态(requireRow + UPDATE);G2-C5 即时生效=角色读取面动态查库。 */
  setUserRole(id: number, role: UserRole): void {
    this.requireRow(id)
    this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id)
  }

  setAvatar(id: number, avatar: Uint8Array | null, mime: string | null): void {
    this.requireRow(id)
    this.db.prepare('UPDATE users SET avatar = ?, avatar_mime = ? WHERE id = ?').run(avatar, mime, id)
  }

  getAvatar(id: number): { data: Uint8Array; mime: string } | undefined {
    const row = this.db.prepare('SELECT avatar, avatar_mime FROM users WHERE id = ?').get(id) as
      | { avatar: unknown; avatar_mime: string | null }
      | undefined
    if (row === undefined || !(row.avatar instanceof Uint8Array)) return undefined
    return { data: row.avatar, mime: row.avatar_mime ?? 'image/png' }
  }

  /** 删除护栏:不能删自己;最后一个 admin 不可删。sessions/workspaces 的 owner_id
   * 外键引用 users(node:sqlite 默认开 FK 强制),须先级联清理登记行再删人,否则
   * FOREIGN KEY constraint failed → 500。 */
  deleteUser(id: number, actorId: number): void {
    if (id === actorId) throw new SelfDeleteError('不能删除自己的账号')
    const row = this.db.prepare('SELECT role FROM users WHERE id = ?').get(id) as { role: string } | undefined
    if (row === undefined) throw new UserNotFoundError(`用户 ${id} 不存在`)
    if (row.role === 'admin') {
      const admins = this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }
      if (admins.n <= 1) throw new LastAdminError('最后一个管理员不可删除')
    }
    this.db.prepare('DELETE FROM sessions WHERE owner_id = ?').run(id)
    this.db.prepare('DELETE FROM workspaces WHERE owner_id = ?').run(id)
    this.db.prepare('DELETE FROM user_plugins WHERE user_id = ?').run(id)
    this.db.prepare('DELETE FROM approvals WHERE requester_id = ?').run(id)
    this.db.prepare('DELETE FROM notifications WHERE user_id = ?').run(id)
    this.db.prepare('DELETE FROM release_notes_seen WHERE user_id = ?').run(id)
    // B14:MCP 个人层两表随人级联(否则 FK 约束失败/孤儿密文残留)
    this.db.prepare('DELETE FROM mcp_personal_secret WHERE user_id = ?').run(id)
    this.db.prepare('DELETE FROM mcp_personal_server WHERE user_id = ?').run(id)
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id)
  }

  private requireRow(id: number): void {
    const row = this.db.prepare('SELECT id FROM users WHERE id = ?').get(id)
    if (row === undefined) throw new UserNotFoundError(`用户 ${id} 不存在`)
  }

  // ── Phase 2 租户归属表(T2.2):workspace/session 归属,守卫路由的判定源 ──

  recordWorkspace(workspaceId: string, ownerId: number, path: string): void {
    this.db.prepare(
      'INSERT INTO workspaces (workspace_id, owner_id, path) VALUES (?, ?, ?) ' +
      'ON CONFLICT(workspace_id) DO UPDATE SET owner_id = excluded.owner_id, path = excluded.path',
    ).run(workspaceId, ownerId, path)
  }

  forgetWorkspace(workspaceId: string): void {
    this.db.prepare('DELETE FROM workspaces WHERE workspace_id = ?').run(workspaceId)
    this.db.prepare('DELETE FROM sessions WHERE workspace_id = ?').run(workspaceId)
  }

  workspaceOwner(workspaceId: string): number | undefined {
    const row = this.db.prepare('SELECT owner_id FROM workspaces WHERE workspace_id = ?').get(workspaceId) as
      | { owner_id: number }
      | undefined
    return row === undefined ? undefined : row.owner_id
  }

  /** 属主+路径查工作区 id(根工作区幂等判定用)。 */
  workspaceIdByOwnerPath(ownerId: number, path: string): string | undefined {
    const row = this.db.prepare('SELECT workspace_id FROM workspaces WHERE owner_id = ? AND path = ?').get(ownerId, path) as
      | { workspace_id: string }
      | undefined
    return row === undefined ? undefined : row.workspace_id
  }

  /** 该用户名下是否已有任何工作区(登录开通判定用)。 */
  ownsAnyWorkspace(ownerId: number): boolean {
    const row = this.db.prepare('SELECT 1 FROM workspaces WHERE owner_id = ? LIMIT 1').get(ownerId)
    return row !== undefined
  }

  workspacePath(workspaceId: string): string | undefined {
    const row = this.db.prepare('SELECT path FROM workspaces WHERE workspace_id = ?').get(workspaceId) as
      | { path: string }
      | undefined
    return row === undefined ? undefined : row.path
  }

  recordSession(sessionId: string, ownerId: number, workspaceId: string | null): void {
    this.db.prepare(
      'INSERT INTO sessions (session_id, owner_id, workspace_id) VALUES (?, ?, ?) ' +
      'ON CONFLICT(session_id) DO UPDATE SET owner_id = excluded.owner_id, workspace_id = excluded.workspace_id',
    ).run(sessionId, ownerId, workspaceId)
  }

  /**
   * 会话归属:直接账本行优先;缺席则沿子代理父链上溯(2026-11-24)。
   *
   * 子代理子会话从不入 sessions 账本(设计意图:thinking_auto/usage 等按会话计价的
   * 口径不因 subagent 而变),其归属=最近的已入账祖先。上游一切会话型 RPC
   * (session/projections、session/follow、session/state、session/events…)都以
   * 本函数为唯一判定源,故父链回退必须在**这里**而不是各守卫分支各自补——否则
   * 每加一个端点就得再修一遍(本次事故正是 projections 与 follow 两处漏改同时炸)。
   *
   * 环防护:parent 链最多上溯 32 层(实测层级 ≤ 3;异常数据下不得死循环)。
   * @param sessionId - 待判定的会话 id(可能是子代理子会话)。
   * @returns 归属用户 id;无归属(孤儿/未登记/超深)返回 undefined。
   */
  sessionOwner(sessionId: string): number | undefined {
    const direct = this.db.prepare('SELECT owner_id FROM sessions WHERE session_id = ?').get(sessionId) as
      | { owner_id: number }
      | undefined
    if (direct !== undefined) return direct.owner_id
    return this.ownerOfAncestor(sessionId, 32)
  }

  /** 沿 child→parent 边上溯至最近的已入账祖先(上限 maxHops,防环)。 */
  private ownerOfAncestor(sessionId: string, maxHops: number): number | undefined {
    let current = sessionId
    const visited = new Set<string>()
    for (let hop = 0; hop < maxHops; hop += 1) {
      if (visited.has(current)) return undefined
      visited.add(current)
      const edge = this.db.prepare('SELECT parent_session_id FROM session_children WHERE session_id = ?').get(current) as
        | { parent_session_id: string }
        | undefined
      if (edge === undefined) return undefined
      const owner = this.db.prepare('SELECT owner_id FROM sessions WHERE session_id = ?').get(edge.parent_session_id) as
        | { owner_id: number }
        | undefined
      if (owner !== undefined) return owner.owner_id
      current = edge.parent_session_id
    }
    return undefined
  }

  /**
   * 记一条子代理父子边(幂等;来源 = subagent/start 生命周期 + session/list 回填)。
   *
   * 只记边、不建 sessions 归属行:子会话因此仍不进 usage 归属与 thinking_auto 口径,
   * 而归属判定经 {@link sessionOwner} 的父链回退照旧可达。
   * @param childSessionId - 子代理子会话 id。
   * @param parentSessionId - 其直接父会话 id。
   */
  recordChildSession(childSessionId: string, parentSessionId: string): void {
    if (childSessionId === parentSessionId) return
    this.db.prepare(
      'INSERT INTO session_children (session_id, parent_session_id) VALUES (?, ?) ' +
      'ON CONFLICT(session_id) DO UPDATE SET parent_session_id = excluded.parent_session_id',
    ).run(childSessionId, parentSessionId)
  }

  /** 已记的子代理父子边数量(回填幂等判定/观测用)。 */
  childSessionCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM session_children').get() as { n: number }
    return row.n
  }

  /** 某会话的直接子会话 id 列表(父链判定与清理用)。 */
  childSessionsOf(parentSessionId: string): string[] {
    const rows = this.db.prepare('SELECT session_id FROM session_children WHERE parent_session_id = ?')
      .all(parentSessionId) as Array<{ session_id: string }>
    return rows.map(row => row.session_id)
  }

  // ── 思考强度自动模式(2026-11-18):每会话开关,sessions.thinking_auto 列 ──

  /**
   * 该会话是否开启自动选档。列默认 1(存量/新建会话均默认开启,用户拍板);
   * **行不存在返回 false**——subagent/系统任务的会话不在归属账本,天然不启用。
   */
  thinkingAutoOf(sessionId: string): boolean {
    const row = this.db.prepare('SELECT thinking_auto FROM sessions WHERE session_id = ?').get(sessionId) as
      | { thinking_auto: number }
      | undefined
    return row !== undefined && row.thinking_auto === 1
  }

  /** 按会话写开关;返回是否命中(未知会话=false,不隐式建行——归属记账才建)。 */
  setThinkingAuto(sessionId: string, enabled: boolean): boolean {
    const r = this.db.prepare('UPDATE sessions SET thinking_auto = ? WHERE session_id = ?')
      .run(enabled ? 1 : 0, sessionId)
    return Number(r.changes) > 0
  }

  // ── 思考强度反馈偏置(V2,2026-11-18):sessions.thinking_bias/_at ─────

  /**
   * 读该会话的原始偏置与写入时刻;从未反馈(或会话不在账本)→ undefined。
   * 衰减不在存储层做:调用方用 `decayBias(raw, at, now)` 换算有效值。
   */
  thinkingBiasOf(sessionId: string): { readonly bias: number; readonly updatedAt: number } | undefined {
    const row = this.db.prepare('SELECT thinking_bias, thinking_bias_at FROM sessions WHERE session_id = ?')
      .get(sessionId) as { thinking_bias: number; thinking_bias_at: number } | undefined
    if (row === undefined || row.thinking_bias_at === 0) return undefined
    return { bias: row.thinking_bias, updatedAt: row.thinking_bias_at }
  }

  /**
   * 叠加一次反馈偏置:先按 24h 半衰把存量偏置衰减到 `now`,再加减 delta,
   * 钳位 [-0.5,0.5] 后连同 `now` 落库(同向累计、反向抵消、久未操作自然衰减)。
   * 未知会话返回 undefined(不隐式建行,归属记账才建)。
   */
  addThinkingBias(sessionId: string, delta: number, now: number): { readonly bias: number } | undefined {
    const row = this.db.prepare('SELECT thinking_bias, thinking_bias_at FROM sessions WHERE session_id = ?')
      .get(sessionId) as { thinking_bias: number; thinking_bias_at: number } | undefined
    if (row === undefined) return undefined
    const current = decayBias(row.thinking_bias, row.thinking_bias_at, now)
    const next = Math.max(-0.5, Math.min(0.5, current + delta))
    this.db.prepare('UPDATE sessions SET thinking_bias = ?, thinking_bias_at = ? WHERE session_id = ?')
      .run(next, now, sessionId)
    return { bias: next }
  }

  /**
   * 清零该会话的反馈偏置(`thinking_bias = 0`、`thinking_bias_at = 0`;后者归零让
   * `thinkingBiasOf` 回到 undefined=从未反馈)。纯 UPDATE+WHERE,**不 INSERT**——
   * 未知会话不建行,返回是否命中行。
   * `_now` 按契约不落库(at 必须为 0),保留第二参只为与 `addThinkingBias` 同形,
   * 调用方用同一时刻做审计时间戳。
   * boolean 语义=「命中行」而非「原本非零」:SQLite 把同值 UPDATE 也计入 changes,
   * 故对已清零会话重复 reset 仍返回 true(幂等)。
   */
  resetThinkingBias(sessionId: string, _now: number): boolean {
    const r = this.db.prepare('UPDATE sessions SET thinking_bias = 0, thinking_bias_at = 0 WHERE session_id = ?')
      .run(sessionId)
    return Number(r.changes) > 0
  }

  // ── P4-T6(2026-11-11):双层插件记账(个人层激活清单;装载=进程内按行启用) ──

  /** 个人插件记账行。 */
  recordUserPlugin(userId: number, pluginId: string, dir: string, enabled: boolean): void {
    this.db.prepare(
      'INSERT INTO user_plugins (user_id, plugin_id, dir, enabled) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(plugin_id) DO UPDATE SET dir = excluded.dir, enabled = excluded.enabled',
    ).run(userId, pluginId, dir, enabled ? 1 : 0)
  }

  /** 启停(仅本人行;返回是否命中)。 */
  setUserPluginEnabled(userId: number, pluginId: string, enabled: boolean): boolean {
    const r = this.db.prepare('UPDATE user_plugins SET enabled = ? WHERE user_id = ? AND plugin_id = ?')
      .run(enabled ? 1 : 0, userId, pluginId)
    return Number(r.changes) > 0
  }

  /** 标记已转内置(拷贝制:原件停用,公共层接管)。 */
  markUserPluginPromoted(userId: number, pluginId: string): boolean {
    const r = this.db.prepare('UPDATE user_plugins SET promoted = 1, enabled = 0 WHERE user_id = ? AND plugin_id = ?')
      .run(userId, pluginId)
    return Number(r.changes) > 0
  }

  userPluginsOfOwner(ownerId: number): Array<{ pluginId: string; dir: string; enabled: boolean; promoted: boolean }> {
    const rows = this.db.prepare('SELECT plugin_id, dir, enabled, promoted FROM user_plugins WHERE user_id = ?').all(ownerId) as
      Array<{ plugin_id: string; dir: string; enabled: number; promoted: number }>
    return rows.map(row => ({ pluginId: row.plugin_id, dir: row.dir, enabled: row.enabled === 1, promoted: row.promoted === 1 }))
  }

  userPluginOwner(pluginId: string): number | undefined {
    const row = this.db.prepare('SELECT user_id FROM user_plugins WHERE plugin_id = ?').get(pluginId) as
      | { user_id: number }
      | undefined
    return row === undefined ? undefined : row.user_id
  }

  /** 全量启用行(T6 bootScan 用;装载器启动期扫描个人层激活清单)。 */
  allEnabledUserPlugins(): Array<{ pluginId: string; dir: string; userId: number }> {
    const rows = this.db.prepare('SELECT plugin_id, dir, user_id FROM user_plugins WHERE enabled = 1').all() as
      Array<{ plugin_id: string; dir: string; user_id: number }>
    return rows.map(row => ({ pluginId: row.plugin_id, dir: row.dir, userId: row.user_id }))
  }

  // ── T6(2026-11-18):公共层共享插件记账(转内置真装载的激活清单) ──

  /** 共享插件记账(upsert;转内置拷贝完成后与 admin 启停共用)。 */
  recordSharedPlugin(pluginId: string, dir: string, enabled: boolean): void {
    this.db.prepare(
      'INSERT INTO shared_plugins (plugin_id, dir, enabled) VALUES (?, ?, ?) ' +
      'ON CONFLICT(plugin_id) DO UPDATE SET dir = excluded.dir, enabled = excluded.enabled',
    ).run(pluginId, dir, enabled ? 1 : 0)
  }

  setSharedPluginEnabled(pluginId: string, enabled: boolean): boolean {
    const r = this.db.prepare('UPDATE shared_plugins SET enabled = ? WHERE plugin_id = ?')
      .run(enabled ? 1 : 0, pluginId)
    return Number(r.changes) > 0
  }

  sharedPlugins(): Array<{ pluginId: string; dir: string; enabled: boolean }> {
    const rows = this.db.prepare('SELECT plugin_id, dir, enabled FROM shared_plugins').all() as
      Array<{ plugin_id: string; dir: string; enabled: number }>
    return rows.map(row => ({ pluginId: row.plugin_id, dir: row.dir, enabled: row.enabled === 1 }))
  }

  // ── P4-T7(2026-11-11):审批流+站内通知数据面(users.db 同库新表,泛化模型) ──

  ensureApprovalSchema(): void {
    // 表在构造器统一建立;此方法保留接口幂等(approvals.ts 调用面)
    this.db.exec(`CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      requester_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      decided_by INTEGER,
      decided_at TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    this.db.exec(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
  }

  approvalRegister(type: string, payload: unknown, requesterId: number): number {
    const r = this.db.prepare('INSERT INTO approvals (type, payload, requester_id) VALUES (?, ?, ?)')
      .run(type, JSON.stringify(payload), requesterId)
    return Number(r.lastInsertRowid)
  }

  approvalPendingId(type: string, requesterId: number): number | undefined {
    const row = this.db.prepare(
      "SELECT id FROM approvals WHERE type = ? AND requester_id = ? AND status = 'pending'",
    ).get(type, requesterId) as { id: number } | undefined
    return row?.id
  }

  approvalDecide(id: number, deciderId: number, approve: boolean, note: string): boolean {
    const row = this.db.prepare('SELECT id, requester_id, status, type FROM approvals WHERE id = ?').get(id) as
      | { id: number; requester_id: number; status: string; type: string }
      | undefined
    if (row === undefined || row.status !== 'pending') return false
    this.db.prepare("UPDATE approvals SET status = ?, decided_by = ?, decided_at = datetime('now'), note = ? WHERE id = ?")
      .run(approve ? 'approved' : 'rejected', deciderId, note, id)
    this.notificationInsert(row.requester_id, approve ? 'approval.approved' : 'approval.rejected',
      `你的「${row.type}」请求(#${id})已${approve ? '通过' : '驳回'}${note !== '' ? `:${note}` : ''}`)
    return true
  }

  approvalRow(id: number): { type: string; payload: string } | undefined {
    const row = this.db.prepare('SELECT type, payload FROM approvals WHERE id = ?').get(id) as
      | { type: string; payload: string }
      | undefined
    return row
  }

  approvalsPending(): Array<Record<string, unknown>> {
    return this.db.prepare("SELECT * FROM approvals WHERE status = 'pending' ORDER BY id DESC").all()
  }

  approvalsMine(userId: number): Array<Record<string, unknown>> {
    return this.db.prepare('SELECT * FROM approvals WHERE requester_id = ? ORDER BY id DESC').all(userId)
  }

  notificationInsert(userId: number, kind: string, message: string): void {
    this.db.prepare('INSERT INTO notifications (user_id, kind, message) VALUES (?, ?, ?)').run(userId, kind, message)
  }

  notifyAdmins(kind: string, message: string): void {
    const admins = this.db.prepare("SELECT id FROM users WHERE role = 'admin'").all() as Array<{ id: number }>
    for (const admin of admins) this.notificationInsert(admin.id, kind, message)
  }

  notificationsOf(userId: number): Array<Record<string, unknown>> {
    return this.db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(userId)
  }

  notificationsUnread(userId: number): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0').get(userId) as { n: number }
    return row.n
  }

  notificationsMarkAllRead(userId: number): void {
    this.db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(userId)
  }

  approvalsForget(userId: number): void {
    this.db.prepare('DELETE FROM approvals WHERE requester_id = ?').run(userId)
    this.db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userId)
  }

  /** 级联销毁(T8):删用户时清其插件登记行。 */
  forgetUserPlugins(ownerId: number): void {
    this.db.prepare('DELETE FROM user_plugins WHERE user_id = ?').run(ownerId)
  }

  /** 该账号已读的版本集合(55 号 §4.2;历史列表的未读点判定源)。 */
  releaseNotesSeen(userId: number): ReadonlySet<string> {
    const rows = this.db.prepare('SELECT version FROM release_notes_seen WHERE user_id = ?').all(userId) as
      Array<{ version: string }>
    return new Set(rows.map(row => row.version))
  }

  /**
   * 记已读(幂等)。`INSERT OR IGNORE` = 首次关闭的 via/seen_at 永久保留,
   * 「设置 → 更新记录」回看不会改写历史(55 号 §2.2)。
   */
  markReleaseNotesSeen(userId: number, version: string, via: string): void {
    this.db.prepare(
      'INSERT OR IGNORE INTO release_notes_seen (user_id, version, via) VALUES (?, ?, ?)',
    ).run(userId, version, via)
  }

  /** 单行已读记录(首次关闭原因与时间;回看不改写由 markReleaseNotesSeen 保证)。 */
  releaseNotesSeenRow(userId: number, version: string): { readonly via: string; readonly seenAt: string } | undefined {
    const row = this.db.prepare('SELECT via, seen_at FROM release_notes_seen WHERE user_id = ? AND version = ?')
      .get(userId, version) as { via: string; seen_at: string } | undefined
    return row === undefined ? undefined : { via: row.via, seenAt: row.seen_at }
  }

  /** 单行移除(个人插件 remove)。 */
  forgetUserPlugin(pluginId: string): boolean {
    const r = this.db.prepare('DELETE FROM user_plugins WHERE plugin_id = ?').run(pluginId)
    return Number(r.changes) > 0
  }

  // ── B14(2026-11-20):MCP 个人层存取(users.db 同库两表,所有查询带 user_id) ──

  private static mcpRowOf(raw: Record<string, unknown>): McpServerRow {
    const args = typeof raw.args_json === 'string' ? parseJsonArray(raw.args_json) : undefined
    const headers = typeof raw.headers_json === 'string' ? parseJsonRecord(raw.headers_json) : undefined
    return {
      id: String(raw.id),
      userId: Number(raw.user_id),
      name: String(raw.name),
      serverName: String(raw.server_name),
      transport: raw.transport === 'stdio' ? 'stdio' : 'streamable-http',
      catalogId: typeof raw.catalog_id === 'string' ? raw.catalog_id : undefined,
      command: typeof raw.command === 'string' ? raw.command : undefined,
      args,
      url: typeof raw.url === 'string' ? raw.url : undefined,
      headers,
      enabled: Number(raw.enabled) === 1,
      createdAt: Number(raw.created_at),
      updatedAt: Number(raw.updated_at),
    }
  }

  private mcpSelect(where: string, ...params: Array<string | number>): McpServerRow[] {
    const rows = this.db.prepare(`SELECT * FROM mcp_personal_server WHERE ${where}`).all(...params) as Array<Record<string, unknown>>
    return rows.map(row => UserStore.mcpRowOf(row))
  }

  /** 本人全部条目(最近更新最后;id/name 均由服务端记账)。 */
  listMcpServers(userId: number): McpServerRow[] {
    return this.mcpSelect('user_id = ? ORDER BY created_at, rowid', userId)
  }

  /** 仅启用行(挂载面;上限由路由层控制)。 */
  listEnabledMcpServers(userId: number): McpServerRow[] {
    return this.mcpSelect('user_id = ? AND enabled = 1 ORDER BY created_at, rowid', userId)
  }

  /** 属主+id 单查(禁止先在路由层按 id 查再判属主——统一 403 防枚举)。 */
  getMcpServer(userId: number, id: string): McpServerRow | undefined {
    return this.mcpSelect('user_id = ? AND id = ?', userId, id)[0]
  }

  countMcpServers(userId: number): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM mcp_personal_server WHERE user_id = ?').get(userId) as { n: number }
    return row.n
  }

  /** 新建/更新本人行;id 缺省=新建。不存在的 id/他人 id 抛 NotFound(路由统一 403)。 */
  upsertMcpServer(userId: number, input: McpServerInput): McpServerRow {
    const now = Date.now()
    const enabled = input.enabled === false ? 0 : 1
    const argsJson = input.args === undefined || input.args === null ? null : JSON.stringify([...input.args])
    const headersJson = input.headers === undefined || input.headers === null ? null : JSON.stringify(input.headers)
    try {
      if (input.id !== undefined) {
        const r = this.db.prepare(
          'UPDATE mcp_personal_server SET name = ?, server_name = ?, transport = ?, catalog_id = ?, command = ?, ' +
          'args_json = ?, url = ?, headers_json = ?, enabled = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        ).run(
          input.name, input.serverName, input.transport, input.catalogId ?? null, input.command ?? null,
          argsJson, input.url ?? null, headersJson, enabled, now, input.id, userId,
        )
        if (Number(r.changes) === 0) throw new McpServerNotFoundError('MCP 条目不存在或不属于你')
        const row = this.getMcpServer(userId, input.id)
        if (row === undefined) throw new McpServerNotFoundError('MCP 条目不存在或不属于你')
        return row
      }
      const id = randomUUID()
      this.db.prepare(
        'INSERT INTO mcp_personal_server (id, user_id, name, server_name, transport, catalog_id, command, args_json, ' +
        'url, headers_json, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        id, userId, input.name, input.serverName, input.transport, input.catalogId ?? null, input.command ?? null,
        argsJson, input.url ?? null, headersJson, enabled, now, now,
      )
      const row = this.getMcpServer(userId, id)
      if (row === undefined) throw new McpServerNotFoundError('MCP 条目写入后不可读')
      return row
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('UNIQUE')) throw new McpServerNameConflictError('server_name 已被占用')
      throw error
    }
  }

  deleteMcpServer(userId: number, id: string): boolean {
    const r = this.db.prepare('DELETE FROM mcp_personal_server WHERE id = ? AND user_id = ?').run(id, userId)
    return Number(r.changes) > 0
  }

  setMcpServerEnabled(userId: number, id: string, enabled: boolean): boolean {
    const r = this.db.prepare('UPDATE mcp_personal_server SET enabled = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(enabled ? 1 : 0, Date.now(), id, userId)
    return Number(r.changes) > 0
  }

  /** 密文写入(明文只在路由层加密后进入;ref 按用户唯一)。 */
  putMcpSecret(userId: number, ref: string, ciphertext: Uint8Array): void {
    this.db.prepare(
      'INSERT INTO mcp_personal_secret (id, user_id, ref, ciphertext, created_at) VALUES (?, ?, ?, ?, ?) ' +
      'ON CONFLICT(user_id, ref) DO UPDATE SET ciphertext = excluded.ciphertext',
    ).run(randomUUID(), userId, ref, ciphertext, Date.now())
  }

  getMcpSecret(userId: number, ref: string): Uint8Array | undefined {
    const row = this.db.prepare('SELECT ciphertext FROM mcp_personal_secret WHERE user_id = ? AND ref = ?')
      .get(userId, ref) as { ciphertext: unknown } | undefined
    return row?.ciphertext instanceof Uint8Array ? row.ciphertext : undefined
  }

  hasMcpSecret(userId: number, ref: string): boolean {
    return this.getMcpSecret(userId, ref) !== undefined
  }

  mcpSecretRefs(userId: number): string[] {
    const rows = this.db.prepare('SELECT ref FROM mcp_personal_secret WHERE user_id = ?').all(userId) as Array<{ ref: string }>
    return rows.map(row => row.ref)
  }

  deleteMcpSecret(userId: number, ref: string): boolean {
    const r = this.db.prepare('DELETE FROM mcp_personal_secret WHERE user_id = ? AND ref = ?').run(userId, ref)
    return Number(r.changes) > 0
  }

  /** 归属账本读取:mux 租户策略 bindings 用(T2,2026-11-11)。 */
  sessionsOfOwner(ownerId: number): string[] {
    const rows = this.db.prepare('SELECT session_id FROM sessions WHERE owner_id = ?').all(ownerId) as
      Array<{ session_id: string }>
    return rows.map(row => row.session_id)
  }

  /**
   * 该用户名下**全部会话 id**(直接入账行 + 其子代理后代),mux 流绑定专用
   * (2026-11-24)。
   *
   * 为什么不能复用 {@link sessionsOfOwner}:mux 策略按「资源 kind+id」逐项建绑定,
   * 子会话不在绑定点上就没有任何流动作命中它——`session/follow` 的
   * `access denied (no-allow)` 正是这么来的(点击子智能体打开历史即炸)。而
   * sessionsOfOwner 的其它消费面(usage 归属、面板历史过滤)必须保持只认直接
   * 入账行,否则子会话会被当作独立计价会话/独立历史条目。
   * @param ownerId - 归属用户 id。
   * @returns 该用户可直接访问的会话 id 全集(含子代理后代)。
   */
  sessionIdsAccessibleBy(ownerId: number): string[] {
    const owned = this.sessionsOfOwner(ownerId)
    if (owned.length === 0) return owned
    const result = [...owned]
    const seen = new Set(owned)
    const queue = [...owned]
    // 广度优先展开子代理后代(环防护靠 seen;层级实测 ≤ 3,批量 IN 查询避免逐条往返)
    while (queue.length > 0) {
      const parents = queue.splice(0, 200)
      const placeholders = parents.map(() => '?').join(',')
      const rows = this.db.prepare(
        `SELECT session_id FROM session_children WHERE parent_session_id IN (${placeholders})`,
      ).all(...parents) as Array<{ session_id: string }>
      for (const row of rows) {
        if (seen.has(row.session_id)) continue
        seen.add(row.session_id)
        result.push(row.session_id)
        queue.push(row.session_id)
      }
    }
    return result
  }

  /** 归属账本读取:mux 租户策略 bindings 用(T2,2026-11-11)。 */
  workspacesOfOwner(ownerId: number): string[] {
    const rows = this.db.prepare('SELECT workspace_id FROM workspaces WHERE owner_id = ?').all(ownerId) as
      Array<{ workspace_id: string }>
    return rows.map(row => row.workspace_id)
  }

  /** T2.5:存量 workspace 划归 bootstrap admin(空表时一次性导入)。 */
  adoptOrphanWorkspaces(adminId: number, rows: ReadonlyArray<{ workspaceId: string; path: string }>): number {
    let adopted = 0
    for (const row of rows) {
      const existing = this.workspaceOwner(row.workspaceId)
      if (existing === undefined) {
        this.recordWorkspace(row.workspaceId, adminId, row.path)
        adopted += 1
      }
    }
    return adopted
  }

  // ── T2.3 插件启停(实例级,admin 专属;红线在 routes 层锁定,这里只管存取) ──

  private readonly disabledPlugins = new Set<string>()

  /** 启动时装载停用清单(与 users.db 同目录 disabled-plugins.json)。 */
  loadDisabledPlugins(file: string): void {
    this.disabledPlugins.clear()
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (Array.isArray(parsed)) {
        for (const id of parsed) {
          if (typeof id === 'string') this.disabledPlugins.add(id)
        }
      }
    } catch {
      // 缺文件=全启用
    }
  }

  disabledPluginIds(): string[] {
    return [...this.disabledPlugins].sort()
  }

  disablePlugin(id: string): void {
    this.disabledPlugins.add(id)
  }

  /** 启用=撤销停用并撤销删除(恢复挂载)。返回是否原本处于停用。 */
  enablePlugin(id: string): boolean {
    const wasDisabled = this.disabledPlugins.delete(id)
    this.removedPlugins.delete(id)
    return wasDisabled
  }

  isPluginDisabled(id: string): boolean {
    return this.disabledPlugins.has(id)
  }

  saveDisabledPlugins(file: string): void {
    writeFileSync(file, JSON.stringify(this.disabledPluginIds(), null, 2) + '\n', 'utf8')
  }

  // ── T2.3 扩展:插件删除(admin,永久卸载语义;removed ⊇ disabled) ──

  private readonly removedPlugins = new Set<string>()

  loadRemovedPlugins(file: string): void {
    this.removedPlugins.clear()
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (Array.isArray(parsed)) {
        for (const id of parsed) {
          if (typeof id === 'string') this.removedPlugins.add(id)
        }
      }
    } catch {
      // 缺文件=无删除
    }
  }

  removedPluginIds(): string[] {
    return [...this.removedPlugins].sort()
  }

  /** 删除=标记永久卸载并同步停用;返回 false 表示原本已删除。 */
  removePlugin(id: string): boolean {
    if (this.removedPlugins.has(id)) return false
    this.removedPlugins.add(id)
    this.disabledPlugins.add(id)
    return true
  }

  /** 启用=撤销停用并撤销删除(恢复挂载)。 */
  isPluginRemoved(id: string): boolean {
    return this.removedPlugins.has(id)
  }

  saveRemovedPlugins(file: string): void {
    writeFileSync(file, JSON.stringify(this.removedPluginIds(), null, 2) + '\n', 'utf8')
  }
}

/** mcp args_json 解析:非法 JSON 视为无参数(读面不炸;写面由路由校验先行)。 */
function parseJsonArray(raw: string): readonly string[] | undefined {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.every(item => typeof item === 'string') ? parsed : undefined
  } catch {
    return undefined
  }
}

/** mcp headers_json 解析:非法 JSON 视为无 header(同上,fail-soft 读面)。 */
function parseJsonRecord(raw: string): Readonly<Record<string, string>> | undefined {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const record: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') record[key] = value
    }
    return record
  } catch {
    return undefined
  }
}
