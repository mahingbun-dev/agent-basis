/**
 * 工单级预算守卫扩展用例(33 号 §1.3 G2-A3 的 governance 半边;35 号 A17 验收门禁
 * 「packages/governance/tests/budget*.spec.ts 工单级扩展用例」)。
 *
 * 工单级语义(tasks R1 接线的外沿契约,24 号 §5.5-R1):一张工单一个 BudgetGuard 实例,
 * 上限 = 该工单 effort 档的 maxTokens/maxCost;worker 会话事件持续记账(跨回合累计);
 * 超限在 agent/turn-stopping 边界 cancel({kind:'hook'})——「不留半成品静默」;违规每维度
 * 只报一次(dedup),审计面可读。纯 governance 面测试(不 import tasks)。
 */
import { describe, expect, it } from 'vitest'
import { BudgetGuard } from '../src/index.ts'
import type { TurnCancelCause, TurnStoppingAgentLike } from '../src/index.ts'

/** 形态对齐 dsh session 事件(worker 回合的 usage)的最小构造器。 */
const usage = (inputTokens: number, outputTokens: number) =>
  ({ type: 'assistant/message', data: { usage: { inputTokens, outputTokens } } })
const turnEnd = () => ({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
/** 形态对齐 dsh agent/turn-stopping 载荷的 mock agent(记录 cancel 因果)。 */
function mockAgent(): { agent: TurnStoppingAgentLike; cancels: TurnCancelCause[] } {
  const cancels: TurnCancelCause[] = []
  return { agent: { id: 'worker-ticket-1', cancel: (cause: TurnCancelCause) => { cancels.push(cause) } }, cancels }
}

describe('工单级预算:maxTokens/maxCost 硬截断生效(G2-A3 工单级扩展)', () => {
  it('一张工单一个实例:usage 跨回合累计,超限在收口边界 cancel({kind:hook}) 不留半成品', () => {
    // 工单档上限:50 万 token(governance 面:上限值来自调用方——tasks 按工单 effort 档注入)。
    const guard = new BudgetGuard({ maxTokens: 500_000 })
    const { agent, cancels } = mockAgent()
    guard.applyEvent(usage(300_000, 100_000))
    guard.applyEvent(turnEnd())
    expect(guard.exhausted()).toBe(false)
    guard.applyEvent(usage(100_000, 100_000)) // 累计 600_000 > 500_000
    expect(guard.exhausted()).toBe(true)
    void guard.onTurnStopping({ agent, turn: 2, signal: new AbortController().signal })
    expect(cancels).toHaveLength(1)
    expect(cancels[0]).toMatchObject({ kind: 'hook' })
    expect((cancels[0] as { kind: string; reason: string }).reason).toContain('token 超限')
  })

  it('未超限的收口不截断(allow-close),guard 不动作', () => {
    const guard = new BudgetGuard({ maxTokens: 1000 })
    const { agent, cancels } = mockAgent()
    guard.applyEvent(usage(400, 300))
    void guard.onTurnStopping({ agent, turn: 1, signal: new AbortController().signal })
    expect(cancels).toEqual([])
  })

  it('maxCost 按工单 pricing 记账超限;违规每维度只报一次(dedup)可入审计', () => {
    const seen: string[] = []
    const guard = new BudgetGuard({ maxCost: 1, pricing: { inputPerMTokens: 2, outputPerMTokens: 8 } },
      { onViolation: (violation) => { seen.push(violation.dimension) } })
    guard.applyEvent(usage(250_000, 50_000))
    guard.applyEvent(usage(250_000, 50_000))
    expect(guard.check()).toHaveLength(1)
    expect(guard.check()[0]).toMatchObject({ dimension: 'cost', limit: 1 })
    expect(guard.check()[0]?.actual).toBeCloseTo(1.8, 10)
    expect(seen).toEqual(['cost'])
    // 继续记账不重复报同一维度(dedup),超限事实不变(fail-closed)。
    guard.applyEvent(usage(10, 10))
    expect(seen).toEqual(['cost'])
    expect(guard.exhausted()).toBe(true)
  })
})
