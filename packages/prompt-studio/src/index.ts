/**
 * @basis/prompt-studio Host 半边(T7.1):一个薄插件,把「提示词工坊 + 循环轨迹」
 * 经官方 Typert 网关 SRC 端点暴露(namespace = loopPrompt;浏览器半边 T7.2 经
 * ctx.connection.rpc 调用)。
 *
 * 装载形态:profile bundle 的 cordis.patch.yml 插入行 `- id: basis-prompt-studio,
 * name: '@basis/prompt-studio'`(与 @basis/panel 同款 insert 语义);本包 package.json
 * 声明 dsh.client(platform: web),宿主 client-modules 扫描把 lib/client.js 组进
 * window.__DSH_BOOT__ 浏览器花名册——同一行,两面。
 *
 * 端点(全部 SRC 模式;api/gateway resolveSrcDescriptor 扫描 reflect.props 里带
 * typertRemote 绑定的服务):
 * - loopPrompt/snapshot          无参快照(persona/版本库/在途审批/轨迹概览含最近
 *                                会话清单 trace.recent/通道)
 * - loopPrompt/trace             会话列表或指定会话轮次树(T7.4 管线:磁盘日志投影,
 *                                推理摘要/工具/耗时/token/审批事件标记,容错降级)
 * - loopPrompt/prompt-get        当前 persona + 版本库概览
 * - loopPrompt/prompt-save       保存(两段式:R3 审批卡 → 确认执行)
 * - loopPrompt/prompt-versions   版本列表(只增不删)
 * - loopPrompt/prompt-rollback   回滚(两段式;产生新版本而非删旧版本)
 * - loopPrompt/prompt-export     导出 JSON 包(只读,不走审批)
 * - loopPrompt/prompt-import     导入 JSON 包(校验 checksum;两段式)
 *
 * Node 24 type-stripping 不解析标准 decorator 语法,故经 Remote() 公开函数面
 * 手工施加装饰器(等价于 @Remote('snapshot') 糖,对齐 packages/panel/src/index.ts)。
 * SRC 参数绑定按运行时方法形参名(网关 methodParameterNames):参数一律用单个
 * 简单标识符 `input`(禁止默认值/解构,否则 gateway/signature-invalid)。
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
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { StorageBackend } from '@deepseek-ai/dsh-storage'
import { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import { ApprovalGate } from './approval.ts'
import type { CardFacts, PendingWritePayload } from './approval.ts'
import { StudioAudit, defaultAuditFilePath } from './audit.ts'
import type { GovernanceAuditLike } from './audit.ts'
import { byteLength, sha256Hex } from './checksum.ts'
import { diffLines } from './diff.ts'
import { validateExportPack } from './export-pack.ts'
import { PersonaPatchFile } from './persona-patch.ts'
import { COMPOSED_NOTE, EFFECTIVE_NOTE, buildSnapshot, cardDiffSummary } from './snapshot.ts'
import { TRACE_SESSION_LIMIT_DEFAULT, listTraceSessions, readSessionTrace } from './trace.ts'
import type {
  LoopPromptSnapshot, PromptExportInput, PromptExportPack, PromptExportResult, PromptGetResult,
  PromptImportInput, PromptImportResult, PromptRollbackInput, PromptRollbackResult, PromptSaveInput,
  PromptSaveResult, ProfileContextLike, StudioContextLike, TraceInput, TraceReport, VersionsInput,
  VersionsResult, WriteApprovalView, WriteKind, WriteStatus,
} from './types.ts'
import type { PromptVersionRecord } from './types.ts'
import { validatePersonaText } from './validator.ts'
import { PromptVersionStore, VERSION_UNIT_DESCRIPTOR } from './version-store.ts'

/** Typert 服务名(RPC namespace;DSH 端点段文法 `[A-Za-z0-9_$.-]+`)。 */
export const LOOP_PROMPT_SERVICE_ID = 'loopPrompt'

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
  /** 兜底审计文件(默认 <DSH_HOME>/basis-prompt-studio/audit.jsonl)。 */
  readonly auditFilePath?: string
  /** 保存写盘后跑 `dsh --dump-config` 干跑自检(默认 true;失败自动还原)。 */
  readonly dryRunVerify?: boolean
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

/** LoopPrompt 网关(SRC 端点宿主;SRC 端点 loopPrompt/*)。状态全公开:见文件头网关调用约束。 */
export class LoopPromptGateway extends TypertRemoteService {
  readonly config: PromptStudioPluginConfig
  readonly audit: StudioAudit
  readonly gate: ApprovalGate
  readonly patch: PersonaPatchFile
  readonly profileContext: ProfileContextLike | undefined
  readonly sessionsRoot: string
  /** 版本库(attachBackend 打开;未挂载 undefined)。 */
  store: PromptVersionStore | undefined
  /** 版本库未就绪的原因(snapshot 降级面/requireStore 明示用)。 */
  storeError: string | undefined

  constructor(ctx: StudioContextLike, config: PromptStudioPluginConfig = {}) {
    // Service 边界单点断言(基类构造器 protected,无法提取其参数类型):运行时传入的
    // 就是宿主真实 Context,本包业务面只消费 StudioContextLike 结构面(types.ts 注)。
    super(ctx as never, LOOP_PROMPT_SERVICE_ID)
    this.config = config
    this.profileContext = ctx.get('profileContext') as ProfileContextLike | undefined
    const home = this.profileContext?.home ?? process.env.DSH_HOME ?? ''
    this.sessionsRoot = config.sessionsRoot ?? (home !== '' ? join(home, 'sessions') : '')
    this.audit = new StudioAudit({
      fallbackFilePath: config.auditFilePath ?? (home !== '' ? defaultAuditFilePath(home) : join(process.cwd(), '.basis', 'prompt-studio.audit.jsonl')),
      resolveGovernance: () => ctx.get('governance') as GovernanceAuditLike | undefined,
    })
    this.gate = new ApprovalGate()
    const patchPath = config.patchPath ?? this.profileContext?.patchPath
    this.patch = new PersonaPatchFile(patchPath ?? join(process.cwd(), 'cordis.patch.yml'))
  }

  /** storage 栈挂载(apply 的 inject 回调里调用;打开单元并种子初始版本)。 */
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
      const persona = await this.patch.read()
      if (persona.available && persona.text.trim().length > 0) {
        await store.ensureInitial(persona.text)
      }
      this.store = store
      this.storeError = undefined
    } catch (error) {
      this.storeError = `版本库单元打开失败:${error instanceof Error ? error.message : String(error)}`
    }
  }

  /** 释放版本库单元(幂等;apply 逆闭包调用)。 */
  async detachStore(): Promise<void> {
    const store = this.store
    this.store = undefined
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
    const overview = await this.versionOverview()
    const pending = this.gate.peek()
    // 最近会话清单一次投影:sessions 数 = 清单长度,清单整体随 trace.recent 下发(T7.4)。
    const traceRecent = listTraceSessions(this.sessionsRoot, TRACE_SESSION_LIMIT_DEFAULT)
    return buildSnapshot({
      persona,
      versions: overview,
      pendingApproval: pending === null
        ? null
        : { approvalId: pending.approvalId, kind: pending.kind, createdAt: new Date(pending.createdAt).toISOString() },
      traceRecent,
      tracePipeline: 'v0-disk-log',
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

  /** 当前 persona(端点 loopPrompt/prompt-get;无参)。 */
  async promptGet(): Promise<PromptGetResult> {
    const persona = await this.patch.read()
    return {
      persona,
      versions: await this.versionOverview(),
      effectiveNote: EFFECTIVE_NOTE,
      composedNote: COMPOSED_NOTE,
    }
  }

  /** 保存 persona(端点 loopPrompt/prompt-save;两段式 R3 审批)。 */
  async promptSave(input: PromptSaveInput): Promise<PromptSaveResult> {
    return this.handleWrite('save', {
      content: input.content,
      baseVersionId: input.baseVersionId,
      summary: input.summary,
      author: input.author,
      approvalId: input.approvalId,
      approved: input.approved,
      versionId: undefined,
    })
  }

  /** 版本列表(端点 loopPrompt/prompt-versions;只增不删)。 */
  async promptVersions(input: VersionsInput): Promise<VersionsResult> {
    const store = this.requireStore()
    const limit = input.limit ?? 50
    const records = await store.list(limit)
    const total = (await store.list()).length
    return { total, ready: true, versions: records }
  }

  /** 回滚(端点 loopPrompt/prompt-rollback;两段式;产生新版本)。 */
  async promptRollback(input: PromptRollbackInput): Promise<PromptRollbackResult> {
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
    const outcome = await this.handleWrite('rollback', {
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

  /** 导出(端点 loopPrompt/prompt-export;只读,不走审批)。 */
  async promptExport(input: PromptExportInput): Promise<PromptExportResult> {
    const store = this.requireStore()
    const version = input.versionId === undefined || input.versionId === ''
      ? (await store.list(1))[0]
      : await store.get(input.versionId)
    if (version === undefined) {
      throw badRequest(input.versionId === undefined
        ? '版本库为空,无可导出版本'
        : `导出目标版本不存在:${input.versionId}`)
    }
    const pack: PromptExportPack = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      exportedBy: input.exportedBy ?? 'web',
      sourceVersionId: version.id,
      persona: version.content,
      checksum: sha256Hex(version.content),
    }
    return { pack, version }
  }

  /** 导入(端点 loopPrompt/prompt-import;导出包 schemaVersion+checksum 强校验 + 同一套内容校验 + 两段式 R3 审批)。 */
  async promptImport(input: PromptImportInput): Promise<PromptImportResult> {
    // 线上载荷是运行时数据:pack 按 unknown 收窄校验(导出包校验器,T7.3 ①⑤)。
    const validated = validateExportPack(input.pack)
    if (!validated.ok) {
      this.audit.write('prompt-import.rejected', { kind: 'import', operator: input.author ?? 'web', issues: validated.issues, stage: 'pack' })
      return { status: 'rejected', issues: validated.issues, effectiveNote: EFFECTIVE_NOTE }
    }
    const pack = validated.pack
    const outcome = await this.handleWrite('import', {
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

  /** 三写端点共用的两段式流程(审批门 + 校验器 + patch 原子写 + 版本库 + 审计)。 */
  async handleWrite(kind: WriteKind, input: {
    content: string
    baseVersionId?: string | undefined
    summary?: string | undefined
    author?: string | undefined
    approvalId?: string | undefined
    approved?: boolean | undefined
    versionId?: string | undefined
  }): Promise<WriteOutcome> {
    const author = input.author?.trim() !== '' && input.author !== undefined ? input.author.trim() : 'web'
    const defaultSummary: Record<WriteKind, string> = {
      save: '编辑 persona 并保存',
      rollback: '回滚到历史版本',
      import: '导入导出包',
    }
    const summary = input.summary?.trim() !== '' && input.summary !== undefined ? input.summary.trim() : defaultSummary[kind]
    // 第二段:审批确认
    if (input.approvalId !== undefined) {
      const outcome = this.gate.confirm(input.approvalId, input.approved === true, {
        content: input.content,
        baseVersionId: input.baseVersionId ?? null,
        versionId: input.versionId ?? null,
      })
      if (outcome.outcome === 'declined') {
        this.audit.write(`prompt-${kind}.approval-declined`, { kind, approvalId: outcome.approvalId, operator: author })
        return { status: 'approval-declined', effectiveNote: EFFECTIVE_NOTE }
      }
      if (outcome.outcome === 'unknown') {
        this.audit.write(`prompt-${kind}.approval-unknown`, { kind, approvalId: outcome.approvalId, operator: author })
        return { status: 'approval-mismatch', issues: [`审批 ${outcome.approvalId} 不存在或已过期,请重新发起`], effectiveNote: EFFECTIVE_NOTE }
      }
      if (outcome.outcome === 'mismatch') {
        this.audit.write(`prompt-${kind}.approval-mismatch`, { kind, approvalId: outcome.approvalId, reason: outcome.reason, operator: author })
        return { status: 'approval-mismatch', issues: [outcome.reason], effectiveNote: EFFECTIVE_NOTE }
      }
      const pending = outcome.pending
      // 复验(确认回路的 TOCTOU 防线)。回滚例外:content 是版本库逐字恢复的存量
      // 记录(写入时已过校验;initial 基线来自装载时的现值),不再过内容校验——
      // 否则「回滚到无红线的历史基线」被永久锁死,违背「初始版本永久保留」的逃生门语义。
      if (kind !== 'rollback') {
        const validation = validatePersonaText(input.content)
        if (!validation.ok) {
          this.audit.write(`prompt-${kind}.rejected`, { kind, operator: author, issues: validation.issues })
          return { status: 'rejected', issues: validation.issues, effectiveNote: EFFECTIVE_NOTE }
        }
      }
      const store = this.requireStore()
      const latest = (await store.list(1))[0]
      if (pending.payload.baseVersionId !== null && pending.payload.baseVersionId !== (latest?.id ?? null)) {
        this.audit.write(`prompt-${kind}.rejected`, { kind, operator: author, reason: 'baseVersionId 过期(并发修改)' })
        return { status: 'rejected', issues: ['baseVersionId 与当前最新版本不符(并发修改),请刷新后重试'], effectiveNote: EFFECTIVE_NOTE }
      }
      // 执行:patch 原子写(写前 YAML 自检 + 写后 dry-run 验证失败自动还原;异常上抛为 RemoteError)
      try {
        await this.patch.writeNext(input.content, { verify: () => this.dryRunVerify() })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.audit.write(`prompt-${kind}.write-failed`, { kind, operator: author, error: message, approvalId: pending.approvalId })
        throw badRequest(`patch 层写入失败(现值未变:写前自检拦截或已自动还原):${message}`)
      }
      const record = await store.append({
        content: input.content,
        author,
        source: kind,
        // 父版本语义(见 types.ts):回滚指向被回滚版本;保存/导入指向写前最新版本。
        parentId: input.versionId ?? latest?.id ?? null,
        summary,
      })
      this.audit.write(`prompt-${kind}.committed`, {
        kind,
        operator: author,
        versionId: record.id,
        versionSeq: record.seq,
        parentId: record.parentId,
        bytes: record.bytes,
        checksum: record.checksum,
        patchPath: this.patch.path,
        approvalId: pending.approvalId,
      })
      return { status: 'committed', version: record, effectiveNote: EFFECTIVE_NOTE }
    }
    // 第一段:校验 + R3 审批请求。回滚例外:content 是版本库存量记录逐字恢复
    // (语义见第二段注);其余两类(save/import)过 T7.3 校验全集——红线段只把守
    // 「新文本进入」,历史基线随时可回(初始版本永久保留的逃生门)。
    if (kind !== 'rollback') {
      const validation = validatePersonaText(input.content)
      if (!validation.ok) {
        this.audit.write(`prompt-${kind}.rejected`, { kind, operator: author, issues: validation.issues, stage: 'validate' })
        return { status: 'rejected', issues: validation.issues, effectiveNote: EFFECTIVE_NOTE }
      }
    }
    const store = this.requireStore()
    const persona = await this.patch.read()
    if (!persona.available) {
      return { status: 'rejected', issues: [persona.error ?? 'persona 落点不可用'], effectiveNote: EFFECTIVE_NOTE }
    }
    const diff = diffLines(persona.text, input.content)
    if (diff.isEmpty) {
      this.audit.write(`prompt-${kind}.rejected`, { kind, operator: author, reason: 'diff-empty', stage: 'diff' })
      return { status: 'rejected', issues: ['diff 为空:新内容与当前 persona 完全一致,无可保存变更'], effectiveNote: EFFECTIVE_NOTE }
    }
    const latest = (await store.list(1))[0]
    if (input.baseVersionId !== undefined && input.baseVersionId !== (latest?.id ?? null)) {
      this.audit.write(`prompt-${kind}.rejected`, { kind, operator: author, reason: 'base-version-mismatch', stage: 'lock' })
      return { status: 'rejected', issues: ['baseVersionId 与当前最新版本不符(并发修改),请刷新后重试'], effectiveNote: EFFECTIVE_NOTE }
    }
    const facts: CardFacts = {
      patchPath: persona.patchPath ?? this.patch.path,
      diffSummary: cardDiffSummary(diff),
      subjectName: `system prompt persona 段(${kind === 'rollback' ? `回滚到 ${input.versionId ?? '?'}` : '编辑'})`,
    }
    const payload: PendingWritePayload = {
      content: input.content,
      baseVersionId: input.baseVersionId ?? null,
      versionId: input.versionId ?? null,
      summary,
      author,
    }
    const pending = this.gate.request(kind, payload, facts)
    this.audit.write(`prompt-${kind}.approval-requested`, {
      kind,
      operator: author,
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

  /** 版本概览(snapshot/prompt-get 的降级面:未挂载 → ready=false)。 */
  async versionOverview() {
    const store = this.store
    if (store === undefined) {
      return { ready: false, count: 0, latestId: null, latestAt: null }
    }
    const records = await store.list()
    const latest: PromptVersionRecord | undefined = records[0]
    return {
      ready: true,
      count: records.length,
      latestId: latest?.id ?? null,
      latestAt: latest?.createdAt ?? null,
    }
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
export { validatePersonaText, checkRedLines, checkUtf8WellFormed, RED_LINE_RULES, MAX_PERSONA_BYTES } from './validator.ts'
export { validateExportPack } from './export-pack.ts'
export { diffLines, diffSummaryText, lineDiffOps } from './diff.ts'
export { sha256Hex } from './checksum.ts'
export { ApprovalGate, PERSONA_WRITE_RULE_ID } from './approval.ts'
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
    name: 'basis-prompt-studio',
    apply(ctx: StudioContextLike): () => void {
      const gateway = new LoopPromptGateway(ctx, config)
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
        // 总 disposer:在途审批取消 + 版本库单元关闭(Service 随 owning fiber 注销)。
        void gateway.dispose()
      }
    },
  }
}

/** DSH bundle loader 取 default export 插件实例(对齐 panel/glue 插件形态)。 */
export default definePromptStudioPlugin()
