/**
 * AI 调用服务(T3.1,计划书 §6「AI 链路:进程内调用封装(llm-doctor 先例)」/测试计划 §5 T3.1):
 *
 * 进程内 LLM 调用的纯判定层——dsh 栈没有独立 `ctx.llm` 服务可 get(2026-11-11 实测
 * node_modules @deepseek-ai/dsh-* 无该服务名),「进程内 ctx.llm」的落地先例即
 * llm-doctor(packages/llm-doctor/src/doctor.ts pingModel):经官方 configEditor 解析
 * 宿主当前默认模型路由(agent-default-model 行 → provider 行),再按该路由协议真发
 * 一次补全——**与 agent 会话完全相同的 wire 路径**(同端点路径/同请求形态/同
 * process.env 取 key 面,packages/llm-openai adapter.ts:94 先例)。
 *
 * 本模块分层(全部纯函数/注入面,网关只做编排):
 * - 路由解析:resolveDefaultModelRoute(双面)——①configEditor 行清单(pi-ai 形态
 *   行 config.providers[provider]={api,baseURL,apiKeyEnv,models} 与 OpenAI 兼容
 *   适配器形态行 config 平铺 provider/baseURL/apiKeyEnv,如 @eterna/llm-openai);
 *   ②live patch 文本兜底面(dsh-config-editor 只暴露根级非 insert 行,承载行写在
 *   insert 块内时行清单不可见——2026-11-11 t7 隔离档实测,见 findCarrierInPatch 注);
 * - 可用性自检:checkAiAvailability——**只判断 key 的 env/.env 在场性,绝不回显密钥值**
 *   (createKeyPresenceResolver 返回 'env'|'dotenv'|undefined,无值出口);无 key 时
 *   调用方整体降级(测试计划 §5 T3.1(b)②,非 5xx、不炸宿主);
 * - wire 调用:aiChatCompletion——三协议(openai-completions/openai-responses/
 *   anthropic-messages)请求构造与响应文本反引,端点路径表与 llm-doctor
 *   doctor.ts API_ENDPOINT_PATHS 同源口径;
 * - 输出解析:元提示词的输出契约围栏(```prompt 建议稿块 / ```json 清单块)提取;
 * - 元提示词自管:AI_META_*_ENTRY_ID 指向注册表 meta 层条目(整文件值),调用方现读
 *   当前值作 system 消息——吃自己的狗粮(计划书 §4 待定项裁定)。
 *
 * 审计纪律:调用方(index.ts)对 unavailable/failed/completed 逐事件审计,字段只含
 * entryId/provider/model/latencyMs/reason——密钥值与 Authorization 头绝不入审计。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ConfigEditorFace, ConfigEditorRow } from './config-editor-write.ts'
import { readConfigEditorRows } from './config-editor-write.ts'
import { unquoteYamlScalar } from './persona-patch.ts'
import type { AiFinding, AiKeySource } from './types.ts'

/** 润色元提示词的注册表条目 id(registry.ts meta 层;吃狗粮的取值坐标)。 */
export const AI_META_POLISH_ENTRY_ID = 'meta.studio.ai-polish'

/** 审核元提示词的注册表条目 id。 */
export const AI_META_REVIEW_ENTRY_ID = 'meta.studio.ai-review'

/** 宿主默认模型声明行 id(dsh-base 既有行;provider/model 两个字段)。 */
export const AGENT_DEFAULT_MODEL_ROW_ID = 'agent-default-model'

/**
 * 各协议在 baseURL 后追加的端点路径——与 llm-doctor doctor.ts API_ENDPOINT_PATHS
 * 同一标定口径(2026-11-09 网关实测),保证与 agent 会话同 wire。
 */
export const AI_ENDPOINT_PATHS: Readonly<Record<string, string>> = {
  'openai-completions': 'chat/completions',
  'openai-responses': 'responses',
  'anthropic-messages': 'v1/messages',
} as const

/** 单次 AI 调用超时(毫秒;生成类调用比 llm-doctor 连通性 ping 的 12s 宽)。 */
export const AI_CALL_TIMEOUT_MS = 120_000

/** 极小 fetch 形态(测试注入同构假体;生产传全局 fetch;llm-doctor FetchLike 同款)。 */
export type AiFetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** 解析出的默认模型路由(wire 面;与 agent 会话同路由)。 */
export interface AiRoute {
  /** 声明该 provider 的承载行 id(llm-pi-ai / eterna-llm 等;审计与诊断用)。 */
  readonly rowId: string
  readonly provider: string
  readonly model: string
  readonly api: string
  readonly baseURL: string
  /** 凭据环境变量名(空=无凭据路由,如本地网关;值永不出本模块调用链)。 */
  readonly apiKeyEnv: string
}

/** 防御式收窄:普通对象(非数组非 null)。 */
function plainRecordOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** 模型目录核对:目录在场时模型须在目录内(llm-doctor probeModel 同款判定)。 */
function checkModelCatalog(rowId: string, models: unknown, model: string, provider: string): string | undefined {
  if (!Array.isArray(models) || models.length === 0) return undefined
  const ids = models
    .map(item => plainRecordOf(item)?.['id'])
    .filter((id): id is string => typeof id === 'string')
  if (!ids.includes(model)) {
    return `模型 ${model} 不在 ${rowId} 行 ${provider} 路由目录内(目录 ${ids.join('/')})`
  }
  return undefined
}

/**
 * 在 configEditor 行清单里找声明 provider 的承载行——先认 pi-ai 形态
 * (config.providers[provider] 子表),再认 OpenAI 兼容适配器形态(config 平铺
 * provider/baseURL)。返回 undefined=本面无承载行(调用方继续 fallback 面);
 * 返回 reason=本面已有结论(如目录不匹配,fail-closed 直接上报)。
 */
function findCarrierInRows(
  rows: readonly ConfigEditorRow[],
  provider: string,
  model: string,
): { readonly route: AiRoute } | { readonly reason: string } | undefined {
  for (const row of rows) {
    const providers = plainRecordOf(row.override['providers'])
    const sub = providers === undefined ? undefined : plainRecordOf(providers[provider])
    if (sub === undefined) continue
    const api = typeof sub['api'] === 'string' ? sub['api'] : ''
    const baseURL = typeof sub['baseURL'] === 'string' ? sub['baseURL'] : ''
    if (AI_ENDPOINT_PATHS[api] === undefined || baseURL === '') continue
    const catalogError = checkModelCatalog(row.entry.options.id, sub['models'], model, provider)
    if (catalogError !== undefined) return { reason: catalogError }
    return {
      route: {
        rowId: row.entry.options.id,
        provider,
        model,
        api,
        baseURL,
        apiKeyEnv: typeof sub['apiKeyEnv'] === 'string' ? sub['apiKeyEnv'] : '',
      },
    }
  }
  for (const row of rows) {
    if (row.override['provider'] !== provider) continue
    const baseURL = typeof row.override['baseURL'] === 'string' ? row.override['baseURL'] : ''
    if (baseURL === '') continue
    const catalogError = checkModelCatalog(row.entry.options.id, row.override['models'], model, provider)
    if (catalogError !== undefined) return { reason: catalogError }
    // OpenAI 兼容适配器(@eterna/llm-openai 先例):wire 固定 chat/completions。
    return {
      route: {
        rowId: row.entry.options.id,
        provider,
        model,
        api: 'openai-completions',
        baseURL,
        apiKeyEnv: typeof row.override['apiKeyEnv'] === 'string' ? row.override['apiKeyEnv'] : '',
      },
    }
  }
  return undefined
}

// ---------- live patch 文本面(fallback:configEditor 只暴露根级非 insert 行) ----------

/**
 * **为什么需要 patch 面(2026-11-11 t7 隔离档实测)**:dsh-config-editor 的
 * configuration()/edit 只覆盖**根级非 insert 行**(dsh-config-editor lib/index.js:97,100
 * 跳过 row.has("insert")——docs/eterna-web-profile.md 装载配方教训 1);承载行写在
 * `- insert:` 块内时(隔离档 eterna-llm 形态)configEditor 行清单不可见,但 agent 会话
 * 经 Loader 组合树照常可用。fallback 面直接结构解析 live patch 文本(与写回落点同一
 * 文件),只认平铺 OpenAI 兼容适配器形态——pi-ai 形态(嵌套 providers 映射)在
 * 生产档是根级行,configEditor 面本就可见,不在本面重复实现(如实边界)。
 */
interface PatchItemSpan {
  readonly id: string
  readonly start: number
  readonly end: number
  readonly indent: number
}

/** 收集 patch 里全部 `- id: X` 条目 span(根级行与 insert 块内条目都算)。 */
function collectPatchItemSpans(lines: readonly string[]): PatchItemSpan[] {
  const out: PatchItemSpan[] = []
  for (let i = 0; i < lines.length; i++) {
    const match = /^(\s*)- id: (\S+)\s*$/.exec(lines[i] ?? '')
    if (match === null) continue
    const indent = (match[1] ?? '').length
    let end = lines.length
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j] ?? ''
      if (next.trim() === '') continue
      const nextIndent = /^(\s*)/.exec(next)?.[1]?.length ?? 0
      if (nextIndent < indent || (nextIndent === indent && /^\s*- /.test(next))) {
        end = j
        break
      }
    }
    out.push({ id: match[2] ?? '', start: i, end, indent })
  }
  return out
}

/** 条目 span 内的标量 config 键读取(缩进 > 条目缩进的首个 `key: value`;引号剥离)。 */
function patchScalarOf(lines: readonly string[], span: PatchItemSpan, key: string): string | undefined {
  const pattern = new RegExp(`^\\s+${key}: (.+)$`)
  for (let i = span.start + 1; i < span.end; i++) {
    const line = lines[i] ?? ''
    const match = pattern.exec(line)
    if (match === null) continue
    const raw = (match[1] ?? '').trim()
    const unquoted = unquoteYamlScalar(raw)
    return (unquoted ?? raw).trim() === '' ? undefined : unquoted ?? raw
  }
  return undefined
}

/** 条目 span 内 `models:` 目录的模型 id 列表(无 models 键 → undefined=不核对)。 */
const MODELS_KEY_RE = /^\s+models:\s*$/
function patchModelIdsOf(lines: readonly string[], span: PatchItemSpan): string[] | undefined {
  const modelsLine = lines.findIndex((line, index) =>
    index > span.start && index < span.end && MODELS_KEY_RE.test(line))
  if (modelsLine < 0) return undefined
  const modelsIndent = /^(\s*)/.exec(lines[modelsLine] ?? '')?.[1]?.length ?? 0
  const ids: string[] = []
  for (let i = modelsLine + 1; i < span.end; i++) {
    const line = lines[i] ?? ''
    if (line.trim() === '') continue
    const indent = /^(\s*)/.exec(line)?.[1]?.length ?? 0
    if (indent <= modelsIndent) break
    const match = /^\s*- id: (\S+)\s*$/.exec(line)
    if (match !== null) ids.push(match[1] ?? '')
  }
  return ids
}

/** 从 live patch 文本读 agent-default-model(provider/model;缺席 → undefined)。 */
export function readDefaultModelFromPatch(patchText: string): { provider: string; model: string } | undefined {
  const lines = patchText.split('\n')
  const span = collectPatchItemSpans(lines).find(item => item.id === AGENT_DEFAULT_MODEL_ROW_ID)
  if (span === undefined) return undefined
  const provider = patchScalarOf(lines, span, 'provider')
  const model = patchScalarOf(lines, span, 'model')
  if (provider === undefined || model === undefined || provider === '' || model === '') return undefined
  return { provider, model }
}

/** 在 live patch 文本里找平铺 OpenAI 兼容适配器承载行(无 → undefined)。 */
export function findCarrierInPatch(patchText: string, provider: string, model: string): AiRoute | undefined {
  const lines = patchText.split('\n')
  for (const span of collectPatchItemSpans(lines)) {
    if (span.id === AGENT_DEFAULT_MODEL_ROW_ID) continue
    if (patchScalarOf(lines, span, 'provider') !== provider) continue
    const baseURL = patchScalarOf(lines, span, 'baseURL')
    if (baseURL === undefined || baseURL === '') continue
    const catalog = patchModelIdsOf(lines, span)
    if (catalog !== undefined && catalog.length > 0 && !catalog.includes(model)) continue
    return {
      rowId: span.id,
      provider,
      model,
      api: 'openai-completions',
      baseURL,
      apiKeyEnv: patchScalarOf(lines, span, 'apiKeyEnv') ?? '',
    }
  }
  return undefined
}

/** 默认模型路由解析的输入面(configEditor 行清单 + live patch 文本,后者可缺席)。 */
export interface AiRouteSources {
  readonly rows: readonly ConfigEditorRow[]
  readonly patchText: string | undefined
}

/**
 * 默认模型路由解析(双面):①agent-default-model 给出 provider/model(configEditor 行
 * 优先,live patch 兜底);②承载行先查 configEditor 行(pi-ai providers 表/平铺适配器),
 * 再 fallback live patch 平铺适配器(insert 块内承载行 configEditor 不可见,见
 * collectPatchItemSpans 注)。任一步不可得返回明示 reason(调用方降级,不抛)。
 */
export function resolveDefaultModelRoute(sources: AiRouteSources): { readonly route: AiRoute } | { readonly reason: string } {
  const defaultRow = sources.rows.find(row => row.entry.options.id === AGENT_DEFAULT_MODEL_ROW_ID)
  let provider = typeof defaultRow?.override['provider'] === 'string' ? defaultRow.override['provider'] : ''
  let model = typeof defaultRow?.override['model'] === 'string' ? defaultRow.override['model'] : ''
  if ((provider === '' || model === '') && sources.patchText !== undefined) {
    const fromPatch = readDefaultModelFromPatch(sources.patchText)
    if (fromPatch !== undefined) {
      provider = fromPatch.provider
      model = fromPatch.model
    }
  }
  if (provider === '' || model === '') {
    return { reason: `宿主未设默认模型(${AGENT_DEFAULT_MODEL_ROW_ID} 行的 provider/model 不可得;当前 provider=${provider || '(空)'} model=${model || '(空)'})` }
  }
  const fromRows = findCarrierInRows(sources.rows, provider, model)
  if (fromRows !== undefined) return fromRows
  if (sources.patchText !== undefined) {
    const fromPatch = findCarrierInPatch(sources.patchText, provider, model)
    if (fromPatch !== undefined) return { route: fromPatch }
  }
  return { reason: `默认模型路由不可解析:provider ${provider} 在任何 LLM 承载行(pi-ai providers 表或 OpenAI 兼容适配器行)中均无可用 baseURL` }
}

/**
 * 从 configEditor 行清单解析默认模型路由(单一输入面的便捷封装;测试与旧调用方用)。
 */
export function resolveAiRoute(rows: readonly ConfigEditorRow[]): { readonly route: AiRoute } | { readonly reason: string } {
  return resolveDefaultModelRoute({ rows, patchText: undefined })
}

/**
 * key 在场性解析器(工厂):process.env 优先('env'),其次各根目录 `.env` 文件内
 * `NAME=非空值` 行('dotenv')——**只返回来源枚举,绝无值出口**(AGENTS.md 凭据纪律:
 * 不写入被跟踪文件/日志;可用性自检只判在场性)。文件缺席/不可读视为该根无 dotenv。
 */
export function createKeyPresenceResolver(
  resolveRoots: () => readonly string[],
): (envName: string) => AiKeySource | undefined {
  return (envName: string) => {
    if (envName === '') return undefined
    const fromEnv = process.env[envName]
    if (typeof fromEnv === 'string' && fromEnv !== '') return 'env'
    for (const root of resolveRoots()) {
      if (root === '') continue
      let text: string
      try {
        text = readFileSync(join(root, '.env'), 'utf8')
      } catch {
        continue
      }
      const pattern = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(envName)}\\s*=\\S`, 'mu')
      if (pattern.test(text)) return 'dotenv'
    }
    return undefined
  }
}

/** 正则字面量转义(env 名只含标识符字符,防御式仍转义)。 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 可用性自检结论(零模型调用)。 */
export interface AiAvailability {
  readonly available: boolean
  readonly route?: AiRoute
  readonly keySource?: AiKeySource
  readonly reason?: string
}

/**
 * AI 可用性自检(T3.1):路由可解析(configEditor 行优先,live patch 兜底)→ key 在场
 * (env/.env)。无凭据路由(apiKeyEnv 空)视作可用(keyless)。任一步不可得给明示
 * reason。configEditor 缺席且 patch 缺席才是「服务缺席」级 reason;单缺 configEditor
 * 时 patch 面仍可解析(insert 块承载行,见 findCarrierInPatch 注)。
 */
export function checkAiAvailability(
  editor: ConfigEditorFace | undefined,
  patchText: string | undefined,
  keyPresence: (envName: string) => AiKeySource | undefined,
): AiAvailability {
  if (editor === undefined && patchText === undefined) {
    return { available: false, reason: 'configEditor 服务缺席且 live patch 不可读,无法解析模型路由' }
  }
  const resolved = resolveDefaultModelRoute({
    rows: editor === undefined ? [] : readConfigEditorRows(editor),
    patchText,
  })
  if ('reason' in resolved) return { available: false, reason: resolved.reason }
  const route = resolved.route
  if (route.apiKeyEnv === '') return { available: true, route, keySource: 'keyless' }
  const keySource = keyPresence(route.apiKeyEnv)
  if (keySource === undefined) {
    return {
      available: false,
      route,
      reason: `API key 环境变量 ${route.apiKeyEnv} 未设置(可用性自检只判断 env/.env 在场性,不回显密钥值)`,
    }
  }
  return { available: true, route, keySource }
}

/** 单次补全请求(wire 面;三协议同表)。 */
export interface AiChatRequest {
  readonly api: string
  readonly baseURL: string
  readonly model: string
  readonly apiKey?: string | undefined
  /** system 消息(元提示词当前值)。 */
  readonly system: string
  /** user 消息(条目元数据 + 受理文本)。 */
  readonly user: string
  readonly maxOutputTokens?: number
  readonly fetchImpl: AiFetchLike
  readonly timeoutMs?: number
}

/** 单次补全结果(text 为模型助手文本;失败时 error 携带 HTTP 状态与响应摘录)。 */
export interface AiChatResult {
  readonly ok: boolean
  readonly text: string
  readonly latencyMs: number
  readonly status?: number
  readonly error?: string
}

/** 从错误响应里摘可读原因(截 200 字符;llm-doctor extractError 同款口径)。 */
function extractErrorText(body: unknown): string {
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

/** 按协议反引助手文本(三协议;无文本 → undefined)。 */
function extractAssistantText(api: string, body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const record = body as Record<string, unknown>
  if (api === 'openai-completions') {
    const choice = (record['choices'] as Record<string, unknown>[] | undefined)?.[0]
    const message = choice?.['message'] as Record<string, unknown> | undefined
    return typeof message?.['content'] === 'string' ? message['content'] : undefined
  }
  if (api === 'openai-responses') {
    if (typeof record['output_text'] === 'string') return record['output_text']
    const output = record['output'] as (Record<string, unknown> | undefined)[] | undefined
    const texts: string[] = []
    for (const item of output ?? []) {
      const content = item?.['content'] as Record<string, unknown>[] | undefined
      for (const block of content ?? []) {
        if (block['type'] === 'text' && typeof block['text'] === 'string') texts.push(block['text'])
      }
    }
    return texts.length > 0 ? texts.join('\n') : undefined
  }
  if (api === 'anthropic-messages') {
    const content = record['content'] as Record<string, unknown>[] | undefined
    const texts: string[] = []
    for (const block of content ?? []) {
      if (block['type'] === 'text' && typeof block['text'] === 'string') texts.push(block['text'])
    }
    return texts.length > 0 ? texts.join('\n') : undefined
  }
  return undefined
}

/**
 * 跨协议兜底反引(2026-11-13 生产实测:网关可能以非请求协议的形态回包——
 * opendesign 网关在 anthropic-messages 路由上偶发回 openai 形态的空壳;按请求
 * 协议解析失败时,依次尝试其余两种形态,仍无文本才判空)。
 */
function extractAssistantTextGeneric(body: unknown): string | undefined {
  for (const api of ['openai-completions', 'openai-responses', 'anthropic-messages']) {
    const text = extractAssistantText(api, body)
    if (text !== undefined && text.trim() !== '') return text
  }
  return undefined
}

/** 空响应的可诊断事实(2026-11-13 生产:content=[] + stop_reason=end_turn,思考
 * 阶段耗尽输出预算/网关瞬断的典型形态;裸 JSON 对用户无意义,给可行动信息)。 */
function emptyResponseDiagnosis(body: unknown): string {
  let stopReason = '?'
  let outputTokens: unknown = '?'
  let blockTypes = '?'
  if (typeof body === 'object' && body !== null) {
    const record = body as Record<string, unknown>
    if (typeof record['stop_reason'] === 'string') stopReason = record['stop_reason']
    const usage = plainRecordOf(record['usage'])
    if (usage !== undefined) outputTokens = usage['output_tokens'] ?? '?'
    const content = record['content']
    blockTypes = Array.isArray(content)
      ? JSON.stringify(content.map(block => plainRecordOf(block)?.['type'] ?? '?'))
      : typeof content
  }
  return `模型返回空内容(stop_reason=${stopReason},输出块=${blockTypes},output_tokens=${outputTokens})——多为思考阶段耗尽输出预算或网关瞬断,重试通常可恢复;持续复现请检查模型路由的 API 协议形态`
}

/** 规范化 baseURL:去尾斜杠(llm-doctor cleanBase 同款)。 */
function cleanBase(base: string): string {
  return base.replace(/\/+$/, '')
}

/**
 * 单次 AI 补全(与 agent 会话同 wire):按协议构造请求(openai-completions 双消息 /
 * openai-responses instructions+input / anthropic-messages system+messages),Bearer
 * 凭据(三协议同款,LiteLLM 网关口径),超时经 AbortSignal.timeout;非 2xx/网络错误/
 * 超时统一 { ok:false, error }(不抛)。
 */
export async function aiChatCompletion(request: AiChatRequest): Promise<AiChatResult> {
  const suffix = AI_ENDPOINT_PATHS[request.api]
  if (suffix === undefined) {
    return { ok: false, text: '', latencyMs: 0, error: `不支持的协议:${request.api}(可测协议 ${Object.keys(AI_ENDPOINT_PATHS).join('/')})` }
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (request.apiKey !== undefined && request.apiKey !== '') headers['authorization'] = `Bearer ${request.apiKey}`
  if (request.api === 'anthropic-messages') headers['anthropic-version'] = '2023-06-01'
  const base = cleanBase(request.baseURL)
  const maxTokens = request.maxOutputTokens ?? 4096
  let url = ''
  let body: Record<string, unknown>
  if (request.api === 'openai-completions') {
    url = `${base}/chat/completions`
    body = {
      model: request.model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
    }
  } else if (request.api === 'openai-responses') {
    url = `${base}/responses`
    body = { model: request.model, max_output_tokens: maxTokens, instructions: request.system, input: request.user }
  } else {
    url = `${base}/v1/messages`
    body = {
      model: request.model,
      max_tokens: maxTokens,
      system: request.system,
      messages: [{ role: 'user', content: request.user }],
    }
  }
  const timeoutMs = request.timeoutMs ?? AI_CALL_TIMEOUT_MS
  const started = performance.now()
  try {
    const res = await request.fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const raw = await res.text()
    let parsed: unknown = raw
    try { parsed = JSON.parse(raw) } catch { /* 非 JSON 保留原文 */ }
    const latencyMs = Math.round(performance.now() - started)
    if (!(res.status >= 200 && res.status < 300)) {
      return { ok: false, text: '', latencyMs, status: res.status, error: `HTTP ${res.status}: ${extractErrorText(parsed)}` }
    }
    const text = extractAssistantText(request.api, parsed) ?? extractAssistantTextGeneric(parsed)
    if (text === undefined || text.trim() === '') {
      const excerpt = extractErrorText(parsed).slice(0, 120)
      return {
        ok: false,
        text: '',
        latencyMs,
        status: res.status,
        error: `${emptyResponseDiagnosis(parsed)}(响应摘录:${excerpt})`,
      }
    }
    return { ok: true, text, latencyMs, status: res.status }
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started)
    const message = error instanceof Error ? error.message : String(error)
    const timedOut = message.includes('timeout') || message.includes('Timeout') || message.includes('abort')
    return { ok: false, text: '', latencyMs, error: timedOut ? `超时(${timeoutMs}ms)` : message.slice(0, 200) }
  }
}

// ---------- 元提示词输出契约解析 ----------

/**
 * 提取指定语言标记的围栏代码块(取**最后一个**匹配块——模型偶发先给说明再给块时,
 * 契约块在后)。无匹配 → undefined。
 */
export function extractFencedBlock(text: string, tag: string): string | undefined {
  const pattern = new RegExp(`\`\`\`[ \\t]*${escapeRegExp(tag)}[^\\n]*\\n([\\s\\S]*?)\`\`\``, 'gu')
  let match: RegExpExecArray | null
  let content: string | undefined
  while ((match = pattern.exec(text)) !== null) {
    content = (match[1] ?? '').replace(/\n$/, '')
  }
  return content
}

/** 润色建议稿提取:契约块 ```prompt 优先;无块时整文兜底(framed=false 如实标注)。 */
export function extractDraftText(text: string): { text: string; framed: boolean } {
  const fenced = extractFencedBlock(text, 'prompt')
  if (fenced !== undefined && fenced.trim() !== '') return { text: fenced, framed: true }
  return { text: text.trim(), framed: false }
}

/** 审核清单解析结论:findings + framed;不可解析 → undefined(调用方降级明示)。 */
export type AiFindingsParse = { readonly findings: readonly AiFinding[]; readonly framed: boolean }

/** 单条清单项的防御式收窄(缺 message/未知 severity 的项丢弃,不炸整体)。 */
function normalizeFinding(item: unknown): AiFinding | undefined {
  const record = plainRecordOf(item)
  if (record === undefined) return undefined
  const message = record['message']
  if (typeof message !== 'string' || message.trim() === '') return undefined
  const severity = record['severity']
  const finding: AiFinding = {
    severity: severity === 'error' || severity === 'warning' ? severity : 'info',
    ...(typeof record['rule'] === 'string' && record['rule'] !== '' ? { rule: record['rule'] } : {}),
    message,
    ...(typeof record['suggestion'] === 'string' && record['suggestion'] !== '' ? { suggestion: record['suggestion'] } : {}),
  }
  return finding
}

/**
 * 审核问题清单提取:契约块 ```json 内的 JSON 数组(或 {findings:[…]} 包装);无块时
 * 尝试整文按 JSON 解析(宽松兜底,framed=false)。解析失败/非数组形态 → undefined。
 */
export function parseAiFindings(text: string): AiFindingsParse | undefined {
  const fenced = extractFencedBlock(text, 'json')
  const candidates: Array<{ raw: string; framed: boolean }> = []
  if (fenced !== undefined) candidates.push({ raw: fenced, framed: true })
  const whole = text.trim()
  if (whole.startsWith('[') || whole.startsWith('{')) candidates.push({ raw: whole, framed: false })
  for (const candidate of candidates) {
    let parsed: unknown
    try {
      parsed = JSON.parse(candidate.raw)
    } catch {
      continue
    }
    const list = Array.isArray(parsed)
      ? parsed
      : plainRecordOf(parsed)?.['findings']
    if (!Array.isArray(list)) continue
    const findings = list.map(normalizeFinding).filter((item): item is AiFinding => item !== undefined)
    return { findings, framed: candidate.framed }
  }
  return undefined
}

// ---------- user 消息构造(条目元数据 + 受理文本) ----------

/**
 * 构造 user 消息:条目元数据(id/层/型别/来源/字节预算/红线策略——红线 required 时
 * 明示「逐字保留红线锚点句」)+ 可选润色侧重点 + 受理文本(<<<PROMPT 围栏)。
 * 纯函数;层/型别标签与 ledger/UI 共用 LAYER_LABELS/ENTRY_KIND_LABELS 单一来源。
 */
export function buildAiEntryUserPayload(
  entry: {
    readonly id: string
    readonly layer: string
    readonly kind: string
    readonly source: string
    readonly maxBytes: number
    readonly redLine: string
    readonly redLineRuleSet?: string
  },
  text: string,
  options: { readonly instruction?: string | undefined; readonly textBytes: number },
): string {
  const lines = [
    `条目 id: ${entry.id}`,
    `层: ${entry.layer}`,
    `型别: ${entry.kind}`,
    `来源: ${entry.source}`,
    `字节上限: ${entry.maxBytes}(当前文本 ${options.textBytes} 字节)`,
    entry.redLine === 'required'
      ? `红线策略: required(${entry.redLineRuleSet ?? '?'})——红线锚点句必须逐字保留,不得改写、拆分或省略`
      : '红线策略: exempt(本条目不做红线锚点检查)',
  ]
  if (options.instruction !== undefined && options.instruction.trim() !== '') {
    lines.push(`润色要求: ${options.instruction.trim()}`)
  }
  lines.push('提示词全文:', '<<<PROMPT', text, 'PROMPT>>>')
  return lines.join('\n')
}
