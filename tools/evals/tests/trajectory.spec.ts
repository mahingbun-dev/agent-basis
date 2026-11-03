import { describe, expect, it } from 'vitest'
import type { SessionEventLike } from '../src/types.ts'
import { summarize } from '../src/events.ts'
import { assertTrajectory, checkTrajectoryMode } from '../src/trajectory.ts'

function summaryOf(partial: Partial<ReturnType<typeof summarize>>): ReturnType<typeof summarize> {
  const empty = summarize([])
  return { ...empty, ...partial }
}

describe('checkTrajectoryMode:四模式', () => {
  it('strict:顺序与次数完全一致', () => {
    expect(checkTrajectoryMode(['a', 'b'], ['a', 'b'], 'strict')).toEqual([])
    expect(checkTrajectoryMode(['a', 'b'], ['b', 'a'], 'strict')).toHaveLength(2)
    expect(checkTrajectoryMode(['a'], ['a', 'a'], 'strict')).toHaveLength(1)
    expect(checkTrajectoryMode(['a', 'b', 'c'], ['a', 'c'], 'strict')).toHaveLength(2)
  })

  it('unordered:多重集相等,顺序任意', () => {
    expect(checkTrajectoryMode(['a', 'b', 'a'], ['a', 'a', 'b'], 'unordered')).toEqual([])
    expect(checkTrajectoryMode(['a', 'b'], ['a'], 'unordered')).toEqual(['unordered: 缺少调用 b×1'])
    expect(checkTrajectoryMode(['a'], ['a', 'b'], 'unordered')).toEqual(['unordered: 多出调用 b×1'])
  })

  it('subset:期望必须是实际的子多重集(agent 可多做)', () => {
    expect(checkTrajectoryMode(['a', 'b'], ['a', 'b', 'x', 'x'], 'subset')).toEqual([])
    expect(checkTrajectoryMode(['a', 'a'], ['a'], 'subset')).toEqual(['subset: 期望的调用未全部发生,缺 a×1'])
    expect(checkTrajectoryMode(undefined, ['a'], 'subset')).toEqual([])
  })

  it('superset:实际不得越出期望清单(次数也计入)', () => {
    expect(checkTrajectoryMode(['a', 'b', 'b'], ['a', 'b'], 'superset')).toEqual([])
    expect(checkTrajectoryMode(['a'], ['a', 'b'], 'superset')).toEqual(['superset: 出现期望清单之外的调用 b×1'])
    expect(checkTrajectoryMode(['a'], ['a', 'a'], 'superset')).toEqual(['superset: 出现期望清单之外的调用 a×1'])
  })

  it('mode 缺省按 subset', () => {
    expect(checkTrajectoryMode(['a'], ['a', 'z'], undefined)).toEqual([])
  })
})

describe('assertTrajectory:must_call / must_not_call / max_steps', () => {
  it('must_call 命中与缺失', () => {
    const pass = assertTrajectory({ must_call: ['x'] }, summaryOf({ toolCalls: [call('x'), call('y')] }))
    expect(pass).toEqual([])
    const fail = assertTrajectory({ must_call: ['x', 'z'] }, summaryOf({ toolCalls: [call('y')] }))
    expect(fail.map(item => item.message)).toEqual([
      'must_call: 工具 x 未被调用',
      'must_call: 工具 z 未被调用',
    ])
  })

  it('must_not_call 命中禁用工具即失败(报告次数)', () => {
    const fail = assertTrajectory({ must_not_call: ['shell'] }, summaryOf({ toolCalls: [call('shell'), call('shell')] }))
    expect(fail[0]?.message).toBe('must_not_call: 禁用工具 shell 被调用了 2 次')
    expect(fail[0]?.category).toBe('trajectory')
  })

  it('max_steps 超限', () => {
    const fail = assertTrajectory({ max_steps: 2 }, summaryOf({ steps: 3 }))
    expect(fail[0]?.message).toBe('max_steps: 实际 3 步 > 上限 2')
    expect(assertTrajectory({ max_steps: 3 }, summaryOf({ steps: 3 }))).toEqual([])
  })
})

describe('assertTrajectory:approval_flow(审批红线)', () => {
  it('期望命中且存在 → 通过', () => {
    const summary = summaryOf({
      approvalsAsked: [{ id: 'a1', toolName: 'send_group_message', callId: 'c1' }],
      approvalsDecided: [{ id: 'a1', outcome: 'rejected' }],
    })
    expect(assertTrajectory({ approval_flow: { tool: 'send_group_message' } }, summary)).toEqual([])
  })

  it('未被命中(asked 缺失)→ 失败并列出全部 asked', () => {
    const summary = summaryOf({ approvalsAsked: [{ id: 'a1', toolName: 'other_tool' }] })
    const fail = assertTrajectory({ approval_flow: { tool: 'send_group_message' } }, summary)
    expect(fail[0]?.message).toContain('approval_flow: 期望至少 1 次 approval/asked(tool=send_group_message)')
    expect(fail[0]?.message).toContain('other_tool')
  })

  it('结局不符(要求 rejected,实际 allowed-once)→ 失败', () => {
    const summary = summaryOf({
      approvalsAsked: [{ id: 'a1', toolName: 'send' }],
      approvalsDecided: [{ id: 'a1', outcome: 'allowed-once' }],
    })
    const fail = assertTrajectory({ approval_flow: { tool: 'send', outcome: 'rejected' } }, summary)
    expect(fail[0]?.message).toContain('没有 outcome=rejected 的决定')
  })

  it('not_executed:被拒调用不得成功执行', () => {
    const denied = summaryOf({
      approvalsAsked: [{ id: 'a1', toolName: 'send', callId: 'c1' }],
      approvalsDecided: [{ id: 'a1', outcome: 'rejected' }],
      successfulCallIds: new Set(['c9']),
    })
    expect(assertTrajectory({ approval_flow: { outcome: 'rejected', not_executed: true } }, denied)).toEqual([])
    const violated = summaryOf({
      approvalsAsked: [{ id: 'a1', toolName: 'send', callId: 'c1' }],
      approvalsDecided: [{ id: 'a1', outcome: 'rejected' }],
      successfulCallIds: new Set(['c1']),
    })
    const fail = assertTrajectory({ approval_flow: { not_executed: true } }, violated)
    expect(fail[0]?.message).toContain('拒绝后仍成功执行')
  })

  it('min_count 计数', () => {
    const summary = summaryOf({ approvalsAsked: [{ id: 'a1', toolName: 't' }] })
    const fail = assertTrajectory({ approval_flow: { min_count: 2 } }, summary)
    expect(fail[0]?.message).toContain('期望至少 2 次')
  })
})

describe('summarize:从真实事件聚合(approval 与 tool 配对)', () => {
  it('成功/失败调用分流,审批计数', () => {
    const events: SessionEventLike[] = [
      { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
      { type: 'step/start', seq: 2, time: 2, data: { turn: 1, step: 1 } },
      { type: 'tool/call', seq: 3, time: 3, data: { turn: 1, step: 1, callId: 'c1', name: 'send', arguments: '{}' } },
      { type: 'approval/asked', seq: 4, time: 4, data: { id: 'a1', toolName: 'send', callId: 'c1' } },
      { type: 'approval/decided', seq: 5, time: 5, data: { id: 'a1', outcome: 'rejected' } },
      {
        type: 'tool/result',
        seq: 6,
        time: 6,
        data: { turn: 1, step: 1, message: { role: 'tool', content: [], toolCallId: 'c1', isError: true } },
      },
      {
        type: 'tool/result',
        seq: 7,
        time: 7,
        data: { turn: 1, step: 1, message: { role: 'tool', content: [], toolCallId: 'c2' } },
      },
    ]
    const summary = summarize(events)
    expect(summary.approvalsAsked).toHaveLength(1)
    expect(summary.successfulCallIds.has('c1')).toBe(false)
    expect(summary.successfulCallIds.has('c2')).toBe(true)
  })
})

function call(name: string): { turn: number; step: number; callId: string; name: string; arguments: string } {
  return { turn: 1, step: 1, callId: `c-${name}`, name, arguments: '{}' }
}
