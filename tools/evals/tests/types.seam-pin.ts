/**
 * DSH seam 编译期钉住(只被 tsc --noEmit 消费;vitest include 只收 *.spec.ts)。
 *
 * 目的(设计文档 08 §8 风险 1):DSH pre-stable,所有适配面要在验证门里用接口
 * 冒烟钉住。本文件用**已发布的 @deepseek-ai/dsh-*(与 ../dsh-repo 同为
 * 0.2.2-alpha.2)类型**断言评测包消费的事件形态与官方 seam 兼容——DSH 升级
 * 破坏形态时,`pnpm --filter @basis/evals run verify` 的 tsc 阶段即失败。
 *
 * 依据(dsh-repo,只读):
 * - SessionEvent 事件包:packages/core/session/src/types.ts:504-518
 * - PluginRecord(plugin: 前缀实验记录):packages/core/session/src/types.ts:546-566
 * - tool/call 载荷:packages/core/session/src/types.ts:373-377
 * - assistant/message.usage(TokenUsage):packages/llm/llm/src/types.ts:182-199
 * - approval/asked|decided:packages/interaction/user-approval/src/types.ts:44-58
 *   (经 @deepseek-ai/dsh-user-approval 的 `declare module '@deepseek-ai/dsh-session/types'` 增强进 SessionEventMap)
 */
import type { PluginRecord, SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval/types'
import { approvalDecidedOf, approvalAskedOf, summarize, toolCallOf, usageOf } from '../src/index.ts'
import type { ApprovalOutcomeLike, PluginRecordLike, SessionEventLike, TokenUsageLike } from '../src/index.ts'

// 引入增强模块(副作用 import 的类型面):approval 事件由此进入 SessionEventMap。
import type {} from '@deepseek-ai/dsh-user-approval/types'

declare const officialEvents: readonly SessionEvent[]
declare const officialPluginRecord: PluginRecord

/** 钉住 ①:官方 SessionEvent 流可直接喂给评测聚合器(fixture/真实 session 同一形态)。 */
export const pinSummarizeFeed: number = summarize(officialEvents).turns

/** 钉住 ①b:官方 SessionEvent 满足本地 SessionEventLike(type/seq/time/data/ignorable)。 */
export const pinEventLike: readonly SessionEventLike[] = officialEvents

/** 钉住 ①c:官方 PluginRecord 满足本地 PluginRecordLike(plugin: 前缀 + seq/time/data)。 */
export const pinPluginRecordLike: PluginRecordLike = officialPluginRecord

/** 钉住 ②:官方 tool/call / approval / usage 事件可进入对应解析器(结构子集消费)。 */
export const pinToolCallParse: unknown = toolCallOf(officialEvents[0] as SessionEventLike)
export const pinApprovalAskedParse: unknown = approvalAskedOf(officialEvents[0] as SessionEventLike)
export const pinApprovalDecidedParse: unknown = approvalDecidedOf(officialEvents[0] as SessionEventLike)
export const pinUsageParse: unknown = usageOf(officialEvents[0] as SessionEventLike)

/** 官方 TokenUsage(经 assistant/message 事件载荷取出)。 */
type OfficialUsage = NonNullable<SessionEventMap['assistant/message']['usage']>
declare const officialUsage: OfficialUsage

/** 钉住 ③:官方 TokenUsage 满足本地 TokenUsageLike(input/output/total/cache 四字段)。 */
export const pinUsageLike: TokenUsageLike = officialUsage

/** 钉住 ④:官方 ApprovalOutcome 四值与本地 ApprovalOutcomeLike 同构。 */
export const pinOutcomeLike: ApprovalOutcomeLike = ('rejected' satisfies ApprovalOutcome) satisfies ApprovalOutcomeLike

/** 钉住 ⑤:评测消费的事件名都是官方 SessionEventMap 的键(含经增强进入的 approval 事件)。 */
type ConsumedEventKeys = [
  'turn/start',
  'turn/end',
  'step/start',
  'step/end',
  'user/message',
  'assistant/message',
  'tool/call',
  'tool/result',
  'approval/asked',
  'approval/decided',
]
type AssertAllKnown<T extends readonly (keyof SessionEventMap)[]> = T
export const consumedEventKeysPin: AssertAllKnown<ConsumedEventKeys> = [
  'turn/start',
  'turn/end',
  'step/start',
  'step/end',
  'user/message',
  'assistant/message',
  'tool/call',
  'tool/result',
  'approval/asked',
  'approval/decided',
]

/** 钉住 ⑥:approval 载荷官方形态可赋给本地视图字段(id/toolName/outcome)。 */
type OfficialAsked = SessionEventMap['approval/asked']
type OfficialDecided = SessionEventMap['approval/decided']
declare const officialAsked: OfficialAsked
declare const officialDecided: OfficialDecided
export const pinAskedShape: { id: string; toolName: string } = officialAsked
export const pinDecidedShape: { id: string; outcome: ApprovalOutcome } = officialDecided
