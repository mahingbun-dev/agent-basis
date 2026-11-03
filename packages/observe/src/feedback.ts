/**
 * feedback 低分 → evolve_signal 入队桥(设计 09 §1 信号采集 S1、10 §2 采集点:
 * 「feedback(messageFeedback 服务)」)。
 *
 * seam 形态(packages/feedback/message-feedback/src/types.ts:19-61,经模块增强进 SessionEventMap):
 * - 'feedback/message-put'   { sessionId, item: { messageId, rating: 'positive'|'negative',
 *                                                note?, category?, version, createdAt, updatedAt } }
 * - 'feedback/message-delete'{ sessionId, messageId }(删除保留历史:信号不撤,审计语义)
 * - 'feedback/record'        { text?, category? }(会话级评语,无分数——不入低分队,reflector 周报采样)
 *
 * 「低分」判定:DSH 的 messageFeedback 评分是二值(positive/negative),negative 即低分。
 * 去重:ref = `feedback:<sessionId>:<messageId>` 与 kind 构成唯一键 —— 同一消息被反复
 * 重评(version churn)只产生一条信号;不同消息/不同会话各自成信号。
 * trajectoryHash = sha256('session:' + sessionId) 前 16 hex —— 同一会话的多个低分消息
 * 聚到同一轨迹簇,供 reflector「同一失败模式 ≥N 次才立项」。
 */
import { createHash } from 'node:crypto'
import { isRecord } from './types.ts'
import type { SessionEventLike, SignalEnqueueResult, SignalInput } from './types.ts'
import type { SignalStore } from './signals.ts'

/** feedback 事件桥选项。 */
export interface FeedbackWatcherOptions {
  readonly store: SignalStore
  /** 信号归属的领域包 id(evolve_signal.pack_id)。 */
  readonly packId: string
  /** note/评语进 summary 的截断长度(默认 160 字符)。 */
  readonly summaryLimit?: number
  /** 时钟(默认 Date.now,测试可注入)。 */
  readonly now?: () => number
}

/**
 * feedback 事件 → 低分信号入队桥。
 * applyEvent 幂等:重放同一段事件流,信号不重复((kind, ref) 去重在存储层)。
 */
export class FeedbackWatcher {
  readonly #store: SignalStore
  readonly #packId: string
  readonly #summaryLimit: number
  readonly #now: () => number

  constructor(options: FeedbackWatcherOptions) {
    this.#store = options.store
    this.#packId = options.packId
    this.#summaryLimit = options.summaryLimit ?? 160
    this.#now = options.now ?? (() => Date.now())
  }

  /**
   * 消费一条 session 事件:
   * - feedback/message-put 且 rating='negative' → 入队 feedback_low 信号('enqueued'/'duplicate');
   * - 其余(positive 评分、delete、record 评语、无关事件)→ { signal: null, reason: 'ignored' }。
   */
  applyEvent(event: SessionEventLike): SignalEnqueueResult {
    if (event.type !== 'feedback/message-put' || !isRecord(event.data)) {
      return { signal: null, reason: 'ignored' }
    }
    const sessionId = asString(event.data['sessionId'])
    const item = event.data['item']
    if (sessionId.length === 0 || !isRecord(item)) return { signal: null, reason: 'ignored' }
    const draft = screenFeedbackItem(item, sessionId, this.#summaryLimit)
    if (draft === null) return { signal: null, reason: 'ignored' }
    return this.#store.enqueue({ ...draft, packId: this.#packId, ts: this.#now() })
  }

  /** 投影一段事件流,返回实际入队(enqueued)的信号。 */
  applyEvents(events: readonly SessionEventLike[]): readonly SignalEnqueueResult[] {
    return events.map(event => this.applyEvent(event))
  }
}

/** 低分信号草稿(packId/ts 由入队方补)。 */
export type FeedbackSignalDraft = Omit<SignalInput, 'packId' | 'ts'>

/**
 * 纯判定:一条 messageFeedback item 是否低分信号(不触碰存储,单测直测)。
 * 返回信号草稿;rating !== 'negative' 或 messageId 缺失返回 null。
 */
export function screenFeedbackItem(
  item: Record<string, unknown>,
  sessionId: string,
  summaryLimit = 160,
): FeedbackSignalDraft | null {
  const rating = item['rating']
  const messageId = asString(item['messageId'])
  if (rating !== 'negative' || messageId.length === 0) return null
  const note = item['note']
  const category = item['category']
  const summary = typeof note === 'string' && note.trim().length > 0
    ? `低分反馈:${note.slice(0, summaryLimit)}`
    : `低分反馈(无评语):message=${messageId}`
  return {
    sessionId,
    kind: 'feedback_low',
    ref: `feedback:${sessionId}:${messageId}`,
    payload: {
      summary,
      tags: [
        'feedback',
        'rating:negative',
        typeof category === 'string' ? `category:${category}` : 'category:none',
      ],
      trajectoryHash: trajectoryHashOf(sessionId),
      rating: 'negative',
      messageId,
      ...(typeof category === 'string' && { category }),
    },
  }
}

/** 轨迹哈希:sha256('session:<id>') 前 16 hex(稳定、可跨进程重现,reflector 聚类键)。 */
export function trajectoryHashOf(sessionId: string): string {
  return createHash('sha256').update(`session:${sessionId}`).digest('hex').slice(0, 16)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
