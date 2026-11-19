/**
 * 能力契约层(29 §1 ①):五个能力枚举、声明参数、版本号;不含提供方细节。
 *
 * 字段级来源(36 号 K1.2,全部引 29a):
 * - web_search 参数与 GLM `tools[].web_search` 子字段几乎 1:1(29a R1 对 §4 修正行)
 *   ——engine=GLM search_engine 四值档 / count 1–50 默认 10 / recency=oneDay…noLimit /
 *   contentSize=medium|high;deepseek/generic 分支由路由器 translate 按各自形态翻译(K1.4)。
 * - read_url:url/timeout(默认 20 秒)/returnFormat(默认 markdown)——GLM reader 字段(29a R1);
 *   Tavily /extract 承接(29a R6)。
 * - files:契约层只表达意图(layoutAware),purpose 是提供方翻译产物(29 §7-3 Q3;
 *   deepseek purpose 三分 user_data/text_recognition/rich_layout_recognition,29a R4)。
 * - tts/asr:本批仅枚举占位(P-3 语音链消费,29 §4 P-3),参数 schema 留待语音规格(开放问题 O-9)。
 *
 * tool_choice 语义(29a R3 调用控制行):契约三值 none/auto/required + 嵌套指定形;
 * 翻译规则位:MiMo 分支必须降级为 auto(29a R2 修正——全协议不可用),GLM 亦仅 auto(29a R1)。
 *
 * 禁入键静态拒绝:构造声明先过 forbidden 键深检,再过 schemastery(本仓 zod)字段校验;
 * 双保险防提供方/OpenAI 特有字段进入契约(29 §2.1;29a R3/R4)。
 */
import z from '@deepseek-ai/schemastery'
import { assertNoForbiddenKeys } from './forbidden.ts'
import { assertValidToolName } from './naming.ts'

/** 五能力枚举(29 §1 ①;全仓唯一定义)。 */
export const CAPABILITY_IDS = ['web_search', 'read_url', 'files', 'tts', 'asr'] as const

export type CapabilityId = (typeof CAPABILITY_IDS)[number]

/**
 * 契约版本号。版本化机制语义未拍板(开放问题 O-7),先落常量+断言:
 * 消费方断言 `CONTRACT_VERSION` 相等才接受块/声明,不承诺跨版本兼容。
 */
export const CONTRACT_VERSION = 1

// ---------------------------------------------------------------------------
// web_search 声明参数(与 GLM web_search 子字段几乎 1:1;29a R1)
// ---------------------------------------------------------------------------

/** GLM search_engine 四值档(29a R1:search_std 默认/search_pro/sogou/quark)。 */
export const SEARCH_ENGINES = ['search_std', 'search_pro', 'search_pro_sogou', 'search_pro_quark'] as const
export type SearchEngine = (typeof SEARCH_ENGINES)[number]

/** 时效过滤(GLM search_recency_filter 五值,noLimit 默认;29a R1)。 */
export const RECENCY_FILTERS = ['oneDay', 'oneWeek', 'oneMonth', 'oneYear', 'noLimit'] as const
export type RecencyFilter = (typeof RECENCY_FILTERS)[number]

/** 摘要长度(GLM content_size 两值,medium 默认;29a R1)。 */
export const CONTENT_SIZES = ['medium', 'high'] as const
export type ContentSize = (typeof CONTENT_SIZES)[number]

/** web_search 声明参数(query 必填;余项可省,解析后带默认值)。 */
export interface WebSearchParams {
  readonly query: string
  readonly engine?: SearchEngine
  /** 结果条数(GLM count:1–50,默认 10;29a R1)。 */
  readonly count?: number
  /** 域名过滤(→ GLM search_domain_filter / Tavily include_domains)。 */
  readonly domainFilter?: readonly string[]
  readonly recency?: RecencyFilter
  readonly contentSize?: ContentSize
}

// ---------------------------------------------------------------------------
// read_url / files 声明参数
// ---------------------------------------------------------------------------

/** read_url 声明参数(GLM reader 字段:timeout 秒默认 20、return_format 默认 markdown;29a R1)。 */
export interface ReadUrlParams {
  readonly url: string
  readonly timeout?: number
  readonly returnFormat?: string
}

/** files 声明参数——契约层只表达意图;purpose 三分是 deepseek 提供方翻译产物(29a R4)。 */
export interface FilesParams {
  /** true=版面感知意图(→ rich_layout_recognition);false/缺省=文本级(→ text_recognition)。 */
  readonly layoutAware?: boolean
}

// ---------------------------------------------------------------------------
// tts/asr 占位(P-3 语音链消费;参数 schema 留待语音规格——开放问题 O-9)
// ---------------------------------------------------------------------------

/** 语音参数占位:本批不接受任何字段(传入即拒,防提前发明语音参数集)。 */
export interface VoiceParams {
  readonly [key: string]: never
}

/** 应用只声明意图(29 §1 应用层行):本轮要哪个能力+参数。 */
export interface CapabilityRequest {
  readonly capability: CapabilityId
  readonly params: Readonly<Record<string, unknown>>
}

// ---------------------------------------------------------------------------
// schema 构造(schemastery=本仓 zod;禁入键静态拒绝内嵌于解析)
// ---------------------------------------------------------------------------

/** transform 护栏:禁入键静态拒绝后原样放行(输出类型跟随输入)。 */
function forbidKeysOf<T>(value: T): T {
  assertNoForbiddenKeys(value)
  return value
}

const webSearchSchema = z.transform(
  z.object({
    query: z.string().required(),
    engine: z.union([
      z.const('search_std'),
      z.const('search_pro'),
      z.const('search_pro_sogou'),
      z.const('search_pro_quark'),
    ]).default('search_std'),
    count: z.natural().min(1).max(50).default(10),
    domainFilter: z.array(z.string()),
    recency: z.union([
      z.const('oneDay'),
      z.const('oneWeek'),
      z.const('oneMonth'),
      z.const('oneYear'),
      z.const('noLimit'),
    ]).default('noLimit'),
    contentSize: z.union([z.const('medium'), z.const('high')]).default('medium'),
  }),
  forbidKeysOf,
)

const readUrlSchema = z.transform(
  z.object({
    url: z.string().required(),
    timeout: z.natural().default(20),
    returnFormat: z.string().default('markdown'),
  }),
  forbidKeysOf,
)

const filesSchema = z.transform(
  z.object({
    layoutAware: z.boolean().default(false),
  }),
  forbidKeysOf,
)

/** 语音占位:对象上出现任何键即拒绝(参数集留待 O-9 裁决,P-3 开工)。 */
const voiceSchema = z.transform(z.object({}), (value: Record<string, unknown>): Record<string, never> => {
  forbidKeysOf(value)
  const keys = Object.keys(value)
  if (keys.length > 0) {
    throw new z.ValidationError(`tts/asr 参数本批仅枚举占位,不接受字段 "${keys.join('", "')}"(P-3 语音链,开放问题 O-9)`, { path: ['$'] })
  }
  return {}
})

/** 逐能力参数解析器(schema 可调用形态的统一收窄——schemastery 泛型面不外泄)。 */
export type CapabilityParamParser = (data: unknown) => Readonly<Record<string, unknown>>

/** 各能力的声明参数 schema(键=CAPABILITY_IDS 全集;供配置面/适配器复用)。 */
export const CAPABILITY_PARAM_SCHEMAS: Readonly<Record<CapabilityId, CapabilityParamParser>> = {
  // 单次受控收窄:调用面只承诺「对象进、冻结对象出」,字段级校验仍由各 schema 完成。
  web_search: webSearchSchema as unknown as CapabilityParamParser,
  read_url: readUrlSchema as unknown as CapabilityParamParser,
  files: filesSchema as unknown as CapabilityParamParser,
  tts: voiceSchema as unknown as CapabilityParamParser,
  asr: voiceSchema as unknown as CapabilityParamParser,
}

/** 已知能力集合(运行时防垃圾输入;string 键使类型系统不静态折叠该判定)。 */
const KNOWN_CAPABILITIES: ReadonlySet<string> = new Set<string>(CAPABILITY_IDS)

/** 能力声明构造错误(未知能力/参数非对象/字段违例)。 */
export class CapabilityRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CapabilityRequestError'
  }
}

/** 逐能力解析声明参数(禁入键静态拒绝 + schemastery 字段校验 + 默认值回填)。 */
export function parseCapabilityParams(capability: CapabilityId, params: unknown): Readonly<Record<string, unknown>> {
  const schema = CAPABILITY_PARAM_SCHEMAS[capability]
  return Object.freeze(schema(params))
}

/**
 * 能力声明唯一构造口(应用层入口):非法能力/禁入键/字段违例在此静态拒绝。
 * 产出冻结的 CapabilityRequest,下游(路由器/适配器)不再接受自由拼装。
 */
export function createCapabilityRequest(
  capability: CapabilityId,
  params: unknown,
): CapabilityRequest {
  if (!KNOWN_CAPABILITIES.has(capability)) {
    throw new CapabilityRequestError(`未知能力 "${capability}"(契约五能力: ${CAPABILITY_IDS.join(' / ')})`)
  }
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    throw new CapabilityRequestError(`能力 ${capability} 的 params 必须是对象,收到 ${Array.isArray(params) ? '数组' : typeof params}`)
  }
  assertNoForbiddenKeys(params)
  return Object.freeze({ capability, params: parseCapabilityParams(capability, params) })
}

// ---------------------------------------------------------------------------
// tool_choice 契约语义(29a R3 调用控制行 + R1/R2 降级修正)
// ---------------------------------------------------------------------------

/** 嵌套指定形(Chat 轨道形态:嵌套 function.name;29a R3)。 */
export interface SpecifiedFunctionChoice {
  readonly type: 'function'
  readonly function: { readonly name: string }
}

/** 契约 tool_choice:三值 + 嵌套指定形(29a R3)。 */
export type ToolChoice = 'none' | 'auto' | 'required' | SpecifiedFunctionChoice

/**
 * 翻译规则位:登记各分支的 tool_choice 降级规则。
 * - glm → 'auto':GLM tool_choice 仅 "auto"(29a R1 web_search 行);
 * - mimo → 'auto':MiMo 全协议 tool_choice 可选值仅 auto,required/指定函数必须降级
 *   (29a R2 修正行——契约层若暴露 required 语义,MiMo 分支必须降级)。
 */
export const TOOL_CHOICE_DOWNGRADES = {
  glm: 'auto',
  mimo: 'auto',
} as const

/** tool_choice 违例错误。 */
export class ToolChoiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolChoiceError'
  }
}

/** 校验并归一 tool_choice:非法形态拒绝;嵌套指定的函数名过契约命名规范。 */
export function normalizeToolChoice(value: unknown): ToolChoice {
  if (value === 'none' || value === 'auto' || value === 'required') return value
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const choice = value as { type?: unknown; function?: { name?: unknown } | null }
    if (choice.type === 'function' && choice.function !== null && typeof choice.function === 'object') {
      const name = choice.function.name
      if (typeof name === 'string') {
        assertValidToolName(name)
        return { type: 'function', function: { name } }
      }
    }
  }
  throw new ToolChoiceError(
    `tool_choice 非法形态:须为 'none' | 'auto' | 'required' 或 {type:'function',function:{name}}(29a R3),收到 ${JSON.stringify(value)}`,
  )
}
