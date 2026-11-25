/**
 * 口径交叉验证:本包轨迹的用量桶必须与 `@eterna/observe` 的聚合器**逐字段相等**。
 *
 * 为什么需要:56 号 G6 记载本仓存在「事件解析分居两侧」的结构债;P0 依赖 observe
 * 作为口径真值源(轮/步/四桶/缓存命中/结束原因),而本包又自带一份轨迹投影。
 * 两份实现一旦漂移,面板数字会与用量统计对不上。这里用同一事件数组把两份产物
 * 钉在一起;observe 升级改变口径时本测试先红,而不是线上两个数字互相矛盾。
 */
import { aggregateSessionMetrics } from '@eterna/observe'
import { describe, expect, it } from 'vitest'
import { projectTrajectory } from '../src/trajectory.ts'
import type { SessionEventLike } from '../src/types.ts'
import { FIXTURE_EVENTS } from './fixture.ts'

/** 再补一个多路由 + 缓存缺席样本(命中率 null 的边界). */
const MULTI_ROUTE_EVENTS: readonly SessionEventLike[] = [
  { type: 'turn/start', seq: 1, time: 1_000, data: { turn: 1 } },
  { type: 'step/start', seq: 2, time: 1_010, data: { turn: 1, step: 1 } },
  { type: 'request/header', seq: 3, time: 1_020, data: { header: { config: { provider: 'deepseek', model: 'deepseek-reasoner' } } } },
  { type: 'assistant/message', seq: 4, time: 2_000, data: { turn: 1, step: 1, usage: { inputTokens: 500, outputTokens: 100 } } },
  { type: 'turn/end', seq: 5, time: 3_000, data: { turn: 1, reason: { kind: 'completed' } } },
]

describe('与 observe 聚合器同口径', () => {
  it('轮/步/四桶/缓存命中率逐字段相等', () => {
    const aggregate = aggregateSessionMetrics(FIXTURE_EVENTS)
    const trajectory = projectTrajectory('s', FIXTURE_EVENTS)
    expect(trajectory.turns.length).toBe(aggregate.turns)
    expect(trajectory.turns.reduce((sum, turn) => sum + turn.steps, 0)).toBe(aggregate.steps)
    expect(trajectory.usage).toEqual(aggregate.tokens)
    expect(trajectory.cacheHitRate).toBe(aggregate.cacheHitRate)
  })

  it('结束原因计数一致(turn/end.reason.kind)', () => {
    const aggregate = aggregateSessionMetrics(FIXTURE_EVENTS)
    const trajectory = projectTrajectory('s', FIXTURE_EVENTS)
    const counts: Record<string, number> = {}
    for (const turn of trajectory.turns) {
      if (turn.endReason !== undefined) counts[turn.endReason] = (counts[turn.endReason] ?? 0) + 1
    }
    expect(counts).toEqual(aggregate.turnEnd)
  })

  it('未报告缓存桶时两边都给 null(不伪报 0)', () => {
    const aggregate = aggregateSessionMetrics(MULTI_ROUTE_EVENTS)
    const trajectory = projectTrajectory('s', MULTI_ROUTE_EVENTS)
    expect(aggregate.cacheHitRate).toBeNull()
    expect(trajectory.cacheHitRate).toBeNull()
    expect(trajectory.route).toEqual({ provider: 'deepseek', model: 'deepseek-reasoner' })
  })

  it('逐轮失败计数只来自 callId 配对,不重复计同一 result', () => {
    const duplicated: readonly SessionEventLike[] = [
      ...FIXTURE_EVENTS,
      // 同一 callId 的第二条 result(上游不会发生;这里验证投影不会重复累加失败数)。
      { type: 'tool/result', seq: 99, time: 20_000, data: { turn: 1, step: 1, message: { toolCallId: 'c2', isError: true }, error: { code: 'BAD_ARGS' } } },
    ]
    const trajectory = projectTrajectory('s', duplicated)
    expect(trajectory.calls.find(call => call.callId === 'c2')?.failed).toBe(true)
    expect(trajectory.turns[0]?.failedCalls).toBe(1)
  })
})
