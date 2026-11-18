/**
 * glm 适配器·对话侧(36 号 K3.1)——`tools[].web_search` 声明 + 响应顶层 `web_search[]` 回流
 * + 流式「chunk 无该字段」降级处理。字段级依据 29a R1(全部文档级已核实、未实测——
 * 真调验证挂 K4.2 doctor 探活,36 §1.9;本文件以 fixture 回放为门禁主体)。
 *
 * - 声明:`tools` 数组 `{type:'web_search', web_search:{…}}`(外层 required type+web_search);
 *   契约参数与子字段 1:1 映射经 router/translate.ts `toGlmWebSearchTool`(search_engine 必填
 *   四值/count 1–50 默认 10/search_domain_filter/search_recency_filter/content_size,
 *   search_query=强制触发位);`tool_choice` 仅 `"auto"`(R1 web_search 行)——
 *   契约 required/嵌套指定形经 TOOL_CHOICE_DOWNGRADES.glm 降级(29a R1)。
 * - 回流(本任务核心):非流式响应**顶层** `web_search[]`,**不在** `choices[].message`——
 *   message 仅 role/content/reasoning_content/audio/tool_calls(R1 回流行);每条
 *   `icon/title/link/media/publish_date/content/refer` → SourceBlock(§2.3 映射:
 *   title→title、link→url、content→summary、publish_date→normalizePublishTime、icon→icon;
 *   media 无规范化块对位——适配器内丢弃,不透传,29 §2.1 同纪律;GLM 无 site_name 字段→省略);
 *   `refer`(如 ref_1)与正文 `[来源：ref_1]` 文本标注对应 → CitationBlock 角标
 *   (refer 数字位=index(1 起),sourceIndex=该条在来源列表中的下标(0 起))。
 * - 流式(本任务核心之二):OpenAPI 规范 ChatCompletionChunk **无** web_search 字段——
 *   按「chunk 无该字段」设计(R1 修正行):流式结果显式标注来源不可得(`webSearch.status='absent'`),
 *   **不虚构来源块**;真实回流位置属 R1 unresolved-①,处置=K4.2 doctor 探活首轮真调验证
 *   并回填结论——若真流偏离规范携带该字段,仅原样留证(`unexpected-present`),不猜语义。
 * - SSE 帧解析复用 generic/loop.ts `parseSseLine`(OpenAI 兼容 Chat Completions 同一协议面,
 *   29a R3 流式行:`data: [DONE]` 字面帧/含 error 字段 JSON 帧/无标记中断三终结);
 *   GLM 错误体统一 `{"error":{code,message}}`(R1 鉴权与通用约定行)。
 */
import type { WebSearchParams } from '../../contract/capabilities.ts'
import { normalizeToolChoice, TOOL_CHOICE_DOWNGRADES } from '../../contract/capabilities.ts'
import { assertNoForbiddenKeys } from '../../contract/forbidden.ts'
import type { CitationBlock, NormalizedBlock, SourceBlock } from '../../blocks/types.ts'
import { normalizePublishTime } from '../../blocks/types.ts'
import { parseSseLine } from '../generic/loop.ts'
import { toGlmWebSearchTool } from '../../router/translate.ts'

// ---------------------------------------------------------------------------
// 协议形态(29a R1 字段级;仅登记契约消费面用到的字段)
// ---------------------------------------------------------------------------

/** 非流式响应顶层 `web_search[]` 单条(R1 回流行:icon/title/link/media/publish_date/content/refer)。 */
export interface GlmWebSearchEntry {
  readonly icon?: string
  readonly title: string
  readonly link: string
  /** 来源媒介名——无规范化块对位,适配器内丢弃(29 §2.1 禁透传纪律)。 */
  readonly media?: string
  readonly publish_date?: string
  readonly content: string
  /** 角标序号(如 ref_1),与正文 `[来源：ref_N]` 文本标注对应(R1)。 */
  readonly refer?: string
}

/** `choices[].message` 仅有 role/content/reasoning_content/audio/tool_calls——无内嵌搜索字段(R1 回流行)。 */
export interface GlmChatMessage {
  readonly role?: string
  readonly content?: string | null
  readonly reasoning_content?: string | null
}

/** GLM chat completions 非流式响应(顶层 `web_search[]` 是来源唯一位置;错误体统一 error 形态,R1)。 */
export interface GlmChatResponse {
  readonly id?: string
  readonly choices?: readonly {
    readonly message?: GlmChatMessage
    readonly finish_reason?: string | null
  }[]
  /** 顶层回流数组(不在 message;R1)。 */
  readonly web_search?: readonly GlmWebSearchEntry[]
  readonly error?: { readonly code?: string | number; readonly message?: string }
}

/** 请求消息(OpenAI 兼容子集;查询词由 web_search.search_query 强制触发位承载,K1.4 translate)。 */
export interface GlmChatRequestMessage {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: string
}

/** GLM chat 请求(白名单字段:model/messages/tools/tool_choice/stream;过禁入键深检)。 */
export interface GlmChatRequest {
  readonly model: string
  readonly messages: readonly GlmChatRequestMessage[]
  readonly tools: ReturnType<typeof toGlmWebSearchTool>['tools']
  /** 仅 "auto"(R1;契约 required/嵌套指定形经 TOOL_CHOICE_DOWNGRADES.glm 降级)。 */
  readonly tool_choice: 'auto'
  readonly stream?: true
}

// ---------------------------------------------------------------------------
// 组装侧(声明 1:1 + tool_choice 降级)
// ---------------------------------------------------------------------------

/**
 * 组装 chat 请求:契约 web_search 参数经 toGlmWebSearchTool 1:1 翻译进 `tools[].web_search`
 * (29a R1 对 §4 修正行);tool_choice 先过契约校验,再按 glm 分支降级规则位取值——
 * **恒 'auto'**(TOOL_CHOICE_DOWNGRADES.glm,R1:GLM tool_choice 仅 "auto");stream 位按入参落。
 */
export function buildGlmChatRequest(input: {
  readonly model: string
  readonly messages: readonly GlmChatRequestMessage[]
  readonly params: WebSearchParams
  /** 契约 tool_choice(any 形态先过 normalizeToolChoice;缺省 auto)。 */
  readonly toolChoice?: unknown
  readonly stream?: boolean
}): GlmChatRequest {
  // 非法 tool_choice 形态在 normalizeToolChoice 内静态拒绝(契约纪律);
  // 合法 required/嵌套指定形随后被 glm 分支降级为 auto(TOOL_CHOICE_DOWNGRADES.glm,29a R1)。
  if (input.toolChoice !== undefined) {
    normalizeToolChoice(input.toolChoice)
  }
  const declaration = toGlmWebSearchTool(input.params)
  const request: GlmChatRequest = {
    model: input.model,
    messages: [...input.messages],
    tools: declaration.tools,
    tool_choice: TOOL_CHOICE_DOWNGRADES.glm,
    ...(input.stream === true ? { stream: true as const } : {}),
  }
  assertNoForbiddenKeys(request)
  return request
}

// ---------------------------------------------------------------------------
// 回流解析侧(非流式:顶层 web_search[] → 规范化块)
// ---------------------------------------------------------------------------

/** 非流式解析产物:message 消费位 + 顶层来源数组 + 错误体(有则显式透传,不静默)。 */
export interface GlmChatResult {
  readonly content: string | null
  readonly reasoningContent: string | null
  readonly finishReason: string | null
  /** 顶层 `web_search[]` 原样条目(空数组=本轮无来源;字段映射在 toGlmNormalizedBlocks)。 */
  readonly webSearch: readonly GlmWebSearchEntry[]
  /** 响应错误体 `{"error":{code,message}}`(R1 通用约定;非空即失败态)。 */
  readonly error?: { readonly code?: string | number; readonly message?: string }
}

/**
 * 解析非流式响应:正文/reasoning 取 `choices[0].message`;来源**只**取顶层 `web_search[]`
 * (不在 message——message 无内嵌搜索字段,R1 回流行,这是本适配器的核心事实)。
 */
export function parseGlmChatResponse(response: GlmChatResponse): GlmChatResult {
  const choice = response.choices?.[0]
  return {
    content: choice?.message?.content ?? null,
    reasoningContent: choice?.message?.reasoning_content ?? null,
    finishReason: choice?.finish_reason ?? null,
    webSearch: response.web_search === undefined ? [] : [...response.web_search],
    ...(response.error !== undefined ? { error: response.error } : {}),
  }
}

/** refer 角标解析:`ref_N` → N(1 起);非该形态不产角标(不虚构序号,R1 只定义了 ref_N 形)。 */
function parseRefer(refer: string | undefined): number | null {
  if (typeof refer !== 'string') return null
  const match = /^ref_(\d+)$/.exec(refer)
  return match === null ? null : Number(match[1])
}

/**
 * 非流式结果 → 规范化块序列(29 §1 ④ 唯一消费物;golden 断言投影形态)。
 *
 * 输出顺序(确定性投影):来源卡列表(顶层 web_search[] 流序)→ 引用角标(条目 refer 流序)。
 * - SourceBlock:title→title、link→url、content→summary、publish_date→normalizePublishTime
 *   (容错归一)、icon→icon;media 无对位丢弃;GLM 无 site_name → 省略(§2.3 映射行)。
 * - CitationBlock:refer=ref_N → {index:N, sourceIndex:该条下标}(ref_N ↔ 正文 `[来源：ref_N]`
 *   文本标注对应,R1);refer 缺失/非 ref_N 形态 → 该来源无角标(不虚构)。
 */
export function toGlmNormalizedBlocks(result: GlmChatResult): readonly NormalizedBlock[] {
  const sources: SourceBlock[] = result.webSearch.map(entry => ({
    type: 'source' as const,
    title: entry.title,
    url: entry.link,
    summary: entry.content,
    publishTime: normalizePublishTime(entry.publish_date ?? null),
    ...(entry.icon !== undefined ? { icon: entry.icon } : {}),
  }))
  const citations: CitationBlock[] = []
  result.webSearch.forEach((entry, sourceIndex) => {
    const index = parseRefer(entry.refer)
    if (index !== null) {
      citations.push({ type: 'citation', index, sourceIndex })
    }
  })
  return [...sources, ...citations]
}

// ---------------------------------------------------------------------------
// 流式侧(ChatCompletionChunk 无 web_search 字段——按「chunk 无该字段」设计)
// ---------------------------------------------------------------------------

/**
 * 流式来源可得性(R1 修正行 + unresolved-①):
 * - `absent`:规范形态——ChatCompletionChunk 无 web_search 字段。显式降级:来源在流式不可得,
 *   不虚构来源块(29 §1 ⑤ 降级语义「显式表达,不假装可用」)。
 * - `unexpected-present`:真流偏离规范携带了 web_search 字段(形状未知:数组/增量/所在帧均无规范)
 *   ——仅原样留证供 K4.2 doctor 探活裁决,不猜语义、不映射进块。
 */
export type GlmStreamWebSearch =
  | { readonly status: 'absent'; readonly reason: string }
  | { readonly status: 'unexpected-present'; readonly frames: readonly unknown[] }

/** 流终结三态(29a R3 流式行:① [DONE] ② error 帧 ③ 无标记中断)。 */
export type GlmStreamTermination = 'done' | 'error' | 'interrupted'

/** 流式收集产物:正文/reasoning 增量归并 + 终结形态 + 来源可得性(降级位)。 */
export interface GlmStreamResult {
  readonly content: string
  readonly reasoningContent: string
  readonly finishReason: string | null
  readonly termination: GlmStreamTermination
  readonly webSearch: GlmStreamWebSearch
  /** termination='error' 时的错误帧原文(GLM 统一 error 体,R1)。 */
  readonly error?: unknown
}

/** 规范形态下的来源不可得理由(单一事实源;测试与 UI 消费同一文案)。 */
export const GLM_STREAM_WEB_SEARCH_ABSENT_REASON =
  'OpenAPI 规范 ChatCompletionChunk 无 web_search 字段(29a R1)——流式按「chunk 无该字段」设计,来源不可得,不虚构;真实回流位置待 K4.2 doctor 探活真调验证(R1 unresolved-①)'

function readPath(value: unknown, path: readonly (string | number)[]): unknown {
  let current: unknown = value
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[String(key)]
  }
  return current
}

/**
 * 驱动一条 SSE 行流至终结(复用 generic/loop.ts parseSseLine——同一 OpenAI 兼容协议面):
 * - `data: [DONE]` → done;含 error 字段 JSON 帧 → error(原文保留);流耗尽无标记 → interrupted;
 * - delta.content / delta.reasoning_content 增量归并(message 字段族含 reasoning_content,R1);
 * - **web_search 降级处理(本任务核心)**:规范形态 chunk 无该字段 → `webSearch.status='absent'`
 *   (显式降级,不虚构);若帧携带顶层 web_search 字段 → `unexpected-present` 原样留证,
 *   不映射(unresolved-① 未裁决前不猜语义)。
 */
export async function collectGlmStream(lines: AsyncIterable<string>): Promise<GlmStreamResult> {
  let content = ''
  let reasoningContent = ''
  let finishReason: string | null = null
  let termination: GlmStreamTermination | undefined
  let errorFrame: unknown
  const unexpectedFrames: unknown[] = []
  let sawUnexpectedWebSearch = false
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
      errorFrame = (payload as Record<string, unknown>).error
      continue
    }
    // 偏离规范的顶层 web_search 字段:留证不映射(unresolved-①;语义待 K4.2 doctor 真调裁决);
    // 该帧内已知语义的 delta 字段(content/reasoning_content)仍照常归并——证据与正文两不误。
    if (payload !== null && typeof payload === 'object' && 'web_search' in (payload as Record<string, unknown>)) {
      sawUnexpectedWebSearch = true
      unexpectedFrames.push(payload)
    }
    const delta = readPath(payload, ['choices', 0, 'delta'])
    if (delta !== null && typeof delta === 'object') {
      const text = (delta as { content?: unknown }).content
      if (typeof text === 'string') content += text
      const reasoning = (delta as { reasoning_content?: unknown }).reasoning_content
      if (typeof reasoning === 'string') reasoningContent += reasoning
    }
    const chunkFinish = readPath(payload, ['choices', 0, 'finish_reason'])
    if (typeof chunkFinish === 'string') finishReason = chunkFinish
  }
  const webSearch: GlmStreamWebSearch = sawUnexpectedWebSearch
    ? { status: 'unexpected-present', frames: unexpectedFrames }
    : { status: 'absent', reason: GLM_STREAM_WEB_SEARCH_ABSENT_REASON }
  return {
    content,
    reasoningContent,
    finishReason,
    termination: termination ?? 'interrupted',
    webSearch,
    ...(errorFrame !== undefined ? { error: errorFrame } : {}),
  }
}

/**
 * 流式结果 → 规范化块:恒空——流式无来源可得(显式降级位在 `webSearch`,不在块里虚构;
 * 29 §1 ⑤「不假装可用」)。函数存在使降级路径显式可测,而非隐式约定「流式就没有块」。
 */
export function toGlmStreamBlocks(_result: GlmStreamResult): readonly NormalizedBlock[] {
  return []
}
