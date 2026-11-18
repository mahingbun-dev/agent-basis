/**
 * DeepWiki / DeepWiki-Open 适配器(自建开源 LLM wiki;`@eterna/knowledge` 的 WeKnoraBackend 同范式)。
 *
 * 设计要点:
 * - **凭据**:`bearerRef`(凭证引用)只经 `ctx.get('credentials').resolve(ref)` 解析
 *   (DSH 凭据哲学:secrets 不进配置文件、不进输出);**绝不**读 `.env`/`secret.key`/
 *   `token` 文件,也绝不把解析结果写进日志/错误/返回值。缺 credentials 服务时按"未配置"处理
 *   (fail-soft,不报错不猜测)。
 * - **探测**(`probeDeepWiki`):候选路径按序探,`/api/health`、`/docs`、`/api/docs`、
 *   `/api/wiki/{owner}/{repo}`;任一 401/403 → `'unauthorized'`(不重试、不绕道);
 *   2xx 且 JSON → `'ok'`;其余 → `'unreachable'`。探测**不需要**令牌也能判定可达性
 *   (无令牌时 401 = unauthorized 同样是有效事实)。
 * - **内容拉取**:`fetchWikiPage(owner, repo)` 拉 `/api/wiki/{owner}/{repo}` 的 JSON(或 markdown
 *   文本),在**本地**做关键词匹配(`matchPages`),**不依赖后端的搜索 API**——DeepWiki 的
 *   搜索端点各家实现不一,本地匹配是稳定面。
 * - **fail-soft**:`wiki-local` 检索永远先跑;DeepWiki 不可达只进 `degraded`,绝不拖垮本地结果。
 *
 * 测试可注入 fetch(与 WeKnoraBackend 的 seam 同款),生产缺省 globalThis.fetch。
 */
import type { DeepWikiConfig } from './config.ts'
import type { KnowledgeAdminHit, KnowledgeAdminSourceStatus } from './types.ts'

/** 最小 fetch 面(测试注入同构假体;不引 DOM lib)。 */
export interface DeepWikiFetchResponse {
  readonly status: number
  readonly ok: boolean
  text(): Promise<string>
  json?(): Promise<unknown>
}

export type DeepWikiFetch = (url: string, init?: {
  readonly method?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly signal?: AbortSignal | undefined
}) => Promise<DeepWikiFetchResponse>

/** 凭据解析面(宿主的 credentials 服务;缺席/抛错一律视为"未配置")。 */
export interface CredentialResolver {
  resolve(ref: string): Promise<{ readonly value?: unknown } | undefined> | { readonly value?: unknown } | undefined
}

/** 一次探测结果(内部形态;对外投影见 KnowledgeAdminSourceStatus)。 */
export interface DeepWikiProbe {
  readonly status: 'ok' | 'unauthorized' | 'unreachable' | 'not-configured'
  readonly detail: string
  readonly probed_path?: string | undefined
  readonly elapsed_ms?: number | undefined
}

/** 探测候选路径(固定序:先健康检查,再文档面,最后仓库 wiki;`{owner}/{repo}` 仅在二者都在场时追加)。 */
export function candidatePaths(owner?: string, repo?: string): readonly string[] {
  const base: readonly string[] = ['/api/health', '/docs', '/api/docs']
  if (owner !== undefined && owner.length > 0 && repo !== undefined && repo.length > 0) {
    return [...base, `/api/wiki/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`]
  }
  return base
}

/** 候选路径顺序(导出供 README/测试引用;`probe` 用同一函数,口径单一)。 */
export const DEEPWIKI_CANDIDATE_PATHS: readonly string[] = candidatePaths()

/** DeepWiki 适配器(构造即绑定 config;无状态,dispose 无副作用)。 */
export class DeepWikiBackend {
  readonly id = 'deepwiki'
  readonly #config: DeepWikiConfig
  readonly #fetch: DeepWikiFetch
  readonly #credentials: () => Promise<CredentialResolver | undefined>
  readonly #now: () => number

  constructor(options: {
    readonly config: DeepWikiConfig
    readonly fetch?: DeepWikiFetch | undefined
    /** 凭据解析器工厂(service 注入 ctx.get('credentials');缺席返回 undefined)。 */
    readonly credentials?: (() => Promise<CredentialResolver | undefined>) | undefined
    readonly now?: () => number
  }) {
    this.#config = options.config
    this.#fetch = options.fetch ?? (globalThis.fetch as unknown as DeepWikiFetch)
    this.#credentials = options.credentials ?? (() => Promise.resolve(undefined))
    this.#now = options.now ?? (() => Date.now())
  }

  /** 是否启用(缺省 false = 未配置;调用方据此不进 sources)。 */
  get enabled(): boolean {
    return this.#config.enabled === true && typeof this.#config.baseUrl === 'string' && this.#config.baseUrl.length > 0
  }

  get baseUrl(): string {
    return this.#config.baseUrl ?? 'http://127.0.0.1:8001'
  }

  /**
   * 解析 Bearer 令牌。**只经 credentials 服务**;任何失败/缺席 → undefined。
   * 返回值只在内部用于构造 header,永不写日志、永不返回给调用方。
   */
  async resolveBearer(bearerRef: string | undefined): Promise<string | undefined> {
    const ref = bearerRef ?? this.#config.bearerRef
    if (typeof ref !== 'string' || ref.length === 0) return undefined
    try {
      const resolver = await this.#credentials()
      if (resolver === undefined) return undefined
      const resolved = await resolver.resolve(ref)
      const value = resolved?.value
      return typeof value === 'string' && value.length > 0 ? value : undefined
    } catch {
      return undefined
    }
  }

  /** 探测(不抛;任何网络/解析异常都归为 unreachable,错误文本不含令牌)。 */
  async probe(options: {
    readonly baseUrl?: string | undefined
    readonly bearerRef?: string | undefined
    readonly owner?: string | undefined
    readonly repo?: string | undefined
  } = {}): Promise<DeepWikiProbe> {
    // `enabled !== true` 或缺 baseUrl → 未启用:不发起任何请求(不会误报成"网络不可达")
    if (options.baseUrl === undefined && !this.enabled) {
      return { status: 'not-configured', detail: 'DeepWiki 未启用(配置 deepwiki.enabled=true 且给 baseUrl 后才探测)' }
    }
    const baseUrl = trimSlash(options.baseUrl ?? this.baseUrl)
    if (baseUrl.length === 0) return { status: 'not-configured', detail: '未配置 baseUrl(DeepWiki 未启用)' }
    const bearer = await this.resolveBearer(options.bearerRef)
    if (bearer === undefined && this.#config.bearerRef !== undefined && options.bearerRef === undefined) {
      // 配了 bearerRef 但凭据服务解析不到 → 诚实报未配置(不裸探 401 冒充"网络问题")
      return { status: 'not-configured', detail: `bearerRef 已配置但凭据不可解析(${describeRef(this.#config.bearerRef)});未发起请求` }
    }
    const paths = candidatePaths(options.owner, options.repo)
    const started = this.#now()
    const errors: string[] = []
    for (const path of paths) {
      try {
        const response = await this.#fetch(`${baseUrl}${path}`, {
          method: 'GET',
          headers: this.#headers(bearer),
        })
        if (response.status === 401 || response.status === 403) {
          return {
            status: 'unauthorized', probed_path: path, elapsed_ms: this.#now() - started,
            detail: `DeepWiki 拒绝了凭据(${path} → HTTP ${response.status});不重试、不绕道,请在部署侧核实 token 授权`,
          }
        }
        if (response.ok) {
          const text = await response.text()
          try {
            JSON.parse(text)
            return {
              status: 'ok', probed_path: path, elapsed_ms: this.#now() - started,
              detail: `DeepWiki 可达(${path} → HTTP ${response.status},JSON)`,
            }
          } catch {
            errors.push(`${path} 2xx 但非 JSON`)
          }
        } else {
          errors.push(`${path} → HTTP ${response.status}`)
        }
      } catch (cause) {
        errors.push(`${path} → ${describeError(cause)}`)
      }
    }
    return {
      status: 'unreachable',
      elapsed_ms: this.#now() - started,
      detail: `DeepWiki 不可达(${baseUrl}):${errors.slice(0, 4).join('; ')}`,
    }
  }

  /**
   * 拉取一个仓库的 wiki 内容(`GET /api/wiki/{owner}/{repo}`)。
   * 返回 `{status, pages[]}`;失败 → `status:'unreachable'|'unauthorized'` + 原因(不抛)。
   * 解析三家常见形态:`{pages:[{title,content}]}` / `[{title,content}]` / markdown 纯文本。
   */
  async fetchWikiPages(owner: string, repo: string): Promise<
    | { readonly ok: true; readonly pages: readonly DeepWikiPage[] }
    | { readonly ok: false; readonly status: 'unreachable' | 'unauthorized'; readonly reason: string }
  > {
    const baseUrl = trimSlash(this.baseUrl)
    const bearer = await this.resolveBearer(undefined)
    const path = `/api/wiki/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    try {
      const response = await this.#fetch(`${baseUrl}${path}`, { method: 'GET', headers: this.#headers(bearer) })
      if (response.status === 401 || response.status === 403) {
        return { ok: false, status: 'unauthorized', reason: `DeepWiki 拒绝凭据(${path} → HTTP ${response.status})` }
      }
      if (!response.ok) return { ok: false, status: 'unreachable', reason: `${path} → HTTP ${response.status}` }
      const text = await response.text()
      return { ok: true, pages: parseWikiPayload(text, owner, repo) }
    } catch (cause) {
      return { ok: false, status: 'unreachable', reason: `${path} → ${describeError(cause)}` }
    }
  }

  /** 组装 header(令牌只在 header 里出现一次;从不进日志)。 */
  #headers(bearer: string | undefined): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/json, text/markdown;q=0.9, text/plain;q=0.8' }
    if (bearer !== undefined) headers.authorization = `Bearer ${bearer}`
    return headers
  }
}

/** DeepWiki 页面(内部形态:标题 + 正文 + 来源 URL)。 */
export interface DeepWikiPage {
  readonly title: string
  readonly content: string
  readonly page_url: string
}

/** 解析 DeepWiki 响应体(不抛;未知形态 → 尽力提取纯文本)。 */
export function parseWikiPayload(text: string, owner: string, repo: string): readonly DeepWikiPage[] {
  const baseUrl = `/api/wiki/${owner}/${repo}`
  const trimmed = text.trim()
  if (trimmed.length === 0) return []
  const asJson = tryJson(trimmed)
  if (asJson === undefined) {
    // 纯 markdown → 单页(标题取首个 H1,缺省 owner/repo)
    const title = (/^#\s+(.+)$/m.exec(trimmed)?.[1] ?? `${owner}/${repo}`).trim()
    return [{ title, content: trimmed, page_url: baseUrl }]
  }
  const pages = collectPages(asJson)
  if (pages.length > 0) {
    return pages.map((page, index) => ({
      title: page.title ?? `${owner}/${repo} #${index + 1}`,
      content: page.content,
      page_url: page.url ?? `${baseUrl}#${index + 1}`,
    }))
  }
  return [{ title: `${owner}/${repo}`, content: JSON.stringify(asJson), page_url: baseUrl }]
}

function collectPages(value: unknown, depth = 0): readonly { title?: string; content: string; url?: string }[] {
  if (depth > 4) return []
  if (Array.isArray(value)) {
    const out: { title?: string; content: string; url?: string }[] = []
    for (const item of value) out.push(...collectPages(item, depth + 1))
    return out
  }
  if (typeof value !== 'object' || value === null) return []
  const record = value as Record<string, unknown>
  const page = pageOf(record)
  if (page !== undefined) return [page]
  for (const key of ['pages', 'docs', 'wiki', 'data', 'results', 'items'] as const) {
    const nested = record[key]
    if (nested !== undefined) {
      const found = collectPages(nested, depth + 1)
      if (found.length > 0) return found
    }
  }
  return []
}

function pageOf(record: Record<string, unknown>): { title?: string; content: string; url?: string } | undefined {
  const content = record.content ?? record.body ?? record.markdown ?? record.text ?? record.page_content
  if (typeof content !== 'string' || content.trim().length === 0) return undefined
  const title = record.title ?? record.name ?? record.page_title
  const url = record.url ?? record.source_uri ?? record.page_url
  return {
    ...(typeof title === 'string' ? { title } : {}),
    content,
    ...(typeof url === 'string' ? { url } : {}),
  }
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/**
 * 本地关键词匹配:把 DeepWiki 页面切成"命中单元"(每页一个 snippet 命中的前 N 字),
 * 不调后端 search API(口径稳定、零依赖)。打分 = 关键词覆盖率 × 出现次数加权,归一到 (0,1]。
 */
export function matchPages(
  pages: readonly DeepWikiPage[],
  query: string,
  topK: number,
  ownerRepo: string,
): readonly KnowledgeAdminHit[] {
  const terms = tokenize(query)
  if (terms.length === 0) return []
  const scored: { page: DeepWikiPage; score: number }[] = []
  for (const page of pages) {
    const haystack = `${page.title}\n${page.content}`.toLowerCase()
    let matched = 0
    let occurrences = 0
    for (const term of terms) {
      const count = countOccurrences(haystack, term)
      if (count > 0) {
        matched += 1
        occurrences += count
      }
    }
    if (matched === 0) continue
    const coverage = matched / terms.length
    const density = Math.min(1, occurrences / (terms.length * 2))
    scored.push({ page, score: (coverage * 0.7 + density * 0.3) / (1 + 0.0) })
  }
  scored.sort((a, b) => b.score - a.score || a.page.title.localeCompare(b.page.title))
  return scored.slice(0, Math.max(0, topK)).map(({ page, score }) => ({
    ref: { doc_id: `deepwiki:${ownerRepo}:${slugOf(page.title)}`, source_uri: page.page_url, backend: 'deepwiki' },
    title: page.title,
    snippet: snippetOf(page.content, terms),
    score: Math.min(1, Math.max(0, score)),
    provenance: {
      origin: page.page_url,
      status: 'active',
      trust: 'verified',
      review: 'reviewed',
    },
  }))
}

/** 关键词切分(中文单字二元组 + 英文词;避免为空)。 */
export function tokenize(query: string): readonly string[] {
  const normalized = query.toLowerCase().trim()
  if (normalized.length === 0) return []
  const terms = new Set<string>()
  for (const word of normalized.split(/[^\p{Letter}\p{Number}]+/u)) {
    if (word.length > 0) terms.add(word)
  }
  for (const chunk of normalized.match(/[\u3400-\u9fff]+/gu) ?? []) {
    if (chunk.length <= 2) {
      terms.add(chunk)
    } else {
      for (let i = 0; i + 2 <= chunk.length; i += 1) terms.add(chunk.slice(i, i + 2))
    }
  }
  return [...terms].slice(0, 24)
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index >= 0) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

function snippetOf(content: string, terms: readonly string[]): string {
  const lower = content.toLowerCase()
  const at = terms.map(term => lower.indexOf(term)).filter(index => index >= 0).sort((a, b) => a - b)[0]
  const start = Math.max(0, (at ?? 0) - 40)
  const slice = content.slice(start, start + 160).replace(/\s+/g, ' ').trim()
  return start > 0 ? `…${slice}` : slice
}

function slugOf(title: string): string {
  const slug = title.trim().replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase()
  return slug.length > 0 ? slug : 'untitled'
}

/** 投影为来源状态(`testSource` 返回值)。 */
export function toSourceStatus(probe: DeepWikiProbe): KnowledgeAdminSourceStatus {
  return {
    id: 'deepwiki',
    status: probe.status,
    detail: probe.detail,
    ...(probe.probed_path === undefined ? {} : { probed_path: probe.probed_path }),
    ...(probe.elapsed_ms === undefined ? {} : { elapsed_ms: probe.elapsed_ms }),
  }
}

function trimSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

/** 错误文本(只保留类型与 message 的前 160 字;**不含令牌**,fetch 异常文本里不会有它)。 */
export function describeError(cause: unknown): string {
  if (cause instanceof Error) {
    const text = cause.message.replace(/\s+/g, ' ').trim()
    return `${cause.name}: ${text.slice(0, 160)}`
  }
  return String(cause).slice(0, 160)
}

/** bearerRef 展示(只显示引用名,不显示值;引用名本身就是 env 名字面量,非秘密)。 */
function describeRef(ref: string | undefined): string {
  return typeof ref === 'string' && ref.length > 0 ? ref : '(空引用)'
}
