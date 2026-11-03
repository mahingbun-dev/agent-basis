/**
 * DSH seam 编译期钉住(只被 tsc --noEmit 消费;vitest include 只收 *.spec.ts,不运行本文件)。
 *
 * 目的(设计文档 08 §8 风险 1):DSH 处于 pre-stable,所有 L1 插件的适配面要在 CI 里
 * 用接口冒烟测试钉住。本文件用**已发布的 @deepseek-ai/dsh-*(与 ../dsh-repo 同为
 * 0.2.2-alpha.2)类型**断言:缓存守护的最小接口与官方 seam 双向兼容——DSH 升级破坏
 * seam 形态时,`pnpm --filter @basis/cache-guard run verify` 的 tsc 阶段即失败。
 *
 * 依据(dsh-repo,只读):
 * - packages/core/session/src/types.ts:497-518(SessionEvent 事件包)、258-436(SessionEventMap:
 *   request/header|context、assistant/message 携带 usage)
 * - packages/llm/llm/src/types.ts:182-196(TokenUsage,互斥桶)
 * - packages/llm/llm/src/call-config.ts:31(LlmCallConfig:provider/model)
 */
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionMetrics } from '@basis/observe'
import { aggregateSessionMetrics } from '@basis/observe'
import {
  cacheHitRateFromEvents, collectCacheUsage, createCacheGuard, extractCacheUsage, extractRequestRoute,
} from '../src/index.ts'
import type { RouteRefLike, SessionEventLike, TokenUsageLike } from '../src/index.ts'

declare const sessionEvents: readonly SessionEvent[]
declare const assistantMessageEvent: SessionEvent<'assistant/message'>
declare const requestHeaderEvent: SessionEvent<'request/header'>
declare const requestContextEvent: SessionEvent<'request/context'>
declare const dshTokenUsage: TokenUsage
declare const dshCallConfig: LlmCallConfig
declare const observeMetrics: SessionMetrics

/** 钉住 ①:官方 SessionEvent 数组(66+ 事件类型判别联合)可直接喂提取器管线。 */
export const pinCollectFromOfficialEvents = collectCacheUsage(sessionEvents)

/** 钉住 ①b:官方 SessionEvent 数组可直接喂命中率报表门(SessionEvent 满足 SessionEventLike)。 */
export const pinHitRateFromOfficialEvents = cacheHitRateFromEvents(sessionEvents)

/** 钉住 ①c:官方事件同样可喂 observe 聚合器(observe 侧 seam 已钉,此处消费面互证)。 */
export const pinObserveConsumesOfficialEvents = aggregateSessionMetrics(sessionEvents)

/** 钉住 ②:assistant/message 官方事件(usage 消费面成立)。 */
export const pinAssistantUsage = extractCacheUsage(assistantMessageEvent)

/** 钉住 ③:request/header|context 官方事件(路由锚定消费面成立)。 */
export const pinHeaderRoute = extractRequestRoute(requestHeaderEvent)
export const pinContextRoute = extractRequestRoute(requestContextEvent)

/** 钉住 ④:官方 TokenUsage 可赋值给 TokenUsageLike(互斥四桶 + 可选字段)。 */
export const pinTokenUsage: TokenUsageLike = dshTokenUsage

/** 钉住 ⑤:LlmCallConfig 的 provider/model 是路由锚定读取的全部字段。 */
export const pinCallConfigRoute: RouteRefLike = { provider: dshCallConfig.provider, model: dshCallConfig.model }

/** 钉住 ⑥:observe 聚合器产物可桥接(命中率输出接口的对接面)。 */
export const pinBridgeFromObserve = createCacheGuard().hitRateFromMetrics(observeMetrics)

/** 钉住 ⑦:SessionEventLike 与官方事件的结构兼容方向(官方 → 本包输入)。 */
export const pinEventLike: SessionEventLike = assistantMessageEvent
