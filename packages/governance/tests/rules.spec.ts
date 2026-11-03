import { describe, expect, it } from 'vitest'
import { GovernanceConfigError, RuleEngine, serializeArgs } from '../src/index.ts'

const POLICY = `
# 基线策略样例
default: ask
rules:
  - id: deny-rm-rf
    effect: deny
    tools: ['shell*', 'bash*']
    argsContains: ['rm -rf']
    reason: '破坏性命令'
  - id: deny-force-push
    effect: deny
    tools: ['shell']
    argsContains: ['push --force']
  - id: allow-readonly
    effect: allow
    tools: ['read_*', 'glob_*', 'grep_*']
  - id: ask-payment
    effect: ask
    tools: ['*']
    argsContains: ['payment', '打款']
    reason: '资金动作需确认'
`

describe('规则引擎:解析与校验(fail-closed)', () => {
  it('解析合法策略并暴露只读视图', () => {
    const engine = RuleEngine.parse(POLICY)
    expect(engine.policy.default).toBe('ask')
    expect(engine.policy.rules).toHaveLength(4)
    expect(engine.policy.rules[0]?.id).toBe('deny-rm-rf')
  })

  it('default 只允许 ask/deny:显式 allow 在解析期被拒绝(fail-closed)', () => {
    expect(() => RuleEngine.parse('default: allow\nrules: []')).toThrow(GovernanceConfigError)
    expect(() => RuleEngine.parse('default: allow\nrules: []')).toThrow(/fail-closed/)
  })

  it('未写 default 时缺省为 ask', () => {
    expect(RuleEngine.parse('rules: []').policy.default).toBe('ask')
  })

  it('规则 id 重复被拒绝', () => {
    expect(() => RuleEngine.parse(`
rules:
  - { id: a, effect: deny, tools: ['x'] }
  - { id: a, effect: allow, tools: ['y'] }
`)).toThrow(GovernanceConfigError)
  })

  it('未知字段 / 非法 effect / 空 tools / 缺 rules 均被拒绝', () => {
    expect(() => RuleEngine.parse('rules: [{ id: a, effect: maybe, tools: ["x"] }]')).toThrow(/effect/)
    expect(() => RuleEngine.parse('rules: [{ id: a, effect: deny, tools: [] }]')).toThrow(/tools/)
    expect(() => RuleEngine.parse('rules: [{ id: a, effect: deny, tools: ["x"], extra: 1 }]')).toThrow(/未知字段/)
    expect(() => RuleEngine.parse('something: 1')).toThrow(/rules/)
  })

  it('YAML 语法错误抛 GovernanceConfigError 而非裸异常', () => {
    expect(() => RuleEngine.parse('rules: [unclosed')).toThrow(GovernanceConfigError)
  })
})

describe('规则引擎:glob 匹配', () => {
  const engine = RuleEngine.parse(`
rules:
  - { id: shell-any, effect: ask, tools: ['shell*'] }
  - { id: mcp-synology, effect: ask, tools: ['mcp__synology__*'] }
  - { id: exact, effect: allow, tools: ['read_file'] }
`)

  it('* 命中前缀族', () => {
    expect(engine.evaluate('shell_exec').matched.map(r => r.id)).toEqual(['shell-any'])
    expect(engine.evaluate('mcp__synology__fs_read').matched.map(r => r.id)).toEqual(['mcp-synology'])
    expect(engine.evaluate('mcp__weknora__ask').matched).toEqual([])
  })

  it('无通配符的字面量精确匹配', () => {
    expect(engine.evaluate('read_file').decision).toBe('allow')
    expect(engine.evaluate('read_file_v2').decision).toBe('ask') // 未命中 → 默认 ask
  })
})

describe('规则引擎:参数子串匹配', () => {
  const engine = RuleEngine.parse(`
rules:
  - id: deny-secret
    effect: deny
    tools: ['*']
    argsContains: ['AKID-----BEGIN', 'sk-secret']
`)

  it('对象参数按稳定串化匹配(嵌套字段也会命中)', () => {
    const evaluation = engine.evaluate('web_fetch', { url: 'https://x', headers: { Authorization: 'Bearer sk-secret' } })
    expect(evaluation.decision).toBe('deny')
    expect(evaluation.decidedRule?.id).toBe('deny-secret')
  })

  it('字符串参数直接子串匹配', () => {
    expect(engine.evaluate('shell', 'cat AKID-----BEGIN.key').decision).toBe('deny')
  })

  it('argsContains 多值 OR:任一命中即命中', () => {
    expect(engine.evaluate('shell', { cmd: 'echo sk-secret' }).decision).toBe('deny')
    expect(engine.evaluate('shell', { cmd: 'ls' }).decision).toBe('ask')
  })

  it('无 argsContains 的规则对任意参数成立', () => {
    const wide = RuleEngine.parse("rules: [{ id: all, effect: deny, tools: ['shell'] }]")
    expect(wide.evaluate('shell', { anything: 1 }).decision).toBe('deny')
  })

  it('serializeArgs:对象键序无关,原始 JSON 字符串原样透传(dsh tool/call 事件口径)', () => {
    expect(serializeArgs({ b: 1, a: 'x' })).toBe('{"a":"x","b":1}')
    expect(serializeArgs('{"cmd":"ls"}')).toBe('{"cmd":"ls"}')
  })
})

describe('规则引擎:优先级 deny > ask > allow > default', () => {
  const engine = RuleEngine.parse(POLICY)

  it('deny 压过 allow 与 ask(即便 deny 排在最后)', () => {
    const denyLast = RuleEngine.parse(`
rules:
  - { id: allow-all-shell, effect: allow, tools: ['shell*'] }
  - { id: ask-shell, effect: ask, tools: ['shell*'] }
  - { id: deny-rm, effect: deny, tools: ['shell*'], argsContains: ['rm -rf'] }
`)
    const evaluation = denyLast.evaluate('shell', { cmd: 'rm -rf /' })
    expect(evaluation.decision).toBe('deny')
    expect(evaluation.decidedRule?.id).toBe('deny-rm')
    expect(evaluation.matched).toHaveLength(3) // 命中全集仍完整(审计/卡片用)
  })

  it('ask 压过 allow', () => {
    const both = RuleEngine.parse(`
rules:
  - { id: allow-tool, effect: allow, tools: ['pay_tool'] }
  - { id: ask-money, effect: ask, tools: ['pay_tool'], argsContains: ['payment'] }
`)
    expect(both.evaluate('pay_tool', { action: 'payment' }).decision).toBe('ask')
    expect(both.evaluate('pay_tool', { action: 'check' }).decision).toBe('allow')
  })

  it('未命中任何规则 → fail-closed 默认 ask(且标记 isDefault)', () => {
    const evaluation = engine.evaluate('unknown_tool', {})
    expect(evaluation.decision).toBe('ask')
    expect(evaluation.isDefault).toBe(true)
    expect(evaluation.decidedRule).toBeUndefined()
    expect(evaluation.reason).toContain('fail-closed')
  })

  it('显式 default: deny 生效', () => {
    const denyDefault = RuleEngine.parse('default: deny\nrules: []')
    expect(denyDefault.evaluate('anything').decision).toBe('deny')
  })
})

describe('规则引擎:pre-execute 决策映射', () => {
  const engine = RuleEngine.parse(POLICY)

  it('allow/deny/ask 三形态与 dsh PreToolDecision 对齐', () => {
    expect(engine.preExecuteDecision({ name: 'read_file', arguments: { path: '/tmp' } })).toEqual({ kind: 'allow' })
    expect(engine.preExecuteDecision({ name: 'shell', arguments: { cmd: 'rm -rf /tmp/x' } })).toEqual({
      kind: 'deny',
      reason: expect.stringContaining('deny-rm-rf') as unknown,
    })
    const ask = engine.preExecuteDecision({ name: 'pay_tool', arguments: { action: 'payment' } })
    expect(ask.kind).toBe('ask')
    expect(ask).toHaveProperty('reason')
  })

  it('默认 ask(未命中规则)不带 reason 键(exactOptionalPropertyTypes 契约)', () => {
    const decision = engine.preExecuteDecision({ name: 'unknown_tool' })
    expect(decision).toEqual({ kind: 'ask' })
    expect('reason' in decision).toBe(false)
  })
})
