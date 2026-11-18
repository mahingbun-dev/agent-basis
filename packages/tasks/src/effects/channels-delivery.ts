/**
 * channels 投递面自派生(★A1 回执接线,2026-11-19):宿主 ctx 的 channels 服务束
 * (@eterna/channels 服务 + cards 渲染器,glue channels-plugin 以 'channels' 服务名
 * provide,packages/glue/src/plugins/channels-plugin.ts:62/:155)→ Outbox 的
 * ChannelsDelivery 端口实装——reply effect 由「恒挂起」(UNWIRED_CHANNELS,plugin.ts
 * 接口位)转为经 channels 适配器真实结算(41-M4:此前 reply 永挂起无错误)。
 *
 * 设计依据(34 号 §1 依赖方向行「接线经端口注入,不 import 服务实例」;39 号 §3-E7
 * 渲染映射;34 号 §5-channels「结果回到发起渠道」):
 * - 结构端口纪律:sources/channel-adapter.ts 同款——channels 仅为类型面依赖,运行时
 *   对 'channels' 服务按本包消费面做结构对齐;服务缺席时派生惰性面(见下),服务
 *   在场但结构面残缺时不派生(fail-closed,不猜、不造桩,sessionHostFromContext
 *   plugin.ts:126-166 的先例口径);
 * - 双路解析:复用 sessionHostFromContext(plugin.ts:132-141)的直读 + reflect 惯例
 *   ——cordis 过滤上下文对未 inject 属性直读会抛 cannot get property without inject
 *   (直读包 try/catch,reflect.get(name, false) 非抛语义兜底);
 * - 时序硬约束:清单行序 eterna-tasks 先于 eterna-channels(profiles/eterna-super/
 *   cordis.patch.yml:578/580)且 bootTasks 一次性执行(plugin.ts:1015 无重试)——
 *   boot 时点 channels 服务未必已 provide,派生面**逐调用惰性现读**服务
 *   (available/channelAllowed/send 每次重新解析);服务缺席的调用按 UNWIRED 语义
 *   行事(available=false / channelAllowed=false / send='waiting'),reply effect
 *   的 Later 重试(outbox.ts:59 retry [5000,300_000])恰吸收挂载时序差。
 *
 * 适配映射(39 号 §3-E7;渠道 trigger 的 channel.source=message.channelType,
 * channels/src/source.ts:100,值域=ChannelType):
 * - available(source)=adapters.list().some(a=>a.channelType===source)——适配器未
 *   注册/停用即 false(Outbox 以 Later 等待,outbox.ts:77);
 * - channelAllowed(channel)=bindings.resolveThread(channel.source,
 *   channel.address.channelUserId ?? '')?.threadKey===channel.thread——无绑定或绑定
 *   漂移即 false(Outbox 落 dropped channelIgnored,outbox.ts:80);
 * - send(receipt)=按 channelType 选适配器(list 定位 id、get 取实例)→
 *   cards.buildReplyCard({purpose: kind==='acknowledgement'?'ack':'answer',
 *   title, body: receipt.text})→ 卡 undefined 即回 'waiting'(working 态不出站
 *   语义,cards.ts buildReplyCard)→ adapter.sendCard(card, channelUserId) →
 *   DeliveryReceipt 回 'sent';投递异常经 cards.classifyDeliveryFailure 归类:
 *   'channelGone' 回 'gone'(Outbox 落 dropped channelGone),其余原样上抛
 *   (交 effects 退避重试,不入账 dropped)。
 *
 * 边界(本期不做,如实挂起/不渲染,不发明语义):
 * - source='webchat' 无渠道适配器 → available 恒 false,webchat 回执恒以 Later
 *   挂起(sources/webchat.ts 的回执回投接线位另案,见 41-M4 extraFindings);
 * - result/attention purpose 需 receipt 携带结构化载荷(六态 report/审批双令牌)
 *   才可渲染,Receipt 现只有 text/kind(core/ports.ts:117 OutboundMessage)——
 *   本期映射只覆盖 acknowledgement→ack 与 reply/notice→answer,不造载荷。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ChannelAdapter, ChannelType, DeliveryFailureKind, OutboundCard, ReplyCardInput, ThreadTarget,
} from '@eterna/channels'
import type { Receipt } from '../store/store.ts'
import type { ChannelsDelivery } from './outbox.ts'

/**
 * channels 服务的结构消费面(34 §1 端口;成员逐一结构对齐 glue ChannelsWorld:
 * adapters/createAdapterRegistry 面、bindings/ChannelBindingStore 面、cards/
 * ChannelsCardsFace 的出站子集)。运行时缺任一成员即不派生/按 UNWIRED 语义行事。
 */
interface ChannelsServiceFace {
  readonly adapters: {
    list(): readonly { readonly id: string; readonly channelType: ChannelType }[]
    get(id: string): ChannelAdapter | undefined
  }
  readonly bindings: {
    resolveThread(channelType: string, channelUserId: string): ThreadTarget | undefined
  }
  readonly cards: {
    buildReplyCard(input: ReplyCardInput): OutboundCard | undefined
    validateOutboundCard(card: OutboundCard): void
    classifyDeliveryFailure(error: unknown): DeliveryFailureKind
  }
}

/** 回执 kind → 出站卡标题(实现定;buildReplyCard 经 validateOutboundCard 对空标题 fail-closed)。 */
const REPLY_CARD_TITLES: Record<Receipt['kind'], string> = {
  acknowledgement: '任务回执',
  reply: '任务回复',
  notice: '任务通知',
}

/** 宿主 ctx → 服务束的双路读取(sessionHostFromContext plugin.ts:132-141 同款复制)。 */
function serviceOf(ctx: Context, name: string): Record<string, unknown> | undefined {
  const reflect = (ctx as unknown as { readonly reflect?: { get(name: string, strict?: boolean): unknown } }).reflect
  const ctxAny = ctx as unknown as Record<string, unknown>
  try {
    const direct = ctxAny[name]
    if (typeof direct === 'object' && direct !== null) return direct as Record<string, unknown>
  } catch { /* filtered ctx 直读抛错=未注入,落 reflect 兜底 */ }
  const value = reflect?.get(name, false)
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

/** 结构面对齐:任一成员缺失/非函数即 undefined(该次调用按 UNWIRED 语义行事)。 */
function channelsFaceOf(world: Record<string, unknown>): ChannelsServiceFace | undefined {
  const members = [world['adapters'], world['bindings'], world['cards']]
  if (members.some(member => typeof member !== 'object' || member === null)) return undefined
  const callable = (target: Record<string, unknown>, ...names: string[]): boolean =>
    names.every(name => typeof target[name] === 'function')
  const adapters = world['adapters'] as Record<string, unknown>
  const bindings = world['bindings'] as Record<string, unknown>
  const cards = world['cards'] as Record<string, unknown>
  if (!callable(adapters, 'list', 'get') || !callable(bindings, 'resolveThread')) return undefined
  if (!callable(cards, 'buildReplyCard', 'validateOutboundCard', 'classifyDeliveryFailure')) return undefined
  return {
    adapters: adapters as ChannelsServiceFace['adapters'],
    bindings: bindings as ChannelsServiceFace['bindings'],
    cards: cards as ChannelsServiceFace['cards'],
  }
}

/** 逐调用惰性解析:服务束现读 + 结构面对齐(热插拔/挂载时序均现读吸收)。 */
function resolveFace(ctx: Context): ChannelsServiceFace | undefined {
  const world = serviceOf(ctx, 'channels')
  return world !== undefined ? channelsFaceOf(world) : undefined
}

/**
 * 宿主 ctx → Outbox 投递面的机会派生(defineTasksPlugin bootTasks 消费;显式
 * config.channels 恒优先)。派生口径(见头注):
 * - 服务在场且结构面齐备 → 惰性投递面(方法仍逐调用现读,热插拔照常吸收);
 * - 服务缺席 → 仍派生惰性面(boot 时序常态:eterna-tasks 行先于 eterna-channels
 *   行,服务 provide 后的下一次派发即接上,Later 重试吸收空窗);
 * - 服务在场但结构面残缺 → undefined(装配缝保持 UNWIRED_CHANNELS,fail-closed
 *   不包破面——破面与「未派生」同义,收口为装配期可见的判定)。
 */
export function channelsDeliveryFromContext(ctx: Context): ChannelsDelivery | undefined {
  const world = serviceOf(ctx, 'channels')
  // 在场但破面:fail-closed 不派生(UNWIRED);缺席或齐备:派生惰性面。
  if (world !== undefined && channelsFaceOf(world) === undefined) return undefined
  return {
    available: (source: string): boolean => {
      const face = resolveFace(ctx)
      if (face === undefined) return false
      return face.adapters.list().some(adapter => adapter.channelType === source)
    },
    channelAllowed: (channel): boolean => {
      const face = resolveFace(ctx)
      if (face === undefined) return false
      const binding = face.bindings.resolveThread(channel.source, channel.address.channelUserId ?? '')
      return binding?.threadKey === channel.thread
    },
    send: async (receipt): Promise<'sent' | 'waiting' | 'gone'> => {
      const face = resolveFace(ctx)
      if (face === undefined) return 'waiting'
      const entry = face.adapters.list().find(adapter => adapter.channelType === receipt.channel.source)
      const adapter = entry !== undefined ? face.adapters.get(entry.id) : undefined
      if (adapter === undefined) return 'waiting'
      const card = face.cards.buildReplyCard({
        purpose: receipt.kind === 'acknowledgement' ? 'ack' : 'answer',
        title: REPLY_CARD_TITLES[receipt.kind],
        body: receipt.text,
      })
      // working 类中间态不出站(本期映射不会命中;保留通道语义不裁剪)。
      if (card === undefined) return 'waiting'
      // 出站前自检(title/载荷 fail-closed;buildReplyCard 已内校,双检不吞错)。
      face.cards.validateOutboundCard(card)
      try {
        await adapter.sendCard(card, receipt.channel.address.channelUserId ?? '')
        return 'sent'
      } catch (error) {
        if (face.cards.classifyDeliveryFailure(error) === 'channelGone') return 'gone'
        throw error
      }
    },
  }
}
