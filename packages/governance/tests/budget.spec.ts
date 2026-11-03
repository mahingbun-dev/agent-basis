import { describe, expect, it, vi } from 'vitest'
import { BudgetGuard } from '../src/index.ts'
import type { BudgetViolation, TurnCancelCause, TurnStoppingAgentLike, TurnStoppingEvent } from '../src/index.ts'

/** dsh session 事件的最小构造器(形态对齐 packages/core/session/src/types.ts SessionEventMap)。 */
function event(type: string, data: unknown): { type: string; data: unknown; seq: number; time: number } {
  return { type, data, seq: 0, time: 0 }
}

function turnEnd(turn: number, reason = 'completed'): { type: string; data: unknown; seq: number; time: number } {
  return event('turn/end', { turn, reason: { kind: reason } })
}

function assistantUsage(
  inputTokens: number,
  outputTokens: number,
  totalTokens?: number,
): { type: string; data: unknown; seq: number; time: number } {
  return event('assistant/message', {
    turn: 1,
    step: 1,
    usage: { inputTokens, outputTokens, ...(totalTokens !== undefined && { totalTokens }) },
  })
}

/** 形态对齐 dsh agent/turn-stopping 载荷的 mock agent。 */
function mockAgent(): { agent: TurnStoppingAgentLike; cancels: TurnCancelCause[] } {
  const cancels: TurnCancelCause[] = []
  const agent: TurnStoppingAgentLike = {
    id: 'agent-1',
    cancel: (cause: TurnCancelCause) => {
      cancels.push(cause)
    },
  }
  return { agent, cancels }
}

function stopEvent(agent: TurnStoppingAgentLike, turn: number): TurnStoppingEvent {
  return { agent, turn, signal: new AbortController().signal }
}

describe('预算守卫:记账', () => {
  it('turn/end 记轮数;assistant/message 记 token(total 缺省取 input+output)', () => {
    const guard = new BudgetGuard({})
    guard.applyEvent(turnEnd(1))
    guard.applyEvent(turnEnd(2))
    guard.applyEvent(assistantUsage(100, 40))
    expect(guard.usage()).toEqual({
      turns: 2, inputTokens: 100, outputTokens: 40, totalTokens: 140, cost: 0,
    })
  })

  it('usage 采用 adapter 报告的 totalTokens 口径', () => {
    const guard = new BudgetGuard({})
    guard.applyEvent(assistantUsage(100, 40, 200))
    expect(guard.usage().totalTokens).toBe(200)
  })

  it('按 pricing 派生成本(每百万 token 单价)', () => {
    const guard = new BudgetGuard({ pricing: { inputPerMTokens: 2, outputPerMTokens: 8 } })
    guard.applyEvent(assistantUsage(1_000_000, 500_000))
    expect(guard.usage().cost).toBeCloseTo(2 + 4, 10)
  })

  it('非法配置(非正数上限)构造期抛错', () => {
    expect(() => new BudgetGuard({ maxTurns: 0 })).toThrow(RangeError)
    expect(() => new BudgetGuard({ maxTokens: -1 })).toThrow(RangeError)
  })
})

describe('预算守卫:违规评估与去重', () => {
  it('tokens 超限产生违规,同维度只报一次', () => {
    const guard = new BudgetGuard({ maxTokens: 1_000 })
    expect(guard.applyEvent(assistantUsage(400, 100))).toEqual([])
    const first = guard.applyEvent(assistantUsage(400, 200)) // 累计 1100 > 1000
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ dimension: 'tokens', limit: 1_000, actual: 1_100 })
    expect(guard.applyEvent(assistantUsage(100, 50))).toEqual([]) // 已报过
    expect(guard.check()).toHaveLength(1) // 纯查询仍可见
  })

  it('turns 与 cost 维度独立上报', () => {
    const guard = new BudgetGuard({ maxTurns: 1, maxCost: 0.001, pricing: { inputPerMTokens: 4 } })
    expect(guard.applyEvent(turnEnd(1))).toEqual([])
    const violations = guard.applyEvent(turnEnd(2))
    expect(violations.map(v => v.dimension)).toEqual(['turns'])
    guard.applyEvent(assistantUsage(1_000_000, 0)) // cost = 4 > 0.001
    expect(guard.exhausted()).toBe(true)
    expect(guard.check().map(v => v.dimension).sort()).toEqual(['cost', 'turns'])
  })

  it('onViolation 钩子收到新违规', () => {
    const onViolation = vi.fn<(violation: BudgetViolation) => void>()
    const guard = new BudgetGuard({ maxTurns: 1 }, { onViolation })
    guard.applyEvent(turnEnd(1))
    guard.applyEvent(turnEnd(2))
    expect(onViolation).toHaveBeenCalledTimes(1)
    expect(onViolation.mock.calls[0]?.[0].dimension).toBe('turns')
  })
})

describe('预算守卫:turn-stopping 截断(预算截断)', () => {
  it('未超限:directive 放行关闭,不触碰 agent', () => {
    const guard = new BudgetGuard({ maxTurns: 3 })
    const { agent, cancels } = mockAgent()
    guard.applyEvent(turnEnd(1))
    expect(guard.directive(2)).toEqual({ action: 'allow-close' })
    void guard.onTurnStopping(stopEvent(agent, 2))
    expect(cancels).toEqual([])
  })

  it('turn 超限:directive 下发 cancel,onTurnStopping 经 agent.cancel({kind:"hook"}) 硬截断', () => {
    const guard = new BudgetGuard({ maxTurns: 2 })
    const { agent, cancels } = mockAgent()
    guard.applyEvent(turnEnd(1))
    guard.applyEvent(turnEnd(2))
    // 边界轮 turn=3(一旦关闭即第 3 轮)> maxTurns=2
    const directive = guard.directive(3)
    expect(directive.action).toBe('cancel')
    if (directive.action === 'cancel') {
      expect(directive.cause.kind).toBe('hook')
      expect(directive.cause.reason).toContain('turn 超限')
      expect(directive.violations[0]).toMatchObject({ dimension: 'turns', actual: 3, limit: 2 })
    }
    void guard.onTurnStopping(stopEvent(agent, 3))
    expect(cancels).toEqual([{ kind: 'hook', reason: expect.stringContaining('turn 超限') as unknown }])
  })

  it('token 超限同样在 stop 边界截断(cancel 的 cause 保持 AgentCancelCause hook 形态)', () => {
    const guard = new BudgetGuard({ maxTokens: 100 })
    guard.applyEvent(assistantUsage(80, 30))
    const { agent, cancels } = mockAgent()
    void guard.onTurnStopping(stopEvent(agent, 1))
    expect(cancels).toHaveLength(1)
    expect(cancels[0]?.kind).toBe('hook')
    expect(cancels[0]?.reason).toContain('token 超限')
  })

  it('同一 stop 边界重复触发只截断一次不影响正确性(幂等调用)', () => {
    const guard = new BudgetGuard({ maxTurns: 1 })
    const { agent, cancels } = mockAgent()
    void guard.onTurnStopping(stopEvent(agent, 2))
    void guard.onTurnStopping(stopEvent(agent, 2))
    expect(cancels).toHaveLength(2) // seam 语义:每次未配逆的 cancel 调用都透传;cause 一致
    expect(cancels[0]).toEqual(cancels[1])
  })
})

describe('预算守卫:工具截断守卫(模型-工具死循环的唯一可靠截断点)', () => {
  it('未耗尽放行;耗尽后对一切工具 deny(即使规则全 allow)', () => {
    const guard = new BudgetGuard({ maxTokens: 500 })
    expect(guard.preExecuteGuard({ name: 'shell', arguments: { cmd: 'ls' } })).toEqual({ kind: 'allow' })
    guard.applyEvent(assistantUsage(400, 200))
    const decision = guard.preExecuteGuard({ name: 'shell', arguments: { cmd: 'ls' } })
    expect(decision.kind).toBe('deny')
    if (decision.kind === 'deny') {
      expect(decision.reason).toContain('预算已耗尽')
      expect(decision.reason).toContain('shell')
    }
  })
})

describe('预算守卫:reset', () => {
  it('清零用量与已报维度(会话重建)', () => {
    const guard = new BudgetGuard({ maxTurns: 1 })
    guard.applyEvent(turnEnd(1))
    guard.applyEvent(turnEnd(2))
    expect(guard.exhausted()).toBe(true)
    guard.reset()
    expect(guard.usage().turns).toBe(0)
    expect(guard.exhausted()).toBe(false)
    expect(guard.applyEvent(turnEnd(1))).toEqual([])
  })
})
