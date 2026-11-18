/**
 * 知识库权限账本(`knowledge_permissions` 表)。
 *
 * 物理位置:`$DSH_HOME/knowledge-admin/access.sqlite3`(目录自己 ensure)。
 *
 * 纪律(与 access 包边界):
 * - **绝不打开/写 access 的 `users.db`**,也不读它的任何列;成员只按 `member_user_id`(整数)记账,
 *   人名/邮箱等 PII 不进本库(账号名来自登录身份,本就是目录名);
 * - 每人一条:去重键 `(account, member_user_id)` PRIMARY KEY,`setMember` 走 upsert
 *   (`ON CONFLICT DO UPDATE`),`updated_at` 覆盖为最新时间(不堆历史行);
 * - 读面按 account 过滤(idx_knowledge_permissions_account 支撑),`listMembers('*')` 供管理员全局视图;
 * - 库连接由 service 持有并 dispose(本类只做 SQL,生命周期归调用方)。
 */
import { DatabaseSync } from 'node:sqlite'
import type { KnowledgeAdminMember, KnowledgeAdminMemberLevel } from './types.ts'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS knowledge_permissions (
  account TEXT NOT NULL,
  member_user_id INTEGER NOT NULL,
  level TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account, member_user_id)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_permissions_account ON knowledge_permissions (account);
`

export class KnowledgePermissionStore {
  readonly #db: DatabaseSync
  #closed = false

  constructor(dbPath: string) {
    this.#db = new DatabaseSync(dbPath)
    this.#db.exec(SCHEMA)
  }

  /** 配逆:关闭连接(幂等)。 */
  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#db.close()
  }

  /**
   * upsert 一条成员记录(去重:同 (account, member_user_id) 覆盖旧行)。
   * @param at - 时间戳(service 注入时钟,便于测试确定性)。
   * @returns 生效后的记录。
   */
  upsert(account: string, memberUserId: number, level: KnowledgeAdminMemberLevel, at: string): KnowledgeAdminMember {
    this.#assertLive()
    this.#db.prepare(
      `INSERT INTO knowledge_permissions (account, member_user_id, level, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(account, member_user_id) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at`,
    ).run(account, memberUserId, level, at)
    return { account, member_user_id: memberUserId, level, updated_at: at }
  }

  /** 删除一条成员记录;返回是否真的删掉了(不存在 → false,幂等)。 */
  remove(account: string, memberUserId: number): boolean {
    this.#assertLive()
    const result = this.#db.prepare('DELETE FROM knowledge_permissions WHERE account = ? AND member_user_id = ?')
      .run(account, memberUserId)
    return Number(result.changes) > 0
  }

  /** 按账号列举(`'*'` = 全部账号,仅管理员面调用;按 account,level,id 稳定序)。 */
  list(account: string): readonly KnowledgeAdminMember[] {
    this.#assertLive()
    const rows = account === '*'
      ? this.#db.prepare(
        'SELECT account, member_user_id, level, updated_at FROM knowledge_permissions ORDER BY account, level, member_user_id',
      ).all()
      : this.#db.prepare(
        'SELECT account, member_user_id, level, updated_at FROM knowledge_permissions WHERE account = ? ORDER BY level, member_user_id',
      ).all(account)
    return rows.map(row => ({
      account: typeof row.account === 'string' ? row.account : '',
      member_user_id: Number(row.member_user_id),
      level: toLevel(row.level),
      updated_at: typeof row.updated_at === 'string' ? row.updated_at : '',
    }))
  }

  /** 单条查询(测试/断言面)。 */
  get(account: string, memberUserId: number): KnowledgeAdminMember | undefined {
    this.#assertLive()
    const row = this.#db.prepare(
      'SELECT account, member_user_id, level, updated_at FROM knowledge_permissions WHERE account = ? AND member_user_id = ?',
    ).get(account, memberUserId)
    if (row === undefined) return undefined
    return {
      account: typeof row.account === 'string' ? row.account : '',
      member_user_id: Number(row.member_user_id),
      level: toLevel(row.level),
      updated_at: typeof row.updated_at === 'string' ? row.updated_at : '',
    }
  }

  #assertLive(): void {
    if (this.#closed) throw new Error('KnowledgePermissionStore 已 close')
  }
}

function toLevel(value: unknown): KnowledgeAdminMemberLevel {
  return value === 'owner' || value === 'editor' || value === 'viewer' ? value : 'viewer'
}
