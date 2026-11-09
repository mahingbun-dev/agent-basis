/**
 * 预算守卫:maxTurns / maxTokens / maxCost 配置 + turn-stopping 事件处理器。
 *
 * seam 依据(deepseek-harness packages/core/agent-loop/README.md:220,Known Limitations):
 * "No built-in turn budget —— a policy that bounds runaway turns must cancel from an
 * existing lifecycle extension point such as `agent/turn-stopping`."
 * 事件签名(packages/core/agent/src/runtime-types.ts:417):
 * `(payload: { agent, turn, signal }) => Promise<void> | void`,serial 派发;
 * live Agent 具备 `cancel(cause: AgentCancelCause, options?)`(runtime-types.ts:206-208),
 * hook 取值 `{ kind: 'hook', reason }`(packages/core/session/src/types.ts:197)。
 *
 * 执行模型:
 * 1. 记账:applyEvent 投影 session 事件流 —— `turn/end` 记一轮,`assistant/message` 的
 *    usage 记 token(并按 pricing 派生成本);usage 形态对齐
 *    packages/llm/llm/src/types.ts:182-196(TokenUsage)。
 * 2. 截断(两层):
 *    a) turn 维度 —— turn-stopping 边界上若超限,经 agent.cancel({kind:'hook'}) 硬截断,
 *       阻止其他监听者继续 steer 拉长会话;
 *    b) token/cost 维度 —— 超限后 preExecuteGuard() 对一切工具调用返回 deny,
 *       截断"模型-工具"死循环(turn-stopping 边界在工具环里不触发,这是唯一可靠截断点)。
 */
import { isRecord } from './errors.ts'
import type { GovernancePreDecision, SessionEventLike, ToolCallLike, TurnCancelCause, TurnStoppingEvent, TurnStoppingHandler } from './types.ts'

/** 预算配置。全部可选;缺省的维度不设限。 */
export interface BudgetConfig {
  /** 会话内最大 turn 数(闭区间内合法,超过即违规)。 */
  readonly maxTurns?: number
  /** 累计 token 上限(input+output 合计,含 adapter 报告的 totalTokens 口径)。 */
  readonly maxTokens?: number
  /** 累计成本上限(货币单位由使用者约定,与 pricing 同单位)。 */
  readonly maxCost?: number
  /** 计价:每 100 万 token 的单价;缺省维度计 0。 */
  readonly pricing?: { readonly inputPerMTokens?: number; readonly outputPerMTokens?: number }
}

/** 当前累计用量。 */
export interface BudgetUsage {
  readonly turns: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  readonly cost: number
}

export type BudgetDimension = 'turns' | 'tokens' | 'cost'

/** 一条预算违规(审计/审批卡片直接可读)。 */
export interface BudgetViolation {
  readonly dimension: BudgetDimension
  readonly limit: number
  readonly actual: number
  readonly message: string
}

/** turn-stopping 边界上的纯决策:放行关闭,或取消(硬截断)。 */
export type TurnStopDirective =
  | { readonly action: 'allow-close' }
  | { readonly action: 'cancel'; readonly cause: TurnCancelCause; readonly violations: readonly BudgetViolation[] }

export interface BudgetHooks {
  /** 新违规产生时回调(接审计投影/interact)。同步调用,勿在此抛错。 */
  readonly onViolation?: (violation: BudgetViolation) => void
}

/** 预算守卫。单会话(单 agent)一实例;组合层负责把 session 事件与 seam 接进来。 */
export class BudgetGuard {
  readonly #config: BudgetConfig
  readonly #hooks: BudgetHooks
  #turns = 0
  #inputTokens = 0
  #outputTokens = 0
  #totalTokens = 0
  #cost = 0
  #firedDimensions = new Set<BudgetDimension>()

  constructor(config: BudgetConfig = {}, hooks: BudgetHooks = {}) {
    assertPositive('maxTurns', config.maxTurns)
    assertPositive('maxTokens', config.maxTokens)
    assertPositive('maxCost', config.maxCost)
    this.#config = config
    this.#hooks = hooks
  }

  get config(): Readonly<BudgetConfig> {
    return this.#config
  }

  /** 投影一条 session 事件并记账;返回本次新产生的违规(已去重:每维度只报一次)。 */
  applyEvent(event: SessionEventLike): readonly BudgetViolation[] {
    if (event.type === 'turn/end' && isRecord(event.data)) {
      this.#turns += 1
    } else if (event.type === 'assistant/message' && isRecord(event.data)) {
      const usage = event.data['usage']
      if (isRecord(usage)) {
        const input = readCount(usage['inputTokens']) ?? 0
        const output = readCount(usage['outputTokens']) ?? 0
        const total = readCount(usage['totalTokens']) ?? input + output
        this.#inputTokens += input
        this.#outputTokens += output
        this.#totalTokens += total
        const pricing = this.#config.pricing
        if (pricing !== undefined) {
          this.#cost += (input / 1e6) * (pricing.inputPerMTokens ?? 0)
            + (output / 1e6) * (pricing.outputPerMTokens ?? 0)
        }
      }
    }
    return this.#reportNew()
  }

  /** 当前用量快照。 */
  usage(): Readonly<BudgetUsage> {
    return {
      turns: this.#turns,
      inputTokens: this.#inputTokens,
      outputTokens: this.#outputTokens,
      totalTokens: this.#totalTokens,
      cost: this.#cost,
    }
  }

  /** 是否已有任一维度超限(截断总开关)。 */
  exhausted(): boolean {
    return this.#violations().length > 0
  }

  /** 按当前已入账用量评估全部违规(不落去重状态,纯查询)。 */
  check(): readonly BudgetViolation[] {
    return this.#violations()
  }

  /** turn-stopping 边界纯决策。turn = 即将关闭的这一轮(计入后即第 max(已完成, turn) 轮)。 */
  directive(turn: number): TurnStopDirective {
    const effectiveTurns = Math.max(this.#turns, turn)
    const violations = this.#violations(effectiveTurns)
    if (violations.length === 0) return { action: 'allow-close' }
    return {
      action: 'cancel',
      cause: { kind: 'hook', reason: `[governance] 预算超限:${violations.map(v => v.message).join(';')}` },
      violations,
    }
  }

  /**
   * dsh `agent/turn-stopping` seam 形态的事件处理器(签名见 types.ts:TurnStoppingHandler)。
   * 超预算 → agent.cancel({kind:'hook'})(硬截断);未超 → 不动作(允许正常收口)。
   * 组合层注册示例:ctx.on('agent/turn-stopping', (e) => guard.onTurnStopping(e))。
   */
  readonly onTurnStopping: TurnStoppingHandler = (event: TurnStoppingEvent): void => {
    const d = this.directive(event.turn)
    if (d.action === 'cancel') {
      event.agent.cancel(d.cause)
      for (const violation of d.violations) this.#fire(violation)
    }
  }

  /**
   * token/cost 超限后的工具截断守卫:exhausted 时对一切调用 deny。
   * 组合层应在 tools/pre-execute(或 ctx.tools.guard)处先于规则引擎调用。
   */
  readonly preExecuteGuard = (call: ToolCallLike): GovernancePreDecision => {
    if (!this.exhausted()) return { kind: 'allow' }
    const violations = this.#violations()
    return { kind: 'deny', reason: `[governance] 预算已耗尽,拒绝继续执行工具 ${call.name}:${violations.map(v => v.message).join(';')}` }
  }

  /** 重置记账(测试/会话重建用)。 */
  reset(): void {
    this.#turns = 0
    this.#inputTokens = 0
    this.#outputTokens = 0
    this.#totalTokens = 0
    this.#cost = 0
    this.#firedDimensions.clear()
  }

  #violations(effectiveTurns: number = this.#turns): BudgetViolation[] {
    const violations: BudgetViolation[] = []
    const { maxTurns, maxTokens, maxCost } = this.#config
    if (maxTurns !== undefined && effectiveTurns > maxTurns) {
      violations.push({
        dimension: 'turns',
        limit: maxTurns,
        actual: effectiveTurns,
        message: `turn 超限:${effectiveTurns} > ${maxTurns}`,
      })
    }
    if (maxTokens !== undefined && this.#totalTokens > maxTokens) {
      violations.push({
        dimension: 'tokens',
        limit: maxTokens,
        actual: this.#totalTokens,
        message: `token 超限:${this.#totalTokens} > ${maxTokens}`,
      })
    }
    if (maxCost !== undefined && this.#cost > maxCost) {
      violations.push({
        dimension: 'cost',
        limit: maxCost,
        actual: this.#cost,
        message: `cost 超限:${this.#cost} > ${maxCost}`,
      })
    }
    return violations
  }

  #reportNew(): BudgetViolation[] {
    const fresh: BudgetViolation[] = []
    for (const violation of this.#violations()) {
      if (this.#firedDimensions.has(violation.dimension)) continue
      this.#firedDimensions.add(violation.dimension)
      fresh.push(violation)
      this.#fire(violation)
    }
    return fresh
  }

  #fire(violation: BudgetViolation): void {
    this.#firedDimensions.add(violation.dimension)
    try {
      this.#hooks.onViolation?.(violation)
    } catch {
      // 回调失败不影响记账(fail-open 仅限旁路通知,主路径仍 fail-closed)
    }
  }
}

function readCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function assertPositive(name: keyof BudgetConfig, value: number | undefined): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new RangeError(`[governance] BudgetConfig.${name} 必须是正数,得到:${value}`)
  }
}
