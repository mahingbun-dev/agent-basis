/**
 * @eterna/panel Host 半边:一个薄插件,把基座能力的只读快照经官方 Typert 网关
 * 暴露为 Remote 端点 eternaPanel/snapshot(浏览器面板经 ctx.connection.rpc 调用);
 * M-M2 T9 增裁决端点 eternaPanel/review(待审记忆批/拒,走 glue 注册的
 * @eterna/memory 服务——Memory.review 的软失效语义,本包不经 sqlite 写路径)。
 *
 * 装载形态:profile bundle 的 cordis.patch.yml 插入行 `- id: eterna-panel,
 * name: '@eterna/panel'`(与 @eterna/glue 同款 insert 语义);本包 package.json 声明
 * dsh.client(platform: web),宿主 client-modules 扫描把 lib/client.js 组进
 * window.__DSH_BOOT__ 浏览器花名册——同一行,两面(Host=本文件,Browser=src/client)。
 *
 * Remote 端点走网关 SRC 模式(无生成描述符的开发回退;api/gateway/src/index.ts
 * resolveSrcDescriptor 扫描 ctx.reflect.props 里带 typertRemote 绑定的服务)。
 * Node 24 type-stripping 不解析标准 decorator 语法,故经 Remote() 公开函数面
 * 手工施加装饰器(等价于 @Remote('snapshot') 糖)。
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  DEFAULT_CHIPS_CONFIG, readChipsConfig, saveChipsConfig,
  type ChipsConfig, type ChipsSaveOutcome,
} from './chips-store.ts'
import {
  buildSnapshot, buildSnapshotForIdentity, knowledgeSnapshotForAccount, normalizeSessionId,
  unavailableMemorySnapshot, type BuildSnapshotScope,
} from './snapshot.ts'
import type { EternaPanelSnapshot, KnowledgeSnapshot, MemoryReviewRecordView } from './types.ts'

export const ETERNA_PANEL_SERVICE_ID = 'eternaPanel'
export const SNAPSHOT_ENDPOINT = `${ETERNA_PANEL_SERVICE_ID}/snapshot`
export const REVIEW_ENDPOINT = `${ETERNA_PANEL_SERVICE_ID}/review`
export const CORRECTION_ENDPOINT = `${ETERNA_PANEL_SERVICE_ID}/trackCorrection`

/**
 * 多租户账号路由面服务 id(23 号 M-T2):glue memory-plugin 在 routed 模式
 * provide(账号→Memory/库路径);global 部署也 provide(账号面空、回落全局)。
 * panel 不引依赖,消费侧字面量对齐。
 */
export const ETERNA_MEMORY_ACCOUNTS_SERVICE_ID = 'eterna-memory-accounts'

/**
 * 知识库账号状态面服务 id(2026-11-17 知识库账号分库):glue knowledge-plugin 在
 * routed 模式 provide(accountOfUser + statusForAccount 只读计数);panel 非 admin
 * 视图只经此面读本人分库,不触碰全局库。panel 不引依赖,消费侧字面量对齐。
 */
export const ETERNA_KNOWLEDGE_ACCOUNTS_SERVICE_ID = 'eterna-knowledge-accounts'

/**
 * 面板账号路由面服务 id(2026-11-17):unary SRC 通道 principal 恒 owner
 * (mux 换血只作用流通道),登录身份只在 access 守卫——守卫拦截
 * /api/eternaPanel/snapshot 后经本 provide 面用 cookie 身份组装快照
 * (admin=全局,普通账号=本人记忆/知识库/会话)。面板不引 access 依赖,字面量对齐。
 */
export const ETERNA_PANEL_ACCOUNTS_SERVICE_ID = 'eterna-panel-accounts'

/**
 * Memory 服务的注册 id(glue memory-plugin 经 ctx.provide 注册 '@eterna/memory',
 * 见 packages/memory/src/memory.ts MEMORY_SERVICE_ID;字面量对齐,panel 不引依赖)。
 */
const MEMORY_SERVICE_ID = '@eterna/memory'

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

/** Memory 服务的裁决消费面(结构子集;真实实例由 glue memory-plugin 提供)。 */
interface MemoryServiceLike {
  review(id: number, decision: 'approved' | 'rejected'): ReviewRecordLike | null
  /** T13 指标埋点:画像「纠正此项」留痕(账本 fail-open,不炸纠正动作)。 */
  recordCorrection?(entry: { readonly section: string; readonly keyHint: string }): void
}

/** EntityRecord 的裁决返回投影(结构子集;字段与 memory EntityRecord 对齐)。 */
interface ReviewRecordLike {
  readonly id: number
  readonly subject: string
  readonly key: string
  readonly reviewState: string
  readonly invalidAt: number | null
}

/** Access store 的角色读取面(compaction admin-plugin 同款结构子集)。 */
interface AccessStoreView {
  getUserById(id: number): { role?: string } | undefined
}

/**
 * 多租户账号路由面(23 号 M-T2):glue memory-plugin 在 'eterna-memory-accounts'
 * 提供的账号级原语(结构子集)——principal userId → 账号 → 该账号的 Memory/库路径。
 * global 部署(本地单用户)glue 也 provide 此面(账号面恒空、memory/dbPath 回落全局)。
 */
interface AccountsFaceLike {
  accountOfUser(userId: number): string | undefined
  memoryForAccount(account: string): MemoryServiceLike | undefined
  dbPathForAccount(account: string): string | undefined
}

/** 知识库账号状态面(glue knowledge-plugin 结构子集;字段口径见其 KnowledgeAccountStatus)。 */
interface KnowledgeAccountsFaceLike {
  accountOfUser(userId: number): string | undefined
  statusForAccount(account: string): {
    readonly account: string
    readonly available: boolean
    readonly dbPath: string
    readonly wikiDocCount: number
    readonly proposalCount: number
  } | undefined
}

/** 调用者上下文投影(principal → owner / eterna-user[admin/account])。 */
type CallerContext =
  | { readonly kind: 'owner' }
  | { readonly kind: 'eterna-user'; readonly userId: number; readonly admin: boolean; readonly account: string | undefined }

/** 裁决端点结果(纯 JSON;ok=false 时 code + 中文 message)。 */
export type MemoryReviewResult =
  | { readonly ok: true; readonly record: MemoryReviewRecordView | null }
  | { readonly ok: false; readonly code: 'forbidden' | 'unauthorized' | 'invalid' | 'unavailable'; readonly message: string }

/** 纠正留痕端点结果(纯 JSON;成功无载荷——客户端 fire-and-forget)。 */
export type MemoryCorrectionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'invalid' | 'unavailable'; readonly message: string }

/** 只读快照 + 记忆裁决 Remote 服务(网关 SRC 端点 eternaPanel/*)。 */
export class EternaPanelGateway extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, ETERNA_PANEL_SERVICE_ID)
  }

  /**
   * 登录账号上下文(23 号 M-T2):eterna-user principal → userId → 账号路由面
   * → { account, memory, dbPath }。principal 非 eterna-user(unary owner 旧形态
   * /本地部署)或路由面缺席 → undefined(调用方回落全局 service/路径)。
   */
  private accountContext(): { account: string; memory: MemoryServiceLike; dbPath: string } | undefined {
    const invocation = (this.ctx as { invocation?: { principal?: { kind?: string; userId?: number } } } | undefined)?.invocation
    const principal = invocation?.principal
    if (principal === undefined || principal.kind !== 'eterna-user' || typeof principal.userId !== 'number') return undefined
    const accounts = this.ctx.get(ETERNA_MEMORY_ACCOUNTS_SERVICE_ID) as AccountsFaceLike | undefined
    if (accounts === undefined) return undefined
    const account = accounts.accountOfUser(principal.userId)
    if (account === undefined) return undefined
    const memory = accounts.memoryForAccount(account)
    const dbPath = accounts.dbPathForAccount(account)
    if (memory === undefined || dbPath === undefined) return undefined
    return { account, memory, dbPath }
  }

  /**
   * 调用者上下文(2026-11-17 面板账号隔离):principal → owner(本地/unary 旧形态)
   * 或 eterna-user(userId + 角色 + 账号)。账号解析优先知识库账号面、次记忆账号面
   * (两面同由 glue provide;缺席时 account=undefined,调用方 fail-closed)。
   */
  private callerContext(): CallerContext {
    const invocation = (this.ctx as { invocation?: { principal?: { kind?: string; userId?: number } } } | undefined)?.invocation
    const principal = invocation?.principal
    if (principal === undefined || principal.kind !== 'eterna-user' || typeof principal.userId !== 'number') {
      return { kind: 'owner' }
    }
    const userId = principal.userId
    const knowledgeAccounts = this.ctx.get(ETERNA_KNOWLEDGE_ACCOUNTS_SERVICE_ID) as KnowledgeAccountsFaceLike | undefined
    const memoryAccounts = this.ctx.get(ETERNA_MEMORY_ACCOUNTS_SERVICE_ID) as AccountsFaceLike | undefined
    let account = knowledgeAccounts?.accountOfUser(userId)
    if (account === undefined) account = memoryAccounts?.accountOfUser(userId)
    return { kind: 'eterna-user', userId, admin: this.adminAllowed(), account }
  }

  /**
   * 非 admin 调用者的知识库快照(账号分库计数;实现收拢在 snapshot.ts,
   * 守卫身份通道 buildSnapshotForIdentity 复用同一函数)。
   */
  private knowledgeForAccount(account: string | undefined): KnowledgeSnapshot {
    return knowledgeSnapshotForAccount(this.ctx, account)
  }

  /**
   * 非 admin 调用者的会话归属过滤(access 归属账本 sessionsOfOwner 集)。账本面
   * 缺席 → 空集(fail-closed:宁可不显示,不显示他人会话)。
   */
  private ownedSessionFilter(userId: number): (sessionDirName: string) => boolean {
    const reflect = this.ctx as unknown as { reflect?: { get(name: string, strict?: boolean): unknown } }
    const store = reflect.reflect?.get('eternaAccessStore', false) as { sessionsOfOwner(id: number): string[] } | undefined
    let owned = new Set<string>()
    try {
      owned = new Set((store?.sessionsOfOwner(userId) ?? []).map(normalizeSessionId))
    } catch {
      owned = new Set()
    }
    return (sessionDirName: string): boolean => owned.has(normalizeSessionId(sessionDirName))
  }

  /**
   * 面板快照:见 types.ts EternaPanelSnapshot(纯 JSON,无参数端点)。
   * 账号隔离(2026-11-17):eterna-user 普通账号 → 记忆=本人库(accountContext)、
   * 知识库=本人分库(知识库账号面)、会话历史=仅本人会话(access 归属账本);
   * admin 与 owner/本地流 → 全局视角(现行为不变)。
   */
  snapshot(): Promise<EternaPanelSnapshot> {
    const accountCtx = this.accountContext()
    const caller = this.callerContext()
    // 普通账号(非 admin eterna-user):记忆=本人库(账号库不可解析 → fail-closed
    // 空态,不回落全局库)、知识库=本人分库、会话历史=仅本人会话;admin/owner 全局。
    const scope: BuildSnapshotScope = caller.kind === 'eterna-user' && !caller.admin
      ? {
        ...(accountCtx === undefined ? { memory: unavailableMemorySnapshot() } : {}),
        knowledge: this.knowledgeForAccount(caller.account),
        sessionFilter: this.ownedSessionFilter(caller.userId),
      }
      : {}
    return Promise.resolve(buildSnapshot(this.ctx, undefined, undefined, accountCtx?.dbPath, scope))
  }

  /**
   * 记忆裁决(T9 审批闭环):payload { id, decision } → Memory.review。
   * - 鉴权(compaction admin-plugin 同款口径):SRC 端点走 unary 持 owner
   *   Peer——mux 换血的 eterna-user principal 只存在于流通道,unary 能达本端点
   *   必已过 access 守卫;eterna-user principal(流通道)则查 access store
   *   必须是 admin。审批决定 Agent 记什么,与压缩配置同级的租户敏感面。
   * - 服务缺席(eterna-memory 停用/未挂)= unavailable;行不存在(已处理/
   *   越界 id)返回 record: null——裁决语义(幂等,不猜行状态)。
   */
  review(payload: unknown): Promise<MemoryReviewResult> {
    return Promise.resolve(this.reviewSync(payload))
  }

  /**
   * 记忆裁决(M-T2 登录账号路由版):eterna-user principal → 本人账号库的
   * Memory.review(谁的会话谁审,越权在解析面即不可达);旧形态(unary owner
   * /本地单用户)回落全局 service。unavailable = 路由面与全局服务双缺席。
   */
  reviewForAccount(payload: unknown): Promise<MemoryReviewResult> {
    const accountCtx = this.accountContext()
    if (accountCtx === undefined) return Promise.resolve(this.reviewSync(payload))
    if (typeof payload !== 'object' || payload === null) {
      return Promise.resolve({ ok: false, code: 'invalid', message: '请求体必须是对象' })
    }
    const input = payload as Record<string, unknown>
    const id = input.id
    const decision = input.decision
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) {
      return Promise.resolve({ ok: false, code: 'invalid', message: 'id 必须是非负安全整数' })
    }
    if (decision !== 'approved' && decision !== 'rejected') {
      return Promise.resolve({ ok: false, code: 'invalid', message: "decision 只允许 'approved' | 'rejected'" })
    }
    try {
      const record = accountCtx.memory.review(id, decision)
      return Promise.resolve({
        ok: true,
        record: record === null ? null : {
          id: record.id,
          subject: record.subject,
          key: record.key,
          reviewState: record.reviewState,
          invalidAt: record.invalidAt,
        },
      })
    } catch (error) {
      return Promise.resolve({
        ok: false,
        code: 'unavailable',
        message: `裁决执行失败:${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  /**
   * 画像纠正留痕(T13 纠正率分子):payload { section, keyHint? } →
   * Memory.recordCorrection(审计一行,账本 fail-open)。用户级动作(纠正自己的
   * 画像),非 admin 面。
   * 账号路由(2026-11-17):eterna-user → 本人账号库(accountContext;解析失败
   * fail-closed 拒绝,**绝不落全局库**);owner/unary 旧形态 → 全局服务(现行为)。
   * 客户端 fire-and-forget,埋点失败不打断纠正预填主流程。
   */
  trackCorrection(payload: unknown): Promise<MemoryCorrectionResult> {
    if (typeof payload !== 'object' || payload === null) {
      return Promise.resolve({ ok: false, code: 'invalid', message: '请求体必须是对象' })
    }
    const input = payload as Record<string, unknown>
    const { section, keyHint } = input
    if (typeof section !== 'string' || section.trim().length === 0 || section.trim().length > 64) {
      return Promise.resolve({ ok: false, code: 'invalid', message: 'section 必填(非空,≤64 字符)' })
    }
    if (keyHint !== undefined && typeof keyHint !== 'string') {
      return Promise.resolve({ ok: false, code: 'invalid', message: 'keyHint 只允许字符串' })
    }
    const caller = this.callerContext()
    const target: MemoryServiceLike | undefined = caller.kind === 'eterna-user'
      ? this.accountContext()?.memory
      : this.ctx.get(MEMORY_SERVICE_ID) as MemoryServiceLike | undefined
    if (caller.kind === 'eterna-user' && target === undefined) {
      return Promise.resolve({
        ok: false,
        code: 'unavailable',
        message: '账号记忆库不可用(多租户 fail-closed):本次纠正留痕未记录',
      })
    }
    if (target?.recordCorrection === undefined) {
      return Promise.resolve({ ok: false, code: 'unavailable', message: '记忆服务未挂载(eterna-memory 插件未启用)' })
    }
    try {
      target.recordCorrection({ section: section.trim(), keyHint: typeof keyHint === 'string' ? keyHint.slice(0, 128) : '' })
      return Promise.resolve({ ok: true })
    } catch (error) {
      return Promise.resolve({
        ok: false,
        code: 'unavailable',
        message: `留痕失败:${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  /** 同步裁决体(测试可绕 Promise 直接消费;私有 TS 方法,# 品牌检查会挡 Object.create 假体)。 */
  private reviewSync(payload: unknown): MemoryReviewResult {
    if (!this.adminAllowed()) {
      return { ok: false, code: 'forbidden', message: '需要管理员权限' }
    }
    if (typeof payload !== 'object' || payload === null) {
      return { ok: false, code: 'invalid', message: '请求体必须是对象' }
    }
    const input = payload as Record<string, unknown>
    const { id, decision } = input
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) {
      return { ok: false, code: 'invalid', message: 'id 必须是非负安全整数' }
    }
    if (decision !== 'approved' && decision !== 'rejected') {
      return { ok: false, code: 'invalid', message: "decision 只允许 'approved' | 'rejected'" }
    }
    const memory = this.ctx.get(MEMORY_SERVICE_ID) as MemoryServiceLike | undefined
    if (memory?.review === undefined) {
      return { ok: false, code: 'unavailable', message: '记忆服务未挂载(eterna-memory 插件未启用)' }
    }
    try {
      const record = memory.review(id, decision)
      return {
        ok: true,
        record: record === null ? null : {
          id: record.id,
          subject: record.subject,
          key: record.key,
          reviewState: record.reviewState,
          invalidAt: record.invalidAt,
        },
      }
    } catch (error) {
      return {
        ok: false,
        code: 'unavailable',
        message: `裁决执行失败:${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /** 管理面放行判定(compaction admin-plugin adminAllowed 同款;eterna-user 流通道须 admin)。 */
  private adminAllowed(): boolean {
    const invocation = (this.ctx as { invocation?: { principal?: { kind?: string; userId?: number } } } | undefined)?.invocation
    const principal = invocation?.principal
    if (principal === undefined || principal.kind !== 'eterna-user' || typeof principal.userId !== 'number') return true
    const reflect = this.ctx as unknown as { reflect?: { get(name: string, strict?: boolean): unknown } }
    const store = reflect.reflect?.get('eternaAccessStore', false) as AccessStoreView | undefined
    return store?.getUserById(principal.userId)?.role === 'admin'
  }

  /**
   * 流程启动条配置·读(2026-11-20,每用户各自一套):守卫通道专用——unary 通道
   * principal 恒 owner,身份只在 access 守卫(cookie),守卫解析出本人 root 后
   * 显式点名调用;本方法不做任何 principal/租户推导。**不加 Remote 标记**——
   * SRC 直调无后门,守卫是唯一通道(remoteMethods 维持 4,同「面板写端点直调
   * 硬化」取向);缺文件/损坏由 readChipsConfig fail-closed 回默认空配置。
   */
  chipsForUser(face: { readonly account: string; readonly root: string }): ChipsConfig {
    if (typeof face.root !== 'string' || face.root === '') return DEFAULT_CHIPS_CONFIG
    return readChipsConfig(face.root)
  }

  /**
   * 流程启动条配置·写(守卫通道专用,同 chipsForUser 口径):root=守卫解析的
   * 本人用户根,客户端只传全量条目与 revision(CAS);越权在守卫路径解析面即
   * 不可能(只可能写本人根)。root 不可解析 → unavailable 拒写(绝不落全局)。
   */
  saveChipsForUser(face: { readonly account: string; readonly root: string }, input: unknown): ChipsSaveOutcome {
    if (typeof face.root !== 'string' || face.root === '') {
      return { ok: false, code: 'unavailable', message: '账号工作区根不可解析,配置未保存' }
    }
    return saveChipsConfig(face.root, input)
  }
}

applyRemoteMarker(EternaPanelGateway.prototype, 'snapshot', 'snapshot')
applyRemoteMarker(EternaPanelGateway.prototype, 'review', 'review')
applyRemoteMarker(EternaPanelGateway.prototype, 'reviewForAccount', 'reviewForAccount')
applyRemoteMarker(EternaPanelGateway.prototype, 'trackCorrection', 'trackCorrection')

export type { EternaPanelSnapshot, MemoryReviewRecordView } from './types.ts'
export { buildSnapshot } from './snapshot.ts'
export { GUIDE_PROMPTS } from './prompts.ts'
export type { GuidePrompt } from './prompts.ts'

/** DSH bundle loader 取 default export 插件实例(对齐 glue 插件形态)。 */
export default {
  name: 'eterna-panel',
  apply(ctx: Context): () => void {
    const gateway = new EternaPanelGateway(ctx)
    // 账号路由面(2026-11-17):access 守卫拦截 /api/eternaPanel/snapshot 后按
    // cookie 身份组装——admin 全局,普通账号本人记忆/知识库/会话。
    const disposeProvide = (ctx as unknown as {
      provide?: (name: string, value: unknown) => () => void
    }).provide?.(ETERNA_PANEL_ACCOUNTS_SERVICE_ID, {
      snapshotForUser: (identity: {
        readonly account: string
        readonly admin: boolean
        readonly ownedSessionIds: readonly string[]
      }): EternaPanelSnapshot => buildSnapshotForIdentity(ctx, identity),
    })
    return () => {
      disposeProvide?.()
      // Service 随 owning fiber 自动注销(cordis Service 语义);引用置空防误用。
      void gateway
    }
  },
}
