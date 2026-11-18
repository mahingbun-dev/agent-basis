/**
 * 会话上下文信号提取:窗口扫描口径(失败、同工具连续失败、同题追问、规模)。
 * 事件形状参照 dsh-session 耐久载荷:user/message data=UserMessage 本身,
 * assistant/message 与 tool/result data={ message, ... }。
 */
import { describe, expect, it } from 'vitest'
import { deriveSessionSignals, textOverlap, type SessionEventLike } from '../src/thinking-context.ts'

const T0 = Date.parse('2026-11-18T10:00:00.000Z')
const minutes = (n: number): string => new Date(T0 + n * 60_000).toISOString()

function userEvent(text: string, at: string, kind = 'user'): SessionEventLike {
  return { type: 'user/message', at, data: { role: 'user', source: { kind }, content: [{ type: 'text', text }] } }
}

function assistantEvent(text: string, at: string): SessionEventLike {
  return { type: 'assistant/message', at, data: { message: { role: 'assistant', content: [{ type: 'text', text }] } } }
}

function toolCall(name: string, callId: string, at: string): SessionEventLike {
  return { type: 'tool/call', at, data: { turn: 1, step: 1, callId, name, arguments: '{}' } }
}

function toolResult(callId: string, isError: boolean, at: string): SessionEventLike {
  return {
    type: 'tool/result',
    at,
    data: { message: { role: 'tool', isError, toolCallId: callId, content: [{ type: 'text', text: isError ? 'boom' : 'ok' }] } },
  }
}

describe('textOverlap', () => {
  it('containment 口径:短句是长句片段即高重叠;无关句为 0;空串为 0', () => {
    expect(textOverlap('帮我看看这个报错', '帮我看看这个报错吧')).toBeGreaterThan(0.8)
    expect(textOverlap('帮我看看这个报错', '今天天气怎么样')).toBe(0)
    expect(textOverlap('', '任意')).toBe(0)
  })
})

describe('deriveSessionSignals', () => {
  it('空窗口=全零(仅窗口数 0),不抛', () => {
    expect(deriveSessionSignals([], T0, '你好')).toEqual({
      toolFailureStreak: 0,
      sameToolFailureStreak: 0,
      followUpOverlap: 0,
      followUpGapMinutes: Number.POSITIVE_INFINITY,
      windowEvents: 0,
      recentChars: 0,
    })
  })

  it('本轮失败计数:最后一条真人消息之后的失败全部计数;成功不打断计数', () => {
    const events = [
      userEvent('跑一下测试', minutes(0)),
      toolCall('bash', 'c1', minutes(1)),
      toolResult('c1', true, minutes(1)),
      toolResult('c2', false, minutes(2)),
      toolResult('c3', true, minutes(3)),
    ]
    const signals = deriveSessionSignals(events, T0 + 4 * 60_000, '继续')
    expect(signals.toolFailureStreak).toBe(2)
  })

  it('同一工具连续失败:尾部相邻同名失败才累计;中间夹成功即止', () => {
    const sameTool = [
      userEvent('跑一下测试', minutes(0)),
      toolCall('bash', 'c1', minutes(1)),
      toolCall('bash', 'c2', minutes(1)),
      toolResult('c1', true, minutes(1)),
      toolResult('c2', true, minutes(2)),
    ]
    expect(deriveSessionSignals(sameTool, T0 + 3 * 60_000, '继续').sameToolFailureStreak).toBe(2)

    const brokenBySuccess = [
      userEvent('跑一下测试', minutes(0)),
      toolCall('bash', 'c1', minutes(1)),
      toolCall('bash', 'c2', minutes(1)),
      toolResult('c1', true, minutes(1)),
      toolResult('c2', false, minutes(2)),
      toolResult('c3', true, minutes(3)),
    ]
    // 尾部只数到 c3 这一段(前面 c2 成功即断)
    expect(deriveSessionSignals(brokenBySuccess, T0 + 4 * 60_000, '继续').sameToolFailureStreak).toBe(1)
  })

  it('失败计数在某条真人消息处截断(更早轮次不参与)', () => {
    const events = [
      userEvent('第一轮', minutes(0)),
      toolCall('bash', 'c1', minutes(1)),
      toolResult('c1', true, minutes(1)),
      userEvent('第二轮', minutes(2)),
      toolCall('bash', 'c2', minutes(3)),
      toolResult('c2', false, minutes(3)),
    ]
    const signals = deriveSessionSignals(events, T0 + 4 * 60_000, '继续')
    expect(signals.toolFailureStreak).toBe(0)
  })

  it('同题追问:与上一条真人消息比(而非与日志里最后两条互比),缺时间戳按 0 分钟', () => {
    const events = [
      userEvent('帮我看下 auth 模块为什么会 401', minutes(0)),
      assistantEvent('可能是 token 过期', minutes(1)),
    ]
    const signals = deriveSessionSignals(events, T0 + 2 * 60_000, 'auth 模块为什么会 401?')
    expect(signals.followUpOverlap).toBeGreaterThan(0.6)
    expect(signals.followUpGapMinutes).toBeCloseTo(2)
  })

  it('系统源 user/message(runtime-context/notice)不参与同题追问', () => {
    const events = [
      userEvent('帮我看下 auth 模块为什么会 401', minutes(0)),
      userEvent('帮我看下 auth 模块为什么会 401', minutes(1), 'runtime-context'),
    ]
    const signals = deriveSessionSignals(events, T0 + 2 * 60_000, '完全无关的新问题')
    expect(signals.followUpOverlap).toBe(0)
  })

  it('规模代理:窗口事件数 + 最近 3 条文本字符', () => {
    const events = [
      userEvent('一'.repeat(200), minutes(0)),
      assistantEvent('二'.repeat(200), minutes(1)),
      userEvent('三'.repeat(200), minutes(2)),
      assistantEvent('四'.repeat(200), minutes(3)),
    ]
    const signals = deriveSessionSignals(events, T0 + 5 * 60_000, '继续')
    expect(signals.windowEvents).toBe(4)
    expect(signals.recentChars).toBe(600) // 只算最后 3 条
  })

  it('异形事件跳过不抛', () => {
    const events: SessionEventLike[] = [
      { type: 'unknown/thing' },
      { type: 'user/message', data: null },
      { type: 'tool/result', data: { message: { isError: true, toolCallId: 42 } } },
      {},
    ]
    const signals = deriveSessionSignals(events, T0, '你好')
    expect(signals.windowEvents).toBe(4)
    expect(signals.toolFailureStreak).toBe(1)
    expect(signals.sameToolFailureStreak).toBe(1)
  })
})
