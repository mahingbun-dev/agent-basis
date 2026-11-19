/**
 * @eterna/knowledge-admin Host 半边(双面插件:Host=本文件,Browser=src/client)。
 *
 * ## 一个插件,三张脸
 * 1. **Remote 网关**(`EternaKnowledgeAdminGateway extends TypertRemoteService`):
 *    `eternaKnowledgeAdmin/<method>` × 18(Agent/SRC 模式调用面)。
 *    端点清单直接由 `KNOWLEDGE_ADMIN_METHOD_SPECS` 派生 —— 加方法只改 types.ts。
 * 2. **路由面**(`KnowledgeAdminRouteFace`):`ctx.provide('eterna-knowledge-admin', face)`,
 *    access 守卫按 `/api/knowledgeAdmin/<method>` 取它(合并片段见 README)。
 *    与 (1) 共享**同一个** service 实例(状态一致:同一批提案/同一批 undo 句柄)。
 * 3. **工具**(5 个):库层 `knowledge_search/read/status/propose`(经 `tools-base.ts` 门面
 *    复用同一池)+ `knowledge_admin`(action 见 tools.ts)。调用者按会话路由
 *    (`routing.ts`:admin → 全局 `*`,普通账号 → 本人,解析失败 fail-closed)。
 *
 * 另 provide `'eterna-knowledge-accounts'`(panel 只读计数面),与 glue 时代的契约一致。
 *
 * ## 生命期(Cordis 纪律)
 * `apply(ctx)` 里的一切都是 effect:service 构造、provide、工具注册。返回的 dispose 逆序关:
 * 工具注销 → provide 注销 → service.dispose(池关库 + 权限库关连接)。
 *
 * ## 依赖取用(全部惰性,缺席即诚实降级)
 * - `llm` + `agentDefaultModel`:ask 的模型调用;缺席 → `{ok:false,code:'unavailable'}`;
 * - `credentials`:DeepWiki bearerRef 解析(`resolve()`,**绝不读凭据文件**);缺席 → 未配置;
 * - `audit`:审计 fire-and-forget;缺席 → 只写本地 jsonl。
 *
 * Node 24 type-stripping 不解析标准装饰器语法,故用 `Remote()` 公开函数面手工施加
 * (与 @eterna/panel 的 applyRemoteMarker 完全同款)。
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { KnowledgeAdminPluginConfig } from './config.ts'
import { KnowledgeAdminRouteFace } from './route-face.ts'
import { KnowledgeAdminService } from './service.ts'
import { buildAdminKnowledgeTools } from './tools-base.ts'
import { buildKnowledgeAdminTool, toDshToolDefinition } from './tools.ts'
import {
  ETERNA_KNOWLEDGE_ACCOUNTS_SERVICE_ID,
  ETERNA_KNOWLEDGE_ADMIN_PLUGIN_NAME, ETERNA_KNOWLEDGE_ADMIN_ROUTE_FACE_ID,
  ETERNA_KNOWLEDGE_ADMIN_SERVICE_ID, KNOWLEDGE_ADMIN_METHODS,
  KNOWLEDGE_ADMIN_METHOD_SPECS, LOCAL_CALLER,
} from './types.ts'
import type {
  AskArgs, AskValue, DeprecateDocArgs, DeprecateDocValue, DiscardProposalArgs, DiscardProposalValue,
  ImportMarkdownArgs, ImportMarkdownValue, ImportRepoArgs, ImportRepoValue, KnowledgeAdminCaller,
  KnowledgeResult, ListAccountsArgs, ListAccountsValue, ListAuditArgs, ListAuditValue, ListDocsArgs,
  ListDocsValue, ListMembersArgs, ListMembersValue, ListProposalsArgs, ListProposalsValue, OverviewArgs,
  OverviewValue, ReadDocArgs, ReadDocValue, ReviewProposalArgs, ReviewProposalValue, SaveDocArgs,
  SaveDocValue, SearchArgs, SearchValue, SetMemberArgs, SetMemberValue, TestSourceArgs, TestSourceValue,
  UndoDeprecateArgs, UndoDeprecateValue,
} from './types.ts'

/** 手工施加 @Remote 装饰器(panel 同款:初始化器在接收者原型上落 typertRemote marker)。 */
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

/**
 * Typert Remote 网关(SRC 模式的 18 个端点)。
 *
 * 身份语义:**网关通道的调用者恒为本地单用户**(`human:false`) —— 浏览器不使用它
 * (浏览器走 access 守卫 → 路由面);网关通道给 Agent/SRC 场景,故按 {@link LOCAL_CALLER}
 * (admin=true、全局库、非真人通道)。写入在服务面强制 pending;审批一律 forbidden。
 */
export class EternaKnowledgeAdminGateway extends TypertRemoteService {
  readonly #service: KnowledgeAdminService

  constructor(ctx: Context, config: KnowledgeAdminPluginConfig = {}) {
    super(ctx, ETERNA_KNOWLEDGE_ADMIN_SERVICE_ID)
    this.#service = new KnowledgeAdminService({
      config,
      get: (name: string) => (ctx as unknown as { get(name: string): unknown }).get(name),
    })
  }

  /** 路由面(供 plugin 的 ctx.provide 共用同一 service 实例)。 */
  get face(): KnowledgeAdminRouteFace {
    return new KnowledgeAdminRouteFace(this.#service, {
      id: ETERNA_KNOWLEDGE_ADMIN_SERVICE_ID,
      methods: KNOWLEDGE_ADMIN_METHODS,
    })
  }

  /** 服务实例(工具注册与 dispose 需要)。 */
  get service(): KnowledgeAdminService {
    return this.#service
  }

  // ── 18 个 Remote 方法(逐个转发 service;gateway caller = LOCAL_CALLER) ──────────

  async listAccounts(args: ListAccountsArgs = {}): Promise<KnowledgeResult<ListAccountsValue>> {
    return await this.#service.listAccounts(LOCAL_CALLER, args)
  }

  async overview(args: OverviewArgs = {}): Promise<KnowledgeResult<OverviewValue>> {
    return await this.#service.overview(this.#caller(args.account), args)
  }

  async listDocs(args: ListDocsArgs = {}): Promise<KnowledgeResult<ListDocsValue>> {
    return await this.#service.listDocs(this.#caller(args.account), args)
  }

  async readDoc(args: ReadDocArgs): Promise<KnowledgeResult<ReadDocValue>> {
    return await this.#service.readDoc(this.#caller(args.account), args)
  }

  async saveDoc(args: SaveDocArgs): Promise<KnowledgeResult<SaveDocValue>> {
    return await this.#service.saveDoc(this.#caller(args.account), args)
  }

  async deprecateDoc(args: DeprecateDocArgs): Promise<KnowledgeResult<DeprecateDocValue>> {
    return await this.#service.deprecateDoc(this.#caller(args.account), args)
  }

  async undoDeprecate(args: UndoDeprecateArgs): Promise<KnowledgeResult<UndoDeprecateValue>> {
    return await this.#service.undoDeprecate(this.#caller(args.account), args)
  }

  async listProposals(args: ListProposalsArgs = {}): Promise<KnowledgeResult<ListProposalsValue>> {
    return await this.#service.listProposals(this.#caller(args.account), args)
  }

  async reviewProposal(args: ReviewProposalArgs): Promise<KnowledgeResult<ReviewProposalValue>> {
    return await this.#service.reviewProposal(this.#caller(args.account), args)
  }

  async discardProposal(args: DiscardProposalArgs): Promise<KnowledgeResult<DiscardProposalValue>> {
    return await this.#service.discardProposal(this.#caller(args.account), args)
  }

  async search(args: SearchArgs): Promise<KnowledgeResult<SearchValue>> {
    return await this.#service.search(this.#caller(args.account), args)
  }

  async ask(args: AskArgs): Promise<KnowledgeResult<AskValue>> {
    return await this.#service.ask(this.#caller(args.account), args)
  }

  async importMarkdown(args: ImportMarkdownArgs): Promise<KnowledgeResult<ImportMarkdownValue>> {
    return await this.#service.importMarkdown(this.#caller(args.account), args)
  }

  async importRepo(args: ImportRepoArgs): Promise<KnowledgeResult<ImportRepoValue>> {
    return await this.#service.importRepo(this.#caller(args.account), args)
  }

  async listMembers(args: ListMembersArgs = {}): Promise<KnowledgeResult<ListMembersValue>> {
    return await this.#service.listMembers(this.#caller(args.account), args)
  }

  async setMember(args: SetMemberArgs): Promise<KnowledgeResult<SetMemberValue>> {
    return await this.#service.setMember(this.#caller(args.account), args)
  }

  async listAudit(args: ListAuditArgs = {}): Promise<KnowledgeResult<ListAuditValue>> {
    return await this.#service.listAudit(this.#caller(args.account), args)
  }

  async testSource(args: TestSourceArgs = {}): Promise<KnowledgeResult<TestSourceValue>> {
    return await this.#service.testSource(LOCAL_CALLER, args)
  }

  /**
   * 网关通道的调用者投影(恒本地单用户、非真人)。`args.account` 由服务面 `#sanitize`
   * 按 admin 语义处理(空 → 全局 `*`);这里不再自行收窄,避免与路由面口径漂移。
   */
  #caller(_account: string | undefined): KnowledgeAdminCaller {
    return LOCAL_CALLER
  }
}

// 网关 18 端点 marker(SRC 模式描述符由此派生;端点名 = eternaKnowledgeAdmin/<method>)
for (const spec of KNOWLEDGE_ADMIN_METHOD_SPECS) {
  applyRemoteMarker(EternaKnowledgeAdminGateway.prototype, spec.method, spec.method)
}

/** 每次 apply 的 dispose 逆序关(幂等)。 */
function disposeAll(disposers: readonly (() => void)[]): () => void {
  let done = false
  return () => {
    if (done) return
    done = true
    for (let index = disposers.length - 1; index >= 0; index -= 1) {
      try {
        disposers[index]?.()
      } catch {
        // 配逆失败不阻断其余配逆(逐个兜底)
      }
    }
  }
}

/** DSH bundle loader 取 default export 插件实例(对齐 @eterna/panel 形态)。 */
export default {
  name: ETERNA_KNOWLEDGE_ADMIN_PLUGIN_NAME,
  // cordis 服务属性(ctx.tools)必须显式 inject 才可访问,否则激活即抛
  // "cannot get property "tools" without inject"(0.1.28 生产实证)。
  // 只声明 tools:provide/get 是 Context 基座属性;tools 缺席时按防御式判空降级。
  inject: ['tools'],
  apply(ctx: Context, config: KnowledgeAdminPluginConfig = {}): () => void {
    const gateway = new EternaKnowledgeAdminGateway(ctx, config)
    const service = gateway.service
    const disposers: Array<() => void> = [() => { service.dispose() }]

    // 1) 路由面:access 守卫按 ROUTE_FACE_ID 取它(`deps.reflect.get('eterna-knowledge-admin', false)`)。
    //    该键与网关的 Typert 服务键(ETERNA_KNOWLEDGE_ADMIN_SERVICE_ID)必须不同 —— 网关
    //    构造时已注册了后者,复用同键会触发 "service ... has been registered" 激活失败。
    const face = gateway.face
    const provide = (ctx as unknown as { provide?: (name: string, value: unknown) => () => void }).provide
    const disposeProvide = provide?.(ETERNA_KNOWLEDGE_ADMIN_ROUTE_FACE_ID, face)
    if (typeof disposeProvide === 'function') disposers.push(disposeProvide)

    // 2) 账号知识只读面(panel 消费;契约与 glue 时代一致:accountOfUser + statusForAccount)
    const disposeAccounts = provide?.(ETERNA_KNOWLEDGE_ACCOUNTS_SERVICE_ID, service.accounts)
    if (typeof disposeAccounts === 'function') disposers.push(disposeAccounts)

    // 3) Agent 工具:库层四工具(共享同一 pool/门禁,经 routing 解析会话身份)+ knowledge_admin
    const tools = (ctx as unknown as {
      tools?: { register?: (definition: unknown) => () => void }
    }).tools
    if (typeof tools?.register === 'function') {
      const definitions = [
        ...buildAdminKnowledgeTools(service, service.router),
        toDshToolDefinition(buildKnowledgeAdminTool(service, exec => service.router.resolveExec(exec))),
      ]
      for (const definition of definitions) {
        try {
          const disposeTool = tools.register(definition)
          if (typeof disposeTool === 'function') disposers.push(disposeTool)
        } catch (cause) {
          // 单个工具注册失败不拖垮其余工具与另外两面(诚实告警,之后可重试)
          ctx.logger('knowledge-admin').warn(`工具注册失败(${String((definition as { name?: unknown }).name)}):${String(cause)}`)
        }
      }
    } else {
      ctx.logger('knowledge-admin').warn('ctx.tools 缺席:知识底座工具未注册(路由面与网关不受影响)')
    }

    return disposeAll(disposers)
  },
}

// ── 导出面(插件包对外符号;client 半边只消费 types.ts) ──────────────────────

export { KnowledgeAdminService } from './service.ts'
export type { StatusBackendsValue } from './service.ts'
export { KnowledgeAdminRouteFace } from './route-face.ts'
export type { RouteFace } from './route-face.ts'
export { buildKnowledgeAdminTool, toDshToolDefinition, TOOL_ACTIONS } from './tools.ts'
export type { KnowledgeAdminToolSpec, ToolAction } from './tools.ts'
export { buildAdminKnowledgeTools, createAdminKnowledgeFacade } from './tools-base.ts'
export { createAccessDirectory, resolveAccessDbPath } from './access-db.ts'
export type { AccessDirectory, AccessUser } from './access-db.ts'
export { createKnowledgeCallerRouter, GLOBAL_TOOL_CALLER, sessionIdOf } from './routing.ts'
export type { KnowledgeCallerRouter, KnowledgeRoutingMode } from './routing.ts'
export { createKnowledgeAccountsFace } from './accounts-face.ts'
export type { KnowledgeAccountStatus, KnowledgeAccountsFace } from './accounts-face.ts'
export { resolveAdminConfig } from './config.ts'
export type { KnowledgeAdminPluginConfig, DeepWikiConfig } from './config.ts'
export { DeepWikiBackend } from './deepwiki.ts'
export { KnowledgePermissionStore } from './access-store.ts'
export { KnowledgeAuditLog } from './audit-log.ts'
export * from './types.ts'
export { fail, ok } from './types.ts'
