/**
 * 裁判输入投影:任务识别(只认真人 user 消息)、逐轮摘要、工具配对、滑窗渲染。
 */
import { describe, expect, it } from 'vitest'
import {
  JUDGE_WINDOW_MAX_CHARS, JUDGE_WINDOW_MAX_TURNS, projectJudgeInput, renderJudgeUserText,
} from '../src/judge-input.ts'
import type { SessionEventLike } from '../src/types.ts'

/** 两轮会话:合成注入先到(不算任务),轮 1 有一次成功与一次失败调用。 */
const EVENTS: readonly SessionEventLike[] = [
  { type: 'user/message', time: 1, data: { content: [{ type: 'text', text: '[系统] 已附加工作区上下文' }], source: { kind: 'system' } } },
  { type: 'user/message', time: 2, data: { content: [{ type: 'text', text: '把登录页按钮改成主色' }], source: { kind: 'user' } } },
  { type: 'turn/start', time: 3, data: { turn: 1 } },
  { type: 'assistant/message', time: 4, data: { turn: 1, message: { content: [{ type: 'text', text: '我先看看现有样式。' }] } } },
  { type: 'tool/call', time: 5, data: { turn: 1, callId: 'c1', name: 'fs_read', arguments: '{"path":"login.css"}' } },
  { type: 'tool/result', time: 6, data: { turn: 1, message: { toolCallId: 'c1', isError: false, content: [{ type: 'text', text: '.btn { color: gray }' }] } } },
  { type: 'tool/call', time: 7, data: { turn: 1, callId: 'c2', name: 'fs_edit', arguments: 'not-json' } },
  { type: 'tool/result', time: 8, data: { turn: 1, message: { toolCallId: 'c2', isError: true, content: [{ type: 'text', text: 'bad args' }] } } },
  { type: 'turn/end', time: 9, data: { turn: 1, reason: { kind: 'completed' } } },
  { type: 'turn/start', time: 10, data: { turn: 2 } },
  { type: 'user/message', time: 11, data: { content: [{ type: 'text', text: '顺便把 hover 也调了' }], source: { kind: 'user' } } },
  { type: 'assistant/message', time: 12, data: { turn: 2, message: { content: [{ type: 'text', text: '已改好并自测。' }] } } },
  { type: 'turn/end', time: 13, data: { turn: 2, reason: { kind: 'completed' } } },
]

describe('projectJudgeInput', () => {
  it('任务 = 第一条真人 user 消息(合成注入不算)', () => {
    const input = projectJudgeInput(EVENTS)
    expect(input.task).toBe('把登录页按钮改成主色')
    expect(input.turns).toHaveLength(2)
    expect(input.totalChars).toBeGreaterThan(0)
  })

  it('逐轮用户文本按事件序合并(轮内后续输入也算该轮)', () => {
    const input = projectJudgeInput(EVENTS)
    expect(input.turns[0]?.userText).toBe('把登录页按钮改成主色')
    expect(input.turns[1]?.userText).toBe('顺便把 hover 也调了')
    expect(input.turns[1]?.endReason).toBe('completed')
  })

  it('工具调用按 turn 归位,结果预览与成败配对', () => {
    const input = projectJudgeInput(EVENTS)
    const calls = input.turns[0]?.toolCalls ?? []
    expect(calls.map(call => call.name)).toEqual(['fs_read', 'fs_edit'])
    expect(calls[0]).toMatchObject({ ok: true })
    expect(calls[0]?.result).toContain('.btn')
    expect(calls[1]).toMatchObject({ ok: false })
  })

  it('空事件 → 空输入(任务空串、零轮)', () => {
    expect(projectJudgeInput([])).toEqual({ task: '', turns: [], totalChars: 0 })
  })
})

describe('renderJudgeUserText', () => {
  it('session 口径:含任务与全部轮次', () => {
    const text = renderJudgeUserText(projectJudgeInput(EVENTS), 'session')
    expect(text).toContain('## 任务（用户原始要求）')
    expect(text).toContain('把登录页按钮改成主色')
    expect(text).toContain('### 第 1 轮')
    expect(text).toContain('### 第 2 轮')
    expect(text.length).toBeLessThanOrEqual(JUDGE_WINDOW_MAX_CHARS)
  })

  it('turn 口径:只保留目标轮及其前 2 轮', () => {
    const turns = Array.from({ length: 6 }, (_, index) => ({
      type: 'turn/start', time: index * 10, data: { turn: index + 1 },
    })) as SessionEventLike[]
    const withContent: SessionEventLike[] = turns.map((event, index) => ({
      ...event,
      data: { turn: index + 1 },
    }))
    const text = renderJudgeUserText(projectJudgeInput(withContent), 'turn', 6)
    expect(text).toContain('### 第 6 轮')
    expect(text).toContain(`### 第 ${6 - JUDGE_WINDOW_MAX_TURNS + 1} 轮`)
    expect(text).not.toContain('### 第 1 轮')
  })

  it('超长轨迹按字符上限截断并显式标注', () => {
    const events: SessionEventLike[] = [{ type: 'user/message', time: 1, data: { content: [{ type: 'text', text: '任务' }], source: { kind: 'user' } } }]
    for (let turn = 1; turn <= 40; turn += 1) {
      events.push({ type: 'turn/start', time: turn * 10, data: { turn } })
      events.push({
        type: 'assistant/message',
        time: turn * 10 + 1,
        data: { turn, message: { content: [{ type: 'text', text: 'x'.repeat(500) }] } },
      })
      events.push({ type: 'turn/end', time: turn * 10 + 2, data: { turn, reason: { kind: 'completed' } } })
    }
    const input = projectJudgeInput(events)
    expect(input.totalChars).toBeGreaterThan(JUDGE_WINDOW_MAX_CHARS)
    const text = renderJudgeUserText(input, 'session')
    expect(text).toContain('已按字符上限从末轮向前截断')
    expect(text).toContain('### 第 40 轮')
    expect(text.length).toBeLessThanOrEqual(JUDGE_WINDOW_MAX_CHARS)
  })

  it('无任务时如实说明,不编造', () => {
    const text = renderJudgeUserText(projectJudgeInput([]), 'session')
    expect(text).toContain('未记录到用户原始消息')
    expect(text).toContain('该轮次没有可用内容')
  })
})
