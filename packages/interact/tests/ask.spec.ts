/** 提问合并包装器测试(合并上限 ≤3 问/卡,设计文档 08 §6.3、12 §3.3)。 */
import { describe, expect, it } from 'vitest'
import {
  InteractConfigError, MAX_QUESTIONS_PER_CARD, TurnQuestionMerger, mergeQuestionDrafts, validateDraft,
} from '../src/index.ts'
import type { QuestionDraft, TurnFlushResult } from '../src/index.ts'

function draft(id: string, question = `问题 ${id}`): QuestionDraft {
  return { id, question, options: [{ label: 'A' }, { label: 'B' }] }
}

describe('mergeQuestionDrafts 纯合并', () => {
  it('同一 turn 三次单问 → 一张卡 3 问(上限内合并不拆分)', () => {
    const result = mergeQuestionDrafts([[draft('q1')], [draft('q2')], [draft('q3')]])
    expect(result.cards).toHaveLength(1)
    expect(result.cards[0]?.map(item => item.id)).toEqual(['q1', 'q2', 'q3'])
  })

  it('合并上限:7 问 → 3 张卡(3/3/1),每张 ≤3,顺序保持', () => {
    const ids = Array.from({ length: 7 }, (_, index) => `q${index + 1}`)
    const result = mergeQuestionDrafts([ids.map(id => draft(id))])
    expect(result.cards).toHaveLength(3)
    expect(result.cards.map(card => card.length)).toEqual([3, 3, 1])
    expect(result.cards.every(card => card.length <= MAX_QUESTIONS_PER_CARD)).toBe(true)
    expect(result.cards.flat().map(item => item.id)).toEqual(ids)
  })

  it('超过 3 问的两次 ask:4+2 → 2 张卡(3/3)', () => {
    const result = mergeQuestionDrafts([
      ['a1', 'a2', 'a3', 'a4'].map(id => draft(id)),
      ['b1', 'b2'].map(id => draft(id)),
    ])
    expect(result.cards.map(card => card.length)).toEqual([3, 3])
    expect(result.cards[1]?.map(item => item.id)).toEqual(['a4', 'b1', 'b2'])
  })

  it('同 turn 重复 id:保留首个,后续丢弃并记录(挤牙膏式重问被吃掉)', () => {
    const result = mergeQuestionDrafts([[draft('q1')], [draft('q2')], [draft('q1', '重问')]])
    expect(result.cards).toHaveLength(1)
    expect(result.cards[0]?.map(item => item.id)).toEqual(['q1', 'q2'])
    expect(result.cards[0]?.find(item => item.id === 'q1')?.question).toBe('问题 q1')
    expect(result.droppedDuplicateIds).toEqual(['q1'])
  })

  it('非法 maxPerCard 拒绝;空批序列产出 0 卡', () => {
    expect(() => mergeQuestionDrafts([], 0)).toThrow(InteractConfigError)
    expect(mergeQuestionDrafts([]).cards).toHaveLength(0)
    expect(mergeQuestionDrafts([[]]).cards).toHaveLength(0)
  })

  it('草稿校验 fail-closed:空 id/空 question/空 label 拒绝', () => {
    expect(() => { validateDraft({ id: '', question: 'q' }) }).toThrow(/id/)
    expect(() => { validateDraft({ id: 'x', question: '' }) }).toThrow(/question/)
    expect(() => { validateDraft({ id: 'x', question: 'q', options: [] }) }).toThrow(/options/)
    expect(() => { validateDraft({ id: 'x', question: 'q', options: [{ label: '' }] }) }).toThrow(/label/)
    expect(() => { validateDraft({ id: 'x', question: 'q', multiSelect: 'yes' }) }).toThrow(/multiSelect/)
    expect(() => mergeQuestionDrafts([[draft('ok'), { id: 'bad', question: '' }]])).toThrow(InteractConfigError)
  })
})

describe('TurnQuestionMerger 同 turn 状态归并', () => {
  it('add 同 turn 缓冲;flush 产出 { questions } 工具调用形态载荷', () => {
    const merger = new TurnQuestionMerger()
    expect(merger.add(1, [draft('q1')])).toBeUndefined()
    expect(merger.add(1, [draft('q2')])).toBeUndefined()
    const result = merger.flush(1)
    expect(result?.turnId).toBe(1)
    expect(result?.cardCount).toBe(1)
    expect(result?.questionCount).toBe(2)
    expect(result?.payloads).toHaveLength(1)
    const payload = result?.payloads[0]
    expect(Object.keys(payload ?? {})).toEqual(['questions'])
    expect(payload?.questions.map(item => item.id)).toEqual(['q1', 'q2'])
    // flush 后缓冲清空,再次 flush 无产出
    expect(merger.flush()).toBeUndefined()
  })

  it('turn 切换自动 flush 上一 turn(返回其结果),新 turn 入缓冲', () => {
    const flushed: TurnFlushResult[] = []
    const merger = new TurnQuestionMerger({ onFlush: result => flushed.push(result) })
    merger.add(1, [draft('t1a'), draft('t1b')])
    const autoFlushed = merger.add(2, [draft('t2a')])
    expect(autoFlushed?.turnId).toBe(1)
    expect(autoFlushed?.payloads[0]?.questions.map(item => item.id)).toEqual(['t1a', 't1b'])
    expect(flushed).toHaveLength(1)
    expect(merger.pendingTurnId).toBe(2)
    merger.flush(2)
    expect(flushed).toHaveLength(2)
    expect(flushed[1]?.turnId).toBe(2)
  })

  it('单卡上限在 merger 生效:一次 5 问的 ask 拆为 2 卡(3/2)', () => {
    const merger = new TurnQuestionMerger()
    merger.add(7, ['a', 'b', 'c', 'd', 'e'].map(id => draft(id)))
    const result = merger.flush(7)
    expect(result?.cardCount).toBe(2)
    expect(result?.payloads.map(payload => payload.questions.length)).toEqual([3, 2])
  })

  it('合并统计:3 次 ask 6 问(去重 1)→ 5 唯一问拆 2 卡,节省 1 次打断', () => {
    const merger = new TurnQuestionMerger()
    merger.add(1, [draft('q1'), draft('q2'), draft('q3')])
    merger.add(1, [draft('q1', '重问'), draft('q4')])
    merger.add(1, [draft('q5')])
    const result = merger.flush(1)
    expect(result?.droppedDuplicateIds).toEqual(['q1'])
    expect(result?.cardCount).toBe(2)
    const stats = merger.stats()
    expect(stats.asksIn).toBe(3)
    expect(stats.questionsIn).toBe(6)
    expect(stats.cardsOut).toBe(2)
    expect(stats.duplicatesDropped).toBe(1)
    expect(stats.interruptionsSaved).toBe(1)
    expect(stats.mergeRate).toBe(1 - 2 / 3)
  })

  it('合并统计:3 次单问合 1 卡 → 节省 2 次打断,mergeRate = 2/3', () => {
    const merger = new TurnQuestionMerger()
    merger.add(1, [draft('a')])
    merger.add(1, [draft('b')])
    merger.add(1, [draft('c')])
    merger.flush(1)
    const stats = merger.stats()
    expect(stats.cardsOut).toBe(1)
    expect(stats.interruptionsSaved).toBe(2)
    expect(stats.mergeRate).toBeCloseTo(2 / 3, 10)
  })

  it('flush 指定别的 turn 不动当前缓冲;自定义 maxPerCard 生效', () => {
    const merger = new TurnQuestionMerger({ maxPerCard: 2 })
    merger.add(3, [draft('x'), draft('y'), draft('z')])
    expect(merger.flush(99)).toBeUndefined()
    const result = merger.flush(3)
    expect(result?.payloads.map(payload => payload.questions.length)).toEqual([2, 1])
  })
})
