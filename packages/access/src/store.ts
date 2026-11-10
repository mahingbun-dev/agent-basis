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

export type UserRole = 'admin' | 'user'

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
      role TEXT NOT NULL CHECK(role IN ('admin','user')),
      avatar BLOB,
      avatar_mime TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    this.db.exec(`CREATE TABLE IF NOT EXISTS workspaces (
      workspace_id TEXT PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      path TEXT NOT NULL
    )`)
    this.db.exec(`CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      workspace_id TEXT
    )`)
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
