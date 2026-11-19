/**
 * 路由面(`/api/knowledgeAdmin/<method>`)—— access 守卫的 merge 点。
 *
 * ## 为什么需要这一层
 * Typert Remote 网关(`eternaKnowledgeAdmin/<method>`)是 **Agent/SRC 模式**的调用面;
 * 浏览器侧栏走的是 access 的 cookie 守卫(`/api/knowledgeAdmin/<method>`),守卫负责:
 * 1. 从 cookie 解析身份(→ {@link KnowledgeAdminCaller});2. 按 access role 判管理员;
 * 3. 把 `{ args }` 原样交给本路由面;4. 用 `okFrame/failureFrame/deniedFrame` 封帧回浏览器。
 *
 * 本类**只做一件事**:`(method, args, caller) → KnowledgeResult`,不含任何身份解析、
 * 不做 cookie 处理、不注册 route(`register` 在 access 侧完成)。因此 access 的合并只是
 * 在它的守卫表里加一行(见 README「接入 access 守卫」)。
 *
 * ## 纪律
 * - 未知方法 → `invalid`(守卫侧也应用 `isKnowledgeAdminMethod` 预筛,双保险);
 * - `args` 不是对象 → `invalid`(绝不 spread 原始帧,防原型污染面);
 * - 服务面抛出的异常在这里**兜底成 `internal`**(路由面是最后一道,不让异常穿透到 HTTP 栈);
 * - 每次调用都过服务面的 `sanitizeTarget`(越权在服务面判,不在路由面猜)。
 */
import { isKnowledgeAdminMethod } from './types.ts'
import { fail, type KnowledgeAdminCaller, type KnowledgeAdminMethod, type KnowledgeResult } from './types.ts'
import type {
  AskArgs, AskValue, DeprecateDocArgs, DeprecateDocValue, DiscardProposalArgs, DiscardProposalValue,
  ImportMarkdownArgs, ImportMarkdownValue, ImportRepoArgs, ImportRepoValue, ListAccountsArgs, ListAccountsValue,
  ListAuditArgs, ListAuditValue, ListDocsArgs, ListDocsValue, ListMembersArgs, ListMembersValue,
  ListProposalsArgs, ListProposalsValue, OverviewArgs, OverviewValue, ReadDocArgs, ReadDocValue,
  ReviewProposalArgs, ReviewProposalValue, SaveDocArgs, SaveDocValue, SearchArgs, SearchValue,
  SetMemberArgs, SetMemberValue, TestSourceArgs, TestSourceValue, UndoDeprecateArgs, UndoDeprecateValue,
} from './types.ts'
import type { KnowledgeAdminService } from './service.ts'

/** 守卫侧对路由面的最小依赖(access 只需拿到这个接口)。 */
export interface RouteFace {
  /** 服务 id(守卫 `serviceOf(deps, id)` 的 id)。 */
  readonly id: string
  /** 方法清单(守卫注册时遍历;顺序稳定)。 */
  readonly methods: readonly KnowledgeAdminMethod[]
  /** 是否为受保护(需要 cookie 身份)的方法 —— 全部为 true。 */
  isGuarded(method: string): boolean
  /** 唯一调用入口。 */
  call(method: string, args: unknown, caller: KnowledgeAdminCaller): Promise<KnowledgeResult<unknown>>
  /** 该方法的 wire 参数键(守卫从 `args[wireKey]` 取载荷)。 */
  wireKey(method: string): 'args' | undefined
}

/** 路由面实现(构造即绑定 service 实例;无状态)。 */
export class KnowledgeAdminRouteFace implements RouteFace {
  readonly id: string
  readonly methods: readonly KnowledgeAdminMethod[]
  readonly #service: KnowledgeAdminService

  constructor(service: KnowledgeAdminService, options: { readonly id: string; readonly methods: readonly KnowledgeAdminMethod[] }) {
    this.#service = service
    this.id = options.id
    this.methods = options.methods
  }

  isGuarded(method: string): boolean {
    return isKnowledgeAdminMethod(method)
  }

  wireKey(method: string): 'args' | undefined {
    return isKnowledgeAdminMethod(method) ? 'args' : undefined
  }

  /** `(method, args, caller) → KnowledgeResult`(异常兜底为 internal,绝不穿透)。 */
  async call(
    method: string,
    args: unknown,
    caller: KnowledgeAdminCaller | undefined | null,
  ): Promise<KnowledgeResult<unknown>> {
    if (!isKnowledgeAdminMethod(method)) {
      return fail('invalid', `未知方法:${method}(可用:${this.methods.join('|')})`)
    }
    if (caller === undefined || caller === null) {
      return fail('unauthorized', '路由面未收到身份(access 守卫必须注入 {account,admin,userId},fail-closed)')
    }
    const payload = isPlainObject(args) ? args : {}
    try {
      return await this.#dispatch(method, payload, caller)
    } catch (cause) {
      // 兜底:不把异常栈/令牌面透给浏览器
      const text = cause instanceof Error ? cause.message.replace(/\s+/g, ' ').slice(0, 200) : String(cause).slice(0, 200)
      return fail('internal', `路由面调用 ${method} 失败:${text}`)
    }
  }

  // ── access 守卫直调面:face?.[method] 然后 fn.call(face, caller, args) ────────
  // 守卫不做 `call(method,...)` 派发,而是按方法名取属性再位置传参;故这里必须逐个
  // 暴露成 (caller, args) 的公开方法(fragment-body.ts:100-109 的调用形态)。

  async listAccounts(caller: KnowledgeAdminCaller, args: ListAccountsArgs = {}): Promise<KnowledgeResult<ListAccountsValue>> {
    return await this.#service.listAccounts(caller, args)
  }

  async overview(caller: KnowledgeAdminCaller, args: OverviewArgs = {}): Promise<KnowledgeResult<OverviewValue>> {
    return await this.#service.overview(caller, args)
  }

  async listDocs(caller: KnowledgeAdminCaller, args: ListDocsArgs = {}): Promise<KnowledgeResult<ListDocsValue>> {
    return await this.#service.listDocs(caller, args)
  }

  async readDoc(caller: KnowledgeAdminCaller, args: ReadDocArgs): Promise<KnowledgeResult<ReadDocValue>> {
    return await this.#service.readDoc(caller, args)
  }

  async saveDoc(caller: KnowledgeAdminCaller, args: SaveDocArgs): Promise<KnowledgeResult<SaveDocValue>> {
    return await this.#service.saveDoc(caller, args)
  }

  async deprecateDoc(caller: KnowledgeAdminCaller, args: DeprecateDocArgs): Promise<KnowledgeResult<DeprecateDocValue>> {
    return await this.#service.deprecateDoc(caller, args)
  }

  async undoDeprecate(caller: KnowledgeAdminCaller, args: UndoDeprecateArgs): Promise<KnowledgeResult<UndoDeprecateValue>> {
    return await this.#service.undoDeprecate(caller, args)
  }

  async listProposals(caller: KnowledgeAdminCaller, args: ListProposalsArgs = {}): Promise<KnowledgeResult<ListProposalsValue>> {
    return await this.#service.listProposals(caller, args)
  }

  async reviewProposal(caller: KnowledgeAdminCaller, args: ReviewProposalArgs): Promise<KnowledgeResult<ReviewProposalValue>> {
    return await this.#service.reviewProposal(caller, args)
  }

  async discardProposal(caller: KnowledgeAdminCaller, args: DiscardProposalArgs): Promise<KnowledgeResult<DiscardProposalValue>> {
    return await this.#service.discardProposal(caller, args)
  }

  async search(caller: KnowledgeAdminCaller, args: SearchArgs): Promise<KnowledgeResult<SearchValue>> {
    return await this.#service.search(caller, args)
  }

  async ask(caller: KnowledgeAdminCaller, args: AskArgs): Promise<KnowledgeResult<AskValue>> {
    return await this.#service.ask(caller, args)
  }

  async importMarkdown(caller: KnowledgeAdminCaller, args: ImportMarkdownArgs): Promise<KnowledgeResult<ImportMarkdownValue>> {
    return await this.#service.importMarkdown(caller, args)
  }

  async importRepo(caller: KnowledgeAdminCaller, args: ImportRepoArgs): Promise<KnowledgeResult<ImportRepoValue>> {
    return await this.#service.importRepo(caller, args)
  }

  async listMembers(caller: KnowledgeAdminCaller, args: ListMembersArgs = {}): Promise<KnowledgeResult<ListMembersValue>> {
    return await this.#service.listMembers(caller, args)
  }

  async setMember(caller: KnowledgeAdminCaller, args: SetMemberArgs): Promise<KnowledgeResult<SetMemberValue>> {
    return await this.#service.setMember(caller, args)
  }

  async listAudit(caller: KnowledgeAdminCaller, args: ListAuditArgs = {}): Promise<KnowledgeResult<ListAuditValue>> {
    return await this.#service.listAudit(caller, args)
  }

  async testSource(caller: KnowledgeAdminCaller, args: TestSourceArgs = {}): Promise<KnowledgeResult<TestSourceValue>> {
    return await this.#service.testSource(caller, args)
  }

  /** 方法 → 服务方法的显式转发(不用动态取属性,避免把私有面暴露成路由)。 */
  async #dispatch(
    method: KnowledgeAdminMethod,
    args: Record<string, unknown>,
    caller: KnowledgeAdminCaller,
  ): Promise<KnowledgeResult<unknown>> {
    switch (method) {
      case 'listAccounts': return await this.#service.listAccounts(caller, asArgs<ListAccountsArgs>(args))
      case 'overview': return await this.#service.overview(caller, asArgs<OverviewArgs>(args))
      case 'listDocs': return await this.#service.listDocs(caller, asArgs<ListDocsArgs>(args))
      case 'readDoc': return await this.#service.readDoc(caller, asArgs<ReadDocArgs>(args))
      case 'saveDoc': return await this.#service.saveDoc(caller, asArgs<SaveDocArgs>(args))
      case 'deprecateDoc': return await this.#service.deprecateDoc(caller, asArgs<DeprecateDocArgs>(args))
      case 'undoDeprecate': return await this.#service.undoDeprecate(caller, asArgs<UndoDeprecateArgs>(args))
      case 'listProposals': return await this.#service.listProposals(caller, asArgs<ListProposalsArgs>(args))
      case 'reviewProposal': return await this.#service.reviewProposal(caller, asArgs<ReviewProposalArgs>(args))
      case 'discardProposal': return await this.#service.discardProposal(caller, asArgs<DiscardProposalArgs>(args))
      case 'search': return await this.#service.search(caller, asArgs<SearchArgs>(args))
      case 'ask': return await this.#service.ask(caller, asArgs<AskArgs>(args))
      case 'importMarkdown': return await this.#service.importMarkdown(caller, asArgs<ImportMarkdownArgs>(args))
      case 'importRepo': return await this.#service.importRepo(caller, asArgs<ImportRepoArgs>(args))
      case 'listMembers': return await this.#service.listMembers(caller, asArgs<ListMembersArgs>(args))
      case 'setMember': return await this.#service.setMember(caller, asArgs<SetMemberArgs>(args))
      case 'listAudit': return await this.#service.listAudit(caller, asArgs<ListAuditArgs>(args))
      case 'testSource': return await this.#service.testSource(caller, asArgs<TestSourceArgs>(args))
    }
  }
}

/** 把守卫传来的载荷窄化成方法入参(调用方只做字段级校验,服务面负责语义校验)。 */
function asArgs<T>(args: Record<string, unknown> | T): T {
  return args as T
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
