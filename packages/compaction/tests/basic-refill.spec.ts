/**
 * C7 rapid-refill 熔断单测(basic/index.ts 的 pre-step 压力触发点,22 号 §4-C7):
 *
 * - 压缩后 3 步窗口内连续 3 次压力触发 → 第 3 次熔断:本次自动压缩被跳过
 *   (不触摘要、不推进 surface,请求放行),warn 日志,state 文件
 *   rapidRefillCount/lastRapidRefillAt 落盘且累计递增;
 * - 连击跨压缩保留,步距 ≥3(REFILL_STEP_WINDOW)时衰减归零并恢复自动;
 * - 静默步(压力未达)不进连击——步距拉开后再次触发不熔断(零误报钉死);
 * - 手动 compactNow 与模型切换压缩路径不受熔断限制;auto=false 全跳过。
 *
 * 触发语义(以代码为准的钉死):连击只在"压力真实过阈值"时累计(判定点在
 * compactPressure 过阈值处,refillBreaker 仅 pre-step 路径传 true);熔断步上
 * compactPressure 仍被进入但零压缩工作(pruner/选区/摘要全不执行,surface 不变)。
 * "每 pre-step 递增"的步距计数在 pre-step 监听器 auto 块内先行递增,压缩成功归零。
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CompactionResult } from '@deepseek-ai/dsh-compaction'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  appendUserMessage,
  createFakeMeter,
  fakeSummarizer,
  makeEngine,
  makeFakeAgent,
  makeFakeEngineContext,
  makePressureSession,
  MINIMAL_VALID_SUMMARY,
  registerAutomaticCompaction,
} from './helpers/fakes.ts'
import type { FakeMeterFace } from './helpers/fakes.ts'
import { resolveCompactSpec, resolveConfig, resolveTargetPolicy } from '../src/basic/config.ts'
import type { BasicCompactionConfig } from '../src/basic/types.ts'
import type { BasicCompactionEngine } from '../src/basic/index.ts'

const SIGNAL = new AbortController().signal

/** pre-step 监听器的结构面(测试显式派发,与 stale.spec.ts 同型)。 */
type PreStepListener = (
  payload: { agent: Agent; signal: AbortSignal },
  next: () => Promise<unknown>,
) => Promise<unknown>

/** agent/request 监听器的结构面(模型切换路径钉死用)。 */
type RequestListener = (
  payload: { agent: Agent; signal: AbortSignal },
  next: () => Promise<{ provider: string; model: string }>,
) => Promise<{ provider: string; model: string }>

/** C7 per-agent 状态的测试读法面(与 basic/index.ts 的 RefillState 同构)。 */
interface RefillStateShape {
  stepsSinceCompaction: number
  rapidStreak: number
}

/** 小 headroom 让 10_000 窗口的阈值可被测试会话触达(默认 headroom 65_536 会把压力预算打穿)。 */
const BASE_CONFIG: BasicCompactionConfig = { headroomTokens: 0, maxTokens: 4_096 }

/** 与 compactPressure 同源解析的压力规格:threshold = floor(min(W×0.8, W−O−B))。 */
const SPEC = resolveCompactSpec(
  resolveTargetPolicy(resolveConfig(BASE_CONFIG), { provider: 'p', model: 'm' }),
  10_000,
  1_000,
)
// 16_000 字符 ≈ ceil(16_000/4)+8 = 4_008 token/条:两条 8_016 ≥ 阈值 8_000,初始即过压。
const BODY = 'x'.repeat(16_000)

let homeDir = ''

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'eterna-compaction-refill-'))
  process.env.DSH_HOME = homeDir
})

afterEach(async () => {
  delete process.env.DSH_HOME
  await rm(homeDir, { recursive: true, force: true })
})

function statePath(): string {
  return join(homeDir, '.eterna', 'compaction.state.json')
}

function readState(): { rapidRefillCount?: number; lastRapidRefillAt?: string | null } {
  return JSON.parse(readFileSync(statePath(), 'utf8')) as Record<string, never>
}

function refillStateOf(
  engine: BasicCompactionEngine,
  agent: Agent,
): RefillStateShape | undefined {
  const states = (engine as unknown as {
    refillStates?: WeakMap<Agent, RefillStateShape>
  }).refillStates
  return states?.get(agent)
}

/**
 * 熔断 harness:makeEngine 绕过构造器(不落状态文件、不注册监听器),C7 私有字段
 * 由这里显式铺齐(生产构造器以类字段初始化器自建);需要哪个副作用由测试显式调用。
 */
function makeRefillHarness(config: BasicCompactionConfig = BASE_CONFIG) {
  const meter: FakeMeterFace = createFakeMeter()
  const harness = makeFakeEngineContext(meter)
  harness.setModelInfo({ contextWindow: 10_000, defaultMaxTokens: 1_000 })
  const engine = makeEngine(harness.ctx, config)
  const seeded = engine as unknown as {
    refillStates: WeakMap<Agent, RefillStateShape>
    rapidRefillCount: number
    lastRapidRefillAt: string | null
  }
  seeded.refillStates = new WeakMap()
  seeded.rapidRefillCount = 0
  seeded.lastRapidRefillAt = null
  registerAutomaticCompaction(engine)

  const { session }: { session: Session } = makePressureSession(BODY)
  const agent = makeFakeAgent(session, 'p', 'm')
  const preStep = harness.listenersOf('agent/pre-step')[0] as unknown as PreStepListener
  if (preStep === undefined) throw new Error('agent/pre-step listener not registered')
  const request = harness.listenersOf('agent/request')[0] as unknown as RequestListener

  // 摘要桩:C3 结构合法摘要,4 发够覆盖最长的用例(熔断步不消费)。
  const face = fakeSummarizer([
    MINIMAL_VALID_SUMMARY,
    MINIMAL_VALID_SUMMARY,
    MINIMAL_VALID_SUMMARY,
    MINIMAL_VALID_SUMMARY,
  ])
  ;(engine as unknown as { summarize: unknown }).summarize = face

  const dispatchPreStep = () =>
    preStep({ agent, signal: SIGNAL }, async () => 'next-result')
  const dispatchModelSwitch = () =>
    request({ agent, signal: SIGNAL }, async () => ({ provider: 'p2', model: 'm2' }))
  // 模拟"快速回满":压缩后追加 16K 大消息直到压力重新过阈值(+1_000 余量)。
  const refill = (): void => {
    while (meter.measure(session).totalTokens < SPEC.thresholdTokens + 1_000) {
      appendUserMessage(session, BODY)
    }
  }
  return {
    harness,
    engine,
    session,
    agent,
    face,
    refill,
    dispatchPreStep,
    dispatchModelSwitch,
  }
}

describe('C7 rapid-refill 熔断', () => {
  it('压缩后 3 步窗口内连续 3 次压力触发:第 3 次熔断跳过自动压缩,state 计数落盘', async () => {
    const { harness, engine, session, agent, face, refill, dispatchPreStep } = makeRefillHarness()

    // 步 1:过压触发 → 摘要压缩成功(连击 1),步距归零。
    expect(await dispatchPreStep()).toBe('next-result')
    expect(face.calls.length).toBe(1)
    // 步 2:快速回满再触发 → 再压缩成功(连击 2)。
    refill()
    expect(await dispatchPreStep()).toBe('next-result')
    expect(face.calls.length).toBe(2)
    // 步 3:再次回满再触发 → 连击 3 达限:零摘要工作、surface 不动、请求放行。
    refill()
    const generationBeforeTrip = session.surface.replaceGeneration
    expect(await dispatchPreStep()).toBe('next-result')
    expect(face.calls.length).toBe(2)
    expect(session.surface.replaceGeneration).toBe(generationBeforeTrip)
    expect(harness.warns).toHaveLength(1)
    expect(harness.warns[0]).toContain('rapid-refill breaker')
    expect(harness.warns[0]).toContain('skipping automatic pressure compaction')

    // state 文件:累计计数 + ISO 时间戳,且既有配置键不受影响。
    const state = readState()
    expect(state.rapidRefillCount).toBe(1)
    expect(typeof state.lastRapidRefillAt).toBe('string')
    expect(Number.isNaN(Date.parse(state.lastRapidRefillAt ?? ''))).toBe(false)
    expect((readState() as unknown as { thresholdRatio: number }).thresholdRatio).toBe(0.8)

    // 熔断步的步距照常递增(恢复窗口依赖它),连击保留在限值。
    expect(refillStateOf(engine, agent)).toEqual({ stepsSinceCompaction: 1, rapidStreak: 3 })
  })

  it('连击跨压缩保留;步距 ≥3 衰减归零后自动压缩恢复', async () => {
    const { harness, engine, session, agent, face, refill, dispatchPreStep } = makeRefillHarness()

    // 三连触发:步 1、2 压缩,步 3 熔断(#1)。
    await dispatchPreStep()
    refill()
    await dispatchPreStep()
    refill()
    await dispatchPreStep()
    expect(readState().rapidRefillCount).toBe(1)
    // 熔断未解除:步 4 仍触发(步距 2 < 3,连击 4)→ 第 2 次计数递增。
    refill()
    await dispatchPreStep()
    expect(readState().rapidRefillCount).toBe(2)
    expect(harness.warns).toHaveLength(2)
    expect(face.calls.length).toBe(2)
    // 步 5:步距达 3 → 连击衰减归零 → 自动压缩恢复(第 3 发摘要落地)。
    refill()
    const generationBeforeRecovery = session.surface.replaceGeneration
    expect(await dispatchPreStep()).toBe('next-result')
    expect(face.calls.length).toBe(3)
    expect(session.surface.replaceGeneration).toBeGreaterThan(generationBeforeRecovery)
    expect(readState().rapidRefillCount).toBe(2)
    expect(harness.warns).toHaveLength(2)
    // 恢复步压缩成功 → 步距归零;连击已衰减,不再带限值。
    expect(refillStateOf(engine, agent)).toEqual({ stepsSinceCompaction: 0, rapidStreak: 0 })
  })

  it('静默步不进连击:压缩后步距拉开(≥3 步未触发)再触发不熔断(零误报)', async () => {
    const { harness, engine, agent, face, refill, dispatchPreStep } = makeRefillHarness()

    // 步 1 触发并压缩成功(连击 1,步距归零)。
    await dispatchPreStep()
    expect(face.calls.length).toBe(1)
    // 步 2-4 压力未达(静默):步距递增,连击不得累计——真实触发语义钉死。
    await dispatchPreStep()
    await dispatchPreStep()
    await dispatchPreStep()
    expect(face.calls.length).toBe(1)
    expect(harness.warns).toHaveLength(0)
    expect(existsSync(statePath())).toBe(false)
    // 步 5 回满再触发:步距 ≥3 → 连击衰减归零 → 正常压缩,不熔断。
    refill()
    expect(await dispatchPreStep()).toBe('next-result')
    expect(face.calls.length).toBe(2)
    expect(harness.warns).toHaveLength(0)
    expect(existsSync(statePath())).toBe(false)
    expect(refillStateOf(engine, agent)).toEqual({ stepsSinceCompaction: 0, rapidStreak: 0 })
  })

  it('手动 compactNow 不受限:熔断态下照常压缩,不写熔断计数', async () => {
    const { harness, engine, session, face, refill, dispatchPreStep } = makeRefillHarness()

    // 先把熔断打跳(步 1、2 压缩,步 3 熔断)。
    await dispatchPreStep()
    refill()
    await dispatchPreStep()
    refill()
    await dispatchPreStep()
    expect(readState().rapidRefillCount).toBe(1)
    refill()

    // 手动路径:idle 代理(runMaintenance 直通)+ 关闭 turn(compactNow owner=null 前提)。
    const idleAgent = makeFakeAgent(session, 'p', 'm') as unknown as {
      runMaintenance(fn: (signal: AbortSignal) => Promise<CompactionResult | null>): Promise<CompactionResult | null>
    }
    idleAgent.runMaintenance = async fn => fn(SIGNAL)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const result = await engine.compactNow(idleAgent as unknown as Agent, SIGNAL)
    expect(result).not.toBeNull()
    expect(result?.shadowedTokenCount).toBeGreaterThan(0)
    expect(face.calls.length).toBe(3)
    // 手动压缩不经过熔断:计数与告警都不变。
    expect(readState().rapidRefillCount).toBe(1)
    expect(harness.warns).toHaveLength(1)
  })

  it('模型切换压缩路径不受熔断限制(refillBreaker=false 钉死)', async () => {
    const { harness, face, refill, dispatchPreStep, dispatchModelSwitch } = makeRefillHarness()

    await dispatchPreStep()
    refill()
    await dispatchPreStep()
    refill()
    await dispatchPreStep()
    expect(readState().rapidRefillCount).toBe(1)
    refill()

    // 熔断态下切换模型:compactPressure(requireBelowThreshold=true)照常执行。
    expect(await dispatchModelSwitch()).toEqual({ provider: 'p2', model: 'm2' })
    expect(face.calls.length).toBe(3)
    expect(harness.infos.some(info => info.includes('model switch'))).toBe(true)
    expect(readState().rapidRefillCount).toBe(1)
    expect(harness.warns).toHaveLength(1)
  })

  it('auto=false:pre-step 全跳过,步距/连击状态不推进', async () => {
    const { harness, engine, agent, face, refill, dispatchPreStep } = makeRefillHarness({
      ...BASE_CONFIG,
      auto: false,
    })

    await dispatchPreStep()
    refill()
    await dispatchPreStep()
    refill()
    await dispatchPreStep()
    expect(face.calls.length).toBe(0)
    expect(harness.warns).toHaveLength(0)
    expect(existsSync(statePath())).toBe(false)
    expect(refillStateOf(engine, agent)).toBeUndefined()
  })
})
