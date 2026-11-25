/**
 * 裁判编排引擎:手动评测(全量/去重/预算)、轮末抽样、空闲终评(撤销与触发)、
 * 设置读写(路由目录自检)、快照状态机(未配置/出错/未评)。
 *
 * 时间与随机源全部注入:空闲终评用假计时器,预算用固定时钟的 ISO 日期键。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JudgeEngine, type JudgeEnginePorts } from '../src/engine.ts'
import { readJudgeConfig, writeJudgeConfig } from '../src/judge-config.ts'
import { openJudgeStore } from '../src/score-store.ts'
import { businessMetricsPath, saveBusinessMetric } from '../src/business-store.ts'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from '../src/judge-types.ts'
import type { JudgeLlmPort } from '../src/judge-call.ts'
import type { SessionEventLike } from '../src/types.ts'

/** 两轮会话(有真人任务消息;过程裁判评末轮 = 第 2 轮). */
const EVENTS: readonly SessionEventLike[] = [
  { type: 'user/message', time: 1, data: { content: [{ type: 'text', text: '把按钮改成主色' }], source: { kind: 'user' } } },
  { type: 'turn/start', time: 2, data: { turn: 1 } },
  { type: 'assistant/message', time: 3, data: { turn: 1, message: { content: [{ type: 'text', text: '完成第一轮' }] } } },
  { type: 'turn/end', time: 4, data: { turn: 1, reason: { kind: 'completed' } } },
  { type: 'turn/start', time: 5, data: { turn: 2 } },
  { type: 'assistant/message', time: 6, data: { turn: 2, message: { content: [{ type: 'text', text: '完成第二轮' }] } } },
  { type: 'turn/end', time: 7, data: { turn: 2, reason: { kind: 'completed' } } },
]

/** 预算用的固定时刻(UTC 2026-11-25). */
const NOW = Date.UTC(2026, 10, 25, 2, 0, 0)
const DAY = '2026-11-25'

const BASE: JudgeConfig = {
  ...DEFAULT_JUDGE_CONFIG,
  enabled: true,
  route: { provider: 'deepseek', model: 'deepseek-chat' },
  sampling: 0,
  budgetTokensPerDay: 200_000,
  idleTimeoutMs: 120_000,
}

function writeConfig(patch: Partial<JudgeConfig> = {}): void {
  writeJudgeConfig(configPath, { ...BASE, ...patch })
}

/** 让微任务队列把在途任务跑完(直调端口是立即完成的假件). */
async function settle(engine: JudgeEngine): Promise<void> {
  for (let index = 0; index < 200 && engine.pendingTotal() > 0; index += 1) await Promise.resolve()
  await Promise.resolve()
}

let dir: string
let configPath: string
let storePath: string
let eventsById: Record<string, readonly SessionEventLike[]>
let calls: { system: string; user: string }[]
let replyText: string
let providers: { id: string; models: readonly string[] }[]
let engine: JudgeEngine | undefined

function newEngine(overrides: Partial<JudgeEnginePorts> = {}, concurrency = 2): JudgeEngine {
  const llm: JudgeLlmPort = {
    call: async (input) => {
      calls.push({ system: input.system, user: input.user })
      return { text: replyText, tokens: 100 }
    },
  }
  return new JudgeEngine({
    configPath,
    storePath,
    concurrency,
    ports: {
      readEvents: sessionId => eventsById[sessionId],
      llm,
      listProviders: async () => providers,
      now: () => NOW,
      random: () => 0.5,
      ...overrides,
    },
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eterna-judge-engine-'))
  configPath = join(dir, 'state', 'config.json')
  storePath = join(dir, 'state', 'scores.db')
  eventsById = { s1: EVENTS }
  calls = []
  replyText = '{"verdict":"pass","rationale":"符合要求"}'
  providers = [{ id: 'deepseek', models: ['deepseek-chat'] }]
  engine = undefined
})

afterEach(() => {
  vi.useRealTimers()
  engine?.dispose()
  rmSync(dir, { recursive: true, force: true })
})

describe('手动评测(evaluate)', () => {
  it('未配置路由 → unconfigured,不产生任何模型调用', async () => {
    writeConfig({ route: null })
    engine = newEngine()
    expect(await engine.evaluate('s1')).toMatchObject({ ok: false, code: 'unconfigured' })
    expect(calls).toEqual([])
  })

  it('已配置 → 6 项全部受理(3 结果类 + 末轮 3 过程类),落库并计入预算', async () => {
    writeConfig()
    engine = newEngine()
    const reply = await engine.evaluate('s1')
    expect(reply.ok).toBe(true)
    if (reply.ok) expect(reply.accepted).toBe(6)
    await settle(engine)
    expect(calls).toHaveLength(6)
    const snapshot = await engine.snapshot('s1', NOW)
    expect(snapshot.overall.level).toBe('pass')
    expect(snapshot.overall.label).toBe('结果类：通过')
    expect(snapshot.budget.usedTokens).toBe(600)
    expect(snapshot.scores).toHaveLength(6)
    expect(snapshot.scores.every(score => score.status === 'ok' && score.pass === true)).toBe(true)
    // 过程类落在末轮(第 2 轮)
    const process = snapshot.scores.filter(score => score.scope === 'turn')
    expect(process.every(score => score.turn === 2)).toBe(true)
  })

  it('自动评测关闭时手动评测仍可用(显式点击是一次授权)', async () => {
    writeConfig({ enabled: false })
    engine = newEngine()
    const reply = await engine.evaluate('s1')
    expect(reply.ok).toBe(true)
    await settle(engine)
    expect(calls).toHaveLength(6)
  })

  it('同键在途去重:第二次提交等键 → busy,不重复计费', async () => {
    writeConfig()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    engine = newEngine({
      llm: {
        call: async (input) => {
          calls.push({ system: input.system, user: input.user })
          await gate
          return { text: replyText, tokens: 100 }
        },
      },
    }, 1)
    expect((await engine.evaluate('s1')).ok).toBe(true)
    const second = await engine.evaluate('s1')
    expect(second).toMatchObject({ ok: false, code: 'busy' })
    release?.()
    await settle(engine)
    expect(calls).toHaveLength(6)
  })

  it('无内容/未加载 → no_content(不触碰模型)', async () => {
    writeConfig()
    eventsById = { 's-empty': [] }
    engine = newEngine()
    expect(await engine.evaluate('s-empty')).toMatchObject({ ok: false, code: 'no_content' })
    expect(await engine.evaluate('missing')).toMatchObject({ ok: false, code: 'no_content' })
    expect(calls).toEqual([])
  })

  it('当日预算用尽 → budget(自动与手动同时受闸)', async () => {
    writeConfig()
    const store = openJudgeStore(storePath)
    store.addUsage(DAY, 200_000)
    store.close()
    engine = newEngine()
    expect(await engine.evaluate('s1')).toMatchObject({ ok: false, code: 'budget' })
    engine.handleEvent({ id: 's1' }, { type: 'turn/end', data: { turn: 2 } })
    await settle(engine)
    expect(calls).toEqual([])
    const snapshot = await engine.snapshot('s1', NOW)
    expect(snapshot.note).toContain('预算已用尽')
  })
})

describe('自动触发', () => {
  it('L1 轮末:采样命中 → 3 项过程裁判(目标 = 该轮)', async () => {
    writeConfig({ sampling: 1 })
    engine = newEngine()
    engine.handleEvent({ id: 's1' }, { type: 'turn/end', data: { turn: 1 } })
    await settle(engine)
    expect(calls).toHaveLength(3)
    const snapshot = await engine.snapshot('s1', NOW)
    const process = snapshot.scores.filter(score => score.scope === 'turn')
    expect(process.every(score => score.status === 'ok' && score.turn === 1)).toBe(true)
  })

  it('采样率 0 / 自动关闭 / 未配置路由 → 不调用', async () => {
    writeConfig({ sampling: 0 })
    engine = newEngine()
    engine.handleEvent({ id: 's1' }, { type: 'turn/end', data: { turn: 1 } })
    await settle(engine)
    expect(calls).toEqual([])
    engine.dispose()

    writeConfig({ sampling: 1, enabled: false })
    engine = newEngine()
    engine.handleEvent({ id: 's1' }, { type: 'turn/end', data: { turn: 1 } })
    await settle(engine)
    expect(calls).toEqual([])
    engine.dispose()

    writeConfig({ sampling: 1, route: null })
    engine = newEngine()
    engine.handleEvent({ id: 's1' }, { type: 'turn/end', data: { turn: 1 } })
    await settle(engine)
    expect(calls).toEqual([])
  })

  it('L2 空闲终评:轮结束后 idleTimeoutMs 触发 3 项结果类裁判', async () => {
    vi.useFakeTimers()
    writeConfig()
    engine = newEngine()
    engine.handleEvent({ id: 's1' }, { type: 'turn/end', data: { turn: 2 } })
    expect(calls).toEqual([])
    await vi.advanceTimersByTimeAsync(120_000)
    await settle(engine)
    expect(calls).toHaveLength(3)
    const snapshot = await engine.snapshot('s1', NOW)
    const outcome = snapshot.scores.filter(score => score.scope === 'session')
    expect(outcome.every(score => score.status === 'ok')).toBe(true)
  })

  it('L2 空闲终评:新输入撤销计时(turn/start / user/message)', async () => {
    vi.useFakeTimers()
    writeConfig()
    engine = newEngine()
    engine.handleEvent({ id: 's1' }, { type: 'turn/end', data: { turn: 2 } })
    engine.handleEvent({ id: 's1' }, { type: 'turn/start', data: { turn: 3 } })
    await vi.advanceTimersByTimeAsync(120_000)
    await settle(engine)
    expect(calls).toEqual([])
    engine.handleEvent({ id: 's1' }, { type: 'turn/end', data: { turn: 3 } })
    engine.handleEvent({ id: 's1' }, { type: 'user/message', data: { content: [] } })
    await vi.advanceTimersByTimeAsync(120_000)
    await settle(engine)
    expect(calls).toEqual([])
  })

  it('L2 内容未变不重复计费(已有覆盖最新事件的结果类评分)', async () => {
    vi.useFakeTimers()
    writeConfig()
    engine = newEngine()
    engine.handleEvent({ id: 's1' }, { type: 'turn/end', data: { turn: 2 } })
    await vi.advanceTimersByTimeAsync(120_000)
    await settle(engine)
    expect(calls).toHaveLength(3)
    engine.handleEvent({ id: 's1' }, { type: 'turn/end', data: { turn: 2 } })
    await vi.advanceTimersByTimeAsync(120_000)
    await settle(engine)
    expect(calls).toHaveLength(3)
  })
})

describe('快照状态机', () => {
  it('未配置 → unconfigured;六项均为「未配置裁判」状态,不伪造成 0 或通过', async () => {
    writeConfig({ route: null })
    engine = newEngine()
    const snapshot = await engine.snapshot('s1', NOW)
    expect(snapshot.state).toBe('unconfigured')
    expect(snapshot.overall).toMatchObject({ level: 'unrated', label: '结果类：未配置裁判' })
    expect(snapshot.scores.every(score => score.status === 'skipped' && score.display === '未配置裁判')).toBe(true)
    expect(snapshot.note).toContain('未配置裁判模型')
  })

  it('已配置未启用 → disabled(手动仍可评)', async () => {
    writeConfig({ enabled: false })
    engine = newEngine()
    expect((await engine.snapshot('s1', NOW)).state).toBe('disabled')
  })

  it('输出不合契约 → 评分 error;state=error;关键项未评 → 结果类 unrated', async () => {
    writeConfig()
    replyText = 'not json'
    engine = newEngine()
    await engine.evaluate('s1')
    await settle(engine)
    const snapshot = await engine.snapshot('s1', NOW)
    expect(snapshot.state).toBe('error')
    expect(snapshot.scores.every(score => score.status === 'error' && score.value === null)).toBe(true)
    expect(snapshot.scores[0]?.rationale).toContain('裁判输出不合契约')
    expect(snapshot.overall.level).toBe('unrated')
  })

  it('停用某项 → 该项 skipped/已停用,且不参与结果类门控', async () => {
    writeConfig({ metrics: { 'judge.task_completion': false } })
    engine = newEngine()
    await engine.evaluate('s1')
    await settle(engine)
    const snapshot = await engine.snapshot('s1', NOW)
    const disabled = snapshot.scores.find(score => score.key === 'judge.task_completion')
    expect(disabled).toMatchObject({ status: 'skipped', display: '已停用' })
    expect(snapshot.overall.level).toBe('pass')
    expect(calls).toHaveLength(5)
  })

  it('在途任务进快照 pending;完成后归零', async () => {
    writeConfig()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    engine = newEngine({ llm: { call: async () => { await gate; return { text: replyText, tokens: 1 } } } }, 1)
    await engine.evaluate('s1')
    const running = await engine.snapshot('s1', NOW)
    expect(running.state).toBe('running')
    expect(running.pending).toBe(6)
    release?.()
    await settle(engine)
    expect((await engine.snapshot('s1', NOW)).pending).toBe(0)
  })
})

describe('设置读写', () => {
  it('settings:配置 + 六指标目录 + provider 目录', async () => {
    writeConfig()
    engine = newEngine()
    const settings = await engine.settings()
    expect(settings.config).toEqual(BASE)
    expect(settings.metrics).toHaveLength(6)
    expect(settings.metrics.filter(metric => metric.gating).map(metric => metric.key))
      .toEqual(['judge.task_completion', 'judge.constraint_following'])
    expect(settings.providers).toEqual([{ id: 'deepseek', models: ['deepseek-chat'] }])
  })

  it('saveConfig:严格校验 → 未知 provider / 目录外模型拒绝;合法写入可读回', async () => {
    engine = newEngine()
    expect(await engine.saveConfig({ ...BASE, sampling: 3 })).toMatchObject({ ok: false })
    const badProvider = await engine.saveConfig({ ...BASE, route: { provider: 'nope', model: 'x' } })
    expect(badProvider.ok).toBe(false)
    if (!badProvider.ok) expect(badProvider.error).toContain('未注册')
    const badModel = await engine.saveConfig({ ...BASE, route: { provider: 'deepseek', model: 'unknown-model' } })
    expect(badModel.ok).toBe(false)
    if (!badModel.ok) expect(badModel.error).toContain('目录')
    const saved = await engine.saveConfig(BASE)
    expect(saved.ok).toBe(true)
    expect(readJudgeConfig(configPath).config).toEqual(BASE)
  })

  it('saveConfig:目录枚举失败(模型列表空)不拦保存', async () => {
    providers = [{ id: 'deepseek', models: [] }]
    engine = newEngine()
    const saved = await engine.saveConfig(BASE)
    expect(saved.ok).toBe(true)
  })

  it('saveConfig:provider 目录整体不可得(异常)不拦保存', async () => {
    engine = newEngine({ listProviders: async () => { throw new Error('adapter offline') } })
    expect((await engine.saveConfig(BASE)).ok).toBe(true)
  })
})

describe('卸载', () => {
  it('dispose 撤空闲计时器(不再触发调用)', async () => {
    vi.useFakeTimers()
    writeConfig()
    engine = newEngine()
    engine.handleEvent({ id: 's1' }, { type: 'turn/end', data: { turn: 2 } })
    engine.dispose()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(calls).toEqual([])
    engine = undefined
  })
})


/** 账号覆盖层路径(fixture 与引擎端口同源). */
function businessPathOf(account: string): string {
  // 与宿主同一路径函数(含账号合法性与前缀校验),不给引擎喂未校验的拼接。
  return businessMetricsPath(dir, account)
}

/** 把若干指标写入账号覆盖层(逐条保存,版本递增). */
function writeBusinessMetrics(account: string, inputs: readonly Record<string, unknown>[]): void {
  let baseVersion = 0
  for (const input of inputs) {
    const reply = saveBusinessMetric(businessPathOf(account), input, { baseVersion, updatedBy: account, now: NOW })
    if (!reply.ok) throw new Error(`fixture 保存失败:${reply.error}`)
    baseVersion = reply.version
  }
}

/** 合法 rubric 指标输入(保存端点同形). */
function rubricInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'reply-quality',
    name: '回复质量',
    category: 'outcome',
    scope: 'session',
    gating: true,
    judge: {
      window: { max_steps: 12 },
      allow_skip: true,
      pass: { min_score: 0.8 },
      criteria: [
        { text: '先给出结论', weight: 2, critical: true },
        { text: '出现「马上就好的」空话', weight: -1, critical: false },
      ],
    },
    ...overrides,
  }
}

/** 正常 rubric 输出(第 1 条成立、第 2 条不成立). */
const RUBRIC_PASS = JSON.stringify({
  criteria: [{ index: 1, hit: true }, { index: 2, hit: false }],
  rationale: '结论先行，未出现空话',
})

/** 关键条不成立的输出. */
const RUBRIC_CRITICAL_FAIL = JSON.stringify({
  criteria: [{ index: 1, hit: false }, { index: 2, hit: false }],
  rationale: '没有先给结论',
})

/** 业务引擎:按提示词类型路由两种输出(system 判型,不依赖调用顺序). */
function businessEngine(rubricReply = RUBRIC_PASS): JudgeEngine {
  return newEngine({
    businessPath: account => businessPathOf(account),
    llm: {
      call: async (input) => {
        calls.push({ system: input.system, user: input.user })
        const text = input.system.includes('你是按评分细则判定的裁判') ? rubricReply : replyText
        return { text, tokens: 100 }
      },
    },
  })
}

describe('业务指标(账号覆盖层)', () => {
  beforeEach(() => {
    writeConfig()
  })

  it('settings(account):覆盖层视图(版本/条目/YAML);不带账号无 business;他账号独立', async () => {
    writeBusinessMetrics('alice', [rubricInput()])
    engine = businessEngine()
    const mine = await engine.settings('alice')
    expect(mine.business).toMatchObject({ version: 1, updatedBy: 'alice' })
    expect(mine.business?.metrics.map(metric => metric.key)).toEqual(['reply-quality'])
    expect(mine.business?.yaml).toContain('  - key: reply-quality')
    expect((await engine.settings()).business).toBeUndefined()
    expect((await engine.settings('bob')).business).toMatchObject({ version: 0, metrics: [] })
  })

  it('手动评测带账号:内置六项 + 业务 rubric 一项;gating/条目版本落库', async () => {
    writeBusinessMetrics('alice', [rubricInput()])
    engine = businessEngine()
    const reply = await engine.evaluate('s1', { account: 'alice' })
    expect(reply.ok).toBe(true)
    if (reply.ok) expect(reply.accepted).toBe(7)
    await settle(engine)
    expect(calls).toHaveLength(7)
    const snapshot = await engine.snapshot('s1', NOW)
    const business = snapshot.scores.find(score => score.key === 'reply-quality')
    expect(business).toMatchObject({ name: '回复质量', category: 'outcome', status: 'ok', pass: true, display: '通过' })
    expect(business?.rationale).toContain('得分 1.00')
    expect(snapshot.overall.level).toBe('pass')
    const store = openJudgeStore(storePath)
    const row = store.list('s1').find(item => item.metricKey === 'reply-quality')
    store.close()
    expect(row).toMatchObject({ gating: true, metricVersion: 1 })
  })

  it('业务关键项未过 → 结论 warn(与内置结果取最严);非关键项只进理由', async () => {
    writeBusinessMetrics('alice', [rubricInput()])
    engine = businessEngine(RUBRIC_CRITICAL_FAIL)
    await engine.evaluate('s1', { account: 'alice' })
    await settle(engine)
    const snapshot = await engine.snapshot('s1', NOW)
    expect(snapshot.overall.level).toBe('warn')
    expect(snapshot.overall.label).toBe('结果类：1 项关键项未过')
    expect(snapshot.overall.reasons).toContain('回复质量未通过')

    engine.dispose()
    writeBusinessMetrics('bob', [rubricInput({ key: 'soft-quality', name: '回复友好度', gating: false })])
    eventsById = { s1: EVENTS, s2: EVENTS }
    engine = businessEngine(RUBRIC_CRITICAL_FAIL)
    await engine.evaluate('s2', { account: 'bob' })
    await settle(engine)
    const soft = await engine.snapshot('s2', NOW)
    expect(soft.overall.level).toBe('pass')
    expect(soft.overall.reasons).toContain('回复友好度未通过（非关键项，不进结论门控）')
  })

  it('停用条目 → 不执行(受理 6 项,无该条目评分)', async () => {
    writeBusinessMetrics('alice', [rubricInput({ enabled: false })])
    engine = businessEngine()
    const reply = await engine.evaluate('s1', { account: 'alice' })
    if (reply.ok) expect(reply.accepted).toBe(6)
    await settle(engine)
    expect(calls).toHaveLength(6)
    const snapshot = await engine.snapshot('s1', NOW)
    expect(snapshot.scores.some(score => score.key === 'reply-quality')).toBe(false)
  })

  it('规则型条目 → 无路由也执行(确定性,零模型调用、零预算),provider/model 落空', async () => {
    writeConfig({ route: null })
    writeBusinessMetrics('alice', [{
      key: 'no-hedge',
      name: '回复禁语',
      category: 'process',
      scope: 'session',
      answer: { not_contains: ['稍等'] },
    }])
    engine = businessEngine()
    const reply = await engine.evaluate('s1', { account: 'alice' })
    expect(reply.ok).toBe(true)
    if (reply.ok) {
      expect(reply.accepted).toBe(1)
      expect(reply.skipped.some(reason => reason.includes('未配置裁判模型'))).toBe(true)
    }
    await settle(engine)
    expect(calls).toEqual([])
    const snapshot = await engine.snapshot('s1', NOW)
    const score = snapshot.scores.find(item => item.key === 'no-hedge')
    expect(score).toMatchObject({ status: 'ok', pass: true, display: '通过' })
    expect(score?.rationale).toContain('禁语未出现')
    expect(snapshot.budget.usedTokens).toBe(0)
    const store = openJudgeStore(storePath)
    const row = store.list('s1').find(item => item.metricKey === 'no-hedge')
    store.close()
    expect(row).toMatchObject({ provider: null, model: null, tokens: null, gating: false, metricVersion: 1 })
  })

  it('预算用尽 → 模型类跳过,规则型仍执行(零 token)', async () => {
    writeConfig()
    const usage = openJudgeStore(storePath)
    usage.addUsage(DAY, 200_000)
    usage.close()
    writeBusinessMetrics('alice', [{
      key: 'no-hedge',
      name: '回复禁语',
      category: 'process',
      scope: 'session',
      gating: false,
      answer: { not_contains: ['稍等'] },
    }, rubricInput()])
    engine = businessEngine()
    const reply = await engine.evaluate('s1', { account: 'alice' })
    expect(reply.ok).toBe(true)
    if (reply.ok) {
      expect(reply.accepted).toBe(1)
      expect(reply.skipped).toContain('内置裁判：当日预算已用尽')
      expect(reply.skipped).toContain('回复质量：当日预算已用尽')
    }
    await settle(engine)
    expect(calls).toEqual([])
    const snapshot = await engine.snapshot('s1', NOW)
    expect(snapshot.scores.some(score => score.key === 'no-hedge' && score.status === 'ok')).toBe(true)
    expect(snapshot.scores.some(score => score.key === 'reply-quality')).toBe(false)
    // 规则型零 token:用量保持预置值,没有新增。
    expect(snapshot.budget.usedTokens).toBe(200_000)
  })

  it('规则型关键项未过 → 结论 warn(与 rubric 同一门控口径)', async () => {
    writeBusinessMetrics('alice', [{
      key: 'final-answer',
      name: '最终答复合规',
      category: 'outcome',
      scope: 'session',
      gating: true,
      answer: { not_contains: ['完成第二轮'] },
    }])
    engine = businessEngine()
    await engine.evaluate('s1', { account: 'alice' })
    await settle(engine)
    const snapshot = await engine.snapshot('s1', NOW)
    expect(snapshot.overall.level).toBe('warn')
    expect(snapshot.overall.label).toBe('结果类：1 项关键项未过')
    expect(snapshot.scores.find(score => score.key === 'final-answer')).toMatchObject({ pass: false, display: '未过' })
  })

  it('覆盖层损坏 → settings 带 warning(原文回显);evaluate 记跳过原因且不触达该条目', async () => {
    mkdirSync(join(dir, 'workspaces', 'alice', '.eterna', 'eval'), { recursive: true })
    writeFileSync(businessPathOf('alice'), 'version: [\n', 'utf8')
    engine = businessEngine()
    const settings = await engine.settings('alice')
    expect(settings.business?.warning).toContain('YAML 解析失败')
    expect(settings.business?.yaml).toBe('version: [\n')
    const reply = await engine.evaluate('s1', { account: 'alice' })
    expect(reply.ok).toBe(true)
    if (reply.ok) expect(reply.skipped.some(reason => reason.includes('业务指标文件不可读'))).toBe(true)
    await settle(engine)
    expect(calls).toHaveLength(6)
  })

  it('parseBusinessMetrics:YAML 文本 → 文件视图(不落盘);语法错误带行号', async () => {
    engine = businessEngine()
    const parsed = await engine.parseBusinessMetrics([
      'version: 4',
      'updated_by: alice',
      'metrics:',
      '  - key: no-hedge',
      '    name: 回复禁语',
      '    category: process',
      '    scope: session',
      '    answer:',
      '      not_contains:',
      '        - 稍等',
      '',
    ].join('\n'))
    expect(parsed).toMatchObject({ ok: true, version: 4, updatedBy: 'alice' })
    if (parsed.ok) {
      expect(parsed.metrics).toHaveLength(1)
      expect(parsed.metrics[0]).toMatchObject({ key: 'no-hedge', answer: { notContains: ['稍等'] } })
    }
    const broken = await engine.parseBusinessMetrics('version: [\n')
    expect(broken.ok).toBe(false)
    if (!broken.ok) expect(broken.error).toMatch(/第 \d+ 行/)
  })

  it('saveBusinessMetric:写入本人覆盖层;冲突/非法账号/未接线各有中文错误', async () => {
    engine = businessEngine()
    const saved = await engine.saveBusinessMetric('alice', rubricInput(), 0)
    expect(saved).toMatchObject({ ok: true, version: 1 })
    if (saved.ok) expect(saved.metric.key).toBe('reply-quality')
    expect(await engine.saveBusinessMetric('alice', rubricInput(), 0)).toMatchObject({ ok: false, code: 'conflict' })
    expect(await engine.saveBusinessMetric('../x', rubricInput(), 0)).toMatchObject({ ok: false, code: 'invalid' })
    engine.dispose()
    const bare = newEngine()
    engine = bare
    expect(await bare.saveBusinessMetric('alice', rubricInput(), 0)).toMatchObject({ ok: false, code: 'io' })
  })
})


describe('人工复核与校准(P2-3)', () => {
  beforeEach(() => {
    writeConfig()
  })

  it('标注模型评分:回显 label + labelable;校准视图记入 1 条(偏松)', async () => {
    engine = newEngine()
    await engine.evaluate('s1')
    await settle(engine)
    const reply = await engine.label('s1', { metric: 'judge.task_completion', agrees: false }, 'alice')
    expect(reply).toEqual({ ok: true, label: 'disagrees' })
    const snapshot = await engine.snapshot('s1', NOW)
    expect(snapshot.scores.find(score => score.key === 'judge.task_completion'))
      .toMatchObject({ label: 'disagrees', labelable: true })
    // 过程类也可标注(逐轮目标)。
    expect(snapshot.scores.find(score => score.key === 'judge.tool_selection')?.labelable).toBe(true)
    const calibration = (await engine.settings('alice')).calibration
    expect(calibration).toBeDefined()
    const metric = calibration?.metrics.find(item => item.key === 'judge.task_completion')
    expect(metric).toMatchObject({
      labeled: 1, agrees: 0, agreement: 0,
      matrix: { humanPassJudgePass: 0, humanPassJudgeFail: 0, humanFailJudgePass: 1, humanFailJudgeFail: 0 },
      status: 'insufficient', bias: 'lenient',
    })
    expect(calibration?.totals).toMatchObject({ labeled: 1, agrees: 0 })
    expect(calibration?.thresholds).toEqual({ minSamples: 20, minAgreement: 0.85 })
  })

  it('标注校验:未知指标/轮次不符/规则型评分 → not_found;参数形状 → invalid', async () => {
    engine = newEngine()
    await engine.evaluate('s1')
    await settle(engine)
    expect(await engine.label('s1', { metric: 'judge.unknown', agrees: true }, 'alice'))
      .toMatchObject({ ok: false, code: 'not_found' })
    // 会话类条目没有 turn:带 turn 找不到目标。
    expect(await engine.label('s1', { metric: 'judge.task_completion', turn: 1, agrees: true }, 'alice'))
      .toMatchObject({ ok: false, code: 'not_found' })
    expect(await engine.label('s1', { metric: 'judge.task_completion', agrees: 'yes' }, 'alice'))
      .toMatchObject({ ok: false, code: 'invalid' })
    expect(await engine.label('', { metric: 'judge.task_completion', agrees: true }, 'alice'))
      .toMatchObject({ ok: false, code: 'invalid' })

    // 规则型行(provider/model 为空)不可复核。
    writeBusinessMetrics('alice', [{
      key: 'no-hedge', name: '回复禁语', category: 'process', scope: 'session',
      answer: { not_contains: ['稍等'] },
    }])
    engine.dispose()
    engine = businessEngine()
    await engine.evaluate('s1', { account: 'alice' })
    await settle(engine)
    expect(await engine.label('s1', { metric: 'no-hedge', agrees: true }, 'alice'))
      .toMatchObject({ ok: false, code: 'not_found' })
  })

  it('阈值:≥20 条且一致率 ≥85% 才 calibrated;20 条前一律 insufficient', async () => {
    engine = newEngine()
    const store = openJudgeStore(storePath)
    for (let index = 1; index <= 19; index += 1) {
      store.saveLabel({
        sessionId: `seed-${index}`, metricKey: 'judge.task_completion', metricName: '任务完成度',
        category: 'outcome', scope: 'session', targetTurn: null, judgeValue: true,
        agrees: true, labeledBy: 'alice', labeledAt: NOW - index,
      })
    }
    const before = (await engine.settings()).calibration?.metrics.find(item => item.key === 'judge.task_completion')
    expect(before).toMatchObject({ labeled: 19, status: 'insufficient' })
    store.saveLabel({
      sessionId: 'seed-20', metricKey: 'judge.task_completion', metricName: '任务完成度',
      category: 'outcome', scope: 'session', targetTurn: null, judgeValue: true,
      agrees: true, labeledBy: 'alice', labeledAt: NOW,
    })
    // 第 21 条判错:19/20 = 95% ≥85%,仍算已校准(阈值按一致率,不要求全对)。
    store.saveLabel({
      sessionId: 'seed-21', metricKey: 'judge.task_completion', metricName: '任务完成度',
      category: 'outcome', scope: 'session', targetTurn: null, judgeValue: true,
      agrees: false, labeledBy: 'alice', labeledAt: NOW,
    })
    store.close()
    const calibrated = (await engine.settings()).calibration?.metrics.find(item => item.key === 'judge.task_completion')
    expect(calibrated).toMatchObject({ labeled: 21, agrees: 20, status: 'calibrated', bias: 'lenient' })
    expect(calibrated?.agreement).toBeCloseTo(20 / 21, 5)
  })

  it('重评后裁判值变了:旧标注不回显(snapshot);校准统计仍按标注当时快照', async () => {
    engine = newEngine()
    await engine.evaluate('s1')
    await settle(engine)
    await engine.label('s1', { metric: 'judge.task_completion', agrees: true }, 'alice')
    expect((await engine.snapshot('s1', NOW)).scores.find(score => score.key === 'judge.task_completion')?.label)
      .toBe('agrees')
    // 改成未过并重评 → 同一评分行 value 变化,旧标注不再显示。
    replyText = '{"verdict":"fail","rationale":"缺少交付物"}'
    await engine.evaluate('s1', { scope: 'outcome' })
    await settle(engine)
    const after = (await engine.snapshot('s1', NOW)).scores.find(score => score.key === 'judge.task_completion')
    expect(after).toMatchObject({ pass: false, labelable: true })
    expect(after?.label).toBeUndefined()
    const metric = (await engine.settings()).calibration?.metrics.find(item => item.key === 'judge.task_completion')
    expect(metric).toMatchObject({ labeled: 1, agrees: 1 })
  })
})

describe('试跑(P2-3b)', () => {
  beforeEach(() => {
    writeConfig()
  })

  it('内置指标试跑:原始输出/tokens/路由原样返回;不落评分行,只记日预算', async () => {
    engine = newEngine()
    const reply = await engine.trial('s1', 'judge.task_completion', undefined, 'alice')
    expect(reply.ok).toBe(true)
    if (!reply.ok) return
    expect(reply.trial).toMatchObject({
      metricKey: 'judge.task_completion', metricName: '任务完成度', scope: 'session',
      status: 'ok', value: true, display: '通过', raw: replyText, tokens: 100,
      route: { provider: 'deepseek', model: 'deepseek-chat' },
    })
    expect(reply.trial.rationale).not.toBe('')
    expect(calls).toHaveLength(1)
    expect(engine.pendingTotal()).toBe(0)
    // 快照仍是「待评」:试跑不入库、不冒充正式评分。
    expect((await engine.snapshot('s1', NOW)).scores.find(score => score.key === 'judge.task_completion'))
      .toMatchObject({ status: 'pending', display: '待评' })
    const store = openJudgeStore(storePath)
    expect(store.list('s1')).toHaveLength(0)
    expect(store.usage(DAY)).toBe(100)
    store.close()
  })

  it('输出不合法:试跑照常回包(status=error,raw 原文保留,便于定位提示词/契约问题)', async () => {
    engine = newEngine()
    replyText = '抱歉,我无法按该格式输出'
    const reply = await engine.trial('s1', 'judge.task_completion', undefined, 'alice')
    expect(reply.ok).toBe(true)
    if (!reply.ok) return
    expect(reply.trial).toMatchObject({ status: 'error', value: null, display: '出错', raw: '抱歉,我无法按该格式输出' })
  })

  it('规则型业务指标拒绝试跑(not_model);rubric 业务指标可试跑且原始输出可见', async () => {
    writeBusinessMetrics('alice', [
      rubricInput(),
      { key: 'no-hedge', name: '回复禁语', category: 'process', scope: 'session', answer: { not_contains: ['稍等'] } },
    ])
    engine = businessEngine()
    expect(await engine.trial('s1', 'no-hedge', undefined, 'alice'))
      .toMatchObject({ ok: false, code: 'not_model' })
    const reply = await engine.trial('s1', 'reply-quality', undefined, 'alice')
    expect(reply.ok).toBe(true)
    if (!reply.ok) return
    expect(reply.trial).toMatchObject({ metricKey: 'reply-quality', status: 'ok', value: true, raw: RUBRIC_PASS })
    const store = openJudgeStore(storePath)
    expect(store.list('s1')).toHaveLength(0)
    store.close()
  })

  it('前置闸:未配置模型/预算用尽/会话未加载/指标不存在/轮次越界各自给码,均不调模型', async () => {
    engine = newEngine()
    expect(await engine.trial('s1', 'judge.task_completion', undefined, 'alice'))
      .toMatchObject({ ok: true })
    calls.length = 0
    writeConfig({ route: null })
    expect(await engine.trial('s1', 'judge.task_completion', undefined, 'alice'))
      .toMatchObject({ ok: false, code: 'unconfigured' })
    writeConfig()
    expect(await engine.trial('missing-session', 'judge.task_completion', undefined, 'alice'))
      .toMatchObject({ ok: false, code: 'not_loaded' })
    expect(await engine.trial('s1', 'judge.unknown_metric', undefined, 'alice'))
      .toMatchObject({ ok: false, code: 'not_found' })
    // 逐轮指标:默认末轮可跑;越界轮次拒绝。
    expect(await engine.trial('s1', 'judge.tool_selection', undefined, 'alice')).toMatchObject({ ok: true })
    expect(await engine.trial('s1', 'judge.tool_selection', 9, 'alice'))
      .toMatchObject({ ok: false, code: 'invalid' })
    expect(calls).toHaveLength(1)
    const store = openJudgeStore(storePath)
    store.addUsage(DAY, 200_000)
    store.close()
    expect(await engine.trial('s1', 'judge.task_completion', undefined, 'alice'))
      .toMatchObject({ ok: false, code: 'budget' })
  })

  it('参数形状:会话/指标为空或 turn 非法 → invalid,不调模型', async () => {
    engine = newEngine()
    expect(await engine.trial('', 'judge.task_completion', undefined, 'alice')).toMatchObject({ ok: false, code: 'invalid' })
    expect(await engine.trial('s1', '  ', undefined, 'alice')).toMatchObject({ ok: false, code: 'invalid' })
    expect(await engine.trial('s1', 'judge.task_completion', 0, 'alice')).toMatchObject({ ok: false, code: 'invalid' })
    expect(await engine.trial('s1', 'judge.task_completion', 1.5, 'alice')).toMatchObject({ ok: false, code: 'invalid' })
    expect(calls).toHaveLength(0)
  })
})
