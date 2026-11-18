/**
 * 规范化块协议(29 §1 ④):所有路径(服务端工具/原生工具/客户端执行)产出同一种块结构,
 * 是渲染与 prompt 的唯一消费物;禁提供方字段透传(29 §2.1)。
 *
 * 四类块类型来自 29 §1 ④;字段集为 36 号 §2.3 最小并集草案(每字段标注 29a 来源),
 * **未经 O-2 评审不得视为定稿**——BLOCK_PROTOCOL_STATUS 在固化前恒为 'draft',
 * golden 断言(K2.4)据此标注。
 *
 * 时间归一化:publishTime 必须可空(29a R6 修正:Tavily best-estimate 可 null);
 * GLM publish_date / MiMo publish_time 为字符串、Tavily 为 RFC1123 示例格式——
 * 各适配器经 normalizePublishTime 归一(容错解析,R6 unresolved-②)。
 */

/** 块协议字段集状态(O-2:评审确认 §2.3 字段集后固化为 golden,届时改 'golden')。 */
export const BLOCK_PROTOCOL_STATUS = 'draft' as const

// ---------------------------------------------------------------------------
// 来源卡(R1/R2/R6 三家字段并集;36 号 §2.3 草案)
// ---------------------------------------------------------------------------

/**
 * 来源卡:搜索结果的一条来源。
 * - title/summary ← GLM title/content(R1)、MiMo title/summary(R2)、Tavily title/content(R6);
 * - url ← GLM link / MiMo url / Tavily url;
 * - publishTime 可空:Tavily best-estimate 可 null(R6);GLM publish_date / MiMo publish_time 归一化;
 * - siteName ← MiMo site_name / Tavily site(可选,GLM 无);
 * - icon ← GLM icon / MiMo logo_url / Tavily favicon(可选)。
 */
export interface SourceBlock {
  readonly type: 'source'
  readonly title: string
  readonly url: string
  readonly summary: string
  readonly publishTime: string | null
  readonly siteName?: string
  readonly icon?: string
}

// ---------------------------------------------------------------------------
// 引用角标
// ---------------------------------------------------------------------------

/**
 * 引用角标:角标序号 + 指向来源卡索引。
 * GLM `refer`(如 ref_1)与正文 `[来源：ref_1]` 文本标注对应(R1 回流行)——
 * refer 的数字位映射 index(1 起),并指回来源卡列表下标 sourceIndex(0 起);
 * deepseek `encrypted_index`/`cited_text` 由适配器内映射(encrypted_content 翻译后丢弃,29 §2.1)。
 */
export interface CitationBlock {
  readonly type: 'citation'
  /** 角标序号(1 起;GLM refer=ref_N 的 N)。 */
  readonly index: number
  /** 指向来源卡列表的索引(0 起)。 */
  readonly sourceIndex: number
}

// ---------------------------------------------------------------------------
// 搜索步骤时间线
// ---------------------------------------------------------------------------

/** 步骤动作:deepseek server_tool_use 步骤(search/open_page/find_in_page,29a R4)与 generic 工具调用轮(tool_call)。 */
export type SearchStepAction = 'search' | 'open_page' | 'find_in_page' | 'tool_call'

/**
 * 搜索步骤时间线的一步:deepseek 服务端工具步骤 / generic 工具调用轮
 * (29 §1 ④;字段为 §2.3 草案最小集,O-2 评审前 draft)。
 */
export interface SearchStepBlock {
  readonly type: 'search_step'
  /** 步骤序号(1 起,时间线顺序)。 */
  readonly step: number
  readonly action: SearchStepAction
  /** 搜索词(action=search)或定位词(find_in_page);无则省略。 */
  readonly query?: string
  /** 打开的页面(action=open_page/tool_call 读网);无则省略。 */
  readonly url?: string
  readonly status: 'ok' | 'error'
  /** 错误信息或步骤附注(status=error 时承载错误文案——显式表达,不静默)。 */
  readonly detail?: string
}

// ---------------------------------------------------------------------------
// 附件引用
// ---------------------------------------------------------------------------

/**
 * 附件引用:deepseek 文档 `document` 块 source:{type:'file',file_id} 的引用形态(R4)。
 * 上限(每请求 ≤20 文档、文字合计 ≤8MiB)是请求侧校验(K2.2 防呆),不入块。
 */
export interface AttachmentRefBlock {
  readonly type: 'attachment_ref'
  readonly fileId: string
  readonly name: string
}

/** 四类规范化块(29 §1 ④)。 */
export type NormalizedBlock = SourceBlock | CitationBlock | SearchStepBlock | AttachmentRefBlock

export type BlockType = NormalizedBlock['type']

// ---------------------------------------------------------------------------
// publishTime 归一化(容错解析;R6 unresolved-②:官方仅示例无格式规范)
// ---------------------------------------------------------------------------

/**
 * 发布时间归一化:null → null;可解析(RFC1123 示例格式 / ISO 8601 / Date 可解析形态)
 * → ISO 8601 UTC 字符串;不可解析的非空串原样保留(保留证据,不虚构时间、不静默丢弃)。
 */
export function normalizePublishTime(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '') return null
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toISOString()
}
