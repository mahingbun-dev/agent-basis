import { describe, expect, it } from 'vitest'
import { SchemaError, loadPackCases, parseGoldenCase } from '../src/schema.ts'

const PACK = new URL('./fixtures/pack-mini/', import.meta.url).pathname

describe('parseGoldenCase:合法 case', () => {
  it('解析最小 case(仅必填字段)', () => {
    const doc = parseGoldenCase('id: a-1\nuser_input: 你好\n', 'memory://a.yaml')
    expect(doc.id).toBe('a-1')
    expect(doc.user_input).toBe('你好')
    expect(doc.tags).toEqual([])
    expect(doc.final_state).toEqual([])
    expect(doc.trajectory).toBeUndefined()
    expect(doc.budget).toBeUndefined()
    expect(doc.adapter).toBeUndefined()
  })

  it('解析全字段 case(四模式/审批/预算/终态三件套)', () => {
    const yaml = [
      'id: full-case',
      'description: 全字段',
      'user_input: 干活',
      'answer:',
      '  match: "^完成.*$"',
      'tags: [smoke, core]',
      'final_state:',
      '  - file_assert: {path: a.md, contains: hello, not_contains: secret}',
      '  - http_assert:',
      '      request: {tool: http_request, method: POST, path: /api, body_contains: x}',
      '      respond: {status: 201, body: ok}',
      '      assert: {status: 201, body_contains: ok}',
      '  - script: {command: ls, stdout_contains: a.md}',
      'trajectory:',
      '  mode: superset',
      '  calls: [a, b]',
      '  must_call: [a]',
      '  must_not_call: [c]',
      '  max_steps: 5',
      '  approval_flow: {tool: send, outcome: rejected, not_executed: true, min_count: 2}',
      'budget: {max_turns: 3, max_tokens: 9000}',
      'adapter: acp',
      'acp: {provider: deepseek-official, model: deepseek-v4-flash, timeout_seconds: 60}',
    ].join('\n')
    const doc = parseGoldenCase(yaml, 'memory://full.yaml')
    expect(doc.answer?.match).toBe('^完成.*$')
    expect(doc.tags).toEqual(['smoke', 'core'])
    expect(doc.final_state).toHaveLength(3)
    expect(doc.final_state[0]).toEqual({ file_assert: { path: 'a.md', contains: 'hello', not_contains: 'secret' } })
    expect(doc.trajectory?.mode).toBe('superset')
    expect(doc.trajectory?.approval_flow).toEqual({ tool: 'send', outcome: 'rejected', not_executed: true, min_count: 2 })
    expect(doc.budget).toEqual({ max_turns: 3, max_tokens: 9000 })
    expect(doc.adapter).toBe('acp')
    expect(doc.acp?.provider).toBe('deepseek-official')
  })

  it('answer.contains 与 match 二选一即可', () => {
    const doc = parseGoldenCase('id: c\nuser_input: x\nanswer: {contains: 好}\n', 'm://c.yaml')
    expect(doc.answer?.contains).toBe('好')
  })
})

describe('parseGoldenCase:非法 case 抛 SchemaError', () => {
  const bad: [string, string, RegExp][] = [
    ['缺 user_input', 'id: a\n', /user_input 应为 非空字符串/],
    ['id 非法字符', 'id: Bad_Id!\nuser_input: x\n', /id 需匹配/],
    ['final_state 非数组', 'id: a\nuser_input: x\nfinal_state: {file_assert: {path: a}}\n', /final_state 应为 数组/],
    ['final_state 双键', 'id: a\nuser_input: x\nfinal_state:\n  - file_assert: {path: a}\n    script: {command: ls}\n', /恰好一个键/],
    ['终态未知键', 'id: a\nuser_input: x\nfinal_state:\n  - registry_probe: {}\n', /键应为/],
    ['file 路径逃逸', 'id: a\nuser_input: x\nfinal_state:\n  - file_assert: {path: ../etc/passwd}\n', /逃逸/],
    ['mode 非法', 'id: a\nuser_input: x\ntrajectory: {mode: fuzzy}\n', /mode 应为/],
    ['strict 缺 calls', 'id: a\nuser_input: x\ntrajectory: {mode: strict}\n', /需要 calls/],
    ['outcome 非法', 'id: a\nuser_input: x\ntrajectory:\n  approval_flow: {outcome: maybe}\n', /outcome 应为/],
    ['answer 空', 'id: a\nuser_input: x\nanswer: {ignore_case: true}\n', /至少一项/],
    ['answer 正则非法', 'id: a\nuser_input: x\nanswer: {match: "(["}\n', /合法正则/],
    ['tags 非字符串数组', 'id: a\nuser_input: x\ntags: [1, 2]\n', /非空字符串数组/],
    ['adapter 非法', 'id: a\nuser_input: x\nadapter: browser\n', /adapter 应为/],
    ['max_turns 负数', 'id: a\nuser_input: x\nbudget: {max_turns: -1}\n', /有限数/],
  ]

  for (const [name, yaml, pattern] of bad) {
    it(name, () => {
      expect(() => parseGoldenCase(yaml, 'm://bad.yaml')).toThrow(pattern)
    })
  }

  it('YAML 语法错误', () => {
    expect(() => parseGoldenCase('id: [unclosed\n', 'm://x.yaml')).toThrow(SchemaError)
  })
})

describe('loadPackCases:目录加载', () => {
  it('加载 pack-mini:6 个合法 case + 1 个 schema 违例文件', async () => {
    const { cases, loadErrors } = await loadPackCases(PACK)
    expect(cases.map(caseData => caseData.id).sort()).toEqual([
      'answer-budget-fail',
      'approval-redline',
      'script-check',
      'smoke-file-plan',
      'smoke-http-submit',
      'strict-trajectory',
    ])
    expect(loadErrors).toHaveLength(1)
    expect(loadErrors[0]?.file).toContain('broken-schema.yaml')
    expect(loadErrors[0]?.message).toMatch(/final_state 应为 数组/)
  })

  it('evals 目录不存在 → loadErrors(不抛)', async () => {
    const { cases, loadErrors } = await loadPackCases('/nonexistent-pack-dir')
    expect(cases).toEqual([])
    expect(loadErrors).toHaveLength(1)
    expect(loadErrors[0]?.message).toMatch(/无法读取/)
  })
})
