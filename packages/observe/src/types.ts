/**
 * DSH seam 的本地最小形态(结构兼容层)+ observe 包共享词汇。
 *
 * 来源与依据(../dsh-repo,0.2.2-alpha.2,只读):
 * - session 事件包:packages/core/session/src/types.ts:497-518
 *   `{ type, seq, time, data }`;data 形态见 SessionEventMap(types.ts:258-436):
 *   - 'turn/start' { turn } / 'turn/end' { turn, reason: { kind, ... } }
 *   - 'step/start'|'step/end' { turn, step }
 *   - 'request/header' { header: { config: { provider, model, ... } }, reason, startsSeries? }(types.ts:395-403)
 *   - 'request/context' { provider, model, contextWindow? }(types.ts:405-413,route 元数据,仅在变化时记录)
 *   - 'assistant/message' { turn, step, message, stream, usage?: TokenUsage }(types.ts:338-350)
 * - TokenUsage:packages/llm/llm/src/types.ts:182-196 —— 计数互斥(disjoint):
 *   inputTokens 只含未缓存输入;缓存输入单列为 cacheReadTokens/cacheWriteTokens
 *   (计费输入 = 三者之和);totalTokens 为可选的整_call 总量。
 * - feedback 事件(packages/feedback/message-feedback/src/types.ts:14-61,经模块增强进 SessionEventMap):
 *   - 'feedback/message-put' { sessionId, item: { messageId, rating: 'positive'|'negative',
 *     note?, category?, version, createdAt, updatedAt } }
 *   - 'feedback/message-delete' { sessionId, messageId }
 *   - 'feedback/record' { text?, category? }(packages/feedback/command-feedback/src/types.ts:29-37)
 *
 * 本文件只声明观测代码实际消费的字段(比官方类型更窄),由 tests/types.seam-pin.ts
 * 在编译期断言官方类型可赋值进来 —— DSH 升级破坏 seam 时 tsc --noEmit 即失败。
 */

/**
 * session 事件流的最小事件包形态(结构兼容 dsh `SessionEvent`,types.ts:497)。
 * 指标聚合器与反馈桥只消费 type/data/(seq/time 可选)。
 */
export interface SessionEventLike {
  readonly type: string
  readonly data: unknown
  readonly seq?: number
  readonly time?: number
}

/**
 * dsh `TokenUsage` 的结构子集(llm/src/types.ts:182;计数互斥口径见模块注释)。
 * inputTokens = 未缓存输入;cacheRead/cacheWrite 单列;reasoning 已含在 outputTokens 内。
 */
export interface TokenUsageLike {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens?: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
  readonly reasoningTokens?: number
}

/** 一条 provider/model 路由(来自 request/header 或 request/context)。 */
export interface RouteRef {
  readonly provider: string
  readonly model: string
}

/** 进化信号种类(设计文档 10 §2 信号表;前五类为本任务验收面,audit_scan 为 prompt-audit 扫描预留)。 */
export type SignalKind =
  | 'feedback_low'
  | 'approval_modified'
  | 'approval_rejected'
  | 'eval_fail'
  | 'drift'
  | 'audit_scan'

export const SIGNAL_KINDS: readonly SignalKind[] = [
  'feedback_low',
  'approval_modified',
  'approval_rejected',
  'eval_fail',
  'drift',
  'audit_scan',
]

/** 信号 payload(对齐设计文档 10 §2:`payload: { summary, tags[], trajectory_hash? }` + 自由扩展字段)。 */
export interface SignalPayload {
  /** 人读一句话摘要(入队方给,reflector 周报直接引用)。 */
  readonly summary: string
  /** 检索标签(feedback/category/rating:xxx/drift 等)。 */
  readonly tags: readonly string[]
  /**
   * 轨迹哈希:同一失败模式的聚类键(reflector 按 trajectory_hash 聚合去重,设计 10 §3)。
   * 漂移类信号无单一轨迹,可缺省。
   */
  readonly trajectoryHash?: string
  /** 自由扩展(rating/score/breach 明细等),存 payload JSON。 */
  readonly [extra: string]: unknown
}

/** 入队输入(id/ts 由存储侧生成)。 */
export interface SignalInput {
  /** Unix 毫秒;缺省取存储侧 now()。 */
  readonly ts?: number
  readonly packId: string
  readonly sessionId?: string
  readonly kind: SignalKind
  /** 指向来源事件/任务行/快照(如 `feedback:<sessionId>:<messageId>`);与 kind 共同构成去重键。 */
  readonly ref: string
  readonly payload: SignalPayload
}

/** 已落库的进化信号(存储侧回填 id/ts)。 */
export interface EvolveSignal {
  readonly id: number
  readonly ts: number
  readonly packId: string
  readonly sessionId?: string
  readonly kind: SignalKind
  readonly ref: string
  readonly payload: SignalPayload
}

/** 入队结果:signal 为 null 表示未入队(reason 说明原因)。 */
export interface SignalEnqueueResult {
  readonly signal: EvolveSignal | null
  readonly reason: 'enqueued' | 'duplicate' | 'ignored'
}

/** 信号查询过滤(全可选,AND 组合)。 */
export interface SignalQuery {
  readonly kind?: SignalKind
  readonly packId?: string
  readonly sessionId?: string
  /** 标签精确匹配(sqlite json_each)。 */
  readonly tag?: string
  readonly trajectoryHash?: string
  /** ts >= since(Unix 毫秒)。 */
  readonly since?: number
  readonly limit?: number
}

/** trajectory_hash 聚类行(reflector「同一错误 ≥N 次」的统计输入,设计 10 §3)。 */
export interface TrajectoryCluster {
  readonly trajectoryHash: string
  readonly count: number
  readonly kinds: readonly SignalKind[]
  readonly refs: readonly string[]
  readonly firstTs: number
  readonly lastTs: number
}

/** 任意 JSON record 的窄判别(与 @basis/governance errors.isRecord 同型,本包零依赖自持)。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
