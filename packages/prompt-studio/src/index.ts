/**
 * @eterna/prompt-studio Host 半边(T7.1):一个薄插件,把「提示词工坊 + 循环轨迹」
 * 经官方 Typert 网关 SRC 端点暴露(namespace = loopPrompt;浏览器半边 T7.2 经
 * ctx.connection.rpc 调用)。
 *
 * 装载形态:profile bundle 的 cordis.patch.yml 插入行 `- id: eterna-prompt-studio,
 * name: '@eterna/prompt-studio'`(与 @eterna/panel 同款 insert 语义);本包 package.json
 * 声明 dsh.client(platform: web),宿主 client-modules 扫描把 lib/client.js 组进
 * window.__DSH_BOOT__ 浏览器花名册——同一行,两面。
 *
 * 端点(全部 SRC 模式;api/gateway resolveSrcDescriptor 扫描 reflect.props 里带
 * typertRemote 绑定的服务):
 * - loopPrompt/snapshot          无参快照(persona/版本库/在途审批/轨迹概览含最近
 *                                会话清单 trace.recent/通道;T1.4 起附 entries[]=
 *                                注册表全景:每条目元数据+当前值+版本链概览)
 * - loopPrompt/trace             会话列表或指定会话轮次树(T7.4 管线:磁盘日志投影,
 *                                推理摘要/工具/耗时/token/审批事件标记,容错降级)
 * - loopPrompt/prompt-get        当前 persona + 版本库概览;T1.4 起 input.entryId
 *                                非空 → 按注册表条目返回(元数据+当前值+链概览;
 *                                未知 id → status='not-found' 明示,不抛裸异常)
 * - loopPrompt/prompt-save       保存(两段式:R3 审批卡 → 确认执行)。T1.6 起
 *                                input.entryId 非空 → 该条目按条目 patch 定位重述写回
 *                                (块标量三形态/标量/整文件全形态;校验器与 R3 规则
 *                                逐条目生效);缺省=默认条目 persona(T7 形态兼容)
 * - loopPrompt/prompt-versions   版本列表(只增不删);T1.4 起 input.entryId 非空 →
 *                                该条目版本链;缺省=默认条目(persona)链,旧形态兼容
 * - loopPrompt/prompt-rollback   回滚(两段式;产生新版本而非删旧版本)。T1.6 起按
 *                                条目:版本归属条目即写回落点;只读型条目 fail-closed
 * - loopPrompt/prompt-export     导出 JSON 包(只读,不走审批)。T1.6 起任意条目链可
 *                                导出,包带 entryId(默认条目缺省,T7 包形状不变)
 * - loopPrompt/prompt-import     导入 JSON 包(schemaVersion+checksum 强校验 + 与保存
 *                                同一套按条目校验器;两段式;pack.entryId 指名条目)
 * - loopPrompt/session-snapshot  会话快照查询(T2.3):input.sessionId 非空 → 该会话
 *                                开启时刻的 effective prompt 全文(条目版本指针+文本/
 *                                分型标注;无快照 not-found、快照库未挂载 unavailable
 *                                分态明示不抛);缺省 → 最近快照列表(未挂载 ready=false)
 * - loopPrompt/ai-status         AI 可用性自检(T3.1):configEditor 路由解析 + key 的
 *                                env/.env 在场性(零模型调用;绝不回显密钥值)
 * - loopPrompt/ai-polish         AI 润色(T3.1):选中条目底稿 → 建议稿(**永不直接
 *                                生效**;元提示词=注册表 meta 层条目现读,吃自己的狗粮)
 * - loopPrompt/ai-review         AI 审核(T3.1):当前稿 → 问题清单(本地校验器同源
 *                                ruleFindings + 模型五维 aiFindings;仅展示,零写动作)
 *
 * 非端点扩展(T2.4):apply 时注册全局未打标 `system-prompt/assemble` waterfall 监听
 * (registerAssembleReplay),按 T2.3 会话快照逐段替换 patch 值型条目文本——历史会话
 * 严格回放(新会话读最新、旧会话全程沿用快照、快照/身份缺席降级用当前值;实现与
 * 分型跳过语义见 assembly-replay.ts,机制依据 docs/dev/ps-v2-spike.md)。
 *
 * Node 24 type-stripping 不解析标准 decorator 语法,故经 Remote() 公开函数面
 * 手工施加装饰器(等价于 @Remote('snapshot') 糖,对齐 packages/panel/src/index.ts)。
 * SRC 参数绑定按运行时方法形参名(网关 methodParameterNames):参数一律用单个
 * 简单标识符 `input`(禁止默认值/解构,否则 gateway/signature-invalid;可选参数
 * 用 `input?: T` 形态,undefined 在方法体内归一)。
 *
 * 网关调用约束(实测 t7-smoke 得出):SRC 派发经
 * `receiverContext.extend({ invocation }).get(service)` 取调用接收者——cordis 对
 * service 型条目可给出原型链 shadow(原型=原实例),因此本类的状态与方法必须全部
 * 公开(public 字段/方法经原型链可见),私有槽(#field/#method)在 shadow 上读取即抛
 * "Cannot read private member …"(panel 网关零实例状态、只用公开 this.ctx,正是
 * 该约束的既有配方)。未打 Remote 标记的公开方法对网关不可见(remoteMethods 只认
 * 标记),不构成额外端点。
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { StorageBackend } from '@deepseek-ai/dsh-storage'
import { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import {
  AI_CALL_TIMEOUT_MS, AI_META_POLISH_ENTRY_ID, AI_META_REVIEW_ENTRY_ID,
  aiChatCompletion, buildAiEntryUserPayload, checkAiAvailability, createKeyPresenceResolver,
  extractDraftText, parseAiFindings,
} from './ai-service.ts'
import type { AiFetchLike, AiRoute } from './ai-service.ts'
import {
  ASSEMBLE_EVENT, type AssemblyReplayResult, type ReplayAssembledSection, SKIP_COMPLETE_OWNER,
  agentIdOfAssembleContext, pluginSpanOwnsCompleteFlag, resolveAssemblyReplay,
} from './assembly-replay.ts'
import { ApprovalGate } from './approval.ts'
import type { CardFacts, PendingWritePayload } from './approval.ts'
import { WILDCARD_WRITE_RULE_ID, entryWriteRuleId } from './approval.ts'
import { StudioAudit, defaultAuditFilePath } from './audit.ts'
import type { GovernanceAuditLike } from './audit.ts'
import { byteLength, sha256Hex } from './checksum.ts'
import { diffLines } from './diff.ts'
import { EntryPatchFile, EntryToctouError, buildNextEntryFileText, selfCheckEntryWrite } from './entry-patch.ts'
import { applyEntryToRowConfig, readConfigEditorRows, resolveConfigEditor } from './config-editor-write.ts'
import type { ConfigEditorFace } from './config-editor-write.ts'
import { validateExportPack } from './export-pack.ts'
import { PersonaPatchFile } from './persona-patch.ts'
import {
  DEFAULT_ENTRY_ID, ENTRY_KIND_LABELS, LAYER_LABELS, PROMPT_REGISTRY_ENTRIES, WEB_PATCH,
  ensureEntryWritable, getPromptRegistryEntry, readEntryText,
} from './registry.ts'
import type { PromptRegistryEntry, RegistryFileReader } from './registry.ts'
import { COMPOSED_NOTE, EFFECTIVE_NOTE, READONLY_ENTRY_NOTE, RUNTIME_ENTRY_NOTE, SNAPSHOT_VIEW_NOTE, buildSnapshot, cardDiffSummary } from './snapshot.ts'
import {
  SESSION_CREATED_TRIGGER, SessionSnapshotStore, SNAPSHOT_UNIT_DESCRIPTOR, captureSessionSnapshotEntries,
} from './session-snapshot.ts'
import { TRACE_SESSION_LIMIT_DEFAULT, listTraceSessions, readSessionTrace } from './trace.ts'
import type {
  AiKeySource, AiPolishInput, AiPolishResult, AiReviewInput, AiReviewResult, AiStatusResult,
  EntryNotFoundResult, EntrySummaryView, EntryValueView, LoopPromptSnapshot, PromptEntryView,
  PromptExportInput, PromptExportPack, PromptExportResult, PromptGetEntryResult, PromptGetInput,
  PromptGetResult, PromptImportInput, PromptImportResult, PromptRollbackInput, PromptRollbackResult,
  PromptSaveInput, PromptSaveResult, ProfileContextLike, SessionSnapshotInput, SessionSnapshotRecord,
  SessionSnapshotResult, StudioContextLike, TraceInput, TraceReport,
  VersionsInput, VersionsResult, WriteApprovalView, WriteKind, WriteStatus,
} from './types.ts'
import type { PromptVersionRecord, VersionOverview } from './types.ts'
import { validateEntryText } from './validator.ts'
import { PromptVersionStore, VERSION_UNIT_DESCRIPTOR } from './version-store.ts'

/** Typert 服务名(RPC namespace;DSH 端点段文法 `[A-Za-z0-9_$.-]+`)。 */
export const LOOP_PROMPT_SERVICE_ID = 'loopPrompt'

/**
 * 提示词注册表运行时读取面服务名(T2.6 登记制):本插件 apply 时 provide,消费侧
 * (memory/glue 的运行时 section)经 ctx.get 机会读取——本插件缺席时消费侧回落
 * 各自内置文本,不炸宿主。与 @eterna/memory 导出的 PROMPT_REGISTRY_SERVICE_ID
 * 互为真值,交叉钉住在 tests/registry.test.ts(读 tools.ts 源码文本比对)。
 */
export const PROMPT_REGISTRY_SERVICE_ID = 'promptRegistry'

/**
 * 会话开启事件名(T2.3,dsh-session Events 契约 'session/created'):全局未打标
 * 监听收到全部会话(dsh-scope scopeTarget 语义);监听器绝不同步抛错——上游
 * announce 的同步边界里同步抛错会否决会话创建(回滚刚 enter 的会话)。
 */
export const SESSION_CREATED_EVENT = 'session/created'

/** 全部端点字符串(T7.2 客户端照此调用)。 */
export const ENDPOINTS = {
  snapshot: `${LOOP_PROMPT_SERVICE_ID}/snapshot`,
  trace: `${LOOP_PROMPT_SERVICE_ID}/trace`,
  promptGet: `${LOOP_PROMPT_SERVICE_ID}/prompt-get`,
  promptSave: `${LOOP_PROMPT_SERVICE_ID}/prompt-save`,
  promptVersions: `${LOOP_PROMPT_SERVICE_ID}/prompt-versions`,
  promptRollback: `${LOOP_PROMPT_SERVICE_ID}/prompt-rollback`,
  promptExport: `${LOOP_PROMPT_SERVICE_ID}/prompt-export`,
  promptImport: `${LOOP_PROMPT_SERVICE_ID}/prompt-import`,
  sessionSnapshot: `${LOOP_PROMPT_SERVICE_ID}/session-snapshot`,
  aiStatus: `${LOOP_PROMPT_SERVICE_ID}/ai-status`,
  aiPolish: `${LOOP_PROMPT_SERVICE_ID}/ai-polish`,
  aiReview: `${LOOP_PROMPT_SERVICE_ID}/ai-review`,
} as const

/** json backend 在 storage hub 上的生命周期服务键(官方 storageBackendServiceKey)。 */
export const STORAGE_JSON_BACKEND_KEY = storageBackendServiceKey('json')

/** 插件配置(bundle 行 config 可覆写;全部可省)。 */
export interface PromptStudioPluginConfig {
  /** profile patch 层路径(默认 profileContext.patchPath)。 */
  readonly patchPath?: string
  /** 会话日志根(默认 <DSH_HOME>/sessions)。 */
  readonly sessionsRoot?: string
  /** 兜底审计文件(默认 <DSH_HOME>/eterna-prompt-studio/audit.jsonl)。 */
  readonly auditFilePath?: string
  /** 保存写盘后跑 `dsh --dump-config` 干跑自检(默认 true;失败自动还原)。 */
  readonly dryRunVerify?: boolean
  /**
   * 注册表文件解析根(T1.4):registry 条目的 file 字段(除 preset 层 patch 外)
   * 是仓库根相对路径,默认取本包源码位置上三级(生产档=本仓库根);测试可覆写。
   */
  readonly repoRoot?: string
  /**
   * 写授权规则集(T1.6,R3 按条目授权面):条目写回前须命中其一——
   * WILDCARD_WRITE_RULE_ID(eterna.prompt-studio.entry-write,通配全部条目)或
   * 该条目专属规则(eterna.prompt-studio.entry-write.<entryId>;默认 persona 条目
   * =T7 既有 eterna.prompt-studio.persona-write)。缺省=[通配](部署层 admin 门禁
   * 之外的条目粒度收窄面,模拟受限规则集时一段即 rejected)。
   */
  readonly writeRules?: readonly string[]
}

/** 写流程统一产物(三写端点的内部共享面)。 */
interface WriteOutcome {
  readonly status: WriteStatus
  readonly issues?: readonly string[]
  readonly approval?: WriteApprovalView
  readonly version?: PromptVersionRecord
  readonly effectiveNote: string
}

/**
 * configEditor 通道解析产物(T2.1):写链路优先经官方 seam 写回热生效(edit 返回时
 * Loader 重组合已完成);行不可得/服务缺席时调用方降级 entry-patch 直写兜底。
 */
export interface ConfigEditorChannel {
  readonly editor: ConfigEditorFace
  /** 目标顶层行 id(注册表条目 yaml.rowId,如 preset-standard)。 */
  readonly rowId: string
  /** 写前行 config(verify 失败时经同一 seam 还原的基准;configuration() 分离快照)。 */
  readonly beforeRowConfig: Record<string, unknown>
}

/** 通道解析结果:命中官方通道,或给出直写兜底原因(审计 channelNote)。 */
export type ConfigEditorChannelResolution = { readonly channel: ConfigEditorChannel } | { readonly fallback: string }

/** 手工施加 @Remote 装饰器:以公开函数面调用(初始化器在接收者原型上落 marker)。 */
function applyRemoteMarker(prototype: object, method: string, name: string): void {
  const initializers: Array<() => void> = []
  const context = {
    kind: 'method',
    name: method,
    static: false,
    private: false,
    access: { has: () => true, get: (target: object) => Reflect.get(target, method) as unknown },
    addInitializer: (fn: () => void) => { initializers.push(fn) },
  }
  const decorator = Remote(name) as (method: unknown, context: unknown) => void
  decorator(Reflect.get(prototype, method) as unknown, context)
  const receiver = Object.create(prototype) as object
  for (const initialize of initializers) initialize.call(receiver)
}

function badRequest(message: string): RemoteError {
  return new RemoteError('gateway/bad-request', message, { issues: [{ message }] })
}

/** 待捕获队列上限(防快照库长期缺席时无界增长;溢出丢最旧并审计)。 */
const SNAPSHOT_CAPTURE_QUEUE_LIMIT = 100

/** 快照列表模式默认条数(与 trace 最近会话清单同量级)。 */
const SNAPSHOT_LIST_LIMIT_DEFAULT = 20

/** AI 产出纪律说明(ok/failed/rejected 结果共用;计划书 §5「不做 AI 自动生效」)。 */
const AI_NOTE = 'AI 产出仅作建议:润色建议稿与审核问题清单均不直接生效,生效需经 R3 审批写回。'

/** AI 不可用降级说明(含 UI 文案锚点「AI 能力不可用」;非 5xx、不炸宿主)。 */
const AI_UNAVAILABLE_NOTE = 'AI 能力不可用(本结果为降级响应,未发起模型调用);修复后在设置页确认模型路由与凭据环境变量即可恢复。'

/** 防御式提取会话 id(session/created 载荷的 Session.id;缺席 → undefined)。 */
function sessionIdOf(session: unknown): string | undefined {
  if (typeof session !== 'object' || session === null) return undefined
  const id = (session as { readonly id?: unknown }).id
  return typeof id === 'string' && id.trim() !== '' ? id : undefined
}

/** 回放快照查缓上限(会话级;超限逐出最旧,防长寿命进程无界增长)。 */
const REPLAY_SNAPSHOT_CACHE_LIMIT = 256

/** 回放审计去键上限(超限整体清空——代价只是可能重复审计行,无正确性影响)。 */
const REPLAY_AUDIT_KEY_LIMIT = 4096

/**
 * complete 标志缓存 TTL:标志几乎不随组装变化,每步重扫 live patch 无谓;本插件
 * 写链路 committed 即主动失效,外部改写(升级合并)由 TTL 兜底——两向失效代价
 * 均无害(stale true→多跳一次替换,上游本会丢弃;stale false→照常尝试替换)。
 */
const REPLAY_COMPLETE_FLAG_TTL_MS = 30_000

/**
 * 防御式提取组装段列表(上游 PromptPresentation.sections 的结构面子集):
 * 非对象/sections 非数组/段非 {name,text} 字符串 → undefined(bad-shape 降级,
 * 绝不炸组装)。
 */
function replaySectionsOf(assembly: unknown): ReplayAssembledSection[] | undefined {
  if (typeof assembly !== 'object' || assembly === null) return undefined
  const sections = (assembly as { readonly sections?: unknown }).sections
  if (!Array.isArray(sections)) return undefined
  const out: ReplayAssembledSection[] = []
  for (const section of sections) {
    if (typeof section !== 'object' || section === null) return undefined
    const name = (section as { readonly name?: unknown }).name
    const text = (section as { readonly text?: unknown }).text
    if (typeof name !== 'string' || typeof text !== 'string') return undefined
    out.push(section as ReplayAssembledSection)
  }
  return out
}

/** 注册表条目 → 线上元数据视图(快照 entries[] 与 per-entry prompt-get 共用)。 */
function entryViewOf(entry: PromptRegistryEntry): PromptEntryView {
  return {
    id: entry.id,
    layer: entry.layer,
    kind: entry.kind,
    source: entry.source,
    note: entry.note,
    risks: entry.risks,
    redLine: entry.redLine,
    ...(entry.redLineRuleSet !== undefined ? { redLineRuleSet: entry.redLineRuleSet } : {}),
    maxBytes: entry.maxBytes,
    versioned: entry.kind === 'patch-value',
    effect: entry.effect,
  }
}

/** 读端点未知条目 id 的结构化明示(不抛裸异常;测试计划 §3 T1.4 ②)。 */
function entryNotFound(entryId: string): EntryNotFoundResult {
  return {
    status: 'not-found',
    entryId,
    issues: [`未知条目 id:${entryId}(注册表共 ${PROMPT_REGISTRY_ENTRIES.length} 条,可用 id 见 loopPrompt/snapshot 的 entries[])`],
  }
}

/**
 * 版本链概览(纯函数,从预载链内记录派生;snapshot 一次全量读后按条目分组复用,
 * 避免逐条目全表 loadAll)。records 须为单条目链且新→旧(与 store.list 输出同序)。
 */
function overviewOf(records: readonly PromptVersionRecord[], ready: boolean): VersionOverview {
  const latest: PromptVersionRecord | undefined = records[0]
  return {
    ready,
    count: records.length,
    latestId: latest?.id ?? null,
    latestAt: latest?.createdAt ?? null,
  }
}

/** LoopPrompt 网关(SRC 端点宿主;SRC 端点 loopPrompt/*)。状态全公开:见文件头网关调用约束。 */
export class LoopPromptGateway extends TypertRemoteService {
  /** 宿主上下文(T2.1:configEditor 服务经 cordis get 机会解析,公开字段=网关 shadow 约束)。 */
  readonly studioCtx: StudioContextLike
  readonly config: PromptStudioPluginConfig
  readonly audit: StudioAudit
  readonly gate: ApprovalGate
  readonly patch: PersonaPatchFile
  /** 按条目受治理写回器(T1.6:任意 patch 值型条目 → 定位重述写回,单写者+TOCTOU)。 */
  readonly entryWriter: EntryPatchFile
  /** 写授权规则集(T1.6;缺省=通配全部条目)。 */
  readonly writeRules: readonly string[]
  /**
   * configEditor 通道瞬态错误退避间隔毫秒(llm-doctor 实测口径 600;公开字段=
   * 网关 shadow 约束,测试可注入 1ms 加速重试用例)。
   */
  configEditorRetryBackoffMs = 600
  readonly profileContext: ProfileContextLike | undefined
  readonly sessionsRoot: string
  /** 注册表文件解析根(领域/运行时层条目的仓库根;preset 层 patch 映射到 live patch)。 */
  readonly repoRoot: string
  /** 版本库(attachBackend 打开;未挂载 undefined)。 */
  store: PromptVersionStore | undefined
  /** 版本库未就绪的原因(snapshot 降级面/requireStore 明示用)。 */
  storeError: string | undefined
  /**
   * 会话快照库(T2.3;与版本库同 backend 的独立 json 单元,未挂载 undefined)。
   * 公开字段=网关 shadow 约束(见文件头)。
   */
  snapshotStore: SessionSnapshotStore | undefined
  /** 快照库未就绪的原因(session-snapshot 端点降级面明示用)。 */
  snapshotStoreError: string | undefined
  /** 已捕获快照的会话 id 幂等集(内存;重挂后由快照库 getBySessionId 兜底去重)。 */
  readonly snapshottedSessions = new Set<string>()
  /**
   * 待捕获队列(快照库未就绪的会话开启事件保底;有界,溢出丢最旧并审计)。
   * 公开字段=网关 shadow 约束。
   */
  readonly pendingCaptureSessions: string[] = []
  /** 捕获串行链尾(与版本库同款单写者纪律;公开字段=网关 shadow 约束)。 */
  captureChain: Promise<unknown> = Promise.resolve()
  /**
   * 回放快照查缓(T2.4;sessionId → 快照记录/缺席标记 undefined):快照只增
   * 不可变(T2.3 铁律),缓存记录永不过期;缺席值在捕获排空后落缓(见
   * snapshotForReplay)。公开字段=网关 shadow 约束。
   */
  readonly replaySnapshotCache = new Map<string, SessionSnapshotRecord | undefined>()
  /** 回放审计去键((sessionId|段名|结局) → 已审计;防每步组装重复刷审计)。 */
  readonly replayAuditKeys = new Set<string>()
  /**
   * complete 标志 TTL 缓存(entryId → {at,value}):每步组装不重扫 live patch;
   * committed 写后与 detachStore 时清空,外部改写由 TTL 兜底。公开字段=网关
   * shadow 约束。
   */
  readonly replayCompleteFlagCache = new Map<string, { at: number; value: boolean }>()
  /** 进程级一次性备注(no-agent-id / 快照库未挂载;公开字段=网关 shadow 约束)。 */
  replayNotedNoAgentId = false
  replayNotedStoreUnavailable = false
  /** 按条目种子的一次性记忆(ensureEntrySeeds;detach 时重置。公开字段=网关 shadow 约束)。 */
  entrySeedPromise: Promise<void> | undefined
  /**
   * 运行时注入条目的生效文本缓存(T2.6,公开字段=网关 shadow 约束):条目 id →
   * 版本链最新文本。refreshRuntimePromptCache 装载/推进;promptRegistryFace 同步消费。
   */
  readonly runtimePromptCache = new Map<string, string>()
  /**
   * 注册表读取面本体(T2.6):provide 为 promptRegistry 服务,memory/glue 的
   * section 装配时同步读(条目当前生效文本随缓存=版本链最新变化);
   * 无版本/未知条目 → undefined(消费侧回落内置文本)。
   */
  readonly promptRegistryFace = {
    resolveRuntimePromptText: (entryId: string): string | undefined => this.runtimePromptCache.get(entryId),
  }

  // ---------- T3.1 AI 调用面(公开字段=网关 shadow 约束;测试注入同构假体) ----------

  /** AI 真发面:生产全局 fetch;测试注入按协议应答的同构假体(llm-doctor fetchImpl 先例)。 */
  aiFetch: AiFetchLike = globalThis.fetch
  /**
   * key 在场性解析(生产=process.env 优先,次查 DSH_HOME 与工作目录的 .env 文件;
   * 只返回来源枚举,绝无值出口)。缺省根:profileContext.home(缺席回退 cwd)。
   */
  aiKeyPresence: (envName: string) => AiKeySource | undefined = createKeyPresenceResolver(
    () => [this.profileContext?.home ?? '', process.cwd()],
  )
  /** key 值解析(生产=process.env,与 agent 会话同取值面;仅进请求头,绝不入日志/审计)。 */
  aiResolveApiKey: (envName: string) => string | undefined = envName =>
    (envName === '' ? undefined : process.env[envName])
  /** 单次 AI 调用超时毫秒(默认 AI_CALL_TIMEOUT_MS;测试注 1ms 强制超时分支)。 */
  aiTimeoutMs = AI_CALL_TIMEOUT_MS
  /** 润色建议稿输出 token 上限。 */
  aiPolishMaxOutputTokens = 4096
  /** 审核清单输出 token 上限。 */
  aiReviewMaxOutputTokens = 2048

  constructor(ctx: StudioContextLike, config: PromptStudioPluginConfig = {}) {
    // Service 边界单点断言(基类构造器 protected,无法提取其参数类型):运行时传入的
    // 就是宿主真实 Context,本包业务面只消费 StudioContextLike 结构面(types.ts 注)。
    super(ctx as never, LOOP_PROMPT_SERVICE_ID)
    this.studioCtx = ctx
    this.config = config
    this.profileContext = ctx.get('profileContext') as ProfileContextLike | undefined
    const home = this.profileContext?.home ?? process.env.DSH_HOME ?? ''
    this.sessionsRoot = config.sessionsRoot ?? (home !== '' ? join(home, 'sessions') : '')
    this.repoRoot = config.repoRoot ?? join(import.meta.dirname, '..', '..', '..')
    this.audit = new StudioAudit({
      fallbackFilePath: config.auditFilePath ?? (home !== '' ? defaultAuditFilePath(home) : join(process.cwd(), '.eterna', 'prompt-studio.audit.jsonl')),
      resolveGovernance: () => ctx.get('governance') as GovernanceAuditLike | undefined,
    })
    this.gate = new ApprovalGate()
    this.entryWriter = new EntryPatchFile()
    this.writeRules = config.writeRules ?? [WILDCARD_WRITE_RULE_ID]
    const patchPath = config.patchPath ?? this.profileContext?.patchPath
    this.patch = new PersonaPatchFile(patchPath ?? join(process.cwd(), 'cordis.patch.yml'))
  }

  /**
   * 注册表 file → 运行时路径映射(T1.4 读侧):
   * - preset 层 patch(WEB_PATCH)→ 本宿主 live patch 层(this.patch.path;
   *   生产 eterna-web 档 registry file 与 live patch 是同一文件,隔离测试档
   *   (t7-studio)读到的是该宿主实际组合的 patch——prompt-get 按条目值与
   *   dump-config 组合树一致的语义来源);
   * - 其余(领域包/运行时锚点文件)→ 仓库根相对。
   * 读失败由 readEntryText 容错为 problems,不抛。
   */
  registryReadFile(): RegistryFileReader {
    const livePatch = this.patch.path
    const repoRoot = this.repoRoot
    return file => readFileSync(file === WEB_PATCH ? livePatch : join(repoRoot, file), 'utf8')
  }

  // ---------- T1.6 写链路按条目泛化的共享构件 ----------

  /** 条目写回落点文件(preset 层 patch=live patch;领域包/整文件=仓库根相对)。 */
  entryWritePath(entry: PromptRegistryEntry): string {
    const file = entry.yaml?.file ?? entry.anchors[0]?.file
    if (file === undefined) {
      throw badRequest(`条目 ${entry.id} 无写回落点文件(注册表缺 yaml 定位与锚点文件)`)
    }
    return file === WEB_PATCH ? this.patch.path : join(this.repoRoot, file)
  }

  /**
   * 条目落点文件当前全文(TOCTOU 基线与写回共用同一路径解析,杜绝「读 A 写 B」)。
   */
  entryFileText(entry: PromptRegistryEntry): string {
    const file = entry.yaml?.file ?? entry.anchors[0]?.file
    if (file === undefined) {
      throw badRequest(`条目 ${entry.id} 无写回落点文件`)
    }
    return this.registryReadFile()(file)
  }

  /**
   * R3 按条目授权(T1.6):通配规则(eterna.prompt-studio.entry-write)或条目专属
   * 规则命中即可写;默认 persona 条目专属规则=T7 的 persona-write。受限规则集
   * (config.writeRules)未覆盖的条目一段即 rejected(测试计划 §3 T1.6(b)①②)。
   */
  isEntryWriteAuthorized(entry: PromptRegistryEntry): boolean {
    return this.writeRules.includes(WILDCARD_WRITE_RULE_ID)
      || this.writeRules.includes(entryWriteRuleId(entry.id))
  }

  // ---------- T2.1 写穿 configEditor(官方 seam 热生效通道) ----------

  /**
   * 解析条目的 configEditor 通道(T2.1):仅 preset 层(live patch 内的顶层行)可经
   * 官方 seam 写回——edit 会把整行 config 持久化到其 documentPath 并同步重组合;
   * 领域包文件/整文件条目(persona.md)不在 profile patch 内,seam 不可达,天然走直写
   * 兜底。**落点一致性双守卫**(seam documentPath、TOCTOU 基线、字节级还原、审计
   * patchPath 必须指向同一文件):①宿主 profileContext 在场且其 patchPath ≠ 本网关
   * patch 落点(插件 config.patchPath 显式覆盖时)→ 兜底;②seam 暴露的 documentPath
   * ≠ 本网关 patch 落点 → 兜底。任何一步不可得都返回 fallback 原因(不抛、不炸宿主):
   * 服务缺席 / 行不在活跃条目 / configuration() 行不可得(还原基准缺失)/ 落点错位 /
   * 解析异常。
   */
  resolveConfigEditorChannel(entry: PromptRegistryEntry, writePath: string): ConfigEditorChannelResolution {
    const yaml = entry.yaml
    if (yaml === undefined) {
      return { fallback: '条目为整文件条目(persona.md 等),不在 profile patch,configEditor 不可达' }
    }
    if (yaml.file !== WEB_PATCH || writePath !== this.patch.path) {
      return { fallback: '条目写回落点不在本宿主 live patch(领域包/仓库文件条目),configEditor 不可达' }
    }
    const profile = this.profileContext
    if (profile !== undefined && profile.patchPath !== this.patch.path) {
      return { fallback: `插件 config.patchPath 覆盖使本地落点(${this.patch.path})偏离宿主 profile patch(${profile.patchPath}),seam 持久化落点将错位,不走 configEditor 通道` }
    }
    const editor = resolveConfigEditor(this.studioCtx)
    if (editor === undefined) return { fallback: 'configEditor 服务缺席(宿主未装载 dsh-config-editor 或未就绪)' }
    try {
      const documentPath = editor.documentPath
      if (typeof documentPath === 'string' && documentPath !== this.patch.path) {
        return { fallback: `configEditor 持久化落点(documentPath=${documentPath})与本地 patch 落点(${this.patch.path})不一致,不走 configEditor 通道` }
      }
      const liveEntry = this.liveConfigEditorRowEntry(editor, yaml.rowId)
      if (liveEntry === undefined) return { fallback: `行 ${yaml.rowId} 不在 configEditor 活跃条目中(live 组合内无该顶层行)` }
      const row = readConfigEditorRows(editor).find(candidate => candidate.entry.options.id === yaml.rowId)
      if (row === undefined) return { fallback: `行 ${yaml.rowId} 的 configuration() 行不可得(还原基准缺失)` }
      return { channel: { editor, rowId: yaml.rowId, beforeRowConfig: row.override } }
    } catch (error) {
      return { fallback: `configEditor 通道解析失败:${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /** 重取行活引用(edit 每次尝试前重取:Loader 重组合会替换条目对象,链外缓存的引用会失效)。 */
  liveConfigEditorRowEntry(editor: ConfigEditorFace, rowId: string): { options: { id: string } } | undefined {
    try {
      return editor.entries().find(candidate => candidate.options.id === rowId)
    } catch {
      return undefined
    }
  }

  /**
   * 经 configEditor seam 编辑一行(T2.1,llm-doctor 先例 packages/llm-doctor/src/
   * index.ts:186-202 的瞬态错误防御同款+强化):**每次尝试前重取 entries() 活引用**
   * (本通道的 run 闭包在单写者链上排队,轮到执行时前序写的 Loader 重组合可能已替换
   * 条目对象——链外缓存引用必然过期);对瞬态错误(settings 保存事务未关时
   * "HMR transactions cannot be nested"、引用失效 "no longer available")按
   * configEditorRetryBackoffMs 退避重试至多 3 次;非瞬态错误立抛(fail-closed,
   * 由 runGoverned/write 链路处置,不降级直写——防直写与 Loader 内存组合漂移)。
   * change 必须幂等(重试会重放;applyEntryToRowConfig/restore 基准均纯函数)。
   */
  async editViaConfigEditor(
    editor: ConfigEditorFace,
    rowId: string,
    change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void> {
    let lastError: Error | undefined
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const liveEntry = this.liveConfigEditorRowEntry(editor, rowId)
      if (liveEntry === undefined) {
        lastError = new Error(`行 ${rowId} 不在 configEditor 活跃条目中(重组合瞬态或行已裁撤)`)
      } else {
        try {
          await editor.edit(liveEntry, change)
          return
        } catch (error) {
          if (!(error instanceof Error)) throw error
          lastError = error
          const transient = error.message.includes('nested') || error.message.includes('no longer available')
          if (!transient) throw error
        }
      }
      await new Promise(resolve => setTimeout(resolve, this.configEditorRetryBackoffMs))
    }
    throw lastError ?? new Error(`configEditor 编辑失败(行 ${rowId})`)
  }

  /**
   * 写入口统一前置:条目解析(未知 id 明示)+ 型别写守卫(只读型/运行时注入型
   * fail-closed 拒写)。返回 rejected 结果或条目本体。
   */
  resolveWritableEntry(kind: WriteKind, entryId: string, author: string):
    { readonly entry: PromptRegistryEntry } | { readonly rejected: WriteOutcome } {
    const entry = getPromptRegistryEntry(entryId)
    if (entry === undefined) {
      this.audit.write(`prompt-${kind}.rejected`, { kind, operator: author, entryId, reason: 'unknown-entry', stage: 'entry' })
      return {
        rejected: {
          status: 'rejected',
          issues: [`未知条目 id:${entryId}(注册表共 ${PROMPT_REGISTRY_ENTRIES.length} 条,可用 id 见 loopPrompt/snapshot 的 entries[])`],
          effectiveNote: EFFECTIVE_NOTE,
        },
      }
    }
    try {
      ensureEntryWritable(entry)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.audit.write(`prompt-${kind}.rejected`, { kind, operator: author, entryId, reason: 'entry-not-writable', stage: 'guard', issues: [message] })
      return { rejected: { status: 'rejected', issues: [message], effectiveNote: EFFECTIVE_NOTE } }
    }
    return { entry }
  }

  /** storage 栈挂载(apply 的 inject 回调里调用;打开单元并按条目种子初始版本)。 */
  async attachBackend(backend: StorageBackend | undefined): Promise<void> {
    if (backend === undefined) {
      this.storeError = 'storage backend 未挂载(profile 缺 storage/storage-json 行)'
      return
    }
    const facet = backend.kv
    if (facet === undefined) {
      this.storeError = 'storage backend 未提供 kv facet'
      return
    }
    try {
      const unit = await facet.open(VERSION_UNIT_DESCRIPTOR)
      const store = new PromptVersionStore(unit)
      // 默认条目(persona):T7 既有种子路径(patch.read,经 locatePrefixLine 的
      // 既有落点语义),兼容性优先——registry 结构读若与此不一致,以 patch.read 为准。
      // store 在 persona 种子完成后立即就位(旧时序保证:store 就绪 ⇒ persona 链首
      // 已种子),不被其余条目的种子工作拖慢(首屏 snapshot/versions 不等它)。
      const persona = await this.patch.read()
      if (persona.available && persona.text.trim().length > 0) {
        await store.ensureInitial(persona.text)
      }
      this.store = store
      this.storeError = undefined
      // 其余条目种子(T1.4)异步进行;按条目读侧端点先 await ensureEntrySeeds()
      // 拿确定性链视图(见其注)。
      void this.ensureEntrySeeds()
      // 运行时注入条目的生效文本缓存装载(T2.6):memory/glue 的 section 经
      // promptRegistry 服务读;链空条目不入缓存=消费侧回落内置文本(如实呈现)。
      void this.refreshRuntimePromptCache()
    } catch (error) {
      this.storeError = `版本库单元打开失败:${error instanceof Error ? error.message : String(error)}`
    }
    // T2.3 会话快照库:同 backend 的独立 json 单元(打开失败不连坐版本库;
    // 缺席时 session-snapshot 端点 ready=false/unavailable 降级,不炸宿主)。
    try {
      const snapshotUnit = await facet.open(SNAPSHOT_UNIT_DESCRIPTOR)
      this.snapshotStore = new SessionSnapshotStore(snapshotUnit)
      this.snapshotStoreError = undefined
      // 装载前入队的会话开启事件(快照库未就绪窗口)此时补捕。
      void this.drainSessionCaptures().catch(() => undefined)
    } catch (error) {
      this.snapshotStoreError = `快照库单元打开失败:${error instanceof Error ? error.message : String(error)}`
    }
  }

  // ---------- T2.3 会话快照(开启事件 → 快照入 DSH_HOME 存储) ----------

  /**
   * 注册会话开启监听(T2.3):全局未打标 `session/created` 监听(收到全部会话,
   * 含子代理会话);返回 disposer。监听器本体 handleSessionCreated 绝不同步抛错
   * (上游同步边界,见 SESSION_CREATED_EVENT 注)。
   */
  registerSessionCreated(ctx: StudioContextLike): () => void {
    return ctx.on(SESSION_CREATED_EVENT, (session: unknown) => {
      this.handleSessionCreated(session)
    })
  }

  /**
   * 会话开启事件入口(同步边界安全:全部异常就地吞掉并审计,绝不向上抛——
   * 同步抛错会否决上游会话创建)。入队后异步捕获;快照库未就绪时队列保底,
   * attachBackend 完成后补捕。重复事件幂等(内存集 + 快照库 getBySessionId 双守卫)。
   */
  handleSessionCreated(session: unknown): void {
    try {
      const id = sessionIdOf(session)
      if (id === undefined) {
        this.audit.write('session-snapshot.rejected', { reason: 'unknown-session-id', issues: ['session/created 载荷无字符串 id(防御式访问缺席,跳过捕获)'] })
        return
      }
      if (this.snapshottedSessions.has(id) || this.pendingCaptureSessions.includes(id)) return
      if (this.pendingCaptureSessions.length >= SNAPSHOT_CAPTURE_QUEUE_LIMIT) {
        const dropped = this.pendingCaptureSessions.shift()
        this.audit.write('session-snapshot.dropped', { sessionId: dropped, reason: 'queue-overflow' })
      }
      this.pendingCaptureSessions.push(id)
      void this.drainSessionCaptures().catch(() => undefined)
    } catch (error) {
      try {
        this.audit.write('session-snapshot.failed', { reason: 'listener-error', error: error instanceof Error ? error.message : String(error) })
      } catch {
        // 审计本身失败:静默(监听器同步边界不得抛)。
      }
    }
  }

  /**
   * 捕获排空(串行链):每次调用在链尾排队一次排空循环——store 未就绪即返回
   * (队列保底,attach 后再排);逐会话「已存在跳过 / 捕获入库」;失败审计后
   * 放弃该会话(开启事件只发一次,不无限重试),队列继续推进。
   */
  drainSessionCaptures(): Promise<void> {
    const run = this.captureChain.then(() => this.runCaptureDrain())
    this.captureChain = run.catch(() => undefined)
    return run
  }

  /** 排空执行体(公开方法=网关 shadow 约束,见文件头)。 */
  async runCaptureDrain(): Promise<void> {
    for (;;) {
      const store = this.snapshotStore
      if (store === undefined) return
      const sessionId = this.pendingCaptureSessions[0]
      if (sessionId === undefined) return
      try {
        const existing = await store.getBySessionId(sessionId)
        if (existing === undefined) {
          const record = await this.captureAndAppend(store, sessionId)
          this.audit.write('session-snapshot.captured', {
            sessionId,
            snapshotId: record.id,
            entries: record.entries.length,
            checksum: record.checksum,
            trigger: record.trigger,
          })
        }
        this.snapshottedSessions.add(sessionId)
      } catch (error) {
        this.audit.write('session-snapshot.failed', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      this.pendingCaptureSessions.shift()
    }
  }

  /**
   * 捕获一次会话开启时刻的 effective prompt 并入库:种子与运行时缓存先就位
   * (确定性链视图),版本库单次一致读作指针面(见 captureSessionSnapshotEntries
   * 的原子性注);读值容错(单条目失败记 problems,不炸整体)。
   */
  async captureAndAppend(store: SessionSnapshotStore, sessionId: string): Promise<SessionSnapshotRecord> {
    await this.ensureEntrySeeds()
    await this.refreshRuntimePromptCache()
    const versionStore = this.store
    const versionRecords = versionStore === undefined ? [] : await versionStore.list()
    const entries = captureSessionSnapshotEntries({
      entries: PROMPT_REGISTRY_ENTRIES,
      readFile: this.registryReadFile(),
      versionRecords,
      runtimeTexts: new Map(this.runtimePromptCache),
    })
    return store.append({ sessionId, trigger: SESSION_CREATED_TRIGGER, entries })
  }

  // ---------- T2.4 历史会话严格回放(system-prompt/assemble waterfall) ----------

  /**
   * 注册 assemble waterfall 回放监听(T2.4):全局未打标 `system-prompt/assemble`
   * 监听(收到全部会话的组装,dsh-scope scopeTarget 语义——spike §四.4);返回
   * disposer。监听器先完成(异步)替换解析再放行 next()——waterfall 串行组合,
   * 下游监听器与渲染读到的即替换后的 sections。本监听器绝不让回放失败炸组装
   * (handleAssembleReplay 全量吞错并审计)。
   */
  registerAssembleReplay(ctx: StudioContextLike): () => void {
    return ctx.on(ASSEMBLE_EVENT, async (assembly: unknown, context: unknown, next: () => Promise<unknown>) => {
      await this.handleAssembleReplay(assembly, context)
      return next()
    })
  }

  /**
   * 回放监听执行体(公开方法=网关 shadow 约束;**绝不上抛**——上游 assemble
   * 的失败会直接失败模型步骤)。降级矩阵(全部审计留痕):
   * - 快照库未挂载 / 组装上下文无会话身份(context.agent.id 缺席,spike §四.1
   *   未声明字段) / 会话无快照 → 跳过替换,用当前值;
   * - 解析命中 → 逐段替换(结果经 assembly-replay.resolveAssemblyReplay 纯函数,
   *   分型跳过原因一并带出);替换/身份经快照解析的段按 (会话|段|结局) 去键审计。
   */
  async handleAssembleReplay(assembly: unknown, context: unknown): Promise<void> {
    try {
      const sections = replaySectionsOf(assembly)
      if (sections === undefined) {
        this.noteReplayOnce('assembly-replay.bad-shape', { reason: '组装载荷 sections 非法(防御式跳过)' })
        return
      }
      if (this.snapshotStore === undefined) {
        if (!this.replayNotedStoreUnavailable) {
          this.replayNotedStoreUnavailable = true
          this.audit.write('assembly-replay.degraded', { reason: `snapshot-store-unavailable:${this.snapshotStoreError ?? 'storage 栈仍在挂载中'}` })
        }
        return
      }
      const sessionId = agentIdOfAssembleContext(context)
      if (sessionId === undefined) {
        if (!this.replayNotedNoAgentId) {
          this.replayNotedNoAgentId = true
          this.audit.write('assembly-replay.degraded', { reason: 'no-agent-id(组装上下文无会话身份——上游未声明字段缺席,spike §四.1;跳过替换用当前值)' })
        }
        return
      }
      const snapshot = await this.snapshotForReplay(sessionId)
      if (snapshot === undefined) {
        this.auditReplayOnce(`${sessionId}|degraded`, 'assembly-replay.degraded', { sessionId, reason: 'snapshot-absent(会话无快照:插件装载前创建或捕获失败;降级用当前值)' })
        return
      }
      // 读面 memoize:本次组装内同一文件只读一次(live 值 + complete 检测共享);
      // complete 标志另走 TTL 缓存(replayCompleteFlags),几乎不变的它不逐段重扫。
      const fileCache = new Map<string, string>()
      const readFile: RegistryFileReader = (file) => {
        const cached = fileCache.get(file)
        if (cached !== undefined) return cached
        const text = this.registryReadFile()(file)
        fileCache.set(file, text)
        return text
      }
      const result = resolveAssemblyReplay({
        sections,
        context,
        snapshot,
        readFile,
        completeFlags: this.replayCompleteFlags(),
      })
      this.auditReplayResult(sessionId, snapshot.id, result)
    } catch (error) {
      this.noteReplayOnce(`assembly-replay.failed:${error instanceof Error ? error.message : String(error)}`,
        { error: error instanceof Error ? error.message : String(error) }, 'assembly-replay.failed')
    }
  }

  /**
   * 回放快照查询(带缓存 + 在途捕获等待):缓存命中零 I/O;未命中查快照库,
   * 该会话捕获仍在队列(创建→首轮组装竞态)则等捕获排空再查一次;结果(含
   * 缺席标记)落缓存。公开方法=网关 shadow 约束。
   */
  async snapshotForReplay(sessionId: string): Promise<SessionSnapshotRecord | undefined> {
    if (this.replaySnapshotCache.has(sessionId)) return this.replaySnapshotCache.get(sessionId)
    const store = this.snapshotStore
    if (store === undefined) return undefined
    let record = await store.getBySessionId(sessionId)
    if (record === undefined && this.pendingCaptureSessions.includes(sessionId)) {
      await this.drainSessionCaptures()
      record = await store.getBySessionId(sessionId)
    }
    if (this.replaySnapshotCache.size >= REPLAY_SNAPSHOT_CACHE_LIMIT) {
      const oldest = this.replaySnapshotCache.keys().next().value
      if (oldest !== undefined) this.replaySnapshotCache.delete(oldest)
    }
    this.replaySnapshotCache.set(sessionId, record)
    return record
  }

  /**
   * 注册表条目的 complete 标志面(TTL 缓存;公开方法=网关 shadow 约束):
   * 命中直接给值;过期/缺席时扫描落缓。committed 写后与 detachStore 清空,
   * 外部改写(patch 升级合并)由 TTL 兜底——两向失效代价均无害(见常量注)。
   */
  replayCompleteFlags(): Map<string, boolean> {
    const now = Date.now()
    const flags = new Map<string, boolean>()
    for (const entry of PROMPT_REGISTRY_ENTRIES) {
      const cached = this.replayCompleteFlagCache.get(entry.id)
      if (cached !== undefined && now - cached.at < REPLAY_COMPLETE_FLAG_TTL_MS) {
        flags.set(entry.id, cached.value)
        continue
      }
      const value = pluginSpanOwnsCompleteFlag(entry, this.registryReadFile())
      this.replayCompleteFlagCache.set(entry.id, { at: now, value })
      flags.set(entry.id, value)
    }
    return flags
  }

  /** 回放解析结果审计(replaced 全量细节;governed/degraded/complete-owner 按 (会话|段) 去键防刷屏)。 */
  auditReplayResult(sessionId: string, snapshotId: string, result: AssemblyReplayResult): void {
    const replaced = result.sections.filter(section => section.outcome === 'replaced')
    const governed = result.sections.filter(section => section.outcome === 'governed')
    // complete-owner 是部署配置信号(该段严格回放对 complete 部署失效,spike §四.2)
    // 且罕见:即使本次无替换也按 (会话|段) 一次审计留痕,不埋在 applied 细节里。
    for (const section of result.sections) {
      if (section.outcome === 'skipped' && section.reason === SKIP_COMPLETE_OWNER) {
        this.auditReplayOnce(`${sessionId}|${section.sectionName}|complete-owner`, 'assembly-replay.skipped', {
          sessionId,
          snapshotId,
          sectionName: section.sectionName,
          reason: SKIP_COMPLETE_OWNER,
        })
      }
    }
    if (replaced.length > 0) {
      const freshKeys = replaced.map(section => `${sessionId}|${section.sectionName}|replaced`)
      if (freshKeys.some(key => !this.replayAuditKeys.has(key))) {
        this.writeReplayAuditKeys(freshKeys)
        this.audit.write('assembly-replay.applied', {
          sessionId,
          snapshotId,
          replaced: replaced.map(section => ({ sectionName: section.sectionName, entryId: section.entryId })),
          governed: governed.map(section => ({ sectionName: section.sectionName, entryId: section.entryId })),
          skippedSections: result.sections.filter(section => section.outcome === 'skipped')
            .map(section => ({ sectionName: section.sectionName, entryId: section.entryId, reason: section.reason })),
          skippedEntries: result.skippedEntries,
        })
      }
      return
    }
    if (governed.length > 0) {
      const freshKeys = governed.map(section => `${sessionId}|${section.sectionName}|governed`)
      if (freshKeys.some(key => !this.replayAuditKeys.has(key))) {
        this.writeReplayAuditKeys(freshKeys)
        this.audit.write('assembly-replay.governed', {
          sessionId,
          snapshotId,
          governed: governed.map(section => ({ sectionName: section.sectionName, entryId: section.entryId })),
          // T2.2 补:未映射条目的按型跳过记录随 governed 事件一并落审计(此前只在
          // applied 事件携带——scoped 持旧实例的会话走 governed 路径时,运行时注入/
          // 只读型条目「跳过并记录原因」(T2.4 承诺)在审计面缺席)。字段只增不改。
          skippedEntries: result.skippedEntries,
        })
      }
    }
  }

  /** 回放审计去键写入(容量守卫:超限整体清空——代价只是可能重复审计行)。 */
  writeReplayAuditKeys(keys: readonly string[]): void {
    if (this.replayAuditKeys.size + keys.length > REPLAY_AUDIT_KEY_LIMIT) this.replayAuditKeys.clear()
    for (const key of keys) this.replayAuditKeys.add(key)
  }

  /** 去键审计包装。 */
  auditReplayOnce(key: string, action: string, detail: Record<string, unknown>): void {
    if (this.replayAuditKeys.has(key)) return
    this.writeReplayAuditKeys([key])
    this.audit.write(action, detail)
  }

  /** 进程级一次性审计(bad-shape/failed 按消息去重)。 */
  noteReplayOnce(message: string, detail: Record<string, unknown>, action = 'assembly-replay.skipped'): void {
    try {
      this.auditReplayOnce(message, action, detail)
    } catch {
      // 审计本身失败:静默(监听器不得让审计故障炸组装)。
    }
  }

  /**
   * 会话快照查询(端点 loopPrompt/session-snapshot;T2.3 读取 API):
   * - input.sessionId 非空 → 该会话快照全文(条目版本指针+文本/标注);sessionId
   *   兼容 `session-<id>` 目录名形态(trace 先例);无快照 → status='not-found'
   *   明示,不抛裸异常;快照库未挂载 → status='unavailable' 分态明示(不 5xx);
   * - 缺省 → 列表模式(最近快照,新→旧;未挂载 → ready=false 降级)。
   */
  async sessionSnapshot(input?: SessionSnapshotInput): Promise<SessionSnapshotResult> {
    const sessionId = input?.sessionId
    if (sessionId !== undefined && sessionId !== '') {
      const store = this.snapshotStore
      if (store === undefined) {
        return {
          status: 'unavailable',
          sessionId,
          issues: [`会话快照存储未挂载:${this.snapshotStoreError ?? 'storage 栈仍在挂载中,请稍后重试'}`],
        }
      }
      const record = await store.getBySessionId(sessionId)
        ?? (sessionId.startsWith('session-') ? undefined : await store.getBySessionId(`session-${sessionId}`))
      if (record === undefined) {
        return {
          status: 'not-found',
          sessionId,
          issues: [`会话 ${sessionId} 无快照(快照在会话开启事件时捕获;该会话可能在插件装载前创建,或捕获失败——见审计 session-snapshot.*)`],
        }
      }
      return { status: 'ok', snapshot: record, note: SNAPSHOT_VIEW_NOTE }
    }
    const store = this.snapshotStore
    if (store === undefined) {
      return { status: 'ok', ready: false, total: 0, snapshots: [] }
    }
    const limit = input?.limit ?? SNAPSHOT_LIST_LIMIT_DEFAULT
    const all = await store.list()
    return {
      status: 'ok',
      ready: true,
      total: all.length,
      snapshots: all.slice(0, limit).map(record => ({
        id: record.id,
        sessionId: record.sessionId,
        createdAt: record.createdAt,
        entries: record.entries.length,
        checksum: record.checksum,
      })),
    }
  }

  // ---------- T3.1 AI 端点(润色/审核走进程内调用,llm-doctor 同 wire 先例) ----------

  /**
   * 元提示词现读(吃狗粮):注册表 meta 层条目当前值作 system 消息。读不到 → issues
   * 明示拒绝(不静默换内置兜底文本——元提示词失效必须可见,注册表自管的诚实面)。
   */
  readMetaPromptText(entryId: string): { text: string | undefined; issues: readonly string[] } {
    const entry = getPromptRegistryEntry(entryId)
    if (entry === undefined) {
      return { text: undefined, issues: [`元提示词条目未登记:${entryId}(注册表自管失效,检查 registry meta 层)`] }
    }
    const read = readEntryText(entry, this.registryReadFile())
    if (read.text === undefined || read.text.trim() === '') {
      return { text: undefined, issues: [`元提示词条目 ${entryId} 当前值不可读:${read.problems.length > 0 ? read.problems.join(';') : '反引值为空'}`] }
    }
    return { text: read.text, issues: [] }
  }

  /** live patch 文本(路由解析的兜底面;读失败 → undefined,configEditor 面单独判定)。 */
  readLivePatchText(): string | undefined {
    try {
      return this.registryReadFile()(WEB_PATCH)
    } catch {
      return undefined
    }
  }

  /** AI 可用性自检的统一解析(三端点共用;零模型调用)。 */
  aiAvailability(): ReturnType<typeof checkAiAvailability> {
    return checkAiAvailability(resolveConfigEditor(this.studioCtx), this.readLivePatchText(), this.aiKeyPresence)
  }

  /**
   * SRC 端点:loopPrompt/ai-status——AI 可用性自检(T3.1):configEditor 路由解析 +
   * key 的 env/.env 在场性(绝不回显密钥值);零模型调用,不写任何状态。
   */
  aiStatus(): AiStatusResult {
    const availability = this.aiAvailability()
    return {
      status: availability.available ? 'ok' : 'unavailable',
      available: availability.available,
      ...(availability.route !== undefined && {
        route: { provider: availability.route.provider, model: availability.route.model, api: availability.route.api },
      }),
      ...(availability.keySource !== undefined && { keySource: availability.keySource }),
      ...(availability.reason !== undefined && { reason: availability.reason }),
      note: availability.available ? AI_NOTE : AI_UNAVAILABLE_NOTE,
    }
  }

  /**
   * SRC 端点:loopPrompt/ai-polish——AI 润色(T3.1):选中条目底稿(input.content 缺省
   * =条目当前值)→ 建议稿。**永不直接生效**(不写版本库/不写 patch/不产生在途审批);
   * 元提示词=注册表条目 meta.studio.ai-polish 现读。降级矩阵(全部非 5xx):
   * 未知条目 not-found / 无底稿 rejected / 元提示词不可读 rejected / 路由或 key 缺席
   * unavailable / 调用失败或输出为空 failed——后三类逐事件审计(reason 永不含密钥值)。
   */
  async aiPolish(input?: AiPolishInput): Promise<AiPolishResult> {
    const entryId = input?.entryId !== undefined && input.entryId !== '' ? input.entryId : DEFAULT_ENTRY_ID
    const entry = getPromptRegistryEntry(entryId)
    if (entry === undefined) {
      return {
        status: 'not-found', entryId, note: AI_NOTE,
        issues: [`未知条目 id:${entryId}(注册表共 ${PROMPT_REGISTRY_ENTRIES.length} 条,可用 id 见 loopPrompt/snapshot 的 entries[])`],
      }
    }
    const base = input?.content !== undefined && input.content !== '' ? input.content : this.buildEntryValueView(entry).text
    if (base === null || base.trim() === '') {
      return {
        status: 'rejected', entryId, note: AI_NOTE,
        issues: [`条目 ${entryId} 无可润色底稿(只读型/运行时注入型无静态值,或当前值不可读);可用 input.content 显式传入草稿`],
      }
    }
    const metaPrompt = this.readMetaPromptText(AI_META_POLISH_ENTRY_ID)
    if (metaPrompt.text === undefined) {
      this.audit.write('ai-polish.rejected', { entryId, reason: 'meta-prompt-unreadable', issues: metaPrompt.issues })
      return { status: 'rejected', entryId, issues: metaPrompt.issues, note: AI_NOTE }
    }
    const call = await this.runAiCall('ai-polish', entryId, metaPrompt.text, () => buildAiEntryUserPayload(
      {
        id: entry.id,
        layer: LAYER_LABELS[entry.layer],
        kind: ENTRY_KIND_LABELS[entry.kind],
        source: entry.source,
        maxBytes: entry.maxBytes,
        redLine: entry.redLine,
        ...(entry.redLineRuleSet !== undefined && { redLineRuleSet: entry.redLineRuleSet }),
      },
      base,
      { instruction: input?.instruction, textBytes: byteLength(base) },
    ))
    if (call.status !== 'ok') {
      return { status: call.status, entryId, issues: call.issues, note: call.status === 'unavailable' ? AI_UNAVAILABLE_NOTE : AI_NOTE }
    }
    const draft = extractDraftText(call.text)
    if (draft.text === '') {
      const reason = '模型输出为空,无建议稿'
      this.audit.write('ai-polish.failed', { entryId, reason })
      return { status: 'failed', entryId, issues: [reason], note: AI_NOTE }
    }
    this.audit.write('ai-polish.completed', {
      entryId,
      provider: call.route.provider,
      model: call.route.model,
      latencyMs: call.latencyMs,
      baseBytes: byteLength(base),
      draftBytes: byteLength(draft.text),
      framed: draft.framed,
    })
    return {
      status: 'ok',
      entryId,
      draft: draft.text,
      baseBytes: byteLength(base),
      draftBytes: byteLength(draft.text),
      meta: {
        provider: call.route.provider,
        model: call.route.model,
        latencyMs: call.latencyMs,
        metaPromptEntryId: AI_META_POLISH_ENTRY_ID,
        framed: draft.framed,
      },
      note: AI_NOTE,
    }
  }

  /**
   * SRC 端点:loopPrompt/ai-review——AI 审核(T3.1):当前稿(input.content 缺省=条目
   * 当前值)→ 问题清单。ruleFindings 与 T1.6 校验器**同一模块导出**(validateEntryText,
   * 红线冲突/长度/UTF-8 同源;T3.3 同源断言的落点);aiFindings=模型按元提示词五维
   * (红线冲突/长度预算/变量引用/一致性/清晰度)产出的清单。仅展示,零写动作。
   */
  async aiReview(input?: AiReviewInput): Promise<AiReviewResult> {
    const entryId = input?.entryId !== undefined && input.entryId !== '' ? input.entryId : DEFAULT_ENTRY_ID
    const entry = getPromptRegistryEntry(entryId)
    if (entry === undefined) {
      return {
        status: 'not-found', entryId, ruleFindings: [], aiFindings: [], note: AI_NOTE,
        issues: [`未知条目 id:${entryId}(注册表共 ${PROMPT_REGISTRY_ENTRIES.length} 条,可用 id 见 loopPrompt/snapshot 的 entries[])`],
      }
    }
    const content = input?.content !== undefined && input.content !== '' ? input.content : this.buildEntryValueView(entry).text
    if (content === null || content.trim() === '') {
      return {
        status: 'rejected', entryId, ruleFindings: [], aiFindings: [], note: AI_NOTE,
        issues: [`条目 ${entryId} 无可审核文本(只读型/运行时注入型无静态值,或当前值不可读);可用 input.content 显式传入草稿`],
      }
    }
    // 本地确定性校验(T1.6 同一模块导出;非 persona 条目红线豁免语义沿用)。
    const ruleFindings = validateEntryText(entry, content).issues
    const metaPrompt = this.readMetaPromptText(AI_META_REVIEW_ENTRY_ID)
    if (metaPrompt.text === undefined) {
      this.audit.write('ai-review.rejected', { entryId, reason: 'meta-prompt-unreadable', issues: metaPrompt.issues })
      return { status: 'rejected', entryId, ruleFindings, aiFindings: [], issues: metaPrompt.issues, note: AI_NOTE }
    }
    const call = await this.runAiCall('ai-review', entryId, metaPrompt.text, () => buildAiEntryUserPayload(
      {
        id: entry.id,
        layer: LAYER_LABELS[entry.layer],
        kind: ENTRY_KIND_LABELS[entry.kind],
        source: entry.source,
        maxBytes: entry.maxBytes,
        redLine: entry.redLine,
        ...(entry.redLineRuleSet !== undefined && { redLineRuleSet: entry.redLineRuleSet }),
      },
      content,
      { textBytes: byteLength(content) },
    ))
    if (call.status !== 'ok') {
      return {
        status: call.status, entryId, ruleFindings, aiFindings: [], issues: call.issues,
        note: call.status === 'unavailable' ? AI_UNAVAILABLE_NOTE : AI_NOTE,
      }
    }
    const parsed = parseAiFindings(call.text)
    const reviewMeta = {
      provider: call.route.provider,
      model: call.route.model,
      latencyMs: call.latencyMs,
      metaPromptEntryId: AI_META_REVIEW_ENTRY_ID,
      framed: parsed?.framed ?? false,
    }
    if (parsed === undefined) {
      const reason = `模型输出未按元提示词 JSON 契约解析(原始输出前 200 字:${call.text.slice(0, 200)})`
      this.audit.write('ai-review.degraded', { entryId, provider: call.route.provider, model: call.route.model, latencyMs: call.latencyMs, reason })
      return {
        status: 'ok',
        entryId,
        ruleFindings,
        aiFindings: [],
        issues: [reason],
        meta: reviewMeta,
        note: AI_NOTE,
      }
    }
    this.audit.write('ai-review.completed', {
      entryId,
      provider: call.route.provider,
      model: call.route.model,
      latencyMs: call.latencyMs,
      ruleFindings: ruleFindings.length,
      aiFindings: parsed.findings.length,
      framed: parsed.framed,
    })
    return {
      status: 'ok',
      entryId,
      ruleFindings,
      aiFindings: parsed.findings,
      meta: reviewMeta,
      note: AI_NOTE,
    }
  }

  /**
   * AI 调用共用执行体(润色/审核共享;公开方法=网关 shadow 约束):
   * 可用性自检 → key 值解析(仅进请求头)→ 同 wire 真发 → 失败/不可用逐事件审计。
   * **零写动作**:本方法不触碰版本库/patch/审批门,任何结局都不留半写状态。
   */
  async runAiCall(
    kind: 'ai-polish' | 'ai-review',
    entryId: string,
    system: string,
    buildUser: () => string,
  ): Promise<
    | { readonly status: 'ok'; readonly text: string; readonly route: AiRoute; readonly latencyMs: number }
    | { readonly status: 'unavailable' | 'failed'; readonly issues: readonly string[] }
  > {
    const availability = this.aiAvailability()
    if (!availability.available || availability.route === undefined) {
      const reason = availability.reason ?? 'AI 能力不可用(路由不可解析)'
      this.audit.write(`${kind}.unavailable`, { entryId, reason })
      return { status: 'unavailable', issues: [reason] }
    }
    const route = availability.route
    const apiKey = route.apiKeyEnv === '' ? undefined : this.aiResolveApiKey(route.apiKeyEnv)
    if (route.apiKeyEnv !== '' && (apiKey === undefined || apiKey === '')) {
      // 在场性判定经 .env 文件但进程环境未导出:agent 会话与 AI 调用同取 process.env,
      // 同样取不到——如实降级并给出修复方向,不猜值、不读 .env 值(ai-service 头注纪律)。
      const reason = `API key 在 .env 文件在场但未导出到宿主进程环境(${route.apiKeyEnv});模型调用与 agent 会话同取 process.env,请在启动环境 export 后重试`
      this.audit.write(`${kind}.unavailable`, { entryId, reason: 'dotenv-not-exported' })
      return { status: 'unavailable', issues: [reason] }
    }
    const result = await aiChatCompletion({
      api: route.api,
      baseURL: route.baseURL,
      model: route.model,
      apiKey,
      system,
      user: buildUser(),
      maxOutputTokens: kind === 'ai-polish' ? this.aiPolishMaxOutputTokens : this.aiReviewMaxOutputTokens,
      fetchImpl: this.aiFetch,
      timeoutMs: this.aiTimeoutMs,
    })
    if (!result.ok) {
      this.audit.write(`${kind}.failed`, {
        entryId, provider: route.provider, model: route.model, latencyMs: result.latencyMs, reason: result.error,
      })
      return { status: 'failed', issues: [result.error ?? 'AI 调用失败'] }
    }
    return { status: 'ok', text: result.text, route, latencyMs: result.latencyMs }
  }

  /**
   * 其余 patch 值型条目的链首种子(T1.4,幂等一次):当前值经注册表运行时读取面
   * 反引,非空即种子各自链首(ensureInitial 语义:链空才种;读不到/空值不种,
   * 不造假基线);只读型/运行时注入型无静态值,不种(版本链 count=0 即其无版本链
   * 的如实呈现)。attach 后台启动;按条目读侧(prompt-get/prompt-versions/snapshot
   * entries[])先 await 本方法,保证链视图确定性(种子写入与读取同上版本库串行链,
   * 先排队者先可见)。单条种子失败只影响该条目链留空(容错,不炸宿主),整体失败
   * 不重试也不阻塞读侧(promise 按「已尝试」记忆;store 重开时重置)。
   */
  ensureEntrySeeds(): Promise<void> {
    // store 未挂载时不记忆(否则会把「无种可种」的空完成记忆下来,attach 后永不再种);
    // 读侧此时本就以 ready=false 降级,不依赖种子。
    if (this.store === undefined) return Promise.resolve()
    this.entrySeedPromise ??= this.seedEntryChains().catch(() => undefined)
    return this.entrySeedPromise
  }

  /** 种子执行体(ensureEntrySeeds 的记忆化主体;公开方法=网关 shadow 约束,见文件头)。 */
  async seedEntryChains(): Promise<void> {
    const store = this.store
    if (store === undefined) return
    const readFile = this.registryReadFile()
    for (const entry of PROMPT_REGISTRY_ENTRIES) {
      if (entry.id === DEFAULT_ENTRY_ID || entry.kind !== 'patch-value') continue
      try {
        const read = readEntryText(entry, readFile)
        if (read.text !== undefined && read.text.trim().length > 0) {
          await store.ensureInitial(read.text, 'system', entry.id)
        }
      } catch {
        // 单条目种子失败:该条目链留空(count=0 如实呈现),不阻断其余条目。
      }
    }
  }

  /**
   * 刷新运行时注入条目的生效文本缓存(T2.6):注册表全部 runtime-injection 条目
   * 取版本链最新文本入缓存(链空 → 清除该条目,消费侧回落内置文本)。
   * attachBackend 后装载;任何 committed 写后重刷;detachStore 清空。
   * 读失败静默保持旧缓存——读取面被 section 装配同步消费,刷新永不抛。
   */
  async refreshRuntimePromptCache(): Promise<void> {
    const store = this.store
    if (store === undefined) {
      this.runtimePromptCache.clear()
      return
    }
    try {
      for (const entry of PROMPT_REGISTRY_ENTRIES) {
        if (entry.kind !== 'runtime-injection') continue
        const latest = (await store.list(1, entry.id))[0]
        if (latest === undefined) this.runtimePromptCache.delete(entry.id)
        else this.runtimePromptCache.set(entry.id, latest.content)
      }
    } catch {
      // 版本库读取失败:保持旧缓存(读取面同步消费,不因刷新失败炸装配)。
    }
  }

  /** 释放版本库与快照库单元(幂等;apply 逆闭包调用;在途写先排空)。 */
  async detachStore(): Promise<void> {
    const store = this.store
    this.store = undefined
    this.entrySeedPromise = undefined
    this.runtimePromptCache.clear()
    // T2.3 快照库一并释放;捕获队列与幂等集清空(重挂后由快照库 getBySessionId 兜底去重)。
    const snapshotStore = this.snapshotStore
    this.snapshotStore = undefined
    this.snapshottedSessions.clear()
    this.pendingCaptureSessions.length = 0
    // T2.4 回放缓存/去键/complete 标志缓存一并清空(快照库重开前不持旧引用)。
    this.replaySnapshotCache.clear()
    this.replayAuditKeys.clear()
    this.replayCompleteFlagCache.clear()
    await Promise.all([store?.close() ?? Promise.resolve(), snapshotStore?.close() ?? Promise.resolve()])
  }

  /** 卸载收尾(取消在途审批 + 关版本库)。 */
  async dispose(): Promise<void> {
    this.gate.cancel()
    await this.detachStore()
  }

  // ---------- 端点 ----------

  /** 面板快照(端点 loopPrompt/snapshot;纯 JSON,无参数)。 */
  async snapshot(): Promise<LoopPromptSnapshot> {
    const persona = await this.patch.read()
    const pending = this.gate.peek()
    // 最近会话清单一次投影:sessions 数 = 清单长度,清单整体随 trace.recent 下发(T7.4)。
    const traceRecent = listTraceSessions(this.sessionsRoot, TRACE_SESSION_LIMIT_DEFAULT)
    // 版本库一次全量读(评审 2026-11-11:顶层概览 + 14 条目链概览共用同一份记录,
    // 避免每次快照 ~15 次全表 loadAll——版本库只增不删,长期使用后全扫代价线性涨)。
    await this.ensureEntrySeeds()
    const store = this.store
    const allRecords = store === undefined ? [] : await store.list()
    const overview = overviewOf(allRecords.filter(record => record.entryId === DEFAULT_ENTRY_ID), store !== undefined)
    const summaries: EntrySummaryView[] = []
    for (const entry of PROMPT_REGISTRY_ENTRIES) {
      summaries.push({
        ...entryViewOf(entry),
        value: this.buildEntryValueView(entry),
        versions: overviewOf(allRecords.filter(record => record.entryId === entry.id), store !== undefined),
      })
    }
    return buildSnapshot({
      persona,
      versions: overview,
      pendingApproval: pending === null
        ? null
        : { approvalId: pending.approvalId, kind: pending.kind, createdAt: new Date(pending.createdAt).toISOString() },
      traceRecent,
      tracePipeline: 'v0-disk-log',
      entries: summaries,
    })
  }

  /** 循环轨迹(端点 loopPrompt/trace):无 sessionId → 最近会话列表;有 → 轮次树。投影=T7.4 管线(trace.ts)。 */
  trace(input: TraceInput): Promise<TraceReport> {
    const sessionId = input.sessionId
    if (sessionId !== undefined && sessionId !== '') {
      const selected = readSessionTrace(this.sessionsRoot, sessionId)
      return Promise.resolve({
        generatedAt: new Date().toISOString(),
        sessionsRoot: this.sessionsRoot,
        pipeline: 'v0-disk-log',
        sessions: [],
        selected,
      })
    }
    return Promise.resolve({
      generatedAt: new Date().toISOString(),
      sessionsRoot: this.sessionsRoot,
      pipeline: 'v0-disk-log',
      sessions: listTraceSessions(this.sessionsRoot, input.limit ?? TRACE_SESSION_LIMIT_DEFAULT),
      selected: null,
    })
  }

  /**
   * 当前值(端点 loopPrompt/prompt-get)。重载只影响线类型(运行时签名=实现签名,
   * SRC 形参名 `input` 不变):
   * - input.entryId 非空 → 按注册表条目返回(元数据+当前值+该条目链概览;
   *   未知 id → status='not-found' 明示,不抛裸异常);
   * - 缺省/空 → 旧形态(persona+版本库概览,字段与 T7 一致——旧客户端/旧断言零改动)。
   */
  promptGet(input: { readonly entryId: string }): Promise<PromptGetEntryResult | EntryNotFoundResult>
  promptGet(input?: PromptGetInput): Promise<PromptGetResult>
  async promptGet(input?: PromptGetInput): Promise<PromptGetResult | PromptGetEntryResult | EntryNotFoundResult> {
    const entryId = input?.entryId
    if (entryId !== undefined && entryId !== '') {
      const entry = getPromptRegistryEntry(entryId)
      if (entry === undefined) return entryNotFound(entryId)
      await this.ensureEntrySeeds()
      return {
        entry: entryViewOf(entry),
        value: this.buildEntryValueView(entry),
        versions: await this.versionOverview(entry.id),
        // 分型生效说明:只读型/运行时注入型无「保存生效」语义,给只读文案防误导(T1.5 前端透传)。
        effectiveNote: entry.kind === 'line-anchor-readonly'
          ? READONLY_ENTRY_NOTE
          : entry.kind === 'runtime-injection' ? RUNTIME_ENTRY_NOTE : EFFECTIVE_NOTE,
      }
    }
    const persona = await this.patch.read()
    return {
      persona,
      versions: await this.versionOverview(),
      effectiveNote: EFFECTIVE_NOTE,
      composedNote: COMPOSED_NOTE,
    }
  }

  /**
   * 保存(端点 loopPrompt/prompt-save;两段式 R3 审批)。T1.6 起按条目:
   * input.entryId 非空 → 该条目的 patch 定位重述写回(块标量三形态全覆盖);
   * 缺省/空 → 默认条目 persona(T7 调用形态零改动)。
   */
  async promptSave(input: PromptSaveInput): Promise<PromptSaveResult> {
    return this.handleWrite('save', {
      entryId: input.entryId,
      content: input.content,
      baseVersionId: input.baseVersionId,
      summary: input.summary,
      author: input.author,
      approvalId: input.approvalId,
      approved: input.approved,
      versionId: undefined,
    })
  }

  /**
   * 版本列表(端点 loopPrompt/prompt-versions;只增不删)。重载只影响线类型:
   * - input.entryId 非空 → 该条目版本链(未知 id → status='not-found');
   * - 缺省/空 → 默认条目(persona)链——T7 单链时代调用形态(total/seq 语义不变,
   *   旧断言零改动)。
   */
  promptVersions(input: VersionsInput & { readonly entryId: string }): Promise<VersionsResult | EntryNotFoundResult>
  promptVersions(input?: VersionsInput): Promise<VersionsResult>
  async promptVersions(input?: VersionsInput): Promise<VersionsResult | EntryNotFoundResult> {
    const entryId = input?.entryId
    const limit = input?.limit ?? 50
    if (entryId !== undefined && entryId !== '') {
      if (getPromptRegistryEntry(entryId) === undefined) return entryNotFound(entryId)
      await this.ensureEntrySeeds()
      const store = this.requireStore()
      // 一次取全链再截断(评审 2026-11-11:原先 records+total 两次全表 loadAll)。
      const chain = await store.list(Number.POSITIVE_INFINITY, entryId)
      return { total: chain.length, ready: true, entryId, versions: chain.slice(0, limit) }
    }
    const store = this.requireStore()
    const chain = await store.list(Number.POSITIVE_INFINITY, DEFAULT_ENTRY_ID)
    return { total: chain.length, ready: true, versions: chain.slice(0, limit) }
  }

  /**
   * 回滚(端点 loopPrompt/prompt-rollback;两段式;产生新版本)。T1.6 起按条目:
   * 版本归属条目即写回落点(领域/plan-mode/块标量条目回滚到各自落点,写前校验
   * 与审批同门);input.entryId 给出时须与版本归属一致,只读型条目 fail-closed
   * 明示不支持回滚。
   */
  async promptRollback(input: PromptRollbackInput): Promise<PromptRollbackResult> {
    const author = input.author?.trim() !== '' && input.author !== undefined ? input.author.trim() : 'web'
    // 显式 entryId 先过条目守卫:未知 id/只读型条目 fail-closed 明示(测试计划
    // §3 T1.6(b)⑤:time-context 等只读型回滚请求 → 「上游插件生成,无写回落点」)。
    let preResolved: { entry: PromptRegistryEntry } | undefined
    if (input.entryId !== undefined && input.entryId !== '') {
      const resolved = this.resolveWritableEntry('rollback', input.entryId, author)
      if ('rejected' in resolved) return resolved.rejected
      preResolved = resolved
    }
    const store = this.requireStore()
    // 线上载荷是运行时数据:versionId 以 unknown 收窄(typeof 检查即校验)。
    const requestedId: unknown = input.versionId
    const target = typeof requestedId === 'string' && requestedId !== '' ? await store.get(requestedId) : undefined
    if (target === undefined) {
      return {
        status: 'rejected',
        issues: [`目标版本不存在:${String(requestedId)}(版本库只增不删,历史版本可随时查看)`],
        effectiveNote: EFFECTIVE_NOTE,
      }
    }
    if (input.entryId !== undefined && input.entryId !== '' && input.entryId !== target.entryId) {
      return {
        status: 'rejected',
        issues: [`目标版本属于条目 ${target.entryId} 的版本链,与请求条目 ${input.entryId} 不符(fail-closed 拒回滚)`],
        effectiveNote: EFFECTIVE_NOTE,
      }
    }
    const resolved = preResolved ?? this.resolveWritableEntry('rollback', target.entryId, author)
    if ('rejected' in resolved) return resolved.rejected
    const outcome = await this.handleWrite('rollback', {
      entryId: target.entryId,
      content: target.content,
      baseVersionId: input.baseVersionId,
      summary: input.summary,
      author: input.author,
      approvalId: input.approvalId,
      approved: input.approved,
      versionId: target.id,
    })
    return outcome
  }

  /**
   * 导出(端点 loopPrompt/prompt-export;只读,不走审批)。T1.6 起按条目:任意
   * patch 值型条目链可导出,包带 entryId(默认条目缺省该字段,T7 包形状零差异);
   * input.entryId 与 versionId 归属不一致即 bad-request。
   */
  async promptExport(input: PromptExportInput): Promise<PromptExportResult> {
    const store = this.requireStore()
    const entryId = input.entryId !== undefined && input.entryId !== '' ? input.entryId : DEFAULT_ENTRY_ID
    const entry = getPromptRegistryEntry(entryId)
    if (entry === undefined) {
      throw badRequest(`未知条目 id:${entryId}(注册表共 ${PROMPT_REGISTRY_ENTRIES.length} 条,可用 id 见 loopPrompt/snapshot 的 entries[])`)
    }
    const version = input.versionId === undefined || input.versionId === ''
      ? (await store.list(1, entryId))[0]
      : await store.get(input.versionId)
    if (version === undefined) {
      throw badRequest(input.versionId === undefined
        ? `条目 ${entryId} 版本链为空,无可导出版本`
        : `导出目标版本不存在:${input.versionId}`)
    }
    if (version.entryId !== entryId) {
      throw badRequest(`导出目标版本属于条目 ${version.entryId} 的版本链,与请求条目 ${entryId} 不符`)
    }
    const pack: PromptExportPack = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      exportedBy: input.exportedBy ?? 'web',
      sourceVersionId: version.id,
      ...(entryId !== DEFAULT_ENTRY_ID && { entryId }),
      persona: version.content,
      checksum: sha256Hex(version.content),
    }
    return { pack, version }
  }

  /**
   * 导入(端点 loopPrompt/prompt-import;导出包 schemaVersion+checksum 强校验 +
   * 同一套按条目校验器 + 两段式 R3 审批)。T1.6 起按条目:pack.entryId 指名目标
   * 条目(缺省=默认 persona),超限/缺红线/坏块标量/stale 锁经导入闯入者与保存
   * 同门禁拒收(测试计划 §3 T1.6(b)⑥:导入是写操作,不得绕过按条目校验)。
   */
  async promptImport(input: PromptImportInput): Promise<PromptImportResult> {
    // 线上载荷是运行时数据:pack 按 unknown 收窄校验(导出包校验器,T7.3 ①⑤)。
    const validated = validateExportPack(input.pack)
    const author = input.author?.trim() !== '' && input.author !== undefined ? input.author.trim() : 'web'
    const packEntryId = typeof (input.pack as { entryId?: unknown } | null | undefined)?.['entryId'] === 'string'
      ? (input.pack as { entryId?: string }).entryId
      : undefined
    if (!validated.ok) {
      this.audit.write('prompt-import.rejected', { kind: 'import', operator: author, ...(packEntryId !== undefined && { entryId: packEntryId }), issues: validated.issues, stage: 'pack' })
      return { status: 'rejected', issues: validated.issues, effectiveNote: EFFECTIVE_NOTE }
    }
    const pack = validated.pack
    const entryId = pack.entryId !== undefined && pack.entryId !== '' ? pack.entryId : DEFAULT_ENTRY_ID
    const resolved = this.resolveWritableEntry('import', entryId, author)
    if ('rejected' in resolved) return resolved.rejected
    const outcome = await this.handleWrite('import', {
      entryId,
      content: pack.persona,
      baseVersionId: input.baseVersionId,
      summary: input.summary,
      author: input.author,
      approvalId: input.approvalId,
      approved: input.approved,
      versionId: undefined,
    })
    return outcome
  }

  // ---------- 写链路共享 ----------

  /**
   * 三写端点共用的两段式流程(T1.6 起按条目):审批门(按条目 ruleId + entryId
   * 回显复验)+ 按条目校验器(非空/UTF-8/条目字节上限/条目红线规则集)+ 按条目
   * patch 定位重述写回(块标量三形态整块替换 + TOCTOU 写前基线 + 写后 dry-run
   * 验证失败自动还原)+ 按条目版本链(乐观锁/回滚/审计 entryId)。
   */
  async handleWrite(kind: WriteKind, input: {
    entryId?: string | undefined
    content: string
    baseVersionId?: string | undefined
    summary?: string | undefined
    author?: string | undefined
    approvalId?: string | undefined
    approved?: boolean | undefined
    versionId?: string | undefined
  }): Promise<WriteOutcome> {
    const author = input.author?.trim() !== '' && input.author !== undefined ? input.author.trim() : 'web'
    const entryId = input.entryId !== undefined && input.entryId !== '' ? input.entryId : DEFAULT_ENTRY_ID
    const defaultSummary: Record<WriteKind, string> = {
      save: entryId === DEFAULT_ENTRY_ID ? '编辑 persona 并保存' : `编辑条目 ${entryId} 并保存`,
      rollback: entryId === DEFAULT_ENTRY_ID ? '回滚到历史版本' : `回滚条目 ${entryId} 到历史版本`,
      import: entryId === DEFAULT_ENTRY_ID ? '导入导出包' : `导入条目 ${entryId} 导出包`,
    }
    const summary = input.summary?.trim() !== '' && input.summary !== undefined ? input.summary.trim() : defaultSummary[kind]
    // 第二段:审批确认
    if (input.approvalId !== undefined) {
      const outcome = this.gate.confirm(input.approvalId, input.approved === true, {
        content: input.content,
        baseVersionId: input.baseVersionId ?? null,
        versionId: input.versionId ?? null,
        entryId,
      })
      if (outcome.outcome === 'declined') {
        this.audit.write(`prompt-${kind}.approval-declined`, { kind, approvalId: outcome.approvalId, operator: author, entryId })
        return { status: 'approval-declined', effectiveNote: EFFECTIVE_NOTE }
      }
      if (outcome.outcome === 'unknown') {
        this.audit.write(`prompt-${kind}.approval-unknown`, { kind, approvalId: outcome.approvalId, operator: author, entryId })
        return { status: 'approval-mismatch', issues: [`审批 ${outcome.approvalId} 不存在或已过期,请重新发起`], effectiveNote: EFFECTIVE_NOTE }
      }
      if (outcome.outcome === 'mismatch') {
        this.audit.write(`prompt-${kind}.approval-mismatch`, { kind, approvalId: outcome.approvalId, reason: outcome.reason, operator: author, entryId })
        return { status: 'approval-mismatch', issues: [outcome.reason], effectiveNote: EFFECTIVE_NOTE }
      }
      const pending = outcome.pending
      const confirmedEntryId = pending.payload.entryId ?? DEFAULT_ENTRY_ID
      const entry = getPromptRegistryEntry(confirmedEntryId)
      if (entry === undefined) {
        this.audit.write(`prompt-${kind}.rejected`, { kind, operator: author, entryId: confirmedEntryId, reason: 'unknown-entry', stage: 'entry' })
        return { status: 'rejected', issues: [`未知条目 id:${confirmedEntryId}`], effectiveNote: EFFECTIVE_NOTE }
      }
      // 复验(确认回路的 TOCTOU 防线)。回滚例外:content 是版本库逐字恢复的存量
      // 记录(写入时已过校验;initial 基线来自装载时的现值),不再过内容校验——
      // 否则「回滚到无红线的历史基线」被永久锁死,违背「初始版本永久保留」的逃生门语义。
      if (kind !== 'rollback') {
        const validation = validateEntryText(entry, input.content)
        if (!validation.ok) {
          this.audit.write(`prompt-${kind}.rejected`, { kind, operator: author, entryId, issues: validation.issues, stage: 'validate' })
          return { status: 'rejected', issues: validation.issues, effectiveNote: EFFECTIVE_NOTE }
        }
      }
      const store = this.requireStore()
      const latest = (await store.list(1, confirmedEntryId))[0]
      if (pending.payload.baseVersionId !== null && pending.payload.baseVersionId !== (latest?.id ?? null)) {
        this.audit.write(`prompt-${kind}.rejected`, { kind, operator: author, entryId, reason: 'baseVersionId 过期(并发修改)' })
        return { status: 'rejected', issues: ['baseVersionId 与当前最新版本不符(并发修改),请刷新后重试'], effectiveNote: EFFECTIVE_NOTE }
      }
      // 执行(T2.1 起双通道,同文件同链单写者互斥串行):
      // - configEditor 通道(优先):官方 seam 整行 config 写回 + 同步 Loader 重组合
      //   (edit 返回即热生效),TOCTOU 基线与 verify-fail 还原纪律与直写同款;
      // - entry-patch 直写(兜底):configEditor 缺席/条目不可达(领域包/整文件/行缺失)
      //   时按条目定位重述写回,降级不炸、审计记通道与原因。
      // 任何失败零落盘或已还原,异常上抛为 RemoteError。
      const writePath = this.entryWritePath(entry)
      const baselineText = pending.payload.baseline !== undefined && pending.payload.baseline.path === writePath
        ? pending.payload.baseline.text
        : undefined
      const channelResolution = this.resolveConfigEditorChannel(entry, writePath)
      const writeChannel = 'channel' in channelResolution ? 'config-editor' : 'entry-patch'
      try {
        if ('channel' in channelResolution) {
          const channel = channelResolution.channel
          await this.entryWriter.runGoverned({
            path: writePath,
            baseline: baselineText,
            run: async () => {
              // 每次尝试前重取活引用+瞬态退避重试(见 editViaConfigEditor):本闭包在
              // 单写者链上排队,轮到执行时前序写的重组合可能已替换条目对象。
              await this.editViaConfigEditor(channel.editor, channel.rowId, current =>
                applyEntryToRowConfig(entry, current, input.content))
            },
            verify: () => this.dryRunVerify(),
            restore: async () => {
              // verify 失败:经同一 seam 写回审批前行 config(同步重组合;活引用重取与
              // 瞬态退避同款)。restore 最终抛错由 runGoverned 退字节级还原。
              await this.editViaConfigEditor(channel.editor, channel.rowId,
                () => structuredClone(channel.beforeRowConfig))
            },
          })
        } else {
          await this.entryWriter.writeNext({
            path: writePath,
            baseline: baselineText,
            build: (original) => {
              const next = buildNextEntryFileText(entry, original, input.content)
              selfCheckEntryWrite(entry, original, next, input.content)
              return next
            },
            verify: () => this.dryRunVerify(),
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // TOCTOU 拒写:文件在审批后被外部改写——零落盘、外部状态保持,按「可刷新
        // 重试的 rejected」返回(与 baseVersionId 过期同语义),不按 I/O 失败上抛。
        if (error instanceof EntryToctouError) {
          this.audit.write(`prompt-${kind}.rejected`, { kind, operator: author, entryId, reason: 'toctou-baseline-mismatch', stage: 'write', issues: [message], approvalId: pending.approvalId, patchPath: writePath, channel: writeChannel })
          return { status: 'rejected', issues: [message], effectiveNote: EFFECTIVE_NOTE }
        }
        this.audit.write(`prompt-${kind}.write-failed`, { kind, operator: author, entryId, error: message, approvalId: pending.approvalId, patchPath: writePath, channel: writeChannel })
        throw badRequest(`写回失败(条目 ${entryId};现值未变:写前自检拦截或已自动还原):${message}`)
      }
      const record = await store.append({
        content: input.content,
        author,
        source: kind,
        // 父版本语义(见 types.ts):回滚指向被回滚版本;保存/导入指向写前最新版本。
        parentId: input.versionId ?? latest?.id ?? null,
        summary,
        entryId: confirmedEntryId,
      })
      this.audit.write(`prompt-${kind}.committed`, {
        kind,
        operator: author,
        entryId,
        versionId: record.id,
        versionSeq: record.seq,
        parentId: record.parentId,
        bytes: record.bytes,
        checksum: record.checksum,
        patchPath: writePath,
        approvalId: pending.approvalId,
        // 写回通道(T2.1):config-editor=官方 seam 热生效;entry-patch=直写兜底
        // (channelNote 记降级原因——configEditor 缺席/条目不可达)。
        channel: writeChannel,
        ...('channel' in channelResolution ? {} : { channelNote: channelResolution.fallback }),
      })
      // T2.6:committed 后重刷运行时条目缓存(当前写链路对 runtime 条目 fail-closed,
      // 该刷新面向未来开放 store 写回落点时即刻生效;幂等且便宜,只扫 2 条 runtime 条目)。
      void this.refreshRuntimePromptCache()
      // T2.4:写回改变了 live patch,complete 标志缓存主动失效(TTL 只兜外部改写)。
      this.replayCompleteFlagCache.clear()
      return { status: 'committed', version: record, effectiveNote: EFFECTIVE_NOTE }
    }
    // 第一段:条目/守卫/授权/校验 + R3 审批请求。
    const resolved = this.resolveWritableEntry(kind, entryId, author)
    if ('rejected' in resolved) return resolved.rejected
    const entry = resolved.entry
    if (!this.isEntryWriteAuthorized(entry)) {
      const ruleId = entryWriteRuleId(entry.id)
      this.audit.write(`prompt-${kind}.rejected`, { kind, operator: author, entryId, reason: 'rule-unauthorized', stage: 'authorize', issues: [`写授权规则集未覆盖条目 ${entryId}(需 ${ruleId} 或通配规则)`] })
      return {
        status: 'rejected',
        issues: [`写授权未覆盖条目 ${entryId}:本实例授权规则为 [${this.writeRules.join(', ')}],需命中通配规则(${WILDCARD_WRITE_RULE_ID})或条目专属规则(${ruleId})`],
        effectiveNote: EFFECTIVE_NOTE,
      }
    }
    // 回滚例外:content 是版本库存量记录逐字恢复(语义见第二段注);其余两类
    // (save/import)过按条目校验全集(非空/UTF-8/条目上限/条目红线)——红线段
    // 只把守「新文本进入」,历史基线随时可回(初始版本永久保留的逃生门)。
    if (kind !== 'rollback') {
      const validation = validateEntryText(entry, input.content)
      if (!validation.ok) {
        this.audit.write(`prompt-${kind}.rejected`, { kind, operator: author, entryId, issues: validation.issues, stage: 'validate' })
        return { status: 'rejected', issues: validation.issues, effectiveNote: EFFECTIVE_NOTE }
      }
    }
    const store = this.requireStore()
    const readFile = this.registryReadFile()
    const current = readEntryText(entry, readFile)
    if (current.text === undefined || current.text === '') {
      const problems = current.problems.length > 0 ? current.problems.join(';') : '反引值为空'
      this.audit.write(`prompt-${kind}.rejected`, { kind, operator: author, entryId, reason: 'entry-locate-failed', stage: 'locate', issues: [problems] })
      return { status: 'rejected', issues: [`条目 ${entryId} 当前落点不可读:${problems}`], effectiveNote: EFFECTIVE_NOTE }
    }
    // TOCTOU 写前基线:审批发起时刻的落点文件全文(确认写回前现值须仍等于它)。
    const writePath = this.entryWritePath(entry)
    const baselineText = this.entryFileText(entry)
    const diff = diffLines(current.text, input.content)
    if (diff.isEmpty) {
      this.audit.write(`prompt-${kind}.rejected`, { kind, operator: author, entryId, reason: 'diff-empty', stage: 'diff' })
      return { status: 'rejected', issues: [`diff 为空:新内容与条目 ${entryId} 当前值完全一致,无可保存变更`], effectiveNote: EFFECTIVE_NOTE }
    }
    const latest = (await store.list(1, entryId))[0]
    if (input.baseVersionId !== undefined && input.baseVersionId !== (latest?.id ?? null)) {
      this.audit.write(`prompt-${kind}.rejected`, { kind, operator: author, entryId, reason: 'base-version-mismatch', stage: 'lock' })
      return { status: 'rejected', issues: ['baseVersionId 与当前最新版本不符(并发修改),请刷新后重试'], effectiveNote: EFFECTIVE_NOTE }
    }
    const actionLabel = kind === 'rollback' ? `回滚到 ${input.versionId ?? '?'}` : '编辑'
    const facts: CardFacts = {
      patchPath: writePath,
      diffSummary: cardDiffSummary(diff),
      subjectName: entryId === DEFAULT_ENTRY_ID
        ? `system prompt persona 段(${actionLabel})`
        : `提示词条目 ${entryId}(${actionLabel})`,
      ruleId: entryWriteRuleId(entry.id),
      ruleReason: entryId === DEFAULT_ENTRY_ID
        ? 'system prompt persona 段影响所有新会话的前缀与 KV-cache 命中'
        : `提示词注册表条目 ${entryId}(层 ${entry.layer}/${entry.kind})影响相应会话的系统提示`,
      whyEntry: `R3 · ${entryWriteRuleId(entry.id)}(提示词注册表条目 ${entryId} 写回)`,
    }
    const payload: PendingWritePayload = {
      content: input.content,
      baseVersionId: input.baseVersionId ?? null,
      versionId: input.versionId ?? null,
      summary,
      author,
      entryId,
      baseline: { path: writePath, text: baselineText },
    }
    const pending = this.gate.request(kind, payload, facts)
    this.audit.write(`prompt-${kind}.approval-requested`, {
      kind,
      operator: author,
      entryId,
      approvalId: pending.approvalId,
      bytes: byteLength(input.content),
      diffAdded: diff.added,
      diffRemoved: diff.removed,
      baseVersionId: payload.baseVersionId,
      ...(input.versionId !== undefined && { targetVersionId: input.versionId }),
    })
    return {
      status: 'approval-required',
      approval: {
        approvalId: pending.approvalId,
        kind,
        card: pending.card,
        questionItems: pending.questionItems,
      },
      effectiveNote: EFFECTIVE_NOTE,
    }
  }

  /** 版本库就绪检查(未挂载即抛 RemoteError;snapshot 不走这里,自己降级)。 */
  requireStore(): PromptVersionStore {
    const store = this.store
    if (store !== undefined) return store
    throw badRequest(`版本库未就绪:${this.storeError ?? 'storage 栈仍在挂载中,请稍后重试'}`)
  }

  /** 版本概览(prompt-get 复用;entryId 缺省=默认条目 persona 链——旧语义)。 */
  async versionOverview(entryId: string = DEFAULT_ENTRY_ID): Promise<VersionOverview> {
    const store = this.store
    if (store === undefined) {
      return { ready: false, count: 0, latestId: null, latestAt: null }
    }
    const records = await store.list(Number.POSITIVE_INFINITY, entryId)
    return overviewOf(records, true)
  }

  // ---------- T1.4 读侧按条目泛化的共享构件 ----------

  /** 条目当前值视图(分型:patch 值型=结构定位反引;只读/运行时型=text=null+note)。 */
  buildEntryValueView(entry: PromptRegistryEntry): EntryValueView {
    const base = { entryId: entry.id, kind: entry.kind, note: entry.note }
    if (entry.kind !== 'patch-value') {
      return { ...base, text: null, bytes: null, problems: [] }
    }
    const read = readEntryText(entry, this.registryReadFile())
    if (read.text === undefined || read.text === '') {
      return { ...base, text: null, bytes: null, problems: read.problems }
    }
    return { ...base, text: read.text, bytes: byteLength(read.text), problems: read.problems }
  }

  /**
   * 写盘后干跑自检(spike §4.2):`dsh --profile <name> --dump-config`(无副作用)。
   * 干跑不可用(dsh bin 缺失/非 profile 运行)时跳过并记审计——真正的组合校验仍由
   * HMR 重组合兜底(失败有报错行)。
   */
  async dryRunVerify(): Promise<void> {
    if (this.config.dryRunVerify === false) return
    const profile = this.profileContext
    if (profile === undefined) return
    const bin = join(profile.dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (!existsSync(bin)) return
    const result = await new Promise<{ code: number | null; stdout: string; error?: string }>((resolve) => {
      const child = spawn(process.execPath, [bin, '--profile', profile.name, '--dump-config'], {
        env: { ...process.env, DSH_HOME: profile.home },
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      let stdout = ''
      child.stdout.on('data', (chunk: Buffer) => { stdout += String(chunk) })
      const timer = setTimeout(() => child.kill('SIGKILL'), 120_000)
      child.once('error', (error) => {
        clearTimeout(timer)
        resolve({ code: null, stdout, error: String(error) })
      })
      child.once('exit', (code) => {
        clearTimeout(timer)
        resolve({ code, stdout })
      })
    })
    if (result.error !== undefined || result.code !== 0 || /skipping|incompatible/i.test(result.stdout)) {
      throw new Error(`dump-config 干跑未通过(code=${String(result.code)}${result.error === undefined ? '' : `,${result.error}`};组合含 skipping/incompatible 或解析失败)`)
    }
  }
}

applyRemoteMarker(LoopPromptGateway.prototype, 'snapshot', 'snapshot')
applyRemoteMarker(LoopPromptGateway.prototype, 'trace', 'trace')
applyRemoteMarker(LoopPromptGateway.prototype, 'promptGet', 'prompt-get')
applyRemoteMarker(LoopPromptGateway.prototype, 'promptSave', 'prompt-save')
applyRemoteMarker(LoopPromptGateway.prototype, 'promptVersions', 'prompt-versions')
applyRemoteMarker(LoopPromptGateway.prototype, 'promptRollback', 'prompt-rollback')
applyRemoteMarker(LoopPromptGateway.prototype, 'promptExport', 'prompt-export')
applyRemoteMarker(LoopPromptGateway.prototype, 'promptImport', 'prompt-import')
applyRemoteMarker(LoopPromptGateway.prototype, 'sessionSnapshot', 'session-snapshot')
applyRemoteMarker(LoopPromptGateway.prototype, 'aiStatus', 'ai-status')
applyRemoteMarker(LoopPromptGateway.prototype, 'aiPolish', 'ai-polish')
applyRemoteMarker(LoopPromptGateway.prototype, 'aiReview', 'ai-review')

export type { PromptVersionRecord } from './types.ts'
export {
  AGENT_DEFAULT_MODEL_ROW_ID, AI_CALL_TIMEOUT_MS, AI_ENDPOINT_PATHS, AI_META_POLISH_ENTRY_ID,
  AI_META_REVIEW_ENTRY_ID, aiChatCompletion, buildAiEntryUserPayload, checkAiAvailability,
  createKeyPresenceResolver, extractDraftText, extractFencedBlock, findCarrierInPatch, parseAiFindings,
  readDefaultModelFromPatch, resolveAiRoute, resolveDefaultModelRoute,
} from './ai-service.ts'
export type { AiAvailability, AiChatRequest, AiChatResult, AiFetchLike, AiFindingsParse, AiRoute, AiRouteSources } from './ai-service.ts'
export { PromptVersionStore, VERSION_UNIT_DESCRIPTOR, VERSION_UNIT_NAME } from './version-store.ts'
export { PersonaPatchFile, selfCheckNextPatchText } from './persona-patch.ts'
export { EntryPatchFile, EntryToctouError, buildNextEntryFileText, entrySpanOf, selfCheckEntryWrite } from './entry-patch.ts'
export type { EntrySpan, EntryWriteRequest, EntryWriteResult, GovernedRunRequest } from './entry-patch.ts'
export { applyEntryToRowConfig, readConfigEditorRows, resolveConfigEditor } from './config-editor-write.ts'
export type { ConfigEditorFace, ConfigEditorRow } from './config-editor-write.ts'
export {
  DEFAULT_ENTRY_ID, ENTRY_KIND_LABELS, LAYER_LABELS, PROMPT_REGISTRY_ENTRIES, WEB_PATCH, checkEntryAnchors,
  ensureEntryWritable, getPromptRegistryEntry, listPromptRegistryEntries, locateYamlConfigKey, readBlockScalarValue,
  readEntryText, readEntryValue, readYamlValueAtLine, registryInvariants,
} from './registry.ts'
export type {
  CodeAnchor, EntryValueRead, PromptEntryKind, PromptLayer, PromptRegistryEntry, RedLinePolicy, RegistryFileReader, YamlLocator,
} from './registry.ts'
export {
  INDUSTRIAL_RED_LINE_RULES, MAX_PERSONA_BYTES, RED_LINE_RULES, RED_LINE_RULE_SETS, checkRedLines, checkRedLinesOfRuleSet,
  checkUtf8WellFormed, validateEntryText, validatePersonaText,
} from './validator.ts'
export { validateExportPack } from './export-pack.ts'
export { diffLines, diffSummaryText, lineDiffOps } from './diff.ts'
export { sha256Hex } from './checksum.ts'
export { ApprovalGate, ENTRY_WRITE_RULE_PREFIX, PERSONA_WRITE_RULE_ID, WILDCARD_WRITE_RULE_ID, entryWriteRuleId } from './approval.ts'
export { StudioAudit, defaultAuditFilePath } from './audit.ts'
export { CHANNEL_A, EFFECTIVE_NOTE, COMPOSED_NOTE, SNAPSHOT_VIEW_NOTE } from './snapshot.ts'
export {
  READONLY_SNAPSHOT_ANNOTATION, RUNTIME_NO_TEXT_ANNOTATION, RUNTIME_TEXT_ANNOTATION,
  SESSION_CREATED_TRIGGER, SNAPSHOT_UNIT_DESCRIPTOR, SNAPSHOT_UNIT_NAME, SNAPSHOTS_TABLE,
  SessionSnapshotStore, captureSessionSnapshotEntries, sessionSnapshotChecksum,
} from './session-snapshot.ts'
export {
  ASSEMBLE_EVENT, PLAN_POLICY_SECTION_NAME, PERSONA_PREFIX_SECTION_NAME, REPLAY_SECTION_MAPPINGS,
  SKIP_COMPLETE_OWNER, SKIP_GOVERNING_AMBIGUOUS, SKIP_GOVERNING_UNKNOWN, SKIP_NO_AGENT_ID,
  SKIP_NO_SECTION_MAPPING, SKIP_READONLY_KIND, SKIP_RUNTIME_KIND, SKIP_SECTION_ABSENT, SKIP_SECTION_EMPTY,
  SKIP_SNAPSHOT_ABSENT, SKIP_SNAPSHOT_TEXT_NULL, agentIdOfAssembleContext, pluginSpanOwnsCompleteFlag,
  replayMappedEntryIds, resolveAssemblyReplay,
} from './assembly-replay.ts'
export type {
  AssemblyReplayInput, AssemblyReplayResult, ReplayAssembledSection, ReplaySectionMapping,
  ReplaySectionOutcome, ReplaySkippedEntry,
} from './assembly-replay.ts'

/**
 * 插件工厂(bundle loader 取 default export 实例;apply 返回总 disposer)。
 * storage 挂载经官方 inject seam:等待 `storage.backend.json` 生命周期服务后
 * 打开版本库单元(对齐 dsh-storage-domain 的 inject 形态),缺席/失败不炸宿主,
 * 端点以 RemoteError 明示未就绪。
 */
export function definePromptStudioPlugin(config: PromptStudioPluginConfig = {}) {
  return {
    name: 'eterna-prompt-studio',
    apply(ctx: StudioContextLike): () => void {
      const gateway = new LoopPromptGateway(ctx, config)
      // T2.6 登记制读取面:provide promptRegistry 服务(memory/glue 的运行时 section
      // 经 ctx.get 机会读取;本插件未挂载/服务缺席时消费侧回落各自内置文本,不炸宿主)。
      const disposeProvide = ctx.provide(PROMPT_REGISTRY_SERVICE_ID, gateway.promptRegistryFace)
      // T2.3 会话快照:全局未打标 session/created 监听(会话开启事件;未打标=
      // 收到全部会话,dsh-scope 语义);插件卸载随 disposer 撤销。
      const disposeSessionCreated = gateway.registerSessionCreated(ctx)
      // T2.4 历史会话严格回放:全局未打标 system-prompt/assemble waterfall 监听
      // (未打标=收到全部会话的组装;快照缺席/身份缺席/库未挂载全部降级用当前值,
      // 绝不炸组装);插件卸载随 disposer 撤销。
      const disposeAssembleReplay = gateway.registerAssembleReplay(ctx)
      // storage 挂载经官方 inject seam:版本库单元在 storage.backend.json 可用后打开,
      // 缺席/失败不炸宿主(端点以 RemoteError 明示未就绪;snapshot 降级 ready=false)。
      ctx.inject([STORAGE_JSON_BACKEND_KEY], (storageCtx: StudioContextLike) => {
        const backend = storageCtx.get(STORAGE_JSON_BACKEND_KEY) as StorageBackend | undefined
        storageCtx.effect(() => {
          void gateway.attachBackend(backend).catch(() => undefined)
          return () => {
            void gateway.detachStore()
          }
        })
      })
      return () => {
        // 总 disposer(逆序:后注册者先卸):assemble 回放监听 → 会话开启监听 →
        // 读取面 → 在途审批取消 + 版本库/快照库单元关闭(Service 随 owning fiber 注销)。
        disposeAssembleReplay()
        disposeSessionCreated()
        disposeProvide()
        void gateway.dispose()
      }
    },
  }
}

/** DSH bundle loader 取 default export 插件实例(对齐 panel/glue 插件形态)。 */
export default definePromptStudioPlugin()
