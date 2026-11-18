/**
 * Outbox——可靠出站回执投递:持久回执 + 顺序投递 + retried reply effects
 * (35 号 A13;34 号 §2.3 outbox 行)。
 *
 * 设计依据:34 号 §2.3 outbox 行(SA src/app/outbox.ts;24 号 §2.3-6 副作用只经
 * Effects/Outbox;27 号 §3.2-② 回执幂等:同一 id 永不排队两次)。语义自 SA 重写级
 * 校对移植,不变量原样:
 * - `send` 在一个事务内记录回执并入队其投递 effect;重复消息 id 被忽略(幂等);
 * - 同工单同会话的后续消息压在更早的 pending 消息之后(`behind`),直至其连续失败
 *   超过 FAILURES_BEFORE_ERROR 才放行(SA outbox.ts:44-51);
 * - 处理暂停或渠道不可用时消息等待(Later 不计失败);目标会话被忽略/永久不可达
 *   时落 dropped(channelIgnored/channelGone)——回执防止其后重试。
 *
 * 本仓改造(34 号 §2.3 outbox 行;35 号表④-3):投递端从 SA SourceRegistry 换
 * **channels 适配器**——经 `ChannelsDelivery` 端口注入(glue 装配时对接
 * @eterna/channels 的适配器注册表;34 号 §5-channels「结果回到发起渠道」),本包
 * 不 import channels 服务实例(34 号 §1 依赖方向:接线经端口注入)。SA 对飞书
 * 回执文本的 checkedImText 前置校验随 Source 面一并移除——文本/卡片校验归 channels
 * 适配器(cards.ts 的校验面);回执文案语言未拍板(35 号 §12 开放问题 13),本层
 * 只保结构字段。
 */
import type { ChannelRef, Outbox as OutboxPort, OutboundMessage, ReplyStatus } from '../core/index.ts'
import type { Receipt } from '../store/store.ts'
import { FAILURES_BEFORE_ERROR, Later, type Effects } from './effects.ts'
import type { Store } from '../store/store.ts'

/**
 * channels 适配器的投递面(A13 端口注入;glue 对接 @eterna/channels):
 * - `available`:该渠道来源当前可否投递(适配器未注册/停用 → Outbox 以 Later 等待);
 * - `channelAllowed`:该渠道会话是否仍在监听(否 → `channelIgnored` 落 dropped);
 * - `send`:投递一条回执;`waiting`=适配器暂不可用(Later 重试),`gone`=目标永久
 *   不可达(如被撤回的消息、已删除的 Issue → `channelGone` 落 dropped)。
 */
export interface ChannelsDelivery {
  available(source: string): boolean
  channelAllowed(channel: ChannelRef): boolean
  send(receipt: Receipt): Promise<'sent' | 'waiting' | 'gone'>
}

/** Outbox 装配面。 */
export interface OutboxHost {
  readonly store: Pick<Store, 'atomic' | 'receipts'>
  readonly effects: Pick<Effects, 'enqueue' | 'cancel' | 'handle' | 'idle'>
  /** channels 适配器投递面(见 ChannelsDelivery;34 号 §5-channels)。 */
  readonly channels: ChannelsDelivery
  /** 处理是否暂停中(暂停时 reply 并发限为 0,消息挂起)。 */
  paused(): boolean
}

/**
 * 把出站渠道消息持久化为回执,经 Effects 与 channels 适配器顺序投递。
 * 实现 core 的 `Outbox` 端口(Engine 与 Source 上下文的回执面):每工单每会话保序,
 * 直到更早的消息反复失败;暂停或渠道不可用时等待,目标被忽略/消亡时落 dropped。
 */
export class Outbox implements OutboxPort {
  private readonly host: OutboxHost
  constructor(host: OutboxHost) {
    this.host = host
    host.effects.handle('reply', (_payload, id) => this.deliver(id), { limit: () => host.paused() ? 0 : 1, retry: [5000, 300_000] })
  }
  /** 记录回执并原子入队其投递 effect;重复消息 id 被忽略(幂等,27 号 §3.2-②)。 */
  send(message: OutboundMessage): void {
    const { store, effects } = this.host
    store.atomic(() => { if (store.receipts.add(message)) effects.enqueue('reply', message.id, {}) })
  }
  status(id: string): ReplyStatus | undefined { return this.host.store.receipts.get(id)?.status }
  withdraw(id: string): void {
    const { store, effects } = this.host
    store.atomic(() => { if (store.receipts.withdraw(id)) effects.cancel('reply', id) })
  }
  /** 等到没有 reply effect 在跑且无可开始(投递面静止)。 */
  sent(): Promise<void> { return this.host.effects.idle('reply') }
  private async deliver(id: string): Promise<void> {
    const { store, channels } = this.host
    const receipt = store.receipts.get(id)
    if (receipt?.status !== 'pending') return
    if (!channels.available(receipt.channel.source)) throw new Later('渠道适配器不可用或未启用')
    // 同工单同会话的后续消息压在更早的 pending 消息之后,直至其失败超过阈值。
    if (store.receipts.behind(id, FAILURES_BEFORE_ERROR)) throw new Later('该工单到该会话的更早消息仍在等待')
    if (!channels.channelAllowed(receipt.channel)) { store.receipts.settle(receipt, 'channelIgnored'); return }
    const result = await channels.send(receipt)
    if (result === 'waiting') throw new Later('渠道适配器未就绪')
    store.receipts.settle(receipt, result === 'gone' ? 'channelGone' : 'sent')
  }
}
