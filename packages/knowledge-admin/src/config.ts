/**
 * 插件配置面(Cordis `Config` schema 的类型侧 + 缺省值解析)。
 *
 * 键名口径与 glue 的 `KnowledgeRoutingConfig` 逐字段同源(tenantRoot/wikiDir/dbPath),
 * 追加本包独有的 admin 面键(`adminHome`/`deepwiki`/`pool`/`import`)。
 * 运行期 schema 见 `plugin.ts`(schemastery 不在本包依赖内,故用结构校验 + 缺省解析)。
 */

/** DeepWiki 源配置。 */
export interface DeepWikiConfig {
  /** 是否启用(缺省 false=未配置;调用方按 not-configured 展示)。 */
  readonly enabled?: boolean
  /** 服务地址(缺省 `http://127.0.0.1:8001`)。 */
  readonly baseUrl?: string
  /**
   * Bearer 凭据的**引用名**(如 `DEEPWIKI_TOKEN`);只经 `ctx.get('credentials')` 解析,
   * 绝不读 `.env`/`secret.key`/token 文件,绝不写进输出。
   */
  readonly bearerRef?: string
  /** 拉取 wiki 仓库内容时的缺省 owner/repo(检索增强用)。 */
  readonly owner?: string
  readonly repo?: string
}

/** 分库池参数(对齐 memory Q1 决议:8 实例 / 10 分钟闲置)。 */
export interface KnowledgeAdminPoolConfig {
  /** 池上限(缺省 8;超出逐出最久未用并 dispose)。 */
  readonly maxInstances?: number
  /** 闲置关库毫秒(缺省 600_000)。 */
  readonly idleCloseMs?: number
}

/** 导入面配置。 */
export interface KnowledgeAdminImportConfig {
  /** 仓库导入缺省引擎(缺省 'stub';'spawn' 需 scripts/wiki-generate.mjs 在场)。 */
  readonly engine?: 'spawn' | 'stub'
  /** 单次导入最多几条(缺省 20;上限 200)。 */
  readonly maxFiles?: number
}

/** 插件配置(全部可选;括号内为缺省)。 */
export interface KnowledgeAdminPluginConfig {
  /** 租户根目录(缺省 `ETERNA_TENANT_ROOT ?? ($DSH_HOME ?? cwd)/workspaces`,与 glue 同源)。 */
  readonly tenantRoot?: string
  /** 全局库 wiki 目录(缺省 `<cwd>/knowledge.wiki`;admin 视角)。 */
  readonly wikiDir?: string
  /** 全局库索引路径(缺省 `<cwd>/.eterna/knowledge.sqlite3`;admin 视角)。 */
  readonly dbPath?: string
  /** 本包账本目录(缺省 `$DSH_HOME/knowledge-admin/`;权限库+审计 jsonl)。 */
  readonly adminHome?: string
  readonly deepwiki?: DeepWikiConfig
  readonly pool?: KnowledgeAdminPoolConfig
  readonly imports?: KnowledgeAdminImportConfig
}

/** 解析后的有效配置(service 构造入参)。 */
export interface ResolvedAdminConfig {
  readonly config: KnowledgeAdminPluginConfig
  readonly poolMaxInstances: number
  readonly poolIdleMs: number
  readonly importEngine: 'spawn' | 'stub'
  readonly importMaxFiles: number
  readonly deepwiki: DeepWikiConfig & { readonly baseUrl: string }
}

/** 池上限硬帽(再大也是内存与文件句柄的压力)。 */
export const POOL_MAX_INSTANCES_CAP = 32
/** 导入条数硬帽。 */
export const IMPORT_MAX_FILES_CAP = 200

export function resolveAdminConfig(config: KnowledgeAdminPluginConfig = {}): ResolvedAdminConfig {
  const maxInstances = clampInt(config.pool?.maxInstances, 8, 1, POOL_MAX_INSTANCES_CAP)
  const idleCloseMs = clampInt(config.pool?.idleCloseMs, 600_000, 1_000, 86_400_000)
  const engine = config.imports?.engine === 'spawn' ? 'spawn' : 'stub'
  const importMaxFiles = clampInt(config.imports?.maxFiles, 20, 1, IMPORT_MAX_FILES_CAP)
  return {
    config,
    poolMaxInstances: maxInstances,
    poolIdleMs: idleCloseMs,
    importEngine: engine,
    importMaxFiles,
    deepwiki: {
      ...(config.deepwiki?.enabled === true ? { enabled: true } : {}),
      baseUrl: config.deepwiki?.baseUrl ?? 'http://127.0.0.1:8001',
      ...(config.deepwiki?.bearerRef === undefined ? {} : { bearerRef: config.deepwiki.bearerRef }),
      ...(config.deepwiki?.owner === undefined ? {} : { owner: config.deepwiki.owner }),
      ...(config.deepwiki?.repo === undefined ? {} : { repo: config.deepwiki.repo }),
    },
  }
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}
