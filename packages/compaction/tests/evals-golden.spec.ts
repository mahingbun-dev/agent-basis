/**
 * C4 golden 评估 harness 单测:facts schema、确定性评分器(score.ts)、回放投影
 * (replay.ts)、runner 真实 region 事务、golden 集完整性。
 *
 * golden 集契约(22 号 §3-C4/C2/C3 验收):
 * - 每个用例 facts.json 过 schema(≥5/≥8/≥3/≥3/≥3),session.jsonl 可回放;
 * - 期望摘要(golden 自带 fake 摘要)过真实 region 事务(C3 结构校验 + shrink)
 *   并达到首版基线门槛(userVerbatim 100%、三组 ≥90%、decisions ≥80%、标题齐备);
 * - masquerade-lure 用例:期望摘要零 mustNotAppear 命中,冒充复述摘要必被
 *   mustNotAppear 抓住(C2 防丢样例);
 * - config-threshold-handoff 用例:空壳摘要注入被 InvalidSummaryError 拒绝并重试
 *   后提交成功(C3 注入用例)。
 */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compactCheckpointSource, CompactionId } from '@deepseek-ai/dsh-compaction'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { estimateMessage } from '@deepseek-ai/dsh-token-meter/estimate'
import {
  FACTS_MINIMUMS,
  FactsValidationError,
  validateFacts,
} from '../evals/facts.ts'
import type { FactsSchema } from '../evals/facts.ts'
import { factTokens, GOLDEN_THRESHOLDS, scoreSummary, summaryBullets } from '../evals/score.ts'
import { parseSessionJsonl, replaySession, SessionFormatError } from '../evals/replay.ts'
import { listGoldenCases, loadGoldenCase, runGoldenCase } from '../evals/runner.ts'
import type { GoldenCase } from '../evals/runner.ts'
import { validateSummaryStructure } from '../src/basic/summarizer.ts'
import { fakeSummarizer } from './helpers/fakes.ts'
import type { CaseSummarizer } from '../evals/runner.ts'

const GOLDEN_DIR = fileURLToPath(new URL('../evals/golden', import.meta.url))

function loadAllCases(): GoldenCase[] {
  return listGoldenCases(GOLDEN_DIR).map(id => loadGoldenCase(join(GOLDEN_DIR, id), id))
}

/** 装载单例(每次全新回放:region 事务会替换 surface,用例不可跨运行复用)。 */
function loadCase(id: string): GoldenCase {
  return loadGoldenCase(join(GOLDEN_DIR, id), id)
}

/** 期望摘要的 framed 价(与 region shrink 校验同源的估算)。 */
function framedTokensOf(summaryText: string): number {
  return estimateMessage(createUserMessage({
    content: [
      { type: 'text', text: 'checkpoint preamble' },
      { type: 'text', text: summaryText },
      { type: 'text', text: '</compacted-summary>' },
    ],
    source: compactCheckpointSource(CompactionId('00000000-0000-4000-8000-000000000000')),
  }))
}

/** 脚本式 CaseSummarizer(复用 C1 fakeSummarizer 的逐次出牌语义)。 */
function scripted(steps: ReadonlyArray<string | Error>): CaseSummarizer {
  return fakeSummarizer(steps)
}

// ---------------------------------------------------------------------------
// facts.ts schema 校验
// ---------------------------------------------------------------------------

describe('facts schema', () => {
  const valid = {
    userVerbatim: ['a1', 'a2', 'a3', 'a4', 'a5'],
    filePaths: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'],
    errorStrings: ['E1', 'E2', 'E3'],
    commands: ['cmd1', 'cmd2', 'cmd3'],
    decisions: [
      { claim: 'c1', evidence: 'e1' },
      { claim: 'c2', evidence: 'e2' },
      { claim: 'c3', evidence: 'e3' },
    ],
  }

  it('合法 facts 通过并收窄为只读形状', () => {
    const facts = validateFacts(JSON.parse(JSON.stringify(valid)))
    expect(facts.userVerbatim).toHaveLength(5)
    expect(facts.decisions[0]).toEqual({ claim: 'c1', evidence: 'e1' })
    expect(facts.mustNotAppear).toBeUndefined()
  })

  it('缺项/短列表/非串元素/未知键 → 违规聚合进一条 FactsValidationError', () => {
    const broken = {
      ...valid,
      userVerbatim: ['only-one'],
      filePaths: 'not-an-array',
      errorStrings: ['E1', 'E2', 42],
      decisions: [{ claim: 'c1' }],
      extra: true,
    } as unknown
    let caught: unknown
    try {
      validateFacts(broken)
      expect.unreachable()
    } catch (error) {
      caught = error
    }
    const factsError = caught as FactsValidationError
    expect(factsError).toBeInstanceOf(FactsValidationError)
    expect(factsError.name).toBe('FactsValidationError')
    expect(factsError.message).toMatch(/^invalid-facts: /)
    expect(factsError.violations).toEqual([
      'unknown key "extra"',
      'userVerbatim has 1 item(s), minimum is 5',
      'filePaths must be an array',
      'errorStrings[2] must be a non-empty string',
      'decisions has 1 item(s), minimum is 3',
      'decisions[0].evidence must be a non-empty string',
    ])
    expect(FACTS_MINIMUMS).toEqual({ userVerbatim: 5, filePaths: 8, errorStrings: 3, commands: 3, decisions: 3 })
  })

  it('mustNotAppear 可选:给出时须为非空字符串数组,空数组合法', () => {
    expect(validateFacts({ ...valid, mustNotAppear: ['x'] }).mustNotAppear).toEqual(['x'])
    expect(validateFacts({ ...valid, mustNotAppear: [] }).mustNotAppear).toEqual([])
    expect(() => validateFacts({ ...valid, mustNotAppear: ['ok', ''] })).toThrow(FactsValidationError)
  })
})

// ---------------------------------------------------------------------------
// score.ts 评分器
// ---------------------------------------------------------------------------

describe('scoreSummary', () => {
  // 评分器直接吃 FactsSchema 字面量(最低条数校验是 facts 加载层的职责,不在评分器)。
  const facts: FactsSchema = {
    userVerbatim: ['预算 15 万', '200 人'],
    filePaths: ['out/a.md', 'src/b.ts'],
    errorStrings: ['E_BAD'],
    commands: ['pnpm verify'],
    decisions: [
      { claim: '保持 0.8', evidence: 'decision: threshold stays 0.8; ratio kept 0.16' },
    ],
    mustNotAppear: ['37.5 万'],
  }

  const full = [
    '## Primary Request and Intent',
    '- 用户要求:预算 15 万,200 人。',
    '## Key Technical Concepts',
    '- compaction',
    '## Files and Code',
    '- out/a.md: plan; src/b.ts: code',
    '## Errors and Fixes',
    '- E_BAD: fixed',
    '## Pending Jobs',
    '- (none)',
    '## Current Work',
    '- running pnpm verify',
    '## Next Step',
    '- (none)',
    '## Critical Context',
    '- decision: threshold stays 0.8; ratio kept 0.16',
  ].join('\n')

  it('全命中:四组召回 100%、decisions ≥80%、结构齐备、零违规 → passed', () => {
    const result = scoreSummary(full, facts, { shadowedTokens: 4000, framedTokens: 500 })
    expect(result.passed).toBe(true)
    expect(result.violations).toEqual([])
    expect(result.recall.userVerbatim).toMatchObject({ hitCount: 2, recall: 1, passed: true })
    expect(result.recall.filePaths.recall).toBe(1)
    expect(result.decisions.passed).toBe(true)
    expect(result.structure.complete).toBe(true)
    expect(result.mustNotAppearHits).toEqual([])
    expect(result.compaction).toMatchObject({ shadowedTokens: 4000, framedTokens: 500, ratio: 8 })
  })

  it('substring 大小写敏感:大写化的路径不命中并进 missing', () => {
    const upper = full.replace('src/b.ts', 'SRC/B.TS')
    const result = scoreSummary(upper, facts)
    expect(result.recall.filePaths.missing).toEqual(['src/b.ts'])
    expect(result.recall.filePaths.recall).toBe(0.5)
    expect(result.passed).toBe(false)
    expect(result.violations.join('\n')).toMatch(/filePaths recall 50\.0% < 90%/)
  })

  it('阈值可覆盖:门槛取自 overrides 并反映在组上', () => {
    const lenient = scoreSummary(full, facts, { thresholds: { filePaths: 0.4, decisions: 0.5 } })
    expect(lenient.recall.filePaths.min).toBe(0.4)
    expect(lenient.decisions.min).toBe(0.5)
    // 0.5 命中的组在 0.4 门槛下通过。
    const upper = full.replace('src/b.ts', 'SRC/B.TS')
    const rescued = scoreSummary(upper, facts, { thresholds: { filePaths: 0.4 } })
    expect(rescued.recall.filePaths.passed).toBe(true)
  })

  it('decisions:evidence token 命中率跨 80% 边界(全 miss 即违规,高命中放行)', () => {
    const noDecision = full.replace('decision: threshold stays 0.8; ratio kept 0.16', 'unrelated bullet text here')
    const result = scoreSummary(noDecision, facts)
    expect(result.decisions.rows[0]?.passed).toBe(false)
    expect(result.decisions.passed).toBe(false)
    expect(result.violations.join('\n')).toMatch(/decisions 0\.0% < 80%.*保持 0\.8/)

    const partial = full.replace(
      'decision: threshold stays 0.8; ratio kept 0.16',
      'decision: threshold stays 0.8 only',
    )
    const partialResult = scoreSummary(partial, facts)
    // tokens: decision, threshold, stays, 0.8, ratio, kept, 0.16 → 命中 4/7 ≈ 57% < 80%
    expect(partialResult.decisions.rows[0]?.hitRatio).toBeLessThan(0.8)
    expect(partialResult.decisions.passed).toBe(false)
  })

  it('mustNotAppear 命中即违规(冒充复述被抓)', () => {
    const poisoned = `${full}\n- 另见:预算放宽到 37.5 万 的说法`
    const result = scoreSummary(poisoned, facts)
    expect(result.mustNotAppearHits).toEqual(['37.5 万'])
    expect(result.passed).toBe(false)
  })

  it('decisions ASCII 实体通道(2026-11-15):英文 evidence 无命中但数字/标识符锚点在场 → viaAscii 放行', () => {
    const bilingualFacts: FactsSchema = {
      ...facts,
      decisions: [
        { claim: '预算按 150000 基线推进,草稿数字无效', evidence: 'budget baseline stays 150000; the draft relaxed figure is void' },
      ],
    }
    // 摘要全中文:userVerbatim 覆盖,决策仅以数字锚点 150000 在场。
    const chineseSummary = [
      '## Primary Request and Intent',
      '- 用户要求:预算 15 万,200 人。',
      '## Key Technical Concepts',
      '- compaction',
      '## Files and Code',
      '- out/a.md: plan; src/b.ts: code',
      '## Errors and Fixes',
      '- E_BAD: 修了',
      '## Pending Jobs',
      '- (none)',
      '## Current Work',
      '- running pnpm verify',
      '## Next Step',
      '- (none)',
      '## Critical Context',
      '- 预算基线 150000 不变,草稿的放宽数字一律不算数',
    ].join('\n')
    const result = scoreSummary(chineseSummary, bilingualFacts)
    expect(result.decisions.rows[0]?.hitRatio).toBeLessThan(0.8)
    expect(result.decisions.rows[0]?.matchedVia).toBe('ascii')
    expect(result.decisions.rows[0]?.passed).toBe(true)
    expect(result.decisions.passed).toBe(true)
  })

  it('mustNotAppear 否定语境豁免(2026-11-15):「一律不算数」的引用是决策记录非复述', () => {
    const negating = `${full}\n- 预算基线 150000 不变,草稿的放宽数字(37.5 万)一律不算数`
    const result = scoreSummary(negating, facts)
    expect(result.negatedHits).toEqual(['37.5 万'])
    expect(result.mustNotAppearHits).toEqual([])
    expect(result.violations.join('\n')).not.toMatch(/mustNotAppear/)
  })

  it('unverified bullet:不含证据 token 的 bullet 被标记但不判死刑', () => {
    // 替换 Pending Jobs 段正文(重复标题取首现,追加段不会被收集)。
    const withNoise = full.replace('## Pending Jobs\n- (none)', '## Pending Jobs\n- totally unrelated fluffy sentence with no anchors')
    const result = scoreSummary(withNoise, facts)
    expect(result.unverified.length).toBeGreaterThanOrEqual(1)
    expect(result.unverified.some(bullet => bullet.text.includes('fluffy'))).toBe(true)
    expect(result.passed).toBe(true) // unverified 不参与 passed
  })

  it('summaryBullets:(none) 占位与列表标记归一化,不计入 bullet', () => {
    const bullets = summaryBullets('## Pending Jobs\n- (none)\n* real bullet\n5. numbered bullet\n(none)')
    expect(bullets).toEqual([
      { section: 'Pending Jobs', text: 'real bullet' },
      { section: 'Pending Jobs', text: 'numbered bullet' },
    ])
  })

  it('结构缺段 → violation 且 passed=false', () => {
    const missing = full.replace('## Next Step\n- (none)\n', '')
    const result = scoreSummary(missing, facts)
    expect(result.structure.complete).toBe(false)
    expect(result.structure.missing).toEqual(['Next Step'])
    expect(result.passed).toBe(false)
  })

  it('GOLDEN_THRESHOLDS 为首版基线门槛(22 号 §3-C4)', () => {
    expect(GOLDEN_THRESHOLDS).toEqual({
      userVerbatim: 1,
      filePaths: 0.9,
      errorStrings: 0.9,
      commands: 0.9,
      decisions: 0.8,
    })
  })

  it('factTokens:拉丁/数字/路径成段,CJK ≤3 字整段、长段滑窗二元组', () => {
    expect(factTokens('threshold stays 0.8; ratio kept 0.16')).toEqual([
      'threshold', 'stays', '0.8', 'ratio', 'kept', '0.16',
    ])
    expect(factTokens('out/change-request.md')).toEqual(['out/change-request.md'])
    expect(factTokens('超支恰 5%')).toEqual(['超支恰', '5%'])
    const bigrams = factTokens('预算超支达到审批线')
    expect(bigrams.slice(0, 3)).toEqual(['预算', '算超', '超支'])
    expect(bigrams).toContain('审批')
  })
})

// ---------------------------------------------------------------------------
// replay.ts 回放投影
// ---------------------------------------------------------------------------

describe('parseSessionJsonl/replaySession', () => {
  it('格式校验:seq 必须从 1 连续,type/time/data 类型不合格式即抛', () => {
    const bad = '{"type":"turn/start","seq":2,"time":1,"data":{}}'
    expect(() => parseSessionJsonl(bad)).toThrow(SessionFormatError)
    expect(() => parseSessionJsonl('{"type":"turn/start","seq":1,"time":"x","data":{}}')).toThrow(SessionFormatError)
    expect(() => parseSessionJsonl('not json')).toThrow(SessionFormatError)
    expect(() => parseSessionJsonl('')).toThrow(SessionFormatError)
  })

  it('回放:消息事件上 surface,其余只入日志;投影含全部消息且遮蔽价为正', () => {
    const events = parseSessionJsonl([
      '{"type":"turn/start","seq":1,"time":1,"data":{"turn":1}}',
      '{"type":"user/message","seq":2,"time":2,"data":{"message":{"role":"user","content":[{"type":"text","text":"hello golden replay"}]}}}',
      '{"type":"tool/call","seq":3,"time":3,"data":{"turn":1,"step":1,"callId":"c1","name":"read","arguments":"{}"}}',
      '{"type":"assistant/message","seq":4,"time":4,"data":{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"hi back"}]},"stream":[]}}',
      '{"type":"turn/end","seq":5,"time":5,"data":{"turn":1,"reason":{"kind":"completed"}}}',
    ].join('\n'))
    const replay = replaySession(events, 'spec-replay')
    expect(replay.session.seq).toBe(5) // 5 条事件,append 游标 0-based
    expect(replay.surfaceSeqs).toHaveLength(2) // user + assistant
    expect(replay.input.messages.map(message => message.role)).toEqual(['user', 'assistant'])
    expect(replay.shadowedTokens).toBeGreaterThan(0)
  })

  it('tool/result 带 error 但 message.isError !== true → fail-loud', () => {
    const events = parseSessionJsonl([
      '{"type":"tool/result","seq":1,"time":1,"data":{"turn":1,"step":1,"message":{"role":"tool","content":[{"type":"text","text":"x"}],"toolCallId":"c1"},"error":{"name":"E","code":"C","reason":"r"}}}',
    ].join('\n'))
    expect(() => replaySession(events)).toThrow(/isError === true/)
  })
})

// ---------------------------------------------------------------------------
// golden 集完整性与确定性层(真实 region 事务)
// ---------------------------------------------------------------------------

describe('golden set(真实 golden 目录)', () => {
  const cases = loadAllCases()

  it('用例清单固定:四个用例,目录三件套齐全', () => {
    expect(listGoldenCases(GOLDEN_DIR)).toEqual([
      'config-threshold-handoff',
      'gala-budget-approval',
      'masquerade-lure',
      'reactor-no-fabrication',
    ])
    for (const goldenCase of cases) {
      expect(goldenCase.facts.userVerbatim.length).toBeGreaterThanOrEqual(FACTS_MINIMUMS.userVerbatim)
      expect(goldenCase.expectedSummary.length).toBeGreaterThan(0)
      expect(goldenCase.replay.surfaceSeqs.length).toBeGreaterThan(0)
    }
    // C3 注入用例:config-threshold-handoff 自带空壳摘要样本。
    expect(cases.find(goldenCase => goldenCase.id === 'config-threshold-handoff')?.hollowSummary).toBeDefined()
  })

  it('每个期望摘要都是 C3 结构合法摘要(8 段齐备、关键两段非空)', () => {
    for (const goldenCase of cases) {
      expect(() => {
        validateSummaryStructure(goldenCase.expectedSummary)
      }, goldenCase.id).not.toThrow()
    }
  })

  it('每个期望摘要过首版基线门槛,且 framed 价 < 遮蔽价(shrink 可行)', () => {
    for (const goldenCase of cases) {
      const score = scoreSummary(goldenCase.expectedSummary, goldenCase.facts, {
        shadowedTokens: goldenCase.replay.shadowedTokens,
        framedTokens: framedTokensOf(goldenCase.expectedSummary),
      })
      expect(score.passed, `${goldenCase.id}: ${score.violations.join('; ')}`).toBe(true)
      expect(framedTokensOf(goldenCase.expectedSummary)).toBeLessThan(goldenCase.replay.shadowedTokens)
    }
  })

  it('确定性层:期望摘要经真实 region 事务提交并达门槛(零重试)', async () => {
    for (const id of listGoldenCases(GOLDEN_DIR)) {
      const goldenCase = loadCase(id)
      const run = await runGoldenCase(goldenCase, scripted([goldenCase.expectedSummary]))
      expect(run.ok, `${goldenCase.id}: ${run.error ?? ''}`).toBe(true)
      expect(run.summaryCalls).toBe(1)
      expect(run.retryErrors).toEqual([])
      expect(run.summaryText).toBe(goldenCase.expectedSummary)
      expect(run.score?.passed, `${goldenCase.id}: ${run.score?.violations.join('; ') ?? ''}`).toBe(true)
      expect(run.shadowedTokens).toBeGreaterThan(0)
      expect(run.framedTokens).toBeLessThan(run.shadowedTokens ?? 0)
      // 提交后 surface 被 checkpoint 替换:只剩 1 个节点。
      expect(goldenCase.replay.session.surface.nodes.length).toBe(1)
    }
  })

  it('C3 注入用例:空壳摘要被 InvalidSummaryError 拒绝并重试后提交成功', async () => {
    const goldenCase = loadCase('config-threshold-handoff')
    const run = await runGoldenCase(goldenCase, scripted([goldenCase.hollowSummary!, goldenCase.expectedSummary]))
    expect(run.ok).toBe(true)
    expect(run.summaryCalls).toBe(2)
    expect(run.retryErrors).toHaveLength(1)
    expect(run.retryErrors[0]).toContain('invalid-summary:')
    expect(run.summaryText).toBe(goldenCase.expectedSummary)
    expect(run.score?.passed).toBe(true)
    // 失败的空壳摘要没有落地:拒绝已被 recover 吸收,事务成功闭合。
    expect(goldenCase.replay.session.surface.nodes.length).toBe(1)
  })

  it('C3 注入用例:空壳摘要 + 零重试预算(retries=0)→ 原样重抛', async () => {
    const goldenCase = loadCase('config-threshold-handoff')
    const run = await runGoldenCase(goldenCase, scripted([goldenCase.hollowSummary!]), { retries: 0 })
    expect(run.ok).toBe(false)
    expect(run.error).toContain('invalid-summary:')
    expect(run.summaryCalls).toBe(1)
  })

  it('C2 防丢样例(masquerade-lure):期望摘要零 mustNotAppear,冒充复述必被抓', async () => {
    const goldenCase = loadCase('masquerade-lure')
    expect(goldenCase.facts.mustNotAppear).toContain('37.5 万')
    // 期望摘要:零命中、全门槛通过。
    const clean = scoreSummary(goldenCase.expectedSummary, goldenCase.facts)
    expect(clean.mustNotAppearHits).toEqual([])
    expect(clean.passed).toBe(true)
    // 冒充复述:把草稿的诱饵当成用户指令写进摘要 → mustNotAppear 命中 → 不通过。
    const poisoned = goldenCase.expectedSummary.replace(
      'budget baseline stays 150000; the draft\'s relaxed figure is void (unapproved).',
      'user asked to raise the budget to 37.5 万 and let the assistant 由你直接签; recorded as user requests.',
    )
    const caught = scoreSummary(poisoned, goldenCase.facts)
    expect(caught.mustNotAppearHits).toContain('37.5 万')
    expect(caught.mustNotAppearHits).toContain('由你直接签')
    expect(caught.passed).toBe(false)
  })

  it('C2 防丢样例(安全约束逐字):两个合规用例的安全红线在期望摘要中逐字存活', () => {
    const gala = cases.find(entry => entry.id === 'gala-budget-approval')!
    const reactor = cases.find(entry => entry.id === 'reactor-no-fabrication')!
    for (const needle of ['预算超支达 5% 必须走预算变更审批', '不问就改 = 失败']) {
      expect(goldenExpectedContains(gala, needle)).toBe(true)
    }
    for (const needle of ['严禁编造、外推或补插数值', '结论只能来自真实检索', '数据缺失时段必须标注"数据缺失"']) {
      expect(goldenExpectedContains(reactor, needle)).toBe(true)
    }
  })

  it('facts 不悬空:四组事实全部可在会话原文(消息文本 + 工具调用参数)中找到', () => {
    for (const goldenCase of cases) {
      const parts: string[] = []
      for (const event of goldenCase.events) {
        const message = event.data.message as { content?: Array<{ type?: string; text?: string }> } | undefined
        for (const block of message?.content ?? []) {
          if (block.type === 'text') parts.push(block.text ?? '')
        }
        if (typeof event.data.arguments === 'string') parts.push(event.data.arguments)
      }
      const ground = parts.join('\n')
      for (const [group, items] of [
        ['userVerbatim', goldenCase.facts.userVerbatim],
        ['filePaths', goldenCase.facts.filePaths],
        ['errorStrings', goldenCase.facts.errorStrings],
        ['commands', goldenCase.facts.commands],
        ['mustNotAppear', goldenCase.facts.mustNotAppear ?? []],
      ] as const) {
        for (const needle of items) {
          expect(ground.includes(needle), `${goldenCase.id} ${group}: ${needle}`).toBe(true)
        }
      }
      // decisions evidence 同样必须悬空为零(评分取其 token)。
      for (const decision of goldenCase.facts.decisions) {
        expect(ground.includes(decision.evidence), `${goldenCase.id} decisions.evidence: ${decision.evidence}`).toBe(true)
      }
    }
  })
})

/** 期望摘要包含检查(读 case 字段,避免测试内重复拼装)。 */
function goldenExpectedContains(goldenCase: GoldenCase, needle: string): boolean {
  return goldenCase.expectedSummary.includes(needle)
}
