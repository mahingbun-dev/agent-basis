/**
 * feedback 低分 → signal 入队桥单测:
 * - negative 评分 → feedback_low 信号(ref/kind/tags/trajectoryHash/summary);
 * - 版本 churn 重评(同 messageId 多次 put)→ (kind, ref) 去重只一条;
 * - positive 评分 / delete / record 评语 / 无关事件 → ignored;
 * - 同会话多消息低分 → 同一 trajectory_hash 簇(reflector 聚类);
 * - 事件流重放幂等(applyEvents 两遍,信号数不变)。
 * 事件形态:packages/feedback/message-feedback/src/types.ts(feedback/message-put)。
 */
import { describe, expect, it } from 'vitest'
import { FeedbackWatcher, screenFeedbackItem, SignalStore, trajectoryHashOf } from '../src/index.ts'
import type { SessionEventLike } from '../src/index.ts'

function watcher(store: SignalStore, packId = '@event/pack'): FeedbackWatcher {
  return new FeedbackWatcher({ store, packId, now: () => 42_000 })
}

function feedbackPut(
  sessionId: string,
  messageId: string,
  rating: 'positive' | 'negative',
  extra: { note?: string; category?: string } = {},
  seq = 1,
): SessionEventLike {
  return {
    type: 'feedback/message-put',
    seq,
    time: 1_000 + seq,
    data: {
      sessionId,
      item: {
        messageId,
        rating,
        ...(extra.note !== undefined && { note: extra.note }),
        ...(extra.category !== undefined && { category: extra.category }),
        version: 'v1',
        createdAt: 1_000,
        updatedAt: 1_000,
      },
    },
  }
}

describe('screenFeedbackItem —— 纯判定', () => {
  it('negative + note + category → 草稿带 ref/tags/trajectoryHash/扩展字段', () => {
    const draft = screenFeedbackItem(
      { messageId: 'm1', rating: 'negative', note: '预算算错了', category: 'task-result' },
      'sess-1',
    )
    expect(draft).not.toBeNull()
    expect(draft?.kind).toBe('feedback_low')
    expect(draft?.ref).toBe('feedback:sess-1:m1')
    expect(draft?.sessionId).toBe('sess-1')
    expect(draft?.payload.summary).toBe('低分反馈:预算算错了')
    expect(draft?.payload.tags).toEqual(['feedback', 'rating:negative', 'category:task-result'])
    expect(draft?.payload.trajectoryHash).toBe(trajectoryHashOf('sess-1'))
    expect(draft?.payload['rating']).toBe('negative')
    expect(draft?.payload['category']).toBe('task-result')
  })

  it('negative 无 note → summary 用占位;无 category → category:none', () => {
    const draft = screenFeedbackItem({ messageId: 'm2', rating: 'negative' }, 'sess-1')
    expect(draft?.payload.summary).toBe('低分反馈(无评语):message=m2')
    expect(draft?.payload.tags).toEqual(['feedback', 'rating:negative', 'category:none'])
  })

  it('positive / 缺 messageId → null;note 超长截断', () => {
    expect(screenFeedbackItem({ messageId: 'm3', rating: 'positive' }, 's')).toBeNull()
    expect(screenFeedbackItem({ rating: 'negative' }, 's')).toBeNull()
    const long = screenFeedbackItem({ messageId: 'm4', rating: 'negative', note: 'x'.repeat(500) }, 's', 10)
    expect(long?.payload.summary).toBe(`低分反馈:${'x'.repeat(10)}`)
  })
})

describe('FeedbackWatcher.applyEvent —— 入队', () => {
  it('negative → feedback_low 信号入队,payload 完整', () => {
    const store = new SignalStore(':memory:')
    const result = watcher(store).applyEvent(feedbackPut('sess-1', 'm1', 'negative', { note: '漏审批', category: 'task-result' }))
    expect(result.reason).toBe('enqueued')
    expect(result.signal).toMatchObject({
      packId: '@event/pack',
      sessionId: 'sess-1',
      kind: 'feedback_low',
      ref: 'feedback:sess-1:m1',
      ts: 42_000,
    })
    expect(result.signal?.payload.summary).toBe('低分反馈:漏审批')
    store.close()
  })

  it('positive / feedback/record / feedback/message-delete / 无关事件 → ignored 且不落库', () => {
    const store = new SignalStore(':memory:')
    const w = watcher(store)
    expect(w.applyEvent(feedbackPut('sess-1', 'm1', 'positive')).reason).toBe('ignored')
    expect(w.applyEvent({ type: 'feedback/record', data: { text: '不太满意', category: 'other' } }).reason).toBe('ignored')
    expect(w.applyEvent({ type: 'feedback/message-delete', data: { sessionId: 'sess-1', messageId: 'm9' } }).reason).toBe('ignored')
    expect(w.applyEvent({ type: 'tool/result', data: {} }).reason).toBe('ignored')
    expect(store.count()).toBe(0)
    store.close()
  })

  it('坏形态(缺 sessionId / item 非 object)→ ignored 不崩', () => {
    const store = new SignalStore(':memory:')
    const w = watcher(store)
    expect(w.applyEvent({ type: 'feedback/message-put', data: { item: { messageId: 'm', rating: 'negative' } } }).reason).toBe('ignored')
    expect(w.applyEvent({ type: 'feedback/message-put', data: { sessionId: 's', item: 'nope' } }).reason).toBe('ignored')
    expect(w.applyEvent({ type: 'feedback/message-put', data: 'nope' }).reason).toBe('ignored')
    expect(store.count()).toBe(0)
    store.close()
  })
})

describe('去重与聚类(reflector 输入纪律)', () => {
  it('同消息被重评(version churn:两次 put)→ 只一条信号', () => {
    const store = new SignalStore(':memory:')
    const w = watcher(store)
    const first = w.applyEvent(feedbackPut('sess-1', 'm1', 'negative', {}, 1))
    const second = w.applyEvent(feedbackPut('sess-1', 'm1', 'negative', { note: '改了评语' }, 2))
    expect(first.reason).toBe('enqueued')
    expect(second.reason).toBe('duplicate')
    expect(second.signal?.id).toBe(first.signal?.id)
    expect(store.count()).toBe(1)
    store.close()
  })

  it('同会话多消息低分 → 同一 trajectory_hash 簇;跨会话不同簇', () => {
    const store = new SignalStore(':memory:')
    const w = watcher(store)
    w.applyEvent(feedbackPut('sess-1', 'm1', 'negative'))
    w.applyEvent(feedbackPut('sess-1', 'm2', 'negative'))
    w.applyEvent(feedbackPut('sess-2', 'm1', 'negative'))
    expect(store.count()).toBe(3)
    const clusters = store.clusterByTrajectory({ minCount: 1 })
    expect(clusters).toHaveLength(2)
    expect(clusters[0]).toMatchObject({ trajectoryHash: trajectoryHashOf('sess-1'), count: 2 })
    // repeatThreshold=2 → 只有 sess-1 簇立项
    expect(store.clusterByTrajectory({ minCount: 2 }).map(cluster => cluster.trajectoryHash))
      .toEqual([trajectoryHashOf('sess-1')])
    store.close()
  })

  it('事件流重放两遍 → 信号数不变(幂等)', () => {
    const store = new SignalStore(':memory:')
    const w = watcher(store)
    const events: readonly SessionEventLike[] = [
      feedbackPut('sess-1', 'm1', 'negative'),
      feedbackPut('sess-1', 'm2', 'positive'),
      feedbackPut('sess-2', 'm3', 'negative'),
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    w.applyEvents(events)
    w.applyEvents(events)
    w.applyEvents(events)
    expect(store.count()).toBe(2)
    store.close()
  })
})
