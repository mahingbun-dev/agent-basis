/**
 * knowledge 插件:WikiLocalBackend(git 仓库即知识层)+ 四模型面工具。
 * 门禁:fail-closed——默认 reject(知识发布需人工评审);有 governance 规则时按规则裁决放行。
 *
 * 多租户分库(对齐 memory 23 号 M-T1/M-T2 口径,packages/glue/src/plugins/
 * memory-plugin.ts 为同构先例):
 * - 身份解析直接只读 access 库文件(`<DSH_HOME>/access/users.db`;宿主服务解析在
 *   agent ctx 拿不到,见 memory S-6/S-7 复盘),sessionOwner→getUserById→account/role;
 * - 路由口径:admin 角色 → 全局库(cwd knowledge.wiki + .eterna/knowledge.sqlite3,
 *   即"管理员看全局"的既定语义);普通账号 → `<tenantRoot>/<account>/` 物理分库
 *   (wiki=knowledge.wiki,索引=.eterna/knowledge.sqlite3);账号目录缺席/解析失败
 *   → fail-closed Denied service,绝不退回全局库;
 * - 双模式:mode='auto'(缺省)按调用判定身份源——access 库缺席(本地 TUI)或
 *   会话上下文缺席 → 全局单库(行为与改造前一致);mode='per-account' 显式模式
 *   一律不回退;mode='global' 关闭路由(纯单库)。
 * - 账号状态面 `'eterna-knowledge-accounts'`(T2 panel 消费):accountOfUser /
 *   statusForAccount(只读计数,目录缺席 undefined)——panel 非 admin 只经此面
 *   读自己的库,越权在解析面即不可达。
 */
import * as nodeFs from 'node:fs'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import {
  KnowledgeAccountRouter, WikiLocalBackend, createKnowledgeService, createNodeFsAdapter, toDshTools,
} from '@eterna/knowledge'
import type { KnowledgeProposal, KnowledgeService, KnowledgeSessionResolver } from '@eterna/knowledge'
import type { KnowledgePluginConfig } from '../types.ts'

export const ETERNA_KNOWLEDGE_PLUGIN_NAME = 'eterna-knowledge'

/** 账号知识库状态面服务 id(panel SRC 端点消费;memory 'eterna-memory-accounts' 同构)。 */
export const ETERNA_KNOWLEDGE_ACCOUNTS_SERVICE_ID = 'eterna-knowledge-accounts'

/** governance 服务在 glue 侧的最小结构子集(inject 可选,governance 缺席为常态)。 */
interface GovernanceLike {
  readonly rules?: { evaluate(tool: string, args?: unknown): { decision: string } }
}

/** 账号知识库只读状态(panel KnowledgeSnapshot 的计数来源;不含他人任何数据)。 */
export interface KnowledgeAccountStatus {
  readonly account: string
  /** 分库 sqlite 是否存在(新账号为空库前的如实状态)。 */
  readonly available: boolean
  readonly dbPath: string
  readonly wikiDocCount: number
  readonly proposalCount: number
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

export function defineKnowledgePlugin(config: KnowledgePluginConfig = {}) {
  return {
    name: ETERNA_KNOWLEDGE_PLUGIN_NAME,
    inject: { tools: true, governance: false } as never,
    apply(ctx: Context): () => void {
      const cwd = process.cwd()
      const govRules = (ctx as unknown as { governance?: GovernanceLike }).governance?.rules
      // 提案门禁(fail-closed):governance 规则显式 allow 才放行;否则 reject 待人工评审
      const gate = (proposal: KnowledgeProposal): { kind: 'approve' } | { kind: 'reject'; reason: string } => {
        const verdict = govRules?.evaluate('knowledge_propose', { proposal_id: proposal.id })
        if (verdict?.decision === 'allow') return { kind: 'approve' as const }
        return { kind: 'reject' as const, reason: 'glue: 知识发布需人工评审(工作台/对话式添加确认后调用 approve);governance 规则未放行' }
      }
      const createService = (wikiDir: string, dbPath: string): KnowledgeService => {
        // node:sqlite 不自建父目录:全新卷 cwd/.eterna 缺席时开库即炸,插件装载失败
        // (告警「2 entries did not activate」,eterna-tp-t6 2026-11-18 实测)——
        // 开库前先建父目录(与下方账号分库 create 回调的 mkdirSync 同款守卫,幂等)。
        mkdirSync(dirname(dbPath), { recursive: true })
        return createKnowledgeService({
          backends: [new WikiLocalBackend({ wikiDir, dbPath, fs: createNodeFsAdapter(nodeFs), gate })],
        })
      }
      // 全局库(= 改造前单库形态;admin 路由与本地降级共用)。
      const globalWikiDir = config.wikiDir ?? join(cwd, 'knowledge.wiki')
      const globalDbPath = config.dbPath ?? join(cwd, '.eterna/knowledge.sqlite3')
      const globalService = createService(globalWikiDir, globalDbPath)

      // ── 多租户分库路由(memory M-T1 同构)────────────────────────────
      const routingConfig = config.routing ?? {}
      const routingMode = routingConfig.mode ?? 'auto'
      const accessDbPath = routingConfig.accessDbPath ?? join(process.env.DSH_HOME ?? cwd, 'access', 'users.db')
      const accessQuery = <T>(query: (db: DatabaseSync) => T): T | undefined => {
        try {
          const db = new DatabaseSync(accessDbPath, { readOnly: true })
          try {
            return query(db)
          } finally {
            db.close()
          }
        } catch {
          return undefined
        }
      }
      const accessFace = {
        sessionOwner: (sessionId: string): number | undefined => {
          const row = accessQuery(db =>
            db.prepare('SELECT owner_id FROM sessions WHERE session_id = ?').get(sessionId)) as
            | { owner_id: number | bigint }
            | undefined
          return row === undefined ? undefined : Number(row.owner_id)
        },
        getUserById: (id: number): { account: string; role: string } | undefined => {
          const row = accessQuery(db =>
            db.prepare('SELECT account, role FROM users WHERE id = ?').get(id)) as
            | { account: string; role: string }
            | undefined
          return row === undefined ? undefined : { account: row.account, role: row.role }
        },
      }
      const tenantRoot = routingConfig.tenantRoot
        ?? process.env.ETERNA_TENANT_ROOT
        ?? join(process.env.DSH_HOME ?? cwd, 'workspaces')

      let router: KnowledgeAccountRouter | undefined
      let sessionResolver: KnowledgeSessionResolver | undefined
      if (routingMode !== 'global') {
        const accountDir = (account: string): string | undefined => {
          const dir = join(tenantRoot, account)
          return existsSync(dir) ? dir : undefined
        }
        router = new KnowledgeAccountRouter({
          dirOf: accountDir,
          create: (dir: string): KnowledgeService => {
            // 账号目录在场但 .eterna/ 未建(新注册用户,登录只开通根目录)时先建目录
            // 再开库(memory 生产 0.1.6 双账号 E2E 实测过的同款炸点)。
            mkdirSync(join(dir, '.eterna'), { recursive: true })
            return createService(join(dir, 'knowledge.wiki'), join(dir, '.eterna', 'knowledge.sqlite3'))
          },
          ...(routingConfig.maxAccounts !== undefined && { maxInstances: routingConfig.maxAccounts }),
          ...(routingConfig.idleCloseMs !== undefined && { idleMs: routingConfig.idleCloseMs }),
        })
        /** 会话 → 账号服务:admin 角色 → 全局库;普通账号 → 账号分库(目录缺席 undefined)。 */
        const resolveSession = (sessionId: string): KnowledgeService | undefined => {
          const userId = accessFace.sessionOwner(sessionId)
          if (userId === undefined) return undefined
          const user = accessFace.getUserById(userId)
          if (user === undefined) return undefined
          if (user.role === 'admin') return globalService
          return router?.forAccount(user.account)
        }
        sessionResolver = {
          forSession: (sessionId: string | undefined): KnowledgeService | undefined => {
            // auto 模式按调用判定身份源:users.db 缺席或会话上下文缺席 → 全局单库
            // (本地 TUI 永久缺席=全程单库;新部署注册后即时路由,无需重启)。
            // per-account 显式模式不回退:身份源缺席/会话不可归属一律 fail-closed。
            if (routingMode === 'auto' && (sessionId === undefined || !existsSync(accessDbPath))) return globalService
            if (sessionId === undefined) return undefined
            return resolveSession(sessionId)
          },
        }
        // 账号状态面(panel 非 admin 视图):accountOfUser + statusForAccount 只读计数;
        // 账号目录缺席 → statusForAccount undefined(panel 显示不可用/空)。非 global
        // 模式即 provide(auto+身份源缺席时账号面查询为空,但 web 部署面板仍需此面)。
        const provide2 = (ctx as unknown as { provide?: (id: string, value: unknown) => () => void }).provide
        if (provide2 !== undefined) {
          const statusForAccount = (account: string): KnowledgeAccountStatus | undefined => {
            const dir = join(tenantRoot, account)
            if (!existsSync(dir)) return undefined
            const dbPath = join(dir, '.eterna', 'knowledge.sqlite3')
            const available = existsSync(dbPath)
            return {
              account,
              available,
              dbPath,
              wikiDocCount: available ? countRows(dbPath, 'SELECT COUNT(*) AS c FROM pages') : 0,
              proposalCount: available ? countRows(dbPath, 'SELECT COUNT(*) AS c FROM proposals') : 0,
            }
          }
          provide2(ETERNA_KNOWLEDGE_ACCOUNTS_SERVICE_ID, {
            accountOfUser: (userId: number): string | undefined => accessFace.getUserById(userId)?.account,
            statusForAccount,
          })
        }
      }

      const disposers = toDshTools(globalService, sessionResolver).map(def => ctx.tools.register(def))
      let disposed = false
      return (): void => {
        if (disposed) return
        disposed = true
        for (const dispose of disposers.splice(0)) dispose()
        router?.dispose()
        globalService.dispose()
      }
    },
  }
}

// DSH bundle loader 取 default export 插件实例(对齐 @event/pack plugin.ts 形态)
export default defineKnowledgePlugin()
