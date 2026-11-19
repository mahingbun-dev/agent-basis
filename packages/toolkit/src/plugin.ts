/**
 * @eterna/toolkit dsh 插件入口(L1 插件定位:29 §4 落点行「新 L1 插件,与 llm-openai/
 * llm-doctor 同族」;36 号 §3 K1.1 包骨架行、§2.2 src/ 门面装配)。
 *
 * 装配位:构造部署级 Toolkit 门面并 provide('toolkit')(cordis §3.0-1:服务名 = ctx
 * 属性名,provide('toolkit') → ctx.toolkit;audit 插件同款)。门面三件:
 * ① 能力清单——capabilities() 键集恒 = CAPABILITY_IDS 五能力(29 §1 ①);
 * ② 路由器实例——matrix()/route()/updateConfig/setConversation/invalidate(36 号 K1.4
 *    三段式裁决 + 失效重算;路由器不执行,29 §1 ②);
 * ③ 版本——contractVersion(CONTRACT_VERSION 常量;版本化语义未拍板,开放问题 O-7)。
 *
 * 无密钥纪律:门面全程不触碰凭据——DeploymentConfig 只承载「是否已配置」(键存在即视为
 * 已配置,router.ts)与承载密钥的环境变量名(apiKeyEnv);capabilities() 是矩阵快照的
 * 无密钥投影(仅路由档位/提供方/出借方/粒度标注,不含 adapter/model/endpoint/计费)。
 * 密钥每次请求时从 env 求值属适配器执行面职责;本入口零网络、零执行。
 *
 * 路由面登记(2026-11-18 裁决):本入口不注册任何 HTTP 路由——铁律 T2
 * (docs/PLUGIN-AUTHORING.md §1.1-2,packctl tenant-scan CI 强制)对数据端点的唯一
 * 正路 = packages/access/src/tenant.ts 守卫清单;GET /toolkit/api/capabilities 状态
 * 端点留待与 workbench SSE 端点(38 号 O-5)同批走 access 守卫面登记,彼时数据面
 * 即本门面 capabilities()(部署级、无密钥、无用户/租户数据)。
 *
 * 可配逆(硬性规范 5/6):defineToolkitPlugin(config) 承载部署配置——deployment
 * (缺省按环境变量在场推导,defaultDeploymentConfig)与 conversation(缺省 generic,
 * 无原生段直落借用/兜底);apply 返回逆闭包,撤 provide 即全逆(门面无定时器/连接/
 * 监听,provide 是唯一持有点);provide disposer 运行时是 async(audit 插件同款),
 * 卸载路径 fire-and-forget 不 await,防阻塞宿主。
 */

import { createToolkit } from './index.ts'
import type { ConversationRef, DeploymentConfig, NativeProviderId, ProviderDeploymentConfig } from './router/index.ts'

/**
 * 本插件消费的宿主上下文 seam(cordis provide 的结构子集)。结构类型钉住,不 import
 * 发布类型(access/src/plugin.ts:8-11 同款理由:发布类型面拖入 cordis 等 peer 依赖,
 * 只为一个方法签名,不值得)——cordis 运行时 ctx 结构性满足本面;provide disposer
 * 运行时是 async,卸载路径 fire-and-forget 裸调用(audit plugin.ts:66-74 同款)。
 */
export interface ToolkitHostContext {
  provide(name: string, value: unknown): () => void
}

/** bundle 装载行 id(cordis.patch.yml 预留;挂载行随 36 号 K4.4 / G2-B9 落地)。 */
export const TOOLKIT_PLUGIN_NAME = 'eterna-toolkit'

/** cordis 服务名 = ctx 属性名(§3.0-1):provide('toolkit') → ctx.toolkit。 */
export const TOOLKIT_SERVICE_ID = 'toolkit'

/** 本插件配置(可配,硬性规范 5;29 §2.4 矩阵查询键 + 29 §3 对话模型知情层)。 */
export interface ToolkitPluginConfig {
  /**
   * 部署供应商配置集(矩阵查询键,29 §2.4「查询键 = 已配置供应商集」)。
   * 缺省按 defaultDeploymentConfig() 环境变量在场推导;配置面不含密钥值。
   */
  readonly deployment?: DeploymentConfig
  /** 初始对话模型(29 §3「换模型前知道哪些能力会降级」);缺省 generic(无原生段)。 */
  readonly conversation?: ConversationRef
}

/**
 * 环境变量在场 → 部署配置推导(纯函数;env 参数化便于测试)。键存在即视为已配置
 * (router.ts ProviderDeploymentConfig 语义),只记「已配置」事实与承载密钥的环境变量
 * 名,不读密钥值。env 名对照 .env.example 三家直连:DEEPSEEK_API_KEY=deepseek、
 * BIGMODEL_API_KEY=glm(智谱 bigmodel.cn)、MIMO_API_KEY=mimo;TAVILY_API_KEY 在场
 * → Tavily 兜底已配置(29 §7-1;tests/matrix.spec.ts WITH_TAVILY 同款 apiKeyEnv)。
 */
export function defaultDeploymentConfig(env: NodeJS.ProcessEnv = process.env): DeploymentConfig {
  const providers: Partial<Record<NativeProviderId, ProviderDeploymentConfig>> = {}
  if (env.DEEPSEEK_API_KEY !== undefined && env.DEEPSEEK_API_KEY !== '') providers.deepseek = {}
  if (env.BIGMODEL_API_KEY !== undefined && env.BIGMODEL_API_KEY !== '') providers.glm = {}
  if (env.MIMO_API_KEY !== undefined && env.MIMO_API_KEY !== '') providers.mimo = {}
  return {
    providers,
    ...(env.TAVILY_API_KEY !== undefined && env.TAVILY_API_KEY !== ''
      ? { tavily: { apiKeyEnv: 'TAVILY_API_KEY' } }
      : {}),
  }
}

/** 缺省对话模型:generic = 其余任意 OpenAI 兼容提供方——无原生段,直落借用/兜底(router.ts)。 */
const DEFAULT_CONVERSATION: ConversationRef = { provider: 'generic', model: '' }

export function defineToolkitPlugin(config: ToolkitPluginConfig = {}) {
  return {
    name: TOOLKIT_PLUGIN_NAME,
    apply(ctx: ToolkitHostContext): () => void {
      const toolkit = createToolkit(
        config.deployment ?? defaultDeploymentConfig(),
        config.conversation ?? DEFAULT_CONVERSATION,
      )
      // 官方 seam:ctx 属性必须经 provide 声明后才可赋值(cordis Context set 陷阱,
      // audit 插件同款);服务名 = ctx 属性名:provide('toolkit') → ctx.toolkit。
      const provide = ctx.provide(TOOLKIT_SERVICE_ID, toolkit)
      // 逆闭包(硬性规范 6:卸载零残留):门面无定时器/连接/监听,provide 是唯一
      // 持有点;provide disposer 运行时 async(audit plugin.ts 同款裸调用),卸载路径
      // fire-and-forget 不 await,防阻塞宿主。
      return () => {
        provide()
      }
    },
  }
}

// DSH bundle loader 取 default export 插件实例(硬性规范 1:漏写 = 静默不装载)
export default defineToolkitPlugin()
