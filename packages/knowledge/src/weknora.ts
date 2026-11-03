/**
 * WeKnora 适配器(设计文档 11 §4:高级后端,手动启用,真连后置)。
 *
 * - 手动启用:enabled=false(缺省)时 search 返回 []、health 报 {ok:false, reason:'not-configured'},
 *   模型面无感知(knowledge_status 可见原因);
 * - HTTP 调用层:POST {baseUrl}/api/v1/knowledge-search(WeKnora v0.9 官方 API 文档),凭据经
 *   token/tokenRef+resolveCredential 注入(secrets 不进配置文件,对齐 DSH credentials 哲学);
 * - 映射:平台 SearchResult → KnowledgeHit(provenance 填全;平台托管文档视为 official+reviewed);
 * - 真连验证后置:blockers 注明「需运行时联调」——响应字段防御式窄化,联调时按真实载荷校准。
 *
 * coeffect:fetch 实现、凭据解析器、超时全部注入;effect:无状态(不落盘),dispose 无副作用。
 * 失败语义 fail-soft:transport/映射失败 → search [] + health.ok=false(检索不能因高级后端宕机而崩)。
 */
import { isRecord } from './errors.ts'
import { formatCitation } from './frontmatter.ts'
import type {
  BackendCapabilities, BackendHealth, DocRef, KnowledgeBackend, KnowledgeDoc, KnowledgeHit, SearchQuery,
} from './types.ts'

/** 可注入 fetch(默认 globalThis.fetch;测试注入 mock)。 */
export type WeKnoraFetch = (url: string, init: WeKnoraRequestInit) => Promise<WeKnoraResponse>

export interface WeKnoraRequestInit {
  readonly method: 'POST'
  readonly headers: Record<string, string>
  readonly body: string
  readonly signal: AbortSignal
}

export interface WeKnoraResponse {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}

export interface WeKnoraConfig {
  /** 手动启用开关(settings 表单;缺省 false)。 */
  readonly enabled?: boolean
  readonly baseUrl?: string
  /** 直接令牌(本地/测试);生产走 tokenRef+resolveCredential。 */
  readonly token?: string
  /** credentials 引用(不进配置文件)。 */
  readonly tokenRef?: string
  readonly resolveCredential?: (ref: string) => Promise<string> | string
  readonly knowledgeBaseIds?: readonly string[]
  readonly fetchImpl?: WeKnoraFetch
  readonly timeoutMs?: number
}

const SEARCH_PATH = '/api/v1/knowledge-search'

export class WeKnoraBackend implements KnowledgeBackend {
  readonly id = 'weknora'
  readonly capabilities: BackendCapabilities = { write: false, deprecate: false, graph: false }
  private lastError: string | undefined
  private readonly config: WeKnoraConfig

  constructor(config: WeKnoraConfig = {}) {
    this.config = config
  }

  /** 是否已配置可用(enabled + baseUrl + 凭据三要素)。 */
  isConfigured(): boolean {
    return this.config.enabled === true
      && (this.config.baseUrl ?? '').length > 0
      && (this.config.token !== undefined || this.config.tokenRef !== undefined)
  }

  /** 凭据解析:token 直用;tokenRef 经 resolveCredential(缺省拒用:引用无解析器=未配置)。 */
  private async resolveToken(): Promise<string | undefined> {
    if (this.config.token !== undefined) return this.config.token
    if (this.config.tokenRef !== undefined && this.config.resolveCredential !== undefined) {
      return await this.config.resolveCredential(this.config.tokenRef)
    }
    return undefined
  }

  async search(query: SearchQuery): Promise<readonly KnowledgeHit[]> {
    if (!this.isConfigured()) return []
    const token = await this.resolveToken()
    if (token === undefined) {
      this.lastError = '凭据不可用(tokenRef 无解析结果)'
      return []
    }
    const topK = query.top_k ?? 8
    const body = JSON.stringify({
      query: query.query,
      knowledge_base_ids: this.config.knowledgeBaseIds ?? [],
      match_count: topK,
      rerank: { enabled: true },
    })
    const url = `${this.config.baseUrl ?? ''}${SEARCH_PATH}`
    const fetchImpl = this.config.fetchImpl ?? ((u, init) => globalThis.fetch(u, init))
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body,
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
      })
      if (!response.ok) {
        this.lastError = `HTTP ${response.status}`
        return []
      }
      const payload = await response.json()
      this.lastError = undefined
      return mapSearchResponse(payload, topK)
    } catch (cause) {
      this.lastError = `请求失败:${String(cause)}`
      return []
    }
  }

  read(_ref: DocRef): Promise<KnowledgeDoc> {
    // 平台文档详情 API 未在 v0.9 检索文档中列出;检索结果自带 content 足够消费。
    // read 留待真连联调(见 blockers),当前 fail-fast 并说明。
    return Promise.reject(new Error('weknora read 未实现:等待运行时联调(检索结果已含 content,可先用 knowledge_search)'))
  }

  health(): Promise<BackendHealth> {
    if (!this.isConfigured()) return Promise.resolve({ ok: false, doc_count: 0, reason: 'not-configured' })
    // 探活复用一次空查询过于昂贵;以最近一次检索错误为准(无错即视为可用)。
    return Promise.resolve(this.lastError === undefined
      ? { ok: true, doc_count: 0 }
      : { ok: false, doc_count: 0, reason: this.lastError })
  }
}

/** 平台响应 → KnowledgeHit[](防御式窄化:字段缺失跳过该条,不猜值)。 */
export function mapSearchResponse(payload: unknown, topK: number): readonly KnowledgeHit[] {
  if (!isRecord(payload) || payload.success !== true || !Array.isArray(payload.data)) return []
  const hits: KnowledgeHit[] = []
  for (const [index, entry] of (payload.data as readonly unknown[]).entries()) {
    if (!isRecord(entry)) continue
    const content = pickString(entry, 'content', 'text') ?? ''
    const docId = pickString(entry, 'knowledge_id', 'id', 'document_id')
    if (docId === undefined) continue
    const title = pickString(entry, 'document_name', 'title', 'name') ?? docId
    const score = pickScore(entry, index)
    const locator = firstLocator(entry)
    const originParts = [pickString(entry, 'document_name', 'title'), locator?.quote, locator?.section]
    const origin = originParts.filter((p): p is string => p !== undefined).join(' / ')
    hits.push({
      ref: { doc_id: docId, source_uri: `weknora://${docId}`, backend: 'weknora' },
      title,
      snippet: content.length > 200 ? `${content.slice(0, 200)}…` : content,
      score,
      provenance: {
        origin: origin.length > 0 ? origin : 'WeKnora 平台文档',
        status: 'active',
        trust: 'official',
        review: 'reviewed',
      },
    })
    if (hits.length >= topK) break
  }
  return hits
}

function pickString(item: Record<string, unknown>, ...keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/** 分数来源:相似度直字段 → metadata.base_score/model_score → 名次倒数。 */
function pickScore(item: Record<string, unknown>, index: number): number {
  const direct = item.similarity ?? item.score
  if (typeof direct === 'number' && Number.isFinite(direct)) return clamp01(direct)
  const meta = item.metadata
  if (isRecord(meta)) {
    for (const key of ['base_score', 'model_score'] as const) {
      const value = meta[key]
      if (typeof value === 'number' && Number.isFinite(value)) return clamp01(value)
    }
  }
  return 1 / (index + 2)
}

function firstLocator(item: Record<string, unknown>): { quote?: string; section?: string } | undefined {
  const locators = item.source_locators
  if (!Array.isArray(locators)) return undefined
  for (const locator of locators as readonly unknown[]) {
    if (!isRecord(locator)) continue
    const out: { quote?: string; section?: string } = {}
    if (typeof locator.quote === 'string') out.quote = locator.quote
    if (typeof locator.section === 'string') out.section = locator.section
    return out
  }
  return undefined
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** weknora 命中同样走统一引用输出规范(出口自带时效警示)。 */
export function weknoraCitation(hit: KnowledgeHit): string {
  return formatCitation(hit)
}
