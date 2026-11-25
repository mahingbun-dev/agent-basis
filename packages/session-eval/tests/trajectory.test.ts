/**
 * 轨迹投影单测:全部期望值**手算**(56 号 §5.7 P0 验收口径「指标手算对账」)。
 * 样本见 tests/fixture.ts。
 */
import { describe, expect, it } from 'vitest'
import { projectTrajectory } from '../src/trajectory.ts'
import { FIXTURE_EVENTS } from './fixture.ts'


describe('projectTrajectory(手算对账)', () => {
  const trajectory = projectTrajectory('session-eval-fixture', FIXTURE_EVENTS)

  it('窗口与轮次:18 事件 / seq 1–18 / 2 轮各有 1 步', () => {
    expect(trajectory.window).toEqual({ events: 18, firstSeq: 1, lastSeq: 18, firstTime: 1000, lastTime: 15000 })
    expect(trajectory.turns.map(turn => [turn.turn, turn.steps, turn.toolCalls, turn.failedCalls, turn.endReason]))
      .toEqual([
        [1, 1, 2, 1, 'completed'],
        [2, 1, 2, 1, 'error'],
      ])
  })

  it('轮耗时 = turn/end.time − turn/start.time(8000 / 5000)', () => {
    expect(trajectory.turns.map(turn => turn.durationMs)).toEqual([8000, 5000])
  })

  it('工具调用:4 次,失败 2 次,参数非法 1 次,未知工具 1 次,重复 1 次', () => {
    expect(trajectory.calls.map(call => call.callId)).toEqual(['c1', 'c2', 'c3', 'c4'])
    expect(trajectory.calls.filter(call => call.failed).map(call => call.callId)).toEqual(['c2', 'c3'])
    expect(trajectory.calls.filter(call => !call.argsValid).map(call => call.callId)).toEqual(['c2'])
    expect(trajectory.calls.filter(call => call.knownTool === false).map(call => call.callId)).toEqual(['c3'])
    expect(trajectory.calls.filter(call => call.repeatOf !== undefined).map(call => [call.callId, call.repeatOf]))
      .toEqual([['c4', { turn: 1, step: 1 }]])
    expect(trajectory.calls.find(call => call.callId === 'c2')?.errorCode).toBe('BAD_ARGS')
  })

  it('用量四桶与缓存命中率:input 1000 / output 200 / cacheRead 3000 → billed 4200,命中 75%', () => {
    expect(trajectory.usage).toEqual({ input: 1000, output: 200, cacheRead: 3000, cacheWrite: 0, reasoning: 0, billed: 4200 })
    expect(trajectory.cacheHitRate).toBeCloseTo(0.75, 10)
    expect(trajectory.modelCalls).toBe(1)
  })

  it('审批:1 问 1 决 1 拒,关联到 c2 / fs_grep', () => {
    expect(trajectory.approvals).toEqual({
      asked: 1,
      decided: 1,
      denied: 1,
      deniedCallIds: ['c2'],
      deniedToolNames: ['fs_grep'],
    })
  })

  it('工具面清单来自 request/header,路由取 header.config', () => {
    expect(trajectory.knownTools).toEqual(['fs_read', 'fs_grep'])
    expect(trajectory.route).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
  })
})

describe('projectTrajectory 的容错口径', () => {
  it('空事件 → 空轨迹(不抛、不伪造)', () => {
    const trajectory = projectTrajectory('s', [])
    expect(trajectory.window.events).toBe(0)
    expect(trajectory.turns).toEqual([])
    expect(trajectory.calls).toEqual([])
    expect(trajectory.usage.billed).toBe(0)
    expect(trajectory.cacheHitRate).toBeNull()
    expect(trajectory.knownTools).toEqual([])
    expect(trajectory.route).toBeNull()
  })

  it('未知事件类型与畸形载荷静默跳过(前向兼容)', () => {
    const trajectory = projectTrajectory('s', [
      { type: 'plugin:future/thing', seq: 1, data: { anything: true } },
      { type: 'tool/call', seq: 2, data: { turn: 'x', step: 1, callId: 'c', name: 'n', arguments: '{}' } },
      { type: 'assistant/message', seq: 3, data: { turn: 1, step: 1 } },
      { type: 'turn/start', seq: 4, data: { turn: 1 } },
      { type: 'tool/call', seq: 5, data: 'not-an-object' },
    ])
    expect(trajectory.window.events).toBe(5)
    expect(trajectory.calls).toEqual([])
    expect(trajectory.turns).toHaveLength(1)
    expect(trajectory.cacheHitRate).toBeNull()
  })

  it('无 header 工具清单 → knownTool 缺席(不判非法工具)', () => {
    const trajectory = projectTrajectory('s', [
      { type: 'tool/call', seq: 1, data: { turn: 1, step: 1, callId: 'c', name: 'who_knows', arguments: '{}' } },
    ])
    expect(trajectory.knownTools).toEqual([])
    expect(trajectory.calls[0]?.knownTool).toBeUndefined()
  })

  it('参数对象判定:空串/数组/标量都不算合法,对象算合法', () => {
    const cases: readonly [string, boolean][] = [
      ['{"a":1}', true],
      ['[]', false],
      ['"text"', false],
      ['', false],
      ['{oops', false],
    ]
    const trajectory = projectTrajectory('s', cases.map(([raw], index) => ({
      type: 'tool/call',
      seq: index + 1,
      data: { turn: 1, step: 1, callId: `c${index}`, name: 'n', arguments: raw },
    })))
    expect(trajectory.calls.map(call => call.argsValid)).toEqual(cases.map(([, valid]) => valid))
  })
})
