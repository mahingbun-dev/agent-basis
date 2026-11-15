/**
 * basic/region 事务收敛单测:shrink 校验(错误文案含两数)、recover 链(true=重新
 * prepare 再摘要 / false=重抛)、compactPressure 重试耗尽后的错误链。
 *
 * C3 摘要结构校验:parse/validate 四型(正常/缺段/双关键段空/其余段 none 合法)、
 * REQUIRED_SUMMARY_TITLES 与模板 golden 逐字一致、空壳摘要经 recover 重试与
 * compaction/end.error 的 invalid-summary: 前缀、校验先于 shrink 的次序钉死。
 *
 * C3 契约变更注记:region 现对摘要结果做结构校验,本文件既有 shrink/recover/
 * compactPressure 用例的 fake 摘要须为结构合法摘要(VALID_SUMMARY/HUGE_SUMMARY),
 * 否则会在 shrink/recover 断言之前先被 InvalidSummaryError 拒绝。
 */
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { compactCheckpointSource, CompactionId } from '@deepseek-ai/dsh-compaction'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { estimateMessage } from '@deepseek-ai/dsh-token-meter/estimate'
import { resolveCompactSpec, resolveConfig, resolveTargetPolicy } from '../src/basic/config.ts'
import { compactSurfaceRegion } from '../src/basic/region.ts'
import {
  frameSummary,
  InvalidSummaryError,
  parseSummarySections,
  REQUIRED_SUMMARY_TITLES,
  summaryToText,
  validateSummaryStructure,
} from '../src/basic/summarizer.ts'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionSeq as SessionSeqType } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  callCompactPressure,
  createFakeMeter,
  fakeSummarizer,
  makeEngine,
  makeFakeAgent,
  makeFakeEngineContext,
  makePressureSession,
  MINIMAL_VALID_SUMMARY,
  text,
} from './helpers/fakes.ts'

const SIGNAL = new AbortController().signal

/** 事务 options(region 私有类型的结构字面量)。 */
const TRANSACTION = { owner: 'current-turn', stability: 'whole-surface' } as const

/** 计算与 region.ts 同源的 framed checkpoint 估价。 */
function framedTokensOf(summaryText: string): number {
  return estimateMessage(createUserMessage({
    content: frameSummary([text(summaryText)]),
    source: compactCheckpointSource(CompactionId(randomUUID())),
  }))
}

/** 直接依赖表(fake meter + 脚本 summarizer + 可配置 recover)。 */
function makeDeps(
  face: ReturnType<typeof fakeSummarizer>,
  recover: (error: unknown, agent: Agent, sourceEventSeqs: readonly SessionSeqType[]) => boolean,
): Parameters<typeof compactSurfaceRegion>[0] {
  const meter = createFakeMeter()
  return {
    meter,
    summarize: face,
    recover: (error: unknown, agent: Agent, sourceEventSeqs: readonly SessionSeqType[]): boolean =>
      recover(error, agent, sourceEventSeqs),
  } as unknown as Parameters<typeof compactSurfaceRegion>[0]
}

/** 读取日志尾部事件(测试面回放只读,S'-1 行内豁免)。 */
function lastEvent(session: Session, back = 1) {
  // oxlint-disable-next-line typescript/no-deprecated -- 测试面回放只读(S'-1 行内豁免)。
  return session.eventAt(SessionSeq(session.seq - back))
}

// ---------------------------------------------------------------------------
// C3 摘要 fixtures(shrink/recover/compactPressure 既有用例与本文件 C3 用例共用)
// ---------------------------------------------------------------------------

/** 模板 golden(测试独立持有,与 basic-prompt.spec 的 GOLDEN_TITLES 同表)。 */
const GOLDEN_TITLES = [
  'Primary Request and Intent',
  'Key Technical Concepts',
  'Files and Code',
  'Errors and Fixes',
  'Pending Jobs',
  'Current Work',
  'Next Step',
  'Critical Context',
] as const

type GoldenTitle = (typeof GOLDEN_TITLES)[number]

/** 全 8 段的真实正文(单行 bullet,形如摘要模型的真实输出)。 */
const REALISTIC_BODIES: Record<GoldenTitle, string> = {
  'Primary Request and Intent': '- 把上下文压缩系统做出来',
  'Key Technical Concepts': '- vitest 单测与 oxlint 门禁',
  'Files and Code': '- packages/compaction/src/basic/region.ts: 压缩事务',
  'Errors and Fixes': '- oxlint no-non-null-assertion: 行内豁免修复',
  'Pending Jobs': '- C4 golden 评估 harness',
  'Current Work': '- 正在实现摘要结构校验',
  'Next Step': '- 跑包级 verify',
  'Critical Context': '- thresholdRatio 保持 0.8',
}

/** 按 golden 顺序拼摘要文本;缺席键=整段缺席。 */
function summaryFrom(bodies: Partial<Record<GoldenTitle, string>>): string {
  return GOLDEN_TITLES
    .filter(title => bodies[title] !== undefined)
    .map(title => `## ${title}\n${bodies[title]}`)
    .join('\n\n')
}

/** 结构合法的小型摘要(shrink 通过、提交成功的既有用例面):共享最小合法摘要。 */
const VALID_SUMMARY = MINIMAL_VALID_SUMMARY

/** 结构合法但超长的摘要:过结构校验、触 shrink 失败(既有 shrink 用例面)。 */
const HUGE_SUMMARY = summaryFrom({
  ...REALISTIC_BODIES,
  'Primary Request and Intent': `- ${'把要点重复一遍。'.repeat(400)}`,
})

/** 空壳:8 段标题齐备但关键两段为 (none)——摘要模型输出空壳的注入形态。 */
const HOLLOW_SHELL = summaryFrom({
  ...REALISTIC_BODIES,
  'Primary Request and Intent': '(none)',
  'Current Work': '(none)',
})

describe('shrink 校验', () => {
  it('framed ≥ shadowed → 抛错文案含两个 token 数', async () => {
    const { session, seqs } = makePressureSession()
    const agent = makeFakeAgent(session)
    const meter = createFakeMeter()
    // C3 后 fake 摘要须过结构校验才能触达 shrink:用结构合法的超长摘要。
    const face = fakeSummarizer([HUGE_SUMMARY])
    const shadowed = meter.measure(session).nodes.reduce((sum, node) => sum + node.tokens, 0)
    const framed = framedTokensOf(HUGE_SUMMARY)
    expect(framed).toBeGreaterThan(shadowed)

    let message = ''
    try {
      await compactSurfaceRegion(makeDeps(face, () => false), session, seqs[0], seqs[1], agent, TRANSACTION)
      expect.unreachable()
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toBe(
      `summary is not smaller than the shadowed content (${framed} estimated framed tokens >= ${shadowed})`,
    )
  })

  it('shrink 失败落 start/end 事件对,end 带 error,surface 不变', async () => {
    const { session, seqs } = makePressureSession()
    const agent = makeFakeAgent(session)
    const face = fakeSummarizer([HUGE_SUMMARY])
    await expect(compactSurfaceRegion(
      makeDeps(face, () => false),
      session,
      seqs[0],
      seqs[1],
      agent,
      TRANSACTION,
    )).rejects.toThrow(/summary is not smaller than the shadowed content/)

    const end = lastEvent(session)
    expect(end?.type).toBe('compaction/end')
    if (end?.type === 'compaction/end') expect(end.data.error).toBeDefined()
    const start = lastEvent(session, 2)
    expect(start?.type).toBe('compaction/start')
    // 只追加日志,不替换 surface:两条 user 原样保留。
    expect(session.surface.nodes.length).toBe(2)
  })
})

describe('recover 链', () => {
  it('recover true → 重新 prepare 再 summarize,第二次成功返回', async () => {
    const { session, seqs } = makePressureSession()
    const agent = makeFakeAgent(session)
    const boom = new Error('summary attempt exploded')
    // C3 后第二次出牌须为结构合法摘要(否则校验失败再进 recover,脚本耗尽即死循环)。
    const face = fakeSummarizer([boom, VALID_SUMMARY])
    const recoverCalls: Array<{ error: unknown; seqs: readonly SessionSeqType[] }> = []
    const deps = makeDeps(face, (error, _agent, sourceEventSeqs) => {
      recoverCalls.push({ error, seqs: sourceEventSeqs })
      return true
    })

    const result = await compactSurfaceRegion(deps, session, seqs[0], seqs[1], agent, TRANSACTION)
    expect(face.calls.length).toBe(2)
    expect(recoverCalls.length).toBe(1)
    expect(recoverCalls[0]?.error).toBe(boom)
    expect(recoverCalls[0]?.seqs).toEqual([seqs[0], seqs[1]])
    // 重新 prepare:第二次输入与第一次同区间同投影。
    expect(face.calls[1]).toEqual(face.calls[0])
    expect(result.summary).toEqual([text(VALID_SUMMARY)])
    // 成功提交:checkpoint 替换区间,start/summary/end 三事件入日志。
    expect(session.surface.nodes.length).toBe(1)
    expect(lastEvent(session)?.type).toBe('compaction/end')
  })

  it('recover false → 原错误原样重抛,只摘要一次', async () => {
    const { session, seqs } = makePressureSession()
    const agent = makeFakeAgent(session)
    const boom = new Error('summary attempt exploded')
    const face = fakeSummarizer([boom])
    await expect(compactSurfaceRegion(
      makeDeps(face, () => false),
      session,
      seqs[0],
      seqs[1],
      agent,
      TRANSACTION,
    )).rejects.toBe(boom)
    expect(face.calls.length).toBe(1)
  })
})

describe('compactPressure 重试循环', () => {
  /** 压力循环 harness:小窗口模型信息 + 两条大文本 user 的会话。 */
  function makeEngineHarness(body: string) {
    const config = { headroomTokens: 5, thresholdRatio: 0.8, retainRatio: 0.16, compactionRetries: 0 }
    const harness = makeFakeEngineContext(createFakeMeter())
    harness.setModelInfo({ contextWindow: 120, defaultMaxTokens: 5 })
    const engine = makeEngine(harness.ctx, config)
    const { session } = makePressureSession(body)
    const agent = makeFakeAgent(session)
    return { harness, engine, config, session, agent, header: session.requestHeader()! }
  }

  it('compactionRetries 耗尽:压缩成功仍高于阈值 → 抛 exhausted 错误链', async () => {
    // 4000 字符 user:被遮蔽价须高于 VALID_SUMMARY 的 framed 价(8 段 CJK bullet
    // 约 250 token,单条 800 字符 user 约 200 token 会被 shrink 校验先拒)。
    const { harness, engine, config, session, agent, header } = makeEngineHarness('x'.repeat(4000))
    // C3 后 fake 摘要须为结构合法摘要,否则压缩在结构校验处失败(非 exhausted 链)。
    const face = fakeSummarizer([VALID_SUMMARY])
    ;(engine as unknown as { summarize: unknown }).summarize = face

    // 与引擎同源的阈值:threshold=floor(min(120×0.8, 120−5−5))=96;
    // retain=floor(115×0.16)=18 → 首轮只遮蔽第一条 user,尾段保留。
    const spec = resolveCompactSpec(resolveTargetPolicy(resolveConfig(config), {
      provider: 'p',
      model: 'm',
    }), 120, 5)
    const framed = framedTokensOf(VALID_SUMMARY)
    expect(spec.thresholdTokens).toBe(96)

    let message = ''
    try {
      await callCompactPressure(engine, agent, header, SIGNAL, false)
      expect.unreachable()
    } catch (error) {
      message = (error as Error).message
    }
    // 复测总价 = checkpoint 价 + 保留尾段价(与引擎同一 meter 语义)。
    const totalAfter = createFakeMeter().measure(session).totalTokens
    expect(totalAfter).toBeGreaterThanOrEqual(spec.thresholdTokens)
    expect(totalAfter).toBeGreaterThanOrEqual(framed)
    expect(message).toBe(
      'compaction still above threshold after 1 compaction attempts '
      + `(${totalAfter} estimated tokens >= threshold ${spec.thresholdTokens})`,
    )
    // 单次重试预算:摘要恰好跑一次,surface=[checkpoint, 保留的尾段 user]。
    expect(face.calls.length).toBe(1)
    expect(session.surface.nodes.length).toBe(2)
    expect(harness.warns.length).toBe(0)
  })

  it('压力未达阈值 → null 且零摘要调用', async () => {
    const { engine, session, agent, header } = makeEngineHarness('x'.repeat(100))
    const face = fakeSummarizer(['ok'])
    ;(engine as unknown as { summarize: unknown }).summarize = face

    const result = await callCompactPressure(engine, agent, header, SIGNAL, false)
    expect(result).toBeNull()
    expect(face.calls.length).toBe(0)
    expect(session.surface.nodes.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// C3 摘要结构校验(parseSummarySections / validateSummaryStructure)
// fixtures(GOLDEN_TITLES/REALISTIC_BODIES/summaryFrom/VALID_SUMMARY/HUGE_SUMMARY/
// HOLLOW_SHELL)定义见文件头部 helpers 区。
// ---------------------------------------------------------------------------

describe('C3 parseSummarySections', () => {
  it('titles 按 `## ` 出现序收集,bodyOf 取段内非空行 join,首段前的前言不计段', () => {
    const sections = parseSummarySections(
      '前言行不属于任何段\n\n## Alpha\n第一行\n\n第三行前有空行\n## Beta\n(none)',
    )
    expect(sections.titles).toEqual(['Alpha', 'Beta'])
    expect(sections.bodyOf('Alpha')).toBe('第一行\n第三行前有空行')
    expect(sections.bodyOf('Beta')).toBe('(none)')
  })

  it('无标题文本 titles 为空、bodyOf 恒为空串;重复标题取首次出现;### 不算段', () => {
    const none = parseSummarySections('只有正文,没有标题')
    expect(none.titles).toEqual([])
    expect(none.bodyOf('Alpha')).toBe('')

    const duplicated = parseSummarySections('## A\nfirst\n### A\n子标题不算新段\n## A\nsecond')
    expect(duplicated.titles).toEqual(['A', 'A'])
    expect(duplicated.bodyOf('A')).toBe('first\n### A\n子标题不算新段')
  })
})

describe('C3 validateSummaryStructure 四型', () => {
  it('正常型:8 段齐备、关键两段有正文 → 通过;REQUIRED_SUMMARY_TITLES 与模板 golden 逐字一致', () => {
    const summary = summaryFrom(REALISTIC_BODIES)
    expect(() => { validateSummaryStructure(summary) }).not.toThrow()
    // REQUIRED_SUMMARY_TITLES 由 COMPACTION_INSTRUCTION 派生,这里用独立
    // golden 钉死:模板改标题而校验不同步时在此变红。
    expect([...REQUIRED_SUMMARY_TITLES]).toEqual([...GOLDEN_TITLES])
    const sections = parseSummarySections(summary)
    expect([...sections.titles]).toEqual([...GOLDEN_TITLES])
    expect(sections.bodyOf('Current Work')).toBe(REALISTIC_BODIES['Current Work'])
  })

  it('缺段型:整段缺席 → 只报 missing 一条,不叠加空正文违规;非关键段缺席同样违规', () => {
    const { 'Current Work': _droppedCurrent, ...withoutCurrent } = REALISTIC_BODIES
    expect(() => { validateSummaryStructure(summaryFrom(withoutCurrent)) }).toThrow(InvalidSummaryError)
    let caught: unknown
    try {
      validateSummaryStructure(summaryFrom(withoutCurrent))
      expect.unreachable()
    } catch (error) {
      caught = error
    }
    expect((caught as InvalidSummaryError).violations).toEqual([
      'missing required section "## Current Work"',
    ])
    expect((caught as InvalidSummaryError).message).toBe(
      'invalid-summary: missing required section "## Current Work"',
    )

    const { 'Pending Jobs': _droppedPending, ...withoutPending } = REALISTIC_BODIES
    try {
      validateSummaryStructure(summaryFrom(withoutPending))
      expect.unreachable()
    } catch (error) {
      expect((error as InvalidSummaryError).violations).toEqual([
        'missing required section "## Pending Jobs"',
      ])
    }
  })

  it('双关键段空型:(none) / - (none) / 空正文都算空 → 违规聚合进一条 InvalidSummaryError', () => {
    const summary = summaryFrom({
      ...REALISTIC_BODIES,
      'Primary Request and Intent': '(none)',
      'Current Work': '- (none)',
    })
    expect(() => { validateSummaryStructure(summary) }).toThrow(InvalidSummaryError)
    let caught: unknown
    try {
      validateSummaryStructure(summary)
      expect.unreachable()
    } catch (error) {
      caught = error
    }
    const error = caught as InvalidSummaryError
    expect(error.name).toBe('InvalidSummaryError')
    expect(error.violations).toEqual([
      'required section "Primary Request and Intent" is empty',
      'required section "Current Work" is empty',
    ])
    expect(error.message).toBe(`invalid-summary: ${error.violations.join('; ')}`)
  })

  it('关键段空判定:空串/纯空白/大小写 (none)/多行全 (none) 均违规,混真实内容则放行', () => {
    for (const body of ['', '   ', '(none)', '(NONE)', '- (none)', '(none)\n(none)']) {
      const summary = summaryFrom({ ...REALISTIC_BODIES, 'Current Work': body })
      expect(() => { validateSummaryStructure(summary) }, `body=${JSON.stringify(body)}`).toThrow(
        InvalidSummaryError,
      )
    }
    const mixed = summaryFrom({ ...REALISTIC_BODIES, 'Current Work': '(none)\n- 真实进展一行' })
    expect(() => { validateSummaryStructure(mixed) }).not.toThrow()
  })

  it('其余段 none 合法型:仅六个非关键段 (none) → 通过,不越宽容边界', () => {
    const summary = summaryFrom({
      'Primary Request and Intent': REALISTIC_BODIES['Primary Request and Intent'],
      'Key Technical Concepts': '(none)',
      'Files and Code': '(none)',
      'Errors and Fixes': '(none)',
      'Pending Jobs': '(none)',
      'Current Work': REALISTIC_BODIES['Current Work'],
      'Next Step': '(none)',
      'Critical Context': '(none)',
    })
    expect(() => { validateSummaryStructure(summary) }).not.toThrow()
  })

  it('summaryToText:文本块按序 join,非文本块跳过,空块集得空串', () => {
    const imageBlock = { type: 'image' } as unknown as ContentBlock
    expect(summaryToText([text('AAA'), imageBlock, text('BBB')])).toBe('AAA\nBBB')
    expect(summaryToText([])).toBe('')
  })
})

describe('C3 校验接入 summarizeCompaction', () => {
  it('空壳摘要(段齐关键空)→ InvalidSummaryError 进 recover,recover true 重试后成功提交', async () => {
    const { session, seqs } = makePressureSession()
    const agent = makeFakeAgent(session)
    const good = summaryFrom(REALISTIC_BODIES)
    const face = fakeSummarizer([HOLLOW_SHELL, good])
    const recoverErrors: unknown[] = []
    const deps = makeDeps(face, (error) => {
      recoverErrors.push(error)
      return true
    })

    const result = await compactSurfaceRegion(deps, session, seqs[0], seqs[1], agent, TRANSACTION)
    expect(face.calls.length).toBe(2)
    expect(recoverErrors.length).toBe(1)
    expect(recoverErrors[0]).toBeInstanceOf(InvalidSummaryError)
    expect((recoverErrors[0] as InvalidSummaryError).violations.length).toBe(2)
    // 重新 prepare:第二次输入与第一次同区间同投影。
    expect(face.calls[1]).toEqual(face.calls[0])
    expect(result.summary).toEqual([text(good)])
    expect(session.surface.nodes.length).toBe(1)
    expect(lastEvent(session)?.type).toBe('compaction/end')
  })

  it('空壳摘要 + recover false → 原样重抛、只摘要一次,surface 不变,compaction/end.error 含 invalid-summary: 前缀', async () => {
    const { session, seqs } = makePressureSession()
    const agent = makeFakeAgent(session)
    const face = fakeSummarizer([HOLLOW_SHELL])
    let thrown: unknown
    try {
      await compactSurfaceRegion(makeDeps(face, () => false), session, seqs[0], seqs[1], agent, TRANSACTION)
      expect.unreachable()
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(InvalidSummaryError)
    expect((thrown as InvalidSummaryError).violations.length).toBe(2)
    expect(face.calls.length).toBe(1)
    // 只追加日志事件,不替换 surface:两条 user 原样保留。
    expect(session.surface.nodes.length).toBe(2)
    const end = lastEvent(session)
    expect(end?.type).toBe('compaction/end')
    if (end?.type === 'compaction/end') {
      // C9 admin 统计锚点:end.error 可按 invalid-summary: 前缀计数。
      expect(end.data.error).toContain('invalid-summary:')
      expect(end.data.error).toContain('required section "Current Work" is empty')
    }
  })

  it('校验先于 shrink:空壳摘要 → 报 invalid-summary 而非 shrink 错误(小阴影区间下 shrink 必然通过)', async () => {
    const { session, seqs } = makePressureSession('hi')
    const agent = makeFakeAgent(session)
    const face = fakeSummarizer([HOLLOW_SHELL])
    await expect(compactSurfaceRegion(
      makeDeps(face, () => false),
      session,
      seqs[0],
      seqs[1],
      agent,
      TRANSACTION,
    )).rejects.toThrow(/^invalid-summary:/)
  })
})
