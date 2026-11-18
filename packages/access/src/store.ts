/**
 * 用户存储:node:sqlite 单文件(knowledge 先例,零原生依赖),WAL;users 表落
 * ETERNA_ACCESS_DIR(默认 $DSH_HOME/access,卷上)。删除护栏(不能删自己/
 * 最后一个 admin)在 store 层强制。D11:管理员建号遇重名自动追加数字后缀
 * (base→base01→base02…两位零填充,99 满进三位,超 32 位截基座保后缀)。
 * pwv:password_version 随改密递增,会话载荷比对实现改密即全端下线。
 */
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

  sessionOwner(sessionId: string): number | undefined {
    const row = this.db.prepare('SELECT owner_id FROM sessions WHERE session_id = ?').get(sessionId) as
      | { owner_id: number }
      | undefined
    return row === undefined ? undefined : row.owner_id
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

  /** 单行移除(个人插件 remove)。 */
  forgetUserPlugin(pluginId: string): boolean {
    const r = this.db.prepare('DELETE FROM user_plugins WHERE plugin_id = ?').run(pluginId)
    return Number(r.changes) > 0
  }

  /** 归属账本读取:mux 租户策略 bindings 用(T2,2026-11-11)。 */
  sessionsOfOwner(ownerId: number): string[] {
    const rows = this.db.prepare('SELECT session_id FROM sessions WHERE owner_id = ?').all(ownerId) as
      Array<{ session_id: string }>
    return rows.map(row => row.session_id)
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
