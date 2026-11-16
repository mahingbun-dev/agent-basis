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
  /** M-M2 T6 会话尾整固 job(缺省开启;19 号 §6 配置键名即最终形态)。 */
  readonly consolidation?: MemoryConsolidationConfig
  /** M-M3 T10 域检测与注册(缺省开启;19 号 §6 domain 键 + glue 落地补充键)。 */
  readonly domain?: MemoryDomainConfig
  /**
   * M-M3 T11 重量 Dream(缺省开启;19 号 §6 dream 键;S4-B 退路:会话尾触发 +
   * lastDreamAt 时间阈值合并,不接 schedule)。
   */
  readonly dream?: MemoryDreamConfig
  /** M-M3 T11 episodic 淘汰参数(19 号 §6 episodic 键;缺省 Q5 决议值)。 */
  readonly episodic?: MemoryEpisodicConfig
  /** M-M3 T11 半衰期天数(索引排序与 Dream 挤出降权共用;缺省 90,18 §4.2)。 */
  readonly halfLifeDays?: number
  /** M-M3 T11 user 晋升审级(19 号 §6 promotion 键;缺省 Q3 决议全审 1.0)。 */
  readonly promotion?: MemoryPromotionConfig
  /** 画像(缺省开启;Dream Prune 再生成条件消费 enabled)。 */
  readonly portrait?: MemoryPortraitConfig
  /**
   * 多租户分库路由(23 号 M-T1,方案 C):per-account store 池——记忆物理落
   * `workspaces/<账号>/.eterna/`,四工具/索引按会话账号路由(fail-closed:
   * 账号解析失败不落库,绝不退回全局库)。
   * mode 缺省 'auto':宿主可见 eternaAccessStore(多用户部署)→ per-account;
   * 本地单用户(TUI,无 access 插件)→ global(沿用单库,行为不变)。
   */
  readonly routing?: MemoryRoutingConfig
  /** Gm0 单条正文字数上限(缺省 2000;19 §10-#1 配置键)。 */
  readonly contentMaxChars?: number
  /** Gm0 单域 live 上限(缺省 200;19 §10-#1 配置键)。 */
  readonly perDomainLimit?: number
}

/** 多租户分库路由配置(23 号 §3;Q1 决议参数为缺省)。 */
export interface MemoryRoutingConfig {
  /** 'auto'(缺省,按 access store 在场判定)/'per-account'/'global'。 */
  readonly mode?: 'auto' | 'per-account' | 'global'
  /** 租户根目录(缺省与 access 插件同源解析:ETERNA_TENANT_ROOT ?? ($DSH_HOME ?? cwd)/workspaces)。 */
  readonly tenantRoot?: string
  /** 池上限(缺省 8,Q1 决议)。 */
  readonly maxAccounts?: number
  /** 闲置关库毫秒(缺省 600_000,Q1 决议)。 */
  readonly idleCloseMs?: number
}

/**
 * 会话尾整固配置(19 号 §4-T6/T7/§6):M-M2 不接周期 schedule(留 M-M3 重量
 * Dream;S-4 结论 schedule seam 不可用,周期触发半面采「会话尾触发+时间阈值
 * 合并」由 M-M3 落地)。
 */
export interface MemoryConsolidationConfig {
  /** 总开关,默认 true(插件停用即回到四工具旧形态,19 号 §7 回滚面)。 */
  readonly enabled?: boolean
  /** 触发档:M-M2 仅 'session-end'(turn/end completed 代理会话尾,S1 结论 B)。 */
  readonly trigger?: 'session-end'
  /**
   * 提取执行体所用 curator 模型(T7 消费:默认 Flash=deepseek-flash;provider 由
   * ctx.llm 目录兜底扫描,扫描不到回落 'deepseek',19a 号 S4-A3)。
   */
  readonly model?: string
}

/**
 * 域检测与注册配置(M-M3 T10,19 号 §5-T10/§6):19 号 §6 的 domain 键为
 * { minSessionsForNewDomain, indexTokens };enabled/workspaceName/model 是 glue
 * 落地补充键——enabled 即 §7 回滚面(停用回 T10 之前的无域形态),workspaceName
 * 承载 18 §1.2「workspace 即显式域」的部署侧输入(glue 无 workspace 登记册可读,
 * cwd 不等价于「用户选定的项目域」,显式绑定由部署配置声明,缺省走语义打标),
 * model 覆写打标 curator(缺省回落 consolidation.model→Flash,复用 T7 配置面)。
 */
export interface MemoryDomainConfig {
  /** 总开关,默认 true。 */
  readonly enabled?: boolean
  /**
   * 新域转正阈值:≥N 个独立会话命中才注册(缺省 3,18 §13 Q2 决议;「独立会话」
   * 由 domain_hit_sessions 持久去重钉死,进程重启不重复计数)。
   */
  readonly minSessionsForNewDomain?: number
  /** 当前域索引区 token 上限(缺省 250,19 号 §6 domain.indexTokens)。 */
  readonly indexTokens?: number
  /** 显式 workspace 域名(存在 → 会话跳过打标直接注册,18 §1.2)。 */
  readonly workspaceName?: string
  /** 打标所用 curator 模型(缺省回落 consolidation.model→deepseek-flash)。 */
  readonly model?: string
}

/**
 * 重量 Dream 配置(M-M3 T11,19 号 §6 dream 键):S4-B 结论 schedule seam 不可用
 * (dsh-schedule 语义是「把指令 prompt 投递进会话」),周期触发采退路「会话尾
 * 触发 + lastDreamAt 时间阈值合并」——19 号原文的 `cron: '0 4 * * *'` 键名保留、
 * 降级解释为**间隔小时数**(S4-B 原文;缺省 24=每日),待上游出现真 cron 面再
 * 恢复 cron 语义。
 */
export interface MemoryDreamConfig {
  /** 总开关,默认 true(停用即不挂 Dream 触发,§7 回滚面)。 */
  readonly enabled?: boolean
  /** 间隔小时数(19 号 §6 dream.cron 键降级语义,缺省 24;见上注释)。 */
  readonly cron?: number
  /** Gather 窄读 episodic 条数上限(缺省 50,19 号 §6 dream.maxTurns)。 */
  readonly maxTurns?: number
}

/** episodic 淘汰参数(19 号 §6 episodic 键;缺省 18 §13 Q5 决议值)。 */
export interface MemoryEpisodicConfig {
  /** episodic TTL 天数(缺省 30)。 */
  readonly ttlDays?: number
  /** 单域 live 上限(缺省 200;与 Gm0 容量闸同键同值)。 */
  readonly perDomainLimit?: number
}

/** user 晋升审级(19 号 §6 promotion 键;18 §13 Q3 决议)。 */
export interface MemoryPromotionConfig {
  /**
   * user 晋升抽样审比例(缺省 1.0 = 初始全审,逐条审批卡片;画像稳定后降档,
   * 降档需以画像纠正率下降为前置证据——Q3 决议;降档后未抽样选中的条目自动
   * 生效,抽样按 key 稳定哈希确定性判定)。
   */
  readonly userPromotionSampleRate?: number
}

/** 画像配置(19 号 §6 portrait 键;maxTokens 是索引装配侧既有键,见 indexBudgetTokens)。 */
export interface MemoryPortraitConfig {
  /** 画像开关(缺省 true;false 时 Dream Prune 跳过画像再生成,索引画像区随缓存缺席省略)。 */
  readonly enabled?: boolean
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
