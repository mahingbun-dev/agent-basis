/**
 * 统一出口规范的核心类型(设计文档 11 §2:一个出口,两个后端)。
 *
 * KnowledgeHit 是模型看到的唯一结果形态,无论 wiki-local 还是 weknora;
 * provenance 两后端都必须填全——这是"废弃知识不影响 agent"的数据基础。
 */

/** 后端标识(注册表开放扩展,内置两个)。 */
export type BackendId = string

/** 页面/文档状态:active 生效;stale 超龄待核;deprecated 废弃(搜索默认过滤)。 */
export type DocStatus = 'active' | 'stale' | 'deprecated'

/** 信任级:official 官方;verified 已核验;agent_drafted agent 草稿(未过审不可见)。 */
export type TrustLevel = 'official' | 'verified' | 'agent_drafted'

/** 评审状态:reviewed 已过审;pending 待审。 */
export type ReviewState = 'reviewed' | 'pending'

/** 统一溯源规范(两后端都必须填全;设计文档 11 §2.1)。 */
/**
 * 可选字段显式带 `| undefined`:数据来自 YAML frontmatter / SQLite NULL 往返,
 * "显式 undefined" 与 "键缺省" 在本包语义等价(exactOptionalPropertyTypes 下二者类型不同)。
 */
export interface Provenance {
  /** 权威来源(原文出处/URL),人可核对。 */
  readonly origin: string
  /** 创建日期(YYYY-MM-DD)。 */
  readonly created?: string | undefined
  /** 语义更新时间(非系统时间)。 */
  readonly updated?: string | undefined
  /** 生效时间(bi-temporal 简化版)。 */
  readonly valid_at?: string | undefined
  readonly status: DocStatus
  /** 被谁取代(废弃必填)。 */
  readonly superseded_by?: string | undefined
  readonly trust: TrustLevel
  readonly review: ReviewState
}

/** 文档引用:backend + doc_id 定位,source_uri 可直接点开(文件路径或平台 URL)。 */
export interface DocRef {
  readonly doc_id: string
  readonly source_uri: string
  readonly backend: BackendId
}

/** 模型看到的每条检索结果(两后端长一样)。 */
export interface KnowledgeHit {
  readonly ref: DocRef
  readonly title: string
  readonly snippet: string
  /** [0,1] 区间的排序置信分(RRF/BM25 归一)。 */
  readonly score: number
  readonly provenance: Provenance
}

/** 检索模式:hybrid 关键词+向量融合;keyword 仅关键词;semantic 仅向量(无向量提供方时降级 keyword)。 */
export type SearchMode = 'hybrid' | 'keyword' | 'semantic'

/** 追加过滤(在"deprecated/superseded/未过审"硬过滤之上叠加)。 */
export interface SearchFilters {
  /** 只保留指定信任级。 */
  readonly trust?: readonly TrustLevel[] | undefined
  /** 额外把 stale 也滤掉(默认 stale 可见,仅引用处警示)。 */
  readonly exclude_stale?: boolean | undefined
}

export interface SearchQuery {
  readonly query: string
  readonly mode?: SearchMode
  readonly top_k?: number
  readonly filters?: SearchFilters
}

/** changelog 条目:事实变更不改写历史,旧结论进 changelog(设计文档 11 §3.1)。 */
export interface ChangelogEntry {
  readonly date: string
  readonly note: string
}

/** 完整文档(knowledge_read 返回;含 changelog 段)。 */
export interface KnowledgeDoc {
  readonly ref: DocRef
  readonly title: string
  readonly tags: readonly string[]
  readonly body: string
  readonly wikilinks: readonly string[]
  readonly changelog: readonly ChangelogEntry[]
  readonly provenance: Provenance
  /** 统一引用输出:[《标题》](source_uri)(更新于 updated;状态)。 */
  readonly citation: string
}

/** 提案写入载荷(统一写入口;只产生提案,不直接生效)。 */
export interface DocPatch {
  readonly title: string
  readonly body: string
  readonly tags?: readonly string[] | undefined
  /** 权威来源(原文/URL);缺省标注 agent 撰写。 */
  readonly origin?: string | undefined
  /** 指定落盘相对路径(缺省 agent-drafts/<doc_id>.md)。 */
  readonly path?: string | undefined
  /** 指定 doc_id(缺省由标题生成 slug)。 */
  readonly doc_id?: string | undefined
  /** 首条 changelog 记录(缺省自动生成提案记录)。 */
  readonly changelog_note?: string | undefined
}

export type ProposalState = 'pending' | 'approved' | 'rejected'

/** 知识提案:propose 产物,经 governance 门禁后才发布。 */
export interface KnowledgeProposal {
  readonly id: string
  readonly state: ProposalState
  readonly patch: DocPatch
  readonly created_at: string
  readonly decided_at?: string | undefined
  readonly decided_by?: string | undefined
  /** 拒绝理由/发布去向(发布后的 doc_id)。 */
  readonly note?: string | undefined
}

/** 门禁决策:approve 可指定过审后的信任级(缺省 verified);reject 附理由。 */
export type GateDecision =
  | { readonly kind: 'approve'; readonly trust?: TrustLevel }
  | { readonly kind: 'reject'; readonly reason: string }

/** governance 门禁钩子:提案 → 决策。抛错按 reject 处理(fail-closed)。 */
export type GovernanceGate = (proposal: KnowledgeProposal) => Promise<GateDecision> | GateDecision

/** 后端能力声明。 */
export interface BackendCapabilities {
  readonly write: boolean
  readonly deprecate: boolean
  readonly graph: boolean
}

export interface BackendHealth {
  readonly ok: boolean
  readonly doc_count: number
  /** 不健康/未配置原因(ok:false 时必填)。 */
  readonly reason?: string | undefined
  readonly last_sync?: string | undefined
}

/** 宿主面后端接口(两个后端实现同一接口;设计文档 11 §2.2)。 */
export interface KnowledgeBackend {
  readonly id: BackendId
  readonly capabilities: BackendCapabilities
  search(query: SearchQuery): Promise<readonly KnowledgeHit[]>
  read(ref: DocRef): Promise<KnowledgeDoc>
  health(): Promise<BackendHealth>
  /** 统一写入口:只产生提案(可选能力,capabilities.write=true 时应当存在)。 */
  propose?(patch: DocPatch): Promise<string>
  /** 废弃/取代(可选能力,capabilities.deprecate=true 时应当存在)。 */
  deprecate?(docId: string, reason: string, supersededBy?: string): Promise<{ undo(): Promise<void> }>
  /** 配逆:释放后端持有的资源(effect 闭包)。 */
  dispose?(): void
}

/** 向量检索提供方(接口留位,sqlite-vec/本地嵌入后置;设计文档 11 §3.2)。 */
export interface SemanticSearchProvider {
  readonly id: string
  /** 返回 doc_id 与 [0,1] 相似分,长度 ≤ top_k。 */
  search(query: string, topK: number): Promise<readonly { doc_id: string; score: number }[]>
}

/** 后端探活/状态报告(knowledge_status 的返回单元)。 */
export interface BackendStatusReport extends BackendHealth {
  readonly id: BackendId
  readonly capabilities: BackendCapabilities
  readonly configured: boolean
}
