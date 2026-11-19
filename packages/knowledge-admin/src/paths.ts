/**
 * 账号分库路径解析(与 glue knowledge-plugin 的分库口径**逐字段对齐**,不引依赖):
 *
 * - tenantRoot = `config.tenantRoot ?? ETERNA_TENANT_ROOT ?? ($DSH_HOME ?? cwd)/workspaces`;
 * - 账号分库 = `<tenantRoot>/<account>/` 下 wiki=`knowledge.wiki`、索引=`.eterna/knowledge.sqlite3`;
 * - 全局库 = admin 视角:`config.wikiDir ?? <cwd>/knowledge.wiki`、`config.dbPath ?? <cwd>/.eterna/knowledge.sqlite3`;
 * - 账号目录 = 分库"已开通"的判据(目录缺席=未开通 → 本包**不隐式建**账号目录,
 *   只在目录已存在时补建 `.eterna/`(glue 同款:新注册用户登录只开通根目录))。
 *
 * 本模块只做纯路径计算 + 目录枚举,不做任何 IO 写入(ensure 由 service 在写路径上调用)。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 账号名白名单(目录名即账号名;拒绝 `..`/绝对路径/隐藏目录,防路径穿越)。
 * 首字符必须是字母或数字:挡住 `.hidden` 这类隐藏目录与 `.`/`..`,同时允许
 * `alice.bob`、`a-b`、`zhang_san` 这些既有的账号写法。
 */
const ACCOUNT_NAME = /^[\p{Letter}\p{Number}][\p{Letter}\p{Number}_.-]*$/u

/** 全局库账号哨兵(管理员视角;与分库账号名不冲突,账号名白名单不含 `*`)。 */
export const GLOBAL_ACCOUNT = '*'

/** 分库内的 wiki 目录名与索引相对路径(glue knowledge-plugin 同款字面量)。 */
export const ACCOUNT_WIKI_DIRNAME = 'knowledge.wiki'
export const ACCOUNT_DB_RELPATH = join('.eterna', 'knowledge.sqlite3')

/** 路径解析配置(全部可由宿主配置覆盖;与 glue KnowledgeRoutingConfig 形态同款)。 */
export interface KnowledgeAdminPathsConfig {
  /** 租户根目录(缺省 ETERNA_TENANT_ROOT ?? ($DSH_HOME ?? cwd)/workspaces)。 */
  readonly tenantRoot?: string
  /** 全局库 wiki 目录(缺省 <cwd>/knowledge.wiki;admin 视角)。 */
  readonly wikiDir?: string
  /** 全局库索引路径(缺省 <cwd>/.eterna/knowledge.sqlite3;admin 视角)。 */
  readonly dbPath?: string
  /** 进程环境(测试注入;缺省 process.env)。 */
  readonly env?: NodeJS.ProcessEnv
  /** 工作区根(缺省 process.cwd())。 */
  readonly cwd?: string
}

/** 一个知识库(分库或全局库)的绝对路径投影。 */
export interface ResolvedWikiPath {
  readonly account: string
  readonly global: boolean
  readonly wikiDir: string
  readonly dbPath: string
  /** 账号分库目录(= wikiDir 的父目录);全局库时 = cwd。 */
  readonly home: string
}

/** 账号名合法性(路径穿越/空串/哨兵 `*` 一律不合法)。 */
export function isValidAccountName(account: string): boolean {
  if (account.length === 0 || account.length > 128) return false
  if (account === '.' || account === '..' || account === GLOBAL_ACCOUNT) return false
  return ACCOUNT_NAME.test(account)
}

/** 账本目录(`$DSH_HOME/knowledge-admin/`;权限库与审计 jsonl 落此,绝不碰 access users.db)。 */
export function knowledgeAdminHome(config: KnowledgeAdminPathsConfig = {}): string {
  const env = config.env ?? process.env
  const dshHome = env.DSH_HOME
  const base = typeof dshHome === 'string' && dshHome.length > 0 ? dshHome : (config.cwd ?? process.cwd())
  return join(base, 'knowledge-admin')
}

/** tenantRoot 解析(与 glue 逐字段对齐)。 */
export function resolveTenantRoot(config: KnowledgeAdminPathsConfig = {}): string {
  const env = config.env ?? process.env
  if (config.tenantRoot !== undefined && config.tenantRoot.length > 0) return config.tenantRoot
  const fromEnv = env.ETERNA_TENANT_ROOT
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  const dshHome = env.DSH_HOME
  const base = typeof dshHome === 'string' && dshHome.length > 0 ? dshHome : (config.cwd ?? process.cwd())
  return join(base, 'workspaces')
}

/** 全局库路径(admin 视角;与 glue 全局 service 同路径但不共享实例)。 */
export function resolveGlobalPath(config: KnowledgeAdminPathsConfig = {}): ResolvedWikiPath {
  const cwd = config.cwd ?? process.cwd()
  return {
    account: GLOBAL_ACCOUNT,
    global: true,
    home: cwd,
    wikiDir: config.wikiDir ?? join(cwd, ACCOUNT_WIKI_DIRNAME),
    dbPath: config.dbPath ?? join(cwd, ACCOUNT_DB_RELPATH),
  }
}

/**
 * 账号 → 分库绝对路径(纯计算,**不检查存在**;存在性判定见 {@link accountIsOpen})。
 * 非法账号名 → undefined(调用方按 forbidden/invalid 处理)。
 */
export function resolveAccountPath(config: KnowledgeAdminPathsConfig, account: string): ResolvedWikiPath | undefined {
  if (account === GLOBAL_ACCOUNT) return resolveGlobalPath(config)
  if (!isValidAccountName(account)) return undefined
  const home = join(resolveTenantRoot(config), account)
  return {
    account,
    global: false,
    home,
    wikiDir: join(home, ACCOUNT_WIKI_DIRNAME),
    dbPath: join(home, ACCOUNT_DB_RELPATH),
  }
}

/** 分库是否已开通(账号目录存在 = 开通判据,与 glue `existsSync(tenantRoot/account)` 同款)。 */
export function accountIsOpen(config: KnowledgeAdminPathsConfig, account: string): boolean {
  const resolved = resolveAccountPath(config, account)
  if (resolved === undefined) return false
  if (resolved.global) return true
  return existsSync(resolved.home)
}

/**
 * 枚举 tenantRoot 下的账号目录(只列直接子目录 + 白名单账号名;不进入子目录读内容)。
 * 目录缺席/不可读 → 空集(不抛:管理面在空部署下也要能打开)。
 */
export function listAccountNames(config: KnowledgeAdminPathsConfig = {}): readonly string[] {
  const root = resolveTenantRoot(config)
  try {
    const entries = readdirSync(root, { withFileTypes: true })
    return entries
      .filter(entry => entry.isDirectory() && isValidAccountName(entry.name))
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

/** 摘要:某路径是否可读的目录(导入面用;不存在/文件 → false)。 */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
