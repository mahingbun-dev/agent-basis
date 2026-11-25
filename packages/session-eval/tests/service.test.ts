/**
 * 服务编排单测:端口注入 → 快照。锁住三条状态语义:
 * - 会话不在内存(端口 undefined)→ `not_loaded`(不是空分);
 * - 会话在内存但零事件 → `empty`;
 * - 有事件 → `ok`,且快照字段与投影/规则层逐项一致。
 */
import { describe, expect, it } from 'vitest'
import { SessionEvalService, composeVerdict, type JudgeEngineFace } from '../src/service.ts'
import type { EvalVerdict, SessionEventLike } from '../src/types.ts'
import { DEFAULT_JUDGE_CONFIG, type JudgeSnapshot } from '../src/judge-types.ts'
import { FIXTURE_EVENTS } from './fixture.ts'

/** 固定端口:sessionId → 事件数组(未命中的 id 恒 undefined). */
function portsOf(table: Readonly<Record<string, readonly SessionEventLike[]>>) {
  const seen: string[] = []
  return {
    seen,
    readEvents(sessionId: string) {
      seen.push(sessionId)
      return table[sessionId]
    },
  }
}

describe('SessionEvalService.snapshot', () => {
  it('会话未加载 → not_loaded(结构完整,不给假分数)', async () => {
    const service = new SessionEvalService(portsOf({}))
    const snapshot = await service.snapshot('missing', 1_700_000_000_000)
    expect(snapshot.state).toBe('not_loaded')
    expect(snapshot.sessionId).toBe('missing')
    expect(snapshot.generatedAt).toBe(1_700_000_000_000)
    expect(snapshot.metrics).toEqual([])
    expect(snapshot.verdict.level).toBe('unrated')
    expect(snapshot.verdict.label).toContain('未加载')
  })

  it('会话在内存但零事件 → empty', async () => {
    const service = new SessionEvalService(portsOf({ 's-empty': [] }))
    const snapshot = await service.snapshot('s-empty', 1)
    expect(snapshot.state).toBe('empty')
    expect(snapshot.verdict.label).toContain('尚无内容')
    expect(snapshot.usage.billed).toBe(0)
    expect(snapshot.cacheHitRate).toBeNull()
  })

  it('有事件 → ok,字段与投影/规则层一致(手算)', async () => {
    const service = new SessionEvalService(portsOf({ 's-ok': FIXTURE_EVENTS }))
    const snapshot = await service.snapshot('s-ok', 5)
    expect(snapshot.state).toBe('ok')
    expect(snapshot.turns).toBe(2)
    expect(snapshot.steps).toBe(2)
    expect(snapshot.lastTurn).toBe(2)
    expect(snapshot.durationMs).toBe(14_000) // firstTime 1000 → lastTime 15000
    expect(snapshot.usage).toEqual({ input: 1000, output: 200, cacheRead: 3000, cacheWrite: 0, reasoning: 0, billed: 4200 })
    expect(snapshot.cacheHitRate).toBeCloseTo(0.75, 10)
    expect(snapshot.costUsd).toBeCloseTo(0.0007, 9)
    expect(snapshot.route).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    expect(snapshot.metrics.length).toBeGreaterThan(0)
    expect(snapshot.verdict.level).toBe('warn')
    expect(snapshot.issues.length).toBe(7)
    expect(snapshot.pending).toHaveLength(3)
  })

  it('会话 id 非法(空/超长)→ not_loaded,且不触碰端口', async () => {
    const ports = portsOf({})
    const service = new SessionEvalService(ports)
    expect((await service.snapshot('', 1)).state).toBe('not_loaded')
    expect((await service.snapshot('x'.repeat(201), 1)).state).toBe('not_loaded')
    expect(ports.seen).toEqual([])
  })

  it('同一事件数组重复读取结果完全相同(纯投影)', async () => {
    const service = new SessionEvalService(portsOf({ 's-ok': FIXTURE_EVENTS }))
    const first = await service.snapshot('s-ok', 1)
    const second = await service.snapshot('s-ok', 2)
    expect({ ...first, generatedAt: 0 }).toEqual({ ...second, generatedAt: 0 })
  })
})

/** 裁判区假件(结构面四方法;manifest 由用例改). */
function judgeOf(overrides: Partial<JudgeSnapshot> = {}): JudgeEngineFace {
  const snapshot: JudgeSnapshot = {
    state: 'ready',
    scores: [],
    pending: 0,
    budget: { usedTokens: 0, maxTokensPerDay: 200_000 },
    overall: { level: 'pass', label: '结果类：通过', reasons: ['关键项全部通过。'] },
    ...overrides,
  }
  return {
    snapshot: async () => snapshot,
    evaluate: async () => ({ ok: true, accepted: 1, pending: 1, skipped: [] }),
    settings: async () => ({ config: DEFAULT_JUDGE_CONFIG, metrics: [], providers: [] }),
    saveConfig: async () => ({ ok: true, config: DEFAULT_JUDGE_CONFIG }),
    saveBusinessMetric: async () => ({ ok: false, code: 'io', error: '测试假件未接线' }),
    parseBusinessMetrics: async () => ({ ok: false, error: '测试假件未接线' }),
    label: async () => ({ ok: false, code: 'io', error: '测试假件未接线' }),
  }
}

describe('SessionEvalService × 裁判层', () => {
  it('引擎在场 → 快照含 judge 区,结论合并规则与裁判', async () => {
    const service = new SessionEvalService({ ...portsOf({ 's-ok': FIXTURE_EVENTS }), judge: judgeOf() })
    const snapshot = await service.snapshot('s-ok', 5)
    expect(snapshot.judge).toMatchObject({ state: 'ready' })
    // 规则层 fixture 有 6 项异常 → warn 压过裁判 pass(结论取两方最严)
    expect(snapshot.verdict.level).toBe('warn')
  })

  it('空态快照同样携带裁判区(历史评分可见),结构不省略', async () => {
    const service = new SessionEvalService({ ...portsOf({}), judge: judgeOf({ state: 'unconfigured' }) })
    const snapshot = await service.snapshot('missing', 1)
    expect(snapshot.state).toBe('not_loaded')
    expect(snapshot.judge?.state).toBe('unconfigured')
  })

  it('引擎抛错 → 快照降级为规则层(judge 省略,不炸面板)', async () => {
    const broken: JudgeEngineFace = { ...judgeOf(), snapshot: async () => { throw new Error('db gone') } }
    const service = new SessionEvalService({ ...portsOf({ 's-ok': FIXTURE_EVENTS }), judge: broken })
    const snapshot = await service.snapshot('s-ok', 5)
    expect(snapshot.judge).toBeUndefined()
    expect(snapshot.state).toBe('ok')
  })

  it('evaluate/settings/saveConfig 透传;引擎缺席时如实拒绝', async () => {
    const engine = judgeOf()
    const service = new SessionEvalService({ ...portsOf({ 's-ok': FIXTURE_EVENTS }), judge: engine })
    expect(await service.evaluate('s-ok', { scope: 'outcome' })).toMatchObject({ ok: true, accepted: 1 })
    expect((await service.settings()).providers).toEqual([])
    expect((await service.saveConfig({})).ok).toBe(true)

    const bare = new SessionEvalService(portsOf({}))
    expect(await bare.evaluate('s-ok')).toMatchObject({ ok: false, code: 'invalid' })
    expect(await bare.saveConfig({})).toMatchObject({ ok: false })
    await expect(bare.settings()).rejects.toThrow('judge layer not mounted')
  })
})

describe('composeVerdict', () => {
  const rulePass: EvalVerdict = { level: 'pass', label: '确定性检查通过（结果类未评）', reasons: ['规则无异常。'] }
  const ruleWarn: EvalVerdict = { level: 'warn', label: '确定性检查：1 项异常（结果类未评）', reasons: ['参数合法率: 50%'] }
  const ruleUnrated: EvalVerdict = { level: 'unrated', label: '未评：会话尚无内容', reasons: ['无事件'] }
  const judgePass: JudgeSnapshot['overall'] = { level: 'pass', label: '结果类：通过', reasons: [] }
  const judgeWarn: JudgeSnapshot['overall'] = { level: 'warn', label: '结果类：1 项关键项未过', reasons: ['任务完成度未通过'] }
  const judgeUnrated: JudgeSnapshot['overall'] = { level: 'unrated', label: '结果类：未评', reasons: ['尚无评分'] }

  it('双方通过 → pass;规则 warn 压过裁判 pass;裁判 warn 也压过规则 pass', () => {
    expect(composeVerdict(rulePass, judgePass)).toMatchObject({ level: 'pass', label: '规则与裁判均通过' })
    expect(composeVerdict(ruleWarn, judgePass).level).toBe('warn')
    expect(composeVerdict(rulePass, judgeWarn)).toMatchObject({ level: 'warn', label: '规则通过 · 结果类：1 项关键项未过' })
    expect(composeVerdict(ruleWarn, judgeWarn).label).toBe('规则与裁判均发现问题')
  })

  it('任一方无结论 → 保留规则文案(其已明写结果类状态),不伪造通过', () => {
    expect(composeVerdict(rulePass, judgeUnrated)).toEqual({ level: 'pass', label: rulePass.label, reasons: [...rulePass.reasons, ...judgeUnrated.reasons] })
    expect(composeVerdict(ruleWarn, judgeUnrated).level).toBe('warn')
    expect(composeVerdict(ruleUnrated, judgePass).label).toContain('结果类裁判通过')
    expect(composeVerdict(ruleUnrated, judgeUnrated).level).toBe('unrated')
  })

  it('理由合并(规则 + 裁判),不丢任何一方的解释', () => {
    const merged = composeVerdict(rulePass, judgeWarn)
    expect(merged.reasons).toContain('规则无异常。')
    expect(merged.reasons).toContain('任务完成度未通过')
  })
})
