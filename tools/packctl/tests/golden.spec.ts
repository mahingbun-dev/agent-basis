/**
 * golden 加载器单测(07 号文档 §3.2 字段口径):loadGoldenCaseText 形态校验
 * 与 loadGoldenDir 目录级完整性(非空/重复 id),供 pack lint 与 @basis/evals 共用。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { loadGoldenCaseText, loadGoldenDir } from '../src/golden.ts'
import { makeTmpRoot } from './helpers.ts'

const tmp = makeTmpRoot('packctl-golden-')
afterAll(() => { tmp.cleanup() })

const GOOD = [
  'id: case-001',
  'user_input: |',
  '  100 人婚礼,预算 30 万,出完整策划案。',
  'tags: [策划案, 高预算]',
  'final_state:',
  '  file_assert: { path: "out/plan.docx", contains: ["流程", "预算"] }',
  'trajectory:',
  '  must_call: [budget_calc]',
  '  must_not_call: [send_email]',
  '  max_steps: 30',
  '  approval_flow: [budget_change]',
  'budget: { max_tokens: 200000, max_cost_cny: 1.0, cache_hit_rate_min: 0.7 }',
  'judge:',
  '  rubric: |',
  '    章节完整性与预算正确性',
  '',
].join('\n')

describe('loadGoldenCaseText', () => {
  it('完整 case 解析为规范形态(含全部四类断言口径)', () => {
    const { case: golden, issues } = loadGoldenCaseText(GOOD, 'evals/golden/case-001.yaml')
    expect(issues).toEqual([])
    expect(golden?.id).toBe('case-001')
    expect(golden?.trajectory?.must_not_call).toEqual(['send_email'])
    expect(golden?.final_state?.file_assert?.contains).toEqual(['流程', '预算'])
    expect(golden?.judge?.rubric).toContain('章节完整性')
  })

  it('YAML 解析失败 → GOLD002', () => {
    const { issues } = loadGoldenCaseText('id: [unclosed\n', 'evals/golden/case-x.yaml')
    expect(issues.map(f => f.code)).toContain('GOLD002')
  })

  it('缺 id 或 user_input → GOLD003;id 与文件名不一致 → GOLD004', () => {
    const noInput = GOOD.replace(/user_input: \|[\s\S]*?tags:/, 'tags:')
    expect(loadGoldenCaseText(noInput, 'evals/golden/case-001.yaml').issues.map(f => f.code)).toContain('GOLD003')

    const renamed = GOOD.replace('id: case-001', 'id: case-other')
    expect(loadGoldenCaseText(renamed, 'evals/golden/case-001.yaml').issues.map(f => f.code)).toContain('GOLD004')
  })

  it('trajectory 形态错误 → GOLD005;无任何断言 → GOLD006 warning', () => {
    const badTraj = GOOD.replace('must_call: [budget_calc]', 'must_call: budget_calc')
    expect(loadGoldenCaseText(badTraj, 'evals/golden/case-001.yaml').issues.map(f => f.code)).toContain('GOLD005')

    const bare = 'id: case-001\nuser_input: |\n  只有无断言输入\n'
    const { issues } = loadGoldenCaseText(bare, 'evals/golden/case-001.yaml')
    expect(issues.some(f => f.code === 'GOLD006' && f.severity === 'warning')).toBe(true)
    expect(issues.filter(f => f.severity === 'error')).toEqual([])
  })

  it('终态/轨迹四模式对齐 ai-evo:非法 mode 报错,合法 mode 通过', () => {
    const badMode = GOOD.replace('trajectory:', 'trajectory:\n  mode: weird')
    expect(loadGoldenCaseText(badMode, 'evals/golden/case-001.yaml').issues.map(f => f.code)).toContain('GOLD005')

    const okMode = GOOD.replace('trajectory:', 'trajectory:\n  mode: subset')
    expect(loadGoldenCaseText(okMode, 'evals/golden/case-001.yaml').issues.filter(f => f.severity === 'error')).toEqual([])
  })
})

describe('loadGoldenDir(目录级)', () => {
  const dir = join(tmp.root, 'golden')

  it('目录不存在 / 为空 → GOLD001', () => {
    expect(loadGoldenDir(join(tmp.root, 'nope'), 'evals/golden').findings.map(f => f.code)).toContain('GOLD001')
    mkdirSync(dir, { recursive: true })
    expect(loadGoldenDir(dir, 'evals/golden').findings.map(f => f.code)).toContain('GOLD001')
  })

  it('多条 case 加载;同 stem 的 .yaml/.yml 双文件 → 跨文件重复 id GOLD007', () => {
    writeFileSync(join(dir, 'case-001.yaml'), GOOD, 'utf8')
    writeFileSync(join(dir, 'case-002.yaml'), GOOD.replace('id: case-001', 'id: case-002'), 'utf8')
    const ok = loadGoldenDir(dir, 'evals/golden')
    expect(ok.cases.map(c => c.id).sort()).toEqual(['case-001', 'case-002'])
    expect(ok.findings).toEqual([])

    // .yml 与 .yaml 同 stem:两份都各自通过 id=stem 校验,id 却相同 → 注册表冲突。
    writeFileSync(join(dir, 'case-001.yml'), GOOD, 'utf8')
    const dup = loadGoldenDir(dir, 'evals/golden')
    expect(dup.findings.map(f => f.code)).toContain('GOLD007')
    rmSync(dir, { recursive: true, force: true })
  })
})
