/**
 * metrics.yaml 解析(§9.3/§9.5):语法/结构/条目校验失败一律带中文原因,
 * 序列化 → 解析往返保内容(键序与引号由 business-metrics 用例钉住)。
 */
import { describe, expect, it } from 'vitest'
import { EMPTY_BUSINESS_FILE, serializeBusinessMetrics, type BusinessMetric } from '../src/business-metrics.ts'
import { parseBusinessMetrics, parseBusinessMetricsOrEmpty } from '../src/business-yaml.ts'

const RUBRIC: BusinessMetric = {
  key: 'reply-quality',
  name: '回复质量',
  description: '客服回复需给结论',
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
      { text: '出现空话', weight: -1, critical: false },
    ],
  },
}

const RULE: BusinessMetric = {
  key: 'no-hedge',
  name: '回复禁语',
  description: '',
  category: 'process',
  scope: 'turn',
  gating: false,
  enabled: false,
  version: 1,
  answer: { notContains: ['稍等', '马上'] },
}

describe('parseBusinessMetrics', () => {
  it('序列化 → 解析往返:条目内容不变(版本/停用/细则)', () => {
    const file = { version: 4, updatedAt: '2026-11-25T02:00:00.000Z', updatedBy: 'alice', metrics: [RUBRIC, RULE] }
    const parsed = parseBusinessMetrics(serializeBusinessMetrics(file))
    expect(parsed).toEqual({ ok: true, file })
  })

  it('缺省字段:updated_at/updated_by 空串、条目 version 缺省 1;未知键忽略', () => {
    const text = [
      'version: 0',
      'metrics:',
      '  - key: lean-budget',
      '    name: 预算',
      '    category: outcome',
      '    scope: session',
      '    budget:',
      '      max_turns: 6',
      '      max_tokens: 30000',
      '    legacy_field: ignored',
      '',
    ].join('\n')
    const parsed = parseBusinessMetrics(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.file.updatedAt).toBe('')
    expect(parsed.file.updatedBy).toBe('')
    expect(parsed.file.metrics[0]).toMatchObject({ key: 'lean-budget', enabled: true, gating: false, version: 1 })
  })

  it('语法错误带行号;重复顶层键拒绝', () => {
    const broken = parseBusinessMetrics('version: 1\nmetrics:\n  - key: [unclosed\n')
    expect(broken.ok).toBe(false)
    if (!broken.ok) expect(broken.error).toMatch(/YAML 解析失败（第 \d+ 行）/)
    const duplicate = parseBusinessMetrics('version: 1\nversion: 2\n')
    expect(duplicate.ok).toBe(false)
  })

  it('文件级校验:顶层非对象 / version 非法 / metrics 非数组 / 条目非对象 / 重复指标键', () => {
    const cases: readonly [string, string][] = [
      ['- a\n- b\n', '顶层必须是对象'],
      ['metrics: []\n', 'version 必须是非负整数'],
      ['version: -1\n', 'version 必须是非负整数'],
      ['version: 0\nmetrics: {}\n', 'metrics 必须是数组'],
      ['version: 0\nmetrics:\n  - hello\n', '第 1 项必须是对象'],
      [
        'version: 0\nmetrics:\n  - key: no-hedge\n    name: a\n    category: outcome\n    scope: session\n'
          + '    answer:\n      not_contains:\n        - 稍等\n  - key: no-hedge\n    name: b\n    category: outcome\n'
          + '    scope: session\n    answer:\n      not_contains:\n        - 马上\n',
        '重复 key（no-hedge）',
      ],
    ]
    for (const [text, fragment] of cases) {
      const parsed = parseBusinessMetrics(text)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.error).toContain(fragment)
    }
  })

  it('条目校验失败带指标键与逐字段原因(snake_case → 校验器)', () => {
    const parsed = parseBusinessMetrics([
      'version: 0',
      'metrics:',
      '  - key: reply-quality',
      '    name: 回复质量',
      '    category: outcome',
      '    scope: session',
      '    judge:',
      '      window:',
      '        max_steps: 99',
      '      allow_skip: true',
      '      pass:',
      '        min_score: 0.8',
      '      criteria:',
      '        - text: 结论先行',
      '          weight: 1',
      '          critical: false',
      '',
    ].join('\n'))
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.error).toContain('指标「reply-quality」不合法')
      expect(parsed.error).toContain('1 到 50')
    }
  })
})

describe('parseBusinessMetricsOrEmpty', () => {
  it('缺失/空文本 → 空文件;损坏 → 空文件 + warning', () => {
    expect(parseBusinessMetricsOrEmpty(undefined)).toEqual({ file: EMPTY_BUSINESS_FILE })
    expect(parseBusinessMetricsOrEmpty('   ')).toEqual({ file: EMPTY_BUSINESS_FILE })
    const broken = parseBusinessMetricsOrEmpty('version: [\n')
    expect(broken.file).toEqual(EMPTY_BUSINESS_FILE)
    expect(broken.warning).toContain('YAML 解析失败')
  })
})
