/**
 * @basis/governance —— L1 治理插件核心(策略纯函数层 + DSH seam 适配形态)。
 *
 * 五个模块:
 * 1. 规则引擎(rules.ts):YAML 策略 → evaluate(tool, args) → allow|ask|deny;deny 优先、fail-closed 默认 ask。
 * 2. 预算守卫(budget.ts):maxTurns/maxTokens/maxCost + agent/turn-stopping seam 处理器(超限即 agent.cancel 硬截断)。
 * 3. PII 过滤(pii.ts):可插拔正则列表,redact/assertClean 两种用法,供 memory/knowledge 写入前调用。
 * 4. 审计投影(audit.ts):session 事件流 → 审计记录,内存/文件双 sink。
 * 5. egress-lite(egress.ts):出网工具白名单判定 + proxy 环境变量注入载荷(引导级,见模块注释)。
 *
 * Cordis 纪律:本包是策略纯函数层(不触碰 ctx 全局、无副作用闭包逃逸);
 * 组合层(bundle)把 createGovernance() 的产物以 `ctx.governance` 服务
 * (注册表 + GOVERNANCE_SERVICE_ID 唯一 ID)形态 provide,可交换、可配逆。
 * seam 形态的编译期钉住见 tests/types.seam-pin.ts。
 */
import { AuditProjector } from './audit.ts'
import { BudgetGuard } from './budget.ts'
import { EgressLite } from './egress.ts'
import { RuleEngine } from './rules.ts'
import type { AuditProjectorOptions } from './audit.ts'
import type { BudgetConfig, BudgetHooks } from './budget.ts'
import type { EgressLiteConfig } from './egress.ts'
import type { PiiFilter } from './pii.ts'
import type { GovernancePreDecision, ToolCallLike } from './types.ts'

export { AuditProjector } from './audit.ts'
export type { AuditProjectorOptions, AuditEventInput } from './audit.ts'
export { FileAuditSink, MemoryAuditSink } from './sink.ts'
export type { AuditActor, AuditRecord, AuditSink } from './sink.ts'
export { BudgetGuard } from './budget.ts'
export type {
  BudgetConfig, BudgetDimension, BudgetHooks, BudgetUsage, BudgetViolation, TurnStopDirective,
} from './budget.ts'
export { EgressLite, DEFAULT_OUTBOUND_TOOL_GLOBS } from './egress.ts'
export type { EgressClassification, EgressLiteConfig } from './egress.ts'
export { PiiBlockedError, PiiFilter, defaultPiiPatterns } from './pii.ts'
export type { PiiFinding, PiiPattern, PiiRedaction } from './pii.ts'
export { RuleEngine, serializeArgs } from './rules.ts'
export type { PolicyDocument, PolicyRule, RuleEffect, RuleEvaluation } from './rules.ts'
export { GovernanceConfigError, isRecord } from './errors.ts'
export { globToRegExp, matchAnyGlob, matchGlob } from './glob.ts'
export type {
  GovernancePreDecision, SessionEventLike, ToolCallLike, TurnCancelCause, TurnStoppingAgentLike,
  TurnStoppingEvent, TurnStoppingHandler,
} from './types.ts'
export { stableStringify } from './types.ts'

/** 组合层注册 ctx.governance 服务时的唯一 ID(注册表 + 唯一 ID 形态,provide 可交换)。 */
export const GOVERNANCE_SERVICE_ID = '@basis/governance'

/** 组合治理门:预算截断 → egress 白名单 → 规则引擎,任一 deny 即 deny。 */
export interface Governance {
  readonly id: typeof GOVERNANCE_SERVICE_ID
  readonly rules: RuleEngine
  readonly budget?: BudgetGuard
  readonly egress?: EgressLite
  readonly pii?: PiiFilter
  readonly audit?: AuditProjector
  /**
   * tools/pre-execute 组合决策:
   * 1. 预算耗尽 → deny(截断"模型-工具"死循环);
   * 2. 出网工具不在白名单 → deny;
   * 3. 其余交规则引擎(deny > ask > allow > 默认 ask)。
   */
  preExecute(call: ToolCallLike): GovernancePreDecision
}

export interface GovernanceOptions {
  readonly rules: RuleEngine
  readonly budget?: BudgetGuard
  readonly egress?: EgressLite
  readonly pii?: PiiFilter
  readonly audit?: AuditProjector
}

/** 组装一个治理门实例(纯对象,无隐藏全局;字段不可变)。 */
export function createGovernance(options: GovernanceOptions): Governance {
  const id = GOVERNANCE_SERVICE_ID
  return {
    id,
    rules: options.rules,
    ...(options.budget !== undefined && { budget: options.budget }),
    ...(options.egress !== undefined && { egress: options.egress }),
    ...(options.pii !== undefined && { pii: options.pii }),
    ...(options.audit !== undefined && { audit: options.audit }),
    preExecute(call: ToolCallLike): GovernancePreDecision {
      if (options.budget?.exhausted() === true) return options.budget.preExecuteGuard(call)
      const egressDecision = options.egress?.preExecuteDecision(call)
      if (egressDecision !== undefined && egressDecision.kind === 'deny') return egressDecision
      return options.rules.preExecuteDecision(call)
    },
  }
}

/** 便捷工厂:从策略 YAML 文本 + 配置一次性组装。 */
export function createGovernanceFromYaml(
  policyYaml: string,
  extras: {
    readonly budgetConfig?: BudgetConfig
    readonly budgetHooks?: BudgetHooks
    readonly egressConfig?: EgressLiteConfig
    readonly audit?: AuditProjectorOptions
    readonly pii?: PiiFilter
  } = {},
): Governance {
  return createGovernance({
    rules: RuleEngine.parse(policyYaml),
    ...(extras.budgetConfig !== undefined && { budget: new BudgetGuard(extras.budgetConfig, extras.budgetHooks) }),
    ...(extras.egressConfig !== undefined && { egress: new EgressLite(extras.egressConfig) }),
    ...(extras.pii !== undefined && { pii: extras.pii }),
    ...(extras.audit !== undefined && { audit: new AuditProjector(extras.audit) }),
  })
}
