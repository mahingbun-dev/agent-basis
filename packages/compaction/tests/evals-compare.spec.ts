/**
 * C8a 摘要模型对比报告的单测:compare.ts 纯函数(聚合 + 报告生成 + raw JSON
 * 往返)。不触网:真实 LLM 对比跑在 evals/run-compare.mjs(CLI 层),这里只钉
 * 确定性口径——聚合求和、表格列(召回/误报/结构/耗时/费用)、判定矩阵、结论
 * 嵌入、raw JSON 从落盘重建后报告逐字节一致(供"先跑 sweep、后补结论"的两段式
 * 产出,报告数字与结论必须来自同一次 sweep)。
 */
import { describe, expect, it } from 'vitest'
import {
  aggregateModelRun,
  buildModelComparisonReport,
  parseCompareRaw,
  serializeCompareRaw,
  CompareRawError,
} from '../evals/compare.ts'
import type { CompareReportInput, ModelRunInput } from '../evals/compare.ts'
import type { CaseRunResult } from '../evals/runner.ts'
import type { GatewayCallRecord } from '../evals/gateway.ts'
import type { ScoreResult } from '../evals/score.ts'

// ---------------------------------------------------------------------------
// 夹具:最小 ScoreResult / CaseRunResult / GatewayCallRecord(只填聚合面用到的字段)
// ---------------------------------------------------------------------------

/** 构造一个 ScoreResult:四组召回 hit/total、decisions、结构、误报面。 */
function makeScore(opts: {
  recall?: Partial<Record<'userVerbatim' | 'filePaths' | 'errorStrings' | 'commands', [number, number]>>
  decisions?: [number, number]
  structureComplete?: boolean
  mustNotAppearHits?: string[]
  negatedHits?: string[]
  unverified?: number
  ratio?: number
  passed?: boolean
}): ScoreResult {
  const group = (hit: number, total: number, name: 'userVerbatim' | 'filePaths' | 'errorStrings' | 'commands') => ({
    name,
    items: Array.from({ length: total }, () => 'i'),
    missing: Array.from({ length: total - hit }, () => 'm'),
    hitCount: hit,
    recall: total === 0 ? 1 : hit / total,
    min: 1,
    passed: hit === total,
  })
  const [dPassed, dTotal] = opts.decisions ?? [3, 3]
  return {
    recall: {
      userVerbatim: group(...(opts.recall?.userVerbatim ?? [7, 7]), 'userVerbatim'),
      filePaths: group(...(opts.recall?.filePaths ?? [9, 9]), 'filePaths'),
      errorStrings: group(...(opts.recall?.errorStrings ?? [3, 3]), 'errorStrings'),
      commands: group(...(opts.recall?.commands ?? [3, 3]), 'commands'),
    },
    decisions: {
      rows: Array.from({ length: dTotal }, (_, index) => ({
        claim: `c${index}`,
        evidence: 'e',
        tokens: ['e'],
        hitTokens: index < dPassed ? ['e'] : [],
        hitRatio: index < dPassed ? 1 : 0,
        asciiHitRatio: index < dPassed ? 1 : 0,
        matchedVia: index < dPassed ? 'tokens' as const : null,
        passed: index < dPassed,
      })),
      passedCount: dPassed,
      ratio: dTotal === 0 ? 1 : dPassed / dTotal,
      min: 0.8,
      passed: dPassed === dTotal,
    },
    structure: {
      titles: [],
      missing: opts.structureComplete === false ? ['Next Step'] : [],
      complete: opts.structureComplete !== false,
    },
    unverified: Array.from({ length: opts.unverified ?? 0 }, () => ({ section: 's', text: 't' })),
    mustNotAppearHits: opts.mustNotAppearHits ?? [],
    negatedHits: opts.negatedHits ?? [],
    compaction: opts.ratio === undefined ? {} : { shadowedTokens: 2000, framedTokens: 1000, ratio: opts.ratio },
    passed: opts.passed ?? true,
    violations: opts.passed === false ? ['synthetic violation'] : [],
  }
}

/** 构造一个 CaseRunResult(默认 ok + 全门槛通过)。 */
function makeRun(caseId: string, opts: {
  ok?: boolean
  error?: string
  score?: ScoreResult | null
  retryErrors?: string[]
  summaryCalls?: number
  ratio?: number
} = {}): CaseRunResult {
  const ok = opts.ok !== false
  return {
    caseId,
    ok,
    ...(ok ? { summaryText: '## Primary Request and Intent\n- x' } : { error: opts.error ?? 'boom' }),
    retryErrors: opts.retryErrors ?? [],
    summaryCalls: opts.summaryCalls ?? 1,
    ...(ok && opts.score !== null
      ? { shadowedTokens: 2000, framedTokens: 1000, score: opts.score ?? makeScore({ ratio: opts.ratio ?? 2 }) }
      : {}),
  }
}

/** 构造一次调用观测。 */
function makeCall(opts: { elapsedMs?: number; prompt?: number; completion?: number; reasoning?: number } = {}): GatewayCallRecord {
  return {
    model: 'm',
    elapsedMs: opts.elapsedMs ?? 1000,
    ...(opts.prompt === undefined ? {} : { promptTokens: opts.prompt }),
    ...(opts.completion === undefined ? {} : { completionTokens: opts.completion }),
    ...(opts.reasoning === undefined ? {} : { reasoningTokens: opts.reasoning }),
  }
}

/** 两个模型 × 四用例的标准夹具。 */
function fixtureModels(): ModelRunInput[] {
  return [
    {
      model: 'model-a',
      maxTokens: 8192,
      records: [
        { run: makeRun('c1'), calls: [makeCall({ elapsedMs: 8000, prompt: 5000, completion: 3000, reasoning: 1000 })] },
        { run: makeRun('c2', { score: makeScore({ recall: { commands: [0, 3] }, passed: false, ratio: 1 }) }), calls: [makeCall({ elapsedMs: 2000, prompt: 4000, completion: 1000 })] },
        { run: makeRun('c3', { score: makeScore({ mustNotAppearHits: ['诱饵'], unverified: 2, structureComplete: false, passed: false }) }), calls: [makeCall({ elapsedMs: 4000, prompt: 3000, completion: 2000, reasoning: 500 })] },
        { run: makeRun('c4', { ok: false, error: 'invalid-summary: missing sections' }), calls: [makeCall({ elapsedMs: 1000, prompt: 2000, completion: 0 })] },
      ],
    },
    {
      model: 'model-b',
      maxTokens: 8192,
      records: [
        { run: makeRun('c1', { score: makeScore({ recall: { filePaths: [8, 9] }, passed: false }) }), calls: [makeCall({ elapsedMs: 30000, prompt: 6000, completion: 2500, reasoning: 800 })] },
        { run: makeRun('c2'), calls: [makeCall({ elapsedMs: 31000, prompt: 6100, completion: 2600, reasoning: 900 })] },
        { run: makeRun('c3', { score: makeScore({ unverified: 1, passed: true }) }), calls: [makeCall({ elapsedMs: 32000, prompt: 6200, completion: 2700 })] },
        { run: makeRun('c4'), calls: [makeCall({ elapsedMs: 33000, prompt: 6300, completion: 2800 })] },
      ],
    },
  ]
}

function input(overrides: Partial<CompareReportInput> = {}): CompareReportInput {
  return {
    generatedAt: '2026-11-13T10:00:00.000Z',
    maxTokens: 8192,
    gateway: 'liteLLM gateway(内网,.secrets/ 凭据不入库)',
    caseIds: ['c1', 'c2', 'c3', 'c4'],
    models: fixtureModels(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// aggregateModelRun
// ---------------------------------------------------------------------------

describe('aggregateModelRun', () => {
  it('多用例求和:召回各组 hit/total 累加、误报两口径分开计、达标/失格/错误计数正确', () => {
    const agg = aggregateModelRun(fixtureModels()[0]!)
    expect(agg.model).toBe('model-a')
    expect(agg.caseCount).toBe(4)
    expect(agg.passedCount).toBe(1)
    expect(agg.belowCount).toBe(2)
    expect(agg.errorCount).toBe(1)
    // 召回累计:c1(7/7,9/9,3/3,3/3) + c2(7/7,9/9,3/3,0/3) + c3(7/7,9/9,3/3,3/3);c4 error 不计。
    expect(agg.recall.userVerbatim).toEqual([21, 21])
    expect(agg.recall.filePaths).toEqual([27, 27])
    expect(agg.recall.errorStrings).toEqual([9, 9])
    expect(agg.recall.commands).toEqual([6, 9])
    expect(agg.recall.decisions).toEqual([9, 9])
    expect(agg.mustNotAppearHits).toBe(1)
    expect(agg.unverifiedBullets).toBe(2)
    expect(agg.structureComplete).toBe(2)
    // 压缩比均值:2 与 1 的均值(c3/c4 无 score 或无 ratio 不计)。
    expect(agg.meanCompactionRatio).toBeCloseTo(1.5)
    // 耗时/费用:calls 全求和(含 error run 的调用——费用是真实发生量)。
    expect(agg.elapsedMs).toBe(15000)
    expect(agg.promptTokens).toBe(14000)
    expect(agg.completionTokens).toBe(6000)
    expect(agg.reasoningTokens).toBe(1500)
    expect(agg.callCount).toBe(4)
  })

  it('run 级 error 不进召回分母但 calls 照计(费用是真实发生量)', () => {
    const agg = aggregateModelRun({
      model: 'm',
      maxTokens: 8192,
      records: [{ run: makeRun('c', { ok: false, error: 'x' }), calls: [makeCall({ elapsedMs: 500, prompt: 100, completion: 10 })] }],
    })
    expect(agg.errorCount).toBe(1)
    expect(agg.recall.userVerbatim).toEqual([0, 0])
    expect(agg.elapsedMs).toBe(500)
    expect(agg.promptTokens).toBe(100)
  })

  it('模型级失败(error 字段)→ runError 记录、全部数值零、无 NaN', () => {
    const agg = aggregateModelRun({ model: 'dead', maxTokens: 8192, records: [], error: 'gateway HTTP 503: upstream unavailable' })
    expect(agg.runError).toBe('gateway HTTP 503: upstream unavailable')
    expect(agg.caseCount).toBe(0)
    expect(agg.passedCount).toBe(0)
    expect(agg.recall.userVerbatim).toEqual([0, 0])
    expect(agg.meanCompactionRatio).toBeUndefined()
    expect(agg.elapsedMs).toBe(0)
    expect(agg.promptTokens).toBeUndefined()
    expect(agg.completionTokens).toBeUndefined()
    expect(agg.reasoningTokens).toBeUndefined()
    expect(Number.isNaN(agg.elapsedMs)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// buildModelComparisonReport
// ---------------------------------------------------------------------------

describe('buildModelComparisonReport', () => {
  it('含五列口径:召回/误报/结构/耗时/费用,逐模型一行且顺序保持', () => {
    const report = buildModelComparisonReport(input())
    expect(report).toContain('# 摘要模型对比报告(C8a,2026-11-13)')
    expect(report).toContain('deepseek-flash') // 基线说明提及当前会话模型
    expect(report).toContain('| 模型 | 达标 | 召回(userVerbatim·filePaths·errorStrings·commands·decisions) | 误报(必不现/unverified) | 结构 | 压缩比均值 | 耗时(合计/均) | 费用(prompt+completion,reasoning) |')
    const rows = report.split('\n').filter(line => line.startsWith('| model-a') || line.startsWith('| model-b'))
    expect(rows).toHaveLength(2)
    expect(report.indexOf('| model-a')).toBeLessThan(report.indexOf('| model-b'))
    // model-a 行:达标 1/4(2 below,1 error);召回累计;误报 1/2;结构 2/4;压缩比 1.5×;耗时 15.0s/3.8s;费用含 reasoning 拆分。
    expect(rows[0]).toContain('1/4(2 below,1 error)')
    expect(rows[0]).toContain('21/21 · 27/27 · 9/9 · 6/9 · 9/9')
    expect(rows[0]).toContain('1 / 2')
    expect(rows[0]).toContain('2/4')
    expect(rows[0]).toContain('1.5×')
    expect(rows[0]).toContain('15.0s / 3.8s')
    expect(rows[0]).toContain('14,000+6,000 tok')
    expect(rows[0]).toContain('reasoning 1,500')
    // model-b 行:达标 3/4。
    expect(rows[1]).toContain('3/4(1 below,0 error)')
  })

  it('费用口径声明:内网网关无单价,费用列以 token 为代理', () => {
    const report = buildModelComparisonReport(input())
    expect(report).toContain('网关不暴露单价')
    expect(report).toContain('token')
  })

  it('判定矩阵:用例 × 模型,✅/❌/💥/— 单元格正确', () => {
    const report = buildModelComparisonReport(input())
    expect(report).toContain('## 用例 × 模型判定矩阵')
    expect(report).toContain('| 用例 | model-a | model-b |')
    const matrixRows = report.split('\n').filter(line => /^\| c[1-4] /.test(line))
    expect(matrixRows).toHaveLength(4)
    expect(matrixRows[0]).toContain('| ✅ | ❌ |') // c1:a 全门槛通过;b filePaths 8/9 失格
    expect(matrixRows[1]).toContain('| ❌ | ✅ |') // c2
    expect(matrixRows[2]).toContain('| ❌ | ✅ |') // c3
    expect(matrixRows[3]).toContain('| 💥 | ✅ |') // c4:a run 级 error
  })

  it('模型级失败行:💥 前缀、矩阵单元格为 —、失败原因进失分明细', () => {
    const report = buildModelComparisonReport(input({
      models: [{ model: 'dead', maxTokens: 8192, records: [], error: 'gateway HTTP 503: upstream unavailable' }],
    }))
    expect(report).toContain('💥 dead')
    expect(report).toContain('0/4(0 below,0 error)')
    expect(report).toContain('gateway HTTP 503: upstream unavailable')
    expect(report).toContain('| c1 | — |')
  })

  it('结论与建议嵌入报告尾部;未提供则不出现该节', () => {
    const withConclusions = buildModelComparisonReport(input({
      conclusions: ['## 结论与建议默认档', '', '- 建议默认档:`deepseek-flash`。'],
    }))
    expect(withConclusions).toContain('## 结论与建议默认档')
    expect(withConclusions).toContain('- 建议默认档:`deepseek-flash`。')
    expect(withConclusions.indexOf('## 结论与建议默认档')).toBeGreaterThan(withConclusions.indexOf('## 逐模型失分明细'))

    const without = buildModelComparisonReport(input())
    expect(without).not.toContain('结论与建议默认档')
  })

  it('失分明细:below-threshold 的 violations 与 run error 逐条可读', () => {
    const report = buildModelComparisonReport(input())
    expect(report).toContain('invalid-summary: missing sections')
    expect(report).toContain('### model-a')
  })

  it('报告不含凭据形态:无 Bearer、无 http(s) URL(网关描述不含地址)', () => {
    const report = buildModelComparisonReport(input())
    expect(report).not.toContain('Bearer')
    expect(report).not.toMatch(/https?:\/\//)
  })

  it('方法节固定:全量重跑纪律与抽样波动声明', () => {
    const report = buildModelComparisonReport(input())
    expect(report).toContain('抽样随机性')
    expect(report).toContain('全量重跑')
  })
})

// ---------------------------------------------------------------------------
// serializeCompareRaw / parseCompareRaw(两段式产出:先 sweep 落 raw,后补结论重建)
// ---------------------------------------------------------------------------

describe('serializeCompareRaw/parseCompareRaw', () => {
  it('JSON 往返后报告逐字节一致(重建路径不改数字)', () => {
    const original = input()
    const raw = serializeCompareRaw(original)
    const rebuilt = parseCompareRaw(raw)
    expect(buildModelComparisonReport(rebuilt)).toBe(buildModelComparisonReport(original))
  })

  it('往返保留结论文本', () => {
    const original = input({ conclusions: ['## 结论与建议默认档', '', '- X。'] })
    const rebuilt = parseCompareRaw(serializeCompareRaw(original))
    expect(rebuilt.conclusions).toEqual(['## 结论与建议默认档', '', '- X。'])
    expect(buildModelComparisonReport(rebuilt)).toContain('- X。')
  })

  it('非法 JSON / 缺关键字段 / 错误类型 → CompareRawError', () => {
    expect(() => parseCompareRaw('not json')).toThrow(CompareRawError)
    expect(() => parseCompareRaw('{}')).toThrow(CompareRawError)
    expect(() => parseCompareRaw(JSON.stringify({ generatedAt: 'x', maxTokens: 'n', gateway: 'g', caseIds: [], models: [] }))).toThrow(CompareRawError)
    expect(() => parseCompareRaw(JSON.stringify({ generatedAt: 'x', maxTokens: 1, gateway: 'g', caseIds: [], models: 'nope' }))).toThrow(CompareRawError)
    expect(() => parseCompareRaw(JSON.stringify({ generatedAt: 'x', maxTokens: 1, gateway: 'g', caseIds: [], models: [{ model: 1 }] }))).toThrow(CompareRawError)
  })
})
