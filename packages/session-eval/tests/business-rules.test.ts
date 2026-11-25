/**
 * 规则型业务指标(56 号 §9.3/§9.7):事件事实投影(轮数/计费 token/审批问询/
 * 最终回答)与三类确定性断言(approval / answer / budget);外来数据 fail-closed。
 */
import { describe, expect, it } from 'vitest'
import { buildBusinessRuleFacts, isBusinessRuleMetric, runBusinessRule } from '../src/business-rules.ts'
import { businessFormOf } from '../src/business-metrics.ts'
import type { BusinessRuleMetric } from '../src/business-rules.ts'
import type { SessionEventLike } from '../src/types.ts'

const EVENTS: readonly SessionEventLike[] = [
  { type: 'turn/start', time: 1, data: { turn: 1 } },
  { type: 'tool/call', time: 2, data: { callId: 'c1', turn: 1, toolName: 'shell' } },
  { type: 'approval/asked', time: 3, data: { toolName: 'shell', callId: 'c1' } },
  { type: 'assistant/message', time: 4, data: { turn: 1, usage: { totalTokens: 120 }, message: { content: [{ type: 'text', text: '第一轮回复' }] } } },
  { type: 'assistant/message', time: 4.5, data: { content: [{ type: 'text', text: '无轮次包裹的回复' }] } },
  { type: 'turn/start', time: 5, data: { turn: 2 } },
  { type: 'turn/start', time: 6, data: { turn: 2 } }, // 重复 turn 号只计一轮
  { type: 'approval/asked', time: 7, data: { toolName: 'shell', callId: 'c2' } },
  { type: 'tool/call', time: 8, data: { callId: 'c2', turn: 2, toolName: 'shell' } },
  { type: 'approval/asked', time: 9, data: { toolName: 'write' } }, // 无 callId:不计入单轮
  { type: 'assistant/message', time: 10, data: { turn: 2, usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 1 }, message: { content: [{ type: 'text', text: '第二轮回复' }] } } },
  { type: 'tool/result', time: 12, data: null },
]

function ruleOf(patch: Partial<BusinessRuleMetric>): BusinessRuleMetric {
  return {
    key: 'rule-metric',
    name: '规则指标',
    description: '',
    category: 'process',
    scope: 'session',
    gating: false,
    enabled: true,
    version: 1,
    ...patch,
  } as BusinessRuleMetric
}

describe('buildBusinessRuleFacts', () => {
  const facts = buildBusinessRuleFacts(EVENTS)

  it('轮数按 turn/start 去重;计费 token 双口径合计(total 优先,否则四桶)', () => {
    expect(facts.turns).toBe(2)
    expect(facts.totalTokens).toBe(120 + 36)
  })

  it('审批问询按 tool 保序;callId → tool/call 的 turn 归属(无 callId 无轮次)', () => {
    expect(facts.approvalsAsked).toEqual([
      { toolName: 'shell', callId: 'c1', turn: 1 },
      { toolName: 'shell', callId: 'c2', turn: 2 },
      { toolName: 'write' },
    ])
  })

  it('最终回答=最后一条非空助手文本;每轮保留该轮最后一条(双包裹层与缺轮次容忍)', () => {
    expect(facts.finalAnswerText).toBe('第二轮回复')
    // 无显式 turn 的消息归当前轮(第 1 轮最后一条),后一条不再改写第 1 轮。
    expect(facts.finalAnswerByTurn.get(1)).toBe('无轮次包裹的回复')
    expect(facts.finalAnswerByTurn.get(2)).toBe('第二轮回复')
  })

  it('事件字段缺失/类型不对 → 静默跳过,不抛异常', () => {
    const broken = buildBusinessRuleFacts([
      { type: 'turn/start', data: null },
      { type: 'approval/asked', data: { callId: 7 } },
      { type: 'assistant/message', data: { message: { content: [{ type: 'text' }, { type: 'image' }] } } },
    ])
    expect(broken).toMatchObject({ turns: 0, totalTokens: 0, approvalsAsked: [], finalAnswerText: '' })
  })
})

describe('runBusinessRule', () => {
  const facts = buildBusinessRuleFacts(EVENTS)

  it('approval_flow:会话口径按 tool 计数 ≥ minCount', () => {
    const metric = ruleOf({ trajectory: { approvalFlow: { tool: 'shell', minCount: 2 } } })
    const result = runBusinessRule(metric, facts)
    expect(result).toMatchObject({ status: 'ok', value: true })
    expect(result.rationale).toContain('审批问询 2 次（要求 ≥ 2，工具 shell；整条会话）')
    const strict = runBusinessRule(ruleOf({ trajectory: { approvalFlow: { tool: 'shell', minCount: 3 } } }), facts)
    expect(strict.value).toBe(false)
  })

  it('approval_flow 单轮:只计该轮问询;无 callId 的问询不计入单轮', () => {
    const metric = ruleOf({ scope: 'turn', trajectory: { approvalFlow: { tool: 'shell', minCount: 1 } } })
    expect(runBusinessRule(metric, facts, 2).value).toBe(true)
    expect(runBusinessRule(metric, facts, 2).rationale).toContain('第 2 轮')
    const loose = ruleOf({ scope: 'turn', trajectory: { approvalFlow: { tool: 'write', minCount: 1 } } })
    expect(runBusinessRule(loose, facts, 2).value).toBe(false)
  })

  it('answer:会话口径看最终回答;命中禁语即未过并列出命中词', () => {
    const pass = runBusinessRule(ruleOf({ answer: { notContains: ['稍等', '马上'] } }), facts)
    expect(pass).toMatchObject({ status: 'ok', value: true })
    expect(pass.rationale).toBe('禁语未出现（整条会话）')
    const fail = runBusinessRule(ruleOf({ answer: { notContains: ['第二轮'] } }), facts)
    expect(fail.value).toBe(false)
    expect(fail.rationale).toContain('禁语命中：第二轮')
  })

  it('answer 单轮:无该轮回复 → not_applicable(不伪造成未过);有则看该轮文本', () => {
    const metric = ruleOf({ scope: 'turn', answer: { notContains: ['包裹'] } })
    expect(runBusinessRule(metric, facts, 1)).toMatchObject({ status: 'ok', value: false })
    // 同一禁语在第 2 轮文本里不出现 → 通过(证明按轮取文本,不是复用会话尾答)。
    expect(runBusinessRule(metric, facts, 2)).toMatchObject({ status: 'ok', value: true })
    expect(runBusinessRule(ruleOf({ scope: 'turn', answer: { notContains: ['x'] } }), facts, 9))
      .toMatchObject({ status: 'not_applicable', value: null })
  })

  it('budget:轮数与计费 token 双上限;超一项即未过,理由写实际/上限', () => {
    const ok = runBusinessRule(ruleOf({ budget: { maxTurns: 2, maxTokens: 156 } }), facts)
    expect(ok).toMatchObject({ status: 'ok', value: true })
    expect(ok.rationale).toBe('实际 2 轮 / 156 tokens（上限 2 轮 / 156 tokens）')
    expect(runBusinessRule(ruleOf({ budget: { maxTurns: 1, maxTokens: 999 } }), facts).value).toBe(false)
    expect(runBusinessRule(ruleOf({ budget: { maxTurns: 9, maxTokens: 155 } }), facts).value).toBe(false)
  })

  it('形态缺失 → not_applicable(防御;校验器不会放行)', () => {
    expect(runBusinessRule(ruleOf({}), facts)).toMatchObject({ status: 'not_applicable', value: null })
  })
})

describe('守卫与表单', () => {
  it('isBusinessRuleMetric 只认规则形态;businessFormOf 给列表徽标细分', () => {
    expect(isBusinessRuleMetric(ruleOf({ answer: { notContains: ['x'] } }))).toBe(true)
    expect(businessFormOf(ruleOf({ trajectory: { approvalFlow: { tool: 'shell', minCount: 1 } } }))).toBe('approval')
    expect(businessFormOf(ruleOf({ answer: { notContains: ['x'] } }))).toBe('answer')
    expect(businessFormOf(ruleOf({ budget: { maxTurns: 1, maxTokens: 1 } }))).toBe('budget')
    const rubric = ruleOf({ judge: { window: { maxSteps: 3 }, allowSkip: true, minScore: 0.5, criteria: [{ text: 'x', weight: 1, critical: false }] } })
    expect(isBusinessRuleMetric(rubric)).toBe(false)
    expect(businessFormOf(rubric)).toBe('judge')
  })
})
