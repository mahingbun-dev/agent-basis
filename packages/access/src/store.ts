/**
 * 用户存储:node:sqlite 单文件(knowledge 先例,零原生依赖),WAL;users 表落
 * ETERNA_ACCESS_DIR(默认 $DSH_HOME/access,卷上)。删除护栏(不能删自己/
 * 最后一个 admin)在 store 层强制。D11:管理员建号遇重名自动追加数字后缀
 * (base→base01→base02…两位零填充,99 满进三位,超 32 位截基座保后缀)。
 * pwv:password_version 随改密递增,会话载荷比对实现改密即全端下线。
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
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

  /** 删除护栏:不能删自己;最后一个 admin 不可删。 */
  deleteUser(id: number, actorId: number): void {
    if (id === actorId) throw new SelfDeleteError('不能删除自己的账号')
    const row = this.db.prepare('SELECT role FROM users WHERE id = ?').get(id) as { role: string } | undefined
    if (row === undefined) throw new UserNotFoundError(`用户 ${id} 不存在`)
    if (row.role === 'admin') {
      const admins = this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }
      if (admins.n <= 1) throw new LastAdminError('最后一个管理员不可删除')
    }
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id)
  }

  private requireRow(id: number): void {
    const row = this.db.prepare('SELECT id FROM users WHERE id = ?').get(id)
    if (row === undefined) throw new UserNotFoundError(`用户 ${id} 不存在`)
  }
}
