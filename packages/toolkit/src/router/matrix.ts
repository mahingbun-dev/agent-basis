/**
 * 部署级能力矩阵计算(36 号 K1.4/K4.1 数据底座;29 §2.4/§3)。
 *
 * 输入=部署供应商配置集 + 模型粒度能力表(PROVIDER_TABLE);输出=每能力
 * `{ decision, searchTier?, filesGranularity? }`。矩阵随配置集变化——配置集/对话模型
 * 变更即失效并重算(createMatrixService.invalidate/updateConfig/setConversation 钩子,供 K4 消费)。
 *
 * 搜索三档位(29 §7-1 拍板原文:仅内部 / 内部+原生 / 内部+原生+Tavily)按 web_search 行
 * 裁决 + Tavily 配置如实推导;「仅兜底」部署形态(无原生/借用但配置了 Tavily)为三档之外的
 * 第四种如实档(29 §7-1 未枚举此形态,登记为本批扩展档;K4.3 E2E 断言的文案集合以三档为准,
 * 该形态出现在其断言路径前需先回 29 号补拍板)。
 */
import type { CapabilityId } from '../contract/capabilities.ts'
import { CAPABILITY_IDS } from '../contract/capabilities.ts'
import { routeCapability } from './router.ts'
import type { ConversationRef, DeploymentConfig, FilesGranularity, ProviderRow, RouteDecision } from './router.ts'
import { PROVIDER_TABLE } from './router.ts'

/** 搜索档位(前三种=29 §7-1 拍板原文;internal-tavily=仅兜底扩展档,见文件头注)。 */
export type SearchTier = 'internal-only' | 'internal-native' | 'internal-native-tavily' | 'internal-tavily'

/** 搜索档位文案(29 §7-1 原文;扩展档如实标注兜底)。 */
export const SEARCH_TIER_LABELS: Readonly<Record<SearchTier, string>> = {
  'internal-only': '仅内部',
  'internal-native': '内部+原生',
  'internal-native-tavily': '内部+原生+Tavily',
  'internal-tavily': '内部+Tavily（兜底）',
}

/** 矩阵单行:裁决结论 + 能力维度标注(searchTier=web_search 行;filesGranularity=files 行)。 */
export interface MatrixEntry {
  readonly decision: RouteDecision
  readonly searchTier?: SearchTier
  readonly filesGranularity?: FilesGranularity
}

/** 部署级能力矩阵:五能力全覆盖(K4.3 矩阵 UI 的数据源)。 */
export type CapabilityMatrix = Readonly<Record<CapabilityId, MatrixEntry>>

/** 由 web_search 裁决 + Tavily 配置推导搜索档位。 */
function deriveSearchTier(config: DeploymentConfig, webSearch: RouteDecision): SearchTier {
  const tavilyConfigured = config.tavily !== undefined
  const nativeOrBorrow = webSearch.route === 'native' || webSearch.route === 'borrow'
  if (tavilyConfigured) return nativeOrBorrow ? 'internal-native-tavily' : 'internal-tavily'
  return nativeOrBorrow ? 'internal-native' : 'internal-only'
}

/** 计算部署级能力矩阵(纯函数;配置集或对话模型变更后须重算)。 */
export function computeMatrix(
  config: DeploymentConfig,
  conversation: ConversationRef,
  table: readonly ProviderRow[] = PROVIDER_TABLE,
): CapabilityMatrix {
  const entries: Partial<Record<CapabilityId, MatrixEntry>> = {}
  for (const capability of CAPABILITY_IDS) {
    const decision = routeCapability(config, conversation, capability, table)
    if (capability === 'web_search') {
      entries[capability] = { decision, searchTier: deriveSearchTier(config, decision) }
    } else if (capability === 'files') {
      const granularity = decision.filesGranularity
      entries[capability] = { decision, ...(granularity !== undefined ? { filesGranularity: granularity } : {}) }
    } else {
      entries[capability] = { decision }
    }
  }
  return Object.freeze(entries) as CapabilityMatrix
}

/**
 * 矩阵服务(失效重算钩子):持部署配置与对话模型,快照缓存;
 * updateConfig/setConversation/invalidate 立即失效并重算(revision 递增可观测)。
 */
export interface MatrixService {
  /** 当前矩阵快照(始终为最新重算结果)。 */
  snapshot(): CapabilityMatrix
  /** 单能力矩阵行。 */
  entry(capability: CapabilityId): MatrixEntry
  /** 配置集变更 → 矩阵失效重算(29 §2.4「随配置集变化」)。 */
  updateConfig(next: DeploymentConfig): void
  /** 对话模型切换 → 矩阵失效重算(29 §3「换模型前知道哪些能力会降级」)。 */
  setConversation(next: ConversationRef): void
  /** 手动失效钩子(供 K4 消费;等价触发一次重算)。 */
  invalidate(): void
  /** 重算计数(失效重算的可观测证据)。 */
  readonly revision: number
}

/** 建矩阵服务。 */
export function createMatrixService(
  config: DeploymentConfig,
  conversation: ConversationRef,
  table: readonly ProviderRow[] = PROVIDER_TABLE,
): MatrixService {
  let currentConfig = config
  let currentConversation = conversation
  let cached: CapabilityMatrix = computeMatrix(currentConfig, currentConversation, table)
  let revision = 1

  const recompute = (): void => {
    cached = computeMatrix(currentConfig, currentConversation, table)
    revision += 1
  }

  return {
    snapshot: () => cached,
    entry: capability => cached[capability],
    updateConfig(next) {
      currentConfig = next
      recompute()
    },
    setConversation(next) {
      currentConversation = next
      recompute()
    },
    invalidate: recompute,
    get revision() {
      return revision
    },
  }
}
