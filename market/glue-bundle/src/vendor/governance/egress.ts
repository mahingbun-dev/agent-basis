/**
 * egress-lite:出网工具白名单判定 + proxy 环境变量注入载荷构造。
 *
 * 设计依据(设计文档 12 §4.4 / 决策 D-A,2026-11-03 拍板):
 * DSH sandbox 词汇不含网络("Network and process visibility are outside this
 * vocabulary"),出网管控是明确缺口;插件方案 = pre-execute 代理强注 + 仅放行
 * 受控出网工具(web_fetch/MCP 白名单)。**防护等级 = 引导非强制**(已知晓并接受):
 * dsh 的 tools/pre-execute 不能改写已记录参数(packages/core/tools/README.md:197),
 * 故 proxy 注入以"载荷 + 包装器"形态提供给 tools/execute 层应用,本模块只负责
 * 判定与构造;强合规场景由 T13 egress 完整版升级。
 */
import { matchAnyGlob } from './glob.ts'
import type { GovernancePreDecision, ToolCallLike } from './types.ts'

/** 出网判定三态。 */
export type EgressClassification = 'local' | 'outbound-allowed' | 'outbound-denied'

/** 识别"出网型工具"的缺省 glob 集(可被配置覆盖)。 */
export const DEFAULT_OUTBOUND_TOOL_GLOBS: readonly string[] = ['web_*', 'http_*', 'fetch_*', 'mcp__*']

export interface EgressLiteConfig {
  /** 受控代理地址(如 http://127.0.0.1:7890);必填。 */
  readonly proxyUrl: string
  /** 出网白名单:允许触网的工具名 glob 列表(空 = 一查出网工具全拒)。 */
  readonly allowedOutboundTools: readonly string[]
  /** 识别出网型工具的 glob 列表;缺省 DEFAULT_OUTBOUND_TOOL_GLOBS。 */
  readonly outboundToolGlobs?: readonly string[]
  /** NO_PROXY 直连例外(host 列表,join(',') 注入)。 */
  readonly noProxy?: readonly string[]
}

/** egress-lite 判定器。不可变配置;一个实例可全局共享。 */
export class EgressLite {
  readonly #config: Required<Pick<EgressLiteConfig, 'proxyUrl' | 'allowedOutboundTools'>> & EgressLiteConfig

  constructor(config: EgressLiteConfig) {
    if (typeof config.proxyUrl !== 'string' || !/^[a-z][a-z0-9+.-]*:\/\//iu.test(config.proxyUrl)) {
      throw new RangeError(`[governance] EgressLiteConfig.proxyUrl 必须是带协议的 URL,得到:${config.proxyUrl}`)
    }
    this.#config = config
  }

  get config(): Readonly<EgressLiteConfig> {
    return this.#config
  }

  /** 工具三态判定:非出网工具(local)不受 egress 约束;出网工具按白名单二分。 */
  classify(tool: string): EgressClassification {
    const outboundGlobs = this.#config.outboundToolGlobs ?? DEFAULT_OUTBOUND_TOOL_GLOBS
    if (!matchAnyGlob(tool, outboundGlobs)) return 'local'
    return matchAnyGlob(tool, this.#config.allowedOutboundTools) ? 'outbound-allowed' : 'outbound-denied'
  }

  /** tools/pre-execute 决策形态:仅拦截 outbound-denied(local 与白名单内的放行给规则引擎继续判)。 */
  preExecuteDecision(call: ToolCallLike): GovernancePreDecision {
    const classification = this.classify(call.name)
    if (classification !== 'outbound-denied') return { kind: 'allow' }
    return {
      kind: 'deny',
      reason: `[governance] 出网工具 ${call.name} 不在 egress 白名单(仅放行:${this.#config.allowedOutboundTools.join(',') || '无'})`,
    }
  }

  /**
   * proxy 环境变量注入载荷:大写 + 小写双形态(部分工具只认其一),
   * noProxy 非空时附 NO_PROXY/no_proxy。
   */
  proxyEnvPayload(): Readonly<Record<string, string>> {
    const noProxy = this.#config.noProxy !== undefined && this.#config.noProxy.length > 0
      ? this.#config.noProxy.join(',')
      : undefined
    return {
      HTTP_PROXY: this.#config.proxyUrl,
      HTTPS_PROXY: this.#config.proxyUrl,
      http_proxy: this.#config.proxyUrl,
      https_proxy: this.#config.proxyUrl,
      ...(noProxy !== undefined && { NO_PROXY: noProxy, no_proxy: noProxy }),
    }
  }

  /**
   * 把注入载荷合并进一个接受 env 参数的工具参数(强注:proxy 键覆盖既有同名键;
   * 其余既有 env 键保留)。返回新对象,不改动原参数。
   */
  withProxyEnv<T extends Record<string, unknown>>(args: T): T & { env: Record<string, string> } {
    const existingEnv = isStringRecord(args['env']) ? args['env'] : {}
    return { ...args, env: { ...existingEnv, ...this.proxyEnvPayload() } }
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value).every(v => typeof v === 'string')
}
