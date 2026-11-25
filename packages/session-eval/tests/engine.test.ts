/**
 * 裁判编排引擎:手动评测(全量/去重/预算)、轮末抽样、空闲终评(撤销与触发)、
 * 设置读写(路由目录自检)、快照状态机(未配置/出错/未评)。
 *
 * 时间与随机源全部注入:空闲终评用假计时器,预算用固定时钟的 ISO 日期键。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JudgeEngine, type JudgeEnginePorts } from '../src/engine.ts'
import { readJudgeConfig, writeJudgeConfig } from '../src/judge-config.ts'
import { openJudgeStore } from '../src/score-store.ts'
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
