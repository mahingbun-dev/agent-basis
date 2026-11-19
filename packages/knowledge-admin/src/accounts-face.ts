/**
 * 账号知识库只读状态面(`'eterna-knowledge-accounts'`)。
 *
 * panel 消费此面组装非 admin 视图(accountOfUser / statusForAccount),口径与 glue
 * knowledge-plugin 完全一致;区别只在数据源:本面直接复用知识库管理面的路径解析
 * (全局 `*` / `<tenantRoot>/<account>`),不再有第二套 router/连接。
 *
 * 红线:只读计数(`readOnly` 开库),不返回任何正文;账号目录缺席 → `undefined`
 * (panel 显示"未开通/空"),**不隐式建目录**。
 */
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { AccessDirectory } from './access-db.ts'
import {
  GLOBAL_ACCOUNT, resolveAccountPath, resolveGlobalPath, type KnowledgeAdminPathsConfig,
} from './paths.ts'

/** 账号知识库只读状态(panel KnowledgeSnapshot 的计数来源;不含他人任何数据)。 */
export interface KnowledgeAccountStatus {
  readonly account: string
  /** 分库 sqlite 是否存在(新账号为空库前的如实状态)。 */
  readonly available: boolean
  readonly dbPath: string
  readonly wikiDocCount: number
  readonly proposalCount: number
}

/** 面接口(字面量与 panel 的 KnowledgeAccountsFaceLike 对齐)。 */
export interface KnowledgeAccountsFace {
  accountOfUser(userId: number): string | undefined
  statusForAccount(account: string): KnowledgeAccountStatus | undefined
}

/** 只读计数(node:sqlite 打开失败/表缺席 → 0,不抛)。 */
function countRows(dbPath: string, sql: string): number {
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const row = db.prepare(sql).get() as { c?: unknown } | undefined
      return typeof row?.c === 'number' ? row.c : 0
    } finally {
      db.close()
    }
  } catch {
    return 0
  }
}

export function createKnowledgeAccountsFace(options: {
  readonly paths: KnowledgeAdminPathsConfig
  readonly access: AccessDirectory
}): KnowledgeAccountsFace {
  const statusForAccount = (account: string): KnowledgeAccountStatus | undefined => {
    const target = account === GLOBAL_ACCOUNT
      ? resolveGlobalPath(options.paths)
      : resolveAccountPath(options.paths, account)
    if (target === undefined) return undefined
    if (!target.global && !existsSync(target.home)) return undefined
    const available = existsSync(target.dbPath)
    return {
      account,
      available,
      dbPath: target.dbPath,
      wikiDocCount: available ? countRows(target.dbPath, 'SELECT COUNT(*) AS c FROM pages') : 0,
      proposalCount: available ? countRows(target.dbPath, 'SELECT COUNT(*) AS c FROM proposals') : 0,
    }
  }
  return {
    accountOfUser: (userId: number): string | undefined => options.access.accountOfUser(userId),
    statusForAccount,
  }
}
