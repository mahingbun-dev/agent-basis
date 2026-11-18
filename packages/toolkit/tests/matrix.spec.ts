/**
 * K4.1 部署级能力矩阵单测(36 号 §3 表验收门禁 = 33 号 G2-B4 测试半):
 * - 配置集变体 × 矩阵快照(多供应商借用、无 Tavily=「仅内部」档、deepseek v4-pro 行、
 *   unavailable 显式);
 * - 搜索档位三档如实(29 §7-1:仅内部/内部+原生/内部+原生+Tavily)+「仅兜底」扩展档
 *   (matrix.ts 头注登记的第四态,非 29 §7-1 枚举);
 * - files 粒度标注(原生=版面感知 / glm·generic=文本级,29 §7-3 Q3);
 * - 矩阵服务失效重算(updateConfig/setConversation/invalidate;29 §2.4「随配置集变化」)
 *   与 createToolkit 门面装配。
 */
import { describe, expect, it } from 'vitest'
import {
  BORROW_ORDER,
  CAPABILITY_IDS,
  SEARCH_TIER_LABELS,
  computeMatrix,
  createMatrixService,
  createToolkit,
} from '../src/index.ts'
import type { CapabilityMatrix, ConversationRef, DeploymentConfig } from '../src/index.ts'

// ---------------------------------------------------------------------------
// 场景配置(已配置供应商集 = 矩阵查询键,29 §2.4)
// ---------------------------------------------------------------------------

const CONV_GENERIC: ConversationRef = { provider: 'generic', model: 'third-party-chat' }
const CONV_GLM_CHAT: ConversationRef = { provider: 'glm', model: 'glm-4.6' }
const CONV_GLM_VISION: ConversationRef = { provider: 'glm', model: 'glm-4.5v' }
const CONV_FLASH: ConversationRef = { provider: 'deepseek', model: 'deepseek-flash' }
const CONV_V4PRO: ConversationRef = { provider: 'deepseek', model: 'deepseek-v4-pro' }
const CONV_MIMO_V26: ConversationRef = { provider: 'mimo', model: 'mimo-v2.6-flash' }

const EMPTY: DeploymentConfig = { providers: {} }
const WITH_DEEPSEEK: DeploymentConfig = { providers: { deepseek: {} } }
const WITH_TAVILY: DeploymentConfig = { providers: {}, tavily: { apiKeyEnv: 'TAVILY_API_KEY' } }
const WITH_DEEPSEEK_TAVILY: DeploymentConfig = {
  providers: { deepseek: {} },
  tavily: { apiKeyEnv: 'TAVILY_API_KEY' },
}
const WITH_GLM_MIMO: DeploymentConfig = {
  providers: {
    glm: { models: ['glm-4.6'] },
    mimo: { models: ['mimo-v2.6-pro'] },
  },
}
const WITH_MIMO_LENDABLE: DeploymentConfig = { providers: { mimo: { models: ['mimo-v2.6-pro'] } } }
const WITH_MIMO_UNLENDABLE: DeploymentConfig = { providers: { mimo: { models: ['mimo-v2.5-pro'] } } }
const WITH_ALL_THREE: DeploymentConfig = {
  providers: {
    deepseek: {},
    glm: { models: ['glm-4.6'] },
    mimo: { models: ['mimo-v2.6-pro'] },
  },
}

// ---------------------------------------------------------------------------
// 配置集变体 × 矩阵快照(K4.1 门禁主体)
// ---------------------------------------------------------------------------

describe('配置集变体 × 矩阵快照(K4.1 门禁)', () => {
  it('矩阵恒覆盖五能力(web_search/read_url/files/tts/asr,29 §1 ①)', () => {
    for (const config of [EMPTY, WITH_DEEPSEEK, WITH_TAVILY, WITH_ALL_THREE]) {
      for (const conversation of [CONV_GENERIC, CONV_FLASH, CONV_GLM_CHAT, CONV_MIMO_V26]) {
        const matrix = computeMatrix(config, conversation)
        expect([...Object.keys(matrix)].sort()).toEqual([...CAPABILITY_IDS].sort())
      }
    }
  })

  it('快照①:空配置 + generic 对话——web_search/read_url/tts/asr 显式 unavailable,files 走混合兜底(文本级)', () => {
    const matrix = computeMatrix(EMPTY, CONV_GENERIC)
    expect(matrix.web_search.decision).toMatchObject({ route: 'unavailable', adapter: 'none' })
    expect(matrix.web_search.decision.reason).toContain('仅内部')
    expect(matrix.read_url.decision).toMatchObject({ route: 'unavailable', adapter: 'none' })
    expect(matrix.tts.decision.route).toBe('unavailable')
    expect(matrix.asr.decision.route).toBe('unavailable')
    expect(matrix.files.decision).toMatchObject({
      route: 'fallback',
      adapter: 'generic-function-loop',
      provider: 'generic',
      filesGranularity: 'text-level',
    })
    // 显式降级:unavailable 必带 reason(29 §1 ⑤ 绝不静默)。
    expect(matrix.read_url.decision.reason).toBeTruthy()
    expect(matrix.tts.decision.reason).toContain('P-3')
    expect(matrix.asr.decision.reason).toContain('P-3')
  })

  it('快照②:仅 Tavily 兜底——web_search/read_url 走 tavily,搜索档=「仅兜底」扩展档(非三档枚举,如实标注)', () => {
    const matrix = computeMatrix(WITH_TAVILY, CONV_GENERIC)
    expect(matrix.web_search.decision).toMatchObject({ route: 'fallback', adapter: 'tavily-search', provider: 'tavily' })
    expect(matrix.web_search.searchTier).toBe('internal-tavily')
    expect(SEARCH_TIER_LABELS[matrix.web_search.searchTier ?? 'internal-only']).toBe('内部+Tavily（兜底）')
    expect(matrix.read_url.decision).toMatchObject({ route: 'fallback', adapter: 'tavily-extract', provider: 'tavily' })
  })

  it('快照③:deepseek flash 对话——全原生行 + files 版面感知(29a R4 flash 行)', () => {
    const matrix = computeMatrix(WITH_DEEPSEEK, CONV_FLASH)
    expect(matrix.web_search.decision).toMatchObject({ route: 'native', adapter: 'deepseek-server-tools', provider: 'deepseek', model: 'deepseek-flash' })
    expect(matrix.read_url.decision).toMatchObject({ route: 'native', adapter: 'deepseek-server-tools' })
    expect(matrix.files.decision).toMatchObject({ route: 'native', adapter: 'deepseek-files-api', filesGranularity: 'layout-aware' })
    // 原生 web_search 且未配置 Tavily → 内部+原生档。
    expect(matrix.web_search.searchTier).toBe('internal-native')
  })

  it('快照④:三供应商齐配 + GLM 视觉对话——web_search 借用 deepseek 档 A,read_url/files 走 GLM 独立端点(29a R1)', () => {
    const matrix = computeMatrix(WITH_ALL_THREE, CONV_GLM_VISION)
    expect(matrix.web_search.decision).toMatchObject({
      route: 'borrow',
      lender: 'deepseek',
      borrowMode: 'direct-endpoint',
      endpoint: '/v1/tools/search',
      adapter: 'deepseek-tools-api',
    })
    // 读网只能走 /paas/v4/reader(独立端点不受视觉限制影响)。
    expect(matrix.read_url.decision).toMatchObject({ route: 'native', adapter: 'glm-reader', provider: 'glm' })
    expect(matrix.files.decision).toMatchObject({ route: 'native', adapter: 'glm-files-parser', filesGranularity: 'text-level' })
  })
})

// ---------------------------------------------------------------------------
// 多供应商借用(29 §2.4:查询键=已配置供应商集,doctor 探活须覆盖整条借用链)
// ---------------------------------------------------------------------------

describe('多供应商借用(29 §2.4)', () => {
  it('借用顺序按 BORROW_ORDER:deepseek → glm → mimo(24a B4 拍板优先级)', () => {
    expect(BORROW_ORDER).toEqual(['deepseek', 'glm', 'mimo'])
    const matrix = computeMatrix(WITH_ALL_THREE, CONV_GLM_VISION)
    expect(matrix.web_search.decision.lender).toBe('deepseek')
  })

  it('无 deepseek 时顺延 glm 档 A(/paas/v4/web_search 独立端点)', () => {
    const matrix = computeMatrix(
      { providers: { glm: { models: ['glm-4.6'] } } },
      { provider: 'generic', model: 'third-party-chat' },
    )
    expect(matrix.web_search.decision).toMatchObject({
      route: 'borrow',
      lender: 'glm',
      borrowMode: 'direct-endpoint',
      endpoint: '/paas/v4/web_search',
      adapter: 'glm-web-search-api',
    })
  })

  it('档 B 最小 chat 借用:出借方模型由已配置模型 ∩ 支持行解析(29a R2/附-A)', () => {
    const matrix = computeMatrix(WITH_MIMO_LENDABLE, CONV_GLM_VISION)
    expect(matrix.web_search.decision).toMatchObject({
      route: 'borrow',
      lender: 'mimo',
      borrowMode: 'minimal-chat',
      model: 'mimo-v2.6-pro',
      adapter: 'mimo-chat-web-search',
    })
  })

  it('档 B 解析不出可承载模型 → 顺延供给链下一段,不提供该借用路径', () => {
    const matrix = computeMatrix(WITH_MIMO_UNLENDABLE, CONV_GLM_VISION)
    expect(matrix.web_search.decision.route).not.toBe('borrow')
    expect(matrix.web_search.searchTier).toBe('internal-only')
  })

  it('glm+mimo 双出借方:对话模型自身供应商不参与借用(「其他已配置供应商」)', () => {
    // mimo 对话有原生 web_search → 段 1 即中,不进借用。
    const matrix = computeMatrix(WITH_GLM_MIMO, CONV_MIMO_V26)
    expect(matrix.web_search.decision).toMatchObject({ route: 'native', provider: 'mimo', adapter: 'mimo-chat-web-search' })
  })

  it('借用档使 web_search 档位升为「内部+原生」(借用计原生段;29 §7-1 档位推导)', () => {
    const matrix = computeMatrix(WITH_DEEPSEEK, CONV_GLM_VISION)
    expect(matrix.web_search.decision.route).toBe('borrow')
    expect(matrix.web_search.searchTier).toBe('internal-native')
    // 借用 + Tavily → 最高档。
    const withTavily = computeMatrix(WITH_DEEPSEEK_TAVILY, CONV_GLM_VISION)
    expect(withTavily.web_search.searchTier).toBe('internal-native-tavily')
  })
})

// ---------------------------------------------------------------------------
// 搜索档位三档如实(29 §7-1)
// ---------------------------------------------------------------------------

describe('搜索档位(29 §7-1:仅内部/内部+原生/内部+原生+Tavily)', () => {
  it('无 Tavily 且无原生/借用 → 仅内部(显式降级,绝不静默外发)', () => {
    const matrix = computeMatrix(EMPTY, CONV_GENERIC)
    expect(matrix.web_search.searchTier).toBe('internal-only')
    expect(SEARCH_TIER_LABELS['internal-only']).toBe('仅内部')
  })

  it('原生可用未配置 Tavily → 内部+原生', () => {
    expect(SEARCH_TIER_LABELS['internal-native']).toBe('内部+原生')
    expect(computeMatrix(WITH_DEEPSEEK, CONV_FLASH).web_search.searchTier).toBe('internal-native')
  })

  it('原生 + Tavily → 内部+原生+Tavily', () => {
    expect(SEARCH_TIER_LABELS['internal-native-tavily']).toBe('内部+原生+Tavily')
    expect(computeMatrix(WITH_DEEPSEEK_TAVILY, CONV_FLASH).web_search.searchTier).toBe('internal-native-tavily')
  })

  it('三档文案集合 = K4.3 E2E 断言集{仅内部, 内部+原生, 内部+原生+Tavily}(扩展档不计入)', () => {
    const canonical = (['internal-only', 'internal-native', 'internal-native-tavily'] as const)
      .map(tier => SEARCH_TIER_LABELS[tier])
    expect(canonical).toEqual(['仅内部', '内部+原生', '内部+原生+Tavily'])
  })
})

// ---------------------------------------------------------------------------
// deepseek v4-pro 行(29a R4:模型粒度下钻)
// ---------------------------------------------------------------------------

describe('deepseek v4-pro 行(29a R4 修正行)', () => {
  it('v4-pro:web_search 原生走 Anthropic 形态工具(web_search_2025*),非 flash 的服务端工具', () => {
    const matrix = computeMatrix(WITH_DEEPSEEK, CONV_V4PRO)
    expect(matrix.web_search.decision).toMatchObject({
      route: 'native',
      adapter: 'deepseek-anthropic-web-search',
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
    })
  })

  it('v4-pro 无 read_url/files(29a R4)→ read_url 显式 unavailable、files 落 generic 混合兜底(文本级)', () => {
    const matrix = computeMatrix(WITH_DEEPSEEK, CONV_V4PRO)
    expect(matrix.read_url.decision).toMatchObject({ route: 'unavailable', adapter: 'none' })
    expect(matrix.read_url.decision.reason).toBeTruthy()
    expect(matrix.files.decision).toMatchObject({ route: 'fallback', provider: 'generic', filesGranularity: 'text-level' })
  })

  it('claude-opus* 别名命中 v4-pro 行(行序即前缀优先级;29a R4)', () => {
    const matrix = computeMatrix(WITH_DEEPSEEK, { provider: 'deepseek', model: 'claude-opus-4-6' })
    expect(matrix.web_search.decision.adapter).toBe('deepseek-anthropic-web-search')
    // 其余 claude* 由 flash 行承接。
    const flashAlias = computeMatrix(WITH_DEEPSEEK, { provider: 'deepseek', model: 'claude-sonnet-4-6' })
    expect(flashAlias.web_search.decision.adapter).toBe('deepseek-server-tools')
  })
})

// ---------------------------------------------------------------------------
// unavailable 显式(29 §1 ⑤)+ files 粒度标注(29 §7-3 Q3)
// ---------------------------------------------------------------------------

describe('unavailable 显式与 files 粒度标注', () => {
  it('tts/asr 本批一律 unavailable 且带 P-3 理由(语音链归 P-3;O-9 自然读出 §1 ⑤)', () => {
    for (const matrix of [
      computeMatrix(EMPTY, CONV_GENERIC),
      computeMatrix(WITH_ALL_THREE, CONV_FLASH),
    ] as CapabilityMatrix[]) {
      expect(matrix.tts.decision).toMatchObject({ route: 'unavailable', adapter: 'none' })
      expect(matrix.asr.decision).toMatchObject({ route: 'unavailable', adapter: 'none' })
      expect(matrix.tts.decision.reason).toContain('P-3')
    }
  })

  it('files 粒度:deepseek 原生=版面感知;glm 原生与 generic 兜底=文本级(29 §7-3 Q3)', () => {
    expect(computeMatrix(WITH_DEEPSEEK, CONV_FLASH).files.filesGranularity).toBe('layout-aware')
    expect(computeMatrix(EMPTY, CONV_GLM_CHAT).files.filesGranularity).toBe('text-level')
    expect(computeMatrix(EMPTY, CONV_GENERIC).files.filesGranularity).toBe('text-level')
  })
})

// ---------------------------------------------------------------------------
// 矩阵服务:配置集/对话模型变更 → 失效重算(29 §2.4;K1.4 invalidate 钩子供 K4 消费)
// ---------------------------------------------------------------------------

describe('矩阵服务失效重算(29 §2.4「随配置集变化」)', () => {
  it('updateConfig:新增出借方 → web_search 由 unavailable 变 borrow,revision 递增', () => {
    const service = createMatrixService(EMPTY, CONV_GLM_VISION)
    expect(service.entry('web_search').decision.route).toBe('unavailable')
    const before = service.revision
    service.updateConfig(WITH_DEEPSEEK)
    expect(service.entry('web_search').decision).toMatchObject({ route: 'borrow', lender: 'deepseek' })
    expect(service.revision).toBeGreaterThan(before)
  })

  it('setConversation:换模型 → 同配置集下能力随模型变化(29 §3 知情层)', () => {
    const service = createMatrixService(WITH_DEEPSEEK, CONV_FLASH)
    expect(service.entry('files').decision.filesGranularity).toBe('layout-aware')
    service.setConversation(CONV_V4PRO)
    expect(service.entry('files').decision.route).toBe('fallback')
    expect(service.entry('files').filesGranularity).toBe('text-level')
  })

  it('invalidate:等价触发一次重算(快照始终最新)', () => {
    const service = createMatrixService(WITH_DEEPSEEK, CONV_GLM_VISION)
    const before = service.revision
    service.invalidate()
    expect(service.revision).toBe(before + 1)
    expect(service.snapshot().web_search.decision.lender).toBe('deepseek')
  })

  it('createToolkit 门面:matrix()/route()/updateConfig/invalidate 同一服务装配', () => {
    const toolkit = createToolkit(EMPTY, CONV_GENERIC)
    expect(toolkit.matrix().web_search.searchTier).toBe('internal-only')
    expect(toolkit.route('web_search').route).toBe('unavailable')
    const before = toolkit.revision
    toolkit.updateConfig(WITH_TAVILY)
    expect(toolkit.route('web_search')).toMatchObject({ route: 'fallback', provider: 'tavily' })
    toolkit.invalidate()
    expect(toolkit.revision).toBeGreaterThan(before)
  })
})
