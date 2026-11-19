/**
 * R1 预算守卫接线(35 号 A17 验收门禁;33 号 §1.3 G2-A3 全条;24 §5.5-R1;24a C2 双轨):
 * - effort 三档分档上限映射 governance BudgetConfig(可配;档位缺席不设限);
 * - `maxTokens`/`maxCost` 硬截断:超限在 `agent/turn-stopping` seam cancel({kind:'hook'}),
 *   不留半成品静默;超限走 `failed` 报告而非无限重试(agent-error/resumeAfter 让位);
 * - 计量双轨:技术 token 与产品工单积分两种单位可配并正确换算
 *   (换算率为部署配置,默认未定——35 号 §12-17,缺省不记积分轨);
 * - effort 三档进候选卡字段(EngineOptions.effort 注入)与 Mandate 执行契约。
 */
import { describe, expect, it } from 'vitest'
import { BudgetGuard } from '@eterna/governance'
import { Engine, MemoryRepositories } from '../src/index.ts'
import { budgetUsage, effortGuide, ticketBudget, ticketBudgetEntry, toCredits } from '../src/executor/budget.ts'
import type { Assessor, Candidate, Executor, Outbox, Policy } from '../src/core/index.ts'
import { trigger } from './fixtures/engine.ts'
import { humanTrigger, startHost } from './fixtures/host.ts'

describe('ticketBudget:effort 三档分档上限(可配;G2-A3)', () => {
  it('按档取 caps;未配维度不设限;档位缺席不设限', () => {
    const budget = { caps: { simple: {}, compare: { maxTokens: 1000, maxCost: 2 }, complex: { maxTurns: 40 } } }
    expect(ticketBudget(budget, 'compare')).toEqual({ maxTokens: 1000, maxCost: 2 })
    expect(ticketBudget(budget, 'simple')).toEqual({})
    expect(ticketBudget(budget, 'complex')).toEqual({ maxTurns: 40 })
    expect(ticketBudget(budget, undefined)).toEqual({})
    expect(ticketBudget(undefined, 'compare')).toEqual({})
  })

  it('pricing 计价随配置透传(maxCost 记账口径)', () => {
    const budget = { caps: { simple: {}, compare: { maxCost: 1 }, complex: {} },
      pricing: { inputPerMTokens: 2, outputPerMTokens: 8 } }
    expect(ticketBudget(budget, 'compare')).toEqual({ maxCost: 1, pricing: { inputPerMTokens: 2, outputPerMTokens: 8 } })
  })

  it('effort 三档的 subagent 预算文本 = 24 §5.5-R1 分级原文(1 / 2–4 / 10+)', () => {
    expect(effortGuide('simple')).toBe('1 subagent')
    expect(effortGuide('compare')).toBe('2–4 subagents')
    expect(effortGuide('complex')).toBe('10+ subagents')
  })
})

describe('计量双轨(24a C2):token 技术轨 + credits 产品轨,可配并正确换算', () => {
  it('toCredits:换算率 = 每百万 token 折合积分;缺省(默认未定)不记积分轨', () => {
    expect(toCredits(1_500_000, 2)).toBe(3)
    expect(toCredits(120, 500_000)).toBe(60)
    expect(toCredits(999, undefined)).toBeUndefined()
  })

  it('budgetUsage:guard 记账后双轨快照(token、credits 与违规)', () => {
    const entry = ticketBudgetEntry({ caps: { simple: {}, compare: { maxTokens: 100 }, complex: {} }, creditsPerMTokens: 500_000 }, 'compare')
    entry.guard.applyEvent({ type: 'assistant/message', data: { usage: { inputTokens: 60, outputTokens: 40 } } })
    expect(budgetUsage(entry)).toEqual({ effort: 'compare', subagents: { min: 2, max: 4 }, tokens: 100, credits: 50, violations: [] })
    entry.guard.applyEvent({ type: 'assistant/message', data: { usage: { inputTokens: 10, outputTokens: 10 } } })
    const usage = budgetUsage(entry)
    expect(usage.tokens).toBe(120)
    expect(usage.credits).toBe(60)
    expect(usage.violations).toHaveLength(1)
    expect(usage.violations[0]).toMatchObject({ dimension: 'tokens', limit: 100, actual: 120 })
  })

  it('governance BudgetGuard 直接记账:成本按 pricing 派生(maxCost 硬上限的记账口径)', () => {
    const guard = new BudgetGuard({ maxCost: 1, pricing: { inputPerMTokens: 2, outputPerMTokens: 8 } })
    guard.applyEvent({ type: 'assistant/message', data: { usage: { inputTokens: 250_000, outputTokens: 50_000 } } })
    expect(guard.usage().cost).toBe(0.5 + 0.4)
    guard.applyEvent({ type: 'assistant/message', data: { usage: { inputTokens: 250_000, outputTokens: 50_000 } } })
    expect(guard.exhausted()).toBe(true)
    expect(guard.check()[0]).toMatchObject({ dimension: 'cost', limit: 1 })
  })
})

describe('executor 接线:launch 建工单档、超限硬截断并记 failed、双轨用量暴露(G2-A3)', () => {
  it('超 maxTokens:usage 记账触发截断与 failed 报告;turn-stopping seam cancel(hook);usageOf 双轨', async () => {
    const h = await startHost()
    try {
      const settings = h.store.settings()
      h.store.saveSettings({ ...settings,
        budget: { caps: { simple: {}, compare: { maxTokens: 100 }, complex: {} }, creditsPerMTokens: 500_000 } })
      const { ticket, sessionId } = await h.accept(humanTrigger('1', '@bot 修回归'), { effort: 'compare' })
      await h.settle()
      const agent = h.agents.get(sessionId)
      expect(agent).toBeDefined()
      // worker 的模型步产生 usage(计费 token 累计超 compare 档 100 上限:100 → 180)。
      h.ctx.emit('session/event', agent!.session as never, { type: 'assistant/message',
        data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'working' }] },
          usage: { inputTokens: 60, outputTokens: 40 } } } as never)
      h.ctx.emit('session/event', agent!.session as never, { type: 'assistant/message',
        data: { turn: 1, step: 2, message: { role: 'assistant', content: [{ type: 'text', text: 'still' }] },
          usage: { inputTokens: 40, outputTokens: 40 } } } as never)
      // 超限在收口边界硬截断:turn-stopping seam 上 guard.directive → cancel({kind:'hook'})。
      h.ctx.emit('agent/turn-stopping', { agent: agent!, turn: 1, signal: new AbortController().signal } as never)
      const causes = agent!.cancel.mock.calls.map(call => call[0] as { kind?: string })
      expect(causes.some(cause => cause.kind === 'hook')).toBe(true)
      // 超限走 failed 报告(而非重试):报告落库且摘要带预算缘由。
      const report = h.store.tickets.get(ticket.id)?.assignments.at(-1)?.report
      expect(report?.state).toBe('failed')
      expect(report?.summary).toContain('Budget exhausted')
      expect(report?.summary).toContain('token 超限')
      // 双轨计量暴露:180 token @ 0.5 积分/千(=每百万 50 万)→ 90 积分。
      expect(h.executor.usageOf(ticket.id)).toMatchObject({ effort: 'compare', subagents: { min: 2, max: 4 },
        tokens: 180, credits: 90 })
    } finally { await h.stop() }
  })

  it('预算耗尽后瞬时错误不进退避重试:走 failed 报告(超限而非无限重试;35 号 A17)', async () => {
    const h = await startHost()
    try {
      const settings = h.store.settings()
      h.store.saveSettings({ ...settings,
        budget: { caps: { simple: {}, compare: { maxTokens: 100 }, complex: {} } } })
      const { ticket, sessionId } = await h.accept(humanTrigger('2', '@bot 修回归'), { effort: 'compare' })
      await h.settle()
      const agent = h.agents.get(sessionId)!
      h.ctx.emit('session/event', agent.session as never, { type: 'assistant/message',
        data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'x' }] },
          usage: { inputTokens: 150, outputTokens: 0 } } } as never)
      await h.settle()
      const before = h.deliveries.mock.calls.length
      // 供应商瞬时错误(可重试类)到达:预算已耗尽,不得排 retry 消息。
      h.ctx.emit('agent/error', { agent, error: new Error('overloaded'), turn: 1, step: 1 } as never)
      await h.settle()
      const retries = h.deliveries.mock.calls.slice(before).map(([delivery]) => delivery)
        .filter(delivery => delivery.id.includes('retry:'))
      expect(retries).toEqual([])
      const report = h.store.tickets.get(ticket.id)?.assignments.at(-1)?.report
      expect(report?.state).toBe('failed')
      expect(report?.summary).toContain('Budget exhausted')
    } finally { await h.stop() }
  })

  it('档位缺席(effort 未声明)不设限:超量 usage 不产生违规、不截断', async () => {
    const h = await startHost()
    try {
      const { ticket, sessionId } = await h.accept(humanTrigger('3', '@bot 修回归'))
      await h.settle()
      const agent = h.agents.get(sessionId)!
      h.ctx.emit('session/event', agent.session as never, { type: 'assistant/message',
        data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'x' }] },
          usage: { inputTokens: 999_999, outputTokens: 999_999 } } } as never)
      expect(h.executor.usageOf(ticket.id)).toMatchObject({ tokens: 1_999_998 })
      expect(h.executor.usageOf(ticket.id)?.violations).toEqual([])
      expect(h.store.tickets.get(ticket.id)?.assignments.at(-1)?.report?.state).not.toBe('failed')
    } finally { await h.stop() }
  })
})

describe('effort 三档进候选卡字段与 Mandate 执行契约(35 号 A17;26 §4.1 effort 段)', () => {
  /** 最小 Engine(内核假件,34 §4-A):effort 声明经 EngineOptions 注入,候选卡携带。 */
  function engineWithEffort(effort: 'compare' | undefined) {
    const repo = new MemoryRepositories()
    const policy: Policy = { version: 'v1', paused: false, evalTimeoutMs: 60_000,
      gate: t => t.human && t.actor.id === 'alice'
        ? { admissible: true, strength: 'explicit', basis: { via: 'addressed', addressed: 'mention' } }
        : { admissible: false, reason: 'not offered' },
      revalidate: () => true, admitsInferred: () => false }
    const requests: Candidate[] = []
    const assessor: Assessor = { request: (candidate) => { requests.push(candidate) } }
    const executor: Executor = { start: () => {}, deliver: () => {}, stop: () => {} }
    const outbox: Outbox = { send: () => {}, status: () => undefined, withdraw: () => {} }
    const engine = new Engine({ repo, policy: () => policy, realmOf: () => 'r',
      scope: { scope: () => ({ listened: true, observed: false }) }, assessor, executor, outbox,
      ...(effort ? { effort: (): 'compare' | undefined => effort } : {}) })
    return { engine, requests }
  }

  it('EngineOptions.effort → 候选卡 effort 字段(领域包声明段经装配注入,tasks 消费)', () => {
    const { engine, requests } = engineWithEffort('compare')
    engine.receive(trigger('1', { actor: { source: 'chat', id: 'alice' } }))
    engine.evaluateDue()
    expect(requests.at(-1)?.effort).toBe('compare')
  })

  it('声明缺席:候选卡不带 effort 字段(内核不发明默认档)', () => {
    const { engine, requests } = engineWithEffort(undefined)
    engine.receive(trigger('2', { actor: { source: 'chat', id: 'alice' } }))
    engine.evaluateDue()
    expect(requests.at(-1)?.effort).toBeUndefined()
    expect('effort' in requests.at(-1)!).toBe(false)
  })

  it('accept 固化 effort → Decision.effort 与 Execution.effort/契约文本(审计全链可查)', async () => {
    const h = await startHost()
    try {
      const { decision, ticket } = await h.accept(humanTrigger('5', '@bot 修回归'), { effort: 'complex' })
      expect(decision.effort).toBe('complex')
      expect(ticket.execution?.effort).toBe('complex')
      expect(ticket.execution?.assignment).toContain('Effort tier: complex (subagent budget: 10+ subagents)')
      expect(ticket.execution?.assignment).toContain('Gate contract')
    } finally { await h.stop() }
  })
})

// governance BudgetGuard 为 A17 的截断执行面(35 号 A17「接 governance budget」);
// 其工单级扩展用例(=G2-A3 全条的 governance 半边)在 packages/governance/tests/budget-ticket.spec.ts。
