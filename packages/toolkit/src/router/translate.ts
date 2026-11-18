/**
 * 参数翻译(29 §1 ②:声明 → 提供方 API 形态的纯函数翻译;路由器不执行)。
 *
 * 各分支字段来源(逐条):
 * - GLM:契约参数与 tools[].web_search 子字段几乎 1:1(29a R1);tool_choice 仅 "auto";
 *   reader 请求 url/timeout(默认 20)/return_format(默认 markdown)。
 * - deepseek:服务端工具声明 type 必填、name 可选(官方 schema 不校验 name,29a R4);
 *   files 契约意图 → purpose 三分(29a R4:layoutAware→rich_layout_recognition,否则 text_recognition)。
 * - generic:R3 八条裁剪之发送侧四件套 {type:'function',function:{name,description,parameters}};
 *   name 过契约命名规范;tool_choice 三值+嵌套形原样;parallel_tool_calls 显式声明。
 * - Tavily:/search 字段(29a R6):count→max_results(0–20,超出截断)、recency→time_range、
 *   include_published_date 默认 false **须显式开**(本翻译恒 true)、contentSize 无对位字段(如实丢弃,注记)。
 * - MiMo:tool_choice 降级——契约 required/嵌套指定形一律降为 auto(29a R2 修正,全协议不可用)。
 */
import type { FilesParams, ReadUrlParams, RecencyFilter, ToolChoice, WebSearchParams } from '../contract/capabilities.ts'
import { TOOL_CHOICE_DOWNGRADES } from '../contract/capabilities.ts'
import { assertValidToolName } from '../contract/naming.ts'

/** recency 契约值 → Tavily time_range(noLimit 无对位,省略;29a R6)。 */
const TAVILY_TIME_RANGE: Readonly<Record<Exclude<RecencyFilter, 'noLimit'>, 'day' | 'week' | 'month' | 'year'>> = {
  oneDay: 'day',
  oneWeek: 'week',
  oneMonth: 'month',
  oneYear: 'year',
}

// ---------------------------------------------------------------------------
// GLM 分支
// ---------------------------------------------------------------------------

/** GLM `tools[].web_search` 声明形(外层 required type+web_search;29a R1)。 */
export interface GlmWebSearchToolDeclaration {
  readonly tools: readonly [{
    readonly type: 'web_search'
    readonly web_search: {
      readonly search_query: string
      readonly search_engine: string
      readonly count: number
      readonly search_domain_filter?: readonly string[]
      readonly search_recency_filter: string
      readonly content_size: string
    }
  }]
  readonly tool_choice: 'auto'
}

/** web_search 契约参数 → GLM chat 工具声明(1:1 映射;29a R1 对 §4 修正行)。 */
export function toGlmWebSearchTool(params: WebSearchParams): GlmWebSearchToolDeclaration {
  const domainFilter = params.domainFilter ?? []
  return {
    tools: [{
      type: 'web_search',
      web_search: {
        search_query: params.query, // 强制触发位
        search_engine: params.engine ?? 'search_std',
        count: params.count ?? 10,
        ...(domainFilter.length > 0 ? { search_domain_filter: [...domainFilter] } : {}),
        search_recency_filter: params.recency ?? 'noLimit',
        content_size: params.contentSize ?? 'medium',
      },
    }],
    tool_choice: 'auto', // GLM tool_choice 仅 "auto"(29a R1)
  }
}

/** read_url 契约参数 → GLM /paas/v4/reader 请求体(29a R1 reader 行)。 */
export function toGlmReaderBody(params: ReadUrlParams): { url: string; timeout: number; return_format: string } {
  return {
    url: params.url,
    timeout: params.timeout ?? 20,
    return_format: params.returnFormat ?? 'markdown',
  }
}

// ---------------------------------------------------------------------------
// deepseek 分支
// ---------------------------------------------------------------------------

/** deepseek 服务端工具声明类型(第三类 web_search_2025* 形态属 v4-pro 行,由路由句柄区分;29a R4)。 */
export type DeepseekServerToolType = 'deepseek_web_search' | 'deepseek_read_url'

/** deepseek Messages 请求的 tools 声明(type 必填;name 可选且服务端不校验——不发,29a R4)。 */
export function toDeepseekServerTools(capabilities: readonly ('web_search' | 'read_url')[]): {
  readonly tools: readonly { readonly type: DeepseekServerToolType }[]
} {
  // 组装防呆(不能与其他服务端工具同传/同一工具两次/tool_choice 指定它们均 400)在适配器(K2.1);
  // 本翻译只产声明形态,且按入参去重保序。
  const seen = new Set<string>()
  const tools: { type: DeepseekServerToolType }[] = []
  for (const capability of capabilities) {
    const type: DeepseekServerToolType = capability === 'web_search' ? 'deepseek_web_search' : 'deepseek_read_url'
    if (!seen.has(type)) {
      seen.add(type)
      tools.push({ type })
    }
  }
  return { tools }
}

/** files 契约意图 → deepseek purpose(29a R4 三分:user_data 按文件类型选择属适配器 K2.2 防呆)。 */
export function toDeepseekFilePurpose(params: FilesParams): 'text_recognition' | 'rich_layout_recognition' {
  return params.layoutAware === true ? 'rich_layout_recognition' : 'text_recognition'
}

// ---------------------------------------------------------------------------
// generic 分支(R3 八条裁剪之发送侧)
// ---------------------------------------------------------------------------

/** generic function 定义四件套(朴素 JSON Schema 子集;不发 strict/custom/allowed_tools 等)。 */
export interface GenericFunctionTool {
  readonly type: 'function'
  readonly function: {
    readonly name: string
    readonly description: string
    readonly parameters: Readonly<Record<string, unknown>>
  }
}

/** 构造 generic function 工具定义(工具名过契约命名规范——29a R3 ≤64/^[a-zA-Z0-9_-]+$/)。 */
export function toGenericFunctionTool(input: {
  readonly name: string
  readonly description: string
  readonly parameters: Readonly<Record<string, unknown>>
}): GenericFunctionTool {
  assertValidToolName(input.name)
  return {
    type: 'function',
    function: { name: input.name, description: input.description, parameters: input.parameters },
  }
}

/** generic 请求的工具调用控制附加位(R3:parallel_tool_calls 显式声明,避免供应商默认差异)。 */
export const GENERIC_TOOL_CALL_FLAGS = { parallel_tool_calls: true } as const

// ---------------------------------------------------------------------------
// Tavily 分支(R6)
// ---------------------------------------------------------------------------

/** web_search 契约参数 → Tavily /search 请求体。 */
export function toTavilySearchBody(params: WebSearchParams): {
  readonly query: string
  readonly max_results: number
  readonly include_domains?: readonly string[]
  readonly time_range?: 'day' | 'week' | 'month' | 'year'
  readonly include_published_date: true
} {
  const domainFilter = params.domainFilter ?? []
  const recency = params.recency ?? 'noLimit'
  // count(GLM 1–50)→max_results(Tavily 0–20):上限截断,如实不放大。
  const count = params.count ?? 10
  const timeRange = recency === 'noLimit' ? undefined : TAVILY_TIME_RANGE[recency]
  return {
    query: params.query,
    max_results: Math.min(count, 20),
    ...(domainFilter.length > 0 ? { include_domains: [...domainFilter] } : {}),
    ...(timeRange !== undefined ? { time_range: timeRange } : {}), // noLimit → 省略
    include_published_date: true, // R6:默认 false,须显式开启
    // 注记:contentSize 在 Tavily 无对位字段——翻译如实丢弃(不虚构对位)。
  }
}

/** read_url 契约参数 → Tavily /extract 请求体(5 URL/credit;29a R6)。 */
export function toTavilyExtractBody(params: ReadUrlParams): { readonly urls: readonly [string] } {
  return { urls: [params.url] }
}

// ---------------------------------------------------------------------------
// tool_choice 翻译规则位
// ---------------------------------------------------------------------------

/**
 * tool_choice 分支翻译:glm/mimo 一律降级 'auto'(TOOL_CHOICE_DOWNGRADES,29a R1/R2 修正);
 * generic 原样三值+嵌套指定形(R3)。入参须先经 normalizeToolChoice 校验。
 */
export function translateToolChoice(target: 'glm' | 'mimo' | 'generic', choice: ToolChoice): ToolChoice {
  if (target === 'glm' || target === 'mimo') return TOOL_CHOICE_DOWNGRADES[target]
  return choice
}
