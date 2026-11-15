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

/** memory 卡片:实体数 + 最近 5 条 key + 待审队列(M-M2 T9)+ 画像/域浏览(M-M3 T12-②)。 */
export interface MemorySnapshot {
  /** sqlite 库文件是否存在(glue memory-plugin 缺省 cwd/.eterna/memory.sqlite3)。 */
  readonly available: boolean
  /** 库文件路径(缺省约定路径)。 */
  readonly dbPath: string
  /** 有效实体数(invalid_at IS NULL 且已批准;旧库无 review_state 列时 = invalid_at IS NULL)。 */
  readonly entityCount: number
  /** 全部实体行数(含已失效历史,重写顶替留痕)。 */
  readonly totalRows: number
  /** 最近更新的 5 条 key(updated_at 降序)。 */
  readonly recentKeys: readonly MemoryRecentKey[]
  /** 有效实体全量(按 updated_at 降序;「记忆」区块渲染用;待审行不混入——pending 不算已生效记忆)。 */
  readonly entities: readonly MemoryEntityView[]
  /** 待审记忆数(review_state='pending' 且 invalid_at IS NULL;T9 审批队列;旧库无此列 = 0)。 */
  readonly pendingCount: number
  /** 待审记忆列表(审批队列最小视图;updated_at 降序,≤50 条)。 */
  readonly pending: readonly MemoryPendingView[]
  /** 用户画像派生视图(portrait.md 解析;文件缺席 = available:false,面板显示「尚未生成」)。 */
  readonly portrait: MemoryPortraitSnapshot
  /** 域浏览(domain_registry 投影;候选域一并列出,registered=null 标记候选)。 */
  readonly domains: readonly MemoryDomainBrowseView[]
  /** T13 在线指标(审计账本聚合 + 现算注入;无数据时各率为 null,面板显示「暂无」)。 */
  readonly metrics: MemoryMetricsView
}

/**
 * T13 验收指标视图(19 号 §5-T13/§9-6;@eterna/memory metrics.ts 的 JSON 投影,
 * rate/时长为 null = 无数据(分母为零或库缺席),不是 0)。
 */
export interface MemoryMetricsView {
  readonly reviews: {
    readonly approved: number
    readonly rejected: number
    readonly acceptanceRate: number | null
  }
  readonly reviewLatencyMs: { readonly count: number; readonly medianMs: number | null; readonly maxMs: number | null }
  readonly corrections: { readonly count: number; readonly portraitEntries: number; readonly correctionRate: number | null }
  readonly domainResolves: {
    readonly total: number
    readonly bound: number
    readonly workspace: number
    readonly merged: number
    readonly promoted: number
    readonly candidate: number
    readonly none: number
  }
  /** 索引预算占用分布(单区锚点形态/库缺席 = null;口径:最近使用域 + 库同目录画像)。 */
  readonly indexZones: { readonly portrait: number; readonly domain: number; readonly fallback: number; readonly total: number } | null
}

/**
 * 画像卡数据面(M-M3 T12-②,19 号 §5-T12.2;18 §10「画像 = 派生视图」):
 * 分节展示 + 逐节「纠正此项」(落 user 层记忆的显式通道;纠正必须落到事实源,
 * 只改视图会在下次再生时回弹,17 §3.3-6)。
 */
export interface MemoryPortraitSnapshot {
  /** portrait.md 是否存在且正文非空(缺席=false;glue 索引注入与文件存在同判据)。 */
  readonly available: boolean
  /** frontmatter version(缺席/坏值 null)。 */
  readonly version: number | null
  /** frontmatter generated_at(ISO 串;缺席 null)。 */
  readonly generatedAt: string | null
  /** 分节(工作习惯/风格偏好/协作要求/工作区索引;空画像/无节 = 空表)。 */
  readonly sections: readonly MemoryPortraitSectionView[]
}

/** 画像分节(逐节「纠正此项」的锚点;lines 已剥离 Markdown 记号)。 */
export interface MemoryPortraitSectionView {
  readonly title: string
  readonly lines: readonly string[]
}

/** 域浏览条目(域名/条数/最近使用/待审,19 号 §5-T12.2 原文口径)。 */
export interface MemoryDomainBrowseView {
  readonly domainKey: string
  readonly label: string
  /** workspace|taxonomy|free(展示为「显式域/分类/自由域」)。 */
  readonly source: string
  /** 转正时刻;null=候选中(≥3 会话命中转正,Q2)。 */
  readonly registered: number | null
  readonly sessionCount: number
  readonly memoryCount: number
  readonly lastUsedAt: number | null
  /** 该域待审记忆条数(pending 且未失效)。 */
  readonly pendingCount: number
}

/**
 * 单条待审记忆(审批队列;整固/摘要提案落库后等待人工裁决——批准生效,
 * 拒绝软失效,19 号 §4-T9)。字段即 entity-store 存储契约的投影。
 */
export interface MemoryPendingView {
  readonly id: number
  readonly subject: string
  readonly key: string
  /** 记忆正文全文(面板完整渲染)。 */
  readonly content: string
  /** 一句话摘要(空串=无)。 */
  readonly summary: string
  /** 写入来源(explicit/agent/consolidation/compaction;旧库缺省 agent)。 */
  readonly source: string
  /** 出处会话(provenance;NULL=旧行/工具未盖章)。 */
  readonly originSessionId: string | null
  readonly updatedAt: number
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

/** 裁决端点(eternaPanel/review)返回的记忆行投影(record=null 表示行不存在/已处理)。 */
export interface MemoryReviewRecordView {
  readonly id: number
  readonly subject: string
  readonly key: string
  /** 裁决后的评审状态(approved 生效 / rejected 软失效)。 */
  readonly reviewState: string
  /** 失效时刻(rejected 时为裁决时刻;approved 不动)。 */
  readonly invalidAt: number | null
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
