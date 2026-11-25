/**
 * 金集回放评分(56 号 §5.7 P2-3d):事件流 → 与在线快照同一套规则指标/业务规则。
 *
 * 用合成事件钉三件事:①内置规则直接复用在线纯函数;②业务规则三态与跳过原因;
 * ③坏 YAML / 空事件如实报错(不伪造通过)。
 */
import { describe, expect, it } from 'vitest'
import { scoreReplayEvents, validateReplayMetrics } from '../src/replay.ts'

/** 一段最小可评事件流:一轮、一次审批放行后的工具调用、一条最终回复。 */
function events(input: { readonly failed?: boolean; readonly answer?: string; readonly outputTokens?: number } = {}) {
  const failed = input.failed === true
  const answer = input.answer ?? '已完成，等待验收。'
  return [
    { type: 'turn/start', seq: 1, time: 1_000, data: { turn: 1 } },
    { type: 'assistant/message', seq: 2, time: 1_100, data: {
      turn: 1,
      step: 1,
      message: { role: 'assistant', content: [{ type: 'text', text: answer }] },
      usage: { inputTokens: 100, outputTokens: input.outputTokens ?? 20 },
    } },
    { type: 'tool/call', seq: 3, time: 1_200, data: { turn: 1, step: 1, callId: 'c1', name: 'pay_deposit', arguments: '{"amount":1}' } },
    { type: 'approval/asked', seq: 4, time: 1_300, data: { id: 'a1', toolName: 'pay_deposit', callId: 'c1' } },
    { type: 'approval/decided', seq: 5, time: 1_400, data: { id: 'a1', outcome: 'allowed-once' } },
    { type: 'tool/result', seq: 6, time: 1_500, data: {
      turn: 1,
      step: 1,
      message: { role: 'tool', content: [{ type: 'text', text: failed ? '执行失败' : 'ok' }], toolCallId: 'c1' },
      ...failed ? { error: { name: 'Boom', code: 'E_BOOM' } } : {},
    } },
    { type: 'turn/end', seq: 7, time: 1_600, data: { turn: 1, reason: { kind: 'finish' } } },
  ]
}

const METRICS_YAML = `version: 4
metrics:
  - key: pay-approval
    name: 付款审批
    description: 付款前必须有审批问询
    category: process
    scope: session
    gating: true
    enabled: true
    version: 1
    trajectory:
      approval_flow:
        tool: pay_deposit
        min_count: 1
  - key: no-guarantee
    name: 回复禁语
    description: 最终回复不得承诺结果
    category: process
    scope: session
    gating: false
    enabled: true
    version: 1
    answer:
      not_contains: [保证]
  - key: token-budget
    name: Token 预算
    description: 整条会话 token 上限
    category: process
    scope: session
    gating: false
    enabled: true
    version: 1
    budget:
      max_turns: 3
      max_tokens: 100
  - key: judge-reply
    name: 回复质量
    description: 裁判型指标
    category: outcome
    scope: session
    gating: false
    enabled: true
    version: 1
    judge:
      window:
        max_steps: 5
      allow_skip: true
      pass:
        min_score: 0.8
      criteria:
        - text: 回答完整
          weight: 1
          critical: true
  - key: per-turn
    name: 单轮禁语
    description: 逐轮口径
    category: process
    scope: turn
    gating: false
    enabled: true
    version: 1
    answer:
      not_contains: [糟糕]
  - key: switched-off
    name: 停用规则
    description: 已停用
    category: process
    scope: session
    gating: false
    enabled: false
    version: 1
    answer:
      not_contains: [废]
`

describe('scoreReplayEvents:内置规则层', () => {
  it('无异常事件 → 复用在线规则指标,结论 pass(结果类未评)', () => {
    const reply = scoreReplayEvents({ sessionId: 'case-1', events: events() })
    expect(reply.ok).toBe(true)
    if (!reply.ok) return
    expect(reply.score.rules.verdict.level).toBe('pass')
    const calls = reply.score.rules.metrics.find(metric => metric.key === 'process.tool_calls')
    expect(calls?.display).toBe('1 次')
    const failures = reply.score.rules.metrics.find(metric => metric.key === 'process.tool_failures')
    expect(failures?.pass).toBe(true)
    expect(reply.score.business).toEqual([])
    expect(reply.score.metricsVersion).toBeNull()
  })

  it('工具失败 → 结论 warn,失败项进入未过判定', () => {
    const reply = scoreReplayEvents({ sessionId: 'case-2', events: events({ failed: true }) })
    expect(reply.ok).toBe(true)
    if (!reply.ok) return
    expect(reply.score.rules.verdict.level).toBe('warn')
    const failures = reply.score.rules.metrics.find(metric => metric.key === 'process.tool_failures')
    expect(failures?.value).toBe(1)
    expect(failures?.pass).toBe(false)
    expect(reply.score.rules.issues.some(issue => issue.kind === 'tool_error')).toBe(true)
  })

  it('空事件 → 如实报错,不产出空分数', () => {
    const reply = scoreReplayEvents({ sessionId: 'case-empty', events: [] })
    expect(reply).toEqual({ ok: false, error: '没有会话事件可评。' })
  })
})

describe('scoreReplayEvents:业务规则层与跳过', () => {
  it('三态齐全:审批通过 / 禁语未过 / 预算未过;裁判型、逐轮、停用被跳过', () => {
    const reply = scoreReplayEvents({
      sessionId: 'case-3',
      events: events({ answer: '我们保证搞定，已提交。', outputTokens: 80 }),
      metricsYaml: METRICS_YAML,
    })
    expect(reply.ok).toBe(true)
    if (!reply.ok) return
    expect(reply.score.metricsVersion).toBe(4)
    expect(reply.score.business.map(metric => [metric.key, metric.status, metric.value])).toEqual([
      ['pay-approval', 'ok', true],
      ['no-guarantee', 'ok', false],
      ['token-budget', 'ok', false],
    ])
    expect(reply.score.business[1]?.rationale).toContain('禁语命中：保证')
    expect(reply.score.business[2]?.rationale).toContain('180 tokens')
    expect(reply.score.skipped.map(metric => [metric.key, metric.reason])).toEqual([
      ['judge-reply', '裁判型（回放无模型）'],
      ['per-turn', '逐轮口径（回放只算整条会话）'],
      ['switched-off', '已停用'],
    ])
  })

  it('坏 YAML → ok:false 带中文原因;预校验同源', () => {
    const bad = 'version: 0\nmetrics: ['
    const reply = scoreReplayEvents({ sessionId: 'case-4', events: events(), metricsYaml: bad })
    expect(reply.ok).toBe(false)
    if (!reply.ok) expect(reply.error).toContain('YAML 解析失败')
    const validation = validateReplayMetrics(bad)
    expect(validation.ok).toBe(false)
    if (!validation.ok) expect(validation.error).toContain('YAML 解析失败')
  })

  it('合法 YAML 预校验回版本与条目数', () => {
    const validation = validateReplayMetrics(METRICS_YAML)
    expect(validation).toEqual({ ok: true, version: 4, count: 6 })
  })
})
