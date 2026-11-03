/**
 * 组合门测试:createCacheGuard 服务面(id 注册键 / 纯函数转发 / 增量追踪 effect 配逆 /
 * dispose 后拒用 / 滑窗上限)。Cordis 纪律:track 累积 ↔ reset 清空互为逆,重放一致。
 */
import { describe, expect, it } from 'vitest'
import { analyzeStability, createCacheGuard } from '../src/index.ts'
import type { PromptAssembly, PromptSegment } from '../src/index.ts'

function seg(source: string, text: string): PromptSegment {
  return { source, text }
}

function turn(turnNo: number, sysText: string, messages: readonly string[]): PromptAssembly {
  return { turn: turnNo, segments: [seg('system', sysText), ...messages.map((text, i) => seg(`msg:${i + 1}`, text))] }
}

const STABLE_SYS = 'SYS You are an event planner. Current time: 10:00'

describe('createCacheGuard 组合门', () => {
  it('id 即注册键(CACHE_GUARD_SERVICE_ID 字面量类型)', () => {
    const guard = createCacheGuard()
    expect(guard.id).toBe('@basis/cache-guard')
    const id: '@basis/cache-guard' = guard.id
    expect(id).toBeTruthy()
    guard.dispose()
  })

  it('analyze 纯函数转发:与 analyzeStability 逐字段一致', () => {
    const guard = createCacheGuard()
    const assemblies = [
      turn(1, STABLE_SYS, ['Q1']),
      turn(2, STABLE_SYS, ['Q1', 'A1']),
    ]
    expect(guard.analyze(assemblies)).toEqual(analyzeStability(assemblies))
    guard.dispose()
  })

  it('track 增量追踪:稳定追加零告警;时间戳变化即告警;retentions 随窗口增长', () => {
    const guard = createCacheGuard()
    const r1 = guard.track(turn(1, STABLE_SYS, ['Q1']))
    expect(r1.transitions).toBe(0)
    expect(r1.warnings).toHaveLength(0)
    const r2 = guard.track(turn(2, STABLE_SYS, ['Q1', 'A1']))
    expect(r2.transitions).toBe(1)
    expect(r2.warnings).toHaveLength(0)
    expect(r2.score).toBe(1)
    const r3 = guard.track(turn(3, 'SYS You are an event planner. Current time: 11:00', ['Q1', 'A1', 'Q3']))
    expect(r3.transitions).toBe(2)
    expect(r3.warnings).toHaveLength(1)
    expect(r3.warnings[0]?.kind).toBe('volatile-timestamp')
    expect(r3.score).toBeLessThan(1)
    guard.dispose()
  })

  it('tracked 返回快照副本:外部改动不污染内部状态', () => {
    const guard = createCacheGuard()
    guard.track(turn(1, STABLE_SYS, ['Q1']))
    const snapshot = guard.tracked() as PromptAssembly[]
    snapshot.push(turn(99, 'x', []))
    expect(guard.tracked()).toHaveLength(1)
    guard.dispose()
  })

  it('reset 是 track 的逆:清空后重放同一序列结果一致', () => {
    const guard = createCacheGuard()
    guard.track(turn(1, STABLE_SYS, ['Q1']))
    guard.track(turn(2, 'SYS You are an event planner. Current time: 11:00', ['Q1', 'A1']))
    guard.reset()
    expect(guard.tracked()).toEqual([])
    const replay = guard.track(turn(1, STABLE_SYS, ['Q1']))
    expect(replay.transitions).toBe(0)
    expect(replay.warnings).toHaveLength(0)
    guard.dispose()
  })

  it('dispose 后 track 拒用(服务不可用),hitRate 纯函数面不受影响', () => {
    const guard = createCacheGuard()
    guard.dispose()
    expect(() => guard.track(turn(1, STABLE_SYS, ['Q1']))).toThrow(/disposed/)
    expect(guard.hitRate([]).calls).toBe(0)
  })

  it('maxTracked 滑窗:超限丢最旧,报告只看窗口内转移', () => {
    const guard = createCacheGuard({ maxTracked: 2 })
    guard.track(turn(1, 'SYS a: 10:00', ['Q1']))
    // 窗口 [turn1, turn2]:turn1→turn2 时间戳变化,一个失稳转移。
    const r2 = guard.track(turn(2, 'SYS a: 11:00', ['Q1', 'A1']))
    expect(r2.transitions).toBe(1)
    expect(r2.warnings).toHaveLength(1)
    // 第 3 轮入窗即滑出 turn1:报告(post-slide)只含 turn2→turn3,稳定零告警。
    const r3 = guard.track(turn(3, 'SYS a: 11:00', ['Q1', 'A1', 'Q3']))
    expect(r3.transitions).toBe(1)
    expect(r3.warnings).toHaveLength(0)
    expect(guard.tracked().map(a => a.turn)).toEqual([2, 3])
    const r4 = guard.track(turn(4, 'SYS a: 11:00', ['Q1', 'A1', 'Q3', 'Q4']))
    expect(r4.warnings).toHaveLength(0)
    guard.dispose()
  })

  it('hitRate/hitRateFromMetrics/report/extractors 服务面可用', () => {
    const guard = createCacheGuard()
    expect(guard.extractors['cache-usage']).toBeTypeOf('function')
    expect(guard.hitRate([{ type: 'assistant/message', data: { usage: { inputTokens: 0, outputTokens: 1, cacheReadTokens: 4 } } }]).hitRate).toBe(1)
    const fromMetrics = guard.hitRateFromMetrics({
      turns: 1, steps: 1, modelCalls: 1,
      tokens: { input: 0, output: 5, cacheRead: 10, cacheWrite: 0, reasoning: 0, billed: 15 },
      cacheHitRate: 1, costUsd: 0, unpricedBilledTokens: 0, turnEnd: {}, routes: [],
      window: { events: 1 }, perTurn: { costPerTurn: 0, billedTokensPerTurn: 15, errorTurnRate: 0 },
    })
    expect(fromMetrics.hitRate).toBe(1)
    expect(fromMetrics.promptTokens).toBe(10)
    expect(guard.report([]).calls).toBe(0)
    guard.dispose()
  })
})
