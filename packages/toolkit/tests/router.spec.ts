/**
 * K1.4 工具路由器单测(36 号 §3 表验收门禁):
 * - 三段式顺序(原生 → 借用 → 兜底;29 §2.4/§7-1);
 * - 无路径=unavailable 显式(reason 必非空,§1 ⑤ 绝不静默);
 * - 模型粒度下钻(deepseek flash/v4-pro 两行、GLM 视觉模型/voice 无 web_search、MiMo v2.6 限定);
 * - 借用两档(档 A 独立端点直调 / 档 B 最小 chat 请求需出借方模型;29a 附-A);
 * - 配置集变更 → 矩阵失效重算(invalidate 钩子);
 * - 搜索档位与 files 粒度标注;
 * - 参数翻译纯函数快照(GLM 1:1 / deepseek 声明 / generic 四件套 / Tavily 字段 / tool_choice 降级)。
 */
import { describe, expect, it } from 'vitest'
import {
  BORROW_ORDER,
  GENERIC_TOOL_CALL_FLAGS,
  PROVIDER_TABLE,
  SEARCH_TIER_LABELS,
  computeMatrix,
  createMatrixService,
  createToolkit,
  findModelRow,
  routeCapability,
  toDeepseekFilePurpose,
  toDeepseekServerTools,
  toGenericFunctionTool,
  toGlmReaderBody,
  toGlmWebSearchTool,
  toTavilyExtractBody,
  toTavilySearchBody,
  translateToolChoice,
} from '../src/index.ts'
import type { DeploymentConfig } from '../src/index.ts'

// ---------------------------------------------------------------------------
// 场景配置(已配置供应商集=矩阵查询键,29 §2.4)
// ---------------------------------------------------------------------------

const CONV_GLM_CHAT = { provider: 'glm', model: 'glm-4.6' } as const
const CONV_GLM_VISION = { provider: 'glm', model: 'glm-4.5v' } as const
const CONV_GLM_VOICE = { provider: 'glm', model: 'glm-4-voice' } as const
const CONV_FLASH = { provider: 'deepseek', model: 'deepseek-flash' } as const
const CONV_V4PRO = { provider: 'deepseek', model: 'deepseek-v4-pro' } as const
const CONV_MIMO_V26 = { provider: 'mimo', model: 'mimo-v2.6-flash' } as const
const CONV_MIMO_OLD = { provider: 'mimo', model: 'mimo-v2.5-pro' } as const
const CONV_GENERIC = { provider: 'generic', model: 'third-party-chat' } as const

const WITH_DEEPSEEK: DeploymentConfig = { providers: { deepseek: {} } }
const WITH_GLM: DeploymentConfig = { providers: { glm: {} } }
const WITH_TAVILY: DeploymentConfig = { providers: {}, tavily: { apiKeyEnv: 'TAVILY_API_KEY' } }
const EMPTY_CONFIG: DeploymentConfig = { providers: {} }

describe('三段式顺序:对话模型原生 → 借用 → 兜底(29 §2.4)', () => {
  it('段 1 原生优先:glm chat 对话 + deepseek 已配置 → web_search 走 glm 原生,不借用', () => {
    const decision = routeCapability(WITH_DEEPSEEK, CONV_GLM_CHAT, 'web_search')
    expect(decision).toMatchObject({ route: 'native', adapter: 'glm-chat-web-search', provider: 'glm', model: 'glm-4.6' })
  })

  it('段 2 借用:GLM 视觉模型无原生 web_search → 借 deepseek 档 A 独立端点', () => {
    const decision = routeCapability(WITH_DEEPSEEK, CONV_GLM_VISION, 'web_search')
    expect(decision).toMatchObject({
      route: 'borrow',
      lender: 'deepseek',
      borrowMode: 'direct-endpoint',
      endpoint: '/v1/tools/search',
      adapter: 'deepseek-tools-api',
    })
  })

  it('段 2 借用(read_url):MiMo 对话无原生读网(29a R2)→ 借 deepseek /v1/tools/fetch', () => {
    const decision = routeCapability(WITH_DEEPSEEK, CONV_MIMO_V26, 'read_url')
    expect(decision).toMatchObject({ route: 'borrow', lender: 'deepseek', endpoint: '/v1/tools/fetch', borrowMode: 'direct-endpoint' })
  })

  it('段 3 兜底:generic 对话 + 仅 Tavily → web_search 走 tavily-search', () => {
    const decision = routeCapability(WITH_TAVILY, CONV_GENERIC, 'web_search')
    expect(decision).toMatchObject({ route: 'fallback', adapter: 'tavily-search', provider: 'tavily' })
  })

  it('glm chat 对话 read_url 走 provider 级 /paas/v4/reader 端点(不随模型;29a R1)', () => {
    const decision = routeCapability(EMPTY_CONFIG, CONV_GLM_CHAT, 'read_url')
    expect(decision).toMatchObject({ route: 'native', adapter: 'glm-reader', provider: 'glm' })
  })

  it('GLM 视觉对话的 read_url 仍走 glm-reader(独立端点不受视觉限制影响)', () => {
    expect(routeCapability(EMPTY_CONFIG, CONV_GLM_VISION, 'read_url')).toMatchObject({ route: 'native', adapter: 'glm-reader' })
  })

  it('files 兜底恒可用:generic 对话 → 混合兜底,标注文本级(29 §7-3 Q3)', () => {
    const decision = routeCapability(EMPTY_CONFIG, CONV_GENERIC, 'files')
    expect(decision).toMatchObject({ route: 'fallback', adapter: 'generic-function-loop', provider: 'generic', filesGranularity: 'text-level' })
  })
})

describe('无路径=unavailable 显式(29 §1 ⑤:绝不静默)', () => {
  it('未配置 Tavily 且无原生/借用 web_search → unavailable + 「仅内部」理由(29 §7-1)', () => {
    const decision = routeCapability(EMPTY_CONFIG, CONV_GENERIC, 'web_search')
    expect(decision.route).toBe('unavailable')
    expect(decision.adapter).toBe('none')
    expect(decision.reason).toContain('仅内部')
    expect(decision.reason).toContain('绝不静默外发')
  })

  it('read_url 同构:无路径 unavailable 带 reason', () => {
    const decision = routeCapability(EMPTY_CONFIG, CONV_GENERIC, 'read_url')
    expect(decision.route).toBe('unavailable')
    expect(decision.reason).toBeTruthy()
  })

  it('tts/asr 本批一律 unavailable(语音链归 P-3;O-9 未裁决按 §1 ⑤ 自然读出)', () => {
    for (const capability of ['tts', 'asr'] as const) {
      const decision = routeCapability(WITH_DEEPSEEK, CONV_FLASH, capability)
      expect(decision.route).toBe('unavailable')
      expect(decision.reason).toContain('P-3')
    }
  })
})

describe('模型粒度下钻(deepseek 拆两行 / GLM 视觉与 voice / MiMo v2.6 限定)', () => {
  it('deepseek-flash 行:web_search 原生(服务端工具)+read_url+files 版面感知(29a R4)', () => {
    expect(routeCapability(WITH_DEEPSEEK, CONV_FLASH, 'web_search')).toMatchObject({ route: 'native', adapter: 'deepseek-server-tools' })
    expect(routeCapability(WITH_DEEPSEEK, CONV_FLASH, 'read_url')).toMatchObject({ route: 'native', adapter: 'deepseek-server-tools' })
    expect(routeCapability(WITH_DEEPSEEK, CONV_FLASH, 'files')).toMatchObject({ route: 'native', adapter: 'deepseek-files-api', filesGranularity: 'layout-aware' })
  })

  it('deepseek-v4-pro 行:仅 Anthropic 形态 web_search 工具;无 vision/files(29a R4)', () => {
    const withTavily: DeploymentConfig = { providers: { deepseek: {} }, tavily: { apiKeyEnv: 'TAVILY_API_KEY' } }
    expect(routeCapability(withTavily, CONV_V4PRO, 'web_search')).toMatchObject({ route: 'native', adapter: 'deepseek-anthropic-web-search' })
    expect(routeCapability(withTavily, CONV_V4PRO, 'files')).toMatchObject({ route: 'fallback', adapter: 'generic-function-loop', filesGranularity: 'text-level' })
    expect(routeCapability(withTavily, CONV_V4PRO, 'read_url')).toMatchObject({ route: 'fallback', adapter: 'tavily-extract' })
  })

  it('GLM 视觉模型(glm-4.5v)与 glm-4-voice 无原生 web_search(29a R1)', () => {
    expect(routeCapability(EMPTY_CONFIG, CONV_GLM_VISION, 'web_search').route).toBe('unavailable')
    expect(routeCapability(EMPTY_CONFIG, CONV_GLM_VOICE, 'web_search').route).toBe('unavailable')
  })

  it('glm chat 未知型号落默认行(仍有原生 web_search)', () => {
    expect(routeCapability(EMPTY_CONFIG, { provider: 'glm', model: 'glm-5-air' }, 'web_search')).toMatchObject({ route: 'native', adapter: 'glm-chat-web-search' })
  })

  it('MiMo web_search 仅 v2.6 三系支持(29a R2);v2.5 型号无原生', () => {
    expect(routeCapability(EMPTY_CONFIG, CONV_MIMO_V26, 'web_search')).toMatchObject({ route: 'native', adapter: 'mimo-chat-web-search' })
    const old = routeCapability(WITH_GLM, CONV_MIMO_OLD, 'web_search')
    expect(old).toMatchObject({ route: 'borrow', lender: 'glm', endpoint: '/paas/v4/web_search' })
  })

  it('表数据:Claude 别名 claude-opus*→v4-pro 行、其余 claude*→flash 行(29a R4)', () => {
    const deepseek = PROVIDER_TABLE.find(row => row.provider === 'deepseek')
    expect(deepseek).toBeDefined()
    if (deepseek === undefined) return
    expect(findModelRow(deepseek, 'claude-opus-4.6')?.id).toBe('deepseek-v4-pro')
    expect(findModelRow(deepseek, 'claude-sonnet-4')?.id).toBe('deepseek-flash')
    expect(findModelRow(deepseek, 'deepseek-v4-flash')?.id).toBe('deepseek-flash')
  })
})

describe('跨供应商借用两档(29 §2.4;29a 附-A 合并修正)', () => {
  it('档 A 独立端点直调:deepseek 与 glm 出借 web_search/read_url 零 chat 请求', () => {
    expect(routeCapability(WITH_DEEPSEEK, CONV_GLM_VISION, 'web_search')).toMatchObject({ borrowMode: 'direct-endpoint', endpoint: '/v1/tools/search' })
    expect(routeCapability(WITH_GLM, CONV_GENERIC, 'web_search')).toMatchObject({ borrowMode: 'direct-endpoint', lender: 'glm', endpoint: '/paas/v4/web_search' })
    expect(routeCapability(WITH_GLM, CONV_GENERIC, 'read_url')).toMatchObject({ borrowMode: 'direct-endpoint', endpoint: '/paas/v4/reader' })
  })

  it('档 B 最小 chat 请求:mimo 出借需解析出借方模型(专用 model id+单条消息;29a R2)', () => {
    const decision = routeCapability({ providers: { mimo: { models: ['mimo-v2.6-pro'] } } }, CONV_GENERIC, 'web_search')
    expect(decision).toMatchObject({ route: 'borrow', lender: 'mimo', borrowMode: 'minimal-chat', model: 'mimo-v2.6-pro', adapter: 'mimo-chat-web-search' })
  })

  it('档 B 解析不出可承载模型 → 该路径不成立,顺延下一段供给链', () => {
    const config: DeploymentConfig = { providers: { mimo: { models: ['mimo-v2.5-pro'] } }, tavily: { apiKeyEnv: 'TAVILY_API_KEY' } }
    const decision = routeCapability(config, CONV_GENERIC, 'web_search')
    expect(decision).toMatchObject({ route: 'fallback', adapter: 'tavily-search' })
  })

  it('借用候选按 deepseek → glm → mimo 优先级(24a B4 拍板)', () => {
    expect(BORROW_ORDER).toEqual(['deepseek', 'glm', 'mimo'])
    const both: DeploymentConfig = { providers: { deepseek: {}, mimo: { models: ['mimo-v2.6-flash'] } } }
    expect(routeCapability(both, CONV_GENERIC, 'web_search')).toMatchObject({ lender: 'deepseek' })
  })

  it('借用只看「其他已配置供应商」:对话供应商自身不重复出借(29 §2.4)', () => {
    // 对话 glm(视觉)且仅 glm 已配置 → 无 deepseek/mimo 可借 → unavailable。
    expect(routeCapability(WITH_GLM, CONV_GLM_VISION, 'web_search').route).toBe('unavailable')
  })
})

describe('部署级能力矩阵(36 号 K4.1 数据底座)', () => {
  it('五能力全覆盖;web_search 行带搜索档位、files 行带粒度标注', () => {
    const matrix = computeMatrix({ providers: { deepseek: {} }, tavily: { apiKeyEnv: 'TAVILY_API_KEY' } }, CONV_GLM_CHAT)
    expect(Object.keys(matrix).sort()).toEqual(['asr', 'files', 'read_url', 'tts', 'web_search'])
    expect(matrix.web_search.searchTier).toBe('internal-native-tavily')
    expect(matrix.files.filesGranularity).toBe('text-level') // glm 原生 files=parser 链路文本级
    expect(matrix.files.decision.filesGranularity).toBe('text-level')
    expect(matrix.tts.decision.route).toBe('unavailable')
  })

  it('搜索档位三档文案钉死(29 §7-1 原文)', () => {
    expect(SEARCH_TIER_LABELS['internal-only']).toBe('仅内部')
    expect(SEARCH_TIER_LABELS['internal-native']).toBe('内部+原生')
    expect(SEARCH_TIER_LABELS['internal-native-tavily']).toBe('内部+原生+Tavily')
  })

  it('档位推导:无原生+无 Tavily=仅内部;有原生无 Tavily=内部+原生;双有=三段全;仅 Tavily=扩展档', () => {
    expect(computeMatrix(EMPTY_CONFIG, CONV_GENERIC).web_search.searchTier).toBe('internal-only')
    expect(computeMatrix(EMPTY_CONFIG, CONV_GLM_CHAT).web_search.searchTier).toBe('internal-native')
    expect(computeMatrix(WITH_TAVILY, CONV_GLM_CHAT).web_search.searchTier).toBe('internal-native-tavily')
    expect(computeMatrix(WITH_TAVILY, CONV_GENERIC).web_search.searchTier).toBe('internal-tavily')
  })
})

describe('配置集变更 → 矩阵失效重算(invalidate 钩子)', () => {
  it('配置 Tavily 后矩阵重算:web_search unavailable→fallback,档位 仅内部→扩展档', () => {
    const service = createMatrixService(EMPTY_CONFIG, CONV_GENERIC)
    expect(service.entry('web_search').decision.route).toBe('unavailable')
    expect(service.entry('web_search').searchTier).toBe('internal-only')
    const before = service.revision
    service.updateConfig(WITH_TAVILY)
    expect(service.revision).toBe(before + 1)
    expect(service.entry('web_search').decision).toMatchObject({ route: 'fallback', adapter: 'tavily-search' })
    expect(service.entry('web_search').searchTier).toBe('internal-tavily')
  })

  it('新增出借方后重算:web_search unavailable→borrow(档 A)', () => {
    const service = createMatrixService(EMPTY_CONFIG, CONV_GLM_VISION)
    expect(service.entry('web_search').decision.route).toBe('unavailable')
    service.updateConfig(WITH_DEEPSEEK)
    expect(service.entry('web_search').decision).toMatchObject({ route: 'borrow', lender: 'deepseek' })
  })

  it('对话模型切换后重算:deepseek flash → v4-pro 的 files 由原生版面感知降为兜底文本级', () => {
    const service = createMatrixService(WITH_DEEPSEEK, CONV_FLASH)
    expect(service.entry('files').decision).toMatchObject({ route: 'native', filesGranularity: 'layout-aware' })
    service.setConversation(CONV_V4PRO)
    expect(service.entry('files').decision).toMatchObject({ route: 'fallback', filesGranularity: 'text-level' })
  })

  it('invalidate() 手动失效等价触发一次重算(revision 递增)', () => {
    const service = createMatrixService(EMPTY_CONFIG, CONV_GLM_CHAT)
    const before = service.revision
    service.invalidate()
    expect(service.revision).toBe(before + 1)
  })
})

describe('createToolkit 装配(门面)', () => {
  it('契约版本透出;route() 与矩阵快照一致', () => {
    const toolkit = createToolkit(WITH_DEEPSEEK, CONV_GLM_VISION)
    expect(toolkit.contractVersion).toBe(1)
    expect(toolkit.route('web_search')).toEqual(toolkit.matrix().web_search.decision)
    expect(toolkit.route('web_search')).toMatchObject({ route: 'borrow', lender: 'deepseek' })
    toolkit.updateConfig(EMPTY_CONFIG)
    expect(toolkit.route('web_search').route).toBe('unavailable')
  })
})

describe('参数翻译纯函数快照(29 §1 ②:声明 → 提供方形态;不执行)', () => {
  it('web_search → GLM tools[].web_search 1:1(29a R1)', () => {
    expect(toGlmWebSearchTool({
      query: '场地选址',
      engine: 'search_pro',
      count: 20,
      domainFilter: ['example.com'],
      recency: 'oneWeek',
      contentSize: 'high',
    })).toEqual({
      tools: [{
        type: 'web_search',
        web_search: {
          search_query: '场地选址',
          search_engine: 'search_pro',
          count: 20,
          search_domain_filter: ['example.com'],
          search_recency_filter: 'oneWeek',
          content_size: 'high',
        },
      }],
      tool_choice: 'auto',
    })
  })

  it('web_search → GLM 缺省回填(engine=search_std/count=10/recency=noLimit/contentSize=medium;空域名过滤省略)', () => {
    expect(toGlmWebSearchTool({ query: 'q' })).toEqual({
      tools: [{
        type: 'web_search',
        web_search: {
          search_query: 'q',
          search_engine: 'search_std',
          count: 10,
          search_recency_filter: 'noLimit',
          content_size: 'medium',
        },
      }],
      tool_choice: 'auto',
    })
  })

  it('web_search/read_url → deepseek 服务端工具声明(type 必填、不发 name;29a R4),入参去重', () => {
    expect(toDeepseekServerTools(['web_search', 'read_url'])).toEqual({
      tools: [{ type: 'deepseek_web_search' }, { type: 'deepseek_read_url' }],
    })
    expect(toDeepseekServerTools(['web_search', 'web_search'])).toEqual({ tools: [{ type: 'deepseek_web_search' }] })
  })

  it('files 意图 → deepseek purpose 三分之两译(layoutAware→版面感知;29a R4)', () => {
    expect(toDeepseekFilePurpose({ layoutAware: true })).toBe('rich_layout_recognition')
    expect(toDeepseekFilePurpose({})).toBe('text_recognition')
  })

  it('generic function 四件套(29a R3 发送侧;工具名过命名规范)', () => {
    expect(toGenericFunctionTool({
      name: 'knowledge_search',
      description: '内部知识库检索',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    })).toEqual({
      type: 'function',
      function: {
        name: 'knowledge_search',
        description: '内部知识库检索',
        parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      },
    })
    expect(() => toGenericFunctionTool({ name: 'bad.name', description: 'x', parameters: {} })).toThrow()
    expect(GENERIC_TOOL_CALL_FLAGS).toEqual({ parallel_tool_calls: true })
  })

  it('web_search → Tavily /search(count 钳 20、recency→time_range、include_published_date 恒 true;29a R6)', () => {
    expect(toTavilySearchBody({
      query: '场地选址',
      count: 50,
      domainFilter: ['example.com'],
      recency: 'oneWeek',
      contentSize: 'high',
    })).toEqual({
      query: '场地选址',
      max_results: 20,
      include_domains: ['example.com'],
      time_range: 'week',
      include_published_date: true,
    })
    expect(toTavilySearchBody({ query: 'q' })).toEqual({ query: 'q', max_results: 10, include_published_date: true })
  })

  it('read_url → Tavily /extract 与 GLM /paas/v4/reader(29a R6/R1)', () => {
    expect(toTavilyExtractBody({ url: 'https://example.com/a' })).toEqual({ urls: ['https://example.com/a'] })
    expect(toGlmReaderBody({ url: 'https://example.com/a' })).toEqual({ url: 'https://example.com/a', timeout: 20, return_format: 'markdown' })
    expect(toGlmReaderBody({ url: 'https://example.com/a', timeout: 5, returnFormat: 'text' })).toEqual({ url: 'https://example.com/a', timeout: 5, return_format: 'text' })
  })

  it('tool_choice 分支翻译:glm/mimo 一律降 auto;generic 原样(29a R1/R2/R3)', () => {
    expect(translateToolChoice('glm', 'required')).toBe('auto')
    expect(translateToolChoice('mimo', { type: 'function', function: { name: 'knowledge_search' } })).toBe('auto')
    expect(translateToolChoice('generic', 'required')).toBe('required')
    expect(translateToolChoice('generic', { type: 'function', function: { name: 'knowledge_search' } })).toEqual({
      type: 'function',
      function: { name: 'knowledge_search' },
    })
    expect(translateToolChoice('generic', 'none')).toBe('none')
  })
})
