/**
 * session seam 契约:append-only 会话事件流(一切可观测/审计/评测的源头)。
 * 事件包形态 { type, seq, time, data } 结构兼容 governance 的 SessionEventLike;
 * 已知 data 形态仅覆盖 v1 生产方(agent-loop / tools / approval)实际会发出的部分。
 */

/** 会话事件包(seq 单调递增;time 毫秒)。 */
export interface SessionEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
}

/** v1 已知事件 data 形态(生产方参考;消费方按结构子集读取)。 */
export interface SessionEventDataMap {
  'turn/start': { readonly turn: number; readonly input: string }
  'turn/end': { readonly turn: number; readonly reason: { readonly kind: string; readonly message?: string } }
  'step/end': { readonly turn: number; readonly step: number }
  'tool/call': { readonly turn: number; readonly step: number; readonly callId: string; readonly name: string; readonly arguments: string }
  'tool/result': { readonly turn: number; readonly step: number; readonly callId: string; readonly name: string; readonly isError: boolean }
  'assistant/message': { readonly turn: number; readonly step: number; readonly usage?: import('./llm.ts').TokenUsage }
  'approval/asked': { readonly id: string; readonly toolName: string; readonly callId?: string; readonly reason?: string }
  'approval/decided': { readonly id: string; readonly outcome: import('./approval.ts').ApprovalOutcome }
}

/** session 存储面(ctx.session 服务面):追加分配 seq/time,查询按结构过滤。 */
export interface SessionStore {
  /** 追加一条事件(分配 seq/time),返回完整事件包。 */
  append(type: string, data: unknown): SessionEvent
  /** 结构过滤查询(type 精确匹配;since/until 为 seq 边界)。 */
  query(filter?: { readonly type?: string; readonly sinceSeq?: number; readonly untilSeq?: number }): readonly SessionEvent[]
  /** 当前事件总数。 */
  size(): number
}
