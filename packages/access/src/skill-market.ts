/**
 * 技能市场(2026-11-26):管理员维护全局来源,服务端代理浏览/下载,安装复用 SkillStore。
 *
 * 来源两种 kind:
 * - `skillhub`:SkillHub(skillhub.cn)兼容服务——搜索 `GET <base>/api/v1/search?q=&limit=`、
 *   浏览 `GET <base>/api/v1/showcase/hot?limit=`、下载 `GET <base>/api/v1/download?slug=&namespace=&version=`;
 * - `index`:自建静态索引(JSON)——`{skills:[...]}` / 裸数组 / `skills-market/1` 均接受,
 *   条目可用 `zipUrl` / `downloadUrl` / `markdownUrl` 指定包地址,可选 `sha256` 校验。
 *
 * 安全边界(服务端会真的出网):
 * - 只允许 https;http 仅当主机名在 `ETERNA_SKILL_MARKET_HTTP_HOSTS` 白名单(内网/测试);
 * - 拒绝本机/私网/无点主机名(SSRF);重定向逐跳重新校验且最多 3 跳;
 * - 超时 15s;响应按上限流式截断(zip ≤2MB、md ≤512KB),超限即中断;
 * - 审计只记来源/slug/版本/字节数,不落正文。
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 市场来源种类。 */
export type MarketSourceKind = 'skillhub' | 'index'

/** 一个市场来源(admin 维护;builtin 不可删)。 */
export interface MarketSource {
  readonly id: string
  readonly name: string
  readonly kind: MarketSourceKind
  readonly url: string
  readonly builtin?: boolean
}

/** 统一后的市场条目(前端卡片视图)。 */
export interface MarketEntry {
  readonly slug: string
  readonly name: string
  readonly summary: string
  readonly version: string
  readonly sourceId: string
  /** 下载时回传给来源的命名空间(有则带)。 */
  readonly namespace?: string
  readonly homepage?: string
  readonly installs?: number
}

/** 下载结果:zip 走 installZip,md 走 installMarkdown。 */
export interface MarketDownload {
  readonly bytes: Buffer
  readonly kind: 'zip' | 'md'
  readonly sha256?: string
}

export type SkillMarketErrorCode = 'invalid' | 'not-found' | 'unavailable' | 'network' | 'too-large' | 'builtin'

export class SkillMarketError extends Error {
  readonly code: SkillMarketErrorCode

  constructor(code: SkillMarketErrorCode, message: string) {
    super(message)
    this.name = 'SkillMarketError'
    this.code = code
  }
}

/** 内置 SkillHub 来源(恒存在,不可删)。 */
export const SKILLHUB_SOURCE: MarketSource = {
  id: 'skillhub',
  name: 'SkillHub',
  kind: 'skillhub',
  url: 'https://api.skillhub.cn',
  builtin: true,
}

/** 市场列表上限(单次返回条目数)。 */
export const MARKET_SEARCH_MAX = 50
/** 摘要展示上限(字符)。 */
const SUMMARY_MAX = 200
/** 下载超时(ms)。 */
const DOWNLOAD_TIMEOUT_MS = 15_000
/** 搜索/索引请求超时(ms)。 */
const FETCH_TIMEOUT_MS = 10_000
/** zip 上限(与 SkillStore 一致)。 */
const ZIP_MAX_BYTES = 2 * 1024 * 1024
/** md 上限(与 SkillStore 一致)。 */
const MD_MAX_BYTES = 512 * 1024
/** 重定向跳数上限。 */
const MAX_REDIRECTS = 3

type FetchLike = typeof fetch

export interface SkillMarketDeps {
  /** access 数据目录(来源登记表落 `<accessDir>/skill-markets.json`)。 */
  readonly accessDir: string
  /** 允许 http 的主机名白名单(内网/测试;缺省只允许 https)。 */
  readonly httpHosts?: readonly string[]
  /** 可注入 fetch(测试)。 */
  readonly fetchImpl?: FetchLike
  readonly logger?: { warn(message: string): void } | undefined
}

interface SourceFile {
  readonly format: 1
  readonly sources: readonly MarketSource[]
}

/** 本机/私网/无点主机名判定(SSRF 第一道;白名单主机不受限)。 */
const PRIVATE_HOST = /^(localhost|127\.|10\.|0\.0\.0\.0|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|\[::1\])/iu

/** 主机是否允许(http 白名单 / https 公网)。 */
export function marketUrlIssue(raw: string, httpHosts: readonly string[] = []): string | undefined {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return '地址不是合法 URL'
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '地址必须是 https'
  const host = url.hostname.toLowerCase()
  if (httpHosts.includes(host)) return undefined
  if (url.protocol !== 'https:') return '地址必须是 https(内网来源请加入 HTTP 白名单)'
  if (!host.includes('.') || PRIVATE_HOST.test(host)) return '地址不能指向内网或本机'
  return undefined
}

/** 摘要截断:取首行,去换行,超长加省略号。 */
export function summaryOf(value: unknown): string {
  if (typeof value !== 'string') return ''
  const first = value.split('\n')[0]?.trim() ?? ''
  return first.length > SUMMARY_MAX ? `${first.slice(0, SUMMARY_MAX - 1)}…` : first
}

/** 把一个来源条目归一成 MarketEntry(结构不认识返回 undefined)。 */
export function normalizeEntry(raw: unknown, source: MarketSource): MarketEntry | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const row = raw as Record<string, unknown>
  const slug = typeof row.slug === 'string' ? row.slug.trim() : ''
  if (slug === '') return undefined
  const nameRaw = typeof row.displayName === 'string' ? row.displayName
    : typeof row.name === 'string' ? row.name : slug
  const namespaceRaw = row.namespace
  const namespace = typeof namespaceRaw === 'object' && namespaceRaw !== null
    ? (namespaceRaw as Record<string, unknown>).handle
    : namespaceRaw
  const installsRaw = typeof row.installs === 'number' ? row.installs : row.downloads
  return {
    slug,
    name: nameRaw.trim() === '' ? slug : nameRaw.trim(),
    summary: summaryOf(row.summary ?? row.description),
    version: typeof row.version === 'string' ? row.version.trim() : '',
    sourceId: source.id,
    ...(typeof namespace === 'string' && namespace !== '' ? { namespace } : {}),
    ...(typeof row.homepage === 'string' && row.homepage !== '' ? { homepage: row.homepage } : {}),
    ...(typeof installsRaw === 'number' ? { installs: installsRaw } : {}),
  }
}

/** 从任意顶部结构里挑出条目数组(skillhub 搜索/展台、index 两种形态)。 */
export function entriesOf(raw: unknown): readonly unknown[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'object' || raw === null) return []
  const row = raw as Record<string, unknown>
  for (const key of ['results', 'skills']) {
    const value = row[key]
    if (Array.isArray(value)) return value
  }
  return []
}

export class SkillMarket {
  readonly #accessDir: string
  readonly #httpHosts: readonly string[]
  readonly #fetch: FetchLike
  readonly #logger: SkillMarketDeps['logger']

  constructor(deps: SkillMarketDeps) {
    this.#accessDir = deps.accessDir
    this.#httpHosts = deps.httpHosts ?? []
    this.#fetch = deps.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
    this.#logger = deps.logger
  }

  get available(): boolean {
    try {
      mkdirSync(this.#accessDir, { recursive: true, mode: 0o755 })
      return true
    } catch (error) {
      this.#logger?.warn(`[skill-market] 数据目录不可用: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  /** 来源清单:内置 SkillHub 恒在,其后是管理员添加的自定义来源。 */
  listSources(): readonly MarketSource[] {
    return [SKILLHUB_SOURCE, ...this.#readSources()]
  }

  /** 添加自定义来源(名称/URL 校验;重复 URL 拒绝)。 */
  addSource(input: { name?: unknown; url?: unknown; kind?: unknown }): MarketSource {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    const urlRaw = typeof input.url === 'string' ? input.url.trim() : ''
    if (name === '') throw new SkillMarketError('invalid', '来源名称不能为空')
    if (name.length > 40) throw new SkillMarketError('invalid', '来源名称不能超过 40 字')
    const issue = marketUrlIssue(urlRaw, this.#httpHosts)
    if (issue !== undefined) throw new SkillMarketError('invalid', issue)
    const kind: MarketSourceKind = input.kind === 'skillhub' ? 'skillhub' : 'index'
    const sources = this.#readSources()
    if (sources.some(source => source.url === urlRaw)) {
      throw new SkillMarketError('invalid', '该来源地址已存在')
    }
    if (sources.length >= 16) throw new SkillMarketError('invalid', '来源数量已达上限(16)')
    const source: MarketSource = { id: `src-${randomUUID()}`, name, kind, url: urlRaw }
    this.#writeSources([...sources, source])
    return source
  }

  /** 删除自定义来源(builtin 拒绝)。 */
  removeSource(id: unknown): void {
    const sourceId = typeof id === 'string' ? id : ''
    if (sourceId === SKILLHUB_SOURCE.id) throw new SkillMarketError('builtin', '内置来源不可删除')
    const sources = this.#readSources()
    const next = sources.filter(source => source.id !== sourceId)
    if (next.length === sources.length) throw new SkillMarketError('not-found', '来源不存在')
    this.#writeSources(next)
  }

  /** 浏览/搜索:query 为空走展台(热门),有 query 走搜索。 */
  async search(sourceId: unknown, query: unknown, limit: unknown): Promise<readonly MarketEntry[]> {
    const source = this.#sourceOf(sourceId)
    const text = typeof query === 'string' ? query.trim().slice(0, 120) : ''
    const count = typeof limit === 'number' && Number.isFinite(limit)
      ? Math.min(MARKET_SEARCH_MAX, Math.max(1, Math.trunc(limit)))
      : 20
    const url = source.kind === 'skillhub'
      ? text === ''
        ? appendQuery(`${source.url.replace(/\/+$/u, '')}/api/v1/showcase/hot`, { limit: String(count) })
        : appendQuery(`${source.url.replace(/\/+$/u, '')}/api/v1/search`, { q: text, limit: String(count) })
      : source.url
    const response = await this.#get(url, FETCH_TIMEOUT_MS)
    const raw = await readJsonCapped(response, 4 * 1024 * 1024)
    const entries: MarketEntry[] = []
    for (const row of entriesOf(raw)) {
      const entry = normalizeEntry(row, source)
      if (entry !== undefined) entries.push(entry)
      if (entries.length >= count) break
    }
    return entries
  }

  /** 下载一个技能包:skillhub 走 /api/v1/download,index 走条目地址(可校验 sha256)。 */
  async download(sourceId: unknown, request: {
    slug?: unknown
    namespace?: unknown
    version?: unknown
  }): Promise<MarketDownload> {
    const source = this.#sourceOf(sourceId)
    const slug = typeof request.slug === 'string' ? request.slug.trim() : ''
    if (slug === '') throw new SkillMarketError('invalid', '缺少技能标识(slug)')
    const namespace = typeof request.namespace === 'string' ? request.namespace.trim() : ''
    const version = typeof request.version === 'string' ? request.version.trim() : ''

    let url: string
    let expectedSha: string | undefined
    let declared: 'zip' | 'md' | undefined
    if (source.kind === 'skillhub') {
      url = appendQuery(`${source.url.replace(/\/+$/u, '')}/api/v1/download`, {
        slug,
        ...(namespace === '' ? {} : { namespace }),
        ...(version === '' ? {} : { version }),
      })
    } else {
      const entries = await this.#indexEntries(source)
      const entry = entries.find(item => item.slug === slug)
      if (entry === undefined) throw new SkillMarketError('not-found', `来源里没有技能 ${slug}`)
      url = entry.url
      expectedSha = entry.sha256
      declared = entry.kind
    }

    const bytes = await this.#downloadBytes(url, Math.max(ZIP_MAX_BYTES, MD_MAX_BYTES))
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (expectedSha !== undefined && expectedSha.toLowerCase() !== sha256) {
      throw new SkillMarketError('invalid', '下载内容与索引登记的 sha256 不一致')
    }
    const kind = declared ?? sniffKind(bytes)
    if (kind === undefined) throw new SkillMarketError('invalid', '下载内容不是 SKILL.md 或技能 zip')
    if (kind === 'md' && bytes.length > MD_MAX_BYTES) {
      throw new SkillMarketError('too-large', `SKILL.md 不能超过 ${MD_MAX_BYTES / 1024}KB`)
    }
    return { bytes, kind, ...(expectedSha === undefined ? {} : { sha256 }) }
  }

  // ── 内部:来源表 ─────────────────────────────────────────────────────
  #file(): string {
    return join(this.#accessDir, 'skill-markets.json')
  }

  #readSources(): readonly MarketSource[] {
    const path = this.#file()
    if (!existsSync(path)) return []
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<SourceFile>
      if (!Array.isArray(parsed.sources)) return []
      const out: MarketSource[] = []
      for (const row of parsed.sources) {
        if (typeof row !== 'object' || row === null) continue
        const item = row as Record<string, unknown>
        const id = typeof item.id === 'string' ? item.id : ''
        const name = typeof item.name === 'string' ? item.name : ''
        const url = typeof item.url === 'string' ? item.url : ''
        if (id === '' || name === '' || url === '') continue
        if (id === SKILLHUB_SOURCE.id) continue
        const kind: MarketSourceKind = item.kind === 'skillhub' ? 'skillhub' : 'index'
        out.push({ id, name, kind, url })
      }
      return out
    } catch {
      return []
    }
  }

  #writeSources(sources: readonly MarketSource[]): void {
    mkdirSync(this.#accessDir, { recursive: true, mode: 0o755 })
    const temp = join(this.#accessDir, `.skill-markets-${randomUUID()}.tmp`)
    const body: SourceFile = { format: 1, sources }
    writeFileSync(temp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 })
    renameSync(temp, this.#file())
  }

  #sourceOf(sourceId: unknown): MarketSource {
    const id = typeof sourceId === 'string' && sourceId !== '' ? sourceId : SKILLHUB_SOURCE.id
    const source = this.listSources().find(item => item.id === id)
    if (source === undefined) throw new SkillMarketError('not-found', '市场来源不存在')
    const issue = marketUrlIssue(source.url, this.#httpHosts)
    if (issue !== undefined) throw new SkillMarketError('invalid', `来源地址不可用:${issue}`)
    return source
  }

  // ── 内部:index 来源条目 ─────────────────────────────────────────────
  async #indexEntries(source: MarketSource): Promise<readonly {
    slug: string
    url: string
    kind: 'zip' | 'md'
    sha256?: string
  }[]> {
    const response = await this.#get(source.url, FETCH_TIMEOUT_MS)
    const raw = await readJsonCapped(response, 4 * 1024 * 1024)
    const out: { slug: string; url: string; kind: 'zip' | 'md'; sha256?: string }[] = []
    for (const row of entriesOf(raw)) {
      if (typeof row !== 'object' || row === null) continue
      const item = row as Record<string, unknown>
      const slug = typeof item.slug === 'string' ? item.slug.trim() : ''
      if (slug === '') continue
      const urlRaw = typeof item.zipUrl === 'string' ? item.zipUrl
        : typeof item.downloadUrl === 'string' ? item.downloadUrl
          : typeof item.markdownUrl === 'string' ? item.markdownUrl : ''
      if (urlRaw === '') continue
      const issue = marketUrlIssue(urlRaw, this.#httpHosts)
      if (issue !== undefined) continue
      const kind: 'zip' | 'md' = typeof item.markdownUrl === 'string' ? 'md' : 'zip'
      const sha256 = typeof item.sha256 === 'string' ? item.sha256 : undefined
      out.push({ slug, url: urlRaw, kind, ...(sha256 === undefined ? {} : { sha256 }) })
    }
    return out
  }

  // ── 内部:网络(逐跳校验 + 尺寸上限) ────────────────────────────────
  async #get(url: string, timeoutMs: number): Promise<Response> {
    let current = url
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const issue = marketUrlIssue(current, this.#httpHosts)
      if (issue !== undefined) throw new SkillMarketError('invalid', issue)
      let response: Response
      try {
        response = await this.#fetch(current, {
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
          headers: { accept: 'application/json, application/zip, text/markdown, */*' },
        })
      } catch (error) {
        throw new SkillMarketError('network', `请求失败:${error instanceof Error ? error.message : String(error)}`)
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (location === null || location === '') throw new SkillMarketError('network', '重定向缺少地址')
        current = new URL(location, current).toString()
        continue
      }
      if (!response.ok) throw new SkillMarketError('network', `来源返回 ${response.status}`)
      return response
    }
    throw new SkillMarketError('network', '重定向次数过多')
  }

  async #downloadBytes(url: string, maxBytes: number): Promise<Buffer> {
    const response = await this.#get(url, DOWNLOAD_TIMEOUT_MS)
    const lengthHeader = response.headers.get('content-length')
    if (lengthHeader !== null && Number(lengthHeader) > maxBytes) {
      throw new SkillMarketError('too-large', `下载内容不能超过 ${maxBytes / 1024 / 1024}MB`)
    }
    const reader = response.body?.getReader()
    if (reader === undefined) {
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length > maxBytes) throw new SkillMarketError('too-large', '下载内容超过上限')
      return bytes
    }
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new SkillMarketError('too-large', `下载内容不能超过 ${maxBytes / 1024 / 1024}MB`)
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)))
  }
}

/** query 拼接(同名参数覆盖)。 */
function appendQuery(url: string, params: Record<string, string>): string {
  const built = new URL(url)
  for (const [key, value] of Object.entries(params)) built.searchParams.set(key, value)
  return built.toString()
}

/** 读 JSON,带尺寸上限(索引/搜索结果不该是超大文档)。 */
async function readJsonCapped(response: Response, maxBytes: number): Promise<unknown> {
  const reader = response.body?.getReader()
  if (reader === undefined) {
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > maxBytes) throw new SkillMarketError('too-large', '来源响应过大')
    return JSON.parse(bytes.toString('utf8'))
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new SkillMarketError('too-large', '来源响应过大')
    }
    chunks.push(value)
  }
  return JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8'))
}

/** 无声明时的内容嗅探:zip 魔数 / Markdown 文本。 */
function sniffKind(bytes: Buffer): 'zip' | 'md' | undefined {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'zip'
  const head = bytes.subarray(0, Math.min(bytes.length, 4096)).toString('utf8')
  if (!head.includes('\u0000') && (/^---\s*$/mu.test(head) || head.trimStart().startsWith('#'))) return 'md'
  return undefined
}
