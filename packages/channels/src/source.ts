/**
 * Source 统一接收面 + 扩展钩子(39 号 §3-E2;24a 拍板 A5;34 号 §2.5/§3)。
 *
 * channels 是统一接收面,tasks 只实现 Source 适配端口;注册面由 channels 侧承担
 * (34 §4-F)。本模块把渠道事件**归一化为 Trigger**——类型与派生工具由本包
 * `./trigger.ts` 中立声明(31 号 §2.2 铁律 1「Tier1 永不 import Tier2」,channels
 * 不得 import @eterna/tasks;形态与其 core 逐字段同构,tasks 侧适配,同构约束
 * 见 trigger.ts 头注):
 *
 * - 幂等 id:用 tasks 的内容派生稳定 id 算法 `key()`(34 §2.1 ids 行;27 §3.2-②
 *   幂等键机制)对事件内容派生——**不含到达时刻**(重放/重试的到达时刻不同,若参与
 *   派生则幂等失效);重复投递经 `receive → duplicate` 收敛为一单(27 §3.3 情况 C),
 *   三态由 sink(tasks 侧)回传、注册面原样透传。
 * - `channel_user` 收敛身份:透传为 Trigger.actor({source, id}=渠道类型+渠道身份,
 *   24a A5/27 §3.3 情况 A 的归一化防线);多渠道收敛同一 thread 靠 E1 的多行同目标
 *   绑定,不做跨源身份映射(24 §2.2 被拒概念)。
 * - WebChat 兼容面(29 §6,B4 拍板):归一化载荷以 Trigger 兼容面定义,端口
 *   (TriggerSink)不绑定 webhook 特有字段,未来 WebChat 入口接入是配置工作。
 *
 * 本地最小端口 `TriggerSink` 结构对齐 34 §3 EngineForSources 的三个方法签名
 * (receive/bindThread/threadClosed),仅取 channels 侧所需的调用面;tasks Engine
 * (35 号 A6+)落地前由组合层注入实现,本包测试用桩。
 */
import { isoTime, key } from './trigger.ts'
import type { ThreadRef, Trigger } from './trigger.ts'
import type { ThreadTarget } from './binding.ts'
import type { ChannelType, InboundMessage } from './types.ts'

/** Trigger 经统一接收面后的去向三态(幂等/过滤由 tasks 侧裁决,原样透传)。 */
export type ReceiveDisposition = 'stored' | 'duplicate' | 'filtered'

/**
 * tasks 侧统一接收端口(结构对齐 34 §3 EngineForSources 调用面):
 * - receive:归一化后的 Trigger 进 tasks;幂等判定归 tasks(内容派生 id 相同即 duplicate);
 * - bindThread / threadClosed:Source 扩展钩子的生命周期转发目标
 *   (34 §3 原文 `bindThread(ticketId, thread, own)` / `threadClosed(thread, outcome, at)`)。
 */
export interface TriggerSink {
  receive(trigger: Trigger): ReceiveDisposition
  bindThread(ticketId: string, threadKey: string, own: boolean): unknown
  threadClosed(threadKey: string, outcome: 'merged' | 'closed', at: string): void
}

/**
 * 把绑定存储中的不透明 thread_key(39 §9-3 开放问题:与 tasks ThreadRef 的映射规则
 * 设计未定)解析回 ThreadRef:规范键形态是 `${source}:${id}`(trigger.ts threadKey,
 * 与 tasks core 同构);含冒号即按首个冒号拆分,不含冒号的 opaque 值以
 * fallbackSource(渠道自身)为 source 承载——channels 对存储不解释,仅在归一化出口
 * 做这一步解析。
 */
export function threadRefFromKey(stored: string, fallbackSource: string): ThreadRef {
  const separator = stored.indexOf(':')
  if (separator <= 0 || separator === stored.length - 1) return { source: fallbackSource, id: stored }
  return { source: stored.slice(0, separator), id: stored.slice(separator + 1) }
}

/** Source 生命周期事件向 sink 的转发指令(34 §3 bindThread/threadClosed)。 */
export type LifecycleForward =
  | { readonly type: 'bindThread'; readonly ticketId: string; readonly threadKey: string; readonly own: boolean }
  | { readonly type: 'threadClosed'; readonly threadKey: string; readonly outcome: 'merged' | 'closed'; readonly at: string }

/** 把转发指令应用到 sink(钩子样例与组合层共用)。 */
export function applyLifecycleForwards(forwards: readonly LifecycleForward[], sink: TriggerSink): void {
  for (const forward of forwards) {
    if (forward.type === 'bindThread') sink.bindThread(forward.ticketId, forward.threadKey, forward.own)
    else sink.threadClosed(forward.threadKey, forward.outcome, forward.at)
  }
}

/**
 * Source kind:一种事件源的归一化面。message 类源声明 normalizeMessage
 * (InboundMessage + 绑定解析 → Trigger);PR 生命周期类扩展钩子声明
 * lifecycleEvents(平台事件 → bindThread/threadClosed 转发,不做渠道拉取,
 * 34 §4-F 不承接 github-read)。
 */
export interface SourceKind {
  /** 唯一 ID(注册表冲突抛错,对齐 createAdapterRegistry 先例)。 */
  readonly id: string
  /** 该源事件抵达的渠道类型(经 webhook 网关路由验签;PR 类回调走通用 webhook 渠道)。 */
  readonly channelType: ChannelType
  normalizeMessage(message: InboundMessage, binding: ThreadTarget | undefined): Trigger
  lifecycleEvents?(event: Record<string, unknown>): readonly LifecycleForward[]
}

/**
 * webhook 渠道 kind(内置,E3 消费):IM/平台回调的 message 信封 → Trigger。
 * - human: true——webhook message 是人写出的消息(Source 声明面,Trigger.human);
 * - threads[0]:优先绑定解析出的 thread(多渠道收敛同一 thread 的落点),无 thread
 *   绑定时以渠道原生会话(该 channel_user 的对话)承载,保证 Trigger「主线程恒存在」
 *   不变量(model.ts threads[0]);
 * - channel:有 thread 绑定时声明只写地址(结果回到发起渠道的回信面,34 §3 ChannelRef)。
 */
export const webhookSourceKind: SourceKind = {
  id: 'webhook',
  channelType: 'webhook',
  normalizeMessage(message: InboundMessage, binding: ThreadTarget | undefined): Trigger {
    const source = message.channelType
    const threadRef = binding?.threadKey !== undefined
      ? threadRefFromKey(binding.threadKey, source)
      : { source, id: message.channelUserId }
    return {
      id: key('channels/webhook', source, message.channelUserId, message.messageId ?? '', message.text),
      source,
      threads: [threadRef],
      actor: { source, id: message.channelUserId },
      human: true,
      at: isoTime(message.occurredAt ?? new Date().toISOString()),
      text: message.text,
      ...(binding?.threadKey !== undefined && {
        channel: { source, thread: binding.threadKey, address: { channelUserId: message.channelUserId } },
      }),
      meta: {
        ...(message.messageId !== undefined && { messageId: message.messageId }),
        ...(message.occurredAt !== undefined && { occurredAt: message.occurredAt }),
      },
    }
  },
}

const asString = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined)
const asNumber = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
const asBoolean = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined)

/**
 * PR 生命周期扩展钩子样例(github-pr;39 §3-E2「仅注册归一化到 bindThread/threadClosed
 * 的转发,不做 GitHub 拉取」)。事件形态取 GitHub webhook 的常见子集:
 * `{ action: 'opened'|'closed', ticket_id, pull_request: { number, merged, merged_at, closed_at } }`。
 * - opened + ticket_id:工单自己开的 PR → bindThread(ticketId, `github:pr-N`, own=true)
 *   (34 §2.5「GitHub PR merge→threadClosed」的生命周期绑定半边);
 * - closed:merged ? 'merged' : 'closed' → threadClosed(threadKey, outcome, at)
 *   (工单跟随线程的关闭语义,model.ts Follow.closed)。
 */
export const githubPrSourceKind: SourceKind = {
  id: 'github-pr',
  channelType: 'webhook',
  lifecycleEvents(event: Record<string, unknown>): readonly LifecycleForward[] {
    const action = asString(event.action)
    const pullRequest = event.pull_request
    const number = typeof pullRequest === 'object' && pullRequest !== null
      ? asNumber((pullRequest as Record<string, unknown>).number)
      : undefined
    if (number === undefined) return []
    const threadKey = `github:pr-${number}`
    if (action === 'opened') {
      const ticketId = asString(event.ticket_id)
      if (ticketId === undefined) return []
      return [{ type: 'bindThread', ticketId, threadKey, own: true }]
    }
    if (action === 'closed') {
      const detail = (typeof pullRequest === 'object' && pullRequest !== null) ? pullRequest as Record<string, unknown> : {}
      const merged = asBoolean(detail.merged) ?? false
      return [{
        type: 'threadClosed',
        threadKey,
        outcome: merged ? 'merged' : 'closed',
        at: (merged ? asString(detail.merged_at) : asString(detail.closed_at)) ?? new Date().toISOString(),
      }]
    }
    return []
  },
  normalizeMessage(): Trigger {
    // PR 生命周期类源不产 message Trigger(只走 lifecycleEvents 转发)。
    throw new Error('[channels] github-pr 源不承载 message 归一化(仅生命周期钩子)')
  },
}

/** Source kind 注册表(唯一 ID 形态,对齐 createAdapterRegistry 先例:ID 冲突抛错)。 */
export interface SourceRegistry {
  register(kind: SourceKind): void
  get(id: string): SourceKind | undefined
  list(): readonly { readonly id: string; readonly channelType: ChannelType }[]
  /**
   * message 归一化 + 统一投递:kind.normalizeMessage → sink.receive;
   * 三态(stored/duplicate/filtered)由 sink 回传、原样透传(39 §3-E2 验收④)。
   * kind 缺席时抛错(接线错误,网关按 500 呈现)。
   */
  deliverMessage(kindId: string, message: InboundMessage, binding: ThreadTarget | undefined, sink: TriggerSink): ReceiveDisposition
  /** 生命周期事件 → kind.lifecycleEvents 归一化 → 应用到 sink;返回转发指令。 */
  deliverLifecycle(kindId: string, event: Record<string, unknown>, sink: TriggerSink): readonly LifecycleForward[]
}

export function createSourceRegistry(initialKinds: readonly SourceKind[] = []): SourceRegistry {
  const kinds = new Map<string, SourceKind>()
  for (const kind of initialKinds) register(kind)
  function register(kind: SourceKind): void {
    if (kind.id.length === 0) throw new Error('[channels] source kind id 不能为空')
    const existing = kinds.get(kind.id)
    if (existing !== undefined && existing !== kind) {
      throw new Error(`[channels] Source kind ID 冲突: ${kind.id}`)
    }
    kinds.set(kind.id, kind)
  }
  return {
    register,
    get(id: string): SourceKind | undefined {
      return kinds.get(id)
    },
    list(): readonly { readonly id: string; readonly channelType: ChannelType }[] {
      return [...kinds.values()].map(kind => ({ id: kind.id, channelType: kind.channelType }))
    },
    deliverMessage(kindId, message, binding, sink): ReceiveDisposition {
      const kind = kinds.get(kindId)
      if (kind === undefined) throw new Error(`[channels] 未注册的 Source kind: ${kindId}`)
      const trigger = kind.normalizeMessage(message, binding)
      return sink.receive(trigger)
    },
    deliverLifecycle(kindId, event, sink): readonly LifecycleForward[] {
      const kind = kinds.get(kindId)
      if (kind === undefined) throw new Error(`[channels] 未注册的 Source kind: ${kindId}`)
      const forwards = kind.lifecycleEvents?.(event) ?? []
      applyLifecycleForwards(forwards, sink)
      return forwards
    },
  }
}
