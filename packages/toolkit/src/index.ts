/**
 * @eterna/toolkit 门面 + createToolkit() 装配(36 号 §2.2 src/index.ts)。
 * dsh 插件入口在 src/plugin.ts(L1 插件定位,29 §4 落点行):provide('toolkit') 即本
 * 门面——capabilities() 为其无密钥状态数据面(2026-11-18 裁决:本包不注册 HTTP 路由)。
 *
 * M-K1 批次:能力契约层(K1.2)+ 规范化块协议(K1.3)+ 工具路由器(K1.4,含借用)。
 * M-K2 批次:deepseek 线(K2.1,对话侧服务端工具:serverTools 组装/SSE 块解析归并/
 * 规范化块翻译,R4 7 缺口类型)+ generic 线(K2.3:tavily 兜底客户端 + function calling
 * 工具循环(R3 八条裁剪)+ 执行器(知识库优先搜索//extract 读网/files 混合兜底/egress 联动))。
 * M-K3 批次:glm 线(K3.1,chat.ts:tools[].web_search 声明 + 响应顶层 web_search[] 回流→
 * 规范化块 + 流式「chunk 无该字段」显式降级;reader.ts:/paas/v4/reader 独立读网端点;29a R1);
 * mimo 线(K3.3,OpenAI Chat 主通道:annotations url_citation 回流→规范化块、
 * tool_choice 全量降级 auto、thinking 硬约束 reasoning_content 另存回灌、开关缓存与开通前置
 * 部署事实常量)。deepseek files/独立端点(K2.2)、glm files(K3.2)、借用(K3.4)与 client
 * 半边(K4.3)按批次后续落地。
 */
import type { CapabilityId } from './contract/capabilities.ts'
import { CAPABILITY_IDS, CONTRACT_VERSION } from './contract/capabilities.ts'
import type { CapabilityMatrix, MatrixEntry, MatrixService, SearchTier } from './router/matrix.ts'
import { createMatrixService } from './router/matrix.ts'
import type {
  ConversationRef,
  DeploymentConfig,
  FilesGranularity,
  NativeProviderId,
  ProviderId,
  RouteDecision,
  RouteKind,
} from './router/router.ts'

// 门面重导出:契约(①)、规范化块(④)、路由器(②)、适配器(③:generic/tavily/glm/mimo)四面。
export * from './contract/index.ts'
export * from './blocks/index.ts'
export * from './router/index.ts'
export * from './adapters/deepseek/index.ts'
export * from './adapters/generic/loop.ts'
export * from './adapters/generic/executors.ts'
export * from './adapters/tavily/client.ts'
export * from './adapters/glm/chat.ts'
export * from './adapters/glm/reader.ts'
export * from './adapters/mimo/chat.ts'

// 插件装配(36 号 K4.4 宿主半边):DSH bundle loader 取 default export 插件实例
// (super 模板 eterna-toolkit 行 name 指向包根 exports ".";tasks/panel/llm-doctor
// 包根 default 同款形态——漏写 = 行 enabled/no-fiber 静默不装载,硬性规范 1)。
export { default } from './plugin.ts'

/** 能力状态行:部署级能力矩阵的无密钥投影(路由档位 + 提供方 + 能力维度标注)。 */
export interface CapabilityStatus {
  /** 三段式结论四态(29 §3 矩阵行:原生/借用/兜底/不可用;unavailable 必显式,29 §1 ⑤)。 */
  readonly route: RouteKind
  /** native=对话模型供应商;fallback=generic|tavily;borrow=缺省(出借方见 lender)。 */
  readonly provider?: ProviderId
  /** borrow 段的出借方(29 §2.4/29a 附-A 两档借用)。 */
  readonly lender?: NativeProviderId
  /** web_search 行搜索档位(29 §7-1 三档 + 兜底扩展档,matrix.ts 头注登记的第四态)。 */
  readonly searchTier?: SearchTier
  /** files 行粒度标注(29 §7-3:原生=版面感知、glm/generic=文本级)。 */
  readonly filesGranularity?: FilesGranularity
}

/** 部署级能力状态:键集恒等于 CAPABILITY_IDS(五能力全覆盖,29 §1 ①)。 */
export type CapabilitiesStatus = Readonly<Record<CapabilityId, CapabilityStatus>>

/**
 * 矩阵行 → 无密钥状态行(纯投影):只保留路由档位/提供方/出借方/粒度标注;adapter/
 * model/endpoint/borrowMode/reason 等部署细节与计费口径不外露。无密钥纪律:配置面
 * (DeploymentConfig)只承载「是否已配置」与承载密钥的环境变量名(apiKeyEnv),凭据值
 * 从不入门面;密钥按请求时从 env 求值是适配器执行面职责。
 */
export function toCapabilityStatus(entry: MatrixEntry): CapabilityStatus {
  const decision = entry.decision
  return {
    route: decision.route,
    ...(decision.provider !== undefined ? { provider: decision.provider } : {}),
    ...(decision.lender !== undefined ? { lender: decision.lender } : {}),
    ...(entry.searchTier !== undefined ? { searchTier: entry.searchTier } : {}),
    ...(entry.filesGranularity !== undefined ? { filesGranularity: entry.filesGranularity } : {}),
  }
}

/** 全矩阵 → 能力状态表(键集 = CAPABILITY_IDS;冻结,与矩阵快照同源)。 */
function projectCapabilities(matrix: CapabilityMatrix): CapabilitiesStatus {
  const entries = {} as Record<CapabilityId, CapabilityStatus>
  for (const capability of CAPABILITY_IDS) {
    entries[capability] = toCapabilityStatus(matrix[capability])
  }
  return Object.freeze(entries)
}

/** toolkit 装配体:矩阵查询 + 失效重算钩子;无执行面。 */
export interface Toolkit {
  /** 契约版本(消费方断言相等才接受块/声明;O-7 版本化语义未拍板)。 */
  readonly contractVersion: number
  /** 当前部署级能力矩阵快照。 */
  matrix(): CapabilityMatrix
  /**
   * 部署级能力状态(无密钥投影,键集 = CAPABILITY_IDS):插件入口(src/plugin.ts)
   * provide('toolkit') 门面的状态数据面——2026-11-18 裁决:本包不注册 HTTP 路由
   * (铁律 T2,docs/PLUGIN-AUTHORING.md §1.1-2),GET /toolkit/api/capabilities 状态
   * 端点留待 access 守卫面同批登记(38 号 O-5),彼时数据面即本方法。
   */
  capabilities(): CapabilitiesStatus
  /** 单能力三段式裁决(对话模型原生 → 借用 → 兜底;无路径=unavailable 显式)。 */
  route(capability: CapabilityId): RouteDecision
  /** 配置集变更 → 矩阵失效重算(29 §2.4)。 */
  updateConfig(next: DeploymentConfig): void
  /** 对话模型切换 → 矩阵失效重算(29 §3 知情层)。 */
  setConversation(next: ConversationRef): void
  /** 失效钩子(供 K4 消费)。 */
  invalidate(): void
  /** 重算计数。 */
  readonly revision: number
}

/** 装配 toolkit(矩阵服务内部化;snapshot 始终最新)。 */
export function createToolkit(config: DeploymentConfig, conversation: ConversationRef): Toolkit {
  const service: MatrixService = createMatrixService(config, conversation)
  return {
    contractVersion: CONTRACT_VERSION,
    matrix: () => service.snapshot(),
    capabilities: () => projectCapabilities(service.snapshot()),
    route: capability => service.entry(capability).decision,
    updateConfig: (next) => {
      service.updateConfig(next)
    },
    setConversation: (next) => {
      service.setConversation(next)
    },
    invalidate: () => {
      service.invalidate()
    },
    get revision() {
      return service.revision
    },
  }
}
