/**
 * channels 适配器——channels 事件 → Trigger 进 Engine(35 号 A21;34 号 §2.5
 * channel-adapter 行「channels 事件 → Trigger:`channel_user` 收敛身份(27 号情况 A
 * 归一化防线)、幂等 id 从事件内容派生;PR 生命周期绑定类(GitHub PR merge→
 * `threadClosed`)走 Source 扩展钩子」;39 号 §3-E2/E3 的 tasks 对端)。
 *
 * 不变量与分工(引 34 §2.5 port 行、39 §3-E2):
 * - `channel_user` 收敛身份:channels 归一化已把 (channelType, channelUserId) 透传为
 *   Trigger.actor(39-E2 source.ts webhookSourceKind;多渠道收敛同一 thread 靠 E1 的
 *   多行同目标绑定),本层原样保留 actor 与 threads——归一化防线不因适配而改写;
 * - 幂等 id 从事件内容派生:**派生算法归 tasks**(39-E2 原文;34 §2.1 ids 行)——本层
 *   用 core key()(sha256 内容派生,27 号 §3.2-② 幂等键机制)按稳定内容重派 id,
 *   不含到达时刻(重放/重试的到达时刻不同,若参与派生则幂等失效);重放同一事件
 *   得同一 id,`Engine.receive` 判 duplicate 收敛为一单(27 号 §3.3 情况 C);
 *   channels 自产的 id(同构 key 算法)不进入 Engine,两侧算法漂移不影响判重;
 * - scope 过滤:SourceScope 监听范围由 Engine 的 intake 消费(intake.ts:37-40,
 *   不监听记 `filtered` 落库),本层不重复裁决,三态原样透传;
 * - PR 生命周期:GitHub PR merge→`threadClosed`、opened→`bindThread(own)` 经
 *   channels SourceRegistry.deliverLifecycle 的 LifecycleForward 到本类
 *   (39-E2 githubPrSourceKind 钩子样例),解析回 ThreadRef 后调 EngineForSources。
 *
 * 用法:组合层(glue)把 `ChannelTriggerAdapter` 按结构类型注给 channels webhook
 * 网关的 sink 位(39-E3 message 分支)与 deliverLifecycle 的 sink 位;纯被动汇,
 * 无轮询无后台循环(34 §0-A5「注册表与轮询不搬」)。
 */
import type { Trigger as ChannelsTrigger, LifecycleForward } from '@eterna/channels'
import { key, threadKey, type ThreadRef, type Trigger } from '../core/index.ts'
import type { EngineForSources, ReceiveResult } from '../core/index.ts'
import type { SourceSink } from './port.ts'

/** `ChannelTriggerAdapter` 的引擎依赖(34 §3 EngineForSources:receive/bindThread/threadClosed)。 */
export interface ChannelAdapterHost {
  /** 领域引擎的 Source 角色面(34 号 §3 EngineForSources)。 */
  readonly engine: EngineForSources
}

/**
 * 归一化一条 channels 事件为 core Trigger:幂等 id 以 tasks key() 按稳定内容重派
 * (源、渠道身份、主线程、渠道消息 id、文本;不含到达时刻),其余契约面(actor/
 * threads/human/addressed/at/channel/url/meta)与 channels 归一化产出逐字段保留
 * (34 §2.5「channel_user 收敛身份」防线的透传半边;intake 再归一时间戳与判重,
 * intake.ts:19-62)。
 *
 * 稳定内容五元组:同一事件的任何次重放(重试/重投)恒得同一 id;不同事件(文本或
 * 消息 id 或线程不同)不得碰撞——id 同时含主线程键与渠道消息 id(缺省空串)。
 */
export function normalizeChannelTrigger(received: ChannelsTrigger): Trigger {
  const primary = received.threads[0]
  const messageId = typeof received.meta.messageId === 'string' ? received.meta.messageId : ''
  const id = key('tasks/channel-trigger', received.source, received.actor.id, primary ? threadKey(primary) : '',
    messageId, received.text)
  return { ...received, id }
}

/**
 * channels 事件 → Engine 的被动汇(34 §2.5 channel-adapter 行的实现类;39 §3-E2/E3
 * 的 tasks 侧 TriggerSink 对端)。receive 把 channels 归一化 Trigger 重派幂等 id 后送
 * `Engine.receive`(三态 stored/duplicate/filtered 由 intake 裁决:幂等 + scope 过滤);
 * bindThread/threadClosed 把 PR 生命周期转发落到 `EngineForSources`(threadKey 按
 * channels 规范键 `${source}:${id}` 解析,解析面与 channels threadRefFromKey 同一
 * 算法——规范键形态由 trigger.ts threadKey 定义)。
 */
export class ChannelTriggerAdapter implements SourceSink {
  private readonly engine: EngineForSources
  constructor(host: ChannelAdapterHost) {
    this.engine = host.engine
  }
  /** 归一化进引擎,三态原样回传(39-E2 验收④:三态由 sink 回传、注册面透传)。 */
  receive(received: ChannelsTrigger): ReceiveResult {
    return this.engine.receive(normalizeChannelTrigger(received))
  }
  /** PR 生命周期绑定半边:工单跟随线程(own=工单自开);threadKey 解析回 ThreadRef。 */
  bindThread(ticketId: string, threadKey: string, own: boolean): unknown {
    return this.engine.bindThread(ticketId, threadRefOf(threadKey), own)
  }
  /** PR 生命周期收尾半边:merge/closed → followsDone 判定(34 §3 threadClosed 原文)。 */
  threadClosed(threadKey: string, outcome: 'merged' | 'closed', at: string): void {
    this.engine.threadClosed(threadRefOf(threadKey), outcome, at)
  }
}

/**
 * channels 规范线程键(`source:id`,trigger.ts threadKey)→ ThreadRef。算法与
 * channels `threadRefFromKey` 同构(无冒号/首尾冒号的退化值以 fallbackSource 承载);
 * 此处以同算法本地实现保持 tasks 侧零运行时深耦合(channels 纯函数仅为类型面依赖,
 * 34 §1 依赖方向行),等价性由 tests/channel-adapter.spec.ts 的同构断言看护。
 */
export function threadRefOf(threadKey: string): ThreadRef {
  const separator = threadKey.indexOf(':')
  if (separator <= 0 || separator === threadKey.length - 1) return { source: 'channel', id: threadKey }
  return { source: threadKey.slice(0, separator), id: threadKey.slice(separator + 1) }
}

/** 生命周期转发(channels LifecycleForward)的直接应用(组合层与测试共用)。 */
export function applyLifecycleForwards(forwards: readonly LifecycleForward[], sink: SourceSink): void {
  for (const forward of forwards) {
    if (forward.type === 'bindThread') sink.bindThread(forward.ticketId, forward.threadKey, forward.own)
    else sink.threadClosed(forward.threadKey, forward.outcome, forward.at)
  }
}
