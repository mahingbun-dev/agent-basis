/**
 * deepseek 适配器·对话侧(36 号 K2.1)——chat-demo 范式翻译:
 * - 组装:`store.ts serverTools(search)` 翻译为 buildServerTools/buildMessagesRequest
 *   (按能力开关组装 deepseek_web_search/deepseek_read_url 进 tools,29 §2.2「参数控制调用与组合」),
 *   并落 R4 静态防呆(同工具两次/tool_choice 指定它们/与其他服务端工具同传均 400);
 * - 归并:`reply.ts applyEvent` 范式翻译为 applyMessageEvent(临时索引映射处理增量,
 *   工具块原子下发、text/thinking 增量、citations_delta 流式增量);
 * - 翻译:DeepseekMessageState → 规范化块(toNormalizedBlocks,29 §1 ④ 唯一消费物;
 *   encrypted_content/signature 只存在于适配器内部,出块即剥离——29 §2.1)。
 *
 * 契约参数 → deepseek 形态的如实丢弃注记(K2.1 组装侧):
 * deepseek 服务端工具不接受搜索参数控制(查询词由服务端模型生成,server_tool_use.input.queries),
 * 故 web_search 的 engine/count/domainFilter/recency/contentSize、read_url 的
 * timeout/returnFormat 在本通道**无对位字段**——如实丢弃不虚构(对照 Tavily 翻译的 contentSize 丢弃注记)。
 */
import type { ReadUrlParams, WebSearchParams } from '../../contract/capabilities.ts'
import type { AttachmentRefBlock, CitationBlock, NormalizedBlock, SearchStepBlock, SourceBlock } from '../../blocks/types.ts'
import { normalizePublishTime } from '../../blocks/types.ts'
import { readMessageEvent } from './parse-event.ts'
import { decodeSseText } from './sse.ts'
import type { ServerSentEvent } from './sse.ts'
import type {
  CreateMessageRequest,
  DeepseekChatModel,
  DeepseekOutputBlock,
  DeepseekRequestTool,
  MessageParam,
  MessageStreamEvent,
  MessageUsage,
  OutputBlockStart,
  StopDetails,
  StopReason,
  ThinkingConfig,
  WebFetchResult,
  WebSearchResult,
  WebSearchToolResultError,
} from './types.ts'

// ---------------------------------------------------------------------------
// 组装侧(serverTools 翻译 + R4 静态防呆)
// ---------------------------------------------------------------------------

/** 组装防呆错误(请求发出前静态拒绝;对应服务端 400 形态,29a R4 web_tools 行)。 */
export class DeepseekRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeepseekRequestError'
  }
}

/** 服务端工具 type 值(声明形态:type 必填;name 可选且服务端不校验——适配器不发 name,29a R4)。 */
export type ServerToolCapability = 'web_search' | 'read_url'

const SERVER_TOOL_TYPE_BY_CAPABILITY: Readonly<Record<ServerToolCapability, 'deepseek_web_search' | 'deepseek_read_url'>> = {
  web_search: 'deepseek_web_search',
  read_url: 'deepseek_read_url',
}

/**
 * 按能力开关组装服务端工具声明(chat-demo `serverTools(search)` 翻译;29 §2.2)。
 * 静态防呆:同一工具声明两次即拒(服务端 400,29a R4)——去重宽容属路由器翻译
 * (translate.ts toDeepseekServerTools),适配器组装面从严。
 */
export function buildServerTools(capabilities: readonly ServerToolCapability[]): readonly DeepseekRequestTool[] {
  const seen = new Set<string>()
  const tools: DeepseekRequestTool[] = []
  for (const capability of capabilities) {
    const type = SERVER_TOOL_TYPE_BY_CAPABILITY[capability]
    if (seen.has(type)) {
      throw new DeepseekRequestError(`同一服务端工具 ${type} 声明两次——服务端返回 400(29a R4 web_tools 行)`)
    }
    seen.add(type)
    tools.push(capability === 'web_search' ? { type: 'deepseek_web_search' } : { type: 'deepseek_read_url' })
  }
  return tools
}

const ANTHROPIC_WEB_SEARCH_TYPES = new Set(['web_search_20250305', 'web_search_20260209'])
const DEEPSEEK_SERVER_TOOL_TYPES = new Set(['deepseek_web_search', 'deepseek_read_url'])

/**
 * 静态防呆:deepseek_* 两工具不能与其他服务端工具同传(29a R4——safety_check/title 亦不可,
 * 后者经请求形态排除:CreateMessageRequest 无这两个字段;此处拦 tools 数组内的第三类
 * Anthropic 形态 web_search_2025*)。
 */
export function assertNoServerToolConflicts(tools: readonly DeepseekRequestTool[]): void {
  const hasDeepseekTools = tools.some(tool => DEEPSEEK_SERVER_TOOL_TYPES.has(tool.type))
  const hasAnthropicWebSearch = tools.some(tool => ANTHROPIC_WEB_SEARCH_TYPES.has(tool.type))
  if (hasDeepseekTools && hasAnthropicWebSearch) {
    throw new DeepseekRequestError(
      'deepseek_web_search/deepseek_read_url 不能与其他服务端工具同传(29a R4:混传 web_search_2025* 返回 400)',
    )
  }
}

/**
 * 静态防呆:tool_choice 不能指定服务端工具(29a R4——400)。
 * 仅拦「嵌套指定形指向 deepseek_* 工具」;none/auto/required 为通用语义,由通道层处置。
 */
export function assertToolChoiceAllowed(
  tools: readonly DeepseekRequestTool[],
  toolChoice: { type?: unknown; function?: { name?: unknown } | null } | string | null | undefined,
): void {
  if (toolChoice === null || typeof toolChoice !== 'object') return
  const name = (toolChoice as { function?: { name?: unknown } }).function?.name
  const declaresServerTools = tools.some(tool => DEEPSEEK_SERVER_TOOL_TYPES.has(tool.type))
  if (declaresServerTools && typeof name === 'string' && DEEPSEEK_SERVER_TOOL_TYPES.has(name)) {
    throw new DeepseekRequestError(`tool_choice 不能指定服务端工具 ${name}——服务端返回 400(29a R4)`)
  }
}

/** buildMessagesRequest 入参(会话层 → deepseek Messages 请求的组装口)。 */
export interface BuildMessagesRequestInput {
  readonly model: DeepseekChatModel
  readonly system?: string
  readonly messages: readonly MessageParam[]
  readonly thinking?: ThinkingConfig
  /** 能力开关:组装 deepseek_web_search/deepseek_read_url 进 tools(chat-demo serverTools 翻译)。 */
  readonly capabilities?: readonly ServerToolCapability[]
}

/**
 * 组装 Messages 请求(chat-demo store.ts 请求形态翻译:stream 恒 true;
 * 扩展模式请求不带 safety_check/title——与联网工具互斥,29a R4)。
 */
export function buildMessagesRequest(input: BuildMessagesRequestInput): CreateMessageRequest {
  const tools = input.capabilities === undefined ? [] : buildServerTools(input.capabilities)
  assertNoServerToolConflicts(tools)
  return {
    model: input.model,
    ...(input.system !== undefined ? { system: input.system } : {}),
    messages: [...input.messages],
    ...(input.thinking !== undefined ? { thinking: input.thinking } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    stream: true,
  }
}

/**
 * web_search 契约参数 → 用户消息形态:查询词进本轮用户消息(服务端模型自主决定
 * server_tool_use 查询词);engine/count/domainFilter/recency/contentSize 无 deepseek
 * 对位字段——如实丢弃(组装侧注记,K1.4 translate 的 Tavily contentSize 丢弃同惯例)。
 */
export function toWebSearchUserMessage(params: WebSearchParams): MessageParam {
  return { role: 'user', content: params.query }
}

/**
 * read_url 契约参数 → 用户消息形态:deepseek_read_url 阅读「本轮用户消息中的链接」
 * (chat-demo types.ts 工具注释)——URL 进消息文本;timeout/returnFormat 无对位,如实丢弃。
 */
export function toReadUrlUserMessage(params: ReadUrlParams): MessageParam {
  return { role: 'user', content: params.url }
}

/**
 * files 契约 → 附件引用块:document/image 块经 file_id 引用(Files API 元数据 →
 * AttachmentRefBlock;上传/purpose/上限防呆属 K2.2,此处只做引用形态翻译)。
 */
export function toAttachmentRefBlocks(
  files: readonly { readonly fileId: string; readonly filename: string }[],
): readonly AttachmentRefBlock[] {
  return files.map(file => ({ type: 'attachment_ref', fileId: file.fileId, name: file.filename }))
}

// ---------------------------------------------------------------------------
// 归并侧(applyEvent 范式翻译,chat-demo reply.ts)
// ---------------------------------------------------------------------------

/** 归并状态:status 于 message_stop 置 done;流错误/中断置 error 形态并保留已收块。 */
export interface DeepseekMessageState {
  readonly status: 'streaming' | 'done' | 'stream-error' | 'interrupted'
  readonly blocks: readonly DeepseekOutputBlock[]
  readonly usage?: MessageUsage
  readonly stopReason?: StopReason
  readonly stopDetails?: StopDetails
  /** stream-error/interrupted 的错误内容;interrupted 恒空串(不推测断流原因,chat-demo 纪律)。 */
  readonly errorMessage?: string
}

/** 归并累积器:state + 本次请求的临时索引映射(增量块定位;chat-demo applyEvent 的 blockIndexes)。 */
export interface MessageAccumulator {
  readonly state: DeepseekMessageState
  readonly blockIndexes: Map<number, number>
}

export function createMessageAccumulator(): MessageAccumulator {
  return { state: { status: 'streaming', blocks: [] }, blockIndexes: new Map() }
}

/** 工具块原子下发原样收;tool_use(客户端工具)不保存——本通道不发客户端工具(chat-demo reply.ts 同纪律)。 */
function toOutputBlock(block: OutputBlockStart): DeepseekOutputBlock | null {
  return block.type === 'tool_use' ? null : block
}

/**
 * 把一个流式事件合并进状态(chat-demo `applyEvent` 范式翻译):
 * 只追加可识别的内容块,用临时索引映射处理增量;跳过的块不占位;
 * message_delta 更新结束原因与累计用量。
 */
export function applyMessageEvent(acc: MessageAccumulator, event: MessageStreamEvent): MessageAccumulator {
  const state = acc.state.status === 'streaming' ? acc.state : { ...acc.state, status: 'streaming' as const }
  switch (event.type) {
    case 'message_start': {
      const usage = event.message.usage ?? state.usage
      return { ...acc, state: { ...state, ...(usage !== undefined ? { usage } : {}) } }
    }
    case 'content_block_start': {
      acc.blockIndexes.delete(event.index)
      const block = toOutputBlock(event.content_block)
      if (!block) {
        return { ...acc, state }
      }
      acc.blockIndexes.set(event.index, state.blocks.length)
      return { ...acc, state: { ...state, blocks: [...state.blocks, block] } }
    }
    case 'content_block_delta': {
      const index = acc.blockIndexes.get(event.index)
      if (index === undefined) {
        return { ...acc, state }
      }
      const { delta } = event
      const blocks = [...state.blocks]
      const block = blocks[index]
      if (block !== undefined) {
        if (block.type === 'text' && delta.type === 'text_delta') {
          blocks[index] = { ...block, text: block.text + delta.text }
        } else if (block.type === 'thinking' && delta.type === 'thinking_delta') {
          blocks[index] = { ...block, thinking: block.thinking + delta.thinking }
        } else if (block.type === 'thinking' && delta.type === 'signature_delta') {
          blocks[index] = { ...block, signature: block.signature + delta.signature }
        } else if (block.type === 'text' && delta.type === 'citations_delta') {
          blocks[index] = { ...block, citations: [...(block.citations ?? []), delta.citation] }
        }
      }
      return { ...acc, state: { ...state, blocks } }
    }
    case 'content_block_stop':
      acc.blockIndexes.delete(event.index)
      return { ...acc, state }
    case 'message_delta':
      return {
        ...acc,
        state: {
          ...state,
          stopReason: event.delta.stop_reason,
          ...(event.delta.stop_details !== undefined ? { stopDetails: event.delta.stop_details } : {}),
          ...(event.usage !== undefined || state.usage !== undefined ? { usage: event.usage ?? state.usage } : {}),
        },
      }
    case 'message_stop':
      return { ...acc, state: { ...state, status: 'done' } }
    default:
      return { ...acc, state }
  }
}

/**
 * 回放事件序列 → 归并状态。message_stop 后的冗余事件忽略(SSE 以 message_stop 结束);
 * 序列耗尽仍无 message_stop → interrupted(chat-demo「无 message_stop 即断流」纪律,
 * 错误内容保持为空,不推测断流原因)。
 */
export function runMessageStream(events: readonly MessageStreamEvent[]): DeepseekMessageState {
  let acc = createMessageAccumulator()
  for (const event of events) {
    acc = applyMessageEvent(acc, event)
    if (acc.state.status === 'done') {
      return acc.state
    }
  }
  return { ...acc.state, status: 'interrupted', errorMessage: '' }
}

const isErrorBody = (value: unknown): value is { error: { message: string } } =>
  typeof value === 'object' && value !== null && 'error' in value && typeof (value as { error?: { message?: unknown } }).error?.message === 'string'

/** SSE 帧消费结果:合法事件序列 + 首个流错误帧内容(chat-demo streamMessage 错误帧纪律)。 */
export interface SseFrameOutcome {
  readonly events: readonly MessageStreamEvent[]
  /** 流中 error 帧(如等待生成超时),随后连接关闭——非空即错误态。 */
  readonly streamError?: string
}

/**
 * 消费 SSE 帧序列(chat-demo `streamMessage` 解析纪律翻译):
 * - data 非 JSON 且 event 名非 error → 丢弃(deepseek 无 [DONE],若出现按此路径静默忽略);
 * - 含 error 字段的 JSON 体 / event 名 error → 流错误;
 * - readMessageEvent 拒绝的未知事件静默丢弃;
 * - message_stop 后停止收集。
 */
export function consumeSseFrames(frames: readonly ServerSentEvent[]): SseFrameOutcome {
  const events: MessageStreamEvent[] = []
  for (const { event: eventName, data } of frames) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    if (isErrorBody(payload)) {
      return { events, streamError: payload.error.message }
    }
    if (eventName === 'error') {
      return { events, streamError: data }
    }
    const parsed = readMessageEvent(payload)
    if (parsed === null) {
      continue
    }
    events.push(parsed)
    if (parsed.type === 'message_stop') {
      return { events }
    }
  }
  return { events }
}

/**
 * SSE 文本 → 归并状态(整链便捷口:SSE 解码 → 帧消费 → 事件归并;fixture 回放的消费形态)。
 * 错误帧与断流收进 state(status/errorMessage),不抛错——chat-demo 在传输层抛
 * ApiError('stream'|'interrupted'),能力层以结构化状态承载,已收块保留。
 */
export function parseMessageStreamFromSse(text: string): DeepseekMessageState {
  const { events, streamError } = consumeSseFrames(decodeSseText(text))
  if (streamError !== undefined) {
    return { ...runMessageStream(events), status: 'stream-error', errorMessage: streamError }
  }
  return runMessageStream(events)
}

// ---------------------------------------------------------------------------
// 翻译侧(DeepseekMessageState → 规范化块;29 §1 ④)
// ---------------------------------------------------------------------------

/** read_link 步骤的块协议落位:块协议 action 枚举(K1.3)为 search/open_page/find_in_page/tool_call,
 * read_link(阅读用户消息中的链接)语义同为「打开 URL」→ open_page(映射注记,O-2 draft)。 */
function toStepAction(action: string): SearchStepBlock['action'] {
  if (action === 'search' || action === 'open_page' || action === 'find_in_page') return action
  return 'open_page' // read_link
}

function isWebSearchError(item: unknown): item is WebSearchToolResultError {
  return (
    item !== null && typeof item === 'object' && (item as { type?: unknown }).type === 'web_search_tool_result_error'
  )
}

function webSearchResultToSource(item: WebSearchResult): SourceBlock {
  return {
    type: 'source',
    title: item.title,
    url: item.url,
    summary: item.snippet,
    publishTime: normalizePublishTime(item.page_age),
    ...(item.site_name !== null ? { siteName: item.site_name } : {}),
    ...(item.site_icon !== null ? { icon: item.site_icon } : {}),
    // encrypted_content(加密摘要)与 image_url(图搜图片地址)无规范化块对位——适配器内丢弃,不透传(29 §2.1)。
  }
}

function webFetchResultToSource(item: WebFetchResult): SourceBlock {
  return {
    type: 'source',
    title: item.content.title ?? '', // 查不到标题时为 null → 空串占位,不虚构标题
    url: item.url,
    // 抽取文本 read_link/deep_search 均为空串(页面加密在 signature 中,服务端解密用)——如实映射,不虚构摘要。
    summary: item.content.source.data,
    publishTime: normalizePublishTime(item.published_at),
    // signature(加密页面)只存在于适配器内部供多轮回传,出块即剥离(29 §2.1;29a R4)。
  }
}

/**
 * 归并状态 → 规范化块序列(所有路径产同一种块;golden 断言的投影形态)。
 *
 * 输出顺序(确定性投影,O-2 draft 期间由 golden 钉死):搜索步骤时间线(流序)→
 * 来源卡列表(结果块流序)→ 引用角标(text 块 citations 流序)。
 * - 步骤状态:结果块按 tool_use_id 回写(6 值错误枚举/抓取 3 值错误码 → status='error'+detail;
 *   成功与无结果块的已发起步骤 → 'ok');孤立结果块(无对应调用)仍产 source,不虚构步骤。
 * - 角标序号=来源序号(index=sourceIndex+1,与 GLM refer=ref_N 语义对齐,K1.3 注释);
 *   引用 url 匹配不到来源卡时跳过该角标(角标必须有来源卡支撑——防御性,deepseek 流内
 *   引用 url 必来自本响应搜索结果)。
 */
export function toNormalizedBlocks(state: DeepseekMessageState): readonly NormalizedBlock[] {
  const steps: SearchStepBlock[] = []
  const stepIndexByToolUseId = new Map<string, number>()
  for (const block of state.blocks) {
    if (block.type !== 'server_tool_use') continue
    const stepIndex = steps.length
    stepIndexByToolUseId.set(block.id, stepIndex)
    const input = block.input as { action?: string; queries?: readonly string[]; url?: string; pattern?: string }
    const action = toStepAction(input.action ?? '')
    steps.push({
      type: 'search_step',
      step: stepIndex + 1,
      action,
      ...(action === 'search' && Array.isArray(input.queries)
        ? { query: input.queries.join(' ') }
        : input.pattern !== undefined
          ? { query: input.pattern }
          : {}),
      ...(typeof input.url === 'string' && input.url !== '' ? { url: input.url } : {}),
      status: 'ok',
    })
  }

  const sources: SourceBlock[] = []
  const urlToSourceIndex = new Map<string, number>()
  const appendSource = (source: SourceBlock): number => {
    const existing = urlToSourceIndex.get(source.url)
    if (existing !== undefined) return existing
    const index = sources.length
    sources.push(source)
    urlToSourceIndex.set(source.url, index)
    return index
  }

  for (const block of state.blocks) {
    if (block.type === 'web_search_tool_result') {
      const result = block
      const stepIndex = stepIndexByToolUseId.get(result.tool_use_id)
      const errorItem = result.content.find(isWebSearchError)
      if (stepIndex !== undefined && errorItem !== undefined) {
        const base = steps[stepIndex]
        if (base !== undefined) {
          steps[stepIndex] = { ...base, status: 'error', detail: errorItem.error_code }
        }
      }
      for (const item of result.content) {
        // 正向 type 判别收窄(error 项 type='web_search_tool_result_error',不会同时命中)。
        if (item.type === 'web_search_result') {
          appendSource(webSearchResultToSource(item))
        }
      }
    } else if (block.type === 'web_fetch_tool_result') {
      const result = block
      const stepIndex = stepIndexByToolUseId.get(result.tool_use_id)
      if (result.content.type === 'web_fetch_tool_result_error') {
        const error = result.content
        if (stepIndex !== undefined) {
          const base = steps[stepIndex]
          if (base !== undefined) {
            steps[stepIndex] = { ...base, status: 'error', detail: error.error_code }
          }
        }
      } else {
        appendSource(webFetchResultToSource(result.content))
      }
    }
  }

  const citations: CitationBlock[] = []
  for (const block of state.blocks) {
    if (block.type !== 'text') continue
    for (const citation of block.citations ?? []) {
      const sourceIndex = urlToSourceIndex.get(citation.url)
      if (sourceIndex === undefined) continue
      citations.push({ type: 'citation', index: sourceIndex + 1, sourceIndex })
    }
  }

  return [...steps, ...sources, ...citations]
}
