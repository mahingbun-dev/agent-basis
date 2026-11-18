/**
 * 候选卡评估结果的校验与转译——把 assessor 的 Assessment 转成 Engine 可施行的 AssessmentOutcome。
 *
 * 设计依据:34 号 §2.2 assessment 行(SA policy.ts:25-61 拆出)、§2.1 evals 行(R3 落点);
 * 35 号 A4;24 §5.5-R3(缺项则 Eval 拒绝,结构校验不靠 prompt)、24a 拍板记录·B1(主动巡检
 * 仅观察模式:observe 档全量记录 would_accept)。
 * 语义自 SA policy.ts:25-61 重写级校对移植;★本仓加固(34 §2.2 assessment 行):accept 在
 * SA 的 AdmissionDirection 四方向之上,必须再携带 R3 委派四要素(Delegation,core/model)——
 * 缺任一要素即 `UserError('delegationIncomplete')`(与 core Engine.decide 的同码守卫前后两道,
 * 35 号 A7);Engine 侧对未走本函数产出的 outcome 仍兜底拒绝。
 * 谁可在何处发起工作由各 Source 自己的身份配置决定;Policy 从不把一个人跨 Source 映射。
 */
import { z } from 'zod'
import { UserError } from '../core/errors.ts'
import type { Delegation, Strength } from '../core/model.ts'
import type { AssessmentOutcome } from '../core/ports.ts'
import { RuleIdSchema, type Settings } from './settings.ts'

/** 评估对一条规则的命中:规则 id 与一句可审计的判断理由。 */
export const RuleMatchSchema = z.object({ rule_id: RuleIdSchema, reason: z.string().trim().min(1).max(500) }).strict()
  .describe('规则命中:rule_id + 判断理由')
export type RuleMatch = z.infer<typeof RuleMatchSchema>
/** 评估对一条规则的逐条裁决:是否命中。 */
export const RuleAssessmentSchema = RuleMatchSchema.extend({ matched: z.boolean() }).strict().describe('规则裁决:命中与否 + 理由')
export type RuleAssessment = z.infer<typeof RuleAssessmentSchema>
/**
 * 准入方向(AdmissionDirection 四方向,SA 原样):一次 accept 必须已确立实现意图与落点,
 * 且没有待决设计决策——未确立即 directionUnsettled(ignore)。
 */
export const AdmissionDirectionSchema = z.object({
  implementation_requested: z.boolean().describe('发送者是否请求了实现(而非只报告/讨论)'),
  target_basis: z.enum(['specified', 'existing-standard', 'undetermined']).describe('改动目标的依据:明示/既有客观标准/未定'),
  requires_design_decision: z.boolean().describe('是否仍需一个产品或设计决策'),
  evidence: z.string().trim().min(1).max(700).describe('支撑判断的原话或事实'),
}).strict().describe('准入方向:实现意图 × 目标依据 × 设计决策 × 证据')
export type AdmissionDirection = z.infer<typeof AdmissionDirectionSchema>
/** 方向是否已定:确立了实现意图、目标依据非未定、且无待决设计决策。 */
export function directionAllowed(value: unknown): value is AdmissionDirection {
  const result = AdmissionDirectionSchema.safeParse(value)
  return result.success && result.data.implementation_requested && result.data.target_basis !== 'undetermined' && !result.data.requires_design_decision
}
/**
 * R3 委派四要素(24 §5.5-R3;34 §2.1 evals 行;35 号 A4/A7):objective/outputFormat/
 * toolGuidance/taskBoundaries,四者皆必填非空——「模糊委派是重复劳动首因」的结构防线。
 */
export const DelegationSchema = z.object({
  objective: z.string().trim().min(1).describe('目标:这件工作要达成什么'),
  outputFormat: z.string().trim().min(1).describe('产出形态:结果以什么格式交付'),
  toolGuidance: z.string().trim().min(1).describe('工具指引:允许与期望使用的工具、路径与做法'),
  taskBoundaries: z.string().trim().min(1).describe('任务边界:做到哪里为止、不做什么'),
}).strict().describe('R3 委派四要素(accept 必填)')
/** 四要素是否齐全(判据与 core/evals.ts 的 completeDelegation 同源:字段齐且非空)。 */
export const delegationComplete = (delegation: Delegation | undefined): delegation is Delegation =>
  DelegationSchema.safeParse(delegation).success

/** assessor 交回的候选卡评估;`direction` 尚未经校验(unknown),由 assessmentOutcome 裁。 */
export interface Assessment {
  decision: 'accept' | 'ignore' | 'unavailable'
  rule_assessments: RuleAssessment[]
  direction: unknown
  title: string
  scope: string
  reason: string
  intent_evidence?: string | null
  acknowledgement?: string | null
  /** 工单请求的短名(落 Ticket.execution.name)。 */
  worktree_name?: string
  /** ★R3(35 号 A4):accept 必须携带的委派四要素。 */
  delegation?: Delegation
  /** ★交接来源(35 号 A8;ports.ts accept 分支):本 accept 接手自哪张原工单。 */
  handoffOf?: string
}
/**
 * 对照启用规则校验一份评估,并转成 Engine 的 `AssessmentOutcome`。
 * accept 需要:方向已定、至少命中一条启用规则、`intent_evidence`,并携带完整 R3 四要素;
 * 推断候选仅在 `auto` 档可 accept——否则记为 `would_accept` 的 ignore(B1 观察模式)。
 * @throws 每条启用规则必须恰被评估一次(多评/漏评/未知规则 id 均拒);accept 缺 `intent_evidence` 拒;
 * accept 缺任一 R3 四要素拒(`UserError('delegationIncomplete')`)。
 */
export function assessmentOutcome(assessment: Assessment, settings: Pick<Settings, 'policy' | 'eval'>, strength: Strength): AssessmentOutcome {
  const enabled = settings.policy.rules.filter(rule => rule.enabled)
  const judged = assessment.rule_assessments
  const ids = new Set(judged.map(item => item.rule_id))
  if (judged.length !== enabled.length || ids.size !== judged.length || enabled.some(rule => !ids.has(rule.id))) {
    throw new Error('Exactly one assessment for every enabled rule is required; disabled, unknown or missing rule IDs are not allowed')
  }
  const matches = judged.filter(item => item.matched).map(({ rule_id, reason }) => ({ rule_id, reason }))
  const evidence = assessment.intent_evidence ? { intent_evidence: assessment.intent_evidence } : {}
  const audit = { matches, rule_assessments: judged, direction: assessment.direction, ...evidence }
  if (assessment.decision !== 'accept') return { kind: assessment.decision, reason: assessment.reason, audit }
  if (!directionAllowed(assessment.direction)) return { kind: 'ignore', audit, reason: { code: 'directionUnsettled' } }
  if (!matches.length) return { kind: 'ignore', audit, reason: { code: 'noRuleMatched' } }
  if (!assessment.intent_evidence) throw new Error('Acceptance requires intent_evidence')
  const { title, scope, worktree_name: name } = assessment
  if (strength === 'inferred' && settings.eval.mode !== 'auto') {
    // B1 观察模式:不授权、只记录「本会 accept」——提案(proposal)供人回看。
    const proposal = { title, scope, worktree_name: name }
    return { kind: 'ignore', audit: { ...audit, would_accept: true, proposal }, reason: { code: 'observed', values: { text: assessment.reason } } }
  }
  // ★R3 四要素必填(35 号 A4):accept 不带完整委派即拒——结构校验,不靠 prompt 约定。
  if (!delegationComplete(assessment.delegation)) throw new UserError('delegationIncomplete')
  const optional = { ...(assessment.acknowledgement ? { acknowledgement: assessment.acknowledgement } : {}),
    ...(name ? { name } : {}), ...(assessment.handoffOf ? { handoffOf: assessment.handoffOf } : {}) }
  return { kind: 'accept', title, scope, reason: assessment.reason, delegation: assessment.delegation,
    ...optional, rules: matches.map(match => match.rule_id), audit }
}
