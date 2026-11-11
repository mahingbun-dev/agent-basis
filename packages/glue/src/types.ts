/** glue 包共享常量与类型。 */

export const ETERNA_GLUE_PLUGIN_NAME = 'eterna-glue'

/** memory 插件配置(对齐 @eterna/memory MemoryOptions 的宿主面子集)。 */
export interface MemoryPluginConfig {
  /** M1 工作区根(缺省 = agent cwd 下的 NOTES/)。 */
  readonly notesDir?: string
  /** M2 sqlite 库路径(缺省 = agent cwd 下的 .eterna/memory.sqlite3)。 */
  readonly dbPath?: string
  /** 记忆索引 section 的 token 预算(缺省 500,08 号设计)。 */
  readonly indexBudgetTokens?: number
}

/** knowledge 插件配置。 */
export interface KnowledgePluginConfig {
  /** wiki 根目录(缺省 = agent cwd 下的 knowledge.wiki/)。 */
  readonly wikiDir?: string
  /** 索引 sqlite 路径(缺省 = agent cwd 下的 .eterna/knowledge.sqlite3)。 */
  readonly dbPath?: string
}

/** governance 插件配置。 */
export interface GovernancePluginConfig {
  /** 规则文件路径(YAML;缺省 = agent cwd 下的 .eterna/governance.rules.yml,不存在则空规则集)。 */
  readonly rulesPath?: string
  /** 组合治理门的插件归属(audit 记录 actor.pluginId;缺省插件名 eterna-governance)。 */
  readonly actorId?: string
}

/** egress 插件配置(T8;三层判定与缺省口径见 plugins/egress-plugin.ts 头注)。 */
export interface EgressPluginConfig {
  /** 域名白名单 YAML 路径(缺省 = agent cwd 下 .eterna/egress-whitelist.yml;不存在 = 内网默认白名单)。 */
  readonly whitelistPath?: string
  /** 识别出网型工具的 glob(缺省 = governance DEFAULT_OUTBOUND_TOOL_GLOBS)。 */
  readonly outboundToolGlobs?: readonly string[]
  /** 工具级放行(缺省 DEFAULT_ALLOWED_OUTBOUND_TOOLS = web 检索 + 内网 MCP 家族)。 */
  readonly allowedOutboundTools?: readonly string[]
  /** 受控代理地址(第 3 层代理强注;内网部署缺省无代理 = 整层关闭)。 */
  readonly proxyUrl?: string
  /** NO_PROXY 直连例外(仅 proxyUrl 在场时生效)。 */
  readonly noProxy?: readonly string[]
  /** 出网工具参数中无目的地时的策略(缺省 'allow' = 工具级白名单兜底;可显式收窄 'deny')。 */
  readonly unknownDestination?: 'deny' | 'allow'
  /**
   * 完全跳过 egress 审计的工具 glob(缺省 DEFAULT_EGRESS_EXEMPT_TOOL_GLOBS =
   * mcp__browser__*:companion 浏览器执行面,url 参数=用户浏览器导航目的地,
   * 出站在用户机器不经服务端——按服务端白名单审计属语义错位,2026-11-11 生产实测)。
   */
  readonly exemptToolGlobs?: readonly string[]
}
