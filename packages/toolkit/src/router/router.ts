/**
 * 工具路由器(29 §1 ②):按「能力 × 已配置供应商集」做三段式裁决 + 参数翻译;**不执行**。
 *
 * 三段式供给链(29 §2.4/§7-1 拍板):
 *   对话模型原生 → 已配置供应商原生(借用) → 通用兜底(web=Tavily;语音=自托管栈,本批不可路由)。
 * 查询键=「已配置供应商集」而非「对话提供方」(29 §2.4)——矩阵因此是部署级的。
 * 无路径 → `unavailable` 显式结论(29 §1 ⑤,绝不静默)。
 *
 * 本文件承载:路由类型 + 模型粒度能力表/借用路径表(数据,非逻辑) + 三段式裁决纯函数。
 * 矩阵计算/失效重算钩子在 matrix.ts;参数翻译在 translate.ts。
 *
 * 数据来源(逐条):
 * - deepseek 拆两行——flash:web_search 原生+read_url+files 版面感知+vision;
 *   v4-pro:仅 Anthropic 形态 web_search_20250305/20260209 工具、无 vision/files(29a R4 对 §3 修正行)。
 * - GLM:视觉模型与 glm-4-voice 请求不支持 web_search(29a R1);read_url/files 为
 *   provider 级独立端点(/paas/v4/reader、上传→parser→文本入 messages,文本级)。
 * - MiMo:web_search 仅 OpenAI Chat 协议、支持模型 v2.6-flash/pro/pro-ultraspeed(29a R2)。
 * - 借用两档(29a 附-A 合并修正):档 A 独立端点直调(deepseek /v1/tools/search|fetch、
 *   glm /paas/v4/web_search|/reader);档 B 最小 chat 请求(MiMo,专用 model id+单条消息)。
 * - tts/asr:语音供给链归 P-3(29 §4 P-3);本批表内无语音行 → 三段式自然落 unavailable
 *   (36 号 §8/O-9 未裁决前的自然读出:§1 ⑤ 显式禁用)。
 */
import type { CapabilityId } from '../contract/capabilities.ts'

/** 有原生适配器的供应商(其余对话提供方一律走 generic 兜底段)。 */
export type NativeProviderId = 'deepseek' | 'glm' | 'mimo'

/** 供应商 id 全集(裁决结论里的 provider/lender 取值)。 */
export type ProviderId = NativeProviderId | 'generic' | 'tavily'

/** files 能力粒度标注(29 §7-3 Q3:generic=文本级、原生=版面感知)。 */
export type FilesGranularity = 'text-level' | 'layout-aware'

/** 适配器句柄(符号路由位;K2/K3 适配器落地后按句柄挂执行体,路由器仍不执行)。 */
export type AdapterRoute =
  | 'deepseek-server-tools' // flash:deepseek_web_search/deepseek_read_url 服务端工具(Messages 形态)
  | 'deepseek-anthropic-web-search' // v4-pro:web_search_20250305/20260209(Anthropic 形态,R4 ⑥)
  | 'deepseek-files-api' // Files API:purpose 三值 + file_id 引用(版面感知)
  | 'deepseek-tools-api' // /v1/tools/search|fetch 独立端点(借用档 A)
  | 'glm-chat-web-search' // tools[].web_search 声明 + 顶层 web_search[] 回流
  | 'glm-web-search-api' // /paas/v4/web_search 独立端点(借用档 A)
  | 'glm-reader' // /paas/v4/reader(读网只能走此端点;原生与借用共用)
  | 'glm-files-parser' // 上传→parser 抽取→文本入 messages(文本级)
  | 'mimo-chat-web-search' // web_search 声明 + annotations 回流(仅 OpenAI Chat 协议)
  | 'generic-function-loop' // generic 工具循环(R3 八条裁剪;files 混合兜底执行面)
  | 'tavily-search' // Tavily /search 兜底
  | 'tavily-extract' // Tavily /extract read_url 兜底
  | 'none' // 无路径(unavailable)

// ---------------------------------------------------------------------------
// 部署配置与对话模型(矩阵查询键:已配置供应商集,29 §2.4)
// ---------------------------------------------------------------------------

/** 单个供应商的部署配置;键存在即视为「已配置」。models=该部署配置的对话模型 id。 */
export interface ProviderDeploymentConfig {
  readonly models?: readonly string[]
}

/** Tavily 兜底配置;键存在即视为已配置(29 §7-1 ③「按部署配置」)。 */
export interface TavilyDeploymentConfig {
  /** 承载 Tavily key 的环境变量名(不含凭据值)。 */
  readonly apiKeyEnv?: string
}

/** 部署供应商配置集(矩阵的查询键;随配置集变化而重算,见 matrix.ts invalidate)。 */
export interface DeploymentConfig {
  readonly providers: Readonly<Partial<Record<NativeProviderId, ProviderDeploymentConfig>>>
  readonly tavily?: TavilyDeploymentConfig
}

/** 当前对话模型(provider=generic 表示其余任意 OpenAI 兼容提供方——无原生段,直落借用/兜底)。 */
export interface ConversationRef {
  readonly provider: NativeProviderId | 'generic'
  readonly model: string
}

// ---------------------------------------------------------------------------
// 模型粒度能力表(数据,非逻辑;36 号 K1.4)
// ---------------------------------------------------------------------------

/** 一个模型行的能力位(undefined=该行无此能力)。 */
export interface ModelRow {
  /** 行标识(数据自查用)。 */
  readonly id: string
  /** 命中的模型 id 前缀(精确或前缀;依序首中即用)。 */
  readonly match: readonly string[]
  /** 供应商兜底行:无行命中时用于未知模型(match 为空)。 */
  readonly isDefault?: true
  readonly webSearch?: AdapterRoute
  readonly readUrl?: AdapterRoute
  readonly files?: AdapterRoute
  readonly filesGranularity?: FilesGranularity
}

/** 一条借用路径(该供应商作为出借方;29a 附-A)。 */
export interface BorrowPath {
  readonly capability: CapabilityId
  /** 档 A=独立端点直调(按次计费);档 B=最小 chat 请求(计 token)。 */
  readonly mode: 'direct-endpoint' | 'minimal-chat'
  readonly route: AdapterRoute
  /** 档 A 的独立端点。 */
  readonly endpoint?: string
  /** 档 B 需解析出借方模型(已配置模型 ∩ 支持行);解析不出则不提供该路径。 */
  readonly requiresLenderModel?: true
}

/** 一个供应商的完整能力表行(模型粒度 + 部署级端点 + 可出借能力 + 计费口径)。 */
export interface ProviderRow {
  readonly provider: NativeProviderId
  readonly models: readonly ModelRow[]
  /** 部署级能力(不随模型路由;29a R4 §3 修正行——独立端点族)。 */
  readonly providerLevel: {
    readonly readUrl?: AdapterRoute
    readonly files?: AdapterRoute
    readonly filesGranularity?: FilesGranularity
  }
  readonly borrow: readonly BorrowPath[]
  /** 计费口径(36 号 §2.4 口径表,数据非逻辑;矩阵 UI 是否展示未拍板=O-6b)。 */
  readonly billing?: ProviderBilling
}

/**
 * 计费口径数据(36 号 §2.4 口径表,来源 29a;只登记文档核实过的常数,未核实的留空
 * 不猜——如 GLM 语音单价 R1 unresolved-④)。
 */
export interface ProviderBilling {
  /**
   * web_search 按次计费(元/次):GLM 按引擎四档(29a R1 web_search 回流行:
   * search_std 0.01/search_pro 0.03/sogou、quark 各 0.05)。
   */
  readonly webSearchYuanPerCall?: Readonly<Record<string, number>>
}

/** GLM web_search 引擎四档单价(元/次;29a R1 回流行;K3.1 计费常数进矩阵数据)。 */
export const GLM_WEB_SEARCH_YUAN_PER_CALL: Readonly<Record<string, number>> = {
  search_std: 0.01,
  search_pro: 0.03,
  search_pro_sogou: 0.05,
  search_pro_quark: 0.05,
}

/**
 * 供应商能力表(数据)。行序即前缀命中优先级(如 claude-opus* 须先过 v4-pro 行)。
 * Claude 别名映射(claude-opus*→v4-pro、其余 claude*→flash)按 29a R4 计入 match 数据。
 */
export const PROVIDER_TABLE: readonly ProviderRow[] = [
  {
    provider: 'deepseek',
    models: [
      {
        // v4-pro:仅 Anthropic 形态 web_search 工具;无 vision/files(29a R4)。先于 flash 行命中 claude-opus*。
        id: 'deepseek-v4-pro',
        match: ['deepseek-v4-pro', 'claude-opus'],
        webSearch: 'deepseek-anthropic-web-search',
      },
      {
        // flash:web_search 原生(服务端工具)+read_url+files 版面感知+vision;旧名与 claude 别名由其承接(29a R4)。
        id: 'deepseek-flash',
        match: ['deepseek-flash', 'deepseek-v4-flash', 'v4-flash-vision-exp', 'claude'],
        webSearch: 'deepseek-server-tools',
        readUrl: 'deepseek-server-tools',
        files: 'deepseek-files-api',
        filesGranularity: 'layout-aware',
      },
    ],
    providerLevel: {},
    borrow: [
      // 档 A:搜索/抓取独立端点——借「搜索/抓取能力」无模型调用、按次计费(29a R4/R5)。
      { capability: 'web_search', mode: 'direct-endpoint', endpoint: '/v1/tools/search', route: 'deepseek-tools-api' },
      { capability: 'read_url', mode: 'direct-endpoint', endpoint: '/v1/tools/fetch', route: 'deepseek-tools-api' },
    ],
  },
  {
    provider: 'glm',
    models: [
      // glm-4-voice 请求不支持 web_search(29a R1)。
      { id: 'glm-4-voice', match: ['glm-4-voice'] },
      // 视觉模型请求不支持 web_search(29a R1);前缀族 glm-4v/4.1v/4.5v,新视觉型号随实测补行。
      { id: 'glm-vision', match: ['glm-4v', 'glm-4.1v', 'glm-4.5v'] },
      // chat 默认行:tools[].web_search 声明(29a R1)。
      { id: 'glm-chat', match: [], isDefault: true, webSearch: 'glm-chat-web-search' },
    ],
    // 读网只能走 /paas/v4/reader、files 走 parser 链路——均为独立端点,不随模型(29a R1)。
    providerLevel: {
      readUrl: 'glm-reader',
      files: 'glm-files-parser',
      filesGranularity: 'text-level',
    },
    borrow: [
      { capability: 'web_search', mode: 'direct-endpoint', endpoint: '/paas/v4/web_search', route: 'glm-web-search-api' },
      { capability: 'read_url', mode: 'direct-endpoint', endpoint: '/paas/v4/reader', route: 'glm-reader' },
    ],
    // 计费常数进矩阵数据(36 号 K3.1;§2.4 口径表,来源 29a R1 web_search 回流行)。
    billing: { webSearchYuanPerCall: GLM_WEB_SEARCH_YUAN_PER_CALL },
  },
  {
    provider: 'mimo',
    models: [
      // web_search 仅 OpenAI Chat 协议、支持模型 v2.6 三系(29a R2);其余 mimo 模型无行=无原生。
      { id: 'mimo-v2.6', match: ['mimo-v2.6-flash', 'mimo-v2.6-pro', 'mimo-v2.6-pro-ultraspeed'], webSearch: 'mimo-chat-web-search' },
    ],
    providerLevel: {},
    borrow: [
      // 档 B:无独立端点,借用=一次最小 chat 请求(专用 model id+单条消息;29a R2/附-A)。
      { capability: 'web_search', mode: 'minimal-chat', route: 'mimo-chat-web-search', requiresLenderModel: true },
    ],
  },
]

/** 借用候选顺序(24a B4 拍板优先级:deepseek → glm → mimo,其余通用兜底)。 */
export const BORROW_ORDER: readonly NativeProviderId[] = ['deepseek', 'glm', 'mimo']

// ---------------------------------------------------------------------------
// 裁决结论
// ---------------------------------------------------------------------------

/** 三段式结论四态(native|borrow|fallback|unavailable;29 §3 矩阵行)。 */
export type RouteKind = 'native' | 'borrow' | 'fallback' | 'unavailable'

/**
 * 单能力裁决结论:四态 + 适配器句柄 + 借用明细;路由器不执行(29 §1 ②)。
 * `unavailable` 必带 reason——显式降级,绝不静默(29 §1 ⑤)。
 */
export interface RouteDecision {
  readonly capability: CapabilityId
  readonly route: RouteKind
  readonly adapter: AdapterRoute
  /** native=对话模型供应商;fallback=generic|tavily。 */
  readonly provider?: ProviderId
  /** native=对话模型;borrow 档 B=出借方执行模型。 */
  readonly model?: string
  /** borrow 段的出借方。 */
  readonly lender?: NativeProviderId
  readonly borrowMode?: 'direct-endpoint' | 'minimal-chat'
  /** 档 A 独立端点。 */
  readonly endpoint?: string
  readonly filesGranularity?: FilesGranularity
  readonly reason?: string
}

// ---------------------------------------------------------------------------
// 表查询与三段式裁决(纯函数)
// ---------------------------------------------------------------------------

/** 前缀命中查模型行(含 isDefault 兜底行);无兜底行且无命中 → undefined(=该模型无原生能力)。 */
export function findModelRow(providerRow: ProviderRow, model: string): ModelRow | undefined {
  for (const row of providerRow.models) {
    if (row.match.some(prefix => model === prefix || model.startsWith(prefix))) return row
  }
  return providerRow.models.find(row => row.isDefault === true)
}

function findProviderRow(table: readonly ProviderRow[], provider: NativeProviderId): ProviderRow | undefined {
  return table.find(row => row.provider === provider)
}

/** 档 B 出借方模型解析:已配置模型 ∩ 该供应商支持行(web_search 能力;29a R2)。 */
function resolveLenderModel(providerRow: ProviderRow, providerConfig: ProviderDeploymentConfig): string | undefined {
  const configured = providerConfig.models
  if (!configured) return undefined
  for (const model of configured) {
    const row = findModelRow(providerRow, model)
    if (row !== undefined && row.webSearch !== undefined) return model
  }
  return undefined
}

function nativeDecision(capability: CapabilityId, conversation: ConversationRef, row: ProviderRow): RouteDecision | undefined {
  const modelRow = findModelRow(row, conversation.model)
  if (capability === 'web_search' || capability === 'read_url') {
    // 模型粒度优先(deepseek 两行差异/MiMo 模型限定),provider 级端点次之(GLM reader)。
    const adapter = capability === 'web_search' ? modelRow?.webSearch : (modelRow?.readUrl ?? row.providerLevel.readUrl)
    if (adapter !== undefined) {
      return { capability, route: 'native', adapter, provider: conversation.provider, model: conversation.model }
    }
    return undefined
  }
  if (capability === 'files') {
    const adapter = modelRow?.files ?? row.providerLevel.files
    const granularity = modelRow?.filesGranularity ?? row.providerLevel.filesGranularity
    if (adapter !== undefined) {
      return {
        capability,
        route: 'native',
        adapter,
        provider: conversation.provider,
        model: conversation.model,
        ...(granularity !== undefined ? { filesGranularity: granularity } : {}),
      }
    }
  }
  return undefined
}

function borrowDecision(
  capability: CapabilityId,
  config: DeploymentConfig,
  conversation: ConversationRef,
  table: readonly ProviderRow[],
): RouteDecision | undefined {
  for (const lender of BORROW_ORDER) {
    if (lender === conversation.provider) continue // 「其他已配置供应商」(29 §2.4)
    const lenderConfig = config.providers[lender]
    if (lenderConfig === undefined) continue
    const lenderRow = findProviderRow(table, lender)
    if (lenderRow === undefined) continue
    const path = lenderRow.borrow.find(p => p.capability === capability)
    if (path === undefined) continue
    if (path.requiresLenderModel === true) {
      // 档 B:解析不出可承载的出借方模型 → 该路径不成立,顺延下一段供给链。
      const lenderModel = resolveLenderModel(lenderRow, lenderConfig)
      if (lenderModel === undefined) continue
      return {
        capability,
        route: 'borrow',
        adapter: path.route,
        lender,
        borrowMode: 'minimal-chat',
        model: lenderModel,
      }
    }
    return {
      capability,
      route: 'borrow',
      adapter: path.route,
      lender,
      borrowMode: 'direct-endpoint',
      ...(path.endpoint !== undefined ? { endpoint: path.endpoint } : {}),
    }
  }
  return undefined
}

function fallbackDecision(capability: CapabilityId, config: DeploymentConfig): RouteDecision {
  const tavilyConfigured = config.tavily !== undefined
  switch (capability) {
    case 'web_search': {
      // ③ 最终兜底:Tavily(按部署配置);未配置且无原生/借用 → 显式降级,绝不静默外发(29 §7-1)。
      if (tavilyConfigured) {
        return { capability, route: 'fallback', adapter: 'tavily-search', provider: 'tavily' }
      }
      return {
        capability,
        route: 'unavailable',
        adapter: 'none',
        reason: '未配置 Tavily 且无原生/借用 web_search 可用——显式降级为「仅内部」档,绝不静默外发(29 §7-1)',
      }
    }
    case 'read_url':
      return tavilyConfigured
        ? { capability, route: 'fallback', adapter: 'tavily-extract', provider: 'tavily' }
        : { capability, route: 'unavailable', adapter: 'none', reason: '未配置 Tavily 且无原生/借用 read_url 可用(29 §7-1 供给链同构)' }
    case 'files':
      // Q3 拍板:按类型混合兜底(图片对视觉模型 base64 内联;文档服务端文本抽取+体积上限;
      // 不可解析显式降级)。矩阵标注 generic=文本级(29 §7-3)。
      return {
        capability,
        route: 'fallback',
        adapter: 'generic-function-loop',
        provider: 'generic',
        filesGranularity: 'text-level',
      }
    case 'tts':
    case 'asr':
      // 语音=自托管栈兜底,本批不可路由(29 §7-2;P-3 归属;O-9 未裁决,按 §1 ⑤ 显式 unavailable)。
      return { capability, route: 'unavailable', adapter: 'none', reason: '语音供给链归 P-3 开发(29 §4 P-3/§7-2),本批不可路由——显式禁用态,不假装可用(36 号 §8/O-9)' }
  }
}

/**
 * 三段式裁决(纯函数;对话模型原生 → 已配置供应商原生(借用) → 通用兜底)。
 * 对话模型所属供应商视为已配置(能开对话即已配置);其余供应商以 config.providers 为准。
 */
export function routeCapability(
  config: DeploymentConfig,
  conversation: ConversationRef,
  capability: CapabilityId,
  table: readonly ProviderRow[] = PROVIDER_TABLE,
): RouteDecision {
  // 段 1:对话模型原生(generic 无原生段)。
  if (conversation.provider !== 'generic') {
    const row = findProviderRow(table, conversation.provider)
    if (row !== undefined) {
      const native = nativeDecision(capability, conversation, row)
      if (native !== undefined) return native
    }
  }
  // 段 2:其他已配置供应商原生(借用;查询键=已配置供应商集,29 §2.4)。
  const borrow = borrowDecision(capability, config, conversation, table)
  if (borrow !== undefined) return borrow
  // 段 3:通用兜底 / unavailable。
  return fallbackDecision(capability, config)
}
