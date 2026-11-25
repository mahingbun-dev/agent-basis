/**
 * 业务指标定义面:校验规则(§9.5)、YAML 序列化键序与引号规则(§9.4)、
 * 文件条目 → 保存端点输入的往返。
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_BUSINESS_FILE, businessKindOf, businessYamlHeader, metricInputOf, serializeBusinessMetrics,
  validateBusinessMetric, type BusinessMetric, type BusinessMetricsFile,
} from '../src/business-metrics.ts'

/** 合法的 rubric 输入(保存端点同形:外层 camelCase,嵌套 snake_case). */
function rubricInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'reply-quality',
    name: '回复质量',
    description: '',
    category: 'outcome',
    scope: 'session',
    gating: false,
    judge: {
      window: { max_steps: 12 },
      allow_skip: true,
      pass: { min_score: 0.8 },
      criteria: [
        { text: '先给出结论', weight: 2, critical: false },
        { text: '出现「马上就好的」空话', weight: -1, critical: false },
      ],
    },
    ...overrides,
  }
}

/** 校验失败的 error 文案(成功即抛,避免测试静默). */
function errorOf(input: unknown, options: { readonly existing?: BusinessMetric } = {}): string {
  const parsed = validateBusinessMetric(input, options)
  if (parsed.ok) throw new Error('预期校验失败，实际通过')
  return parsed.error
}

/** 纯规则条目基线(无 judge;exactOptionalPropertyTypes 下不能写 judge: undefined). */
const RULE_BASE: BusinessMetric = {
  key: 'rule-base',
  name: '规则基线',
  description: '',
  category: 'process',
  scope: 'turn',
  gating: false,
  enabled: true,
  version: 1,
}

const RUBRIC: BusinessMetric = {
  key: 'reply-quality',
  name: '回复质量',
  description: '客服回复需给结论并致歉',
  category: 'outcome',
  scope: 'session',
  gating: true,
  enabled: true,
  version: 2,
  judge: {
    window: { maxSteps: 12 },
    allowSkip: true,
    minScore: 0.8,
    criteria: [
      { text: '先给出结论', weight: 2, critical: true },
      { text: '出现「马上就好的」空话', weight: -1, critical: false },
    ],
  },
}

describe('validateBusinessMetric', () => {
  it('rubric 合法输入 → 规范化条目(缺省 enabled=true / gating=false / version=1)', () => {
    const parsed = validateBusinessMetric(rubricInput())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.metric).toMatchObject({ key: 'reply-quality', enabled: true, gating: false, version: 1 })
    expect(parsed.metric.judge?.criteria).toHaveLength(2)
    expect(parsed.metric.judge?.criteria[1]).toEqual({ text: '出现「马上就好的」空话', weight: -1, critical: false })
  })

  it('已保存条目再存 → 条目版本 +1;标识不可改', () => {
    const parsed = validateBusinessMetric(rubricInput({ gating: true }), { existing: RUBRIC })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.metric.version).toBe(3)
    expect(parsed.metric.gating).toBe(true)
    expect(errorOf(rubricInput({ key: 'other-key' }), { existing: RUBRIC })).toContain('标识不可修改')
  })

  it('标识规则:非法字符 / 过短 / 过长', () => {
    expect(errorOf(rubricInput({ key: 'Reply-Quality' }))).toContain('标识必须匹配')
    expect(errorOf(rubricInput({ key: 'a' }))).toContain('标识必须匹配')
    expect(errorOf(rubricInput({ key: `a${'b'.repeat(40)}` }))).toContain('标识必须匹配')
    expect(errorOf(rubricInput({ key: '-lead' }))).toContain('标识必须匹配')
  })

  it('名称必填 ≤20 字、说明 ≤120 字、类别/范围枚举', () => {
    expect(errorOf(rubricInput({ name: ' ' }))).toBe('名称不能为空。')
    expect(errorOf(rubricInput({ name: '名'.repeat(21) }))).toContain('不能超过 20 字')
    expect(errorOf(rubricInput({ description: '说'.repeat(121) }))).toContain('不能超过 120 字')
    expect(errorOf(rubricInput({ category: 'quality' }))).toContain('类别只能是')
    expect(errorOf(rubricInput({ scope: 'global' }))).toContain('范围只能是')
    expect(errorOf(rubricInput({ gating: 'yes' }))).toContain('gating 必须是布尔值')
  })

  it('判定方式恰好一种:judge 与规则不可同时/都缺/多个规则', () => {
    expect(errorOf(rubricInput({ answer: { not_contains: ['稍等'] } }))).toContain('不能同时出现')
    expect(errorOf(rubricInput({ judge: undefined }))).toContain('必须且只能选择一种判定方式')
    expect(errorOf(rubricInput({
      judge: undefined,
      answer: { not_contains: ['稍等'] },
      budget: { max_turns: 8, max_tokens: 20_000 },
    }))).toContain('必须且只能选择一种判定方式')
  })

  it('rubric 字段区间:窗口 / 通过线 / allow_skip / model', () => {
    const judge = (patch: Record<string, unknown>): Record<string, unknown> => ({
      ...rubricInput().judge as Record<string, unknown>,
      ...patch,
    })
    expect(errorOf(rubricInput({ judge: judge({ window: { max_steps: 0 } }) }))).toContain('1 到 50')
    expect(errorOf(rubricInput({ judge: judge({ window: { max_steps: 51 } }) }))).toContain('1 到 50')
    expect(errorOf(rubricInput({ judge: judge({ pass: { min_score: 1.1 } }) }))).toContain('0 到 1')
    expect(errorOf(rubricInput({ judge: judge({ allow_skip: 'yes' }) }))).toContain('allow_skip 必须是布尔值')
    expect(errorOf(rubricInput({ judge: judge({ model: ' ' }) }))).toContain('model 必须是非空文本')
    expect(errorOf(rubricInput({ judge: judge({ criteria: [] }) }))).toContain('至少需要一条判定条件')
  })

  it('细则:权重 -5..5 非零、至少一条正权重、critical 布尔、文本必填', () => {
    const withCriteria = (criteria: unknown): Record<string, unknown> => ({
      ...rubricInput().judge as Record<string, unknown>,
      criteria,
    })
    expect(errorOf(rubricInput({ judge: withCriteria([{ text: 'x', weight: 0, critical: false }]) }))).toContain('非零数')
    expect(errorOf(rubricInput({ judge: withCriteria([{ text: 'x', weight: 6, critical: false }]) }))).toContain('-5 到 5')
    expect(errorOf(rubricInput({ judge: withCriteria([{ text: 'x', weight: -1, critical: false }]) })))
      .toContain('至少需要一条正权重')
    expect(errorOf(rubricInput({ judge: withCriteria([{ text: '', weight: 1, critical: false }]) }))).toContain('内容不能为空')
    expect(errorOf(rubricInput({ judge: withCriteria([{ text: 'x', weight: 1, critical: 'y' }]) }))).toContain('critical 必须是布尔值')
  })

  it('规则型:审批流 / 禁语 / 预算 各自可存且参数校验', () => {
    const flow = validateBusinessMetric({
      ...rubricInput({ judge: undefined, trajectory: { approval_flow: { tool: 'shell', min_count: 2 } } }),
    })
    expect(flow.ok).toBe(true)
    if (flow.ok) expect(flow.metric.trajectory?.approvalFlow).toEqual({ tool: 'shell', minCount: 2 })
    expect(errorOf(rubricInput({ judge: undefined, trajectory: { approval_flow: { tool: ' ', min_count: 1 } } })))
      .toContain('tool 不能为空')
    expect(errorOf(rubricInput({ judge: undefined, trajectory: { approval_flow: { tool: 'shell', min_count: 0 } } })))
      .toContain('min_count 必须是正整数')

    const answer = validateBusinessMetric(rubricInput({ judge: undefined, answer: { not_contains: ['稍等', '马上'] } }))
    expect(answer.ok).toBe(true)
    if (answer.ok) expect(answer.metric.answer?.notContains).toEqual(['稍等', '马上'])
    expect(errorOf(rubricInput({ judge: undefined, answer: { not_contains: [] } }))).toContain('至少需要一个非空词条')
    expect(errorOf(rubricInput({ judge: undefined, answer: { not_contains: [' '] } }))).toContain('至少需要一个非空词条')

    const budget = validateBusinessMetric(rubricInput({ judge: undefined, budget: { max_turns: 6, max_tokens: 30_000 } }))
    expect(budget.ok).toBe(true)
    if (budget.ok) expect(budget.metric.budget).toEqual({ maxTurns: 6, maxTokens: 30_000 })
    expect(errorOf(rubricInput({ judge: undefined, budget: { max_turns: 0, max_tokens: 1 } }))).toContain('max_turns 必须是正整数')
    expect(errorOf(rubricInput({ judge: undefined, budget: { max_turns: 1, max_tokens: 0 } }))).toContain('max_tokens 必须是正整数')
  })
})

describe('serializeBusinessMetrics', () => {
  it('文件头三行 + 键序固定(§9.4):rubric 条目', () => {
    const file: BusinessMetricsFile = {
      version: 3,
      updatedAt: '2026-11-25T02:00:00.000Z',
      updatedBy: 'alice',
      metrics: [RUBRIC],
    }
    const text = serializeBusinessMetrics(file)
    expect(text).toBe([
      businessYamlHeader(file),
      'version: 3',
      "updated_at: '2026-11-25T02:00:00.000Z'",
      'updated_by: alice',
      'metrics:',
      '  - key: reply-quality',
      '    name: 回复质量',
      '    description: 客服回复需给结论并致歉',
      '    category: outcome',
      '    scope: session',
      '    gating: true',
      '    enabled: true',
      '    version: 2',
      '    judge:',
      '      window:',
      '        max_steps: 12',
      '      allow_skip: true',
      '      pass:',
      '        min_score: 0.8',
      '      criteria:',
      '        - text: 先给出结论',
      '          weight: 2',
      '          critical: true',
      '        - text: 出现「马上就好的」空话',
      '          weight: -1',
      '          critical: false',
      '',
    ].join('\n'))
    expect(text.split('\n')[0]).toBe('# 本文件由「设置 → 评测」生成；手改会在下次保存时被覆盖。')
    expect(text).toContain('# 版本：v3 · 更新于 2026-11-25T02:00:00.000Z · 更新者 alice')
  })

  it('空文件:metrics 写成 []', () => {
    expect(serializeBusinessMetrics(EMPTY_BUSINESS_FILE)).toContain('metrics:\n  []\n')
  })

  it('引号触发:数字开头 / 冒号 / true / 前后空白 / 单引号转义(单引号翻倍)', () => {
    const metric: BusinessMetric = {
      ...RUBRIC,
      key: 'reply-quality',
      name: '123',
      description: "客服: 别说 it's ok",
    }
    const text = serializeBusinessMetrics({ version: 1, updatedAt: '', updatedBy: '', metrics: [metric] })
    expect(text).toContain("    name: '123'")
    expect(text).toContain("    description: '客服: 别说 it''s ok'")
  })

  it('规则型三形态的键序(trajectory / answer / budget)', () => {
    const metrics: readonly BusinessMetric[] = [
      { ...RULE_BASE, key: 'need-approval', trajectory: { approvalFlow: { tool: 'shell', minCount: 2 } } },
      { ...RULE_BASE, key: 'no-hedge', answer: { notContains: ['稍等', '马上'] } },
      { ...RULE_BASE, key: 'lean-budget', budget: { maxTurns: 6, maxTokens: 30_000 } },
    ]
    const text = serializeBusinessMetrics({ version: 1, updatedAt: '', updatedBy: '', metrics })
    expect(text).toContain('    trajectory:\n      approval_flow:\n        tool: shell\n        min_count: 2\n')
    expect(text).toContain('    answer:\n      not_contains:\n        - 稍等\n        - 马上\n')
    expect(text).toContain('    budget:\n      max_turns: 6\n      max_tokens: 30000\n')
    expect(metrics.map(businessKindOf)).toEqual(['rule', 'rule', 'rule'])
  })

  it('metricInputOf 往返:条目 → 输入 → 再校验得到同内容(版本 +1)', () => {
    const rule: BusinessMetric = {
      ...RULE_BASE,
      key: 'no-hedge',
      answer: { notContains: ['稍等'] },
    }
    for (const metric of [RUBRIC, rule]) {
      const parsed = validateBusinessMetric(metricInputOf(metric), { existing: metric })
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(parsed.metric).toEqual({ ...metric, version: metric.version + 1 })
    }
  })
})
