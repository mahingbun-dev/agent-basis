/**
 * DeepSeek Messages API(Anthropic 兼容格式)协议类型——36 号 K2.1 types.ts。
 *
 * 底本:chat-demo `src/services/api/types.ts`(参考实现,29 §2.2「chat-demo 即参考实现」),
 * 逐段翻译并按 29a R4「与 chat-demo types.ts 对照」行的 **7 项缺口**补齐:
 * ① FilePurpose 补 `text_recognition`(三值制);
 * ② usage.server_tool_use 扩展(web_fetch_requests/tool_fetch/tool_image_search、output_tokens_details);
 * ③ WebSearchToolResultError 为 6 值枚举(chat-demo 仅落 'unavailable' 一值);
 * ④ thinking.type 第三值 adaptive + output_config.effort;
 * ⑤ StopReason 补 stop_sequence、stop_details.explanation 非恒 null;
 * ⑥ 第三类服务端工具 web_search_20250305/20260209(name=web_search、max_uses 默认/上限 5,v4-pro 可用);
 * ⑦ Chat Completions/Responses 协议镜像形态(server_tool_calls/server_tool_event/web_search_call)——
 *    本批仅登记名字与最小载荷形态,**通道只做 Messages 形态**(36 号 K2.1 规格第 5 点)。
 *
 * 纪律:29a 未逐项核实的字段(如 output_config.effort 值域)以最小事实登记,不编造枚举;
 * 每处缺口以「R4-①」…「R4-⑦」标注,可追溯 29a R4 对照行。
 */

/** 模型二值(29a R4 确认无误:flash 实际 V4.1-Flash-1017 承接旧名;v4-pro 无 vision/files)。 */
export type DeepseekChatModel = 'deepseek-flash' | 'deepseek-v4-pro'

// ---------------------------------------------------------------------------
// 响应:内容块(照 chat-demo types.ts 翻译;字段语义 29a R4 对照行「确认无误(官方背书)」)
// ---------------------------------------------------------------------------

/** 正文引用:服务端把模型的引用标记还原为来源,挂在对应文本块上。 */
export interface TextCitation {
  readonly type: 'web_search_result_location'
  readonly url: string
  /** 查不到标题时为 null。 */
  readonly title: string | null
  /** 当前文本块截至该引用处的全部正文(去除首尾空白)。 */
  readonly cited_text: string
  /** 恒为空串(适配器翻译时丢弃,不入规范化块)。 */
  readonly encrypted_index: string
}

/** 文本块:挂过引用的块之后,后续正文另起新块;同一块内引用按 url 去重。 */
export interface TextBlock {
  readonly type: 'text'
  readonly text: string
  readonly citations?: readonly TextCitation[]
}

/**
 * 思考块:签名在块结束前经 signature_delta 下发。
 * signature 为不透明签名,多轮回传须原样保留——这是 deepseek 适配器**内部**行为
 * (29a R4),出规范化块即剥离(29 §2.1 禁提供方字段透传)。
 */
export interface ThinkingBlock {
  readonly type: 'thinking'
  readonly thinking: string
  readonly signature: string
}

/** 服务端识别调用所属联网能力用的 kind,区分文字搜索、图搜及边想边搜。 */
export type ServerToolKind =
  | 'search'
  | 'deep_search'
  | 'read_link'
  | 'image_search'
  | 'deep_image_search'

/** server_tool_use 的四种动作,input 结构由 action 决定。 */
export type ServerToolInput =
  | { readonly action: 'search'; readonly query?: string; readonly queries: readonly string[] }
  | { readonly action: 'open_page'; readonly url: string }
  /** 找不到关联页面时 url 为空串。 */
  | { readonly action: 'find_in_page'; readonly url: string; readonly pattern: string }
  | { readonly action: 'read_link'; readonly url: string }

/** 服务端工具调用块:原子下发,content_block_start 即携带完整 input。 */
export interface ServerToolUseBlock {
  readonly type: 'server_tool_use'
  /** srvtoolu_{s|ds|rl|is|dis}_{序号}_{32 位 hex}(语法为 chat-demo 实测注释,29a R4 unresolved-6)。 */
  readonly id: string
  /** 文字搜索与图搜均为 deepseek_web_search;read_link 为 deepseek_read_url。 */
  readonly name: 'deepseek_web_search' | 'deepseek_read_url'
  readonly input: ServerToolInput
  readonly caller: { readonly type: 'direct' }
  readonly kind: ServerToolKind
}

/** 搜索结果条目;encrypted_content 为加密摘要——只存在于适配器内部,翻译后丢弃(29 §2.1)。 */
export interface WebSearchResult {
  readonly type: 'web_search_result'
  readonly title: string
  readonly url: string
  /** 图搜召回的原站图片地址,可能缺省(规范化块无对位字段——如实丢弃,不透传)。 */
  readonly image_url?: string
  /** 可直接展示的网页摘要(→ SourceBlock.summary)。 */
  readonly snippet: string
  /** 站点图标 URL;无法取得注册域名时为 null(→ SourceBlock.icon)。 */
  readonly site_icon: string | null
  /** 无站点名称时为 null(→ SourceBlock.siteName)。 */
  readonly site_name: string | null
  /** 搜索摘要经 AES-256-GCM 加密后的 Base64,客户端无法解密展示(适配器内部,出块即剥离)。 */
  readonly encrypted_content: string
  /** RFC 3339 UTC 时间,没有发布时间时为 null(→ SourceBlock.publishTime 经 normalizePublishTime)。 */
  readonly page_age: string | null
}

/**
 * R4-③:web_search_tool_result 错误码 6 值枚举(29a R4 对照行;chat-demo 仅落 'unavailable' 一值)。
 * 映射出口:SearchStepBlock.status='error' + detail=错误码文案(36 号 K2.1 门禁「6 值枚举映射」)。
 */
export const WEB_SEARCH_TOOL_RESULT_ERROR_CODES = [
  'invalid_tool_input',
  'unavailable',
  'max_uses_exceeded',
  'too_many_requests',
  'query_too_long',
  'request_too_large',
] as const

export type WebSearchToolResultErrorCode = (typeof WEB_SEARCH_TOOL_RESULT_ERROR_CODES)[number]

/** 搜索工具结果错误项(6 值枚举,R4-③)。 */
export interface WebSearchToolResultError {
  readonly type: 'web_search_tool_result_error'
  readonly error_code: WebSearchToolResultErrorCode
}

export interface WebSearchToolResultBlock {
  readonly type: 'web_search_tool_result'
  readonly tool_use_id: string
  /** 成功且无可见结果时为 [];失败时为只含一个错误项的数组。 */
  readonly content: readonly (WebSearchResult | WebSearchToolResultError)[]
  readonly kind: 'search' | 'deep_search' | 'image_search' | 'deep_image_search'
}

export interface WebFetchResult {
  readonly type: 'web_fetch_result'
  readonly url: string
  readonly content: {
    readonly type: 'document'
    /** read_link / deep_search 均为空串;阅读链接的页面加密在结果块的 signature 中。 */
    readonly source: { readonly type: 'text'; readonly media_type: 'text/plain'; readonly data: string }
    readonly title: string | null
  }
  /** read_link 为网页解析出的原始日期字符串;deep_search 为 RFC 3339。 */
  readonly published_at: string | null
}

/** 抓取错误码 3 值(29a R4「确认无误」;chat-demo 注释:url_not_accessible/url_not_allowed/unavailable)。 */
export type WebFetchToolResultErrorCode = 'url_not_accessible' | 'url_not_allowed' | 'unavailable'

export interface WebFetchToolResultError {
  readonly type: 'web_fetch_tool_result_error'
  readonly error_code: WebFetchToolResultErrorCode
}

export interface WebFetchToolResultBlock {
  readonly type: 'web_fetch_tool_result'
  readonly tool_use_id: string
  readonly content: WebFetchResult | WebFetchToolResultError
  readonly kind: 'read_link' | 'deep_search'
  /** 仅 read_link 成功时返回的加密页面,多轮请求原样回传(适配器内部;出块即剥离)。 */
  readonly signature?: string
}

export type ServerToolBlock = ServerToolUseBlock | WebSearchToolResultBlock | WebFetchToolResultBlock

/** 识别客户端工具调用的内容块类型(deepseek 通道不发客户端工具;登记防形态漂移)。 */
export interface ToolUseBlock {
  readonly type: 'tool_use'
  readonly id: string
  readonly name: string
  readonly input: unknown
}

/** 归并后的提供方输出块全集(text/thinking 增量可变;工具块原子下发)。 */
export type DeepseekOutputBlock =
  | TextBlock
  | ThinkingBlock
  | ServerToolUseBlock
  | WebSearchToolResultBlock
  | WebFetchToolResultBlock

// ---------------------------------------------------------------------------
// 请求侧
// ---------------------------------------------------------------------------

export interface TextBlockParam {
  readonly type: 'text'
  readonly text: string
}

/**
 * 文件块:引用经 Files API 上传的文件,图片用 image、其余用 document;
 * 图片请求需带 anthropic-beta: files-api-2025-04-14;扩展模式不支持 document,返回 400
 * (chat-demo 实测注释;29a R4 unresolved-1:官方未明示,接入时实测回归)。
 * 上传/purpose 选择/上限防呆属 K2.2;本文件只登记引用形态。
 */
export interface FileBlockParam {
  readonly type: 'image' | 'document'
  readonly source: { readonly type: 'file'; readonly file_id: string }
}

/** 接口接受的调用块;历史只回传 kind 为 read_link 的调用(chat-demo 回传纪律)。 */
export type ServerToolUseBlockParam = Pick<ServerToolUseBlock, 'type' | 'id' | 'name' | 'input' | 'kind'>

/** 接口接受的搜索结果块;历史搜索结果不回传。 */
export type WebSearchToolResultBlockParam = WebSearchToolResultBlock

/** 只回传 read_link 结果;成功时原样保留 signature,供服务端解密恢复网页上下文。 */
export type WebFetchToolResultBlockParam = WebFetchToolResultBlock

export type AssistantBlockParam =
  | TextBlockParam
  | ThinkingBlock
  | ServerToolUseBlockParam
  | WebSearchToolResultBlockParam
  | WebFetchToolResultBlockParam

/** 末尾 assistant 自动触发继续生成,无需 prefix 字段。 */
export type MessageParam =
  /** Chat Engine 扩展角色,位于对应 user 前;需服务端支持 latest_reminder。 */
  | { readonly role: 'latest_reminder'; readonly content: string }
  | { readonly role: 'user'; readonly content: string | readonly (FileBlockParam | TextBlockParam)[] }
  | { readonly role: 'assistant'; readonly content: readonly AssistantBlockParam[] }

/** 开启联网搜索与边想边搜(声明形态:type 必填;name 可选且服务端不校验——适配器不发,29a R4)。 */
export interface DeepseekWebSearchTool {
  readonly type: 'deepseek_web_search'
}

/** 阅读本轮用户消息中的链接,与搜索工具独立声明。 */
export interface DeepseekReadUrlTool {
  readonly type: 'deepseek_read_url'
}

/**
 * R4-⑥:第三类服务端工具(Anthropic 标准形态),v4-pro 可用;官方示例 name=web_search、
 * max_uses 默认/上限 5。本批仅类型登记(路由句柄 deepseek-anthropic-web-search 已在 K1.4 表内),
 * 组装支持随 M-K3 借用落地。
 */
export interface AnthropicWebSearchTool {
  readonly type: 'web_search_20250305' | 'web_search_20260209'
  readonly name: 'web_search'
  readonly max_uses?: number
}

/** 请求 tools 成员全集(deepseek_* 两工具 + 第三类 Anthropic 形态)。 */
export type DeepseekRequestTool = DeepseekWebSearchTool | DeepseekReadUrlTool | AnthropicWebSearchTool

/**
 * R4-④:thinking.type 第三值 adaptive(自适应);budget_tokens 为 enabled 形的可选参数
 * (chat-demo 仅用 enabled/disabled 两值,adaptive 登记不启用)。
 */
export type ThinkingType = 'enabled' | 'disabled' | 'adaptive'

export interface ThinkingConfig {
  readonly type: ThinkingType
  readonly budget_tokens?: number
}

/**
 * R4-④:output_config.effort。值域 29a 未逐项核实——登记为 string,不编造枚举。
 */
export interface OutputConfig {
  readonly effort: string
}

/** Messages 请求体(适配器组装产物;stream 恒 true,safety_check/title 与服务端工具互斥故不入本形态)。 */
export interface CreateMessageRequest {
  readonly model: DeepseekChatModel
  readonly system?: string
  readonly messages: readonly MessageParam[]
  readonly thinking?: ThinkingConfig
  readonly tools?: readonly DeepseekRequestTool[]
  readonly output_config?: OutputConfig
  readonly stream: true
}

// ---------------------------------------------------------------------------
// 响应:流式事件(SSE 的 event 名与 JSON 的 type 相同;以 message_stop 结束,无 [DONE])
// ---------------------------------------------------------------------------

/**
 * R4-⑤:StopReason 补 stop_sequence;stop_details.explanation 非恒 null
 * (chat-demo 类型里 category/explanation 恒 null,为实测子集——按 R4 放宽为 string|null)。
 */
export type StopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'refusal'

export interface StopDetails {
  readonly type: 'refusal'
  readonly category: string | null
  readonly explanation: string | null
}

/**
 * R4-②:usage.server_tool_use 扩展——chat-demo 仅 {web_search_requests, tool_search},
 * 补 web_fetch_requests/tool_fetch/tool_image_search;另补 output_tokens_details
 * {thinking_tokens, safety_tokens}。全部可选(仅 message_delta 累计值出现)。
 */
export interface ServerToolUseUsage {
  readonly web_search_requests?: number
  readonly web_fetch_requests?: number
  readonly tool_search?: number
  readonly tool_fetch?: number
  readonly tool_image_search?: number
}

export interface OutputTokensDetails {
  readonly thinking_tokens?: number
  readonly safety_tokens?: number
}

export interface MessageUsage {
  /** 未命中缓存的输入 Token。 */
  readonly input_tokens: number
  readonly cache_creation_input_tokens: number
  readonly cache_read_input_tokens: number
  /** message_start 中为 0,message_delta 中为全轮累计值。 */
  readonly output_tokens: number
  /** 仅当 message_delta 中有对外输出的搜索结果块时出现(R4-② 扩展)。 */
  readonly server_tool_use?: ServerToolUseUsage
  readonly output_tokens_details?: OutputTokensDetails
}

/** content_block_start 携带的初始内容块;工具块已是完整内容(原子下发)。 */
export type OutputBlockStart = TextBlock | ThinkingBlock | ServerToolBlock | ToolUseBlock

export type ContentBlockDelta =
  | { readonly type: 'text_delta'; readonly text: string }
  | { readonly type: 'thinking_delta'; readonly thinking: string }
  | { readonly type: 'signature_delta'; readonly signature: string }
  | { readonly type: 'citations_delta'; readonly citation: TextCitation }
  | { readonly type: 'input_json_delta'; readonly partial_json: string }

/**
 * 流式事件全集(SSE 以 message_stop 结束、无 [DONE],29a R4 对照行)。
 * message_start.message.id 为不带 msg_ 前缀的 UUID(与 x-ds-request-id 的关系为
 * chat-demo 实测注释,29a R4 unresolved-3,未采信为契约)。
 */
export type MessageStreamEvent =
  | {
    readonly type: 'message_start'
    readonly message: { readonly id: string; readonly model: string; readonly usage?: MessageUsage }
  }
  | { readonly type: 'content_block_start'; readonly index: number; readonly content_block: OutputBlockStart }
  | { readonly type: 'content_block_delta'; readonly index: number; readonly delta: ContentBlockDelta }
  | { readonly type: 'content_block_stop'; readonly index: number }
  | {
    readonly type: 'message_delta'
    /** title 仅在开启标题且生成成功时出现;stop_details 仅在 refusal 时出现。 */
    readonly delta: {
      readonly stop_reason: StopReason
      readonly stop_sequence: null
      readonly stop_details?: StopDetails
      readonly title?: string
    }
    readonly usage?: MessageUsage
  }
  | { readonly type: 'message_stop' }
  | { readonly type: 'ping' }

// ---------------------------------------------------------------------------
// R4-⑦:Chat Completions / Responses 镜像形态(仅登记,不实现通道)
// ---------------------------------------------------------------------------

/**
 * R4-⑦:镜像形态字段名登记——Chat Completions 走扩展字段 `message.server_tool_calls` +
 * `server_tool_event` 流式事件;Responses 轨道为 `web_search_call` item。
 * 29a R4 仅记字段名,未逐项核实字段集;本批通道只做 Messages 形态(36 号 K2.1),
 * 故载荷登记为不透明记录,防字段编造。
 */
export const MIRRORED_SERVER_TOOL_SHAPES = ['server_tool_calls', 'server_tool_event', 'web_search_call'] as const

export type MirroredServerToolShape = (typeof MIRRORED_SERVER_TOOL_SHAPES)[number]

/** 镜像形态载荷(不透明记录:字段集未核实,不编造结构)。 */
export type MirroredServerToolPayload = Readonly<Record<string, unknown>>

// ---------------------------------------------------------------------------
// 文件与错误体
// ---------------------------------------------------------------------------

/**
 * R4-①:purpose 三值制(29a R4 Files 行)——
 * user_data(图片/纯文本/表格/电子书,不需解析)/ text_recognition(PDF/Word/PPT/图片→只解析文字)/
 * rich_layout_recognition(图文混排,版面感知)。以 user_data 传 PDF/Word/PPT 返回 400(K2.2 防呆)。
 */
export type FilePurpose = 'user_data' | 'text_recognition' | 'rich_layout_recognition'

/** POST /anthropic/v1/files 的响应(Anthropic 形态)。 */
export interface FileObject {
  readonly id: string
  readonly type: 'file'
  readonly size_bytes: number
  readonly created_at: string
  readonly filename: string
  readonly mime_type: string
}

/** 非 2xx 响应体;流中出现只含 error 的无名 data 帧时同样按此解析。 */
export interface ApiErrorBody {
  readonly error: {
    readonly message: string
    readonly type?: string
    readonly param?: string | null
    readonly code?: string | null
  }
}
