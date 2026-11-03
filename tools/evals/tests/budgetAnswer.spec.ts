import { describe, expect, it } from 'vitest'
import type { SessionEventLike } from '../src/types.ts'
import { summarize } from '../src/events.ts'
import { assertAnswer, assertBudget } from '../src/budget.ts'

describe('assertAnswer', () => {
  it('contains 命中', () => {
    expect(assertAnswer({ contains: '方案已生成' }, '方案已生成:plan.md')).toEqual([])
  })

  it('contains 未命中给出截断摘录', () => {
    const failures = assertAnswer({ contains: '不存在' }, '这是一段很长的回答'.repeat(20))
    expect(failures[0]?.category).toBe('answer')
    expect(failures[0]?.message).toContain('最终回答未包含')
    expect(failures[0]?.message.length).toBeLessThan(200)
  })

  it('match 正则与 ignore_case', () => {
    expect(assertAnswer({ match: '^完成.*$', ignore_case: true }, '完成了全部工作')).toEqual([])
    expect(assertAnswer({ match: '^完成$' }, '未完成')).toHaveLength(1)
    expect(assertAnswer({ contains: 'OK', ignore_case: true }, '结果是 ok 的')).toEqual([])
    expect(assertAnswer({ contains: 'OK' }, '结果是 ok 的')).toHaveLength(1)
  })

  it('无 answer 声明直接通过', () => {
    expect(assertAnswer(undefined, '')).toEqual([])
  })
})

describe('assertBudget + summarize 的 token 口径', () => {
  it('max_turns 超限', () => {
    const failures = assertBudget({ max_turns: 2 }, { ...summarize([]), turns: 5 })
    expect(failures[0]?.category).toBe('budget')
    expect(failures[0]?.message).toContain('5 轮')
  })

  it('max_tokens:totalTokens 优先于分量和', () => {
    const events: SessionEventLike[] = [
      assistantUsage({ inputTokens: 100, outputTokens: 50, totalTokens: 1000 }),
      assistantUsage({ inputTokens: 200, outputTokens: 100, cacheReadTokens: 40, cacheWriteTokens: 10 }),
    ]
    const summary = summarize(events)
    expect(summary.totalTokens).toBe(1000 + 350)
    expect(assertBudget({ max_tokens: 1350 }, summary)).toEqual([])
    expect(assertBudget({ max_tokens: 1349 }, summary)).toHaveLength(1)
  })

  it('无 usage 的 assistant/message 计 0', () => {
    const events: SessionEventLike[] = [
      { type: 'assistant/message', seq: 1, time: 1, data: { turn: 1, step: 1, message: { role: 'assistant', content: [] }, stream: [] } },
    ]
    expect(summarize(events).totalTokens).toBe(0)
  })
})

function assistantUsage(usage: Record<string, number>): SessionEventLike {
  return {
    type: 'assistant/message',
    seq: 1,
    time: 1,
    data: {
      turn: 1, step: 1,
      message: { role: 'assistant', content: [{ type: 'text', text: 'x' }] },
      stream: [],
      usage,
    },
  }
}
