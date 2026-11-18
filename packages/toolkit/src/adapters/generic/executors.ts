/**
 * generic 兜底执行器(36 号 K2.3「executors.ts(knowledge→tavily 搜索、/extract 读网、files 混合兜底)」)。
 *
 * 搜索供给链(29 §7-1 Q1 拍板原文):
 *   ① 内部知识库优先(knowledge_search 现成工具,注入形态——36 §1.3「直接消费现有工具」;
 *      注入避免 toolkit→knowledge 硬依赖,装配发生在宿主插件组装面);
 *   ② Web 层按路由器结论启用(原生/借用由 K3.4/原生适配器承接——generic 执行器只在
 *      裁决落 fallback 段时被调用,本文件不实现原生/借用);
 *   ③ 最终兜底:Tavily(按部署配置;未配置且无原生可用=显式降级,绝不静默外发,29 §7-1)。
 *
 * egress 联动(29 §6 governance 行 + 26 §4.3 配方):出网执行一律先过 egress 三态判定,
 * `outbound-denied` 即拒绝(显式降级、零网络请求);generic 的 tavily 执行器另以
 * defineTool 形态(toolSpecs)供宿主经 ctx.tools.register 注册——governance pre-execute
 * 瀑布自动覆盖,执行器不自带网络旁路(36 §1.4)。
 *
 * files 混合兜底(29 §7-3 Q3 拍板):图片对视觉模型 base64 内联;文档文本抽取+体积上限;
 * 不可解析→显式降级(unavailable 结果+错误步骤块,不静默消失);矩阵标注 generic=文本级。
 * 文本抽取器注入(部署接本地或服务端抽取)——generic 提供方(function calling 最大公约数)
 * 无文件端点,本包不发明解析器。
 *
 * 规范化块映射(29 §1 ④;块类型注释即字段来源):
 * - generic 工具调用轮 → SearchStepBlock 时间线(web_search→action:'search' 带 query、
 *   read_url→action:'open_page' 带 url、其余→action:'tool_call');
 * - Tavily results[] → SourceBlock(title/url/content→summary/published_date→publishTime
 *   归一化容错解析/site→siteName/favicon→icon;score 仅内部排序参考不进块,R6);
 * - 降级/失败 → SearchStepBlock{status:'error', detail}——36 K2.3「unavailable 块/错误文案」
 *   在四类块协议内的承载形态(块协议无独立 unavailable 类型,以错误步骤块+结果 status 显式表达)。
 */
import type { CapabilityId, CapabilityRequest, ReadUrlParams, WebSearchParams } from '../../contract/capabilities.ts'
import { parseCapabilityParams } from '../../contract/capabilities.ts'
import type { NormalizedBlock, SearchStepBlock, SourceBlock } from '../../blocks/types.ts'
import { normalizePublishTime } from '../../blocks/types.ts'
import { serializeBlocks } from '../../blocks/guards.ts'
import type { GenericChatMessage, GenericChatStreamTransport, GenericChatTransport, ToolRoundTrace } from './loop.ts'
import { runToolLoop } from './loop.ts'
import type { TavilyClient, TavilySearchResult } from '../tavily/client.ts'
import { toGenericFunctionTool } from '../../router/translate.ts'
import type { GenericFunctionTool } from '../../router/translate.ts'

// ---------------------------------------------------------------------------
// 注入形态(egress 三态判定器/内部知识检索/文档抽取)
// ---------------------------------------------------------------------------

/**
 * egress 三态判定器(结构形态;@eterna/governance EgressLite.classify 满足此结构)。
 * 运行时无硬依赖;egress-wiring 测试以真实 EgressLite 验证结构兼容(36 K2.3 门禁)。
 */
export interface EgressGate {
  classify(tool: string): 'local' | 'outbound-allowed' | 'outbound-denied'
}

/** 内部知识检索注入(knowledge_search 现成工具的执行面;payload=工具 JSON 输出原样)。 */
export type InternalSearchFn = (query: string, signal?: AbortSignal) => Promise<{ readonly ok: boolean; readonly payload: unknown }>

/** 文档文本抽取注入(返回 null=不可解析;抛错=抽取失败——两者都显式降级)。 */
export type DocumentTextExtractor = (input: {
  readonly name: string
  readonly bytes: Uint8Array
  readonly signal?: AbortSignal
}) => Promise<string | null>

/** generic 执行器依赖集(全部可选注入;缺省=该层显式降级,绝不假装可用)。 */
export interface GenericExecutorDeps {
  readonly internal?: InternalSearchFn
  readonly tavily?: TavilyClient
  readonly egress?: EgressGate
  readonly extractText?: DocumentTextExtractor
}

/** 能力级结果(公共金集断言的消费物;golden 逐字段比对 status/reason?/blocks/toolResult?)。 */
export interface CapabilityOutcome {
  readonly capability: CapabilityId
  readonly status: 'ok' | 'degraded' | 'unavailable'
  readonly reason?: string
  readonly blocks: readonly NormalizedBlock[]
  /** 回灌/日志面内容(恒非空;R3 回灌纪律)。 */
  readonly toolResult?: string
  /** loop 终轮正文(仅对话驱动面存在)。 */
  readonly finalContent?: string | null
  /** 完整消息日志(R3 回灌序列证据;审计/调试面,golden 不比对)。 */
  readonly messages?: readonly GenericChatMessage[]
  readonly rounds?: readonly ToolRoundTrace[]
}

/** 出网工具名(egress 判定与 toolSpecs 注册共用同一名字——governance 瀑布按名判定)。 */
export const GENERIC_OUTBOUND_TOOLS = ['web_search', 'read_url'] as const

/** egress 三态预检:denied → 显式降级(零网络);无 egress 注入 → 放行(宿主未接 governance)。 */
function egressRefused(egress: EgressGate | undefined, tool: string): string | undefined {
  if (egress === undefined) return undefined
  if (egress.classify(tool) === 'outbound-denied') {
    return `出网工具 ${tool} 不在 egress 白名单(29 §6:governance pre-execute 联动;显式降级,零网络请求)`
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Tavily results → SourceBlock 归一化(R6 响应映射行)
// ---------------------------------------------------------------------------

/** 单条 Tavily result → SourceBlock(publishTime 归一化容错解析;siteName←site 不在响应契约内,省略)。 */
export function tavilyResultToSourceBlock(result: TavilySearchResult): SourceBlock {
  return {
    type: 'source',
    title: result.title ?? result.url ?? '(无标题)',
    url: result.url ?? '',
    summary: result.content ?? '',
    publishTime: normalizePublishTime(result.published_date ?? null),
    ...(result.favicon !== undefined && result.favicon !== null && result.favicon.length > 0 ? { icon: result.favicon } : {}),
  }
}

/** results 排序(score 降序——score 仅内部排序参考,不进块,R6)后映射。 */
export function tavilyResultsToSourceBlocks(results: readonly TavilySearchResult[]): readonly SourceBlock[] {
  return [...results]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .map(result => tavilyResultToSourceBlock(result))
}

/** 工具轮留痕 → 搜索步骤时间线块(web_search→search/read_url→open_page/其余→tool_call)。 */
export function roundTracesToStepBlocks(rounds: readonly ToolRoundTrace[]): readonly SearchStepBlock[] {
  const blocks: SearchStepBlock[] = []
  let step = 0
  for (const round of rounds) {
    for (const call of round.toolCalls) {
      step += 1
      const args = (call.arguments ?? {}) as Record<string, unknown>
      const query = typeof args['query'] === 'string' ? args['query'] : undefined
      const url = typeof args['url'] === 'string' ? args['url'] : undefined
      const action: SearchStepBlock['action'] = call.name === 'web_search' ? 'search' : call.name === 'read_url' ? 'open_page' : 'tool_call'
      blocks.push({
        type: 'search_step',
        step,
        action,
        ...(action === 'search' && query !== undefined ? { query } : {}),
        ...(action === 'open_page' && url !== undefined ? { url } : {}),
        status: call.status,
        ...(call.parseError !== undefined ? { detail: call.parseError } : {}),
      })
    }
  }
  return blocks
}

// ---------------------------------------------------------------------------
// ① web_search 执行器(知识库优先 → 原生/借用段(K3.4) → Tavily 兜底)
// ---------------------------------------------------------------------------

/** 搜索执行层结果(①内部/③兜底聚合;②由路由器在调用前裁决,不进本结构)。 */
export interface SearchExecution {
  readonly status: 'ok' | 'degraded' | 'unavailable'
  readonly reason?: string
  /** 供给层标记(internal=①;tavily=③;internal+tavily=①+③聚合)。 */
  readonly layers: readonly ('internal' | 'tavily')[]
  readonly blocks: readonly NormalizedBlock[]
  readonly toolResult: string
}

export async function executeWebSearch(
  params: WebSearchParams,
  deps: GenericExecutorDeps,
  signal?: AbortSignal,
): Promise<SearchExecution> {
  const refused = egressRefused(deps.egress, 'web_search')
  if (refused !== undefined) {
    return {
      status: 'degraded',
      reason: refused,
      layers: [],
      blocks: [{ type: 'search_step', step: 1, action: 'search', ...(params.query !== '' ? { query: params.query } : {}), status: 'error', detail: refused }],
      toolResult: JSON.stringify({ ok: false, degraded: true, reason: refused }),
    }
  }
  // ① 内部知识库优先(29 §7-1 Q1;失败不阻断兜底段——fail-soft,但如实入 toolResult)。
  let internalPayload: unknown
  let internalError: string | undefined
  if (deps.internal !== undefined) {
    try {
      const outcome = await deps.internal(params.query, signal)
      internalPayload = outcome.ok ? outcome.payload : undefined
      if (!outcome.ok) internalError = '内部知识库检索失败(fail-soft,详见 degraded 标记)'
    } catch (error) {
      internalError = `内部知识库检索异常(fail-soft): ${(error as Error).message}`
    }
  }
  // ③ Tavily 兜底(②原生/借用由路由器在调用前裁决——裁决为 native/borrow 时不进本执行器)。
  if (deps.tavily === undefined) {
    const reason = internalPayload !== undefined || deps.internal !== undefined
      ? '未配置 Tavily 且无原生/借用可用——搜索档位=仅内部,显式降级,绝不静默外发(29 §7-1)'
      : '未配置 Tavily 且无原生/借用可用,亦无内部知识库——web_search 显式不可用,绝不静默外发(29 §7-1)'
    return {
      status: deps.internal !== undefined ? 'degraded' : 'unavailable',
      reason,
      layers: deps.internal !== undefined ? ['internal'] : [],
      blocks: [
        {
          type: 'search_step',
          step: 1,
          action: 'search',
          query: params.query,
          status: 'error',
          detail: reason,
        },
      ],
      toolResult: JSON.stringify({ ok: false, degraded: true, layers: deps.internal !== undefined ? ['internal'] : [], internal: internalPayload ?? null, reason }),
    }
  }
  let sources: readonly SourceBlock[]
  let webError: string | undefined
  try {
    const response = await deps.tavily.search(params, ...(signal !== undefined ? [{ signal }] : []))
    sources = tavilyResultsToSourceBlocks(response.results ?? [])
  } catch (error) {
    webError = `Tavily /search 失败(兜底段显式降级): ${(error as Error).message}`
    sources = []
  }
  const layers: ('internal' | 'tavily')[] = []
  if (deps.internal !== undefined) layers.push('internal')
  layers.push('tavily')
  const reason = webError ?? internalError
  const blocks: NormalizedBlock[] = [
    { type: 'search_step', step: 1, action: 'search', query: params.query, status: webError === undefined ? 'ok' : 'error', ...(webError !== undefined ? { detail: webError } : {}) },
    ...sources,
  ]
  return {
    status: webError === undefined && internalError === undefined ? 'ok' : 'degraded',
    ...(reason !== undefined ? { reason } : {}),
    layers,
    blocks,
    toolResult: JSON.stringify({
      ok: webError === undefined,
      layers,
      internal: internalPayload ?? null,
      web: webError === undefined
        ? { provider: 'tavily', results: sources.map(source => ({ title: source.title, url: source.url, content: source.summary, published_date: source.publishTime })) }
        : null,
      ...(reason !== undefined ? { degraded_reason: reason } : {}),
    }),
  }
}

// ---------------------------------------------------------------------------
// read_url 执行器(Tavily /extract 兜底;5 URL/credit,R6)
// ---------------------------------------------------------------------------

export interface ReadUrlExecution {
  readonly status: 'ok' | 'degraded' | 'unavailable'
  readonly reason?: string
  readonly blocks: readonly NormalizedBlock[]
  readonly toolResult: string
}

export async function executeReadUrl(
  params: ReadUrlParams,
  deps: GenericExecutorDeps,
  signal?: AbortSignal,
): Promise<ReadUrlExecution> {
  const refused = egressRefused(deps.egress, 'read_url')
  if (refused !== undefined) {
    return {
      status: 'degraded',
      reason: refused,
      blocks: [{ type: 'search_step', step: 1, action: 'open_page', url: params.url, status: 'error', detail: refused }],
      toolResult: JSON.stringify({ ok: false, degraded: true, reason: refused }),
    }
  }
  if (deps.tavily === undefined) {
    const reason = '未配置 Tavily 且无原生/借用 read_url 可用(29 §7-1 供给链同构)——显式不可用,绝不静默外发'
    return {
      status: 'unavailable',
      reason,
      blocks: [{ type: 'search_step', step: 1, action: 'open_page', url: params.url, status: 'error', detail: reason }],
      toolResult: JSON.stringify({ ok: false, degraded: true, reason }),
    }
  }
  try {
    const response = await deps.tavily.extract(params, ...(signal !== undefined ? [{ signal }] : []))
    const first = response.results?.[0]
    if (first === undefined || first.failed === true || first.raw_content === null || first.raw_content === undefined) {
      const reason = 'Tavily /extract 未取得内容(失败 URL 不计费,R6)——read_url 显式降级'
      return {
        status: 'degraded',
        reason,
        blocks: [{ type: 'search_step', step: 1, action: 'open_page', url: params.url, status: 'error', detail: reason }],
        toolResult: JSON.stringify({ ok: false, degraded: true, url: params.url, reason }),
      }
    }
    return {
      status: 'ok',
      blocks: [{ type: 'search_step', step: 1, action: 'open_page', url: params.url, status: 'ok' }],
      toolResult: JSON.stringify({ ok: true, url: params.url, content: first.raw_content }),
    }
  } catch (error) {
    const reason = `Tavily /extract 失败: ${(error as Error).message}`
    return {
      status: 'degraded',
      reason,
      blocks: [{ type: 'search_step', step: 1, action: 'open_page', url: params.url, status: 'error', detail: reason }],
      toolResult: JSON.stringify({ ok: false, degraded: true, url: params.url, reason }),
    }
  }
}

// ---------------------------------------------------------------------------
// files 混合兜底(29 §7-3 Q3)
// ---------------------------------------------------------------------------

/** files 兜底输入(按类型混合:图片内联/文档抽取)。 */
export interface FilesFallbackInput {
  readonly kind: 'image' | 'document'
  readonly name: string
  readonly bytes: Uint8Array
  /** 图片 mediaType(图片内联必填;不发明默认值——data URL 前缀必须如实)。 */
  readonly mediaType?: string
}

/** files 兜底约束(体积上限必填——部署定值,契约未给数字,不发明默认)。 */
export interface FilesFallbackLimits {
  readonly maxBytes: number
}

export interface FilesFallbackItemResult {
  readonly name: string
  readonly kind: 'image' | 'document'
  readonly status: 'ok' | 'unavailable'
  readonly reason?: string
  /** 图片内联产物(base64 data URL;对视觉模型内联进消息,Q3 拍板)。 */
  readonly inlineDataUrl?: string
  /** 文档抽取文本(入消息内容)。 */
  readonly text?: string
  readonly block: SearchStepBlock
}

/**
 * files 混合兜底逐项执行:图片→base64 内联(视觉模型);文档→注入的文本抽取器+体积上限;
 * 不可解析/超限/未配置抽取器 → 显式降级(status=unavailable + 错误步骤块,不静默消失)。
 */
export async function executeFilesFallback(
  inputs: readonly FilesFallbackInput[],
  limits: FilesFallbackLimits,
  deps: GenericExecutorDeps,
  signal?: AbortSignal,
): Promise<readonly FilesFallbackItemResult[]> {
  const results: FilesFallbackItemResult[] = []
  let step = 0
  for (const input of inputs) {
    step += 1
    if (input.bytes.byteLength > limits.maxBytes) {
      const reason = `附件 ${input.name} 超体积上限(${input.bytes.byteLength} > ${limits.maxBytes} 字节)——显式降级(29 §7-3 Q3)`
      results.push({
        name: input.name,
        kind: input.kind,
        status: 'unavailable',
        reason,
        block: { type: 'search_step', step, action: 'tool_call', status: 'error', detail: reason },
      })
      continue
    }
    if (input.kind === 'image') {
      if (input.mediaType === undefined || input.mediaType.length === 0) {
        const reason = `图片 ${input.name} 缺 mediaType——base64 内联前缀必须如实,不发明默认值(36 K2.3)`
        results.push({ name: input.name, kind: input.kind, status: 'unavailable', reason, block: { type: 'search_step', step, action: 'tool_call', status: 'error', detail: reason } })
        continue
      }
      const base64 = toBase64(input.bytes)
      results.push({
        name: input.name,
        kind: input.kind,
        status: 'ok',
        inlineDataUrl: `data:${input.mediaType};base64,${base64}`,
        block: { type: 'search_step', step, action: 'tool_call', status: 'ok' },
      })
      continue
    }
    if (deps.extractText === undefined) {
      const reason = `文档 ${input.name} 无文本抽取器可用(generic 提供方无文件端点;部署未配置抽取)——显式降级(29 §7-3 Q3)`
      results.push({ name: input.name, kind: input.kind, status: 'unavailable', reason, block: { type: 'search_step', step, action: 'tool_call', status: 'error', detail: reason } })
      continue
    }
    try {
      const text = await deps.extractText({ name: input.name, bytes: input.bytes, ...(signal !== undefined ? { signal } : {}) })
      if (text === null || text.length === 0) {
        const reason = `文档 ${input.name} 不可解析(抽取器返回空)——显式降级,不静默消失(29 §7-3 Q3)`
        results.push({ name: input.name, kind: input.kind, status: 'unavailable', reason, block: { type: 'search_step', step, action: 'tool_call', status: 'error', detail: reason } })
        continue
      }
      results.push({ name: input.name, kind: input.kind, status: 'ok', text, block: { type: 'search_step', step, action: 'tool_call', status: 'ok' } })
    } catch (error) {
      const reason = `文档 ${input.name} 抽取失败: ${(error as Error).message}——显式降级(29 §7-3 Q3)`
      results.push({ name: input.name, kind: input.kind, status: 'unavailable', reason, block: { type: 'search_step', step, action: 'tool_call', status: 'error', detail: reason } })
    }
  }
  return results
}

/** Uint8Array → base64(node Buffer;分块防超长参数栈)。 */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

// ---------------------------------------------------------------------------
// 模型面工具定义 + defineTool 形态 toolSpecs(26 §4.3 配方;ctx.tools.register 注册面)
// ---------------------------------------------------------------------------

/** 本地工具规格(defineTool 四件套形态;宿主注册时 governance pre-execute 瀑布自动覆盖)。 */
export interface ToolkitToolSpec {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  execute(args: unknown, signal?: AbortSignal): Promise<unknown>
}

/** web_search 工具参数 schema(朴素 JSON Schema 子集,R3 第 3 条)。 */
const WEB_SEARCH_TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    query: { type: 'string', description: '搜索词' },
    count: { type: 'integer', minimum: 1, maximum: 50, description: '结果条数(默认 10)' },
  },
  required: ['query'],
} as const

/** read_url 工具参数 schema。 */
const READ_URL_TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    url: { type: 'string', description: '要读取的网页 URL' },
  },
  required: ['url'],
} as const

/**
 * generic 兜底的工具规格(两个出网工具):模型面 function 定义(loop 消费)与
 * defineTool 形态 toolSpec(ctx.tools.register 消费)同名同 schema——
 * governance 瀑布按名判定,egress 三态在 execute 内预检(双保险,36 §1.4)。
 */
export function buildGenericToolSpecs(deps: GenericExecutorDeps): {
  readonly functionTools: readonly GenericFunctionTool[]
  readonly toolSpecs: readonly ToolkitToolSpec[]
} {
  const webSearchSpec: ToolkitToolSpec = {
    name: 'web_search',
    description: '搜索:内部知识库优先,Web 层按部署供给链(原生/借用/Tavily 兜底)聚合来源卡。' + '入参 query 必填;结果含来源卡(title/url/summary/publishTime)。',
    parameters: WEB_SEARCH_TOOL_PARAMETERS,
    async execute(args, signal) {
      const record = (args ?? {}) as Record<string, unknown>
      const parsed = parseCapabilityParams('web_search', record)
      const execution = await executeWebSearch(parsed as unknown as WebSearchParams, deps, signal)
      return JSON.parse(execution.toolResult) as unknown
    },
  }
  const readUrlSpec: ToolkitToolSpec = {
    name: 'read_url',
    description: '读取网页内容(Tavily /extract 兜底;5 URL/credit)。入参 url 必填。',
    parameters: READ_URL_TOOL_PARAMETERS,
    async execute(args, signal) {
      const record = (args ?? {}) as Record<string, unknown>
      const parsed = parseCapabilityParams('read_url', record)
      const execution = await executeReadUrl(parsed as unknown as ReadUrlParams, deps, signal)
      return JSON.parse(execution.toolResult) as unknown
    },
  }
  const toolSpecs = [webSearchSpec, readUrlSpec]
  return {
    functionTools: toolSpecs.map(spec => toGenericFunctionTool({
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
    })),
    toolSpecs,
  }
}

// ---------------------------------------------------------------------------
// 能力级入口(公共金集断言的 generic 分支执行面)
// ---------------------------------------------------------------------------

/** 对话驱动面(注入 chat 传输;缺省=直接执行路径,不驱动模型)。 */
export interface GenericConversationOptions {
  readonly messages?: readonly GenericChatMessage[]
  readonly model?: string
  readonly transport?: GenericChatTransport
  readonly streamTransport?: GenericChatStreamTransport
  readonly signal?: AbortSignal
  readonly maxRounds?: number
}

/** 能力级入口的 files 附件面(files 兜底直执行,不经模型轮)。 */
export interface GenericFilesConversation extends GenericConversationOptions {
  readonly filesInputs?: readonly FilesFallbackInput[]
  readonly filesLimits?: FilesFallbackLimits
}

const VOICE_UNAVAILABLE_REASON = '语音供给链归 P-3 开发(29 §4 P-3/§7-2),generic 兜底不可路由——显式禁用态,不假装可用(36 号 §8/开放问题 O-9)'

/**
 * generic 兜底能力执行入口:
 * - web_search/read_url:有传输面 → runToolLoop 驱动(模型发 tool_calls→执行→回灌→循环);
 *   无传输面 → 直接执行供给链(块不含工具轮时间线);
 * - files:混合兜底直执行(无模型轮;params 表意图,实际输入经 filesInputs 传入);
 * - tts/asr:显式 unavailable(P-3/O-9)。
 */
export async function runGenericCapability(
  request: CapabilityRequest,
  deps: GenericExecutorDeps,
  conversation?: GenericFilesConversation,
): Promise<CapabilityOutcome> {
  const params = parseCapabilityParams(request.capability, request.params)
  if (request.capability === 'web_search' || request.capability === 'read_url') {
    if (conversation?.transport !== undefined || conversation?.streamTransport !== undefined) {
      const { functionTools } = buildGenericToolSpecs(deps)
      // 每次成功执行的执行器产物(与 trace 调用序一一对应:trace status==='ok' 的调用各占一组;
      // 执行器自身的降级状态/理由随组上浮为 outcome.status/reason——不吞降级)。
      const perCall: { blocks: NormalizedBlock[]; status: 'ok' | 'degraded' | 'unavailable'; reason?: string }[] = []
      const recordExecution = (execution: { blocks: readonly NormalizedBlock[]; status: 'ok' | 'degraded' | 'unavailable'; reason?: string }): void => {
        perCall.push({
          blocks: [...execution.blocks],
          status: execution.status,
          ...(execution.reason !== undefined ? { reason: execution.reason } : {}),
        })
      }
      let execute
      if (request.capability === 'web_search') {
        execute = async (call: { id: string; name: string; arguments: unknown }) => {
          const execution = await executeWebSearch(call.arguments as WebSearchParams, deps, conversation.signal)
          recordExecution(execution)
          return execution.toolResult
        }
      } else {
        execute = async (call: { id: string; name: string; arguments: unknown }) => {
          const execution = await executeReadUrl(call.arguments as ReadUrlParams, deps, conversation.signal)
          recordExecution(execution)
          return execution.toolResult
        }
      }
      const loop = await runToolLoop({
        ...(conversation.transport !== undefined ? { transport: conversation.transport } : {}),
        ...(conversation.streamTransport !== undefined ? { streamTransport: conversation.streamTransport } : {}),
        messages: conversation.messages ?? [{ role: 'user', content: JSON.stringify(params) }],
        tools: request.capability === 'web_search' ? functionTools.slice(0, 1) : functionTools.slice(1, 2),
        ...(conversation.model !== undefined ? { model: conversation.model } : {}),
        execute,
        ...(conversation.signal !== undefined ? { signal: conversation.signal } : {}),
        ...(conversation.maxRounds !== undefined ? { maxRounds: conversation.maxRounds } : {}),
      })
      // 时间线块对齐:ok 调用用执行器块组(带降级 detail);解析失败/执行抛错调用用 trace 派生步骤块。
      let groupIndex = 0
      const blocks: NormalizedBlock[] = []
      for (const round of loop.rounds) {
        for (const call of round.toolCalls) {
          if (call.status === 'ok') {
            const group = perCall[groupIndex]
            groupIndex += 1
            blocks.push(...(group?.blocks ?? roundTracesToStepBlocks([{ ...round, toolCalls: [call] }])))
          } else {
            blocks.push(...roundTracesToStepBlocks([{ ...round, toolCalls: [call] }]))
          }
        }
      }
      const traceErrors = loop.rounds.flatMap(round => round.toolCalls.filter(call => call.status === 'error').map(call => call.parseError ?? `${call.name} 执行失败`))
      const degradedReasons = perCall.filter(entry => entry.status !== 'ok').map(entry => entry.reason ?? `执行器 ${entry.status}`)
      const degraded = traceErrors.length > 0 || degradedReasons.length > 0
      return {
        capability: request.capability,
        status: degraded ? 'degraded' : 'ok',
        ...(degraded ? { reason: [...degradedReasons, ...traceErrors].join('; ') } : {}),
        blocks,
        toolResult: loop.rounds.map(round => round.toolCalls.map(call => call.result).join('\n')).filter(segment => segment.length > 0).join('\n'),
        finalContent: loop.finalContent,
        messages: loop.messages,
        rounds: loop.rounds,
      }
    }
    const direct = request.capability === 'web_search'
      ? await executeWebSearch(params as unknown as WebSearchParams, deps, conversation?.signal)
      : await executeReadUrl(params as unknown as ReadUrlParams, deps, conversation?.signal)
    return {
      capability: request.capability,
      status: direct.status,
      ...(direct.reason !== undefined ? { reason: direct.reason } : {}),
      blocks: direct.blocks,
      toolResult: direct.toolResult,
    }
  }
  if (request.capability === 'files') {
    const inputs = conversation?.filesInputs ?? []
    if (inputs.length === 0) {
      return {
        capability: 'files',
        status: 'unavailable',
        reason: 'files 兜底需要实际附件输入(filesInputs);空输入显式不可用(29 §7-3 Q3)',
        blocks: [],
        toolResult: 'files 兜底无附件输入——显式不可用(29 §7-3 Q3)',
      }
    }
    const limits = conversation?.filesLimits
    if (limits === undefined) {
      return {
        capability: 'files',
        status: 'unavailable',
        reason: 'files 兜底体积上限必填(filesLimits.maxBytes;29 §7-3 Q3「体积上限」)——部署未定值,不发明默认上限',
        blocks: [],
        toolResult: 'files 兜底未配置体积上限——显式不可用(29 §7-3 Q3)',
      }
    }
    const results = await executeFilesFallback(inputs, limits, deps, conversation?.signal)
    const anyUnavailable = results.some(result => result.status === 'unavailable')
    const toolResultEntries = results.map(result => ({
      name: result.name,
      kind: result.kind,
      status: result.status,
      ...(result.reason !== undefined ? { reason: result.reason } : {}),
    }))
    return {
      capability: 'files',
      status: anyUnavailable ? 'degraded' : 'ok',
      ...(anyUnavailable ? { reason: results.filter(result => result.reason !== undefined).map(result => result.reason).join('; ') } : {}),
      blocks: results.map(result => result.block),
      toolResult: JSON.stringify(toolResultEntries),
    }
  }
  // tts/asr:P-3 语音链(36 §8);O-9 未裁决前一律显式 unavailable。
  return {
    capability: request.capability,
    status: 'unavailable',
    reason: VOICE_UNAVAILABLE_REASON,
    blocks: [],
    toolResult: VOICE_UNAVAILABLE_REASON,
  }
}

/** 块序列化(渲染与 prompt 的唯一消费物;守卫内联——golden 断言与宿主共用)。 */
export function outcomeBlocksSerialized(outcome: CapabilityOutcome): string {
  return serializeBlocks(outcome.blocks)
}
