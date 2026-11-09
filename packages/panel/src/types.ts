/**
 * @eterna/panel 快照类型:Host 侧 eternaPanel/snapshot 的返回值形状,
 * 与浏览器面板(src/client)共享的单一事实(客户端仅做 type-only 导入)。
 * 全部字段必须 lossless JSON(Typert 网关对结果做 JSON 校验)。
 */

/** governance 卡片:规则数 + 最近审计条数。 */
export interface GovernanceSnapshot {
  /** ctx.governance 服务是否已挂载(glue governance-plugin 提供)。 */
  readonly mounted: boolean
  /** 规则条数(服务在则读活实例,否则解析规则文件;两者皆缺 = 0)。 */
  readonly ruleCount: number
  /** 规则来源描述(服务实例 / 文件路径 / 未配置)。 */
  readonly ruleSource: string
  /** 审计条数(.eterna/audit-YYYYMMDD.jsonl 按日轮转文件 + 旧版 .eterna/audit.jsonl 的非空行合计;@eterna/audit 未装载 = 0)。 */
  readonly auditEntries: number
  /** 审计来源:单文件 = 其路径,多文件(按日轮转)= 落盘目录;null = 审计文件不存在(未接线)。 */
  readonly auditSource: string | null
}

/** memory 卡片:实体数 + 最近 5 条 key。 */
export interface MemorySnapshot {
  /** sqlite 库文件是否存在(glue memory-plugin 缺省 cwd/.eterna/memory.sqlite3)。 */
  readonly available: boolean
  /** 库文件路径(缺省约定路径)。 */
  readonly dbPath: string
  /** 有效实体数(invalid_at IS NULL)。 */
  readonly entityCount: number
  /** 全部实体行数(含已失效历史,重写顶替留痕)。 */
  readonly totalRows: number
  /** 最近更新的 5 条 key(updated_at 降序)。 */
  readonly recentKeys: readonly MemoryRecentKey[]
  /** 有效实体全量(按 updated_at 降序;「记忆」区块渲染用)。 */
  readonly entities: readonly MemoryEntityView[]
}

/** 单条有效实体(「记忆」区块渲染用)。 */
export interface MemoryEntityView {
  readonly subject: string
  readonly key: string
  /** 记忆内容全文(面板完整渲染)。 */
  readonly content: string
  /** 一句话摘要(空串=无)。 */
  readonly summary: string
  readonly updatedAt: number
}

/** memory 最近一条实体的投影。 */
export interface MemoryRecentKey {
  readonly subject: string
  readonly key: string
  readonly updatedAt: number
}

/** knowledge 卡片:wiki-local 文档数 + WeKnora 状态。 */
export interface KnowledgeSnapshot {
  /** wiki-local sqlite 库文件是否存在。 */
  readonly available: boolean
  readonly dbPath: string
  /** wiki-local 已发布文档数(pages 表行数)。 */
  readonly wikiDocCount: number
  /** 待评审提案数(proposals 表行数)。 */
  readonly proposalCount: number
  /** WeKnora 后端状态(glue 仅装配 wiki-local,未装载 WeKnora 适配器时为 not-mounted)。 */
  readonly weknora: WeknoraStatus
}

/** WeKnora 后端状态投影。 */
export interface WeknoraStatus {
  readonly status: 'ok' | 'error' | 'not-mounted'
  readonly detail: string
}

/** @event 工具清单条目(CTX tools 注册表的活投影 + hitl.yaml 风险档)。 */
export interface ToolCard {
  readonly name: string
  /** hitl.yaml 风险档(R0 只读 / R2 需确认 / R3 高危)。 */
  readonly risk: 'R0' | 'R1' | 'R2' | 'R3'
  /** 是否 R3 高危(资金/法务/定标/预算变更)。 */
  readonly r3: boolean
  /** 工具描述(注册表 description 首行)。 */
  readonly summary: string
}

/** 单个会话的用量投影(session log 的 usage 事件折叠)。 */
export interface SessionUsageCard {
  /** 会话目录名(session-<uuid>)。 */
  readonly id: string
  /** 会话根目录标识(cwd 段)。 */
  readonly area: string
  /** 轮次数(turn/end 计数)。 */
  readonly turns: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  /** 缓存命中率 = cacheRead / (input + cacheRead);input 总量为 0 时 null。 */
  readonly cacheHitRate: number | null
  /** 最近事件时间(ISO)。 */
  readonly lastAt: string
}

/** 可观测区块:最近会话用量样例。 */
export interface ObservabilitySnapshot {
  readonly sessions: readonly SessionUsageCard[]
  /** 读不到任何会话日志时的占位说明;有数据时缺省。 */
  readonly note?: string
}

/** Host 侧只读快照(eternaPanel/snapshot 返回值)。 */
export interface EternaPanelSnapshot {
  readonly generatedAt: string
  /** 快照读取的工作目录(宿主 cwd,决定 .eterna 相对路径)。 */
  readonly workspace: string
  readonly governance: GovernanceSnapshot
  readonly memory: MemorySnapshot
  readonly knowledge: KnowledgeSnapshot
  /** @event 工具清单(CTX tools 注册表过滤;注册表缺失时为空数组)。 */
  readonly tools: readonly ToolCard[]
  readonly observability: ObservabilitySnapshot
}
