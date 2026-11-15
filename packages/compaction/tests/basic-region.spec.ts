/**
 * basic/region 单测:selectCompactableRange 的空 surface、systemHead 首切点、
 * retain 从尾累计切点、tool 配对回退不拆对、keepFromIdx≤firstIdx 拒绝、
 * meter/surface 失配抛错。
 */
import { describe, expect, it } from 'vitest'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { selectCompactableRange } from '../src/basic/region.ts'
import {
  appendAssistantToolCall,
  appendSystemMessage,
  appendUserMessage,
  appendToolResult,
  createFakeMeter,
  makeSession,
} from './helpers/fakes.ts'
import type { TokenMeasurement } from '@deepseek-ai/dsh-token-meter'

describe('selectCompactableRange', () => {
  it('空 surface → null', () => {
    const session = makeSession()
    const measurement = createFakeMeter().measure(session)
    expect(selectCompactableRange(session, measurement, 0)).toBeNull()
  })

  it('systemHead 存在:firstIdx=1,range 不吞系统头', () => {
    const session = makeSession()
    appendSystemMessage(session, 1, 0, 'system prompt')
    appendUserMessage(session, 'q1')
    appendUserMessage(session, 'q2')
    const meter = createFakeMeter()
    const measurement = meter.measure(session)
    // retain=尾节点价 → keepFrom 恰落在尾节点,range=[u1..u1]。
    const retain = measurement.nodes[2]?.tokens ?? 0
    const range = selectCompactableRange(session, measurement, retain)
    expect(range).toEqual({ start: session.surface.nodes[1], end: session.surface.nodes[1] })
  })

  it('systemHead 缺席:firstIdx=0,range 从 node 0 起', () => {
    const session = makeSession()
    const q1 = appendUserMessage(session, 'q1')
    const q2 = appendUserMessage(session, 'q2')
    appendUserMessage(session, 'q3')
    const meter = createFakeMeter()
    const measurement = meter.measure(session)
    const retain = measurement.nodes[2]?.tokens ?? 0
    const range = selectCompactableRange(session, measurement, retain)
    expect(range).toEqual({ start: q1, end: q2 })
  })

  it('retain 预算从尾累计:恰好等于尾两节点价之和时切点落在其前', () => {
    const session = makeSession()
    const q1 = appendUserMessage(session, 'q1')
    appendUserMessage(session, 'q2')
    appendUserMessage(session, 'q3')
    const meter = createFakeMeter()
    const measurement = meter.measure(session)
    // retain=尾两节点价之和(闭边界)→ 尾两节点保留,range 只剩 q1。
    const retain = (measurement.nodes[1]?.tokens ?? 0) + (measurement.nodes[2]?.tokens ?? 0)
    const range = selectCompactableRange(session, measurement, retain)
    expect(range).toEqual({ start: q1, end: q1 })
  })

  it('keepFromIdx≤firstIdx → null(无系统头与仅一用户两型)', () => {
    const bare = makeSession()
    appendUserMessage(bare, 'q1')
    appendUserMessage(bare, 'q2')
    const bareMeter = createFakeMeter()
    const bareMeasurement = bareMeter.measure(bare)
    const total = bareMeasurement.nodes.reduce((sum, node) => sum + node.tokens, 0)
    expect(selectCompactableRange(bare, bareMeasurement, total + 1)).toBeNull()

    const withSystem = makeSession()
    appendSystemMessage(withSystem, 1, 0, 'system prompt')
    appendUserMessage(withSystem, 'q1')
    const withMeter = createFakeMeter()
    const withMeasurement = withMeter.measure(withSystem)
    const userPrice = withMeasurement.nodes[1]?.tokens ?? 0
    // keepFrom=1(唯一用户)≤ firstIdx=1(系统头后)→ 无可压缩区间。
    expect(selectCompactableRange(withSystem, withMeasurement, userPrice)).toBeNull()
  })

  it('toolPairingBalancedBefore 回退:不拆 assistant call/result 对', () => {
    const session = makeSession()
    const q1 = appendUserMessage(session, 'q1')
    appendAssistantToolCall(session, 1, 1, 'call-1', 'read')
    const resultSeq = appendToolResult(session, 1, 1, 'call-1', 'output')
    appendUserMessage(session, 'q2')
    const meter = createFakeMeter()
    const measurement = meter.measure(session)
    // retain=尾两节点(result+q2)价:naive 切点落在 result 前,但 call 未闭合 →
    // 回退到 assistant 前的平衡切点,整对保留,range 只遮蔽 q1。
    const retain = (measurement.nodes[2]?.tokens ?? 0) + (measurement.nodes[3]?.tokens ?? 0)
    const range = selectCompactableRange(session, measurement, retain)
    expect(range).toEqual({ start: q1, end: q1 })

    // retain=仅 q2 价:切点落在 q2 前(对已闭合)→ 整对随区间一起被遮蔽。
    const narrow = selectCompactableRange(session, measurement, measurement.nodes[3]?.tokens ?? 0)
    expect(narrow).toEqual({ start: q1, end: resultSeq })
  })

  it('surface 与 meter nodes 不齐 → 抛错', () => {
    const session = makeSession()
    appendUserMessage(session, 'q1')
    const mismatched: TokenMeasurement = {
      logRevision: session.seq,
      baseline: { kind: 'none', tokens: 0 },
      surfaceDeltaTokens: 0,
      totalTokens: 0,
      surfaceTokens: 0,
      nodes: [{ seq: SessionSeq(99), tokens: 1, heuristicTokens: 1 }],
    }
    expect(() => selectCompactableRange(session, mismatched, 0))
      .toThrow('compaction: token-meter surface does not match the current session surface')
  })
})
