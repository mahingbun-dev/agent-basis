/**
 * egress 完整版 ②:出网工具包装器(在 @eterna/governance egress-lite 之上)。
 *
 * 分层(设计文档 12 §4.4 决策 D-A「pre-execute 代理强注 + 仅放行受控出网
 * 工具」的完整版收口):
 * - 第 1 层(工具级,governance EgressLite):出网型工具名不在白名单 → 拒;
 * - 第 2 层(域名级,本模块 DomainWhitelist):工具放行后,其参数中的
 *   URL/目的地逐个判域名+端口,未列名 → 拒,**底层 execute 不被调用**;
 * - 第 3 层(代理强注,EgressLite.withProxyEnv):放行的出网调用合并
 *   HTTP(S)_PROXY 环境变量载荷,流量走受控代理(egress-lite 的原始设计,
 *   在此真正落到包装器执行面)。
 *
 * 包装形态:输入一个 dsh ToolDefinition(packages/core/tools 契约),
 * 输出同名同参的新 ToolDefinition——output schema 扩为「原值 ∪ 拒绝值」
 * 并集,拒绝时返回结构化 `{ egress: 'denied', ... }`(对齐 memory PII 的
 * 「结构化失败不中断 turn」语义),不抛异常。
 *
 * 接口纪律:本模块是纯函数层(不触碰 ctx 全局);governance egress-lite
 * 未就绪时,组合层应注入等价结构 `{ classify(name), withProxyEnv(args) }`
 * (EgressLite 天然满足,结构子集注入可交换)。
 */
import { DomainWhitelist } from './domain-whitelist.ts'
import type { DomainDecision } from './domain-whitelist.ts'
import type { JsonSchemaNode, ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { EgressClassification, EgressLite } from '@eterna/governance'

/** 默认从工具参数里找目的地的键(参数键小写化后比对;baseURL→baseurl 亦命中)。 */
export const DEFAULT_URL_ARG_KEYS: readonly string[] = ['url', 'endpoint', 'base_url', 'baseurl', 'host']

/** 结构化拒绝值(并入包装后工具的 output schema)。 */
export interface EgressDeniedValue {
  readonly egress: 'denied'
  readonly tool: string
  readonly reason: string
  /** 命中的拒绝层级:tool(工具级)/ domain(域名级)/ no-destination(找不到目的地)。 */
  readonly layer: 'tool' | 'domain' | 'no-destination'
}

/** 工具级判定结构子集(governance EgressLite 天然满足;未就绪时的等价注入面)。 */
export interface ToolLevelEgress {
  classify(tool: string): EgressClassification
  withProxyEnv<T extends Record<string, unknown>>(args: T): T & { env: Record<string, string> }
}

export interface EgressWrapperOptions {
  /** 工具级白名单(governance EgressLite 实例或等价结构)。 */
  readonly egress: ToolLevelEgress
  /** 域名级白名单。 */
  readonly domains: DomainWhitelist
  /** 从参数中取目的地的键(小写比较);缺省 DEFAULT_URL_ARG_KEYS。 */
  readonly urlArgKeys?: readonly string[]
  /**
   * 出网工具的参数里找不到任何目的地时的策略:
   * - 'deny'(缺省,强合规 fail-closed):无法判定即拒;
   * - 'allow':仅工具级白名单兜底(egress-lite 行为,如结构化 MCP 工具)。
   */
  readonly unknownDestination?: 'deny' | 'allow'
  /**
   * 放行时是否把 proxy 环境变量载荷强注进 args.env(egress-lite 第 3 层)。
   * 缺省 true;对自带代理配置的工具可关。
   */
  readonly injectProxyEnv?: boolean
}

/** 判定结果(供测试与组合层 preflight 复用;不执行底层工具)。 */
export type EgressPreflight =
  | { readonly kind: 'local' }
  | { readonly kind: 'allowed'; readonly decision: DomainDecision; readonly args: Record<string, unknown> }
  | { readonly kind: 'denied'; readonly value: EgressDeniedValue }

/** 出网工具包装器。不可变配置;一个实例可包装多个工具。 */
export class EgressToolWrapper {
  readonly #options: Omit<EgressWrapperOptions, 'urlArgKeys' | 'unknownDestination' | 'injectProxyEnv'>
    & Required<Pick<EgressWrapperOptions, 'urlArgKeys' | 'unknownDestination' | 'injectProxyEnv'>>

  constructor(options: EgressWrapperOptions) {
    this.#options = {
      ...options,
      urlArgKeys: options.urlArgKeys ?? DEFAULT_URL_ARG_KEYS,
      unknownDestination: options.unknownDestination ?? 'deny',
      injectProxyEnv: options.injectProxyEnv ?? true,
    }
  }

  /** 执行前预检:local 工具原样放行;出网工具逐 URL 判域名。不触碰底层工具。 */
  preflight(toolName: string, args: Record<string, unknown>): EgressPreflight {
    const classification = this.#options.egress.classify(toolName)
    if (classification === 'local') return { kind: 'local' }
    if (classification === 'outbound-denied') {
      return {
        kind: 'denied',
        value: {
          egress: 'denied',
          tool: toolName,
          reason: `出网工具 ${toolName} 不在工具级 egress 白名单`,
          layer: 'tool',
        },
      }
    }
    // outbound-allowed:进入域名级判定。
    const destinations = collectDestinations(args, this.#options.urlArgKeys)
    if (destinations.length === 0) {
      if (this.#options.unknownDestination === 'allow') {
        return { kind: 'allowed', decision: { allowed: true, reason: '未发现目的地参数,按 unknownDestination=allow 仅工具级白名单兜底' }, args }
      }
      return {
        kind: 'denied',
        value: {
          egress: 'denied',
          tool: toolName,
          reason: `出网工具 ${toolName} 的参数中未发现可判定的目的地(${this.#options.urlArgKeys.join(',')}),fail-closed 拒绝`,
          layer: 'no-destination',
        },
      }
    }
    let lastDecision: DomainDecision = { allowed: true, reason: '' }
    for (const { key, raw } of destinations) {
      const decision = this.#options.domains.check(raw)
      if (!decision.allowed) {
        return {
          kind: 'denied',
          value: { egress: 'denied', tool: toolName, reason: `参数 ${key} 的目的地被拒:${decision.reason}`, layer: 'domain' },
        }
      }
      lastDecision = decision
    }
    const finalArgs = this.#options.injectProxyEnv
      ? this.#options.egress.withProxyEnv(args)
      : args
    return {
      kind: 'allowed',
      decision: destinations.length === 1 ? lastDecision : { allowed: true, reason: `${destinations.length} 个目的地全部命中白名单` },
      args: finalArgs,
    }
  }

  /**
   * 包装一个 dsh ToolDefinition:
   * - name/description/parameters 原样保留(模型面不变);
   * - execute 先 preflight:denied → 结构化拒绝值;local/allowed → 调底层
   *   execute(allowed 时传代理强注后的 args);
   * - output schema 扩为 anyOf(原 schema ∪ 拒绝值);render 对拒绝值输出
   *   文本块,其余委托原 render。
   */
  wrap(tool: ToolDefinition): ToolDefinition {
    const preflight = (name: string, args: Record<string, unknown>): EgressPreflight => this.preflight(name, args)
    const denialSchema: JsonSchemaNode = {
      type: 'object',
      properties: {
        egress: { type: 'string', const: 'denied' },
        tool: { type: 'string' },
        reason: { type: 'string' },
        layer: { type: 'string', enum: ['tool', 'domain', 'no-destination'] },
      },
      required: ['egress', 'tool', 'reason', 'layer'],
    }
    return {
      ...tool,
      output: {
        ...tool.output,
        // dsh JsonSchemaNode 子集用 oneOf(≥2 分支):原值 ∪ 拒绝值。
        schema: { oneOf: [tool.output.schema, denialSchema] },
        render(args, value) {
          if (isEgressDeniedValue(value)) return renderDenied(value)
          return tool.output.render(args, value)
        },
      },
      async execute(args, exec) {
        const record = isRecord(args) ? args : {}
        const pre = preflight(tool.name, record)
        if (pre.kind === 'denied') return pre.value
        return tool.execute(pre.kind === 'allowed' ? pre.args : record, exec)
      },
    }
  }
}

/** 拒绝值渲染:一段用户可见文本(与 dsh TextBlock 契约一致)。 */
function renderDenied(value: EgressDeniedValue): ContentBlock[] {
  return [{ type: 'text', text: `[egress] 已拒绝调用:${value.reason}` }]
}

/** 结构化拒绝值判别(渲染分派 + 测试断言用)。 */
export function isEgressDeniedValue(value: unknown): value is EgressDeniedValue {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return record['egress'] === 'denied' && typeof record['tool'] === 'string' && typeof record['reason'] === 'string'
    && (record['layer'] === 'tool' || record['layer'] === 'domain' || record['layer'] === 'no-destination')
}

/** 从参数中收集目的地(参数键小写化后比对 keys;值为字符串才算,其余忽略)。 */
function collectDestinations(args: Record<string, unknown>, keys: readonly string[]): { key: string; raw: string }[] {
  const keySet = new Set(keys)
  const found: { key: string; raw: string }[] = []
  for (const [key, value] of Object.entries(args)) {
    if (!keySet.has(key.toLowerCase())) continue
    if (typeof value === 'string' && value.trim() !== '') found.push({ key, raw: value })
  }
  return found
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 组合便捷工厂:governance EgressLite + DomainWhitelist 一步成包装器
 * (egress-lite「未就绪则独立实现同一接口」的注:接口即 ToolLevelEgress,
 * EgressLite 是其结构超集,直接可换任何等价实现)。
 */
export function createEgressWrapper(egress: EgressLite | ToolLevelEgress, domains: DomainWhitelist, overrides: Partial<Omit<EgressWrapperOptions, 'egress' | 'domains'>> = {}): EgressToolWrapper {
  return new EgressToolWrapper({ egress, domains, ...overrides })
}
