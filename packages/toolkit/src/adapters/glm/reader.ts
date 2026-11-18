/**
 * glm 适配器·读网侧(36 号 K3.1 reader.ts)——独立网页阅读 API `POST /paas/v4/reader`。
 *
 * 字段级依据 29a R1 read_url 行(文档级已核实、未实测——真调验证挂 K4.2 doctor 探活,36 §1.9):
 * - chat tools 枚举**无**读网工具,读网只能走此端点(独立「工具 API」分组);
 * - 请求:`url`(必填)/`timeout`(秒,默认 20)/`return_format`(默认 markdown)——
 *   契约参数 → 请求体经 router/translate.ts `toGlmReaderBody`(1:1;no_cache/retain_images 等
 *   布尔开关契约层未建模,不入本客户端参数面,不虚构);
 * - 响应 `{id, created, request_id, model, reader_result:{content, description, title, url,
 *   external, metadata}}` → 来源卡(SourceBlock:title→title、url→url、content→summary
 *   [§2.3 映射:summary ← R1 content]、publishTime=null 如实——reader 无发布时间字段);
 *   description/metadata/external 无规范化块对位——适配器内丢弃,不透传(29 §2.1 纪律);
 * - 鉴权与错误体(29a R1 鉴权与通用约定行):全局 HTTP Bearer(servers
 *   `https://open.bigmodel.cn/api/`);所有端点错误体统一 `{"error":{code,message}}`——
 *   非 2xx 一律抛 GlmHttpError,调用方显式降级,绝不静默。
 *
 * coeffect:fetch 实现、超时全部注入(WeKnora/Tavily 同款注入形态);effect:无状态不落盘。
 * 原生 read_url 与借用档 A 共用本端点(router.ts glm 行 providerLevel.readUrl 与 borrow 表)。
 */
import type { ReadUrlParams } from '../../contract/capabilities.ts'
import type { SourceBlock } from '../../blocks/types.ts'
import { toGlmReaderBody } from '../../router/translate.ts'

/** 可注入 fetch(默认 globalThis.fetch;测试注入 mock;宿主可经 governance proxy 包装)。 */
export type GlmFetch = (url: string, init: GlmRequestInit) => Promise<GlmFetchResponse>

export interface GlmRequestInit {
  readonly method: 'POST'
  readonly headers: Record<string, string>
  readonly body: string
  readonly signal: AbortSignal
}

export interface GlmFetchResponse {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}

/** /paas/v4/reader 响应 reader_result(R1 read_url 行;契约消费字段 + 无对位字段如实登记)。 */
export interface GlmReaderResult {
  readonly content?: string
  /** 页面描述——无规范化块对位,丢弃不透传。 */
  readonly description?: string
  readonly title?: string
  readonly url?: string
  /** 是否外部链接——无对位,丢弃。 */
  readonly external?: boolean
  /** 页面元数据(形态未展开)——无对位,丢弃。 */
  readonly metadata?: unknown
}

/** /paas/v4/reader 响应顶层(R1:`{id, created, request_id, model, reader_result}`)。 */
export interface GlmReaderResponse {
  readonly id?: string
  readonly created?: number
  readonly request_id?: string
  readonly model?: string
  readonly reader_result?: GlmReaderResult
}

export interface GlmClientConfig {
  /** API key(Bearer 值,R1 全局 security)。 */
  readonly apiKey: string
  /** 缺省 https://open.bigmodel.cn/api(R1 OpenAPI servers);测试注入本地地址。 */
  readonly baseUrl?: string
  readonly fetchImpl?: GlmFetch
  /** 超时毫秒;缺省 20_000(对齐 reader timeout 默认 20 秒,K1.2)。 */
  readonly timeoutMs?: number
}

/** GLM HTTP 错误(非 2xx;统一错误体 `{"error":{code,message}}` 原样保留,R1)。 */
export class GlmHttpError extends Error {
  readonly status: number
  readonly detail: unknown

  constructor(status: number, detail: unknown) {
    super(`GLM HTTP ${status}: ${JSON.stringify(detail ?? null)}`)
    this.name = 'GlmHttpError'
    this.status = status
    this.detail = detail
  }
}

/** reader 响应形态错误(2xx 但无 reader_result/缺 url——响应不可消费,显式失败不静默)。 */
export class GlmReaderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GlmReaderError'
  }
}

/** reader_result → 来源卡(§2.3 映射:summary ← content;publishTime=null 如实——无发布时间字段)。 */
export function toGlmReaderSourceBlock(response: GlmReaderResponse): SourceBlock {
  const result = response.reader_result
  if (result === undefined) {
    throw new GlmReaderError('/paas/v4/reader 响应缺 reader_result(29a R1 read_url 行)——显式失败,不虚构来源卡')
  }
  if (typeof result.url !== 'string' || result.url.length === 0) {
    throw new GlmReaderError('/paas/v4/reader 响应 reader_result.url 缺失——来源卡无 url 可指,显式失败')
  }
  return {
    type: 'source',
    title: result.title ?? '', // 无标题时空串占位,不虚构标题(deepseek web_fetch 同惯例)
    url: result.url,
    summary: result.content ?? '', // 抽取正文(markdown,return_format 默认)——§2.3:summary ← R1 content
    publishTime: null, // reader 无发布时间字段——如实可空(29a R6 修正:publishTime 必须可空)
    // description/metadata/external 无规范化块对位——丢弃不透传(29 §2.1)。
  }
}

/** GLM 独立端点客户端(chat completions 之外的「工具 API」族;本文件只承载 reader,K3.1)。 */
export class GlmToolClient {
  readonly #config: Required<Pick<GlmClientConfig, 'baseUrl' | 'timeoutMs'>>
    & Pick<GlmClientConfig, 'apiKey'>
    & { readonly fetchImpl: GlmFetch }

  constructor(config: GlmClientConfig) {
    if (typeof config.apiKey !== 'string' || config.apiKey.length === 0) {
      throw new RangeError('[toolkit] GlmClientConfig.apiKey 必须非空(未配置 glm 则不应构造客户端)')
    }
    this.#config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? 'https://open.bigmodel.cn/api',
      timeoutMs: config.timeoutMs ?? 20_000,
      fetchImpl: config.fetchImpl ?? globalThis.fetch,
    }
  }

  /** Bearer 头(R1 全局 security;测试断言位)。 */
  get authorizationHeader(): string {
    return `Bearer ${this.#config.apiKey}`
  }

  async #postJson(path: string, body: string, signal?: AbortSignal): Promise<unknown> {
    const timeoutSignal = AbortSignal.timeout(this.#config.timeoutMs)
    const composed = signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal])
    const response = await this.#config.fetchImpl(`${this.#config.baseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: this.authorizationHeader, 'Content-Type': 'application/json' },
      body,
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
      throw new GlmHttpError(response.status, text)
    }
    return text
  }

  /** POST /paas/v4/reader:契约参数 → toGlmReaderBody(url/timeout/return_format,R1)。 */
  async read(params: ReadUrlParams, options?: { readonly signal?: AbortSignal }): Promise<GlmReaderResponse> {
    return (await this.#postJson('/paas/v4/reader', JSON.stringify(toGlmReaderBody(params)), options?.signal)) as GlmReaderResponse
  }
}
