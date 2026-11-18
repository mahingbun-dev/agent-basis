/**
 * D1 subagent_policies——worker 派生 subagent 的权限策略声明段(消费面)与借权约束门
 * (35 号 A18;24a 拍板记录·D1「`subagent_policies` 进 worker 声明段(默认只读 reviewer 类)」;
 * 27 号 §2.1-1「subagent 永不越过 Mandate」、§5-1;26 §4.1 worker 段扩展、§7-1 schema 待拍板;
 * 33 号 §1.3 G2-A16 全条)。
 *
 * 设计边界(35 号 A18 交付原文逐条):
 * - **不改内核**:本文件在 executor 层,`src/core/` 零改动;worker 与其 subagent 的工具治理
 *   由 governance pre-execute 瀑布天然罩住(glue 层已接线),本层不重复权限判定;
 * - **schema 未定前以 types seam 钉住消费面形状、不预设 YAML 格式**:五段 schema 是 26 §7-1
 *   待拍板项(G2-A18 占位登记,33 号 §6-14),本文件只钉「领域包声明被 glue 解析后」的
 *   消费对象形状(`SubagentPolicies`),领域包覆盖经 `TasksOptions.subagentPolicies` 端口注入;
 * - **默认只读 reviewer 类**:默认策略引用 `@eterna/extra` reviewer preset——包可引用的平台
 *   资产(preset id 与只读工具词汇表都以 extra 为单一真值,本文件不复制清单)。
 *
 * 借权不越 Mandate(27 §2.1-1):worker 的授权来自其工单 Mandate;它派生的 subagent 只能
 * 拿到声明段点名的只读策略面——`SubagentPolicyGate.constrainForWorker` 把派生请求钳到
 * 已声明的 preset/allow 内、拒绝再派生(nested),越权请求一律抛 `SubagentPolicyViolation`
 * (fail-closed,不静默钳改)。
 */
import { buildReviewerPreset, DEFAULT_REVIEWER_ALLOW, READ_ONLY_TOOL_VOCABULARY, REVIEWER_DENY_GLOBS } from '@eterna/extra'

/** 平台资产的 reviewer preset id(packages/extra reviewer preset;单一真值取自其构造器缺省)。 */
export const REVIEWER_PRESET_ID: string = buildReviewerPreset().preset.id

/** 一条 subagent 权限策略:点名一个平台 preset 资产与其只读工具白名单。 */
export interface SubagentPolicy {
  /** 平台 preset 资产 id(如 reviewer 只读类 → `REVIEWER_PRESET_ID`;extra reviewer preset)。 */
  readonly preset: string
  /** 工具白名单(subagent 可见工具;必须 ⊆ extra 只读词汇表——D1 默认只读 reviewer 类)。 */
  readonly allow: readonly string[]
  /** 再派生上限:声明段 v1 只接受 false——subagent 不得再派 subagent(借权不越 Mandate)。 */
  readonly nested?: false
}

/**
 * 包声明段 `worker.subagent_policies` 的消费面形状(types seam;26 §7-1 schema 待拍板,
 * **不预设 YAML 格式**——领域包声明的解析在 glue/packctl 侧,G2-A18 码表扩展后对齐):
 * `default` 必填(worker 派生任何未点名 subagent 时套用),可按名给多条点名策略。
 */
export interface SubagentPolicies {
  /** 默认策略(D1:默认只读 reviewer 类)。 */
  readonly default: SubagentPolicy
  /** 按名点名的策略(声明段消费面最小形状;名字语义随 26 §7-1 拍板细化)。 */
  readonly policies?: Readonly<Record<string, SubagentPolicy>>
}

/** D1 默认声明段:只读 reviewer 类——引用 extra reviewer preset 平台资产与其词汇表白名单。 */
export const DEFAULT_SUBAGENT_POLICIES: SubagentPolicies = {
  default: { preset: REVIEWER_PRESET_ID, allow: [...DEFAULT_REVIEWER_ALLOW], nested: false },
}

/**
 * 声明段校验(fail-closed,装配期拒收):preset id 与 allow 词汇表逐条检——
 * allow 空名单、含只读词汇表外工具、命中变更/出网拒绝 glob、嵌套声明非 false 皆违规。
 * @returns 全部错误;空数组即合法。
 */
export function validateSubagentPolicies(policies: SubagentPolicies): string[] {
  const errors: string[] = []
  const entries: [string, SubagentPolicy][] = [['default', policies.default],
    ...Object.entries(policies.policies ?? {})]
  for (const [name, policy] of entries) {
    const label = name === 'default' ? 'default' : `policies.${name}`
    if (!/^[a-z][a-z0-9-]*$/u.test(policy.preset)) errors.push(`${label}.preset 必须是小写 kebab-case 平台资产 id:${JSON.stringify(policy.preset)}`)
    if (!Array.isArray(policy.allow) || policy.allow.length === 0) errors.push(`${label}.allow 不能为空名单(subagent 无法工作)`)
    for (const tool of policy.allow) {
      if (!READ_ONLY_TOOL_VOCABULARY.includes(tool)) errors.push(`${label}.allow 含只读词汇表外工具 "${tool}"(词汇表:${READ_ONLY_TOOL_VOCABULARY.join('/')})`)
      for (const glob of REVIEWER_DENY_GLOBS) {
        if (matchGlob(tool, glob)) errors.push(`${label}.allow 命中变更/出网拒绝项 "${tool}"(deny glob:${glob};D1 默认只读 reviewer 类)`)
      }
    }
    // nested 声明只接受 false;其余任何值(含 true)违规——按 unknown 读以容错外来声明
    // (27 号 §2.1-1:subagent 不得再派 subagent)。
    const nested: unknown = (policy as { nested?: unknown }).nested
    if (nested !== undefined && nested !== false) errors.push(`${label}.nested 只接受 false(27 号 §2.1-1:subagent 不得再派 subagent)`)
  }
  return errors
}

/** 解析一次派生点名到的策略:未点名(或点名未知)落默认;未知点名按 fail-closed 拒绝。 */
export function resolveSubagentPolicy(policies: SubagentPolicies, name?: string): SubagentPolicy {
  if (name === undefined || name === 'default') return policies.default
  const policy = policies.policies?.[name]
  if (!policy) throw new SubagentPolicyViolation(`未声明的 subagent 策略 "${name}"(借权只限声明段点名;默认 ${policies.default.preset})`)
  return policy
}

/** 一次 subagent 派生请求的消费面形状(worker 的派生工具在 A20 接线时按此收口)。 */
export interface SubagentSpawnIntent {
  /** 点名的声明段策略名;缺省用默认策略(D1 默认只读 reviewer 类)。 */
  readonly policy?: string
  /** 请求的 preset 资产 id;缺省由策略给出。 */
  readonly preset?: string
  /** 请求的工具白名单;缺省由策略给出。 */
  readonly allow?: readonly string[]
  /** 是否再派生(subagent 开自己的 subagent)。 */
  readonly nested?: boolean
}

/** 约束后的派生请求:preset/allow 来自所解析的策略,nested 恒 false。 */
export interface ConstrainedSpawn {
  readonly policy: string
  readonly preset: string
  readonly allow: readonly string[]
  readonly nested: false
}

/** 借权越权(27 号 §2.1-1「subagent 永不越过 Mandate」)被拒时抛出;fail-closed 不静默钳改。 */
export class SubagentPolicyViolation extends Error {}

/**
 * 借权约束门:worker session 派生 subagent 时受声明段 policies 约束(G2-A16 判据「worker 派
 * subagent 受约束」)。请求的 preset/allow 必须落在所解析策略内,越权抛
 * `SubagentPolicyViolation`;未声明的字段由策略补齐(请求收紧不放宽)。
 *
 * ★接线点:35 号 A20 worker 工具面装配 subagent 派生工具时,以本门收口派生参数;A25 的
 * worker preset 行(agentPreset=REVIEWER_PRESET_ID 等)是同一约束的 preset 侧形态。
 * governance pre-execute 瀑布对 worker 与其 subagent 的治理不受本门影响(两层并存)。
 */
export function constrainForWorker(policies: SubagentPolicies, intent: SubagentSpawnIntent): ConstrainedSpawn {
  const policy = resolveSubagentPolicy(policies, intent.policy)
  const name = intent.policy ?? 'default'
  if (intent.preset !== undefined && intent.preset !== policy.preset) {
    throw new SubagentPolicyViolation(`subagent preset "${intent.preset}" 越出声明段策略 "${name}"(只允许 ${policy.preset};借权不越 Mandate)`)
  }
  for (const tool of intent.allow ?? []) {
    if (!policy.allow.includes(tool)) {
      throw new SubagentPolicyViolation(`subagent 工具 "${tool}" 越出声明段策略 "${name}" 的白名单(${policy.allow.join('/')};借权不越 Mandate)`)
    }
  }
  if (intent.nested === true) {
    throw new SubagentPolicyViolation(`subagent 不得再派 subagent(27 号 §2.1-1 借权不越 Mandate;策略 "${name}" nested=false)`)
  }
  return { policy: name, preset: policy.preset, allow: [...policy.allow], nested: false }
}

/** 极简 glob:`*` 任意串,整串锚定(extra reviewer-preset 同源语义)。 */
function matchGlob(name: string, glob: string): boolean {
  const source = glob.split('*').map(segment => segment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('.*')
  return new RegExp(`^${source}$`, 'u').test(name)
}
