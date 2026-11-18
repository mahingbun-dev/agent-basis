/**
 * Tavily 客户端(36 号 K2.3「tavily/client.ts(/search、/extract、/usage;include_published_date 默认 true)」)。
 *
 * 字段级依据 29a R6(全部文档级已核实、未实测——真调验证挂 K4.2 doctor 探活,36 §1.9):
 * - 接入形态:REST 直调 `POST https://api.tavily.com/search|/extract`、`GET /usage`,
 *   认证 `Authorization: Bearer tvly-<API_KEY>`(R6 接入形态行);
 * - /search 请求体由 router/translate.ts `toTavilySearchBody` 构造——`include_published_date`
 *   **恒 true**(R6:默认 false 须显式开启,Beta;开启后每条带 published_date,best-estimate 可 null);
 * - /extract:每 5 个成功 URL 提取 = 1 credit(R6 read_url 兜底行)→ read_url 兜底执行器消费;
 * - GET /usage:key 级/account 级用量(R6 速率限制行)→ K4.2 doctor 探活「兜底路径验证其配置」消费;
 * - HTTP 错误:400/401/422(detail 数组)/429(带 Retry-After)(R6 搜索请求字段行)——
 *   非 2xx 一律抛 TavilyHttpError(状态+响应体 detail),调用方显式降级,绝不静默。
 *
 * coeffect:fetch 实现、超时全部注入(WeKnora 同款注入形态);effect:无状态不落盘。
 * 本客户端只产提供方形态响应;results[] → SourceBlock 的归一化在 generic/executors.ts
 * (score 仅内部排序参考不进块,R6 响应映射行)。
 */
import { toTavilyExtractBody } from '../../router/translate.ts'
import { toTavilySearchBody } from '../../router/translate.ts'
import type { ReadUrlParams, WebSearchParams } from '../../contract/capabilities.ts'

/** 可注入 fetch(默认 globalThis.fetch;测试注入 mock;宿主可经 governance proxy 包装)。 */
export type TavilyFetch = (url: string, init: TavilyRequestInit) => Promise<TavilyFetchResponse>

export interface TavilyRequestInit {
  readonly method: 'GET' | 'POST'
  readonly headers: Record<string, string>
  readonly body?: string
  readonly signal: AbortSignal
}

export interface TavilyFetchResponse {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}

/** Tavily /search 响应(R6 响应映射行:顶层 {query, answer?, results[], …};仅取契约消费字段)。 */
export interface TavilySearchResponse {
  readonly query?: string
  readonly answer?: string
  readonly results?: readonly TavilySearchResult[]
  /** include_usage 开启时携带(R6:usage.credits)。 */
  readonly usage?: { readonly credits?: number }
}

/** /search results[] 单条(R6 字段映射行:title/url/content/published_date/score/favicon)。 */
export interface TavilySearchResult {
  readonly title?: string
  readonly url?: string
  readonly content?: string
  /** best-estimate,不可检测时 null(R6 三坑之二)。 */
  readonly published_date?: string | null
  /** 相关性分数——仅内部排序参考,不进规范化块(R6)。 */
  readonly score?: number
  /** 站点图标(可选;宽松供应商可能显式 null)。 */
  readonly favicon?: string | null
}

/** /extract 响应(R6 read_url 兜底行)。 */
export interface TavilyExtractResponse {
  readonly results?: readonly {
    readonly url?: string
    readonly raw_content?: string | null
    readonly failed?: boolean
  }[]
}

export interface TavilyClientConfig {
  /** API key。已带 tvly- 前缀则原样作 Bearer 值;裸值自动补 tvly- 前缀(R6 认证形态)。 */
  readonly apiKey: string
  /** 缺省 https://api.tavily.com(测试注入本地地址)。 */
  readonly baseUrl?: string
  readonly fetchImpl?: TavilyFetch
  /** 超时毫秒;缺省 20_000(对齐 read_url 契约默认 20 秒,K1.2)。 */
  readonly timeoutMs?: number
}

/** Tavily HTTP 错误(非 2xx;status + 解析后的 detail;429 时附 Retry-After 秒数)。 */
export class TavilyHttpError extends Error {
  readonly status: number
  readonly detail: unknown
  readonly retryAfterSeconds?: number

  constructor(status: number, detail: unknown, retryAfterSeconds?: number) {
    super(`Tavily HTTP ${status}: ${JSON.stringify(detail ?? null)}`)
    this.name = 'TavilyHttpError'
    this.status = status
    this.detail = detail
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds
  }
}

/** Bearer 值:key 已带 tvly- 前缀则原样,否则补前缀(R6:Authorization: Bearer tvly-<API_KEY>)。 */
export function tavilyBearerToken(apiKey: string): string {
  return apiKey.startsWith('tvly-') ? apiKey : `tvly-${apiKey}`
}

/** 从部署配置解析 Tavily key(读环境变量;未配置/缺变量 → undefined=未配置兜底)。 */
export function resolveTavilyKeyFromEnv(
  apiKeyEnv: string | undefined,
  env: Record<string, string | undefined> = {},
): string | undefined {
  if (apiKeyEnv === undefined) return undefined
  const value = env[apiKeyEnv]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export class TavilyClient {
  readonly #config: Required<Pick<TavilyClientConfig, 'baseUrl' | 'timeoutMs'>>
    & Pick<TavilyClientConfig, 'apiKey'>
    & { readonly fetchImpl: TavilyFetch }

  constructor(config: TavilyClientConfig) {
    if (typeof config.apiKey !== 'string' || config.apiKey.length === 0) {
      throw new RangeError('[toolkit] TavilyClientConfig.apiKey 必须非空(未配置兜底则不应构造客户端)')
    }
    this.#config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? 'https://api.tavily.com',
      timeoutMs: config.timeoutMs ?? 20_000,
      fetchImpl: config.fetchImpl ?? globalThis.fetch,
    }
  }

  /** Bearer 头(R6 认证形态;测试断言位)。 */
  get authorizationHeader(): string {
    return `Bearer ${tavilyBearerToken(this.#config.apiKey)}`
  }

  async #request(path: string, init: { method: 'GET' | 'POST'; body?: string }, signal?: AbortSignal): Promise<unknown> {
    const timeoutSignal = AbortSignal.timeout(this.#config.timeoutMs)
    const composed = signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal])
    const headers: Record<string, string> = { Authorization: this.authorizationHeader }
    if (init.body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await this.#config.fetchImpl(`${this.#config.baseUrl}${path}`, {
      method: init.method,
      headers,
      ...(init.body !== undefined ? { body: init.body } : {}),
      signal: composed,
    })
    const text = await (async () => {
      try {
        return await response.json()
      } catch {
        return undefined
      }
    })()
    if (!response.ok) {
      const headersLike = response as { headers?: { get(name: string): string | null } }
      const retryAfter = headersLike.headers?.get('Retry-After')
      throw new TavilyHttpError(
        response.status,
        text,
        ...(retryAfter !== undefined && retryAfter !== null && /^\d+$/.test(retryAfter) ? [Number(retryAfter)] : []),
      )
    }
    return text
  }

  /** /search:契约参数 → toTavilySearchBody(include_published_date 恒 true,R6)+ 可选 include_usage。 */
  async search(
    params: WebSearchParams,
    options?: { readonly signal?: AbortSignal; readonly includeUsage?: boolean },
  ): Promise<TavilySearchResponse> {
    const body = toTavilySearchBody(params)
    const payload = options?.includeUsage === true ? { ...body, include_usage: true } : body
    return (await this.#request('/search', { method: 'POST', body: JSON.stringify(payload) }, options?.signal)) as TavilySearchResponse
  }

  /** /extract:read_url 兜底(5 URL/credit,R6;失败 URL 不计费)。 */
  async extract(params: ReadUrlParams, options?: { readonly signal?: AbortSignal }): Promise<TavilyExtractResponse> {
    return (await this.#request('/extract', { method: 'POST', body: JSON.stringify(toTavilyExtractBody(params)) }, options?.signal)) as TavilyExtractResponse
  }

  /** GET /usage:key 级/account 级用量(K4.2 doctor 探活与成本核算消费,R6)。 */
  async usage(options?: { readonly signal?: AbortSignal }): Promise<unknown> {
    return this.#request('/usage', { method: 'GET' }, options?.signal)
  }
}
