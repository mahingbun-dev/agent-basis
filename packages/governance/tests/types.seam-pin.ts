/**
 * DSH seam 编译期钉住(只被 tsc --noEmit 消费;vitest include 只收 *.spec.ts,不运行本文件)。
 *
 * 目的(设计文档 08 §8 风险 1):DSH 处于 pre-stable,所有 L1 插件的适配面要在 CI 里
 * 用接口冒烟测试钉住。本文件用**已发布的 @deepseek-ai/dsh-*(与 deepseek-harness 同为
 * 0.2.2-alpha.2)类型**断言:治理包的最小接口与官方 seam 双向兼容——DSH 升级破坏
 * seam 形态时,`pnpm --filter @eterna/governance run verify` 的 tsc 阶段即失败。
 *
 * 依据(deepseek-harness,只读):
 * - packages/core/tools/src/events.ts:18(tools/pre-execute waterfall 签名)
 * - packages/core/tools/src/contracts.ts:357-363(PreToolDecision)、180-219(ToolExecution)
 * - packages/core/agent/src/runtime-types.ts:417(agent/turn-stopping)、206-208(live Agent.cancel)
 * - packages/core/session/src/types.ts:504-518(SessionEvent 事件包)
 */
import type { Events } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { AuditProjector, BudgetGuard, MemoryAuditSink, RuleEngine } from '../src/index.ts'

declare const liveAgent: Agent
declare const sessionEvents: readonly SessionEvent[]
declare const toolExec: ToolExecution

const rules = RuleEngine.parse('rules: []')
const budget = new BudgetGuard({ maxTurns: 8, maxTokens: 100_000 })
const audit = new AuditProjector({ sinks: [new MemoryAuditSink()] })

/**
 * 钉住 ①:BudgetGuard.onTurnStopping 可直接注册为 dsh `agent/turn-stopping` 监听器。
 * 官方签名要求 (payload: { agent: Agent; turn: number; signal: AbortSignal }) => Promise<void> | void;
 * 成立条件:dsh 载荷可赋值给 TurnStoppingEvent(live Agent 满足 TurnStoppingAgentLike 的 id/cancel)。
 */
export const pinTurnStoppingDirect: Events['agent/turn-stopping'] = budget.onTurnStopping

/** 钉住 ①b:组合层惯用的箭头注册形态同样成立。 */
export const pinTurnStoppingArrow: Events['agent/turn-stopping'] = (event) => {
  void budget.onTurnStopping(event)
}

/** 钉住 ①c:治理侧拿到的 agent 对象可直接调用 cancel({ kind: 'hook', reason })——dsh AgentCancelCause 的 hook 分支。 */
export function pinAgentCancelShape(): void {
  liveAgent.cancel({ kind: 'hook', reason: '[governance] 预算超限' })
}

/**
 * 钉住 ②:规则引擎决策可装配为 dsh `tools/pre-execute` waterfall 监听器。
 * 成立条件:ToolExecution 满足 ToolCallLike(name/arguments),且 GovernancePreDecision
 * 可赋值给官方 PreToolDecision(allow/deny/ask 三形态,reason 结构一致)。
 */
export const pinPreExecute: PreExecuteListener = (exec, next) => {
  const decision = rules.preExecuteDecision(exec)
  if (decision.kind === 'allow') return next()
  return Promise.resolve(decision)
}

/** dsh tools/pre-execute 监听器类型(官方签名)。 */
type PreExecuteListener =
  (exec: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision>

/**
 * 钉住 ③:dsh SessionEvent 可直接喂给预算记账与审计投影。
 * 成立条件:SessionEvent(seq 为 SessionSeq 品牌数、time 为毫秒、data 为判别联合)
 * 满足 SessionEventLike / AuditEventInput 的结构子集。
 */
export const pinSessionEventFeed: readonly number[] = sessionEvents.map((event) => {
  budget.applyEvent(event)
  audit.projectEvent(event)
  return event.seq
})

/** 钉住 ④:预算截断守卫可装配为 pre-execute(或 ctx.tools.guard 邻接)处的工具闸。 */
export const pinBudgetGuardOnToolExec: PreToolDecision = budget.preExecuteGuard(toolExec)
