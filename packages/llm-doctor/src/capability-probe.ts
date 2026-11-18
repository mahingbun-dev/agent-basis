/**
 * K4.2 逐能力探活纯判定层(36 号 §4 K4.2;29 §3 doctor 行拍板原文:「升级为逐能力可用性
 * 探活,覆盖整条借用链:对每个已配置供应商的能力路径发最小验证请求;兜底路径验证其配置」)。
 *
 * 与 doctor.ts(路由体检 + 逐模型连通性)分层:本文件按**矩阵路径**探活——入参 path 为
 * @eterna/toolkit `RouteDecision` 的结构子集(字段兼容,不引包依赖;toolkit 矩阵输出可直接传入),
 * 结论结构化输出供 toolkit 矩阵 UI 消费(29 §6「toolkit 消费 doctor 的探活结果」)。
 *
 * 各路径最小请求形态(36 号 K4.2 逐条,字段来源全部文档级已核实):
 * - generic/兼容供应商路径(generic-function-loop):1 个 function 工具 + tool_choice:"required"
 *   + 单轮,断言收到合法 tool_calls(R3 修正行——一次覆盖声明/解析/回灌三段冒烟);
 * - MiMo 路径(mimo-chat-web-search,原生或档 B 借用):降级 auto 后以「含 web_search 声明的
 *   合法响应」为断言(R2;web_search 仅 OpenAI Chat 协议);
 * - deepseek 原生/借用(deepseek-tools-api 等):/v1/tools/search|fetch 最小请求(R4;
 *   search 体 {query} 1–128 字符、fetch 体 {url}——官方 api/search、api/fetch 页,29a R4 引用源);
 * - glm 原生/借用(glm-web-search-api / glm-reader):/paas/v4/web_search 最小请求
 *   (search_query≤70 + search_engine + search_intent 三必填,K3.4 档 A 字段约束=R1)、
 *   /paas/v4/reader 最小请求({url} 必填,R1);
 * - Tavily 兜底(tavily-search/tavily-extract):GET /usage 验 key(R6「doctor 探活与成本
 *   核算直接可用」;36 号 K4.2 允许「或一次 max_results=1 basic 搜索(1 credit)」——取零
 *   credit 的 /usage 形态,另一形态不实现,此处注记);
 * - 借用链覆盖(29 §2.4「doctor 探活须覆盖整条借用链」):path.route=borrow 时探活目标=
 *   出借方(lender)wire 路由——逐条 borrow 路径各自探活,与原生路径同一函数;
 * - GLM 流式 web_search 回流位置(29a R1 unresolved-① 指定处置路径):glm 原生 chat
 *   web_search 路径的探活附一次流式真调,观测结论回填 29a/适配器注释(glmStreamBackflow)。
 *
 * 三态判定:ok(最小验证请求合法)/ fail(路径已配置但验证失败——HTTP 非 2xx、响应形态
 * 非法、凭据未解析)/ unprobed(无可发请求——无路径(unavailable)、wire 路由缺席、
 * 或该形态的探活未在 K4.2 拍板)。
 *
 * 纪律:探活真调消耗配额/费用(GLM 0.01 元/次起、Tavily 免 /usage 但限 10 次/10 分钟、
 * deepseek 按次、MiMo 计 token;29a §2.4 口径表)——触发时机(手动/定时)未拍板=O-11,
 * 本文件只提供纯函数,不自动触发;fetch 与凭据解析全部注入(真凭据探活为部署期行为)。
 */
import { PING_TIMEOUT_MS, type FetchLike, type ProviderRouteConfig } from './doctor.ts'

/** 探活目标路径:toolkit RouteDecision 的结构子集(字段兼容直传;不引 @eterna/toolkit 依赖)。 */
export interface CapabilityProbePath {
  readonly capability: string
  readonly route: 'native' | 'borrow' | 'fallback' | 'unavailable'
  readonly adapter: string
  readonly provider?: string
  readonly model?: string
  /** borrow 段的出借方(29 §2.4)。 */
  readonly lender?: string
  readonly borrowMode?: 'direct-endpoint' | 'minimal-chat'
  readonly endpoint?: string
  readonly reason?: string
}

/** 三态判定(K4.2 门禁「三态判定」;见文件头注语义)。 */
export type CapabilityProbeVerdict = 'ok' | 'fail' | 'unprobed'

/** 最小请求构造快照(排查位;矩阵 UI 可展示实际探活目标)。 */
export interface CapabilityProbeRequestShape {
  readonly method: 'GET' | 'POST'
  readonly url: string
  readonly body?: string
}

/** GLM 流式 web_search 回流观测(29a R1 unresolved-①;结论回填 29a/适配器注释)。 */
export interface GlmStreamBackflowFinding {
  /** 任一 chunk 顶层含 web_search 字段 / 流式完成但未观测到 / 流式调用本身失败。 */
  readonly observed: 'top-level-web-search-in-chunk' | 'no-web-search-in-chunks' | 'stream-failed'
  /** 解析到的 data 帧数。 */
  readonly chunkCount: number
  readonly detail: string
}

/** 单路径探活结论(结构化输出,供 toolkit 矩阵 UI 消费;29 §6)。 */
export interface CapabilityProbeResult {
  readonly capability: string
  readonly route: CapabilityProbePath['route']
  readonly adapter: string
  readonly lender?: string
  readonly verdict: CapabilityProbeVerdict
  readonly latencyMs: number
  readonly detail: string
  readonly request?: CapabilityProbeRequestShape
  /** 仅 glm 原生 chat web_search 路径附带(R1-① 流式真调观测)。 */
  readonly glmStreamBackflow?: GlmStreamBackflowFinding
}

/** 探活依赖注入:fetch(生产=全局)与凭据解析(apiKeyEnv→值,生产=process.env)。 */
export interface CapabilityProbeDeps {
  readonly fetchImpl: FetchLike
  readonly resolveApiKey: (apiKeyEnv: string | undefined) => string | undefined
}

/** probeCapability 入参(routes=pi-ai config.providers 形态的 wire 路由表)。 */
export interface CapabilityProbeInput {
  readonly path: CapabilityProbePath
  /** 已配置供应商 wire 路由(键=deepseek/glm/mimo 或任意 generic 提供方 id)。 */
  readonly routes: Readonly<Record<string, ProviderRouteConfig>>
  /** generic 兜底路径(files 混合兜底)实际承载对话的提供方路由键;缺省 'generic'。 */
  readonly genericRouteKey?: string
  /** Tavily 兜底配置(兜底路径验证其配置;29 §3)。 */
  readonly tavily?: { readonly apiKeyEnv?: string }
}

/** 探活固定搜索词(1–128 字符内取最短稳定词;deepseek query 约束 R4)。 */
const PROBE_QUERY = 'ping'
/** 探活固定 URL(reader/fetch 最小请求的抓取目标;IETF 保留稳定域,不入凭据)。 */
const PROBE_URL = 'https://example.com'
/** Tavily 固定 base(R6 接入形态行:REST 直调 https://api.tavily.com)。 */
const TAVILY_BASE_URL = 'https://api.tavily.com'
/** Tavily key 前缀补全(R6:Authorization: Bearer tvly-<API_KEY>)。 */
function tavilyBearer(key: string): string {
  return key.startsWith('tvly-') ? key : `tvly-${key}`
}

/**
 * 端点 URL 拼接:chat baseURL 惯例(openai 带 /v1、glm 带 /paas/v4)与独立端点
 * 根相对路径的重叠归并——base 尾段与 endpoint 首段重叠时只拼余段,不重复。
 * 例:'…/v1' + '/v1/tools/search' → '…/v1/tools/search';
 *     '…/api/paas/v4' + '/paas/v4/web_search' → '…/api/paas/v4/web_search'。
 */
export function joinEndpoint(base: string, endpoint: string): string {
  const clean = base.replace(/\/+$/, '')
  const baseSegments = clean.split('/').filter(segment => segment !== '')
  const endpointSegments = endpoint.split('/').filter(segment => segment !== '')
  // 最长后缀=前缀重叠(逐长度递减尝试)。
  for (let overlap = Math.min(baseSegments.length, endpointSegments.length); overlap > 0; overlap -= 1) {
    const baseTail = baseSegments.slice(baseSegments.length - overlap)
    const endpointHead = endpointSegments.slice(0, overlap)
    if (baseTail.every((segment, index) => segment === endpointHead[index])) {
      const rest = endpointSegments.slice(overlap)
      return rest.length === 0 ? clean : `${clean}/${rest.join('/')}`
    }
  }
  return `${clean}/${endpointSegments.join('/')}`
}

/** 构造结论(不发的路径=unprobed;exactOptionalPropertyTypes 用条件展开)。 */
function unprobed(path: CapabilityProbePath, detail: string): CapabilityProbeResult {
  return {
    capability: path.capability,
    route: path.route,
    adapter: path.adapter,
    verdict: 'unprobed',
    latencyMs: 0,
    detail,
    ...(path.lender !== undefined ? { lender: path.lender } : {}),
  }
}

/** 从错误响应体摘可读原因(截 200 字符;沿用 doctor.ts extractError 形态)。 */
function extractErrorBody(body: unknown): string {
  if (typeof body === 'string') return body.slice(0, 200)
  if (typeof body === 'object' && body !== null) {
    const record = body as Record<string, unknown>
    const error = record['error']
    if (typeof error === 'object' && error !== null) {
      const inner = error as Record<string, unknown>
      const message = inner['message'] ?? inner['code']
      if (typeof message === 'string') return message.slice(0, 200)
    }
    for (const key of ['detail', 'message']) {
      const value = record[key]
      if (typeof value === 'string') return value.slice(0, 200)
    }
  }
  return JSON.stringify(body).slice(0, 200)
}

/** 通用 JSON POST + Bearer(独立端点族共用;2xx=ok,其余 fail)。 */
async function postJson(
  url: string,
  apiKey: string | undefined,
  body: unknown,
  deps: CapabilityProbeDeps,
): Promise<{ verdict: 'ok' | 'fail'; latencyMs: number; detail: string; responseText: string }> {
  const started = performance.now()
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (apiKey !== undefined && apiKey !== '') headers['authorization'] = `Bearer ${apiKey}`
    const response = await deps.fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    })
    const latencyMs = Math.round(performance.now() - started)
    const text = await response.text()
    let parsed: unknown = text
    try { parsed = JSON.parse(text) } catch { /* 非 JSON 保留原文 */ }
    if (response.status >= 200 && response.status < 300) {
      return { verdict: 'ok', latencyMs, detail: `HTTP ${response.status}`, responseText: text }
    }
    return { verdict: 'fail', latencyMs, detail: `HTTP ${response.status}: ${extractErrorBody(parsed)}`, responseText: text }
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started)
    const message = error instanceof Error ? error.message : String(error)
    return { verdict: 'fail', latencyMs, detail: message.slice(0, 200), responseText: '' }
  }
}

/** chat/completions POST(带 Bearer;MiMo/generic 探活共用 wire 形态)。 */
async function postChat(
  url: string,
  apiKey: string | undefined,
  body: Record<string, unknown>,
  deps: CapabilityProbeDeps,
): Promise<{ verdict: 'ok' | 'fail'; latencyMs: number; detail: string; body: unknown }> {
  const started = performance.now()
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (apiKey !== undefined && apiKey !== '') headers['authorization'] = `Bearer ${apiKey}`
    const response = await deps.fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    })
    const latencyMs = Math.round(performance.now() - started)
    const text = await response.text()
    let parsed: unknown = text
    try { parsed = JSON.parse(text) } catch { /* 非 JSON 保留原文 */ }
    if (!(response.status >= 200 && response.status < 300)) {
      return { verdict: 'fail', latencyMs, detail: `HTTP ${response.status}: ${extractErrorBody(parsed)}`, body: parsed }
    }
    return { verdict: 'ok', latencyMs, detail: `HTTP ${response.status}`, body: parsed }
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started)
    const message = error instanceof Error ? error.message : String(error)
    return { verdict: 'fail', latencyMs, detail: message.slice(0, 200), body: undefined }
  }
}

/** 取 choices[0].message(R3/R2 chat 响应断言位)。 */
function chatMessage(body: unknown): Record<string, unknown> | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const choices = (body as Record<string, unknown>)['choices']
  if (!Array.isArray(choices) || choices.length === 0) return undefined
  const first = choices[0] as Record<string, unknown> | undefined
  const message = first?.['message']
  if (typeof message !== 'object' || message === null) return undefined
  return message as Record<string, unknown>
}

/** generic 断言:收到合法 tool_calls(id+function.name 为串;arguments 仅形状合法不解析——R3)。 */
function legalToolCalls(message: Record<string, unknown>): boolean {
  const calls = message['tool_calls']
  if (!Array.isArray(calls) || calls.length === 0) return false
  const first = calls[0] as Record<string, unknown> | undefined
  const fn = first?.['function']
  if (typeof first?.['id'] !== 'string' || first['id'] === '') return false
  if (typeof fn !== 'object' || fn === null) return false
  const name = (fn as Record<string, unknown>)['name']
  return typeof name === 'string' && name !== ''
}

/**
 * GLM 流式 web_search 回流观测(29a R1 unresolved-①:OpenAPI 的 ChatCompletionChunk
 * 无 web_search 字段——回流位置待实测;本观测即「探活含一次流式真调」的处置)。
 * 观测不影响主探活结论(独立端点最小请求已定 ok/fail);stream-failed 仅记录。
 */
async function observeGlmStreamBackflow(
  base: string,
  apiKey: string | undefined,
  model: string,
  deps: CapabilityProbeDeps,
): Promise<GlmStreamBackflowFinding> {
  const url = `${base.replace(/\/+$/, '')}/chat/completions`
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (apiKey !== undefined && apiKey !== '') headers['authorization'] = `Bearer ${apiKey}`
  // chat 声明形:外层 required type+web_search(29a R1);search_engine 必填。
  const body = {
    model,
    stream: true,
    messages: [{ role: 'user', content: PROBE_QUERY }],
    tools: [{ type: 'web_search', web_search: { search_engine: 'search_std' } }],
    tool_choice: 'auto', // GLM tool_choice 仅 "auto"(29a R1)
  }
  try {
    const response = await deps.fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    })
    if (!(response.status >= 200 && response.status < 300)) {
      const text = await response.text()
      return { observed: 'stream-failed', chunkCount: 0, detail: `HTTP ${response.status}: ${text.slice(0, 120)}` }
    }
    const text = await response.text()
    let chunkCount = 0
    let found = false
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '' || payload === '[DONE]') continue
      chunkCount += 1
      try {
        const chunk = JSON.parse(payload) as Record<string, unknown>
        if ('web_search' in chunk) found = true
      } catch { /* 非 JSON 帧不计数 */ }
    }
    return {
      observed: found ? 'top-level-web-search-in-chunk' : 'no-web-search-in-chunks',
      chunkCount,
      detail: found
        ? '流式 chunk 顶层观测到 web_search 字段(回填 29a R1 unresolved-①:回流位于 chunk 顶层)'
        : `流式完成(${chunkCount} 帧)未观测到 web_search 字段(R1-① 维持「chunk 无该字段」设计并回填)`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { observed: 'stream-failed', chunkCount: 0, detail: message.slice(0, 120) }
  }
}

/**
 * 逐能力路径探活(K4.2 主函数):按矩阵路径发最小验证请求;borrow 路径探活出借方
 * wire 路由(整条借用链,29 §2.4);兜底路径验证其配置(29 §3);三态判定见文件头注。
 */
export async function probeCapability(
  input: CapabilityProbeInput,
  deps: CapabilityProbeDeps,
): Promise<CapabilityProbeResult> {
  const { path } = input

  // 无路径(unavailable)= 无可发请求,结论如实标注不假装探活(§1 ⑤ 同源纪律)。
  if (path.route === 'unavailable' || path.adapter === 'none') {
    return unprobed(path, path.reason ?? '路径 unavailable——无可探活路径(29 §1 ⑤)')
  }

  // 探活目标供应商:borrow=出借方(29 §2.4 整条借用链);native/fallback=路径自带 provider。
  const targetProvider = path.route === 'borrow' ? path.lender : path.provider

  // --- Tavily 兜底:验证其配置(29 §3;GET /usage,R6) ---
  if (path.adapter === 'tavily-search' || path.adapter === 'tavily-extract') {
    const tavilyEnv = input.tavily?.apiKeyEnv
    if (tavilyEnv === undefined) {
      return unprobed(path, 'Tavily 兜底配置缺席(apiKeyEnv 未登记)——无法验证其配置')
    }
    const key = deps.resolveApiKey(tavilyEnv)
    if (key === undefined || key === '') {
      return {
        capability: path.capability, route: path.route, adapter: path.adapter,
        verdict: 'fail', latencyMs: 0, detail: `Tavily key 未解析(环境变量 ${tavilyEnv} 缺席)——配置验证失败`,
      }
    }
    const url = `${TAVILY_BASE_URL}/usage`
    const started = performance.now()
    try {
      const response = await deps.fetchImpl(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${tavilyBearer(key)}` },
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      })
      const latencyMs = Math.round(performance.now() - started)
      const text = await response.text()
      let parsed: unknown = text
      try { parsed = JSON.parse(text) } catch { /* 非 JSON 保留原文 */ }
      if (response.status >= 200 && response.status < 300) {
        return {
          capability: path.capability, route: path.route, adapter: path.adapter,
          verdict: 'ok', latencyMs, detail: `GET /usage HTTP ${response.status}(key 有效;R6)`,
          request: { method: 'GET', url },
        }
      }
      return {
        capability: path.capability, route: path.route, adapter: path.adapter,
        verdict: 'fail', latencyMs, detail: `HTTP ${response.status}: ${extractErrorBody(parsed)}`,
        request: { method: 'GET', url },
      }
    } catch (error) {
      const latencyMs = Math.round(performance.now() - started)
      const message = error instanceof Error ? error.message : String(error)
      return {
        capability: path.capability, route: path.route, adapter: path.adapter,
        verdict: 'fail', latencyMs, detail: message.slice(0, 200), request: { method: 'GET', url },
      }
    }
  }

  // --- generic 兜底(function calling 三段冒烟;R3) ---
  if (path.adapter === 'generic-function-loop') {
    const routeKey = input.genericRouteKey ?? 'generic'
    const route = input.routes[routeKey]
    if (route === undefined) return unprobed(path, `generic 兜底承载路由 ${routeKey} 缺席——无法构造探活`)
    if (route.api !== 'openai-completions') {
      return unprobed(path, `generic function calling 探活形仅定义于 OpenAI Chat 协议(路由 ${routeKey} api=${route.api ?? '(缺省)'};R3)`)
    }
    const model = path.model ?? route.models?.[0]?.id
    if (model === undefined) return unprobed(path, 'generic 路由无对话模型——无法构造探活')
    const url = `${(route.baseURL ?? '').replace(/\/+$/, '')}/chat/completions`
    // 1 个 function 工具(四件套形)+ tool_choice:"required" + 单轮(R3 修正行)。
    const body = {
      model,
      max_tokens: 64,
      messages: [{ role: 'user', content: 'Search the web for today\'s top news headline.' }],
      tools: [{
        type: 'function',
        function: {
          name: 'probe_capability_ping',
          description: '探活专用最小 function 工具(仅验证声明/解析/回灌三段,R3)',
          parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        },
      }],
      tool_choice: 'required',
      parallel_tool_calls: true,
    }
    const outcome = await postChat(url, deps.resolveApiKey(route.apiKeyEnv), body, deps)
    if (outcome.verdict === 'fail') {
      return {
        capability: path.capability, route: path.route, adapter: path.adapter,
        verdict: 'fail', latencyMs: outcome.latencyMs, detail: outcome.detail,
        request: { method: 'POST', url, body: JSON.stringify(body) },
      }
    }
    const message = chatMessage(outcome.body)
    if (message === undefined || !legalToolCalls(message)) {
      return {
        capability: path.capability, route: path.route, adapter: path.adapter,
        verdict: 'fail', latencyMs: outcome.latencyMs,
        detail: '响应 2xx 但未收到合法 tool_calls(声明/解析冒烟失败;R3)',
        request: { method: 'POST', url, body: JSON.stringify(body) },
      }
    }
    return {
      capability: path.capability, route: path.route, adapter: path.adapter,
      verdict: 'ok', latencyMs: outcome.latencyMs, detail: `HTTP ${outcome.detail} + 合法 tool_calls(R3 三段冒烟通过)`,
      request: { method: 'POST', url, body: JSON.stringify(body) },
    }
  }

  // --- MiMo 路径(原生或档 B 借用):降级 auto + web_search 声明的合法响应(R2) ---
  if (path.adapter === 'mimo-chat-web-search') {
    if (targetProvider === undefined) return unprobed(path, '路径缺目标供应商(原生 provider/借用 lender)')
    const route = input.routes[targetProvider]
    if (route === undefined) return unprobed(path, `${targetProvider} wire 路由缺席——无法构造探活`)
    if (route.api !== 'openai-completions') {
      return unprobed(path, `MiMo web_search 仅 OpenAI Chat 协议(路由 api=${route.api ?? '(缺省)'};29a R2)`)
    }
    const model = path.model ?? route.models?.[0]?.id
    if (model === undefined) return unprobed(path, 'MiMo 路径缺模型(原生=对话模型;档 B=出借方解析模型)')
    const url = `${(route.baseURL ?? '').replace(/\/+$/, '')}/chat/completions`
    // tool_choice 降级 auto(R2 修正:required/指定形不可用);声明含 web_search。
    const body = {
      model,
      max_tokens: 64,
      messages: [{ role: 'user', content: PROBE_QUERY }],
      tools: [{ type: 'web_search' }],
      tool_choice: 'auto',
    }
    const outcome = await postChat(url, deps.resolveApiKey(route.apiKeyEnv), body, deps)
    if (outcome.verdict === 'fail') {
      return {
        capability: path.capability, route: path.route, adapter: path.adapter,
        ...(path.lender !== undefined ? { lender: path.lender } : {}),
        verdict: 'fail', latencyMs: outcome.latencyMs, detail: outcome.detail,
        request: { method: 'POST', url, body: JSON.stringify(body) },
      }
    }
    const message = chatMessage(outcome.body)
    if (message === undefined) {
      return {
        capability: path.capability, route: path.route, adapter: path.adapter,
        ...(path.lender !== undefined ? { lender: path.lender } : {}),
        verdict: 'fail', latencyMs: outcome.latencyMs, detail: '响应 2xx 但无 choices[0].message(非合法响应;R2)',
        request: { method: 'POST', url, body: JSON.stringify(body) },
      }
    }
    // message.error_message 承载链路错误(R2)——非空即 fail。
    const chainError = message['error_message']
    if (typeof chainError === 'string' && chainError !== '') {
      return {
        capability: path.capability, route: path.route, adapter: path.adapter,
        ...(path.lender !== undefined ? { lender: path.lender } : {}),
        verdict: 'fail', latencyMs: outcome.latencyMs, detail: `message.error_message: ${chainError.slice(0, 200)}`,
        request: { method: 'POST', url, body: JSON.stringify(body) },
      }
    }
    return {
      capability: path.capability, route: path.route, adapter: path.adapter,
      ...(path.lender !== undefined ? { lender: path.lender } : {}),
      verdict: 'ok', latencyMs: outcome.latencyMs,
      detail: `HTTP ${outcome.detail} + 含 web_search 声明的合法响应(降级 auto;R2)`,
      request: { method: 'POST', url, body: JSON.stringify(body) },
    }
  }

  // --- deepseek 端点族:web_search→/v1/tools/search、read_url→/v1/tools/fetch(R4) ---
  const isDeepseekAdapter = path.adapter === 'deepseek-server-tools'
    || path.adapter === 'deepseek-anthropic-web-search'
    || path.adapter === 'deepseek-tools-api'
  if (isDeepseekAdapter) {
    if (targetProvider === undefined) return unprobed(path, '路径缺目标供应商(原生 provider/借用 lender)')
    const route = input.routes[targetProvider]
    if (route === undefined || route.baseURL === undefined || route.baseURL === '') {
      return unprobed(path, `${targetProvider} wire 路由缺席——无法构造探活`)
    }
    if (path.capability === 'files') {
      return unprobed(path, 'deepseek files 探活形态未在 36 号 K4.2 拍板(Files 上传即解析计费 ¥1.5/1000 页,无零成本最小验证形)')
    }
    if (path.capability !== 'web_search' && path.capability !== 'read_url') {
      return unprobed(path, `deepseek 路径 ${path.capability} 无 K4.2 探活形态定义`)
    }
    const endpointPath = path.capability === 'web_search' ? '/v1/tools/search' : '/v1/tools/fetch'
    const url = joinEndpoint(route.baseURL, endpointPath)
    // 最小体:search={query}(1–128 字符)、fetch={url}(R4 官方 api/search|api/fetch 页)。
    const body = path.capability === 'web_search' ? { query: PROBE_QUERY } : { url: PROBE_URL }
    const outcome = await postJson(url, deps.resolveApiKey(route.apiKeyEnv), body, deps)
    return {
      capability: path.capability, route: path.route, adapter: path.adapter,
      ...(path.lender !== undefined ? { lender: path.lender } : {}),
      verdict: outcome.verdict, latencyMs: outcome.latencyMs, detail: outcome.detail,
      request: { method: 'POST', url, body: JSON.stringify(body) },
    }
  }

  // --- glm 端点族:web_search→/paas/v4/web_search(三必填)、read_url→/paas/v4/reader(R1) ---
  const isGlmAdapter = path.adapter === 'glm-chat-web-search'
    || path.adapter === 'glm-web-search-api'
    || path.adapter === 'glm-reader'
  if (isGlmAdapter) {
    if (targetProvider === undefined) return unprobed(path, '路径缺目标供应商(原生 provider/借用 lender)')
    const route = input.routes[targetProvider]
    if (route === undefined || route.baseURL === undefined || route.baseURL === '') {
      return unprobed(path, `${targetProvider} wire 路由缺席——无法构造探活`)
    }
    if (path.capability === 'files') {
      return unprobed(path, 'glm files 探活形态未在 36 号 K4.2 拍板(上传→parser 链路无零成本最小验证形)')
    }
    if (path.capability !== 'web_search' && path.capability !== 'read_url') {
      return unprobed(path, `glm 路径 ${path.capability} 无 K4.2 探活形态定义`)
    }
    const endpointPath = path.capability === 'web_search' ? '/paas/v4/web_search' : '/paas/v4/reader'
    const url = joinEndpoint(route.baseURL, endpointPath)
    // 最小体:web_search 三必填(search_query≤70+search_engine+search_intent,K3.4 档 A=R1);reader {url}。
    const body = path.capability === 'web_search'
      ? { search_query: PROBE_QUERY, search_engine: 'search_std', search_intent: false }
      : { url: PROBE_URL }
    const outcome = await postJson(url, deps.resolveApiKey(route.apiKeyEnv), body, deps)
    const result: CapabilityProbeResult = {
      capability: path.capability, route: path.route, adapter: path.adapter,
      ...(path.lender !== undefined ? { lender: path.lender } : {}),
      verdict: outcome.verdict, latencyMs: outcome.latencyMs, detail: outcome.detail,
      request: { method: 'POST', url, body: JSON.stringify(body) },
    }
    // R1 unresolved-① 处置:glm 原生 chat web_search 附一次流式真调观测(不影响主结论)。
    if (path.adapter === 'glm-chat-web-search' && path.model !== undefined) {
      const finding = await observeGlmStreamBackflow(route.baseURL, deps.resolveApiKey(route.apiKeyEnv), path.model, deps)
      return { ...result, glmStreamBackflow: finding }
    }
    return result
  }

  return unprobed(path, `适配器 ${path.adapter} 的探活形态未在 36 号 K4.2 拍板——如实标注,不发明`)
}
