/** hitl.yaml 加载与校验 + 分档裁决测试(设计文档 08 §6.1/§6.3、13 号 §4)。 */
import { describe, expect, it } from 'vitest'
import { HitlPolicy, InteractConfigError } from '../src/index.ts'

const EVENT_HITL = `
pack: event-planning
default_grade: R2
on_no_answer: escalate
rules:
  - id: draft-docs
    grade: R1
    tools: ['write_file', 'edit_file', 'apply_patch']
    reason: '工作区内可逆写,静默+事后 diff 卡片'
  - id: readonly-lookup
    grade: R0
    tools: ['grep_*', 'glob', 'read_file']
  - id: external-send
    grade: R2
    tools: ['feishu_send*']
    args_contains: ['群公告']
    reason: '对外发射需确认'
  - id: payment-redline
    grade: R3
    tools: ['pay_*', 'contract_sign']
    args_contains: ['付款', '签署']
    reason: '预算红线:对外付款/合同签署需人工复核'
    escalate_to: ['finance-lead']
    cooling_period_sec: 300
    double_confirm: true
    on_no_answer: suspend
`

describe('HitlPolicy.parse 校验', () => {
  it('合法文档全字段归一(pack/default/on_no_answer/R3 专属控制)', () => {
    const policy = HitlPolicy.parse(EVENT_HITL)
    expect(policy.document.pack).toBe('event-planning')
    expect(policy.document.defaultGrade).toBe('R2')
    expect(policy.document.onNoAnswer).toBe('escalate')
    expect(policy.document.rules).toHaveLength(4)
    const payment = policy.ruleById('payment-redline')
    expect(payment?.grade).toBe('R3')
    expect(payment?.escalateTo).toEqual(['finance-lead'])
    expect(payment?.coolingPeriodSec).toBe(300)
    expect(payment?.doubleConfirm).toBe(true)
    expect(payment?.onNoAnswer).toBe('suspend')
    const draft = policy.ruleById('draft-docs')
    expect(draft?.onNoAnswer).toBe('escalate')
    expect(draft?.escalateTo).toEqual([])
    expect(draft?.coolingPeriodSec).toBe(0)
    expect(draft?.doubleConfirm).toBe(false)
  })

  it('缺 default_grade 拒绝(fail-closed)', () => {
    expect(() => HitlPolicy.parse('rules: []')).toThrow(InteractConfigError)
  })

  it('default_grade 只允许 R2|R3——R0/R1 是放行漏洞,解析期拒绝', () => {
    expect(() => HitlPolicy.parse('default_grade: R0\nrules: []')).toThrow(/default_grade/)
    expect(() => HitlPolicy.parse('default_grade: R1\nrules: []')).toThrow(/default_grade/)
    expect(() => HitlPolicy.parse('default_grade: R4\nrules: []')).toThrow(/default_grade/)
  })

  it('未知顶层键/规则键拒绝(捕捉 tool→tools 类笔误)', () => {
    expect(() => HitlPolicy.parse('default_grade: R2\nunknown: 1\nrules: []')).toThrow(/unknown/)
    expect(() => HitlPolicy.parse('default_grade: R2\nrules:\n  - id: x\n    grade: R1\n    tool: ["a"]')).toThrow(/tool/)
  })

  it('非法 on_no_answer 枚举拒绝', () => {
    expect(() => HitlPolicy.parse('default_grade: R2\non_no_answer: ignore\nrules: []')).toThrow(/on_no_answer/)
  })

  it('重复规则 id 拒绝', () => {
    const yaml = [
      'default_grade: R2',
      'rules:',
      '  - { id: dup, grade: R1, tools: ["a"] }',
      '  - { id: dup, grade: R2, tools: ["b"] }',
    ].join('\n')
    expect(() => HitlPolicy.parse(yaml)).toThrow(/重复/)
  })

  it('R3 专属字段出现在 R0-R2 条目拒绝', () => {
    const base = 'default_grade: R2\nrules:\n  - id: x\n    grade: R1\n    tools: ["a"]\n'
    expect(() => HitlPolicy.parse(`${base}    escalate_to: ["boss"]`)).toThrow(/R3/)
    expect(() => HitlPolicy.parse(`${base}    cooling_period_sec: 60`)).toThrow(/R3/)
    expect(() => HitlPolicy.parse(`${base}    double_confirm: true`)).toThrow(/R3/)
  })

  it('tools 空列表 / cooling_period_sec 非正整数拒绝', () => {
    expect(() => HitlPolicy.parse('default_grade: R2\nrules:\n  - { id: x, grade: R1, tools: [] }')).toThrow(/tools/)
    expect(() => HitlPolicy.parse('default_grade: R2\nrules:\n  - { id: x, grade: R3, tools: ["a"], cooling_period_sec: 0 }')).toThrow(/cooling_period_sec/)
    expect(() => HitlPolicy.parse('default_grade: R2\nrules:\n  - { id: x, grade: R3, tools: ["a"], cooling_period_sec: 1.5 }')).toThrow(/cooling_period_sec/)
  })

  it('非合法 YAML 拒绝', () => {
    expect(() => HitlPolicy.parse('::::not yaml')).toThrow(InteractConfigError)
  })
})

describe('HitlPolicy.gradeFor 分档裁决', () => {
  const policy = HitlPolicy.parse(EVENT_HITL)

  it('R0 只读:glob 前缀命中(grep_file/grep_repo)', () => {
    expect(policy.gradeFor({ name: 'grep_file' }).grade).toBe('R0')
    expect(policy.gradeFor({ name: 'grep_repo', arguments: { q: 'x' } }).grade).toBe('R0')
  })

  it('R1 可逆写:工具名精确命中', () => {
    expect(policy.gradeFor({ name: 'write_file' }).grade).toBe('R1')
  })

  it('R2 args_contains:工具名命中但参数不含子串 → 不命中该规则,回落 default_grade', () => {
    const decision = policy.gradeFor({ name: 'feishu_send_message', arguments: { to: 'user_1', text: 'hi' } })
    expect(decision.grade).toBe('R2')
    expect(decision.rule).toBeUndefined()
    expect(decision.reason).toContain('default_grade')
  })

  it('R2 args_contains:参数含子串命中(嵌套参数稳定串化后 includes)', () => {
    const decision = policy.gradeFor({ name: 'feishu_send_message', arguments: { body: { text: '更新群公告:年会' } } })
    expect(decision.grade).toBe('R2')
    expect(decision.rule?.id).toBe('external-send')
  })

  it('最高档优先:write_file 同时命中 R1 与含「付款」参数的 R3 规则时取 R3', () => {
    const yaml = `
default_grade: R2
rules:
  - { id: writable, grade: R1, tools: ['*'] }
  - { id: pay-any-tool, grade: R3, tools: ['*'], args_contains: ['付款'] }
`
    const merged = HitlPolicy.parse(yaml)
    expect(merged.gradeFor({ name: 'write_file', arguments: { note: '供应商付款' } }).grade).toBe('R3')
    expect(merged.gradeFor({ name: 'write_file', arguments: { note: '草稿' } }).grade).toBe('R1')
  })

  it('R3 命中带出 escalate/cooling/doubleConfirm 与逐条 on_no_answer', () => {
    const decision = policy.gradeFor({ name: 'pay_order', arguments: { memo: '场地尾款付款' } })
    expect(decision.grade).toBe('R3')
    expect(decision.rule?.id).toBe('payment-redline')
    expect(decision.rule?.escalateTo).toEqual(['finance-lead'])
    expect(decision.rule?.onNoAnswer).toBe('suspend')
  })

  it('未命中任何规则回落 default_grade(且 reason 说明 fail-closed)', () => {
    const decision = policy.gradeFor({ name: 'unknown_tool' })
    expect(decision.grade).toBe('R2')
    expect(decision.rule).toBeUndefined()
  })
})
