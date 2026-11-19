/**
 * `KnowledgeAdminService` —— 管理面唯一业务实体(Remote 网关 + 路由面 pin 共享同一实例)。
 *
 * ## 职责边界(融合后的单宿主)
 * - **唯一知识底座**。检索/读取/提案/发布/废弃全部消费其 `WikiLocalBackend`
 *   (`propose → reviewProposal → deprecate` 三件套);本包持有**唯一一个**
 *   `BackendPool`(按绝对路径 keyed),Agent 四工具经薄门面复用同一 pool,
 *   不再有 glue 的第二套 service/router/连接。
 * - **写入门禁**:只有 access 守卫铸出的真人 caller(`human:true`)可审批/直接发布;
 *   Agent 工具与 Typert 网关(`human:false`)写入一律落 pending。
 * - **身份只在路由面 / 工具 resolver**:service 拿到 `KnowledgeAdminCaller`,自己做
 *   `#sanitize`(非管理员不得操作他人账号;管理员缺省目标 = 全局 `*`)。
 *
 * ## 有效门禁(gate)
 * wiki-local 的 gate 是 fail-closed 的:未配置 = 一律 reject = 永远发布不了。
 * 管理面的一次 `saveDoc(publish=true)` 语义是"人已经在面板上确认过内容",因此本包注入的门禁是:
 * **`kind==='approve'` 的提案 → approve;其余(含无门禁调用方)→ reject + 明确原因**。
 * 这样 `discardProposal` 破坏后也不会有人借 lib 路径盲目发布;所有发布都记审计。
 *
 * ## 红线
 * - 不读任何凭据文件;`bearerRef` 只经 `ctx.get('credentials')`(见 deepwiki.ts);
 * - 审计 fire-and-forget(`ctx.get('audit')` 缺席静默),本地 jsonl 写失败不拖垮业务;
 * - 所有对外失败都带 `reason/message`,工具面禁止静默吞错。
 */
import * as nodeFs from 'node:fs'
import { mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  WikiLocalBackend, createNodeFsAdapter, formatCitation, parseWikiPage,
} from '@eterna/knowledge'
import type { DocPatch, KnownErrorLike, KnowledgeProposal } from './service-kinds.ts'
import { KnowledgePermissionStore } from './access-store.ts'
import { createAccessDirectory, resolveAccessDbPath, type AccessDirectory } from './access-db.ts'
import { createKnowledgeAccountsFace, type KnowledgeAccountsFace } from './accounts-face.ts'
import { KnowledgeAuditLog, parseTime, sanitizeAuditDetail, type AuditServiceLike } from './audit-log.ts'
import { resolveAdminConfig, type KnowledgeAdminPluginConfig, type ResolvedAdminConfig } from './config.ts'
import { DeepWikiBackend, describeError, matchPages, toSourceStatus } from './deepwiki.ts'
import { collectStubFragments, type ImportFragment } from './import-stub.ts'
import {
  GLOBAL_ACCOUNT, accountIsOpen, isValidAccountName, isDirectory, knowledgeAdminHome, listAccountNames,
  resolveAccountPath, resolveGlobalPath, resolveTenantRoot, type KnowledgeAdminPathsConfig, type ResolvedWikiPath,
} from './paths.ts'
import { BackendPool } from './pool.ts'
import { createKnowledgeCallerRouter, type KnowledgeCallerRouter } from './routing.ts'
import {
  KNOWLEDGE_ADMIN_TOOL_NAME, LOCAL_CALLER, MEMBER_LEVELS, accountAllowed,
  fail, ok,
} from './types.ts'
import type {
  AskArgs, AskValue, DeprecateDocArgs, DeprecateDocValue, DiscardProposalArgs, DiscardProposalValue,
  ImportMarkdownArgs, ImportMarkdownValue, ImportRepoArgs, ImportRepoValue, KnowledgeAdminAccountInfo,
  KnowledgeAdminCaller, KnowledgeAdminDoc, KnowledgeAdminDocStatus, KnowledgeAdminDocRef,
  KnowledgeAdminDocSummary, KnowledgeAdminErrorCode, KnowledgeAdminHit, KnowledgeAdminMember,
  KnowledgeAdminMemberLevel, KnowledgeAdminPage, KnowledgeAdminProposal,
  KnowledgeAdminProvenance, KnowledgeAdminSourceStatus, KnowledgeAdminTrustLevel, KnowledgeResult,
  ListAccountsArgs, ListAccountsValue, ListAuditArgs, ListAuditValue, ListDocsArgs, ListDocsValue,
  ListMembersArgs, ListMembersValue, ListProposalsArgs, ListProposalsValue, OverviewArgs, OverviewValue,
  ReadDocArgs, ReadDocValue, ReviewProposalArgs, ReviewProposalValue, SaveDocArgs, SaveDocValue,
  SearchArgs, SearchValue, SetMemberArgs, SetMemberValue, TestSourceArgs, TestSourceValue,
} from './types.ts'

/** 单页默认/上限(list 类方法共用;越界按上限截断并如实回显)。 */
export const LIST_DEFAULT_LIMIT = 20
export const LIST_MAX_LIMIT = 200
/** `ask` 上下文条数上限。 */
const ASK_TOP_K_MAX = 10
/** 一次 ask 的上下文正文上限(字符;防上下文爆。) */
const ASK_CONTEXT_MAX_CHARS = 24_000
/** undo 句柄存活时长(过期后前端"撤销"按钮失效,人需重新走流程)。 */
const UNDO_TTL_MS = 30 * 60 * 1000

/** wiki-local 的 gate 归一(approve 原样,其余给明确原因)。 */
function adminGate(trust: KnowledgeAdminTrustLevel): { kind: 'approve'; trust?: 'verified' | 'official' } | { kind: 'reject'; reason: string } {
  return trust === 'agent_drafted'
    ? { kind: 'approve', trust: 'verified' }
    : { kind: 'approve', trust }
}

/** 提案 → 管理面投影(不泄露内部字段;patch 的 title/body 原样给前端展示)。 */
function toProposal(proposal: KnowledgeProposal, account: string): KnowledgeAdminProposal {
  return {
    id: proposal.id,
    state: proposal.state,
    title: proposal.patch.title,
    body: proposal.patch.body,
    tags: proposal.patch.tags ?? [],
    origin: proposal.patch.origin,
    path: proposal.patch.path,
    doc_id: proposal.patch.doc_id,
    changelog_note: proposal.patch.changelog_note,
    created_at: proposal.created_at,
    decided_at: proposal.decided_at,
    decided_by: proposal.decided_by,
    note: proposal.note,
    account,
  }
}

/** 溯源投影(与 knowledge Provenance 同值,显式 undefined 字段保留)。 */
function toProvenance(provenance: {
  readonly origin: string
  readonly created?: string | undefined
  readonly updated?: string | undefined
  readonly valid_at?: string | undefined
  readonly status: string
  readonly superseded_by?: string | undefined
  readonly trust: string
  readonly review: string
}): KnowledgeAdminProvenance {
  return {
    origin: provenance.origin,
    ...(provenance.created === undefined ? {} : { created: provenance.created }),
    ...(provenance.updated === undefined ? {} : { updated: provenance.updated }),
    ...(provenance.valid_at === undefined ? {} : { valid_at: provenance.valid_at }),
    status: provenance.status as KnowledgeAdminDocStatus,
    ...(provenance.superseded_by === undefined ? {} : { superseded_by: provenance.superseded_by }),
    trust: provenance.trust as KnowledgeAdminTrustLevel,
    review: provenance.review === 'pending' ? 'pending' : 'reviewed',
  }
}

/** 知识后端状态(Agent `knowledge_status` 的数据源;不暴露管理面内部字段)。 */
export interface StatusBackendsValue {
  readonly account: string
  readonly backends: readonly {
    readonly id: string
    readonly ok: boolean
    readonly reason?: string | undefined
    readonly doc_count: number
    readonly last_sync?: string | undefined
    readonly capabilities: { readonly write: boolean; readonly deprecate: boolean; readonly graph: boolean }
    readonly configured: boolean
  }[]
}

/** LLM 服务消费面结构子集(`stream(GenerateOptions)`)。 */
interface LlmServiceLike {
  stream(options: {
    readonly provider: string
    readonly model: string
    readonly messages: readonly unknown[]
    readonly system?: string
    readonly maxTokens?: number
    readonly temperature?: number
    readonly purpose?: string
  }): AsyncIterable<{ readonly type: string; readonly text?: string }>
}

/** 默认模型选择服务消费面(`currentSelection()`)。 */
interface AgentDefaultModelLike {
  currentSelection(): { readonly provider?: string; readonly model?: string } | undefined
}

/** 一次性 undo 句柄(deprecate 的逆闭包;**不在服务面代签**,人是执行主体)。 */
interface UndoHandle {
  readonly token: string
  readonly docId: string
  readonly account: string
  readonly at: number
  readonly undo: () => Promise<void>
}

/** 服务构造依赖(inject 面全部经 ctx.get 惰性解析,测试可整注入)。 */
export interface KnowledgeAdminServiceDeps {
  readonly config?: KnowledgeAdminPluginConfig | undefined
  readonly env?: NodeJS.ProcessEnv | undefined
  readonly cwd?: string | undefined
  readonly now?: (() => Date) | undefined
  /** 宿主的惰性服务取用(缺省 = 永远 undefined,即"全部依赖缺席"的诚实降级)。 */
  readonly get?: ((name: string) => unknown) | undefined
  /** DeepWiki fetch 注入(测试假体)。 */
  readonly fetch?: import('./deepwiki.ts').DeepWikiFetch | undefined
  /** 子进程执行注入(测试可用假体替换,避免真跑 node)。 */
  readonly runProcess?: ((command: string, args: readonly string[], options: {
    readonly cwd: string
    readonly signal?: AbortSignal | undefined
  }) => Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>) | undefined
  /** 宿主的 tool 注册面(plugin 注入 `ctx.tools`;缺省 undefined = 不注册工具)。 */
  readonly tools?: { register?(definition: unknown): () => void } | undefined
  readonly logger?: { warn?(message: string): void } | undefined
}

export class KnowledgeAdminService {
  readonly id = 'eternaKnowledgeAdmin'
  /** 已解析配置(只读;测试断言用)。 */
  readonly resolved: ResolvedAdminConfig
  readonly #deps: KnowledgeAdminServiceDeps
  readonly #get: (name: string) => unknown
  readonly #now: () => Date
  readonly #paths: KnowledgeAdminPathsConfig
  readonly #home: string
  readonly #pool: BackendPool
  readonly #deepwiki: DeepWikiBackend
  readonly #auditLog: KnowledgeAuditLog
  readonly #permissions: KnowledgePermissionStore
  /** 只读身份面(users.db;路由与账号面共用)。 */
  readonly #access: AccessDirectory
  /** 账号知识只读状态面(plugin provide 的 `eterna-knowledge-accounts`)。 */
  readonly accounts: KnowledgeAccountsFace
  /** 会话 → 调用者路由(Agent 工具面身份解析)。 */
  readonly router: KnowledgeCallerRouter
  readonly #undos = new Map<string, UndoHandle>()
  readonly #logger: { warn?(message: string): void } | undefined
  #disposed = false

  constructor(deps: KnowledgeAdminServiceDeps = {}) {
    this.#deps = deps
    this.#get = deps.get ?? ((): unknown => undefined)
    this.#now = deps.now ?? ((): Date => new Date())
    this.resolved = resolveAdminConfig(deps.config ?? {})
    const env = deps.env ?? process.env
    const cwd = deps.cwd ?? process.cwd()
    this.#paths = {
      ...(deps.config?.tenantRoot === undefined ? {} : { tenantRoot: deps.config.tenantRoot }),
      ...(deps.config?.wikiDir === undefined ? {} : { wikiDir: deps.config.wikiDir }),
      ...(deps.config?.dbPath === undefined ? {} : { dbPath: deps.config.dbPath }),
      env,
      cwd,
    }
    this.#home = deps.config?.adminHome ?? knowledgeAdminHome({ env, cwd })
    this.#logger = deps.logger
    this.#pool = new BackendPool({
      create: cacheKey => this.#createBackend(cacheKey),
      maxInstances: this.resolved.poolMaxInstances,
      idleMs: this.resolved.poolIdleMs,
      now: () => this.#now().getTime(),
    })
    this.#deepwiki = new DeepWikiBackend({
      config: this.resolved.deepwiki,
      ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
      credentials: async () => this.#credentials(),
      now: () => this.#now().getTime(),
    })
    this.#auditLog = new KnowledgeAuditLog(join(this.#home, 'knowledge-audit.jsonl'), () => this.#now())
    this.#permissions = new KnowledgePermissionStore(this.#ensureAccessDb())
    this.#access = createAccessDirectory(deps.config?.routing?.accessDbPath ?? resolveAccessDbPath(env, cwd))
    this.accounts = createKnowledgeAccountsFace({ paths: this.#paths, access: this.#access })
    this.router = createKnowledgeCallerRouter({
      mode: deps.config?.routing?.mode ?? 'auto',
      access: this.#access,
    })
  }

  // ── 生命周期 ────────────────────────────────────────────────────────────────

  /** 配逆:关池 + 关权限库(幂等;审计文件留档不删)。 */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#pool.dispose()
    this.#permissions.close()
    this.#undos.clear()
  }

  // ── listAccounts ─────────────────────────────────────────────────────────────

  listAccounts(caller: KnowledgeAdminCaller, args: ListAccountsArgs): Promise<KnowledgeResult<ListAccountsValue>> {
    const names = caller.admin && args.includeAll !== false
      ? [GLOBAL_ACCOUNT, ...listAccountNames(this.#paths)]
      : [caller.account]
    const accounts = names.map(name => this.#accountInfo(caller, name))
    return Promise.resolve(ok({ accounts }))
  }

  // ── overview ────────────────────────────────────────────────────────────────

  async overview(caller: KnowledgeAdminCaller, args: OverviewArgs): Promise<KnowledgeResult<OverviewValue>> {
    const gate = this.#sanitize(caller, args.account)
    if (gate.kind === 'fail') return gate.result
    const account = gate.account
    const target = this.#resolveTarget(account)
    if (target === undefined) return fail('invalid', `账号名非法:${account}`)
    const degraded: string[] = []
    let docCount = 0
    let pending = 0
    let approved = 0
    let rejected = 0
    let lastSync: string | undefined
    const backend = this.#pool.acquire(this.#cacheKey(target))
    if (backend === undefined) {
      degraded.push('后端池已关闭(插件已 dispose)')
    } else {
      try {
        await backend.reindexAll()
      } catch (cause) {
        degraded.push(`重建索引失败(读数可能滞后):${describeError(cause)}`)
      }
      try {
        const health = await backend.health()
        docCount = health.doc_count
        lastSync = health.last_sync
        for (const proposal of backend.listProposals()) {
          if (proposal.state === 'pending') pending += 1
          else if (proposal.state === 'approved') approved += 1
          else rejected += 1
        }
      } catch (cause) {
        degraded.push(`计数失败:${describeError(cause)}`)
      }
    }
    const sources = await this.#sources(account)
    const accountInfo: KnowledgeAdminAccountInfo = {
      ...this.#accountInfo(caller, account),
      available: target.global || accountIsOpen(this.#paths, account),
    }
    return ok({
      account: accountInfo,
      doc_count: docCount,
      proposal_pending: pending,
      proposal_approved: approved,
      proposal_rejected: rejected,
      ...(lastSync === undefined ? {} : { last_sync: lastSync }),
      sources,
      ...(degraded.length === 0 ? {} : { degraded }),
    })
  }

  // ── 文档 CRUD ───────────────────────────────────────────────────────────────

  async listDocs(caller: KnowledgeAdminCaller, args: ListDocsArgs): Promise<KnowledgeResult<ListDocsValue>> {
    const gate = this.#sanitize(caller, args.account)
    if (gate.kind === 'fail') return gate.result
    const target = this.#resolveTarget(gate.account)
    if (target === undefined) return fail('invalid', `账号名非法:${gate.account}`)
    const backend = this.#pool.acquire(this.#cacheKey(target))
    if (backend === undefined) return fail('unavailable', '后端池已关闭(插件已 dispose)')
    try {
      await backend.reindexAll()
      // 列表 = 文件系统真相源(索引只覆盖已发布页,管理面必须看见全部页面含归档)
      const files = await nodeFs.promises.readdir(target.wikiDir, { recursive: true, withFileTypes: true })
        .then(entries => entries
          .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
          .map(entry => relativeJoin(target.wikiDir, entry.parentPath, entry.name))
          .sort((a, b) => a.localeCompare(b)))
        .catch(() => [] as string[])
      const query = wireString(args.query).trim().toLowerCase()
      const statuses = args.status?.filter(isDocStatus)
      const items: KnowledgeAdminDocSummary[] = []
      for (const rel of files) {
        const abs = join(target.wikiDir, rel)
        let summary: KnowledgeAdminDocSummary
        try {
          const raw = await nodeFs.promises.readFile(abs, 'utf8')
          const page = parseWikiPage(raw)
          summary = {
            doc_id: page.frontmatter.id ?? rel.replace(/\.md$/, ''),
            title: page.frontmatter.title,
            snippet: page.snippet,
            tags: page.frontmatter.tags,
            source_uri: `file://${abs}`,
            provenance: toProvenance({
              origin: page.frontmatter.source ?? `wiki 页面 ${rel}`,
              created: page.frontmatter.created,
              updated: page.frontmatter.updated ?? page.frontmatter.last_verified,
              valid_at: page.frontmatter.valid_at ?? page.frontmatter.updated ?? page.frontmatter.last_verified,
              status: page.frontmatter.status,
              superseded_by: page.frontmatter.superseded_by,
              trust: page.frontmatter.trust,
              review: page.frontmatter.review,
            }),
          }
        } catch {
          // 坏页(无 frontmatter/非法枚举)不进列表,也不阻断其他页——管理面另有审计可查
          continue
        }
        if (statuses !== undefined && statuses.length > 0 && !statuses.includes(summary.provenance.status)) continue
        if (query.length > 0) {
          const haystack = `${summary.title}\n${summary.snippet}`.toLowerCase()
          if (!haystack.includes(query) && !rel.toLowerCase().includes(query)) continue
        }
        items.push(summary)
      }
      const page = paginate(items, args.offset, args.limit)
      return ok(page)
    } catch (cause) {
      return fail('internal', `列文档失败:${describeError(cause)}`)
    }
  }

  async readDoc(caller: KnowledgeAdminCaller, args: ReadDocArgs): Promise<KnowledgeResult<ReadDocValue>> {
    const gate = this.#sanitize(caller, args.account)
    if (gate.kind === 'fail') return gate.result
    const target = this.#resolveTarget(gate.account)
    if (target === undefined) return fail('invalid', `账号名非法:${gate.account}`)
    const docId = wireString(args.doc_id).trim()
    if (docId.length === 0) return fail('invalid', 'doc_id 必填')
    const backend = this.#pool.acquire(this.#cacheKey(target))
    if (backend === undefined) return fail('unavailable', '后端池已关闭(插件已 dispose)')
    try {
      await backend.reindexAll()
      const doc = await backend.read({ doc_id: docId, source_uri: '', backend: 'wiki-local' })
      const view: KnowledgeAdminDoc = {
        ref: { doc_id: doc.ref.doc_id, source_uri: doc.ref.source_uri, backend: doc.ref.backend },
        title: doc.title,
        tags: doc.tags,
        body: doc.body,
        wikilinks: doc.wikilinks,
        changelog: doc.changelog.map(entry => ({ date: entry.date, note: entry.note })),
        provenance: toProvenance(doc.provenance),
        citation: doc.citation.length > 0 ? doc.citation : formatCitation({ ...doc, snippet: '', score: 0 }),
      }
      return ok(view)
    } catch (cause) {
      const code = codeOf(cause, 'not_found')
      return fail(code, `${target.global ? '全局库' : `账号 ${target.account} 分库`}无此文档:${docId}(${describeError(cause)})`)
    }
  }

  async saveDoc(caller: KnowledgeAdminCaller, args: SaveDocArgs): Promise<KnowledgeResult<SaveDocValue>> {
    const gate = this.#sanitize(caller, args.account)
    if (gate.kind === 'fail') return gate.result
    const target = this.#resolveTarget(gate.account)
    if (target === undefined) return fail('invalid', `账号名非法:${gate.account}`)
    const title = wireString(args.title).trim()
    const body = wireString(args.body).trim()
    if (title.length === 0) return fail('invalid', 'title 必填(非空)')
    if (body.length === 0) return fail('invalid', 'body 必填(非空)')
    // 真人通道才可直接发布;Agent/网关一律 pending(门禁不靠调用方自觉)
    const publish = caller.human === true && args.publish !== false
    const docId = typeof args.doc_id === 'string' && args.doc_id.trim().length > 0 ? args.doc_id.trim() : undefined
    const edit = docId !== undefined && await this.#docExists(target, docId)
    const path = args.path ?? (edit ? await this.#docPath(target, docId) : undefined)
    const patch: DocPatch = {
      title,
      body,
      ...(args.tags === undefined ? {} : { tags: args.tags }),
      origin: args.origin ?? `人写,经管理面板提交(${caller.account})`,
      ...(path === undefined ? {} : { path }),
      ...(docId === undefined ? {} : { doc_id: docId }),
      ...(args.changelog_note === undefined ? {} : { changelog_note: args.changelog_note }),
    }
    const backend = this.#pool.acquire(this.#cacheKey(target))
    if (backend === undefined) return fail('unavailable', '后端池已关闭(插件已 dispose)')
    try {
      // 两段式:propose(只落 pending)→ [publish] reviewProposal(发布)
      const proposalId = await backend.propose(patch)
      if (!publish) {
        await this.#audit(caller, target.account, 'knowledgeAdmin.saveDoc', 'ok',
          `提案 ${proposalId}(pending,待审;非人工通道不直接发布)`)
        return ok({
          proposal_id: proposalId,
          state: 'pending',
          note: '已落 pending 提案,需人工在知识库面板审批后发布;非人工通道不直接发布',
        })
      }
      return await this.#publish(target, caller, proposalId, 'verified', args.changelog_note)
    } catch (cause) {
      await this.#audit(caller, target.account, 'knowledgeAdmin.saveDoc', 'error', describeError(cause))
      return fail(codeOf(cause, 'internal'), `保存失败:${describeError(cause)}`)
    }
  }

  async deprecateDoc(caller: KnowledgeAdminCaller, args: DeprecateDocArgs): Promise<KnowledgeResult<DeprecateDocValue>> {
    const gate = this.#sanitize(caller, args.account)
    if (gate.kind === 'fail') return gate.result
    const target = this.#resolveTarget(gate.account)
    if (target === undefined) return fail('invalid', `账号名非法:${gate.account}`)
    const docId = wireString(args.doc_id).trim()
    const reason = wireString(args.reason).trim()
    if (docId.length === 0) return fail('invalid', 'doc_id 必填')
    if (reason.length === 0) return fail('invalid', 'reason 必填(废弃必须留下理由)')
    const backend = this.#pool.acquire(this.#cacheKey(target))
    if (backend === undefined) return fail('unavailable', '后端池已关闭(插件已 dispose)')
    try {
      await backend.reindexAll()
      const outcome = await backend.deprecate(docId, reason, args.superseded_by)
      const token = this.#rememberUndo({ docId, account: target.account, undo: () => outcome.undo() })
      await this.#audit(caller, target.account, 'knowledgeAdmin.deprecateDoc', 'ok', `${docId} 废弃(${reason})`)
      return ok({
        doc_id: docId,
        deprecated: true,
        undo_available: true,
        undo_hint: `30 分钟内可撤销(undo_token=${token});撤销需人类再次确认,服务面不代签`,
        undo_token: token,
      })
    } catch (cause) {
      await this.#audit(caller, target.account, 'knowledgeAdmin.deprecateDoc', 'error', describeError(cause))
      return fail(codeOf(cause, 'state'), `废弃失败:${describeError(cause)}`)
    }
  }

  /** 撤销一次 deprecate(人点"撤销"才调;token 一次性,30 分钟过期)。 */
  async undoDeprecate(
    caller: KnowledgeAdminCaller,
    args: { readonly account?: string | undefined; readonly undo_token: string },
  ): Promise<KnowledgeResult<{ readonly undone: true }>> {
    const handle = this.#undos.get(args.undo_token)
    if (handle === undefined) return fail('not_found', 'undo_token 不存在或已过期')
    const gate = this.#sanitize(caller, args.account ?? handle.account)
    if (gate.kind === 'fail') return gate.result
    if (gate.account !== handle.account) return fail('forbidden', 'undo_token 属于其他账号')
    if (this.#now().getTime() - handle.at > UNDO_TTL_MS) {
      this.#undos.delete(args.undo_token)
      return fail('not_found', 'undo_token 已过期(超过 30 分钟)')
    }
    try {
      await handle.undo()
      this.#undos.delete(args.undo_token)
      await this.#audit(caller, handle.account, 'knowledgeAdmin.undoDeprecate', 'ok', handle.docId)
      return ok({ undone: true })
    } catch (cause) {
      await this.#audit(caller, handle.account, 'knowledgeAdmin.undoDeprecate', 'error', describeError(cause))
      return fail('internal', `撤销失败:${describeError(cause)}`)
    }
  }

  // ── 提案审核 ────────────────────────────────────────────────────────────────

  listProposals(caller: KnowledgeAdminCaller, args: ListProposalsArgs): Promise<KnowledgeResult<ListProposalsValue>> {
    const gate = this.#sanitize(caller, args.account)
    if (gate.kind === 'fail') return Promise.resolve(gate.result)
    const target = this.#resolveTarget(gate.account)
    if (target === undefined) return Promise.resolve(fail('invalid', `账号名非法:${gate.account}`))
    const backend = this.#pool.acquire(this.#cacheKey(target))
    if (backend === undefined) return Promise.resolve(fail('unavailable', '后端池已关闭(插件已 dispose)'))
    try {
      const states = args.state ?? ['pending']
      const all = backend.listProposals().filter(p => states.length === 0 || states.includes(p.state))
      const sorted = [...all].sort((a, b) => b.created_at.localeCompare(a.created_at))
      const projected = sorted.map(p => toProposal(p, target.account))
      return Promise.resolve(ok(paginate(projected, args.offset, args.limit)))
    } catch (cause) {
      return Promise.resolve(fail('internal', `列提案失败:${describeError(cause)}`))
    }
  }

  async reviewProposal(caller: KnowledgeAdminCaller, args: ReviewProposalArgs): Promise<KnowledgeResult<ReviewProposalValue>> {
    // 审批只允许知识库面板(真人通道);Agent 工具已无 review action,网关/RPC 也在此兜底拒绝
    if (caller.human !== true) {
      return fail('forbidden', '提案审批仅限知识库面板的人工操作(Agent/网关通道不得审批)')
    }
    const gate = this.#sanitize(caller, args.account)
    if (gate.kind === 'fail') return gate.result
    const target = this.#resolveTarget(gate.account)
    if (target === undefined) return fail('invalid', `账号名非法:${gate.account}`)
    const proposalId = wireString(args.proposal_id).trim()
    if (proposalId.length === 0) return fail('invalid', 'proposal_id 必填')
    if (!isReviewDecision(args.decision)) return fail('invalid', "decision 只能是 'approve' | 'reject'")
    if (args.decision === 'reject' && wireString(args.reason).trim().length === 0) return fail('invalid', 'reject 必须给 reason')
    const backend = this.#pool.acquire(this.#cacheKey(target))
    if (backend === undefined) return fail('unavailable', '后端池已关闭(插件已 dispose)')
    const trust = args.trust ?? 'verified'
    if (args.decision === 'reject') {
      const customized = this.#withGate(backend, target, () => ({ kind: 'reject', reason: wireString(args.reason).trim() }))
      try {
        const outcome = await customized.reviewProposal(proposalId, `knowledge-admin:${caller.account}`)
        return ok({ proposal_id: proposalId, state: outcome.proposal.state, note: outcome.proposal.note })
      } catch (cause) {
        return fail(codeOf(cause, 'state'), `拒绝提案失败:${describeError(cause)}`)
      }
    }
    try {
      return await this.#publish(target, caller, proposalId, trust, args.reason)
    } catch (cause) {
      return fail(codeOf(cause, 'state'), `发布提案失败:${describeError(cause)}`)
    }
  }

  async discardProposal(caller: KnowledgeAdminCaller, args: DiscardProposalArgs): Promise<KnowledgeResult<DiscardProposalValue>> {
    const gate = this.#sanitize(caller, args.account)
    if (gate.kind === 'fail') return gate.result
    const target = this.#resolveTarget(gate.account)
    if (target === undefined) return fail('invalid', `账号名非法:${gate.account}`)
    const proposalId = wireString(args.proposal_id).trim()
    if (proposalId.length === 0) return fail('invalid', 'proposal_id 必填')
    const backend = this.#pool.acquire(this.#cacheKey(target))
    if (backend === undefined) return fail('unavailable', '后端池已关闭(插件已 dispose)')
    try {
      await backend.discardProposal(proposalId)
      await this.#audit(caller, target.account, 'knowledgeAdmin.discardProposal', 'ok', proposalId)
      return ok({ proposal_id: proposalId, discarded: true })
    } catch (cause) {
      return fail(codeOf(cause, 'not_found'), `撤销提案失败:${describeError(cause)}`)
    }
  }

  // ── 检索问答 ────────────────────────────────────────────────────────────────

  async search(caller: KnowledgeAdminCaller, args: SearchArgs): Promise<KnowledgeResult<SearchValue>> {
    const gate = this.#sanitize(caller, args.account)
    if (gate.kind === 'fail') return gate.result
    const query = wireString(args.query).trim()
    if (query.length === 0) return fail('invalid', 'query 必填')
    const topK = clamp(args.top_k ?? 8, 1, 50)
    const collected = await this.#collectHits(caller, gate.account, query, topK, args.include_sources !== false, args.mode)
    return ok(collected)
  }

  async ask(caller: KnowledgeAdminCaller, args: AskArgs): Promise<KnowledgeResult<AskValue>> {
    const gate = this.#sanitize(caller, args.account)
    if (gate.kind === 'fail') return gate.result
    const question = wireString(args.question).trim()
    if (question.length === 0) return fail('invalid', 'question 必填')
    const topK = clamp(args.top_k ?? 5, 1, ASK_TOP_K_MAX)
    const collected = await this.#collectHits(caller, gate.account, question, topK, args.include_sources !== false, undefined)
    if (collected.hits.length === 0) {
      return fail('unavailable', `未检索到可引用的知识(降级:${collected.degraded.map(d => `${d.source}:${d.reason}`).join('; ') || '无'});不生成无依据答案`)
    }
    const llm = this.#llm()
    if (llm === undefined) return fail('unavailable', 'LLM 服务未挂载(ctx.get(\'llm\') 缺席):无法生成答案;检索结果见 overview/search')
    const selection = this.#modelSelection()
    if (selection === undefined) return fail('unavailable', '未配置默认模型(agentDefaultModel.currentSelection() 不可用):无法生成答案')
    const context = renderContext(collected.hits)
    const system = [
      '你是企业知识库的问答助手。只依据给定【知识条目】作答,不要编造。',
      '每条结论后必须标注引用编号,如 [1];给定条目里没有的事实要明确说"知识库中没有相关信息"。',
      '回答用中文,先给结论再给依据,不超过 400 字。',
    ].join('\n')
    try {
      let answer = ''
      for await (const chunk of llm.stream({
        provider: selection.provider,
        model: selection.model,
        messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: `问题:${question}\n\n${context}` }] }],
        system,
        maxTokens: 900,
        temperature: 0.2,
        purpose: 'knowledge-admin-ask',
      })) {
        if (chunk.type === 'text-delta') answer += chunk.text ?? ''
      }
      const trimmed = answer.trim()
      if (trimmed.length === 0) return fail('internal', '模型返回空答案(未消费到 text-delta)')
      return ok({
        answer: trimmed,
        citations: collected.hits,
        model: selection,
        degraded: collected.degraded,
      })
    } catch (cause) {
      return fail('internal', `模型调用失败:${describeError(cause)}`)
    }
  }

  // ── 导入 ────────────────────────────────────────────────────────────────────

  async importMarkdown(caller: KnowledgeAdminCaller, args: ImportMarkdownArgs): Promise<KnowledgeResult<ImportMarkdownValue>> {
    const gate = this.#sanitize(caller, args.account)
    if (gate.kind === 'fail') return gate.result
    const target = this.#resolveTarget(gate.account)
    if (target === undefined) return fail('invalid', `账号名非法:${gate.account}`)
    const documents = wireArray(args.documents).filter(isRecord)
    if (documents.length === 0) return fail('invalid', 'documents 必填(至少一条 {title, body})')
    const backend = this.#pool.acquire(this.#cacheKey(target))
    if (backend === undefined) return fail('unavailable', '后端池已关闭(插件已 dispose)')
    const results: ImportMarkdownValue['proposals'][number][] = []
    let created = 0
    let failed = 0
    for (const document of documents) {
      const title = stringField(document.title)?.trim() ?? ''
      const body = stringField(document.body)?.trim() ?? ''
      if (title.length === 0 || body.length === 0) {
        failed += 1
        results.push({ title: title.length > 0 ? title : '(无标题)', state: 'pending', error: 'title/body 必填' })
        continue
      }
      const patch: DocPatch = {
        title,
        body,
        origin: stringField(document.origin) ?? `人导入,经管理面板提交(${caller.account})`,
        ...(stringArray(document.tags) === undefined ? {} : { tags: stringArray(document.tags) }),
        ...(stringField(document.path) === undefined ? {} : { path: stringField(document.path) }),
      }
      try {
        const proposalId = await backend.propose(patch)
        created += 1
        results.push({ title, proposal_id: proposalId, state: 'pending' })
      } catch (cause) {
        failed += 1
        results.push({ title, state: 'pending', error: describeError(cause) })
      }
    }
    await this.#audit(caller, target.account, 'knowledgeAdmin.importMarkdown', 'ok', `created=${created} failed=${failed}`)
    return ok({ proposals: results, created, failed })
  }

  async importRepo(caller: KnowledgeAdminCaller, args: ImportRepoArgs): Promise<KnowledgeResult<ImportRepoValue>> {
    const gate = this.#sanitize(caller, args.account)
    if (gate.kind === 'fail') return gate.result
    const target = this.#resolveTarget(gate.account)
    if (target === undefined) return fail('invalid', `账号名非法:${gate.account}`)
    const repoPath = wireString(args.repo_path).trim()
    if (repoPath.length === 0) return fail('invalid', 'repo_path 必填(账号目录内的仓库路径)')
    // 仓库面收紧(2026-11-19 用户裁定):仓库/目录路径不开放配置——每账号 wiki 固化在
    // 账号目录下,导入源也必须位于目标账号 workspace 目录之内。resolve+relative 前缀
    // 判定拒绝 `..` 逃逸与容器任意路径;仓库 = 账号目录本身也无意义(自引用),一并拒绝。
    const homeAbs = resolve(target.home)
    // 相对路径一律相对账号目录解析(不相对进程 cwd——那会把任意 cwd 子目录变成可导入面)
    const repoAbs = isAbsolute(repoPath) ? resolve(repoPath) : resolve(homeAbs, repoPath)
    const rel = relative(homeAbs, repoAbs)
    if (rel.length === 0 || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      return fail('forbidden', `仓库路径越界:仅允许导入账号目录(${homeAbs})内的仓库;仓库/目录路径不开放配置`)
    }
    if (!isDirectory(repoAbs)) return fail('not_found', `repo_path 不是账号目录内的可读目录:${repoAbs}`)
    const engine = args.engine ?? this.resolved.importEngine
    const maxFiles = clamp(args.max_files ?? this.resolved.importMaxFiles, 1, 200)
    const backend = this.#pool.acquire(this.#cacheKey(target))
    if (backend === undefined) return fail('unavailable', '后端池已关闭(插件已 dispose)')
    const spawned = engine === 'spawn' ? await this.#spawnFragments(repoAbs, maxFiles) : undefined
    const fragments: readonly ImportFragment[] = spawned?.fragments ?? collectStubFragments(repoAbs, maxFiles).fragments
    const effectiveEngine: 'spawn' | 'stub' = spawned?.fragments !== undefined ? 'spawn' : 'stub'
    const reason = spawned?.fragments !== undefined
      ? spawned.reason
      : `stub 兜底:${spawned?.reason ?? '按 MEMORY_INDEX/README/文件树生成占位页'};真实生成需子进程引擎(engine='spawn' + 仓库内 scripts/wiki-generate.mjs)`
    const results: ImportRepoValue['proposals'][number][] = []
    let created = 0
    let failed = 0
    for (const fragment of fragments) {
      try {
        const proposalId = await backend.propose({
          title: fragment.title,
          body: fragment.body,
          origin: fragment.origin,
          ...(fragment.tags === undefined ? {} : { tags: fragment.tags }),
          ...(fragment.source_path === undefined ? {} : { path: `import/${sanitizePathPart(fragment.source_path)}` }),
        })
        created += 1
        results.push({
          title: fragment.title,
          proposal_id: proposalId,
          state: 'pending',
          ...(fragment.source_path === undefined ? {} : { source_path: fragment.source_path }),
        })
      } catch (cause) {
        failed += 1
        results.push({ title: fragment.title, state: 'pending', error: describeError(cause) })
      }
    }
    await this.#audit(caller, target.account, 'knowledgeAdmin.importRepo', 'ok', `engine=${effectiveEngine} created=${created} failed=${failed}`)
    return ok({ engine: effectiveEngine, proposals: results, created, failed, reason })
  }

  // ── 权限 ────────────────────────────────────────────────────────────────────

  listMembers(caller: KnowledgeAdminCaller, args: ListMembersArgs): Promise<KnowledgeResult<ListMembersValue>> {
    const gate = this.#sanitize(caller, args.account)
    if (gate.kind === 'fail') return Promise.resolve(gate.result)
    const scope = gate.account
    try {
      return Promise.resolve(ok({ members: this.#permissions.list(scope) }))
    } catch (cause) {
      return Promise.resolve(fail('internal', `列成员失败:${describeError(cause)}`))
    }
  }

  async setMember(caller: KnowledgeAdminCaller, args: SetMemberArgs): Promise<KnowledgeResult<SetMemberValue>> {
    const gate = this.#sanitize(caller, args.account)
    if (gate.kind === 'fail') return gate.result
    const target = gate.account
    // 成员面只对真实账号(全局库 '*' 不对成员开放:那是管理员视角哨兵)
    if (target === GLOBAL_ACCOUNT) return fail('invalid', '成员面需要具体账号名,不支持全局哨兵 *')
    if (!isValidAccountName(target)) return fail('invalid', `账号名非法:${target}`)
    const memberUserId = args.member_user_id
    if (typeof memberUserId !== 'number' || !Number.isInteger(memberUserId) || memberUserId < 0) {
      return fail('invalid', 'member_user_id 必须是非负整数(本包只按 id 记账,不读 access 人名)')
    }
    if (args.level !== 'remove' && !MEMBER_LEVELS.includes(args.level)) {
      return fail('invalid', "level 只能是 'owner' | 'editor' | 'viewer' | 'remove'")
    }
    try {
      if (args.level === 'remove') {
        const removed = this.#permissions.remove(target, memberUserId)
        await this.#audit(caller, target, 'knowledgeAdmin.setMember', 'ok', `remove user=${memberUserId} removed=${removed}`)
        return ok({ removed })
      }
      const level: KnowledgeAdminMemberLevel = args.level
      const member: KnowledgeAdminMember = this.#permissions.upsert(target, memberUserId, level, this.#now().toISOString())
      await this.#audit(caller, target, 'knowledgeAdmin.setMember', 'ok', `upsert user=${memberUserId} level=${level}`)
      return ok({ member, removed: false })
    } catch (cause) {
      return fail('internal', `写成员失败:${describeError(cause)}`)
    }
  }

  // ── 审计 ────────────────────────────────────────────────────────────────────

  async listAudit(caller: KnowledgeAdminCaller, args: ListAuditArgs): Promise<KnowledgeResult<ListAuditValue>> {
    const gate = this.#sanitize(caller, args.account)
    if (gate.kind === 'fail') return gate.result
    const account = gate.account
    try {
      const all = await this.#auditLog.read({
        account,
        since: args.since,
        until: args.until,
        action: args.action,
      })
      // 审计按时间倒序展示(最新的最上面)
      const sorted = [...all].sort((a, b) => parseTime(b.ts) === undefined || parseTime(a.ts) === undefined
        ? b.ts.localeCompare(a.ts)
        : (parseTime(b.ts) ?? 0) - (parseTime(a.ts) ?? 0))
      return ok(paginate(sorted, args.offset, args.limit))
    } catch (cause) {
      return fail('internal', `读审计失败:${describeError(cause)}`)
    }
  }

  // ── 来源探测 ────────────────────────────────────────────────────────────────

  async testSource(caller: KnowledgeAdminCaller, args: TestSourceArgs): Promise<KnowledgeResult<TestSourceValue>> {
    const source = args.source ?? 'deepwiki'
    if (source === 'wiki-local') {
      const gate = this.#sanitize(caller, args.account)
      if (gate.kind === 'fail') return gate.result
      const target = this.#resolveTarget(gate.account)
      if (target === undefined) return fail('invalid', `账号名非法:${gate.account}`)
      const backend = this.#pool.acquire(this.#cacheKey(target))
      if (backend === undefined) return fail('unavailable', '后端池已关闭(插件已 dispose)')
      try {
        await backend.reindexAll()
        const health = await backend.health()
        const status: KnowledgeAdminSourceStatus = health.ok
          ? { id: 'wiki-local', status: 'ok', detail: `本地 wiki 可用(${target.wikiDir};${health.doc_count} 页)` }
          : { id: 'wiki-local', status: 'unreachable', detail: health.reason ?? '本地 wiki 不可用' }
        return ok({ source: status })
      } catch (cause) {
        return ok({ source: { id: 'wiki-local', status: 'unreachable', detail: describeError(cause) } })
      }
    }
    // DeepWiki:普通账号也可以自检(探测本身不返回任何内容,只报可达性)
    const probe = await this.#deepwiki.probe({
      baseUrl: args.base_url,
      bearerRef: args.bearer_ref,
      owner: args.owner,
      repo: args.repo,
    })
    return ok({ source: toSourceStatus(probe) })
  }

  // ── Agent 工具面(复用同一批方法;工具不实现 UI 专属 ask/权限写) ──────────────────

  /**
   * 后端状态(Agent `knowledge_status` 的数据源;不注册为网关方法)。
   * 与 overview 的计数同源(同一池、同一 backend),只多给能力/健康明细。
   */
  async statusBackends(
    caller: KnowledgeAdminCaller,
    args: { readonly account?: string | undefined },
  ): Promise<KnowledgeResult<StatusBackendsValue>> {
    const gate = this.#sanitize(caller, args.account)
    if (gate.kind === 'fail') return gate.result
    const target = this.#resolveTarget(gate.account)
    if (target === undefined) return fail('invalid', `账号名非法:${gate.account}`)
    const backend = this.#pool.acquire(this.#cacheKey(target))
    if (backend === undefined) return fail('unavailable', '后端池已关闭(插件已 dispose)')
    try {
      await backend.reindexAll()
      const health = await backend.health()
      return ok({
        account: gate.account,
        backends: [{
          id: 'wiki-local',
          ok: health.ok,
          ...(health.reason === undefined ? {} : { reason: health.reason }),
          doc_count: health.doc_count,
          ...(health.last_sync === undefined ? {} : { last_sync: health.last_sync }),
          capabilities: backend.capabilities,
          configured: true,
        }],
      })
    } catch (cause) {
      return fail('internal', `读后端状态失败:${describeError(cause)}`)
    }
  }

  /** `knowledge_admin` 工具(Agent 面);见 tools.ts 的 action 表。 */
  async runTool(caller: KnowledgeAdminCaller, action: string, args: Readonly<Record<string, unknown>>): Promise<KnowledgeResult<unknown>> {
    if (caller.account.length === 0) return fail('unauthorized', `${KNOWLEDGE_ADMIN_TOOL_NAME}:调用者账号不可解析,拒绝(多租户 fail-closed)`)
    const account = typeof args.account === 'string' ? args.account : undefined
    const str = (key: string): string | undefined => (typeof args[key] === 'string' ? args[key] : undefined)
    switch (action) {
      case 'list':
        return await this.listDocs(caller, {
          account, query: str('query'), limit: num(args.limit), offset: num(args.offset),
        })
      case 'read': {
        const docId = str('doc_id')
        if (docId === undefined) return fail('invalid', 'read 需要 doc_id')
        return await this.readDoc(caller, { account, doc_id: docId })
      }
      case 'search': {
        const query = str('query')
        if (query === undefined) return fail('invalid', 'search 需要 query')
        return await this.search(caller, { account, query, top_k: num(args.top_k), include_sources: bool(args.include_sources) })
      }
      case 'save': {
        const title = str('title')
        const body = str('body')
        if (title === undefined || body === undefined) return fail('invalid', 'save 需要 title 与 body')
        const tags = stringArray(args.tags)
        return await this.saveDoc(caller, {
          account,
          title,
          body,
          doc_id: str('doc_id'),
          ...(tags === undefined ? {} : { tags }),
          origin: str('origin'),
          // Agent 通道恒 pending;服务面另有 human 门禁兜底
          publish: false,
        })
      }
      case 'deprecate': {
        const docId = str('doc_id')
        const reason = str('reason')
        if (docId === undefined || reason === undefined) return fail('invalid', 'deprecate 需要 doc_id 与 reason')
        return await this.deprecateDoc(caller, { account, doc_id: docId, reason, superseded_by: str('superseded_by') })
      }
      case 'status':
        return await this.overview(caller, { account })
      case 'import_markdown': {
        const raw = args.documents
        if (!Array.isArray(raw)) return fail('invalid', 'import_markdown 需要 documents 数组')
        const documents = raw.filter(isRecord).map(doc => ({
          title: stringField(doc.title) ?? '',
          body: stringField(doc.body) ?? '',
          ...(stringArray(doc.tags) === undefined ? {} : { tags: stringArray(doc.tags) }),
          ...(stringField(doc.origin) === undefined ? {} : { origin: stringField(doc.origin) }),
        }))
        return await this.importMarkdown(caller, { account, documents })
      }
      case 'propose': {
        const title = str('title')
        const body = str('body')
        if (title === undefined || body === undefined) return fail('invalid', 'propose 需要 title 与 body')
        return await this.saveDoc(caller, { account, title, body, doc_id: str('doc_id'), publish: false })
      }
      case 'review': {
        // 保留分支只为一类调用方:显式 upgrade 前的老配置。审批在服务面 human 门禁处拒绝。
        return fail('forbidden', 'review 已从 Agent 工具面移除:提案审批只允许人工在知识库面板操作')
      }
      case 'list_proposals':
        return await this.listProposals(caller, { account, state: ['pending'], limit: num(args.limit) })
      default:
        return fail('invalid', `未知 action:${action}(可用:list|read|search|save|deprecate|status|import_markdown|propose|list_proposals)`)
    }
  }

  // ── 内部:后端与发布 ────────────────────────────────────────────────────────

  /** 池工厂:按绝对路径建独立 WikiLocalBackend(不共享 glue 实例)。 */
  #createBackend(cacheKey: string): { backend: WikiLocalBackend; dispose: () => void } {
    const target = JSON.parse(cacheKey) as ResolvedWikiPath
    // 目录必须先在场(全局库首次访问时 cwd 下的 knowledge.wiki/.eterna 尚未建)
    mkdirSync(target.wikiDir, { recursive: true })
    mkdirSync(dirname(target.dbPath), { recursive: true })
    const backend = new WikiLocalBackend({
      wikiDir: target.wikiDir,
      dbPath: target.dbPath,
      fs: createNodeFsAdapter(nodeFs),
      now: () => this.#now(),
      // 有效门禁:只有显式 approve 才发布(默认 deny 由下面 #withGate / #publish 覆盖)
      gate: () => ({ kind: 'reject', reason: 'knowledge-admin:发布需人工通道(浏览器面板)显式 approve(此 gate 为缺省 deny 兜底)' }),
    })
    return { backend, dispose: () => { backend.dispose() } }
  }

  /** 用临时门禁包一层(只影响这一次 reviewProposal 调用;不共享实例)。 */
  #withGate(
    backend: WikiLocalBackend,
    target: ResolvedWikiPath,
    decide: () => { kind: 'approve'; trust?: 'verified' | 'official' } | { kind: 'reject'; reason: string },
  ): { reviewProposal(id: string, reviewer: string): Promise<{ proposal: KnowledgeProposal; published?: KnowledgeAdminDocRef }> } {
    const wrapped = new WikiLocalBackend({
      wikiDir: target.wikiDir,
      dbPath: target.dbPath,
      fs: createNodeFsAdapter(nodeFs),
      now: () => this.#now(),
      gate: () => decide(),
    })
    void backend
    return {
      async reviewProposal(id, reviewer) {
        try {
          const outcome = await wrapped.reviewProposal(id, reviewer)
          return {
            proposal: outcome.proposal,
            ...(outcome.published === undefined ? {} : { published: outcome.published }),
          }
        } finally {
          wrapped.dispose()
        }
      },
    }
  }

  /** 发布(管理面板人审面):门禁=approve(trust),复查持久化提案后真发布。 */
  async #publish(
    target: ResolvedWikiPath,
    caller: KnowledgeAdminCaller,
    proposalId: string,
    trust: KnowledgeAdminTrustLevel,
    note?: string  ,
  ): Promise<KnowledgeResult<SaveDocValue>> {
    const backend = this.#pool.acquire(this.#cacheKey(target))
    if (backend === undefined) return fail('unavailable', '后端池已关闭(插件已 dispose)')
    const decision = adminGate(trust)
    const existing = backend.getProposal(proposalId)
    if (existing === undefined) {
      // 持久化提案不存在(可能是本进程 propose 后未经 review 的进程外提案)→ not_found
      return fail('not_found', `无此提案:${proposalId}(先 saveDoc 落 pending,再评审)`)
    }
    const delegate = this.#withGate(backend, target, () => decision)
    try {
      const outcome = await delegate.reviewProposal(proposalId, `knowledge-admin:${caller.account}`)
      await this.#audit(caller, target.account, 'knowledgeAdmin.publish', 'ok',
        `${proposalId} → ${outcome.published?.doc_id ?? outcome.proposal.state}${note === undefined ? '' : `;${note}`}`)
      return ok({
        proposal_id: proposalId,
        state: outcome.proposal.state,
        ...(outcome.published === undefined ? {} : { published: outcome.published }),
        ...(outcome.proposal.note === undefined ? {} : { note: outcome.proposal.note }),
      })
    } catch (cause) {
      await this.#audit(caller, target.account, 'knowledgeAdmin.publish', 'error', describeError(cause))
      return fail(codeOf(cause, 'internal'), `发布失败:${describeError(cause)}`)
    }
  }

  // ── 内部:检索聚合 ──────────────────────────────────────────────────────────

  /** 三源聚合已收敛为两源:本地分库(必跑)+ DeepWiki(可选, fail-soft)。 */
  async #collectHits(
    caller: KnowledgeAdminCaller,
    account: string,
    query: string,
    topK: number,
    includeSources: boolean,
    mode: 'hybrid' | 'keyword' | 'semantic' | undefined,
  ): Promise<SearchValue> {
    const target = this.#resolveTarget(account)
    const hits: KnowledgeAdminHit[] = []
    const contributed: string[] = []
    const degraded: { source: string; reason: string }[] = []
    if (target === undefined) {
      degraded.push({ source: 'wiki-local', reason: `账号名非法:${account}` })
    } else {
      const backend = this.#pool.acquire(this.#cacheKey(target))
      if (backend === undefined) {
        degraded.push({ source: 'wiki-local', reason: '后端池已关闭(插件已 dispose)' })
      } else {
        try {
          await backend.reindexAll()
          const local = await backend.search({ query, top_k: topK, ...(mode === undefined ? {} : { mode }) })
          for (const hit of local) {
            hits.push({
              ref: { doc_id: hit.ref.doc_id, source_uri: hit.ref.source_uri, backend: hit.ref.backend },
              title: hit.title,
              snippet: hit.snippet,
              score: hit.score,
              provenance: toProvenance(hit.provenance),
              source: 'wiki-local',
            })
          }
          contributed.push('wiki-local')
          if (local.length === 0) degraded.push({ source: 'wiki-local', reason: '本地分库无命中(FTS/短词 LIKE 均未匹配)' })
        } catch (cause) {
          degraded.push({ source: 'wiki-local', reason: describeError(cause) })
        }
      }
    }

    // 平台 knowledge 服务分支已删除:融合后本包就是知识底座唯一宿主,
    // 不再存在第二个 `@eterna/knowledge` provide(再读一次只会重复检索/跨账号泄漏)。

    // DeepWiki(自建 LLM wiki):本地关键词匹配,不依赖它的搜索 API;不可达只算降级
    if (includeSources && this.#deepwiki.enabled) {
      const owner = this.resolved.deepwiki.owner ?? ''
      const repo = this.resolved.deepwiki.repo ?? ''
      if (owner.length === 0 || repo.length === 0) {
        degraded.push({ source: 'deepwiki', reason: '未配置 owner/repo(deepwiki.owner/deepwiki.repo),跳过内容匹配' })
      } else {
        const pages = await this.#deepwiki.fetchWikiPages(owner, repo)
        if (pages.ok) {
          const matched = matchPages(pages.pages, query, topK, `${owner}/${repo}`)
          if (matched.length > 0) {
            contributed.push('deepwiki')
            for (const hit of matched) hits.push({ ...hit, source: 'deepwiki' })
          } else {
            degraded.push({ source: 'deepwiki', reason: 'DeepWiki 页面已拉取但本地关键词无命中' })
          }
        } else {
          degraded.push({ source: 'deepwiki', reason: pages.reason })
        }
      }
    }

    const deduped = dedupeHits(hits).sort((a, b) => b.score - a.score).slice(0, Math.max(1, topK * 2))
    // 有平台/本地命中时去掉来源标注以外的差异;来源标注保留(前端可分组)
    void caller
    return { hits: deduped, contributed: [...new Set(contributed)], degraded }
  }

  // ── 内部:来源状态 ──────────────────────────────────────────────────────────

  async #sources(account: string): Promise<readonly KnowledgeAdminSourceStatus[]> {
    const target = this.#resolveTarget(account)
    const localStatus: KnowledgeAdminSourceStatus = target === undefined
      ? { id: 'wiki-local', status: 'not-mounted', detail: `账号名非法:${account}` }
      : { id: 'wiki-local', status: 'ok', detail: `本地分库 ${target.wikiDir}` }
    const status = this.accounts.statusForAccount(account)
    const accountDetail = status === undefined
      ? `账号 ${account} 知识库未开通:按需建本地目录时自动补建`
      : `账号面读数:docs=${status.wikiDocCount} proposals=${status.proposalCount} available=${status.available}`
    const deepwikiProbe = this.#deepwiki.enabled
      ? await this.#deepwiki.probe({})
      : { status: 'not-configured' as const, detail: 'DeepWiki 未启用(deepwiki.enabled=false,缺省);本地分库兜底' }
    return [
      { ...localStatus, detail: `${localStatus.detail};${accountDetail}` },
      toSourceStatus(deepwikiProbe),
    ]
  }

  // ── 内部:身份与账号 ────────────────────────────────────────────────────────

  /** 越权判定(单一入口;所有方法第一行都走它)。 */
  #sanitize(caller: KnowledgeAdminCaller, requested: string | undefined):
    | { kind: 'ok'; account: string }
    | { kind: 'fail'; result: KnowledgeResult<never> } {
    if (typeof caller.account !== 'string' || caller.account.length === 0) {
      return { kind: 'fail', result: fail('unauthorized', '调用者身份不可解析(fail-closed):拒绝本次操作,请在已登录会话中重试') }
    }
    const target = (requested ?? '').trim()
    const verdict = accountAllowed(caller, target.length === 0 ? undefined : target)
    if (verdict === 'forbidden') {
      return {
        kind: 'fail',
        result: fail('forbidden', `越权:账号 ${caller.account} 无权操作账号 ${target}(管理员可操作任意账号)`),
      }
    }
    // 管理员缺省目标 = 全局库 `*`(知识底座默认视角);普通账号恒本人。
    const account = caller.admin
      ? (target.length === 0 ? GLOBAL_ACCOUNT : target)
      : caller.account
    if (account !== GLOBAL_ACCOUNT && !isValidAccountName(account)) {
      return { kind: 'fail', result: fail('invalid', `账号名非法:${account}`) }
    }
    return { kind: 'ok', account }
  }

  #resolveTarget(account: string): ResolvedWikiPath | undefined {
    if (account === GLOBAL_ACCOUNT) return resolveGlobalPath(this.#paths)
    return resolveAccountPath(this.#paths, account)
  }

  #cacheKey(target: ResolvedWikiPath): string {
    // 池 key = 绝对路径(非账号名):同账号不同路径(全局/本地覆盖配置)各自独立实例
    return JSON.stringify({
      account: target.account,
      global: target.global,
      wikiDir: resolve(target.wikiDir),
      dbPath: resolve(target.dbPath),
      home: resolve(target.home),
    })
  }

  #accountInfo(caller: KnowledgeAdminCaller, account: string): KnowledgeAdminAccountInfo {
    const target = this.#resolveTarget(account) ?? resolveGlobalPath(this.#paths)
    const info: KnowledgeAdminAccountInfo = {
      account,
      global: target.global,
      wiki_dir: target.wikiDir,
      db_path: target.dbPath,
      available: target.global ? true : accountIsOpen(this.#paths, account),
      self: account === caller.account,
    }
    return info
  }

  // ── 内部:依赖取用 ──────────────────────────────────────────────────────────

  #llm(): LlmServiceLike | undefined {
    const service = this.#get('llm') as LlmServiceLike | undefined
    return typeof service?.stream === 'function' ? service : undefined
  }

  #modelSelection(): { provider: string; model: string } | undefined {
    const service = this.#get('agentDefaultModel') as AgentDefaultModelLike | undefined
    try {
      const selection = service?.currentSelection()
      const provider = selection?.provider
      const model = selection?.model
      if (typeof provider === 'string' && provider.length > 0 && typeof model === 'string' && model.length > 0) {
        return { provider, model }
      }
    } catch {
      return undefined
    }
    return undefined
  }

  #credentials(): Promise<{ resolve(ref: string): Promise<{ readonly value?: unknown } | undefined> } | undefined> {
    const service = this.#get('credentials') as { resolve?: (ref: string) => Promise<{ readonly value?: unknown } | undefined> } | undefined
    if (typeof service?.resolve !== 'function') return Promise.resolve(undefined)
    return Promise.resolve({ resolve: ref => service.resolve?.(ref) ?? Promise.resolve(undefined) })
  }

  // ── 内部:审计双写 ──────────────────────────────────────────────────────────

  async #audit(
    caller: KnowledgeAdminCaller,
    account: string,
    action: string,
    outcome: 'ok' | 'error' | 'forbidden',
    detail?: string  ,
  ): Promise<void> {
    const actor = `user:${caller.userId}(${caller.account})`
    // 通道标注(human=浏览器面板真人;agent=工具/网关):审计可区分"谁批的"
    const channel = caller.human === true ? 'human' : 'agent'
    const detailText = detail === undefined ? `via=${channel}` : `${detail};via=${channel}`
    // 远端审计:fire-and-forget(服务缺席/抛错一律静默,绝不挡业务)
    const audit = this.#get('audit') as AuditServiceLike | undefined
    if (typeof audit?.report === 'function') {
      try {
        Promise.resolve(audit.report({
          action,
          detail: { account, outcome, detail: `via=${channel}${detail === undefined ? '' : `;${sanitizeAuditDetail(detail)}`}` },
          actor: { kind: 'user', userId: caller.userId, account: caller.account },
        })).catch(() => {})
      } catch {
        // 同步抛错同样静默
      }
    }
    // 本地 jsonl:写失败只告警,不改变业务结果
    try {
      await this.#auditLog.append({ account, actor, action, outcome, detail: detailText })
    } catch (cause) {
      this.#logger?.warn?.(`knowledge-admin:本地审计写入失败 ${describeError(cause)}`)
    }
  }

  // ── 内部:杂项 ──────────────────────────────────────────────────────────────

  #ensureAccessDb(): string {
    const dir = join(this.#home)
    nodeFs.mkdirSync(dir, { recursive: true })
    return join(dir, 'access.sqlite3')
  }

  #rememberUndo(entry: { docId: string; account: string; undo: () => Promise<void> }): string {
    const token = `undo-${this.#now().getTime()}-${this.#undos.size + 1}`
    this.#undos.set(token, { ...entry, token, at: this.#now().getTime() })
    // 惰性清理过期句柄(容量上限:只留 64 个)
    for (const [key, handle] of this.#undos) {
      if (this.#now().getTime() - handle.at > UNDO_TTL_MS || this.#undos.size > 64) this.#undos.delete(key)
    }
    return token
  }

  async #docExists(target: ResolvedWikiPath, docId: string): Promise<boolean> {
    const backend = this.#pool.acquire(this.#cacheKey(target))
    if (backend === undefined) return false
    try {
      await backend.reindexAll()
      const row = (backend as unknown as { indexer?: { getPageRow(id: string): unknown } }).indexer?.getPageRow(docId)
      return row !== undefined
    } catch {
      return false
    }
  }

  #docPath(target: ResolvedWikiPath, docId: string): Promise<string | undefined> {
    const backend = this.#pool.acquire(this.#cacheKey(target))
    if (backend === undefined) return Promise.resolve(undefined)
    try {
      const row = (backend as unknown as { indexer?: { getPageRow(id: string): { path: string } | undefined } })
        .indexer?.getPageRow(docId)
      if (row === undefined) return Promise.resolve(undefined)
      return Promise.resolve(row.path.startsWith(`${target.wikiDir}/`) ? row.path.slice(target.wikiDir.length + 1) : undefined)
    } catch {
      return Promise.resolve(undefined)
    }
  }

  /** spawn 引擎:真跑 `scripts/wiki-generate.mjs`;失败/缺席 → undefined(调用方回落 stub)。 */
  async #spawnFragments(repoPath: string, maxFiles: number): Promise<
    { readonly fragments: readonly ImportFragment[]; readonly reason: string } | undefined
  > {
    const script = join(repoPath, 'scripts', 'wiki-generate.mjs')
    if (!nodeFs.existsSync(script)) return undefined
    let outDir: string | undefined
    try {
      outDir = await mkdtemp(join(tmpdir(), 'knowledge-admin-'))
      const run = this.#deps.runProcess ?? runChildProcess
      const result = await run(process.execPath, [script, repoPath, '--out', outDir], { cwd: repoPath })
      if (result.code !== 0) {
        this.#logger?.warn?.(`knowledge-admin:wiki-generate.mjs 退出码 ${result.code}:${sanitizeAuditDetail(result.stderr)}`)
        return undefined
      }
      const fragments: ImportFragment[] = []
      const entries = await nodeFs.promises.readdir(outDir, { recursive: true, withFileTypes: true })
      for (const entry of entries) {
        if (fragments.length >= maxFiles) break
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue
        const abs = join(entry.parentPath, entry.name)
        const body = await nodeFs.promises.readFile(abs, 'utf8').catch(() => undefined)
        if (body === undefined || body.trim().length === 0) continue
        const rel = abs.startsWith(`${outDir}/`) ? abs.slice(outDir.length + 1) : entry.name
        fragments.push({
          title: entry.name.replace(/\.md$/, ''),
          body,
          origin: `${repoPath}#${rel}`,
          source_path: rel,
          tags: ['spawn-import'],
        })
      }
      return { fragments, reason: `子进程引擎产出 ${fragments.length} 个 markdown 片段(${script})` }
    } catch (cause) {
      this.#logger?.warn?.(`knowledge-admin:spawn 引擎失败 ${describeError(cause)}`)
      return undefined
    } finally {
      if (outDir !== undefined) void rm(outDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

/** 缺省子进程执行(同步命令名+绝对路径,无 shell 拼接面)。 */
export function runChildProcess(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly signal?: AbortSignal | undefined },
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, [...args], { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer | string) => { stdout += String(chunk); if (stdout.length > 1_000_000) stdout = stdout.slice(-1_000_000) })
    child.stderr.on('data', (chunk: Buffer | string) => { stderr += String(chunk); if (stderr.length > 1_000_000) stderr = stderr.slice(-1_000_000) })
    child.on('error', (cause: Error) => {
      resolvePromise({ code: -1, stdout, stderr: `${stderr}\nspawn 失败:${cause.message}` })
    })
    child.on('close', (code: number | null) => {
      resolvePromise({ code: code ?? -1, stdout, stderr })
    })
    options.signal?.addEventListener('abort', () => { child.kill('SIGTERM') }, { once: true })
  })
}

// ── 纯工具函数(导出便于单测) ─────────────────────────────────────────────────

/** 分页(越界截断并如实回显;offset 负值按 0)。 */
export function paginate<T>(items: readonly T[], offset: number | undefined, limit: number | undefined): KnowledgeAdminPage<T> {
  const lim = clamp(limit ?? LIST_DEFAULT_LIMIT, 1, LIST_MAX_LIMIT)
  const off = clamp(offset ?? 0, 0, Number.MAX_SAFE_INTEGER)
  const slice = items.slice(off, off + lim)
  return { items: slice, offset: off, limit: lim, total: items.length, has_more: off + slice.length < items.length }
}

/** 页码式 paginate 的导出别名(README 契约表引用名)。 */
export function pageOf<T>(items: readonly T[], offset: number | undefined, limit: number | undefined): KnowledgeAdminPage<T> {
  return paginate(items, offset, limit)
}

/** 命中去重(同 doc_id + 同 backend 只留最高分)。 */
export function dedupeHits(hits: readonly KnowledgeAdminHit[]): KnowledgeAdminHit[] {
  const best = new Map<string, KnowledgeAdminHit>()
  for (const hit of hits) {
    const key = `${hit.ref.backend}:${hit.ref.doc_id}`
    const existing = best.get(key)
    if (existing === undefined || hit.score > existing.score) best.set(key, hit)
  }
  return [...best.values()]
}

/** 上下文渲染(ask 的 prompt 正文;编号 = citations 下标 + 1)。 */
export function renderContext(hits: readonly KnowledgeAdminHit[]): string {
  const blocks: string[] = []
  let used = 0
  hits.forEach((hit, index) => {
    const block = [
      `【知识条目 ${index + 1}】${hit.title}`,
      `来源: ${hit.ref.source_uri}`,
      `状态: ${hit.provenance.status}/${hit.provenance.trust}/${hit.provenance.review}`,
      hit.ref.backend === 'deepwiki' ? '(DeepWiki 页面,经本地关键词匹配)' : '',
      hit.snippet,
    ].filter(line => line.length > 0).join('\n')
    if (used + block.length > ASK_CONTEXT_MAX_CHARS) return
    used += block.length + 2
    blocks.push(block)
  })
  return blocks.join('\n\n')
}

/** 错误 → 统一错误码(只按错误类名判定,不解析其文本)。 */
export function codeOf(cause: unknown, fallback: KnowledgeAdminErrorCode): KnowledgeAdminErrorCode {
  const name = (cause as KnownErrorLike | undefined)?.name
  if (name === 'KnowledgeNotFoundError') return 'not_found'
  if (name === 'KnowledgeStateError' || name === 'KnowledgeFormatError') return 'invalid'
  if (name === 'KnowledgeError') return fallback
  return fallback
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function isDocStatus(value: string): value is KnowledgeAdminDocStatus {
  return value === 'active' || value === 'stale' || value === 'deprecated'
}

/** wire 载荷字段级窄化:cast 而来的值不可信,非 string(含缺席)一律回落空串。 */
function wireString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** wire 载荷数组字段窄化:非数组(含缺席)回落空数组。 */
function wireArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

/** reviewProposal 的 decision 值域守卫(wire 值先过它再进服务面)。 */
function isReviewDecision(value: unknown): value is ReviewProposalArgs['decision'] {
  return value === 'approve' || value === 'reject'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function stringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const filtered = value.filter(item => typeof item === 'string')
  return filtered.length === value.length ? filtered : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function relativeJoin(root: string, parent: string, name: string): string {
  const abs = join(parent, name)
  const prefix = `${root}/`
  return abs.startsWith(prefix) ? abs.slice(prefix.length) : name
}

function sanitizePathPart(value: string): string {
  const cleaned = value.replace(/[^\p{Letter}\p{Number}_.-]+/gu, '-').replace(/^-+|-+$/g, '')
  return cleaned.length > 0 ? cleaned : 'fragment'
}

/** 本地单用户形态的无身份调用者(plugin 在无守卫注入时使用)。 */
export const DEFAULT_LOCAL_CALLER: KnowledgeAdminCaller = LOCAL_CALLER

/** 供测试/plugin 复用的 tenantRoot 解析。 */
export { resolveTenantRoot }
