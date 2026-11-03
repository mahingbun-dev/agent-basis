/**
 * DSH seam 编译期钉住(只被 tsc --noEmit 消费;vitest include 只收 *.spec.ts,不运行本文件)。
 *
 * 目的(设计文档 08 §8 风险 1):DSH 处于 pre-stable,所有 L1 插件的适配面要在 CI 里
 * 用接口冒烟测试钉住。本文件用**已发布的 @deepseek-ai/dsh-*(与 ../dsh-repo 同为
 * 0.2.2-alpha.2)类型**断言:观测包的最小接口与官方 seam 双向兼容——DSH 升级破坏
 * seam 形态时,`pnpm --filter @basis/observe run verify` 的 tsc 阶段即失败。
 *
 * 依据(dsh-repo,只读):
 * - packages/core/session/src/types.ts:497-518(SessionEvent 事件包)、258-436(SessionEventMap:
 *   turn/start|end、step/start|end、request/header、request/context、assistant/message)
 * - packages/llm/llm/src/types.ts:167-196(TokenUsage,互斥桶)
 * - packages/llm/llm/src/call-config.ts:31(LlmCallConfig:provider/model)
 * - packages/feedback/message-feedback/src/types.ts:19-61(feedback/message-put|delete,
 *   经 declare module '@deepseek-ai/dsh-session/types' 增强进 SessionEventMap)
 */
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm/types'
import type {} from '@deepseek-ai/dsh-message-feedback/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { createObservatory, evaluateDrift, FeedbackWatcher, SignalStore, aggregateSessionMetrics } from '../src/index.ts'
import type { MetricsSnapshot, TokenUsageLike } from '../src/index.ts'

declare const sessionEvents: readonly SessionEvent[]
declare const requestHeaderEvent: SessionEvent<'request/header'>
declare const feedbackPutEvent: SessionEvent<'feedback/message-put'>
declare const dshTokenUsage: TokenUsage
declare const dshCallConfig: LlmCallConfig

const store = new SignalStore(':memory:')

/**
 * 钉住 ①:官方 SessionEvent 数组(含 66+ 事件类型的判别联合)可直接喂给
 * 指标聚合器 —— SessionEvent 满足 SessionEventLike(type/seq/time/data 结构子集)。
 */
export const pinSessionEventFeed = aggregateSessionMetrics(sessionEvents)

/** 钉住 ①b:request/header 事件(路由锚点)单独可喂;config 字段消费面成立。 */
export const pinRequestHeaderFeed = aggregateSessionMetrics([requestHeaderEvent])

/**
 * 钉住 ②:官方 TokenUsage 可赋值给 TokenUsageLike(互斥四桶 + total/reasoning 可选)。
 */
export const pinTokenUsage: TokenUsageLike = dshTokenUsage

/** 钉住 ②b:LlmCallConfig 的 provider/model 是我们路由锚定读取的全部字段。 */
export const pinCallConfigRoute: string = `${dshCallConfig.provider}/${dshCallConfig.model}`

/**
 * 钉住 ③:feedback/message-put 官方事件(模块增强后的 SessionEvent 成员)可直接喂给
 * 反馈桥 —— rating='negative' 判低分、item.messageId 构造 ref 的消费面成立。
 */
export const pinFeedbackEvent = new FeedbackWatcher({ store, packId: '@event/pack' }).applyEvent(feedbackPutEvent)

/** 钉住 ④:全部官方事件也可走反馈桥(未识别类型 → ignored,不崩)。 */
export const pinFeedbackAllEvents: readonly unknown[] = sessionEvents.map(event =>
  new FeedbackWatcher({ store, packId: '@event/pack' }).applyEvent(event).reason,
)

/** 钉住 ⑤:漂移对比消费 SessionMetrics(聚合器产物),组合门可直接驱动。 */
export const pinDriftSnapshot: MetricsSnapshot = {
  label: 'pin',
  at: 0,
  metrics: pinSessionEventFeed,
}
export const pinDriftReport = evaluateDrift(pinDriftSnapshot, pinDriftSnapshot)

/** 钉住 ⑥:组合门(createObservatory)提供 OBSERVE_SERVICE_ID 形态的 ctx.observe 服务面。 */
const observatory = createObservatory({ store: ':memory:', packId: '@event/pack' })
export const pinObservatoryId: '@basis/observe' = observatory.id
export const pinObservatoryAggregate = observatory.aggregate(sessionEvents)
observatory.dispose()
