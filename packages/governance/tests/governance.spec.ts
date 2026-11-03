import { describe, expect, it } from 'vitest'
import { BudgetGuard, EgressLite, MemoryAuditSink, PiiFilter, RuleEngine, createGovernance, createGovernanceFromYaml } from '../src/index.ts'
import type { AuditProjector } from '../src/index.ts'
import { AuditProjector as AuditProjectorClass } from '../src/index.ts'

const RULES = RuleEngine.parse(`
rules:
  - { id: allow-read, effect: allow, tools: ['read_*'] }
  - { id: ask-money, effect: ask, tools: ['*'], argsContains: ['payment'] }
  - { id: deny-rm, effect: deny, tools: ['shell*'], argsContains: ['rm -rf'] }
`)

describe('组合治理门:createGovernance', () => {
  it('id 为注册表唯一 ID(@basis/governance)', () => {
    const gov = createGovernance({ rules: RULES })
    expect(gov.id).toBe('@basis/governance')
  })

  it('未配预算/egress 时行为退化为纯规则引擎', () => {
    const gov = createGovernance({ rules: RULES })
    expect(gov.preExecute({ name: 'read_file', arguments: {} })).toEqual({ kind: 'allow' })
    expect(gov.preExecute({ name: 'shell', arguments: { cmd: 'rm -rf /' } }).kind).toBe('deny')
    expect(gov.preExecute({ name: 'pay', arguments: { action: 'payment' } }).kind).toBe('ask')
  })
})

describe('组合治理门:preExecute 分层裁决(deny 优先)', () => {
  const egress = new EgressLite({ proxyUrl: 'http://p:1', allowedOutboundTools: ['web_fetch'] })

  it('预算耗尽压过一切:规则 allow 也 deny(预算截断)', () => {
    const exhausted = new BudgetGuard({ maxTurns: 1 })
    exhausted.applyEvent({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    exhausted.applyEvent({ type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
    const gov = createGovernance({ rules: RULES, budget: exhausted })
    const decision = gov.preExecute({ name: 'read_file', arguments: {} })
    expect(decision.kind).toBe('deny')
    if (decision.kind === 'deny') expect(decision.reason).toContain('预算已耗尽')
  })

  it('egress 白名单外的出网工具 deny,压过规则 allow(规则里 read_* 放行也拦)', () => {
    const gov = createGovernance({
      rules: RuleEngine.parse("rules: [{ id: all, effect: allow, tools: ['*'] }]"),
      egress,
    })
    const decision = gov.preExecute({ name: 'web_upload', arguments: {} })
    expect(decision.kind).toBe('deny')
    if (decision.kind === 'deny') expect(decision.reason).toContain('egress 白名单')
    // 白名单内 + 规则 allow → allow
    expect(gov.preExecute({ name: 'web_fetch', arguments: {} })).toEqual({ kind: 'allow' })
  })

  it('规则引擎内部仍保持 deny > ask > allow', () => {
    const gov = createGovernance({ rules: RULES, egress })
    expect(gov.preExecute({ name: 'shell', arguments: { cmd: 'rm -rf x' } }).kind).toBe('deny')
    expect(gov.preExecute({ name: 'shell', arguments: { action: 'payment' } }).kind).toBe('ask')
    expect(gov.preExecute({ name: 'read_file', arguments: {} })).toEqual({ kind: 'allow' })
  })
})

describe('组合治理门:便捷工厂 createGovernanceFromYaml', () => {
  it('一次组装五模块(审计双 sink + PII + 预算 + egress)', () => {
    const memory = new MemoryAuditSink()
    const gov = createGovernanceFromYaml('rules: []', {
      budgetConfig: { maxTokens: 10 },
      egressConfig: { proxyUrl: 'http://p:1', allowedOutboundTools: [] },
      pii: new PiiFilter(),
      audit: { sinks: [memory] },
    })
    expect(gov.budget?.config.maxTokens).toBe(10)
    expect(gov.egress?.classify('web_fetch')).toBe('outbound-denied')
    expect(gov.pii?.patterns.length).toBeGreaterThan(0)
    expect(gov.audit).toBeInstanceOf(AuditProjectorClass)
    // 空策略 = 一切 fail-closed ask
    expect(gov.preExecute({ name: 'read_file', arguments: {} })).toEqual({ kind: 'ask' })
  })
})

describe('组合治理门:接线审计(预算违规 → governance 记录)', () => {
  it('onViolation 钩子把违规写入审计投影', async () => {
    const memory = new MemoryAuditSink()
    const audit: AuditProjector = new AuditProjectorClass({ sinks: [memory] })
    const gov = createGovernanceFromYaml('rules: []', {
      audit: { sinks: [memory] },
    })
    const budget = new BudgetGuard({ maxTurns: 1 }, { onViolation: violation => audit.reportGovernance({ source: 'budget', ...violation }) })
    void gov
    budget.applyEvent({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    budget.applyEvent({ type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
    await audit.flush()
    expect(memory.records).toHaveLength(1)
    expect(memory.records[0]).toMatchObject({
      kind: 'governance',
      detail: { source: 'budget', dimension: 'turns', actual: 2, limit: 1 },
    })
  })
})

describe('seam 运行形态:用 dsh 载荷的真实结构驱动治理件', () => {
  it('turn-stopping 载荷(agent/turn/signal)可直接喂给 BudgetGuard.onTurnStopping', () => {
    const guard = new BudgetGuard({ maxTurns: 1 })
    const cancels: { kind: string; reason: string }[] = []
    const agent = {
      id: 'a1',
      cancel: (cause: { kind: string; reason: string }) => {
        cancels.push(cause)
      },
    }
    void guard.onTurnStopping({ agent, turn: 2, signal: new AbortController().signal })
    expect(cancels).toHaveLength(1)
    expect(cancels[0]?.reason).toContain('turn 超限')
  })

  it('ToolExecution 形态对象(带 token/signal 等额外字段)可直接喂给规则引擎与 egress', () => {
    const exec = {
      name: 'web_upload',
      arguments: { url: 'https://a.b' },
      rootCallId: 'c1',
      token: Symbol('token'),
      signal: new AbortController().signal,
    }
    const gov = createGovernance({
      rules: RuleEngine.parse("rules: [{ id: all, effect: allow, tools: ['*'] }]"),
      egress: new EgressLite({ proxyUrl: 'http://p:1', allowedOutboundTools: [] }),
    })
    expect(gov.preExecute(exec).kind).toBe('deny')
  })

  it('SessionEvent 形态对象(seq/time 在事件包上)可直接喂给预算记账与审计投影', async () => {
    const memory = new MemoryAuditSink()
    const guard = new BudgetGuard({})
    const audit = new AuditProjectorClass({ sinks: [memory] })
    const sessionEvent = {
      type: 'turn/end',
      seq: 3,
      time: 1_760_000_000_000,
      data: { turn: 1, reason: { kind: 'completed' } },
    }
    guard.applyEvent(sessionEvent)
    audit.projectEvent(sessionEvent)
    await audit.flush()
    expect(guard.usage().turns).toBe(1)
    expect(memory.records[0]).toMatchObject({ kind: 'turn-end', turn: 1, reason: 'completed', seq: 3 })
  })
})
