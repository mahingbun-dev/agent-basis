/**
 * MiMo 适配器·对话侧(36 号 K3.3)——OpenAI Chat Completions 主通道。
 *
 * 全部字段级依据 29a R2(文档级已核实、未实测;流式回流字段形态待 K4.2 doctor 探活真调回填,36 §1.9):
 * - 主通道:web_search **仅 OpenAI Chat Completions 协议**(官方明示「暂不支持其他 API 协议」);
 *   base `https://api.xiaomimimo.com/v1`;支持模型 mimo-v2.6-flash/pro/pro-ultraspeed;
 * - 声明:`tools` 数组 `{type:'web_search', max_keyword, force_search, limit,
 *   user_location:{country/region/city}}`——子字段逐字段官方定义未展开(unresolved-③),
 *   limit 语义/默认值**待实测**(开放问题 O-12:实现期以探活/真调回填,字段表标注「待实测」);
 * - 回流(本任务核心):结果**不是 tool_calls**,而是 `choices[].message.annotations[]`,每条
 *   `type:'url_citation'` 含 `url/title/summary/site_name/publish_time/logo_url`——直接映射
 *   规范化块来源卡/引用角标(29a R2 对 §4 P-2 修正行);`message.error_message` 承载链路错误;
 *   `usage.web_search_usage={tool_usage,page_usage}` 记账(**禁入键**,适配器内部消耗,不进块);
 *   流式首包返回全部搜索来源;**开关有 5 分钟缓存**(探活结论须考虑缓存,K4.2);
 *   前置条件:控制台开通「联网服务插件」(未开通的探活失败形态进 K4.2 判定表);
 * - thinking 硬约束:V2.6 三模型默认 `thinking.type:'enabled'`;深度思考+多轮+历史含工具调用时,
 *   回传的 assistant 消息若含 tool_calls **必须完整回传 `reasoning_content`,否则 400**——
 *   适配器保存每轮回传并原样回灌(29a R2 thinking 行 + 修正行「契约层若丢弃推理内容,
 *   MiMo 分支必须另存」);思考模式下 temperature/top_p 服务端强制 1.0/0.95(透传侧记录);
 *   流式先 `delta.reasoning_content` 后 `delta.content`;
 * - tool_choice 降级:契约 required/嵌套指定/none → MiMo 分支一律 'auto'(29a R2 修正行——
 *   全协议可选值仅 auto,非 auto 值被后端移除、行为等同 auto);
 * - `tool_calls[].function.arguments` 为 JSON 字符串且可能非法(官方提示校验后执行)——
 *   复用 generic 线 parseToolCallArguments 容错解析(29a R2 function calling 行)。
 *
 * 通道分工:本文件只做请求组装/流解析/结果翻译成规范化块(29 §1 ③ 适配器职责);
 * HTTP 传输由宿主 llm-openai 薄传输层承载(Q5 拍板分层),无客户端工具循环
 * (web_search 是服务端内置工具,无客户端执行面;function 工具循环归 generic 线 K2.3)。
 */
import type { WebSearchParams } from '../../contract/capabilities.ts'
import { normalizeToolChoice } from '../../contract/capabilities.ts'
import { assertNoForbiddenKeys } from '../../contract/forbidden.ts'
import { assertValidToolName } from '../../contract/naming.ts'
import type { CitationBlock, NormalizedBlock, SourceBlock } from '../../blocks/types.ts'
import { normalizePublishTime } from '../../blocks/types.ts'
import { translateToolChoice } from '../../router/translate.ts'
import type { GenericFunctionTool } from '../../router/translate.ts'
import type { GenericToolCall, StreamTermination } from '../generic/loop.ts'
import { ToolCallStreamMerger, parseSseLine } from '../generic/loop.ts'

// ---------------------------------------------------------------------------
// 部署事实常量(K4.2 doctor 探活消费;全部引 29a R2)
// ---------------------------------------------------------------------------

/** web_search 支持模型(29a R2 web_search 行:仅 OpenAI Chat 协议;v2.5 系已于 2026-10-21 下线)。 */
export const MIMO_WEB_SEARCH_MODELS = ['mimo-v2.6-flash', 'mimo-v2.6-pro', 'mimo-v2.6-pro-ultraspeed'] as const

/** web_search 开关的服务端缓存时长(29a R2:「开关有 5 分钟缓存」——探活结论须考虑缓存,K4.2)。 */
export const MIMO_WEB_SEARCH_SWITCH_CACHE_MS = 300_000

/** web_search 前置条件(29a R2:控制台开通「联网服务插件」;未开通的探活失败形态进 K4.2 判定表)。 */
export const MIMO_WEB_SEARCH_PREREQUISITE = '控制台开通「联网服务插件」'

/**
 * 思考模式下服务端强制的采样参数(29a R2 thinking 行:temperature/top_p 强制 1.0/0.95——
 * 服务端行为,适配器只记录不强制;透传侧据此不虚构可调空间)。
 */
export const MIMO_THINKING_SAMPLING = { temperature: 1.0, topP: 0.95 } as const

/** thinking 默认态(29a R2:V2.6 三模型默认 enabled——非 OpenAI 标准参数,SDK 需 extra_body)。 */
export const MIMO_DEFAULT_THINKING = { type: 'enabled' } as const

// ---------------------------------------------------------------------------
// 协议形态(OpenAI Chat 子集 + MiMo 特有字段;朴素收窄)
// ---------------------------------------------------------------------------

/** thinking 配置(29a R2 thinking 行:enabled/disabled;V2.6 默认 enabled)。 */
export interface MimoThinkingConfig {
  readonly type: 'enabled' | 'disabled'
}

/** web_search 工具声明(29a R2 web_search 行;子字段逐字段定义未展开——unresolved-③/O-12 待实测)。 */
export interface MimoWebSearchToolDeclaration {
  readonly type: 'web_search'
  /** 一轮搜索的关键词条数上限(计费:一轮按 max_keyword 次计,29a R2)——语义待实测(O-12)。 */
  readonly max_keyword?: number
  /** 强制触发搜索(语义待实测,O-12)。 */
  readonly force_search?: boolean
  /** 结果条数(语义与默认值待实测,29a R2 unresolved-③/O-12——契约 count 的对位尝试)。 */
  readonly limit?: number
  readonly user_location?: { readonly country?: string; readonly region?: string; readonly city?: string }
}

/** `annotations[]` 单条:url_citation 引用回流(29a R2 web_search 行——本任务核心字段)。 */
export interface MimoUrlCitation {
  readonly type: 'url_citation'
  readonly url: string
  readonly title?: string | null
  readonly summary?: string | null
  /** 宽松供应商可能显式 null(Tavily favicon 同惯例,R6)。 */
  readonly site_name?: string | null
  readonly publish_time?: string | null
  readonly logo_url?: string | null
}

/**
 * MiMo chat 消息(OpenAI Chat 子集 + MiMo 特有字段,29a R2):
 * - assistant 回传可携带 `reasoning_content`(思考模式推理内容——含 tool_calls 的多轮回传
 *   必带,否则 400)与 `annotations`(web_search 引用回流)、`error_message`(链路错误);
 * - `tool` 角色回灌 function 工具结果(29a R2 function calling 行)。
 */
export interface MimoChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content?: string | null
  /** assistant 消息的原样 tool_calls(回灌序列与 generic 线同规)。 */
  readonly tool_calls?: readonly GenericToolCall[]
  /** tool 消息的 tool_call_id。 */
  readonly tool_call_id?: string
  /** assistant 回传的推理内容(思考模式)——含 tool_calls 消息多轮回传必带(29a R2 thinking 行)。 */
  readonly reasoning_content?: string | null
  /** assistant 回传的引用回流(29a R2 web_search 行)。 */
  readonly annotations?: readonly MimoUrlCitation[]
  /** web_search 链路错误承载(29a R2 web_search 行)。 */
  readonly error_message?: string | null
}

/** MiMo chat 请求(组装产物;tool_choice 已降级为 'auto';thinking 为 MiMo 特有顶层参数)。 */
export interface MimoChatRequest {
  readonly model?: string
  readonly messages: readonly MimoChatMessage[]
  /** web_search 声明与 function 工具可同传(29a R2 无互斥记载,deepseek 的互斥是 R4 特有防呆)。 */
  readonly tools?: readonly (MimoWebSearchToolDeclaration | GenericFunctionTool)[]
  /** MiMo 全协议仅 auto(29a R2 修正行;组装时由契约值降级而来)。 */
  readonly tool_choice?: 'auto'
  readonly thinking?: MimoThinkingConfig
  readonly stream?: true
}

/** 非流式响应 message 形态(choices[0].message;annotations/error_message 为 MiMo 特有)。 */
export interface MimoChatResponseMessage {
  readonly role?: string
  readonly content?: string | null
  readonly reasoning_content?: string | null
  readonly tool_calls?: readonly GenericToolCall[]
  readonly annotations?: readonly MimoUrlCitation[]
  readonly error_message?: string | null
}

/** usage.web_search_usage 记账形态(29a R2;禁入键——适配器内部消耗,不进块)。 */
export interface MimoWebSearchUsage {
  readonly tool_usage?: number
  readonly page_usage?: number
}

/** 非流式响应(OpenAI Chat 子集;仅取契约消费字段)。 */
export interface MimoChatResponse {
  readonly choices?: readonly {
    readonly message?: MimoChatResponseMessage
    readonly finish_reason?: string | null
  }[]
  readonly usage?: { readonly web_search_usage?: MimoWebSearchUsage } & Record<string, unknown>
  readonly error?: { readonly message?: string } & Record<string, unknown>
}

/** 组装/回灌防呆错误(请求发出前静态拒绝)。 */
export class MimoRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MimoRequestError'
  }
}

/** 响应级失败(顶层 error 帧;显式抛出,绝不静默)。 */
export class MimoResponseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MimoResponseError'
  }
}

// ---------------------------------------------------------------------------
// 组装侧:契约参数 → web_search 声明 + tool_choice 降级
// ---------------------------------------------------------------------------

/**
 * web_search 契约参数 → MiMo 工具声明:count→limit(对位尝试,语义/默认值**待实测**——
 * 29a R2 unresolved-③/O-12,探活回填);query 进本轮用户消息(toMimoUserMessage,模型自主
 * 决定是否搜索);engine/domainFilter/recency/contentSize 无 MiMo 对位字段——如实丢弃
 * 不虚构(对照 deepseek 组装侧丢弃注记、Tavily contentSize 丢弃注记)。
 */
export function toMimoWebSearchTool(params: WebSearchParams): MimoWebSearchToolDeclaration {
  return {
    type: 'web_search',
    ...(params.count !== undefined ? { limit: params.count } : {}), // 待实测(O-12):limit 精确语义与默认值未获官方逐字段说明
  }
}

/** web_search 契约参数 → 用户消息(query 进消息文本;29a R2:搜索由服务端按对话自主触发)。 */
export function toMimoUserMessage(params: WebSearchParams): MimoChatMessage {
  return { role: 'user', content: params.query }
}

/** buildMimoChatRequest 入参。 */
export interface BuildMimoChatRequestInput {
  readonly model: string
  readonly messages: readonly MimoChatMessage[]
  /** web_search 能力开关(组装 {type:'web_search'} 声明进 tools;29a R2)。 */
  readonly webSearch?: WebSearchParams
  /** function 工具定义(与 web_search 可同传;name 过契约命名规范)。 */
  readonly functionTools?: readonly GenericFunctionTool[]
  /** thinking 缺省=不发送(服务端按 V2.6 默认 enabled 执行,29a R2)。 */
  readonly thinking?: MimoThinkingConfig
  /** 契约 tool_choice(none/auto/required/嵌套指定形)——一律降级 'auto'(29a R2 修正行)。 */
  readonly toolChoice?: unknown
}

/**
 * 组装 MiMo chat 请求(纯函数):
 * - tools 声明:web_search + function 工具(function 名过契约命名规范);
 * - tool_choice:声明了 tools 即必带,且恒为 'auto'(TOOL_CHOICE_DOWNGRADES.mimo;
 *   required/嵌套指定/none 全部降级——全协议仅 auto,29a R2);
 * - thinking:仅显式传入才发送(V2.6 服务端默认 enabled);
 * - 回灌防呆:含 tool_calls 的 assistant 消息缺 reasoning_content → 静态拒绝
 *   (thinking 未显式关闭即视同 enabled——400 场景防回归,29a R2 thinking 行);
 * - 禁入键深检(strict/functions/web_search_usage 等任何深度命中即抛,29a R3/R2)。
 */
export function buildMimoChatRequest(input: BuildMimoChatRequestInput): MimoChatRequest {
  if (input.functionTools !== undefined) {
    for (const tool of input.functionTools) {
      assertValidToolName(tool.function.name)
    }
  }
  const tools: (MimoWebSearchToolDeclaration | GenericFunctionTool)[] = []
  if (input.webSearch !== undefined) {
    tools.push(toMimoWebSearchTool(input.webSearch))
  }
  if (input.functionTools !== undefined) {
    tools.push(...input.functionTools)
  }
  // 契约 tool_choice 先过校验(非法形态在此抛),再经分支规则位降级——mimo 恒 'auto'
  // (TOOL_CHOICE_DOWNGRADES.mimo;29a R2 修正行:全协议仅 auto,非 auto 值被后端移除)。
  const validatedChoice = normalizeToolChoice(input.toolChoice ?? 'auto')
  const downgradedChoice = translateToolChoice('mimo', validatedChoice) as 'auto'
  const request: MimoChatRequest = {
    model: input.model,
    messages: [...input.messages],
    ...(tools.length > 0 ? { tools, tool_choice: downgradedChoice } : {}),
    ...(input.thinking !== undefined ? { thinking: input.thinking } : {}),
  }
  assertMimoReasoningRoundTrip(request.messages, input.thinking)
  assertNoForbiddenKeys(request)
  return request
}

// ---------------------------------------------------------------------------
// thinking 硬约束:reasoning_content 保存与多轮回灌(29a R2 thinking 行 + 修正行)
// ---------------------------------------------------------------------------

/**
 * 回灌防呆:深度思考 + 多轮 + 历史含工具调用时,含 tool_calls 的 assistant 消息必须完整
 * 回传 reasoning_content,否则 API 返回 400(29a R2 thinking 行)。thinking 未显式传入时
 * 按 V2.6 默认 enabled 检查;显式 disabled 时该规则前提(深度思考)不成立,不强制——
 * 不发明 disabled 态下的额外约束。
 */
export function assertMimoReasoningRoundTrip(
  messages: readonly MimoChatMessage[],
  thinking?: MimoThinkingConfig,
): void {
  if (thinking !== undefined && thinking.type === 'disabled') return
  for (const [index, message] of messages.entries()) {
    if (message.role !== 'assistant') continue
    if (message.tool_calls === undefined || message.tool_calls.length === 0) continue
    const reasoning = message.reasoning_content
    if (typeof reasoning !== 'string' || reasoning.length === 0) {
      throw new MimoRequestError(
        `messages[${index}] 为含 tool_calls 的 assistant 消息但未回传 reasoning_content`
        + '——MiMo 深度思考+多轮+历史含工具调用时缺失即 400(29a R2 thinking 行;适配器必须另存并原样回灌)',
      )
    }
  }
}

/** 保存的一轮 assistant 回传(含 reasoning_content——契约层若丢弃推理内容,MiMo 分支必须另存)。 */
export interface MimoAssistantTurn {
  readonly content: string | null
  readonly reasoningContent?: string | null
  readonly toolCalls?: readonly GenericToolCall[]
}

/**
 * MiMo 会话存储:保存每轮 assistant 回传(含 reasoning_content),回灌序列原样携带——
 * 「含 tool_calls 的 assistant 消息必带 reasoning_content」由保存面保证,请求侧再过
 * assertMimoReasoningRoundTrip 双保险(400 防回归)。不持传输面(适配器不持会话状态指
 * 会话执行状态;本存储是调用方持有的纯数据结构)。
 */
export interface MimoConversation {
  pushUser(content: string): void
  pushSystem(content: string): void
  /** 保存一轮 assistant 回传(parseMimoChatResponse/流式归并产物喂入)。 */
  pushAssistant(turn: MimoAssistantTurn): void
  /** function 工具结果回灌(每 tool_call 一条,恒非空——与 generic 线回灌纪律同规)。 */
  pushToolResult(toolCallId: string, content: string): void
  /** 回灌消息序列(含 tool_calls 的 assistant 消息原样携带 reasoning_content)。 */
  messages(): readonly MimoChatMessage[]
}

export function createMimoConversation(): MimoConversation {
  const messages: MimoChatMessage[] = []
  return {
    pushUser: (content) => {
      messages.push({ role: 'user', content })
    },
    pushSystem: (content) => {
      messages.push({ role: 'system', content })
    },
    pushAssistant: (turn) => {
      const toolCalls = turn.toolCalls
      messages.push({
        role: 'assistant',
        content: turn.content,
        ...(toolCalls !== undefined && toolCalls.length > 0
          ? mimoReasoningRoundTripFragment(toolCalls, turn.reasoningContent ?? null)
          : {}),
      })
    },
    pushToolResult: (toolCallId, content) => {
      messages.push({ role: 'tool', tool_call_id: toolCallId, content })
    },
    messages: () => [...messages],
  }
}

/**
 * 含 tool_calls 的 assistant 回灌片段:原样 tool_calls + reasoning_content
 * (29a R2 thinking 行:深度思考+多轮+历史含工具调用时,缺失回传即 400——
 * 保存了即原样回灌;未保存(如 disabled 态)由请求侧防呆按 thinking 形态裁决)。
 */
function mimoReasoningRoundTripFragment(
  toolCalls: readonly GenericToolCall[],
  reasoningContent: string | null,
): Pick<MimoChatMessage, 'tool_calls' | 'reasoning_content'> {
  return {
    tool_calls: toolCalls,
    ...(reasoningContent !== null && reasoningContent.length > 0 ? { reasoning_content: reasoningContent } : {}),
  }
}

// ---------------------------------------------------------------------------
// 回流解析:annotations[].url_citation → 规范化块(29a R2 web_search 行——本任务核心)
// ---------------------------------------------------------------------------

/** 单条 url_citation → 来源卡(§2.3 字段映射:url/title/summary/site_name/publish_time/logo_url)。 */
function urlCitationToSource(citation: MimoUrlCitation): SourceBlock {
  return {
    type: 'source',
    title: citation.title ?? citation.url, // 无标题时以 url 占位(不虚构标题,对照 Tavily 映射)
    url: citation.url,
    summary: citation.summary ?? '',
    publishTime: normalizePublishTime(citation.publish_time ?? null),
    ...(citation.site_name !== undefined && citation.site_name !== null && citation.site_name.length > 0
      ? { siteName: citation.site_name }
      : {}),
    ...(citation.logo_url !== undefined && citation.logo_url !== null && citation.logo_url.length > 0
      ? { icon: citation.logo_url }
      : {}),
  }
}

/** url_citation 类型判别(deepseek isWebSearchError 同款 unknown 收窄——防未经类型收口的自由拼装混入)。 */
function isUrlCitation(value: unknown): value is MimoUrlCitation {
  if (value === null || typeof value !== 'object') return false
  const record = value as { type?: unknown; url?: unknown }
  return record.type === 'url_citation' && typeof record.url === 'string' && record.url.length > 0
}

/**
 * annotations[] → 规范化块序列(来源卡 + 引用角标;29a R2「直接映射契约来源卡/引用角标块」):
 * - 每条 url_citation 一张来源卡 + 一个角标(角标序号=来源序号,index=sourceIndex+1——
 *   与 GLM refer=ref_N、deepseek 角标语义对齐,K1.3 注释);
 * - 同 URL 去重(两条角标指向同一来源卡时 sourceIndex 相同);
 * - 未知 annotation type 跳过(不虚构映射);
 * - 输出顺序:来源卡(流序)→ 引用角标(流序)——与 deepseek 投影顺序(mimo 无步骤时间线)一致。
 */
export function mimoAnnotationsToBlocks(annotations: readonly MimoUrlCitation[]): readonly NormalizedBlock[] {
  const sources: SourceBlock[] = []
  const urlToIndex = new Map<string, number>()
  const citations: CitationBlock[] = []
  for (const annotation of annotations) {
    if (!isUrlCitation(annotation)) continue // 未知 annotation type / 缺 url 条目跳过(不虚构映射)
    let sourceIndex = urlToIndex.get(annotation.url)
    if (sourceIndex === undefined) {
      sourceIndex = sources.length
      urlToIndex.set(annotation.url, sourceIndex)
      sources.push(urlCitationToSource(annotation))
    }
    citations.push({ type: 'citation', index: sourceIndex + 1, sourceIndex })
  }
  return [...sources, ...citations]
}

/** 解析产物:message 消费字段 + 规范化块 + 显式承载的链路错误与记账。 */
export interface MimoChatResult {
  readonly content: string | null
  readonly reasoningContent: string | null
  /** function 工具调用(arguments 可能非法 JSON——消费方须校验后执行,29a R2)。 */
  readonly toolCalls: readonly GenericToolCall[]
  readonly blocks: readonly NormalizedBlock[]
  /** message.error_message——web_search 链路错误(显式承载,不静默;29a R2)。 */
  readonly webSearchError?: string
  /** usage.web_search_usage 记账(适配器内部消耗;禁入键不进块,29 §2.1)。 */
  readonly searchUsage?: { readonly toolUsage?: number; readonly pageUsage?: number }
  readonly finishReason?: string | null
}

function toSearchUsage(usage: MimoWebSearchUsage | undefined): { toolUsage?: number; pageUsage?: number } | undefined {
  if (usage === undefined) return undefined
  return {
    ...(typeof usage.tool_usage === 'number' ? { toolUsage: usage.tool_usage } : {}),
    ...(typeof usage.page_usage === 'number' ? { pageUsage: usage.page_usage } : {}),
  }
}

/**
 * 解析非流式响应(纯函数):顶层 error → MimoResponseError(显式抛出);annotations →
 * 规范化块;message.error_message → webSearchError;usage.web_search_usage → searchUsage。
 * **web_search 结果不是 tool_calls**——annotations 才是回流位(29a R2 修正行,
 * 不得把 annotations 当 tool_calls 消费)。
 */
export function parseMimoChatResponse(response: MimoChatResponse): MimoChatResult {
  if (response.error !== undefined) {
    throw new MimoResponseError(`MiMo chat 响应顶层 error: ${JSON.stringify(response.error)}`)
  }
  const choice = response.choices?.[0]
  const message = choice?.message
  const annotations = message?.annotations ?? []
  const errorRaw = message?.error_message
  const searchUsage = toSearchUsage(response.usage?.web_search_usage)
  return {
    content: message?.content ?? null,
    reasoningContent: message?.reasoning_content ?? null,
    toolCalls: message?.tool_calls ?? [],
    blocks: mimoAnnotationsToBlocks(annotations),
    ...(typeof errorRaw === 'string' && errorRaw.length > 0
      ? { webSearchError: errorRaw }
      : errorRaw !== undefined && errorRaw !== null && typeof errorRaw !== 'string'
        ? { webSearchError: JSON.stringify(errorRaw) } // 非串形态保留证据(29a R2 未定义形态,不虚构解析)
        : {}),
    ...(searchUsage !== undefined ? { searchUsage } : {}),
    ...(choice?.finish_reason !== undefined ? { finishReason: choice.finish_reason } : {}),
  }
}

// ---------------------------------------------------------------------------
// 流式:首包全部搜索来源 + reasoning_content 先于 content + 三终结
// ---------------------------------------------------------------------------

/** 流式收集产物(R3 三终结如实透传;blocks 由累计 annotations 归一化)。 */
export interface MimoCollectedStream {
  readonly message: {
    readonly role: string
    readonly content: string | null
    readonly reasoningContent: string | null
    readonly toolCalls: readonly GenericToolCall[]
  }
  readonly blocks: readonly NormalizedBlock[]
  readonly finishReason: string | null
  readonly termination: StreamTermination
  /** termination='error' 时的错误帧原文。 */
  readonly streamError?: unknown
  readonly searchUsage?: { readonly toolUsage?: number; readonly pageUsage?: number }
}

function readChoice(payload: unknown): { delta?: Record<string, unknown>; finishReason?: string } {
  if (payload === null || typeof payload !== 'object') return {}
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return {}
  const choice = choices[0] as { delta?: unknown; finish_reason?: unknown } | null
  if (choice === null || typeof choice !== 'object') return {}
  return {
    ...(choice.delta !== null && typeof choice.delta === 'object'
      ? { delta: choice.delta as Record<string, unknown> }
      : {}),
    ...(typeof choice.finish_reason === 'string' ? { finishReason: choice.finish_reason } : {}),
  }
}

/**
 * 驱动一条 SSE 行流至终结(MiMo=OpenAI Chat 协议,流式形态按 R3 三终结同规处理):
 * - 首包返回全部搜索来源(29a R2)——累计 `delta.annotations` 的 url_citation 归一化进块
 *   (流式回流字段位置为文档级未核实形态:R2 仅言「首包返回全部搜索来源」,真调验证挂 K4.2);
 * - `delta.reasoning_content` 先于 `delta.content`(29a R2 thinking 行)——两者分别累计;
 * - `delta.tool_calls` 按 index 归并(复用 generic 线 ToolCallStreamMerger);
 * - 三终结:① `data: [DONE]` 字面帧 ② 含 error 字段的 JSON 帧 ③ 无任何标记的中断
 *   (29a R3 tool_calls 流式行——OpenAI 兼容面共同纪律)。
 */
export async function collectMimoChatStream(lines: AsyncIterable<string>): Promise<MimoCollectedStream> {
  const merger = new ToolCallStreamMerger()
  let reasoning = ''
  const annotations: MimoUrlCitation[] = []
  let finishReason: string | null = null
  let termination: StreamTermination | undefined
  let streamError: unknown
  let role = 'assistant'
  let searchUsage: { toolUsage?: number; pageUsage?: number } | undefined
  for await (const line of lines) {
    const frame = parseSseLine(line)
    if (frame.kind === 'empty') continue
    if (frame.kind === 'done') {
      termination = 'done'
      continue
    }
    const payload = frame.payload
    if (payload !== null && typeof payload === 'object' && 'error' in (payload as Record<string, unknown>)) {
      termination = 'error'
      streamError = (payload as Record<string, unknown>).error
      continue
    }
    merger.push(payload)
    const { delta, finishReason: chunkFinish } = readChoice(payload)
    if (delta !== undefined) {
      if (typeof delta.role === 'string') role = delta.role
      if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content
      if (Array.isArray(delta.annotations)) {
        for (const item of delta.annotations) {
          if (isUrlCitation(item)) annotations.push(item)
        }
      }
    }
    if (chunkFinish !== undefined) finishReason = chunkFinish
    if (payload !== null && typeof payload === 'object') {
      const usage = (payload as { usage?: { web_search_usage?: MimoWebSearchUsage } }).usage?.web_search_usage
      const next = toSearchUsage(usage)
      if (next !== undefined) searchUsage = next
    }
  }
  return {
    message: {
      role,
      content: merger.content.length > 0 ? merger.content : null,
      reasoningContent: reasoning.length > 0 ? reasoning : null,
      toolCalls: merger.toolCalls(),
    },
    blocks: mimoAnnotationsToBlocks(annotations),
    finishReason,
    termination: termination ?? 'interrupted',
    ...(streamError !== undefined ? { streamError } : {}),
    ...(searchUsage !== undefined ? { searchUsage } : {}),
  }
}
