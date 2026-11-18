/**
 * 规则引擎:YAML 策略文件 → evaluate(tool, args) → allow | ask | deny。
 *
 * 设计依据(设计文档 08 §3/§6.1、12 §4.1):
 * - 承载方式 B:挂在 DSH `tools/pre-execute` waterfall 上,deny 不可绕过由内核单调 guard 保证;
 * - 匹配维度:tool 名 glob + 参数子串(序列化后 includes);
 * - 优先级:deny > ask > allow;未命中走 default;
 * - fail-closed:default 只允许 ask/deny(解析期拒绝 `default: allow`),配置非法直接抛错,绝不静默放行。
 */
import { createHash } from 'node:crypto'
import { parse as parseYaml } from 'yaml'
import { GovernanceConfigError, isRecord } from './errors.ts'
import { matchAnyGlob } from './glob.ts'
import type { GovernancePreDecision, ToolCallLike } from './types.ts'
import { stableStringify } from './types.ts'

/** 规则效果(与 dsh PreToolDecision 的 allow/deny/ask 对齐)。 */
export type RuleEffect = 'allow' | 'ask' | 'deny'

/** 单条治理规则。`tools` 为 glob 列表(OR);`argsContains` 为参数子串列表(OR,缺省匹配任意参数)。 */
export interface PolicyRule {
  readonly id: string
  readonly effect: RuleEffect
  readonly tools: readonly string[]
  readonly argsContains?: readonly string[]
  readonly reason?: string
}

/** 策略文档。`default` 为未命中时的裁决(仅 ask/deny)。 */
export interface PolicyDocument {
  readonly rules: readonly PolicyRule[]
  readonly default: RuleEffect
}

/** 一次求值的结果:裁决 + 命中规则全集(供审计与富审批卡片展示"命中哪条")。 */
export interface RuleEvaluation {
  readonly decision: RuleEffect
  readonly matched: readonly PolicyRule[]
  /** 实际决定结果的规则;未命中任何规则(走 default)时为 undefined。 */
  readonly decidedRule?: PolicyRule
  /** 是否走了 fail-closed 默认裁决。 */
  readonly isDefault: boolean
  /** 人读理由(审批卡片/审计)。 */
  readonly reason: string
}

const EFFECTS: readonly RuleEffect[] = ['allow', 'ask', 'deny']
const RULE_KEYS = new Set(['id', 'effect', 'tools', 'argsContains', 'reason'])

/**
 * 规则引擎。不可变:一个实例绑定一份已校验的策略;更新策略 = 重新 parse 出新实例。
 */
export class RuleEngine {
  /** 解析并严格校验 YAML 策略文本;任何结构问题抛 GovernanceConfigError(fail-closed)。 */
  static parse(yamlText: string, sourceLabel = 'policy.yaml'): RuleEngine {
    let raw: unknown
    try {
      raw = parseYaml(yamlText)
    } catch (error) {
      throw new GovernanceConfigError(`${sourceLabel}: YAML 语法错误:${errorText(error)}`)
    }
    return new RuleEngine(validateDocument(raw, sourceLabel))
  }

  readonly #policy: PolicyDocument

  constructor(policy: PolicyDocument) {
    this.#policy = policy
  }

  /** 只读策略视图。 */
  get policy(): Readonly<PolicyDocument> {
    return this.#policy
  }

  /** 求值入口:tool 名 + 参数(任意 JSON 值;字符串直接匹配,其余稳定串化后子串匹配)。 */
  evaluate(tool: string, args?: unknown): RuleEvaluation {
    return this.evaluateCall({ name: tool, ...(args !== undefined && { arguments: args }) })
  }

  /** tools/pre-execute 调用形态的求值入口(结构兼容 dsh ToolExecution)。 */
  evaluateCall(call: ToolCallLike): RuleEvaluation {
    const serialized = call.arguments === undefined ? '' : serializeArgs(call.arguments)
    const matched = this.#policy.rules.filter(rule => this.#matches(rule, call.name, serialized))
    const firstDeny = matched.find(rule => rule.effect === 'deny')
    const firstAsk = matched.find(rule => rule.effect === 'ask')
    const firstAllow = matched.find(rule => rule.effect === 'allow')
    const decidedRule = firstDeny ?? firstAsk ?? firstAllow
    if (decidedRule === undefined) {
      return {
        decision: this.#policy.default,
        matched,
        isDefault: true,
        reason: `未命中任何规则,按 fail-closed 默认裁决:${this.#policy.default}`,
      }
    }
    return {
      decision: decidedRule.effect,
      matched,
      decidedRule,
      isDefault: false,
      reason: decidedRule.reason === undefined
        ? `命中规则 ${decidedRule.id}(${decidedRule.effect})`
        : `命中规则 ${decidedRule.id}(${decidedRule.effect}):${decidedRule.reason}`,
    }
  }

  /** 求值并映射为 dsh tools/pre-execute 决策形态(exactOptionalPropertyTypes 安全构造)。 */
  preExecuteDecision(call: ToolCallLike): GovernancePreDecision {
    const evaluation = this.evaluateCall(call)
    if (evaluation.decision === 'deny') {
      return { kind: 'deny', reason: `[governance] ${evaluation.reason}` }
    }
    if (evaluation.decision === 'ask') {
      const reason = `[governance] ${evaluation.reason}`
      return evaluation.decidedRule === undefined ? { kind: 'ask' } : { kind: 'ask', reason }
    }
    return { kind: 'allow' }
  }

  #matches(rule: PolicyRule, tool: string, serializedArgs: string): boolean {
    if (!matchAnyGlob(tool, rule.tools)) return false
    if (rule.argsContains === undefined || rule.argsContains.length === 0) return true
    return rule.argsContains.some(needle => serializedArgs.includes(needle))
  }
}

/**
 * 规则版本域标识(进 hash 的首参,与 tasks 侧 `POLICY_REVISION` 同构的域内防撞;跨域不撞)。
 */
export const RULES_REVISION = 'governance-rules-v1'

/**
 * 规则版本 = 规则内容 hash(24a 拍板记录·C3:「规则版本 = 文件内容 hash,热改即新版本;
 * 在跑工单钉旧版,新规则只影响新工单」;24 号 §9-2:版本化落点在 governance/src/rules.ts,
 * 「版本号由文件内容 hash 派生,热改即产生新版本,历史可查」;33 号 G2-A15 第①句)。
 *
 * 粒度口径:对**解析后的策略文档**取 stableStringify 内容 hash(与 tasks 侧 `policyContent`
 * 同粒度——语义内容而非原始字节:同一份规则的 YAML 重排/注释增删不虚增版本,规则实质
 * 变化即新版本)。hash 构造与 tasks/src/core/ids.ts `key()` 同构(sha256 前 32 位十六进制),
 * 但不 import——Tier1 永不 import Tier2(31 号 §2.2 铁律 1)。
 * glue 层组参面:把本函数产物作为 tasks `jointPolicyVersion` 的 `governance` 侧
 * (A10 联合 hash = governance rules.yaml + hitl.yaml + tasks 准入表,34 号 §2.2 version 行;
 * 触发时机=规则热改重parse 出新实例时,开放问题 3 的 fs watch vs 保存时由 glue 装配决定)。
 */
export function rulesVersion(engine: RuleEngine): string {
  return createHash('sha256').update(JSON.stringify([RULES_REVISION, stableStringify(engine.policy)])).digest('hex').slice(0, 32)
}

/** 参数序列化:dsh `tool/call` 事件的 arguments 是模型原始 JSON 字符串,pre-execute 里则是已解析值;两者统一。 */
export function serializeArgs(args: unknown): string {
  return typeof args === 'string' ? args : stableStringify(args)
}

function validateDocument(raw: unknown, sourceLabel: string): PolicyDocument {
  if (!isRecord(raw)) {
    throw new GovernanceConfigError(`${sourceLabel}: 顶层必须是映射(key: rules/default)`)
  }
  const issues: string[] = []
  const unknownTop = Object.keys(raw).filter(key => key !== 'rules' && key !== 'default')
  if (unknownTop.length > 0) issues.push(`未知顶层字段:${unknownTop.join(',')}`)

  let def: RuleEffect = 'ask'
  if (raw['default'] !== undefined) {
    const value = raw['default']
    if (value === 'allow' || value === 'ask' || value === 'deny') {
      // 2026-11-19 产品拍板:沙箱边界(workspace-write=账号工作区)+access 钳制+egress
      // 白名单已承担限界,default 放开为 allow——部署文件显式声明「未列名工具静默放行」,
      // ask/deny 保留为显式规则面。引擎缺省仍 ask(无规则文件的裸宿主 fail-closed 不动)。
      def = value
    } else {
      issues.push(`default 只允许 'allow' | 'ask' | 'deny',得到:${JSON.stringify(value)}`)
    }
  }

  if (raw['rules'] === undefined) {
    issues.push('缺少必填字段 rules(可为空数组,空策略 = 一切走 default)')
  } else if (!Array.isArray(raw['rules'])) {
    issues.push('rules 必须是数组')
  } else {
    const seen = new Set<string>()
    for (const [index, entry] of raw['rules'].entries()) {
      issues.push(...validateRule(entry, index, seen))
    }
  }
  if (issues.length > 0) throw new GovernanceConfigError(`${sourceLabel}: 策略校验失败`, issues)

  const rules = (raw['rules'] as unknown[]).map(entry => toRule(entry as Record<string, unknown>))
  return { rules, default: def }
}

function validateRule(entry: unknown, index: number, seen: Set<string>): string[] {
  if (!isRecord(entry)) return [`rules[${index}] 必须是映射`]
  const at = `rules[${index}]`
  const issues: string[] = []
  const unknownKeys = Object.keys(entry).filter(key => !RULE_KEYS.has(key))
  if (unknownKeys.length > 0) issues.push(`${at}: 未知字段 ${unknownKeys.join(',')}`)

  const id = entry['id']
  if (typeof id !== 'string' || id.length === 0) {
    issues.push(`${at}: id 必须是非空字符串`)
  } else if (seen.has(id)) {
    issues.push(`${at}: 规则 id 重复:${id}`)
  } else {
    seen.add(id)
  }

  const effect = entry['effect']
  if (typeof effect !== 'string' || !EFFECTS.includes(effect as RuleEffect)) {
    issues.push(`${at}: effect 必须是 allow|ask|deny,得到:${JSON.stringify(effect)}`)
  }

  const tools = entry['tools']
  if (!Array.isArray(tools) || tools.length === 0 || !tools.every(t => typeof t === 'string' && t.length > 0)) {
    issues.push(`${at}: tools 必须是非空 glob 字符串数组`)
  }

  const argsContains = entry['argsContains']
  if (argsContains !== undefined && (!Array.isArray(argsContains) || !argsContains.every(t => typeof t === 'string'))) {
    issues.push(`${at}: argsContains 必须是字符串数组`)
  }

  const reason = entry['reason']
  if (reason !== undefined && typeof reason !== 'string') {
    issues.push(`${at}: reason 必须是字符串`)
  }
  return issues
}

function toRule(entry: Record<string, unknown>): PolicyRule {
  const argsContains = entry['argsContains'] as string[] | undefined
  const reason = entry['reason'] as string | undefined
  return {
    id: entry['id'] as string,
    effect: entry['effect'] as RuleEffect,
    tools: entry['tools'] as string[],
    ...(argsContains !== undefined && { argsContains }),
    ...(reason !== undefined && { reason }),
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
