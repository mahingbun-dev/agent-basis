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
import { ApprovalGate } from './approval.ts'
import type { CardFacts, PendingWritePayload } from './approval.ts'
import { WILDCARD_WRITE_RULE_ID, entryWriteRuleId } from './approval.ts'
import { StudioAudit, defaultAuditFilePath } from './audit.ts'
import type { GovernanceAuditLike } from './audit.ts'
import { byteLength, sha256Hex } from './checksum.ts'
import { diffLines } from './diff.ts'
import { EntryPatchFile, EntryToctouError, buildNextEntryFileText, selfCheckEntryWrite } from './entry-patch.ts'
import { validateExportPack } from './export-pack.ts'
import { PersonaPatchFile } from './persona-patch.ts'
import {
  DEFAULT_ENTRY_ID, PROMPT_REGISTRY_ENTRIES, WEB_PATCH, ensureEntryWritable, getPromptRegistryEntry, readEntryText,
} from './registry.ts'
import type { PromptRegistryEntry, RegistryFileReader } from './registry.ts'
import { COMPOSED_NOTE, EFFECTIVE_NOTE, READONLY_ENTRY_NOTE, RUNTIME_ENTRY_NOTE, buildSnapshot, cardDiffSummary } from './snapshot.ts'
import { TRACE_SESSION_LIMIT_DEFAULT, listTraceSessions, readSessionTrace } from './trace.ts'
import type {
  EntryNotFoundResult, EntrySummaryView, EntryValueView, LoopPromptSnapshot, PromptEntryView,
  PromptExportInput, PromptExportPack, PromptExportResult, PromptGetEntryResult, PromptGetInput,
  PromptGetResult, PromptImportInput, PromptImportResult, PromptRollbackInput, PromptRollbackResult,
  PromptSaveInput, PromptSaveResult, ProfileContextLike, StudioContextLike, TraceInput, TraceReport,
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
  readonly config: PromptStudioPluginConfig
  readonly audit: StudioAudit
  readonly gate: ApprovalGate
  readonly patch: PersonaPatchFile
  /** 按条目受治理写回器(T1.6:任意 patch 值型条目 → 定位重述写回,单写者+TOCTOU)。 */
  readonly entryWriter: EntryPatchFile
  /** 写授权规则集(T1.6;缺省=通配全部条目)。 */
  readonly writeRules: readonly string[]
  readonly profileContext: ProfileContextLike | undefined
  readonly sessionsRoot: string
  /** 注册表文件解析根(领域/运行时层条目的仓库根;preset 层 patch 映射到 live patch)。 */
  readonly repoRoot: string
  /** 版本库(attachBackend 打开;未挂载 undefined)。 */
  store: PromptVersionStore | undefined
  /** 版本库未就绪的原因(snapshot 降级面/requireStore 明示用)。 */
  storeError: string | undefined
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

  constructor(ctx: StudioContextLike, config: PromptStudioPluginConfig = {}) {
    // Service 边界单点断言(基类构造器 protected,无法提取其参数类型):运行时传入的
    // 就是宿主真实 Context,本包业务面只消费 StudioContextLike 结构面(types.ts 注)。
    super(ctx as never, LOOP_PROMPT_SERVICE_ID)
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

  /** 释放版本库单元(幂等;apply 逆闭包调用)。 */
  async detachStore(): Promise<void> {
    const store = this.store
    this.store = undefined
    this.entrySeedPromise = undefined
    this.runtimePromptCache.clear()
    await store?.close()
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
      // 执行:按条目定位重述写回(TOCTOU 基线校验 + 写前自检 + 原子写 + 写后
      // dry-run 验证失败自动还原;任何失败零落盘或已还原,异常上抛为 RemoteError)。
      const writePath = this.entryWritePath(entry)
      try {
        await this.entryWriter.writeNext({
          path: writePath,
          baseline: pending.payload.baseline !== undefined && pending.payload.baseline.path === writePath
            ? pending.payload.baseline.text
            : undefined,
          build: (original) => {
            const next = buildNextEntryFileText(entry, original, input.content)
            selfCheckEntryWrite(entry, original, next, input.content)
            return next
          },
          verify: () => this.dryRunVerify(),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // TOCTOU 拒写:文件在审批后被外部改写——零落盘、外部状态保持,按「可刷新
        // 重试的 rejected」返回(与 baseVersionId 过期同语义),不按 I/O 失败上抛。
        if (error instanceof EntryToctouError) {
          this.audit.write(`prompt-${kind}.rejected`, { kind, operator: author, entryId, reason: 'toctou-baseline-mismatch', stage: 'write', issues: [message], approvalId: pending.approvalId, patchPath: writePath })
          return { status: 'rejected', issues: [message], effectiveNote: EFFECTIVE_NOTE }
        }
        this.audit.write(`prompt-${kind}.write-failed`, { kind, operator: author, entryId, error: message, approvalId: pending.approvalId, patchPath: writePath })
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
      })
      // T2.6:committed 后重刷运行时条目缓存(当前写链路对 runtime 条目 fail-closed,
      // 该刷新面向未来开放 store 写回落点时即刻生效;幂等且便宜,只扫 2 条 runtime 条目)。
      void this.refreshRuntimePromptCache()
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

export type { PromptVersionRecord } from './types.ts'
export { PromptVersionStore, VERSION_UNIT_DESCRIPTOR, VERSION_UNIT_NAME } from './version-store.ts'
export { PersonaPatchFile, selfCheckNextPatchText } from './persona-patch.ts'
export { EntryPatchFile, EntryToctouError, buildNextEntryFileText, entrySpanOf, selfCheckEntryWrite } from './entry-patch.ts'
export type { EntrySpan, EntryWriteRequest, EntryWriteResult } from './entry-patch.ts'
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
export { CHANNEL_A, EFFECTIVE_NOTE, COMPOSED_NOTE } from './snapshot.ts'

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
        // 总 disposer:读取面注销 + 在途审批取消 + 版本库单元关闭(Service 随 owning fiber 注销)。
        disposeProvide()
        void gateway.dispose()
      }
    },
  }
}

/** DSH bundle loader 取 default export 插件实例(对齐 panel/glue 插件形态)。 */
export default definePromptStudioPlugin()
