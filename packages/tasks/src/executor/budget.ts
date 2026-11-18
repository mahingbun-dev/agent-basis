/**
 * R1 预算守卫接线——effort 三档分档上限映射 governance `BudgetGuard` + 计量双轨
 * (35 号 A17;24 号 §5.5-R1「主 Session 预算守卫:effort scaling 分级(简单 1 agent /
 * 比较 2–4 subagent / 复杂 10+)+ maxTokens/maxCost 硬截断」;24a 拍板记录·C2 计量双轨;
 * 34 §2.4 dsh 行 R1 落点、§5-governance budget 行;33 号 G2-A3 全条)。
 *
 * 执行模型(R1;governance/budget.ts 头注同源):
 * - DshExecutor 在 `launchQueued` 为每张工单建一个工单级 `BudgetGuard`(配置 =
 *   settings.budget.caps 按该工单 `Execution.effort` 档取用;档位缺席 = 不设限——
 *   26 §4.1 effort 段由领域包声明,内核不发明默认档);
 * - worker session 事件(assistant/message 的 usage、turn/end)记账进 guard;
 * - 超限在 `agent/turn-stopping` seam 硬截断(guard.onTurnStopping → agent.cancel({kind:'hook'}),
 *   G2-A3 判据「超限即停在 agent/turn-stopping seam,不留半成品静默」),且**超限走 `failed`
 *   报告而非无限重试**(35 号 A17 交付原文——瞬时重试路径 `retries`/`resumeAfter` 在预算
 *   耗尽时一律让位给 failed 记账);
 * - 计量双轨(24a C2):技术 token(guard.usage().totalTokens)与产品工单积分
 *   (`toCredits` 按 settings.budget.creditsPerMTokens 换算)两种单位可配并正确换算;
 *   换算率为**部署配置,默认值未定**(35 号 §12-17),缺省不记积分轨。
 *
 * 不变量:本文件只做配置映射与记账,截断动作全在 governance BudgetGuard(deny 优先、
 * fail-closed);governance pre-execute 瀑布天然罩住 worker,本层不重复治理面。
 */
import { BudgetGuard } from '@eterna/governance'
import type { BudgetConfig, BudgetViolation } from '@eterna/governance'
import { EFFORT_SUBAGENTS, type EffortTier } from '../core/model.ts'
import type { BudgetSettings } from '../policy/settings.ts'

/**
 * 工单的 governance 预算配置:effort 档位对应的三档上限 + 计价。纯映射——
 * 档位缺席(领域包未声明)或某维度未配即不设限(BudgetConfig 可选维度语义)。
 */
export function ticketBudget(budget: BudgetSettings | undefined, effort: EffortTier | undefined): BudgetConfig {
  const caps = effort === undefined || budget === undefined ? undefined : budget.caps[effort]
  return {
    ...(caps?.maxTurns !== undefined ? { maxTurns: caps.maxTurns } : {}),
    ...(caps?.maxTokens !== undefined ? { maxTokens: caps.maxTokens } : {}),
    ...(caps?.maxCost !== undefined ? { maxCost: caps.maxCost } : {}),
    ...(budget?.pricing !== undefined ? { pricing: budget.pricing } : {}),
  }
}

/** 档位的 subagent 数量预算文本(24 §5.5-R1 分级原文:1 / 2–4 / 10+;进 Mandate 执行契约)。 */
export function effortGuide(effort: EffortTier): string {
  const { min, max } = EFFORT_SUBAGENTS[effort]
  return max === undefined ? `${min}+ subagents` : min === max ? `${min} subagent${min > 1 ? 's' : ''}` : `${min}–${max} subagents`
}

/**
 * 计量双轨换算(24a C2;35 号 A17「两种单位可配并正确换算」):技术 token → 产品工单积分,
 * 按部署配置的 `creditsPerMTokens`(每百万 token 折合多少积分)。换算率缺席(35 号 §12-17
 * 默认值未定)时返回 undefined——积分轨不记账,**不发明 1:1 之类默认**。
 */
export function toCredits(totalTokens: number, creditsPerMTokens: number | undefined): number | undefined {
  return creditsPerMTokens === undefined ? undefined : (totalTokens / 1e6) * creditsPerMTokens
}

/** 一张工单的预算记账面:档位、双轨用量与最新违规(governance BudgetGuard 的工单级壳)。 */
export interface TicketBudgetUsage {
  readonly effort?: EffortTier
  /** 档位的 subagent 数量预算(24 §5.5-R1 分级:1 / 2–4 / 10+;进执行契约与候选卡)。 */
  readonly subagents?: { readonly min: number; readonly max?: number }
  readonly tokens: number
  /** 产品工单积分轨(creditsPerMTokens 已配置才有值;35 号 §12-17 默认未定不发明)。 */
  readonly credits?: number
  /** 尚未消化的违规(governance BudgetViolation 原样,审计/审批卡直接可读)。 */
  readonly violations: readonly BudgetViolation[]
}

/** 一张工单级预算守卫(工单首次 launch 建档,工单结束销账;跨 assignment 累计——上限按「单工单」)。 */
export interface TicketBudgetEntry {
  readonly effort?: EffortTier
  readonly guard: BudgetGuard
  readonly creditsPerMTokens: number | undefined
}

/**
 * 为一张工单建预算守卫档:`config` = settings.budget(租户库设置),`effort` = 该工单 accept
 * 固化的档位(`Execution.effort`)。三档上限缺席维度不设限;pricing 缺席时成本恒 0,
 * maxCost 因此永不触发(与「缺省维度不设限」一致,不发明计价默认)。
 */
export function ticketBudgetEntry(config: BudgetSettings | undefined, effort: EffortTier | undefined): TicketBudgetEntry {
  return {
    ...(effort !== undefined ? { effort } : {}),
    guard: new BudgetGuard(ticketBudget(config, effort)),
    creditsPerMTokens: config?.creditsPerMTokens,
  }
}

/** 一张工单的双轨用量快照(observe/测试消费;token 技术轨 + credits 产品轨)。 */
export function budgetUsage(entry: TicketBudgetEntry): TicketBudgetUsage {
  const tokens = entry.guard.usage().totalTokens
  const credits = toCredits(tokens, entry.creditsPerMTokens)
  return {
    ...(entry.effort !== undefined ? { effort: entry.effort } : {}),
    ...(entry.effort !== undefined ? { subagents: EFFORT_SUBAGENTS[entry.effort] } : {}),
    tokens,
    ...(credits !== undefined ? { credits } : {}),
    violations: entry.guard.check(),
  }
}
