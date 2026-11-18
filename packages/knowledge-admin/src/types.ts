/**
 * @eterna/knowledge-admin 的**契约单一事实源**(Lead 的 Client 半边 import 此文件)。
 *
 * 两面共用同一个文件(与 @eterna/panel 的 types.ts 同款纪律):Host 端
 * (Remote 网关方法 + 路由面 pin)与 Browser 端(侧栏面板)都只从这里取端点名、
 * 请求参数类型与响应封套,避免两面漂移。
 *
 * ## 端点命名(两面一致,改这里即两面同时生效)
 * - Typert 网关方法名:`eternaKnowledgeAdmin/<method>`(服务 key = `eternaKnowledgeAdmin`);
 * - access 守卫路径:`/api/knowledgeAdmin/<method>`(cookie 身份在守卫,见 README「接入 access 守卫」);
 * - 方法清单见 {@link KnowledgeAdminMethod}(17 个)。
 *
 * ## 统一封套
 * 每个方法返回 {@link KnowledgeResult} 封套:`{ ok: true, value } | { ok: false, code, message }`。
 * 前端不做字段猜测;`ok:false` 时 `code` 取值见 {@link KnowledgeAdminErrorCode}。
 *
 * ## 目标账号语义(account)
 * - 每个**读/写知识库的方法**都可带 `account`(字符串)。**空串或缺省 = 调用者本人账号**;
 * - 服务面把「调用者身份」(caller:守卫注入)与「目标账号」(payload.account)**分开判定**:
 *   非管理员且 `payload.account !== caller.account` → `{ ok:false, code:'forbidden' }`;
 * - 管理员可操作任意账号;`account === '*'` 在 `listAccounts`/`overview`/`listMembers` 里表示"全局视角",
 *   对其他方法等价于 `forbidden`/`invalid`(不猜)。
 *
 * ## 凭据红线
 * 本包**不读任何凭据文件**。DeepWiki 的 `bearerRef` 只经宿主 `ctx.get('credentials')` 解析,
 * 错误信息里绝不回显令牌。
 */

/** 服务 id(路由面 pin + Remote 服务 key;README 契约表与 client 均按此字面量对齐)。 */
export const ETERNA_KNOWLEDGE_ADMIN_SERVICE_ID = 'eternaKnowledgeAdmin'

/**
 * 路由面注册键(`access` 守卫按 `deps.reflect.get('eterna-knowledge-admin', false)` 取它)。
 *
 * 必须与 {@link ETERNA_KNOWLEDGE_ADMIN_SERVICE_ID}(`eternaKnowledgeAdmin`,Typert 网关
 * 自己占用的服务键)**区分开**:网关构造时已 provide 了同名服务,若再 provide 同键即
 * `service "..." has been registered at <...>` 激活失败。故路由面用插件名的连字符形态。
 */
export const ETERNA_KNOWLEDGE_ADMIN_ROUTE_FACE_ID = 'eterna-knowledge-admin'

/** 服务 <-> 网关命名空间前缀(Typert 方法全名 = `eternaKnowledgeAdmin/<method>`)。 */
export const KNOWLEDGE_ADMIN_ENDPOINT_PREFIX = `${ETERNA_KNOWLEDGE_ADMIN_SERVICE_ID}/`

/** access 守卫路径前缀(守卫注册 `/api/knowledgeAdmin/<method>`)。 */
export const KNOWLEDGE_ADMIN_GUARD_PREFIX = '/api/knowledgeAdmin/'

/** 消费的知识服务 id(glue knowledge-plugin 注册;字面量对齐,本包不引依赖)。 */
export const KNOWLEDGE_SERVICE_ID = '@eterna/knowledge'

/** 消费的账号知识面 id(glue knowledge-plugin 注册的只读计数面;字面量对齐)。 */
export const ETERNA_KNOWLEDGE_ACCOUNTS_SERVICE_ID = 'eterna-knowledge-accounts'

/** 审计服务 key(`ctx.get('audit')`;缺席时静默,只写本地 jsonl)。 */
export const AUDIT_SERVICE_ID = 'audit'

/** 模型服务 key(`ctx.get('llm')`;`ask` 用)。 */
export const LLM_SERVICE_ID = 'llm'

/** 默认模型选择服务 key(`ctx.get('agentDefaultModel')`;`currentSelection()`)。 */
export const AGENT_DEFAULT_MODEL_SERVICE_ID = 'agentDefaultModel'

/** 凭据服务 key(`ctx.get('credentials')`;仅解析 bearerRef,绝不用它读文件)。 */
export const CREDENTIALS_SERVICE_ID = 'credentials'

/** `knowledge_admin` 工具名(Agent 面)。 */
export const KNOWLEDGE_ADMIN_TOOL_NAME = 'knowledge_admin'

/** `@eterna/knowledge-admin` 插件名(bundle loader 行 id 派生)。 */
export const ETERNA_KNOWLEDGE_ADMIN_PLUGIN_NAME = 'eterna-knowledge-admin'

/** 统一错误码(前端按它分支,不按 message 字串分支)。 */
export type KnowledgeAdminErrorCode =
  /** 越权:非管理员操作他人账号。 */
  | 'forbidden'
  /** 身份缺失/不可解析(守卫没注入身份,fail-closed)。 */
  | 'unauthorized'
  /** 参数非法(字段缺失/类型错/超长/枚举越界)。 */
  | 'invalid'
  /** 依赖缺席(知识服务未挂载/LLM 未配置/账号库未开通)。 */
  | 'unavailable'
  /** 目标不存在(文档/提案/账号/成员)。 */
  | 'not_found'
  /** 状态机冲突(重复评审/已废弃/不可撤销等;后端 KnowledgeStateError)。 */
  | 'state'
  /** 其余未分类失败(实现细节在 message 里,绝不回显令牌)。 */
  | 'internal'

/** 统一返回封套(全部 17 个方法同形)。 */
export type KnowledgeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: KnowledgeAdminErrorCode; readonly message: string }

/** 便捷构造器(服务面与路由面共用;不导出为 API,client 只消费类型)。 */
export function ok<T>(value: T): KnowledgeResult<T> {
  return { ok: true, value }
}

export function fail<T = never>(code: KnowledgeAdminErrorCode, message: string): KnowledgeResult<T> {
  return { ok: false, code, message }
}

// ─────────────────────────────────────────────────────────────────────────────
// 公共结构(与 @eterna/knowledge 的返回形态对齐,但不引依赖,避免 client 包体拖库)
// ─────────────────────────────────────────────────────────────────────────────

/** 文档状态(与 knowledge DocStatus 同值域)。 */
export type KnowledgeAdminDocStatus = 'active' | 'stale' | 'deprecated'

/** 信任级(与 knowledge TrustLevel 同值域)。 */
export type KnowledgeAdminTrustLevel = 'official' | 'verified' | 'agent_drafted'

/** 评审状态。 */
export type KnowledgeAdminReviewState = 'reviewed' | 'pending'

/** 提案状态。 */
export type KnowledgeAdminProposalState = 'pending' | 'approved' | 'rejected'

/** 溯源投影(两后端同形;`origin` 必填,人可核对)。 */
export interface KnowledgeAdminProvenance {
  readonly origin: string
  readonly created?: string | undefined
  readonly updated?: string | undefined
  readonly valid_at?: string | undefined
  readonly status: KnowledgeAdminDocStatus
  readonly superseded_by?: string | undefined
  readonly trust: KnowledgeAdminTrustLevel
  readonly review: KnowledgeAdminReviewState
}

/** 文档引用投影。 */
export interface KnowledgeAdminDocRef {
  readonly doc_id: string
  readonly source_uri: string
  readonly backend: string
}

/** 检索命中投影(模型面/面板面同形)。 */
export interface KnowledgeAdminHit {
  readonly ref: KnowledgeAdminDocRef
  readonly title: string
  readonly snippet: string
  readonly score: number
  readonly provenance: KnowledgeAdminProvenance
  /** 命中来源:wiki-local 本地分库 / weknora / deepwiki(增强源,不可达时缺席)。 */
  readonly source?: 'wiki-local' | 'weknora' | 'deepwiki' | 'catalog' | undefined
}

/** 文档列表项(分页单元;不返回全文,只有摘要)。 */
export interface KnowledgeAdminDocSummary {
  readonly doc_id: string
  readonly title: string
  readonly snippet: string
  readonly tags: readonly string[]
  readonly source_uri: string
  readonly provenance: KnowledgeAdminProvenance
}

/** 文档读取结果(全文 + changelog + wikilinks + 统一 citation)。 */
export interface KnowledgeAdminDoc {
  readonly ref: KnowledgeAdminDocRef
  readonly title: string
  readonly tags: readonly string[]
  readonly body: string
  readonly wikilinks: readonly string[]
  readonly changelog: readonly { readonly date: string; readonly note: string }[]
  readonly provenance: KnowledgeAdminProvenance
  readonly citation: string
}

/** 提案投影(pending/approved/rejected 三态)。 */
export interface KnowledgeAdminProposal {
  readonly id: string
  readonly state: KnowledgeAdminProposalState
  readonly title: string
  readonly body: string
  readonly tags: readonly string[]
  readonly origin?: string | undefined
  readonly path?: string | undefined
  readonly doc_id?: string | undefined
  readonly changelog_note?: string | undefined
  readonly created_at: string
  readonly decided_at?: string | undefined
  readonly decided_by?: string | undefined
  readonly note?: string | undefined
  /** 提案所在分库的账号(前端展示"这条提案属于谁")。 */
  readonly account: string
}

/** 分页投影(全部 list 方法同形)。 */
export interface KnowledgeAdminPage<T> {
  readonly items: readonly T[]
  /** 请求的 offset(回显)。 */
  readonly offset: number
  /** 请求的 limit(回显)。 */
  readonly limit: number
  /** 满足过滤的总条数(按 limit 取页前统计)。 */
  readonly total: number
  /** 是否还有下一页(前端据此渲染"加载更多")。 */
  readonly has_more: boolean
}

/** 账号(租户目录/全局库)投影。 */
export interface KnowledgeAdminAccountInfo {
  /** 账号名;全局库为 `'*'`(管理员专属视角)。 */
  readonly account: string
  /** true = 全局库(admin 视角:login 账号与本地单库形态);false = `<tenantRoot>/<account>/` 分库。 */
  readonly global: boolean
  /** wiki 目录绝对路径(全局库=admin 视角的 cwd knowledge.wiki)。 */
  readonly wiki_dir: string
  /** 索引 sqlite 绝对路径。 */
  readonly db_path: string
  /** 分库是否已开通(目录/库文件存在)。未开通=只读信息齐全但计数为 0。 */
  readonly available: boolean
  /** 是否当前调用者自己的账号。 */
  readonly self: boolean
}

/** 健康/来源状态(`testSource` 与 `overview` 的 sources 条目)。 */
export interface KnowledgeAdminSourceStatus {
  /** 来源 id:wiki-local(本地)、deepwiki(自建 LLM wiki)、weknora(knowledge 服务内的既有后端)。 */
  readonly id: string
  /** 'ok' 可用;'unauthorized' 401/403(不重试不绕);'unreachable' 网络/5xx/非 JSON;'not-configured' 未启用;'not-mounted' 服务未挂载。 */
  readonly status: 'ok' | 'unauthorized' | 'unreachable' | 'not-configured' | 'not-mounted'
  /** 人可读原因(不含任何令牌)。 */
  readonly detail: string
  /** 探测命中的具体路径(诊断用;未探测=undefined)。 */
  readonly probed_path?: string | undefined
  /** 探测耗时 ms(诊断用)。 */
  readonly elapsed_ms?: number | undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// 方法入参/出参(17 个;字段名即 wire 字段名,README 契约表逐字段抄录)
// ─────────────────────────────────────────────────────────────────────────────

/** `listAccounts` 入参:无。 */
export interface ListAccountsArgs {
  /** 仅管理员可见全局账号清单;普通账号恒返回本人一条(服务面忽略 false)。 */
  readonly includeAll?: boolean | undefined
}

export interface ListAccountsValue {
  readonly accounts: readonly KnowledgeAdminAccountInfo[]
}

/** `overview` 入参。`account` 空/缺省 = 调用者本人。 */
export interface OverviewArgs {
  readonly account?: string | undefined
}

export interface OverviewValue {
  readonly account: KnowledgeAdminAccountInfo
  readonly doc_count: number
  readonly proposal_pending: number
  readonly proposal_approved: number
  readonly proposal_rejected: number
  readonly last_sync?: string | undefined
  readonly sources: readonly KnowledgeAdminSourceStatus[]
  /** 后端本身不可用时的原因(fail-soft:其他字段仍返回真实读数/0)。 */
  readonly degraded?: readonly string[] | undefined
}

/** `listDocs` 入参(分页 + 过滤)。 */
export interface ListDocsArgs {
  readonly account?: string | undefined
  /** 关键词(标题/正文子串;缺省不筛)。 */
  readonly query?: string | undefined
  /** 状态过滤(缺省全部;含 deprecated 便于管理面看归档页)。 */
  readonly status?: readonly KnowledgeAdminDocStatus[] | undefined
  /** 页大小(缺省 20,上限 200;越界按上限截断并如实回显)。 */
  readonly limit?: number | undefined
  /** 偏移(缺省 0)。 */
  readonly offset?: number | undefined
}

export type ListDocsValue = KnowledgeAdminPage<KnowledgeAdminDocSummary>

/** `readDoc` 入参。 */
export interface ReadDocArgs {
  readonly account?: string | undefined
  readonly doc_id: string
}

export type ReadDocValue = KnowledgeAdminDoc

/** `saveDoc` 入参(新建 or 编辑)。 */
export interface SaveDocArgs {
  readonly account?: string | undefined
  /** 目标文档 id;缺省=新建(由 title slug 生成)。 */
  readonly doc_id?: string | undefined
  readonly title: string
  readonly body: string
  readonly tags?: readonly string[] | undefined
  /** 权威来源(原文/URL);缺省标注"人写,经管理面板提交"。 */
  readonly origin?: string | undefined
  /** 落盘相对路径(缺省 `agent-drafts/<doc_id>.md`;编辑时省略=沿用原路径)。 */
  readonly path?: string | undefined
  /** 首条 changelog 记录。 */
  readonly changelog_note?: string | undefined
  /**
   * 是否在两段式(propose→reviewProposal)同一次调用内直接发布。
   * 缺省 true(人审面);false 只落 pending 提案(留给 `reviewProposal` 显式批准)。
   */
  readonly publish?: boolean | undefined
}

export interface SaveDocValue {
  readonly proposal_id: string
  /** 提案最终状态(publish=false 时恒为 'pending')。 */
  readonly state: 'pending' | 'approved' | 'rejected'
  /** 发布后的文档引用(publish=false 或 reject 时 undefined)。 */
  readonly published?: KnowledgeAdminDocRef | undefined
  /** 发布依据/拒绝原因(人可读)。 */
  readonly note?: string | undefined
}

/** `deprecateDoc` 入参。 */
export interface DeprecateDocArgs {
  readonly account?: string | undefined
  readonly doc_id: string
  /** 废弃理由(必填;写 changelog)。 */
  readonly reason: string
  /** 取代者 doc_id(若是新文档废弃旧文档,必填;既有 superseded_by 可沿用)。 */
  readonly superseded_by?: string | undefined
}

export interface DeprecateDocValue {
  readonly doc_id: string
  readonly deprecated: true
  /** 逆闭包描述(前端"撤销"按钮的说明;**不在服务面代签**,人是执行主体)。 */
  readonly undo_available: boolean
  readonly undo_hint: string
  /** 撤销令牌(服务面持有内存 undo,前端只回传 doc_id+token;过期失效)。 */
  readonly undo_token: string
}

/** `listProposals` 入参。 */
export interface ListProposalsArgs {
  readonly account?: string | undefined
  /** 状态过滤(缺省 ['pending']——管理面默认"待我审";传空数组=全部)。 */
  readonly state?: readonly KnowledgeAdminProposalState[] | undefined
  readonly limit?: number | undefined
  readonly offset?: number | undefined
}

export type ListProposalsValue = KnowledgeAdminPage<KnowledgeAdminProposal>

/** `reviewProposal` 入参(posture='approve' 走真发布)。 */
export interface ReviewProposalArgs {
  readonly account?: string | undefined
  readonly proposal_id: string
  readonly decision: 'approve' | 'reject'
  /** 拒绝理由(decision='reject' 必填)。 */
  readonly reason?: string | undefined
  /** 过审后的信任级(缺省 'verified';'agent_drafted' 会被后端转正为 verified)。 */
  readonly trust?: 'official' | 'verified' | 'agent_drafted' | undefined
}

export interface ReviewProposalValue {
  readonly proposal_id: string
  readonly state: KnowledgeAdminProposalState
  readonly published?: KnowledgeAdminDocRef | undefined
  readonly note?: string | undefined
}

/** `discardProposal` 入参(只撤 pending 提案)。 */
export interface DiscardProposalArgs {
  readonly account?: string | undefined
  readonly proposal_id: string
}

export interface DiscardProposalValue {
  readonly proposal_id: string
  readonly discarded: true
}

/** `search` 入参。 */
export interface SearchArgs {
  readonly account?: string | undefined
  readonly query: string
  readonly top_k?: number | undefined
  readonly mode?: 'hybrid' | 'keyword' | 'semantic' | undefined
  /** 是否把 DeepWiki 内容匹配并进结果(缺省 true;不可达时 fail-soft 跳过)。 */
  readonly include_sources?: boolean | undefined
}

export interface SearchValue {
  readonly hits: readonly KnowledgeAdminHit[]
  /** 实际参与检索的来源(按优先级序)。 */
  readonly contributed: readonly string[]
  /** 降级来源与原因(fail-soft 明细;模型/面板都要能看见"为什么少了来源")。 */
  readonly degraded: readonly { readonly source: string; readonly reason: string }[]
}

/** `ask` 入参。 */
export interface AskArgs {
  readonly account?: string | undefined
  readonly question: string
  readonly top_k?: number | undefined
  /** 是否把 DeepWiki 内容并入上下文(缺省 true)。 */
  readonly include_sources?: boolean | undefined
}

export interface AskValue {
  readonly answer: string
  /** 引用来源(答案里的 `[1]` 等编号 → 该条目;"不编造"纪律:每句结论须有引用)。 */
  readonly citations: readonly KnowledgeAdminHit[]
  /** 实际模型(provider/model;诊断用)。 */
  readonly model?: { readonly provider: string; readonly model: string } | undefined
  readonly degraded: readonly { readonly source: string; readonly reason: string }[]
}

/** `importMarkdown` 入参(多条 markdown 文本 → 逐条落 pending 提案)。 */
export interface ImportMarkdownArgs {
  readonly account?: string | undefined
  readonly documents: readonly {
    readonly title: string
    readonly body: string
    readonly tags?: readonly string[] | undefined
    readonly origin?: string | undefined
    readonly path?: string | undefined
  }[]
  /** true=导入后立即发布(缺省 false,全部落 pending 供人审)。 */
  readonly publish?: boolean | undefined
}

export interface ImportMarkdownValue {
  readonly proposals: readonly {
    readonly title: string
    readonly proposal_id?: string | undefined
    readonly state: 'pending' | 'approved' | 'rejected'
    readonly doc_id?: string | undefined
    readonly error?: string | undefined
  }[]
  readonly created: number
  readonly failed: number
}

/** `importRepo` 入参(仓库 → markdown 片段 → pending 提案)。 */
export interface ImportRepoArgs {
  readonly account?: string | undefined
  /** 仓库路径(**必须位于目标账号 workspace 目录之内**;resolve+relative 前缀判定,越界即 forbidden)。 */
  readonly repo_path: string
  /** 'spawn'=真跑 `scripts/wiki-generate.mjs`;'stub'=从 MEMORY_INDEX/README/文件树生成占位页(如实标注)。 */
  readonly engine?: 'spawn' | 'stub' | undefined
  /** 单次最多落几条提案(缺省 20,上限 200)。 */
  readonly max_files?: number | undefined
  /** true=导入后立即发布(缺省 false)。 */
  readonly publish?: boolean | undefined
}

export interface ImportRepoValue {
  /** 实际使用的引擎(如实回显;'stub' 时 reason 写明"真实生成需子进程引擎")。 */
  readonly engine: 'spawn' | 'stub'
  readonly proposals: readonly {
    readonly title: string
    readonly proposal_id?: string | undefined
    readonly state: 'pending' | 'approved' | 'rejected'
    readonly doc_id?: string | undefined
    readonly source_path?: string | undefined
    readonly error?: string | undefined
  }[]
  readonly created: number
  readonly failed: number
  readonly reason: string
}

/** 权限级别(本人分库成员可见级别;admin 恒全权)。 */
export type KnowledgeAdminMemberLevel = 'owner' | 'editor' | 'viewer'

/** 成员级别全集(存储层与校验共用一份,避免枚举漂移)。 */
export const MEMBER_LEVELS: readonly KnowledgeAdminMemberLevel[] = ['owner', 'editor', 'viewer']

/** `listMembers` 入参(只按 userId 记账,不读 access users.db 人名)。 */
export interface ListMembersArgs {
  /** 缺省 '*'(全局视角=管理员);普通账号恒返回本人账号条目。 */
  readonly account?: string | undefined
}

export interface KnowledgeAdminMember {
  readonly account: string
  readonly member_user_id: number
  readonly level: KnowledgeAdminMemberLevel
  readonly updated_at: string
}

export interface ListMembersValue {
  readonly members: readonly KnowledgeAdminMember[]
}

/** `setMember` 入参(upsert;去重键 = (account, member_user_id))。 */
export interface SetMemberArgs {
  readonly account?: string | undefined
  readonly member_user_id: number
  /** 'remove' = 删除该成员记录(其余三个为 upsert)。 */
  readonly level: KnowledgeAdminMemberLevel | 'remove'
}

export interface SetMemberValue {
  /** 生效后的记录;level='remove' 时为 undefined。 */
  readonly member?: KnowledgeAdminMember | undefined
  readonly removed: boolean
}

/** `listAudit` 入参(本地 jsonl 审计面过滤)。 */
export interface ListAuditArgs {
  /** 缺省 = 调用者本人账号;'*' 仅管理员可用。 */
  readonly account?: string | undefined
  /** ISO 时间下界(含)。 */
  readonly since?: string | undefined
  /** ISO 时间上界(含)。 */
  readonly until?: string | undefined
  /** 动作过滤(前缀匹配,如 'knowledgeAdmin.';缺省全部)。 */
  readonly action?: string | undefined
  readonly limit?: number | undefined
  readonly offset?: number | undefined
}

/** 审计条目(本地 jsonl 一行;sanitize 后写入)。 */
export interface KnowledgeAdminAuditEntry {
  readonly ts: string
  readonly account: string
  readonly actor: string
  readonly action: string
  readonly outcome: 'ok' | 'error' | 'forbidden'
  readonly detail?: string | undefined
}

export type ListAuditValue = KnowledgeAdminPage<KnowledgeAdminAuditEntry>

/** `testSource` 入参(DeepWiki 源探测;fail-soft 不抛)。 */
export interface TestSourceArgs {
  /** 缺省探测 deepwiki;也接受 wiki-local(本地库自检)。 */
  readonly source?: 'deepwiki' | 'wiki-local' | undefined
  /** 覆盖 baseUrl(缺省取插件配置/`http://127.0.0.1:8001`)。 */
  readonly base_url?: string | undefined
  /** 覆盖 bearerRef(凭据引用;**只经 credentials 服务解析,绝不回显**) 。 */
  readonly bearer_ref?: string | undefined
  /** 仓库归属探测路径用的 owner(缺省 ''=只探通用路径)。 */
  readonly owner?: string | undefined
  /** 仓库名(repo);与 owner 同时在场才探 `/api/wiki/{owner}/{repo}`。 */
  readonly repo?: string | undefined
}

export interface TestSourceValue {
  readonly source: KnowledgeAdminSourceStatus
}

// ─────────────────────────────────────────────────────────────────────────────
// 方法名 union + 端点表(守卫与 client 都照这张表走)
// ─────────────────────────────────────────────────────────────────────────────

/** 17 个方法名(顺序即 README 契约表顺序)。 */
export type KnowledgeAdminMethod =
  | 'listAccounts'
  | 'overview'
  | 'listDocs'
  | 'readDoc'
  | 'saveDoc'
  | 'deprecateDoc'
  | 'listProposals'
  | 'reviewProposal'
  | 'discardProposal'
  | 'search'
  | 'ask'
  | 'importMarkdown'
  | 'importRepo'
  | 'listMembers'
  | 'setMember'
  | 'listAudit'
  | 'testSource'

/** 方法名 → 元数据(守卫合并表 + client 路由表单一来源)。 */
export interface KnowledgeAdminMethodSpec<Args, Value> {
  /** 方法名(网关末段 + 守卫末段)。 */
  readonly method: KnowledgeAdminMethod
  /** Typert 网关方法全名。 */
  readonly endpoint: string
  /** access 守卫路径。 */
  readonly guarded: string
  /** 写面方法(守卫侧据此做 admin/账号判定与审计;读面也走同样身份判定)。 */
  readonly mutating: boolean
  /** 需要管理员(读所有账号清单/全局账号审计等)。 */
  readonly adminOnly: boolean
  /** 参数在 wire 上的键(统一 `args`;与 loopPrompt 守卫 `args.input` 同款形态)。 */
  readonly wireKey: 'args'
  /** 类型占位(仅在编译期被 derive;运行期无值)。 */
  readonly _args?: Args | undefined
  readonly _value?: Value | undefined
}

/** 类型级方法表(编译期钉住每个方法的 Args/Value;`satisfies` 消费)。 */
export interface KnowledgeAdminMethodMap {
  readonly listAccounts: MethodEntry<ListAccountsArgs, ListAccountsValue, false, false>
  readonly overview: MethodEntry<OverviewArgs, OverviewValue, false, false>
  readonly listDocs: MethodEntry<ListDocsArgs, ListDocsValue, false, false>
  readonly readDoc: MethodEntry<ReadDocArgs, ReadDocValue, false, false>
  readonly saveDoc: MethodEntry<SaveDocArgs, SaveDocValue, true, false>
  readonly deprecateDoc: MethodEntry<DeprecateDocArgs, DeprecateDocValue, true, false>
  readonly listProposals: MethodEntry<ListProposalsArgs, ListProposalsValue, false, false>
  readonly reviewProposal: MethodEntry<ReviewProposalArgs, ReviewProposalValue, true, false>
  readonly discardProposal: MethodEntry<DiscardProposalArgs, DiscardProposalValue, true, false>
  readonly search: MethodEntry<SearchArgs, SearchValue, false, false>
  readonly ask: MethodEntry<AskArgs, AskValue, false, false>
  readonly importMarkdown: MethodEntry<ImportMarkdownArgs, ImportMarkdownValue, true, false>
  readonly importRepo: MethodEntry<ImportRepoArgs, ImportRepoValue, true, false>
  readonly listMembers: MethodEntry<ListMembersArgs, ListMembersValue, false, false>
  readonly setMember: MethodEntry<SetMemberArgs, SetMemberValue, true, false>
  readonly listAudit: MethodEntry<ListAuditArgs, ListAuditValue, false, false>
  readonly testSource: MethodEntry<TestSourceArgs, TestSourceValue, false, false>
}

/** 方法表条目形态(args/value 型别 + 是否写面;字面量布尔保持 MethodSpec 消费口径)。 */
export interface MethodEntry<Args, Value, Mutating extends boolean, AdminOnly extends boolean> {
  readonly args: Args
  readonly value: Value
  readonly mutating: Mutating
  readonly adminOnly: AdminOnly
}

/** 守卫/client 消费的方法表(运行期常量;与 {@link KnowledgeAdminMethodMap} 编译期对齐)。 */
export const KNOWLEDGE_ADMIN_METHOD_SPECS: readonly {
  [M in KnowledgeAdminMethod]: {
    readonly method: M
    readonly endpoint: string
    readonly guarded: string
    readonly mutating: boolean
    readonly adminOnly: boolean
    readonly wireKey: 'args'
  }
}[KnowledgeAdminMethod][] = (
  (Object.entries({
    listAccounts: { mutating: false, adminOnly: false },
    overview: { mutating: false, adminOnly: false },
    listDocs: { mutating: false, adminOnly: false },
    readDoc: { mutating: false, adminOnly: false },
    saveDoc: { mutating: true, adminOnly: false },
    deprecateDoc: { mutating: true, adminOnly: false },
    listProposals: { mutating: false, adminOnly: false },
    reviewProposal: { mutating: true, adminOnly: false },
    discardProposal: { mutating: true, adminOnly: false },
    search: { mutating: false, adminOnly: false },
    ask: { mutating: false, adminOnly: false },
    importMarkdown: { mutating: true, adminOnly: false },
    importRepo: { mutating: true, adminOnly: false },
    listMembers: { mutating: false, adminOnly: false },
    setMember: { mutating: true, adminOnly: false },
    listAudit: { mutating: false, adminOnly: false },
    testSource: { mutating: false, adminOnly: false },
  }) as readonly (readonly [KnowledgeAdminMethod, { mutating: boolean; adminOnly: boolean }])[])
).map(([method, flags]) => ({
  method,
  endpoint: `${KNOWLEDGE_ADMIN_ENDPOINT_PREFIX}${method}`,
  guarded: `${KNOWLEDGE_ADMIN_GUARD_PREFIX}${method}`,
  mutating: flags.mutating,
  adminOnly: flags.adminOnly,
  wireKey: 'args' as const,
}))

/** 方法名集合(校验用;守卫与路由面据此拒绝未知方法)。 */
export const KNOWLEDGE_ADMIN_METHODS: readonly KnowledgeAdminMethod[] =
  KNOWLEDGE_ADMIN_METHOD_SPECS.map(spec => spec.method)

export function isKnowledgeAdminMethod(value: string): value is KnowledgeAdminMethod {
  return (KNOWLEDGE_ADMIN_METHODS as readonly string[]).includes(value)
}

// ─────────────────────────────────────────────────────────────────────────────
// 调用者身份(路由面入参;access 守卫按 cookie 注入)
// ─────────────────────────────────────────────────────────────────────────────

/** 路由面调用者身份(守卫侧唯一注入源;服务面绝不自行解析身份)。 */
export interface KnowledgeAdminCaller {
  /** 登录账号名(分库目录名);缺失 = 身份不可解析 → fail-closed。 */
  readonly account: string
  /** 是否管理员(守卫按 access role 判定)。 */
  readonly admin: boolean
  /** 登录 userId(审计 actor + 成员记账;**只存 id,不读 users.db 人名**)。 */
  readonly userId: number
}

/** 无身份(本地单用户/unary 旧形态)时的调用者投影:admin=true、account='local'。 */
export const LOCAL_CALLER: KnowledgeAdminCaller = { account: 'local', admin: true, userId: 0 }

/** 账号断言:非管理员且 payload.account≠caller.account → forbidden。 */
export function accountAllowed(caller: KnowledgeAdminCaller, requested: string | undefined): KnowledgeAdminErrorCode | undefined {
  const target = (requested ?? '').trim()
  if (caller.admin) return undefined
  if (target === '' || target === '*') return target === '*' ? 'forbidden' : undefined
  if (target === caller.account) return undefined
  return 'forbidden'
}

// ─────────────────────────────────────────────────────────────────────────────
// Client 形状面(Lead 的 client 半边消费此类型;全部类型集中在本文件)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Client 侧对 Host 的调用面(浏览器面板经 `ctx.connection.rpc` 调
 * `/api/knowledgeAdmin/<method>`,参数 `{ args }`)。
 * 每个方法返回统一封套;client 不再做字段猜测。
 */
export interface KnowledgeAdminClientContext {
  readonly listAccounts: (args: ListAccountsArgs) => Promise<KnowledgeResult<ListAccountsValue>>
  readonly overview: (args: OverviewArgs) => Promise<KnowledgeResult<OverviewValue>>
  readonly listDocs: (args: ListDocsArgs) => Promise<KnowledgeResult<ListDocsValue>>
  readonly readDoc: (args: ReadDocArgs) => Promise<KnowledgeResult<ReadDocValue>>
  readonly saveDoc: (args: SaveDocArgs) => Promise<KnowledgeResult<SaveDocValue>>
  readonly deprecateDoc: (args: DeprecateDocArgs) => Promise<KnowledgeResult<DeprecateDocValue>>
  readonly listProposals: (args: ListProposalsArgs) => Promise<KnowledgeResult<ListProposalsValue>>
  readonly reviewProposal: (args: ReviewProposalArgs) => Promise<KnowledgeResult<ReviewProposalValue>>
  readonly discardProposal: (args: DiscardProposalArgs) => Promise<KnowledgeResult<DiscardProposalValue>>
  readonly search: (args: SearchArgs) => Promise<KnowledgeResult<SearchValue>>
  readonly ask: (args: AskArgs) => Promise<KnowledgeResult<AskValue>>
  readonly importMarkdown: (args: ImportMarkdownArgs) => Promise<KnowledgeResult<ImportMarkdownValue>>
  readonly importRepo: (args: ImportRepoArgs) => Promise<KnowledgeResult<ImportRepoValue>>
  readonly listMembers: (args: ListMembersArgs) => Promise<KnowledgeResult<ListMembersValue>>
  readonly setMember: (args: SetMemberArgs) => Promise<KnowledgeResult<SetMemberValue>>
  readonly listAudit: (args: ListAuditArgs) => Promise<KnowledgeResult<ListAuditValue>>
  readonly testSource: (args: TestSourceArgs) => Promise<KnowledgeResult<TestSourceValue>>
}
