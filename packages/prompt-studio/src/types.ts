/**
 * @eterna/prompt-studio 线类型契约(T7.1 Host 半边;T7.2 浏览器半边照此消费)。
 *
 * 全部端点经官方 Typert 网关 SRC 模式暴露(namespace = loopPrompt),载荷为纯 JSON
 * (SRC result mode = src-json,见 dsh-api-gateway resolveSrcDescriptor)。
 * 写链路(save/rollback/import)一律两段式:
 *   第一段(无 approvalId)→ 校验 + R3 审批卡,返回 status='approval-required';
 *   第二段(带 approvalId + approved)→ 执行写入,返回 status='committed'。
 * 审批卡载荷由 @eterna/interact buildApprovalCard/cardToQuestionItems 构造
 * (R3 grade + doubleConfirm 二次确认,计划书 §3「写操作全走 interact R3 审批卡」)。
 */
import type { ApprovalCard } from '@eterna/interact'
import type { AskUserQuestionItem } from '@eterna/interact'
import type { PromptEntryKind, PromptLayer, RedLinePolicy } from './registry.ts'

/** 写操作种类(三类全走 R3:保存/回滚/导入,计划书 §3)。 */
export type WriteKind = 'save' | 'rollback' | 'import'

/** 版本来源(initial=装载时种子的当前 persona 基线)。 */
export type VersionSource = 'initial' | 'save' | 'rollback' | 'import'

/**
 * 版本记录(版本库唯一行形态;storage 单元 eterna_prompt_studio/versions 的记录值)。
 * 版本只增不删:本包对版本库不暴露任何删除原语,回滚=追加新记录(parentId 指向被
 * 回滚版本),对齐计划书 §6 T7.3「回滚产生新版本而非删旧版本」。
 */
export interface PromptVersionRecord {
  /** 版本 id(存储层记录键;path-safe,匹配 ^[A-Za-z0-9_-]+$;全局唯一)。 */
  readonly id: string
  /** 该条目版本链内单调递增序号(从 1 起;T1.4 起按 entryId 分链编号)。 */
  readonly seq: number
  /** 归属注册表条目 id(T1.4;v1 存量记录无此字段,读取时默认归 persona 条目)。 */
  readonly entryId: string
  /** 创建时刻 ISO 串。 */
  readonly createdAt: string
  /** 操作者(客户端传入;缺省 'web')。 */
  readonly author: string
  /** 来源。 */
  readonly source: VersionSource
  /** 父版本 id(回滚=被回滚版本;保存/导入=写前最新版本;首版 null)。 */
  readonly parentId: string | null
  /** persona 文本 UTF-8 字节数。 */
  readonly bytes: number
  /** 内容 checksum(sha256 hex,UTF-8 口径;导出包复用同口径)。 */
  readonly checksum: string
  /** 操作摘要(客户端可读)。 */
  readonly summary: string
  /** persona 全文(版本库自含内容,回滚不依赖 patch 现值)。 */
  readonly content: string
}

/** 版本库概览(snapshot/prompt-get 复用;T1.4 起可按 entryId 分链)。 */
export interface VersionOverview {
  /** storage 栈是否已挂载(dsh-base storage/storage-json 行存在且单元打开)。 */
  readonly ready: boolean
  /** 版本总数(只增不删,单调)。 */
  readonly count: number
  /** 最新版本 id(无版本时 null)。 */
  readonly latestId: string | null
  /** 最新版本时刻 ISO(无版本时 null)。 */
  readonly latestAt: string | null
}

/** persona 当前态(从 profile patch 层 preset-standard 行读出)。 */
export interface PersonaState {
  /** patch 层找到 persona prefix 且可读。 */
  readonly available: boolean
  /** persona 全文(不可用时空串)。 */
  readonly text: string
  /** UTF-8 字节数。 */
  readonly bytes: number
  /** profile patch 层文件绝对路径(profileContext.patchPath)。 */
  readonly patchPath: string | null
  /** patch 文件 mtime ISO(不可用时 null)。 */
  readonly updatedAt: string | null
  /** 读取失败原因(available=false 时给人话说明)。 */
  readonly error: string | null
}

// ---------- loopPrompt/snapshot ----------

/** 生效通道说明(T7.0 spike 通道 A 结论;docs/dev/t7-spike.md §1)。 */
export interface ChannelInfo {
  readonly kind: 'A-patch-hmr'
  readonly note: string
}

/** 待审批写入(snapshot 提示客户端有在途 R3 卡)。 */
export interface PendingApprovalView {
  readonly approvalId: string
  readonly kind: WriteKind
  readonly createdAt: string
}

/** 端点 loopPrompt/snapshot 的返回(无参)。 */
export interface LoopPromptSnapshot {
  readonly generatedAt: string
  readonly persona: PersonaState
  readonly versions: VersionOverview
  readonly pendingApproval: PendingApprovalView | null
  /**
   * 提示词注册表全景(T1.4):每条目 = 元数据 + 当前值(运行时读,分型语义)+
   * 版本链概览。T1.5 前端分组导航的数据源;只增字段,旧消费方不受影响。
   */
  readonly entries: readonly EntrySummaryView[]
  /**
   * 轨迹概览。`sessions`=最近会话数(客户端 Stat 瓦片消费);
   * `recent`=最近 20 条会话清单(id/标题/时间/轮次/usage;T7.4 新增,
   * 与 loopPrompt/trace 列表模式同一投影)。
   */
  readonly trace: {
    readonly sessions: number
    readonly pipeline: string
    readonly recent: readonly TraceSessionCard[]
  }
  readonly channel: ChannelInfo
}

// ---------- loopPrompt/trace ----------

/** 端点 loopPrompt/trace 的入参。 */
export interface TraceInput {
  /** 指定会话 id:返回该会话轮次树;缺省:返回最近会话列表。 */
  readonly sessionId?: string
  /** 列表模式下的最近会话数(默认 20,计划书 §4「最近 20 条会话」)。 */
  readonly limit?: number
}

/** 单条会话列表卡(usage 折叠口径对齐 panel session-logs;T7.4 增标题)。 */
export interface TraceSessionCard {
  readonly sessionId: string
  readonly area: string
  /**
   * 会话标题(最后一条 `session/title` 事件的 data.title;读取窗口内缺失时空串)。
   * 真实日志里 fallback 标题(首条用户消息派生)在前、provider 精修标题在后,
   * 「最后一条胜出」自然取到精修标题(T7.4 口径,vitest fixture 钉死)。
   */
  readonly title: string
  readonly turns: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly lastAt: string
}

/** 单次工具调用卡。 */
export interface TraceToolCall {
  readonly callId: string
  readonly name: string
  readonly at: string | null
  /** 参数预览(截断;v0 不做 PII 脱敏,T7.4 接 governance PiiFilter)。 */
  readonly argsPreview: string
  readonly isError: boolean
  readonly errorName: string | null
  /** 调用耗时(call→result 配对;未配对 null)。 */
  readonly durationMs: number | null
}

/**
 * 审批触发点(T7.4 口径:官方 `approval/asked` 审计事件,见
 * @deepseek-ai/dsh-user-approval types.d.ts;ask_user_question 是普通工具调用,
 * 只出现在 tools 里,不再充当审批点)。`outcome`/`decidedAt` 来自配对的
 * `approval/decided`(同 id;未决/未配对为 null)。
 */
export interface TraceApprovalPoint {
  /** 关联工具调用 id(approval/asked 未携带时空串)。 */
  readonly callId: string
  /** 被审批的工具名(approval/asked.toolName)。 */
  readonly name: string
  readonly at: string | null
  /** 审批结果:allowed-once | rejected | cancelled | unavailable(未决 null)。 */
  readonly outcome: string | null
  /** 决定时刻 ISO(未决 null)。 */
  readonly decidedAt: string | null
}

/** 单轮投影(字段缺失容错降级:缺失侧为 null/空,不抛错;T7.4 增推理摘要)。 */
export interface TraceTurn {
  readonly turn: number
  readonly startedAt: string | null
  readonly endedAt: string | null
  readonly durationMs: number | null
  readonly endReason: string | null
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly totalTokens: number
  } | null
  /**
   * 本轮推理摘要:最后一条携带 reasoning 块的 assistant 消息
   * (ContentBlockMap type='reasoning',dsh-llm types)中 reasoning 块按序拼接后
   * 截断;无 reasoning 块为 null。
   */
  readonly reasoningPreview: string | null
  readonly tools: readonly TraceToolCall[]
  readonly approvalPoints: readonly TraceApprovalPoint[]
}

/** 指定会话的轮次树(容错:字段缺失降级,skipped 记坏行数,T7.4 口径)。 */
export interface SessionTrace {
  readonly sessionId: string
  readonly turns: readonly TraceTurn[]
  readonly events: { readonly total: number; readonly projected: number; readonly skipped: number }
}

/** 端点 loopPrompt/trace 的返回。 */
export interface TraceReport {
  readonly generatedAt: string
  readonly sessionsRoot: string
  readonly pipeline: string
  readonly sessions: readonly TraceSessionCard[]
  readonly selected: SessionTrace | null
}

// ---------- loopPrompt/prompt-get ----------

/** 端点 loopPrompt/prompt-get 的入参(T1.4 起支持按条目;缺省=旧 persona 形态)。 */
export interface PromptGetInput {
  /** 注册表条目 id(见 snapshot.entries[]);缺省/空 = 旧形态(persona)。 */
  readonly entryId?: string
}

/** 端点 loopPrompt/prompt-get 的返回(旧形态:不带 entryId;字段与 T7 完全一致)。 */
export interface PromptGetResult {
  readonly persona: PersonaState
  readonly versions: VersionOverview
  /** 生效说明:编辑器顶部「影响:新会话前缀将变化」提示文案(计划书 §7 KV-cache 风险项)。 */
  readonly effectiveNote: string
  /** 组合视图说明(T7.2 起提供只读组合视图;本期只读 persona 段)。 */
  readonly composedNote: string
}

/** 注册表条目元数据视图(snapshot.entries[] 与 per-entry prompt-get 共用;T1.4)。 */
export interface PromptEntryView {
  readonly id: string
  /** 层(preset/domain/runtime)。 */
  readonly layer: PromptLayer
  /** 型别(patch-value/line-anchor-readonly/runtime-injection)。 */
  readonly kind: PromptEntryKind
  /** 来源插件/包。 */
  readonly source: string
  /** 型别注记(只读型/运行时型的「上游运行时生成」标注来源)。 */
  readonly note: string
  /** 风险标注(UI 直接展示)。 */
  readonly risks: readonly string[]
  /** 红线策略(persona 类=required;其余 exempt,T1.6 写链路按此豁免)。 */
  readonly redLine: RedLinePolicy
  /** redLine=required 时的规则集 id。 */
  readonly redLineRuleSet?: string
  /** 写链路字节上限(逐条目校验口径)。 */
  readonly maxBytes: number
  /** patch 值型=true(有版本链);行锚点只读型/运行时注入型=false(无版本链概念)。 */
  readonly versioned: boolean
}

/** 条目当前值视图(T1.4 运行时读;分型语义)。 */
export interface EntryValueView {
  readonly entryId: string
  readonly kind: PromptEntryKind
  /** 当前值:patch 值型=结构定位反引文本;行锚点只读型/运行时注入型=null(无静态值)。 */
  readonly text: string | null
  /** text 的 UTF-8 字节数(无静态值时 null)。 */
  readonly bytes: number | null
  /** 读值问题明细(text=null 且非只读型时非空;不抛错)。 */
  readonly problems: readonly string[]
  /** 型别注记(只读型/运行时型的「上游运行时生成」标注)。 */
  readonly note: string
}

/** snapshot.entries[] 单项(T1.4):条目元数据 + 当前值 + 版本链概览。 */
export interface EntrySummaryView extends PromptEntryView {
  readonly value: EntryValueView
  readonly versions: VersionOverview
}

/** 端点 loopPrompt/prompt-get 的返回(T1.4 按条目形态:input.entryId 非空)。 */
export interface PromptGetEntryResult {
  readonly entry: PromptEntryView
  readonly value: EntryValueView
  /** 该条目版本链概览(store 未挂载 → ready=false;无版本链条目 → count=0)。 */
  readonly versions: VersionOverview
  readonly effectiveNote: string
}

/** 读端点未知条目 id 的明示错误(T1.4;返回结构化结果,不抛裸异常)。 */
export interface EntryNotFoundResult {
  readonly status: 'not-found'
  readonly entryId: string
  readonly issues: readonly string[]
}

// ---------- loopPrompt/session-snapshot(T2.3 会话快照) ----------

/**
 * 快照内单条目的生效提示词记录(指针按条目型别分语义,对齐 T1.3 分型——
 * 未定义语义的型别不得静默空段,测试计划 §4 T2.3(b)①):
 * - patch 值型:text=开启时生效文本全文,versionId=内容 checksum 与之一致的
 *   版本链记录 id(指针);无一致版本(外部改写/写入在途)→ versionId=null +
 *   annotation 明示,**不伪造 versionId**;
 * - 行锚点只读型(time-context):text/versionId=null + 在场标记 annotation
 *   (「上游运行时生成」),不伪造;
 * - 运行时注入型(memory/glue):开启时可解析的 section 文本(注册表自管文本)
 *   或元数据在场标记 annotation。
 */
export interface SessionSnapshotEntry {
  readonly entryId: string
  readonly layer: PromptLayer
  readonly kind: PromptEntryKind
  /** 开启时生效文本全文(patch 值型必填;运行时注入型可解析时有;其余 null)。 */
  readonly text: string | null
  /** text 的 UTF-8 字节数(无文本时 null)。 */
  readonly bytes: number | null
  /** sha256(text),口径同 version-store checksum(无文本时 null)。 */
  readonly checksum: string | null
  /** 条目版本指针(patch 值型:指向内容一致版本的 id;无一致版本/无版本链型 null)。 */
  readonly versionId: string | null
  /** 型别语义标注(只读型/运行时型/无一致版本的明示;可据型别缺席)。 */
  readonly annotation: string | null
  /** 读值问题明细(读失败时非空,不抛错)。 */
  readonly problems: readonly string[]
}

/** 会话快照记录(只增不改:一经写入不可变,无任何删除/改写原语)。 */
export interface SessionSnapshotRecord {
  /** 快照记录 id(path-safe,^[A-Za-z0-9_-]+$;per-record 布局键)。 */
  readonly id: string
  readonly sessionId: string
  readonly createdAt: string
  /** 捕获触发事件(当前唯一:'session/created')。 */
  readonly trigger: string
  /** 全部注册表条目的快照条目(全景,含三型分语义)。 */
  readonly entries: readonly SessionSnapshotEntry[]
  /** 内容整体 checksum(sha256 of 规范化 {sessionId,trigger,entries};不可变复核口径)。 */
  readonly checksum: string
}

/** 端点 loopPrompt/session-snapshot 的入参(无 sessionId → 列表模式)。 */
export interface SessionSnapshotInput {
  /** 指定会话:返回该会话快照全文;缺省 → 最近快照列表。 */
  readonly sessionId?: string
  /** 列表模式最多返回条数(默认 20,新→旧)。 */
  readonly limit?: number
}

/** 列表模式单项(轻量卡;全文按 sessionId 再查)。 */
export interface SessionSnapshotListItem {
  readonly id: string
  readonly sessionId: string
  readonly createdAt: string
  readonly entries: number
  readonly checksum: string
}

/** 列表模式返回(快照存储未挂载 → ready=false 明示,不 5xx;测试计划 §6.5③)。 */
export interface SessionSnapshotListResult {
  readonly status: 'ok'
  readonly ready: boolean
  readonly total: number
  readonly snapshots: readonly SessionSnapshotListItem[]
}

/** 指定会话查询的返回(找到 → 快照全文 + 回放语义说明)。 */
export interface SessionSnapshotGetResult {
  readonly status: 'ok'
  readonly snapshot: SessionSnapshotRecord
  /** 查看语义说明(快照冻结/不可回放型明示;UI 透传)。 */
  readonly note: string
}

/** 指定会话查询:会话无快照(未开启过/事件缺席)→ 明示 not-found,不抛。 */
export interface SessionSnapshotNotFoundResult {
  readonly status: 'not-found'
  readonly sessionId: string
  readonly issues: readonly string[]
}

/** 指定会话查询:快照存储未挂载 → 明示不可用,不 5xx(与 not-found 分态)。 */
export interface SessionSnapshotUnavailableResult {
  readonly status: 'unavailable'
  readonly sessionId: string
  readonly issues: readonly string[]
}

export type SessionSnapshotResult =
  | SessionSnapshotListResult
  | SessionSnapshotGetResult
  | SessionSnapshotNotFoundResult
  | SessionSnapshotUnavailableResult

// ---------- 校验与写结果 ----------

/** 端点 loopPrompt/prompt-save 的入参。 */
export interface PromptSaveInput {
  /** persona 新文本。 */
  readonly content: string
  /** 目标条目 id(T1.6;缺省/空=默认条目 persona,与 T7 调用形态零改动兼容)。 */
  readonly entryId?: string
  /** 乐观锁:与写前最新版本 id 不符则拒绝(可省)。 */
  readonly baseVersionId?: string
  /** 操作摘要。 */
  readonly summary?: string
  /** 操作者(T7.2 传登录用户;缺省 'web')。 */
  readonly author?: string
  /** 审批确认回路:第一段省略;第二段带第一段返回的 approvalId。 */
  readonly approvalId?: string
  /** 审批应答(第二段必带)。 */
  readonly approved?: boolean
}

/** 写链路统一状态机(三端点共用)。 */
export type WriteStatus =
  | 'approval-required'
  | 'committed'
  | 'rejected'
  | 'approval-declined'
  | 'approval-mismatch'
  | 'storage-unavailable'

/** 审批载荷(第一段返回;T7.2 渲染审批卡)。 */
export interface WriteApprovalView {
  readonly approvalId: string
  readonly kind: WriteKind
  readonly card: ApprovalCard
  readonly questionItems: readonly AskUserQuestionItem[]
}

/** 端点 loopPrompt/prompt-save 的返回。 */
export interface PromptSaveResult {
  readonly status: WriteStatus
  /** status=rejected:校验器明细(人话)。 */
  readonly issues?: readonly string[]
  /** status=approval-required:R3 审批卡与官方 user-questions 载荷。 */
  readonly approval?: WriteApprovalView
  /** status=committed:新版本记录。 */
  readonly version?: PromptVersionRecord
  /** 生效说明(通道 A:新会话生效无需重启;UI 按 8s 级等待/轮询后提示)。 */
  readonly effectiveNote: string
}

/** 端点 loopPrompt/prompt-versions 的入参。 */
export interface VersionsInput {
  /** 注册表条目 id(T1.4;缺省/空=旧形态,即默认条目 persona 的版本链)。 */
  readonly entryId?: string
  /** 最多返回条数(默认 50;链内新→旧)。 */
  readonly limit?: number
}

/** 端点 loopPrompt/prompt-versions 的返回。 */
export interface VersionsResult {
  readonly total: number
  readonly ready: boolean
  /** 按条目查询时回显条目 id(旧形态缺省)。 */
  readonly entryId?: string
  readonly versions: readonly PromptVersionRecord[]
}

/** 端点 loopPrompt/prompt-rollback 的入参。 */
export interface PromptRollbackInput {
  /** 目标版本(内容整体写回;版本记录本身不动)。必填,缺失/未知即 rejected。 */
  readonly versionId: string
  /** 目标条目 id(T1.6;可省——版本归属条目即写回落点;给出时须与版本归属一致,且只读型条目 fail-closed 拒回滚)。 */
  readonly entryId?: string
  /** 乐观锁:与当前最新版本 id 不符则拒绝(可省)。 */
  readonly baseVersionId?: string
  readonly summary?: string
  readonly author?: string
  readonly approvalId?: string
  readonly approved?: boolean
}

/** 端点 loopPrompt/prompt-rollback 的返回。 */
export interface PromptRollbackResult {
  readonly status: WriteStatus
  readonly issues?: readonly string[]
  readonly approval?: WriteApprovalView
  readonly version?: PromptVersionRecord
  readonly effectiveNote: string
}

/** 导出包(计划书 §6 T7.3:JSON 包 schemaVersion/persona/checksum/导出者;T1.6 起可带 entryId)。 */
export interface PromptExportPack {
  readonly schemaVersion: 1
  readonly exportedAt: string
  readonly exportedBy: string
  /** 导出所依据的版本 id。 */
  readonly sourceVersionId: string
  /**
   * 目标条目 id(T1.6):默认条目缺省(与 T7 包形状零差异);其余条目必带。
   * persona 字段承载条目内容(历史字段名,读侧按 entryId 归位)。
   */
  readonly entryId?: string
  readonly persona: string
  /** sha256 hex(UTF-8 口径;导入时强校验)。 */
  readonly checksum: string
}

/** 端点 loopPrompt/prompt-export 的入参。 */
export interface PromptExportInput {
  /** 缺省导出最新版本。 */
  readonly versionId?: string
  /** 目标条目 id(T1.6;缺省=默认条目链;与 versionId 归属不一致即 bad-request)。 */
  readonly entryId?: string
  readonly exportedBy?: string
}

/** 端点 loopPrompt/prompt-export 的返回(只读,不走审批)。 */
export interface PromptExportResult {
  readonly pack: PromptExportPack
  readonly version: PromptVersionRecord
}

/** 端点 loopPrompt/prompt-import 的入参。 */
export interface PromptImportInput {
  /** 导出包(prompt-export 的 pack 原样回传)。 */
  readonly pack: PromptExportPack
  /** 导入时所见最新版本 id(乐观锁;与服务端当前最新不符则拒绝,防并发覆盖)。 */
  readonly baseVersionId?: string
  readonly summary?: string
  readonly author?: string
  readonly approvalId?: string
  readonly approved?: boolean
}

/** 端点 loopPrompt/prompt-import 的返回。 */
export interface PromptImportResult {
  readonly status: WriteStatus
  readonly issues?: readonly string[]
  readonly approval?: WriteApprovalView
  readonly version?: PromptVersionRecord
  readonly effectiveNote: string
}

/** 宿主 profileContext 的最小结构面(dsh CLI profile-boot 提供)。 */
export interface ProfileContextLike {
  readonly name: string
  readonly dir: string
  /** profile patch 层文件路径(persona 写回落点所在文件)。 */
  readonly patchPath: string
  /** DSH home(会话/审计落点的基准目录)。 */
  readonly home: string
}

/**
 * 本包消费的宿主上下文最小结构面(cordis Context 的鸭子类型)。
 *
 * 为什么不直接 import cordis 的 Context 类型:仓库内 @deepseek-ai/cordis 以多份
 * peer 副本并存(lockfile 钉的 include 变体 vs dsh-typert-protocol 依赖的
 * include+loader 变体),两份声明的 symbol 键([symbols.isolate] 等)互不结构兼容
 * (同款分裂在 packages/panel 亦存在)。本包只消费 get/provide/inject/effect 四个面,
 * 以结构面类型 + Service 边界单点断言收口;宿主运行时传入的是同一真实 Context。
 */
export interface StudioContextLike {
  /** 读宿主服务/上下文(profileContext、governance、storage.backend.json)。 */
  get(key: string): unknown
  /** 官方 provide seam(注册本插件提供的服务,返回 disposer;T2.6:promptRegistry 读取面)。 */
  provide(name: string, value: unknown): () => void
  /** 官方 inject seam(等待 storage.backend.json 等生命周期服务)。 */
  inject(deps: readonly string[], callback: (ctx: StudioContextLike) => void): unknown
  /** effect 配逆闭包(插件硬性规范第 5 条)。 */
  effect(fn: () => (() => void) | void): unknown
  /**
   * 官方事件 seam(T2.3:注册 `session/created` 全局未打标监听——会话开启事件,
   * dsh-session Events 契约;监听器绝不同步抛错,否则上游 announce 会否决会话创建)。
   */
  on(name: string, listener: (...args: never[]) => unknown): () => void
}
