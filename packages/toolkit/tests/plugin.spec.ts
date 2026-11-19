/**
 * plugin 入口测试(36 号 K1.1 插件定位;2026-11-18 裁决 C:本入口不注册 HTTP 路由,
 * 原「端点返回结构」断言落在门面 capabilities() 的返回结构上):
 * - 硬性规范 1:default export 是插件实例(loader 取实例,漏写 = 静默不装载);
 * - 装载即 provide('toolkit') → ctx.toolkit;服务形状 = 门面三件(能力清单/路由器实例/版本);
 * - 逆闭包(硬性规范 6):apply 返回的 disposer 撤 provide,卸载零残留、重挂载可交换;
 * - capabilities() 返回结构:五能力全覆盖、键集白名单(仅路由档位/提供方/出借方/粒度
 *   标注),不含密钥/端点/模型/计费;与 matrix() 同一快照(数据来自 36 号路由器);
 * - 可配:config 注入覆盖缺省;defaultDeploymentConfig 环境推导只记变量名不记密钥值。
 */
import { describe, expect, it } from 'vitest'
import { CAPABILITY_IDS, CONTRACT_VERSION } from '../src/index.ts'
import type { CapabilitiesStatus, Toolkit } from '../src/index.ts'
import toolkitPlugin, {
  defaultDeploymentConfig,
  defineToolkitPlugin,
  TOOLKIT_PLUGIN_NAME,
  TOOLKIT_SERVICE_ID,
} from '../src/plugin.ts'
import type { ToolkitHostContext, ToolkitPluginConfig } from '../src/plugin.ts'

// ---------------------------------------------------------------------------
// 结构性假 ctx(照 audit tests/plugin.spec.ts:只声明 apply 用到的 provide 面,
// 不依赖 cordis 运行时;provide 记账进 services 表,disposer 撤销)。
// ---------------------------------------------------------------------------

function makeFakeContext() {
  const services = new Map<string, unknown>()
  const fake: ToolkitHostContext = {
    provide: (name, value) => {
      services.set(name, value)
      return () => {
        services.delete(name)
      }
    },
  }
  return {
    fake,
    serviceIds(): string[] {
      return [...services.keys()]
    },
    toolkit(): Toolkit {
      return services.get(TOOLKIT_SERVICE_ID) as Toolkit
    },
  }
}

function mount(harness: ReturnType<typeof makeFakeContext>, config: ToolkitPluginConfig = {}): () => void {
  return defineToolkitPlugin(config).apply(harness.fake)
}

// ---------------------------------------------------------------------------
// 装载 / provide / 逆闭包(硬性规范 1/6)
// ---------------------------------------------------------------------------

describe('toolkit 插件入口:装载 / provide / 逆闭包', () => {
  it('default export 是插件实例(硬性规范 1:loader 取实例,漏写 = 静默不装载)', () => {
    expect(TOOLKIT_PLUGIN_NAME).toBe('eterna-toolkit')
    expect(toolkitPlugin.name).toBe(TOOLKIT_PLUGIN_NAME)
    expect(typeof toolkitPlugin.apply).toBe('function')
  })

  it('装载即 provide("toolkit") → ctx.toolkit;服务形状 = 门面三件(能力清单/路由器实例/版本)', () => {
    const harness = makeFakeContext()
    const dispose = mount(harness)
    expect(harness.serviceIds()).toEqual([TOOLKIT_SERVICE_ID])
    expect(TOOLKIT_SERVICE_ID).toBe('toolkit')
    const toolkit = harness.toolkit()
    // 版本:契约版本常量直透(O-7 版本化语义未拍板,先落常量)。
    expect(toolkit.contractVersion).toBe(CONTRACT_VERSION)
    // 路由器实例:矩阵/裁决/失效重算面(36 号 K1.4;路由器不执行,29 §1 ②)。
    expect(typeof toolkit.matrix).toBe('function')
    expect(typeof toolkit.route).toBe('function')
    expect(typeof toolkit.updateConfig).toBe('function')
    expect(typeof toolkit.setConversation).toBe('function')
    expect(typeof toolkit.invalidate).toBe('function')
    expect(toolkit.revision).toBeGreaterThanOrEqual(1)
    // 能力清单:capabilities() 键集恒 = CAPABILITY_IDS(29 §1 ① 五能力)。
    expect(typeof toolkit.capabilities).toBe('function')
    expect(Object.keys(toolkit.capabilities()).sort()).toEqual([...CAPABILITY_IDS].sort())
    dispose()
  })

  it('逆闭包:disposer 撤 provide(卸载零残留,硬性规范 6);重挂载可交换(provide 可交换接口)', () => {
    const harness = makeFakeContext()
    const dispose = mount(harness)
    expect(harness.serviceIds()).toEqual([TOOLKIT_SERVICE_ID])
    dispose()
    expect(harness.serviceIds()).toEqual([])
    // 再挂载(换配置)→ 服务恢复且新门面生效(cordis provide 可交换):
    // deepseek 入配置集 → web_search 由 unavailable 变为借 deepseek(29 §2.4)。
    const remount = mount(harness, { deployment: { providers: { deepseek: {} } } })
    expect(harness.serviceIds()).toEqual([TOOLKIT_SERVICE_ID])
    expect(harness.toolkit().capabilities().web_search).toMatchObject({ route: 'borrow', lender: 'deepseek' })
    remount()
    expect(harness.serviceIds()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// capabilities() 返回结构(裁决 C:无 HTTP 路由,状态数据面 = 本方法)
// ---------------------------------------------------------------------------

describe('capabilities() 部署级能力状态(无密钥投影)', () => {
  it('空配置 + 缺省 generic 对话:web_search/read_url 显式 unavailable,files 兜底文本级,语音不可路由', () => {
    const harness = makeFakeContext()
    const dispose = mount(harness)
    const status = harness.toolkit().capabilities()
    // web_search 行恒带档位标注(即使 unavailable 也如实标注「仅内部」,29 §7-1)。
    expect(status.web_search).toEqual({ route: 'unavailable', searchTier: 'internal-only' })
    expect(status.read_url).toEqual({ route: 'unavailable' })
    expect(status.files).toEqual({ route: 'fallback', provider: 'generic', filesGranularity: 'text-level' })
    expect(status.tts).toEqual({ route: 'unavailable' })
    expect(status.asr).toEqual({ route: 'unavailable' })
    dispose()
  })

  it('deepseek flash 配置:web_search/read_url 原生 + files 版面感知,搜索档如实(29a R4 flash 行)', () => {
    const harness = makeFakeContext()
    const dispose = mount(harness, {
      deployment: { providers: { deepseek: {} } },
      conversation: { provider: 'deepseek', model: 'deepseek-flash' },
    })
    const status = harness.toolkit().capabilities()
    expect(status.web_search).toEqual({ route: 'native', provider: 'deepseek', searchTier: 'internal-native' })
    expect(status.read_url).toEqual({ route: 'native', provider: 'deepseek' })
    expect(status.files).toEqual({ route: 'native', provider: 'deepseek', filesGranularity: 'layout-aware' })
    dispose()
  })

  it('borrow 行只露出借方,不露独立端点/执行模型(部署细节不外露,29 §2.4)', () => {
    const harness = makeFakeContext()
    const dispose = mount(harness, {
      deployment: { providers: { deepseek: {} } },
      conversation: { provider: 'glm', model: 'glm-4.5v' },
    })
    expect(harness.toolkit().capabilities().web_search).toEqual({
      route: 'borrow',
      lender: 'deepseek',
      searchTier: 'internal-native',
    })
    dispose()
  })

  it('状态行键集白名单:仅 route/provider/lender/searchTier/filesGranularity;不含密钥/端点/模型/计费', () => {
    const harness = makeFakeContext()
    const dispose = mount(harness, {
      deployment: {
        providers: { deepseek: {}, glm: { models: ['glm-4.6'] } },
        tavily: { apiKeyEnv: 'TAVILY_API_KEY' },
      },
      conversation: { provider: 'deepseek', model: 'deepseek-flash' },
    })
    const status: CapabilitiesStatus = harness.toolkit().capabilities()
    const allowed = new Set(['route', 'provider', 'lender', 'searchTier', 'filesGranularity'])
    for (const capability of CAPABILITY_IDS) {
      for (const key of Object.keys(status[capability])) {
        expect(allowed.has(key)).toBe(true)
      }
      expect(['native', 'borrow', 'fallback', 'unavailable']).toContain(status[capability].route)
    }
    // 序列化面无部署细节(无密钥纪律):配置面只承载环境变量名,投影后连变量名也不出。
    const serialized = JSON.stringify(status)
    expect(serialized).not.toContain('apiKeyEnv')
    expect(serialized).not.toContain('endpoint')
    expect(serialized).not.toContain('model')
    expect(serialized).not.toContain('TAVILY_API_KEY')
    dispose()
  })

  it('与 matrix() 同一快照(数据来自 36 号路由器;档位标注一致)', () => {
    const harness = makeFakeContext()
    const dispose = mount(harness, {
      deployment: { providers: { deepseek: {} }, tavily: { apiKeyEnv: 'TAVILY_API_KEY' } },
      conversation: { provider: 'deepseek', model: 'deepseek-flash' },
    })
    const toolkit = harness.toolkit()
    const status = toolkit.capabilities()
    const matrix = toolkit.matrix()
    expect(status.web_search.route).toBe(matrix.web_search.decision.route)
    expect(status.web_search.searchTier).toBe(matrix.web_search.searchTier)
    expect(status.files.filesGranularity).toBe(matrix.files.filesGranularity)
    dispose()
  })

  it('updateConfig 后 capabilities() 随配置集重算(29 §2.4「随配置集变化」)', () => {
    const harness = makeFakeContext()
    const dispose = mount(harness)
    const toolkit = harness.toolkit()
    expect(toolkit.capabilities().web_search).toEqual({ route: 'unavailable', searchTier: 'internal-only' })
    toolkit.updateConfig({ providers: {}, tavily: { apiKeyEnv: 'TAVILY_API_KEY' } })
    expect(toolkit.capabilities().web_search).toEqual({
      route: 'fallback',
      provider: 'tavily',
      searchTier: 'internal-tavily',
    })
    dispose()
  })
})

// ---------------------------------------------------------------------------
// 可配缺省:defaultDeploymentConfig 环境推导(只记变量名,不读密钥值)
// ---------------------------------------------------------------------------

describe('可配缺省:defaultDeploymentConfig 环境推导', () => {
  it('三家直连 + Tavily 在场 → 对应 provider 键存在;tavily 只承载 apiKeyEnv 名,密钥值不入配置', () => {
    const config = defaultDeploymentConfig({
      DEEPSEEK_API_KEY: 'secret-deepseek',
      BIGMODEL_API_KEY: 'secret-glm',
      MIMO_API_KEY: 'secret-mimo',
      TAVILY_API_KEY: 'tvly-secret',
    })
    expect(config.providers.deepseek).toEqual({})
    expect(config.providers.glm).toEqual({})
    expect(config.providers.mimo).toEqual({})
    expect(config.tavily).toEqual({ apiKeyEnv: 'TAVILY_API_KEY' })
    // 无密钥纪律:推导结果不含任何密钥值。
    const serialized = JSON.stringify(config)
    expect(serialized).not.toContain('secret-')
    expect(serialized).not.toContain('tvly-')
  })

  it('空环境 → 空配置集(键缺席=未配置,router.ts 语义);空串密钥视同未配置(access 插件同款判空)', () => {
    expect(defaultDeploymentConfig({})).toEqual({ providers: {} })
    const blank = defaultDeploymentConfig({ DEEPSEEK_API_KEY: '', TAVILY_API_KEY: '' })
    expect(blank.providers.deepseek).toBeUndefined()
    expect(blank.tavily).toBeUndefined()
  })

  it('config.deployment 注入覆盖环境推导(可配;缺省对话模型为 generic——无原生段)', () => {
    const harness = makeFakeContext()
    const dispose = mount(harness, {
      deployment: { providers: { glm: { models: ['glm-4.6'] } } },
      conversation: { provider: 'glm', model: 'glm-4.6' },
    })
    expect(harness.toolkit().capabilities().web_search).toEqual({
      route: 'native',
      provider: 'glm',
      searchTier: 'internal-native',
    })
    dispose()
  })
})
