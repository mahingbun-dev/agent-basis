/**
 * llm-doctor 纯判定层:协议↔baseURL 配对探测、自动适配决策、逐模型连通性测试。
 *
 * 背景(2026-11-09 验收实测):pi-ai 各协议在 baseURL 后追加的路径不同——
 * openai-completions 追加 `chat/completions`(baseURL 惯例带 /v1)、
 * openai-responses 追加 `responses`、anthropic-messages 追加 `v1/messages`
 * (baseURL 惯例不带 /v1)。用户在设置页切协议时 baseURL 不会自动跟随,配对
 * 错误即 404 {"detail":"Not Found"}(LiteLLM/FastAPI 缺省 404 体),且难以定位。
 *
 * 探测原理(零凭据、零模型调用):对端点路径发 GET——存在的路径返回任意
 * 非 404 状态(405 Method Not Allowed / 401 Unauthorized / 200 均算存在),
 * 不存在的路径返回 404。网络不可达(fetch 抛错)区别于路径不存在,不做改写。
 */

/** 各协议在 baseURL 后追加的端点路径(pi-ai 装品行为,2026-11-09 网关实测标定)。 */
export const API_ENDPOINT_PATHS: Readonly<Record<string, string>> = {
  'openai-completions': 'chat/completions',
  'openai-responses': 'responses',
  'anthropic-messages': 'v1/messages',
} as const

/** 探测超时(路径存在性 GET;毫秒)。 */
export const PROBE_TIMEOUT_MS = 3500
/** 连通性测试超时(真实模型调用;毫秒)。 */
export const PING_TIMEOUT_MS = 12000

/** 极小 fetch 形态(测试可注入;生产传全局 fetch)。 */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface ProviderRouteConfig {
  readonly displayName?: string
  readonly apiKeyEnv?: string
  readonly api?: string
  readonly baseURL?: string
  readonly models?: readonly { readonly id: string; readonly name?: string }[]
}

/** 单路由体检结论。 */
export interface RouteHealth {
  readonly provider: string
  readonly api: string | undefined
  readonly baseURL: string | undefined
  /** 当前配对是否可达(端点路径存在)。 */
  readonly ok: boolean
  /** 结论:ok / path-missing(404,可自动适配) / unreachable(网络不可达) / unsupported-api(未知协议)。 */
  readonly verdict: 'ok' | 'path-missing' | 'unreachable' | 'unsupported-api'
  /** 自动适配建议的 baseURL(verdict=path-missing 且找到存在路径时给出)。 */
  readonly suggestedBaseURL?: string
  readonly detail: string
}

/** 自动适配动作记录(写回 patch 时留痕)。 */
export interface AutoFixRecord {
  readonly provider: string
  readonly api: string
  readonly from: string
  readonly to: string
}

export interface NormalizeOutcome {
  /** 逐路由体检结果。 */
  readonly health: readonly RouteHealth[]
  /** 实际发生的 baseURL 改写。 */
  readonly fixes: readonly AutoFixRecord[]
}

/** 规范化 baseURL:去尾斜杠。 */
function cleanBase(base: string): string {
  return base.replace(/\/+$/, '')
}

/** baseURL 候选序列:原值优先,其后 /v1 后缀的加/去变体(去重)。 */
export function candidateBaseUrls(base: string): string[] {
  const clean = cleanBase(base)
  const out = [clean]
  if (/\/v1$/.test(clean)) {
    const stripped = clean.replace(/\/v1$/, '')
    if (!out.includes(stripped)) out.push(stripped)
  } else {
    const suffixed = `${clean}/v1`
    if (!out.includes(suffixed)) out.push(suffixed)
  }
  return out
}

/**
 * 端点存在性探测:GET {base}/{path},非 404 即存在。
 * 返回 'present' | 'missing' | 'unreachable'。
 */
export async function probeEndpoint(base: string, api: string, fetchImpl: FetchLike): Promise<'present' | 'missing' | 'unreachable'> {
  const suffix = API_ENDPOINT_PATHS[api]
  if (suffix === undefined) return 'missing'
  const url = `${cleanBase(base)}/${suffix}`
  try {
    const res = await fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    return res.status === 404 ? 'missing' : 'present'
  } catch {
    return 'unreachable'
  }
}

/**
 * 单路由体检:当前 baseURL 配对探测;404 时对 /v1 变体逐个探测,找到存在
 * 路径即给出 suggestedBaseURL(不落地,落地决策在调用方)。
 */
export async function checkRoute(provider: string, route: ProviderRouteConfig, fetchImpl: FetchLike): Promise<RouteHealth> {
  const api = route.api ?? ''
  const baseURL = route.baseURL ?? ''
  if (API_ENDPOINT_PATHS[api] === undefined || baseURL === '') {
    return {
      provider, api: route.api, baseURL: route.baseURL, ok: false, verdict: 'unsupported-api',
      detail: `协议 ${api || '(缺省)'} 不在可探测清单(${Object.keys(API_ENDPOINT_PATHS).join('/')})或 baseURL 缺省`,
    }
  }
  const current = await probeEndpoint(baseURL, api, fetchImpl)
  if (current === 'present') {
    return {
      provider, api: route.api, baseURL: route.baseURL, ok: true, verdict: 'ok',
      detail: `端点存在:${cleanBase(baseURL)}/${API_ENDPOINT_PATHS[api]}`,
    }
  }
  if (current === 'unreachable') {
    return {
      provider, api: route.api, baseURL: route.baseURL, ok: false, verdict: 'unreachable',
      detail: `网关不可达:${cleanBase(baseURL)}(网络错误或超时,不做自动适配)`,
    }
  }
  for (const candidate of candidateBaseUrls(baseURL)) {
    if (candidate === cleanBase(baseURL)) continue
    const probe = await probeEndpoint(candidate, api, fetchImpl)
    if (probe === 'present') {
      return {
        provider, api: route.api, baseURL: route.baseURL, ok: false, verdict: 'path-missing',
        suggestedBaseURL: candidate,
        detail: `当前端点 404,候选存在:${candidate}/${API_ENDPOINT_PATHS[api]}`,
      }
    }
  }
  return {
    provider, api: route.api, baseURL: route.baseURL, ok: false, verdict: 'path-missing',
    detail: `当前与全部候选端点均 404(${candidateBaseUrls(baseURL).join(' | ')})——检查网关地址本身`,
  }
}

/**
 * 全量 normalize:逐路由体检;对给出 suggestedBaseURL 的路由改写。
 * 返回新 config(不可变输入;无修正时返回原引用)。
 */
interface ConfigWithProviders {
  readonly providers?: Readonly<Record<string, ProviderRouteConfig>>
}

export type NormalizeResult = NormalizeOutcome & { next: { providers: Record<string, ProviderRouteConfig> } | null }

export async function normalizeConfig(config: ConfigWithProviders, fetchImpl: FetchLike): Promise<NormalizeResult> {
  const providers = config.providers ?? {}
  const health: RouteHealth[] = []
  const fixes: AutoFixRecord[] = []
  const nextProviders: Record<string, ProviderRouteConfig> = {}
  let changed = false
  for (const [provider, route] of Object.entries(providers)) {
    const result = await checkRoute(provider, route, fetchImpl)
    health.push(result)
    if (result.verdict === 'path-missing' && result.suggestedBaseURL !== undefined) {
      nextProviders[provider] = { ...route, baseURL: result.suggestedBaseURL }
      fixes.push({ provider, api: route.api ?? '', from: route.baseURL ?? '', to: result.suggestedBaseURL })
      changed = true
    } else {
      nextProviders[provider] = route
    }
  }
  return { health, fixes, next: changed ? { providers: nextProviders } : null }
}

/** 极小模型连通性测试请求体(按协议构造;真发一次补全,零历史)。 */
async function pingRequest(
  base: string,
  api: string,
  model: string,
  apiKey: string | undefined,
  fetchImpl: FetchLike,
): Promise<{ status: number; body: unknown }> {
  const clean = cleanBase(base)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (apiKey !== undefined && apiKey !== '') headers['authorization'] = `Bearer ${apiKey}`
  let url = ''
  let body: unknown
  if (api === 'openai-completions') {
    url = `${clean}/chat/completions`
    body = { model, max_tokens: 16, messages: [{ role: 'user', content: 'ping' }] }
  } else if (api === 'openai-responses') {
    url = `${clean}/responses`
    body = { model, max_output_tokens: 16, input: 'ping' }
  } else if (api === 'anthropic-messages') {
    url = `${clean}/v1/messages`
    headers['anthropic-version'] = '2023-06-01'
    body = { model, max_tokens: 16, messages: [{ role: 'user', content: 'ping' }] }
  } else {
    throw new Error(`不支持的协议:${api}`)
  }
  const res = await fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(PING_TIMEOUT_MS),
  })
  const text = await res.text()
  let parsed: unknown = text
  try { parsed = JSON.parse(text) } catch { /* 非 JSON 保留原文 */ }
  return { status: res.status, body: parsed }
}

/** 从各协议响应里摘一句话预览(截 80 字符)。 */
function extractPreview(api: string, body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const record = body as Record<string, unknown>
  if (api === 'openai-completions') {
    const choice = (record['choices'] as Record<string, unknown>[] | undefined)?.[0]
    const message = choice?.['message'] as Record<string, unknown> | undefined
    return typeof message?.['content'] === 'string' ? message['content'] : undefined
  }
  if (api === 'openai-responses') {
    if (typeof record['output_text'] === 'string') return record['output_text']
    const output = record['output'] as Record<string, unknown>[] | undefined
    const item = output?.[0]
    const content = item?.['content'] as Record<string, unknown>[] | undefined
    const text = content?.[0]?.['text']
    return typeof text === 'string' ? text : undefined
  }
  if (api === 'anthropic-messages') {
    const content = record['content'] as Record<string, unknown>[] | undefined
    const textBlock = content?.find(block => block['type'] === 'text')
    if (typeof textBlock?.['text'] === 'string') return textBlock['text']
    const thinking = content?.find(block => block['type'] === 'thinking')
    const thought = thinking?.['thinking']
    return typeof thought === 'string' ? thought : undefined
  }
  return undefined
}

/** 从错误响应里摘一段可读原因(截 200 字符)。 */
function extractError(body: unknown): string {
  if (typeof body === 'string') return body.slice(0, 200)
  if (typeof body !== 'object' || body === null) return String(body).slice(0, 200)
  const record = body as Record<string, unknown>
  const detail = record['detail'] ?? record['error'] ?? record['message']
  if (typeof detail === 'string') return detail.slice(0, 200)
  if (typeof detail === 'object' && detail !== null) {
    const inner = detail as Record<string, unknown>
    const message = inner['message']
    return (typeof message === 'string' ? message : JSON.stringify(detail)).slice(0, 200)
  }
  return JSON.stringify(body).slice(0, 200)
}

export interface PingResult {
  readonly ok: boolean
  readonly latencyMs: number
  /** 模型回复预览(ok 时)。 */
  readonly preview?: string
  /** 失败原因(ok=false 时;HTTP 状态 + 响应摘录)。 */
  readonly error?: string
}

/**
 * 逐模型连通性测试:按协议向网关真发一次极小补全(走与 agent 会话完全相同的
 * wire 路径),测量往返延迟。凭据由调用方解析(apiKeyEnv → 环境变量)。
 */
export async function pingModel(
  route: ProviderRouteConfig,
  model: string,
  apiKey: string | undefined,
  fetchImpl: FetchLike,
): Promise<PingResult> {
  const api = route.api ?? ''
  const baseURL = route.baseURL ?? ''
  if (baseURL === '' || API_ENDPOINT_PATHS[api] === undefined) {
    return { ok: false, latencyMs: 0, error: `路由配置不可测(api=${api || '(缺省)'} baseURL=${baseURL || '(空)'})` }
  }
  const started = performance.now()
  try {
    const { status, body } = await pingRequest(baseURL, api, model, apiKey, fetchImpl)
    const latencyMs = Math.round(performance.now() - started)
    if (status >= 200 && status < 300) {
      const preview = extractPreview(api, body)
      return { ok: true, latencyMs, preview: preview === undefined || preview === '' ? '(空回复)' : preview.slice(0, 80) }
    }
    return { ok: false, latencyMs, error: `HTTP ${status}: ${extractError(body)}` }
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started)
    const message = error instanceof Error ? error.message : String(error)
    const timedOut = message.includes('timeout') || message.includes('Timeout') || message.includes('abort')
    return { ok: false, latencyMs, error: timedOut ? `超时(${PING_TIMEOUT_MS}ms)` : message.slice(0, 200) }
  }
}
