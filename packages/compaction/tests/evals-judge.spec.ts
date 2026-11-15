/**
 * LLM judge 层(22 号 §3-C4)纯函数面:prompt 组装/输出解析(严格校验)/
 * verdict 合并(纯函数覆盖层)。LLM 调用器注入——本 spec 零网络。
 * prompt 关键段逐字断言(golden 固定,防判别契约漂移)。
 */
import { describe, expect, it } from 'vitest'
import {
  applyJudgeVerdicts, buildJudgeMessages, judgeGoldenCase, parseJudgeVerdict,
} from '../evals/judge.ts'
import { scoreSummary } from '../evals/score.ts'
import type { FactsSchema } from '../evals/facts.ts'

const facts: FactsSchema = {
  userVerbatim: ['预算 15 万', '200 人'],
  filePaths: ['out/a.md', 'src/b.ts'],
  errorStrings: ['E_BAD'],
  commands: ['pnpm verify'],
  decisions: [
    { claim: '保持 0.8', evidence: 'decision: threshold stays 0.8; ratio kept 0.16' },
    { claim: '清单三键不扩', evidence: 'overrides whitelist unchanged: auto/thresholdRatio/retainRatio only' },
    { claim: '错误码在案', evidence: 'MODEL_SWITCH_COMPACTION_FAILED thrown on switch failure' },
  ],
  mustNotAppear: ['37.5 万', '由你直接签'],
}

const full = [
  '## Primary Request and Intent',
  '- 用户要求:预算 15 万,200 人。',
  '## Key Technical Concepts',
  '- compaction',
  '## Files and Code',
  '- out/a.md: plan; src/b.ts: code',
  '## Errors and Fixes',
  '- E_BAD: 已修复',
  '## Pending Jobs',
  '- (none)',
  '## Current Work',
  '- running pnpm verify',
  '## Next Step',
  '- (none)',
  '## Critical Context',
  '- 决策:阈值保持 0.8 不动,保留比例 0.16 维持',
].join('\n')

describe('buildJudgeMessages', () => {
  it('system 为冻结 prompt;user 含摘要/决策清单/needle 清单', () => {
    const messages = buildJudgeMessages(full, facts)
    expect(messages).toHaveLength(2)
    expect(messages[0]?.role).toBe('system')
    // 冻结断言:判别契约关键句(golden 固定)。
    expect(messages[0]?.content).toContain('paraphrase and translation are allowed')
    expect(messages[0]?.content).toContain('covered=false when the summary omits the decision, changes its outcome')
    expect(messages[0]?.content).toContain('restatement=true')
    expect(messages[0]?.content).toContain('Respond with ONLY a JSON object')
    expect(messages[1]?.role).toBe('user')
    expect(messages[1]?.content).toContain('SUMMARY:')
    expect(messages[1]?.content).toContain(full)
    expect(messages[1]?.content).toContain('[0] claim: 保持 0.8')
    expect(messages[1]?.content).toContain('evidence: decision: threshold stays 0.8')
    expect(messages[1]?.content).toContain('- 37.5 万')
    expect(messages[1]?.content).toContain('- 由你直接签')
  })

  it('mustNotAppear 缺省 → (none) 占位', () => {
    const messages = buildJudgeMessages(full, { ...facts, mustNotAppear: [] })
    expect(messages[1]?.content).toContain('MUST-NOT-APPEAR needles to judge')
    expect(messages[1]?.content).toContain('(none)')
  })
})

describe('parseJudgeVerdict', () => {
  const valid = JSON.stringify({
    decisions: [
      { index: 0, covered: true, reasoning: '阈值与保留比例都在' },
      { index: 1, covered: false, reasoning: '清单未提' },
      { index: 2, covered: true, reasoning: '错误码在场' },
    ],
    mustNotAppear: [
      { needle: '37.5 万', restatement: false, reasoning: 'absent' },
      { needle: '由你直接签', restatement: true, reasoning: '作为已确认要求复述' },
    ],
  })

  it('正常解析:容忍 json 围栏与前后散文', () => {
    expect(parseJudgeVerdict(`前置说明\n\`\`\`json\n${valid}\n\`\`\`\n后记`, facts)).toEqual({
      decisions: [
        { index: 0, covered: true, reasoning: '阈值与保留比例都在' },
        { index: 1, covered: false, reasoning: '清单未提' },
        { index: 2, covered: true, reasoning: '错误码在场' },
      ],
      mustNotAppear: [
        { needle: '37.5 万', restatement: false, reasoning: 'absent' },
        { needle: '由你直接签', restatement: true, reasoning: '作为已确认要求复述' },
      ],
    })
  })

  it('fail-loud:坏 JSON/缺数组/索引越界/needle 未知/非布尔', () => {
    expect(() => parseJudgeVerdict('no json here', facts)).toThrow(/no JSON object/)
    expect(() => parseJudgeVerdict('{"decisions":[]}', facts)).toThrow(/missing mustNotAppear/)
    expect(() => parseJudgeVerdict(JSON.stringify({ decisions: [{ index: 9, covered: true }], mustNotAppear: [] }), facts))
      .toThrow(/index out of range/)
    expect(() => parseJudgeVerdict(JSON.stringify({ decisions: [], mustNotAppear: [{ needle: '不存在的', restatement: false }] }), facts))
      .toThrow(/needle unknown/)
    expect(() => parseJudgeVerdict(JSON.stringify({ decisions: [{ index: 0, covered: 'yes' }], mustNotAppear: [] }), facts))
      .toThrow(/covered must be boolean/)
  })
})

describe('applyJudgeVerdicts', () => {
  const base = scoreSummary(full, facts)

  it('确定性已过的行:judge covered 不改写通道标记(幂等安全)', () => {
    const verdict = { decisions: [{ index: 0, covered: true, reasoning: '' }], mustNotAppear: [] }
    const merged = applyJudgeVerdicts(base, verdict)
    expect(base.decisions.rows[0]?.passed).toBe(true)
    expect(merged.decisions.rows[0]?.matchedVia).not.toBe('judge') // 已过行保持原通道
  })

  it('确定性 fail + judge covered → matchedVia=judge 救回,decisions 达标', () => {
    const failing = scoreSummary(full.replace('阈值保持 0.8 不动,保留比例 0.16 维持', '无关内容'), facts)
    expect(failing.decisions.rows[0]?.passed).toBe(false)
    const verdict = {
      decisions: [
        { index: 0, covered: true, reasoning: '中文表述语义等价:阈值 0.8 与保留 0.16 均在场' },
        { index: 1, covered: true, reasoning: '白名单三键在 Critical Context' },
        { index: 2, covered: true, reasoning: '错误码在 Errors 段' },
      ],
      mustNotAppear: [],
    }
    const merged = applyJudgeVerdicts(failing, verdict)
    expect(merged.decisions.rows[0]?.passed).toBe(true)
    expect(merged.decisions.rows[0]?.matchedVia).toBe('judge')
    expect(merged.decisions.passed).toBe(true)
    expect(merged.violations.join('\n')).not.toMatch(/decisions /)
  })

  it('judge 也不 covered → 维持违规', () => {
    const failing = scoreSummary(full.replace('阈值保持 0.8 不动,保留比例 0.16 维持', '无关内容'), facts)
    const merged = applyJudgeVerdicts(failing, { decisions: [{ index: 0, covered: false, reasoning: '缺失' }], mustNotAppear: [] })
    expect(merged.decisions.rows[0]?.passed).toBe(false)
    expect(merged.decisions.passed).toBe(false)
    expect(merged.violations.join('\n')).toMatch(/decisions /)
  })

  it('mustNotAppear:judge 判否定性引用 → 违规转 negated;判复述 → 保持违规', () => {
    // 无否定词的裸复述两条都命中(启发式只豁免含否定词的行)。
    const poisoned = `${full}\n- 另见:预算放宽到 37.5 万 的说法\n- 用户确认由你直接签`
    const deterministic = scoreSummary(poisoned, facts)
    expect(deterministic.mustNotAppearHits).toEqual(['37.5 万', '由你直接签'])
    const merged = applyJudgeVerdicts(deterministic, {
      decisions: [],
      mustNotAppear: [
        { needle: '37.5 万', restatement: false, reasoning: '仅交叉引用,非接受' },
        { needle: '由你直接签', restatement: true, reasoning: '作为已确认要求复述' },
      ],
    })
    expect(merged.mustNotAppearHits).toEqual(['由你直接签'])
    expect(merged.negatedHits).toContain('37.5 万')
    expect(merged.violations.join('\n')).toMatch(/mustNotAppear hit\(s\): 由你直接签/)
    expect(merged.passed).toBe(false)
  })
})

describe('judgeGoldenCase', () => {
  it('组装→调用→解析全链(caller 注入)', async () => {
    const calls: string[][] = []
    const verdict = await judgeGoldenCase(async (messages) => {
      calls.push(messages.map(message => message.content))
      return JSON.stringify({
        decisions: facts.decisions.map((_, index) => ({ index, covered: true, reasoning: 'ok' })),
        mustNotAppear: (facts.mustNotAppear ?? []).map(needle => ({ needle, restatement: false, reasoning: 'absent' })),
      })
    }, full, facts)
    expect(calls[0]).toHaveLength(2)
    expect(verdict.decisions).toHaveLength(3)
    expect(verdict.mustNotAppear.every(entry => !entry.restatement)).toBe(true)
  })
})
