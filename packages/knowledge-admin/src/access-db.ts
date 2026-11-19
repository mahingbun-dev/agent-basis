/**
 * access `users.db` 只读查询面(会话 → 账号身份解析的共享实现)。
 *
 * 为什么直接读库文件:宿主服务解析在 agent ctx 拿不到(memory S-6/S-7 复盘),
 * glue knowledge-plugin 同口径(本条即其抽取件)。纪律:
 * - 只读打开(`readOnly: true`),绝不写 access 库;
 * - 每次查询独立开关连接,查询失败(库缺席/表缺席/损坏)一律 `undefined`(fail-closed,
 *   调用方按"身份不可解析"处理,绝不退回全局库);
 * - 不读人名等任何非路由字段。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** access 用户的最小投影(只取路由需要的两列)。 */
export interface AccessUser {
  readonly account: string
  readonly role: string
}

/** 只读身份面(路由与账号面共用同一实例)。 */
export interface AccessDirectory {
  readonly dbPath: string
  /** users.db 是否存在(不存在 = 本地 TUI/未初始化部署,auto 模式回落全局库)。 */
  readonly available: boolean
  sessionOwner(sessionId: string): number | undefined
  userById(id: number): AccessUser | undefined
  accountOfUser(userId: number): string | undefined
}

/** users.db 缺省位置(`$DSH_HOME/access/users.db`;与 access 插件落盘位置同源)。 */
export function resolveAccessDbPath(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
  const dshHome = env.DSH_HOME
  const base = typeof dshHome === 'string' && dshHome.length > 0 ? dshHome : cwd
  return join(base, 'access', 'users.db')
}

/** 建只读身份面(构造即固定路径;每次查询重新开库,不做连接池)。 */
export function createAccessDirectory(dbPath: string): AccessDirectory {
  const query = <T>(run: (db: DatabaseSync) => T): T | undefined => {
    try {
      const db = new DatabaseSync(dbPath, { readOnly: true })
      try {
        return run(db)
      } finally {
        db.close()
      }
    } catch {
      return undefined
    }
  }
  const sessionOwner = (sessionId: string): number | undefined => {
    const row = query(db => db.prepare('SELECT owner_id FROM sessions WHERE session_id = ?').get(sessionId)) as
      | { owner_id: number | bigint }
      | undefined
    return row === undefined ? undefined : Number(row.owner_id)
  }
  const userById = (id: number): AccessUser | undefined => {
    const row = query(db => db.prepare('SELECT account, role FROM users WHERE id = ?').get(id)) as
      | { account: string; role: string }
      | undefined
    return row === undefined ? undefined : { account: row.account, role: row.role }
  }
  return {
    dbPath,
    available: existsSync(dbPath),
    sessionOwner,
    userById,
    accountOfUser: (userId: number): string | undefined => userById(userId)?.account,
  }
}
