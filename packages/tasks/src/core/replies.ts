/**
 * Replies——Engine 发往 Channels 的消息,每种 purpose 各按允许它的规则(35 号 A9)。
 *
 * 设计依据:34 号 §2.1 replies 行;语义自 SA/src/core/replies.ts 重写级校对移植,
 * 不变量原样:四种 purpose(acknowledgement/answer/result/attention)规则与幂等 id
 * (同一 id 永不排队两次,27 号 §3.2-②)——确定性 id 由 ids.key 内容派生。
 * 投递面经 Outbox 端口出站(channels 适配器接线归 35 号 A13 src/effects/outbox.ts,
 * 本部件只认 ports.ts 的 Outbox 契约);回执文案语言不在拍板面(35 号 §12-13 开放问题,
 * 结构字段按 SA 原样)。Tickets 请它发 accept 携带的确认回执,Assignments 请它撤回
 * 被报告替换的 Attention 问题(24 §5.5-R5)。
 */
import { key } from './ids.ts'
import { UserError } from './errors.ts'
import { latestAssignment, liveTicket, ticketOutcome } from './model.ts'
import type { ChannelRef, Ticket, Trigger } from './model.ts'
import type { ReplyStatus } from './ports.ts'
import { EnginePart } from './part.ts'

/**
 * 发往某渠道的一条消息请求,按 purpose:Executor 对其正在处理的人的请求的确认(acknowledgement)、
 * worker 已报告的人的提问的答复(answer)、工单在 `ready`/`completed`/`merged`/`dropped` 时的结果
 * (result)、或工单当前给人的开放问题(attention)。省略 `ticketId` 时,取 `triggerId` 到达的工单。
 */
export type ReplyRequest =
  | { purpose: 'acknowledgement'; ticketId: string; triggerId: string; text: string }
  | { purpose: 'answer' | 'result' | 'attention'; ticketId?: string; triggerId?: string; question?: string; text: string }
/** 已排队的一条消息:其 id、是否已发出、以及更早的请求是否已排过它。 */
export interface Reply { id: string; status: ReplyStatus; reused: boolean }

/**
 * Replies 经 Outbox 端口写出 Engine 发往 Channels 的消息:确认、人对提问所得的答复、工单结果、
 * 与工单给人的问题——各只在其规则允许时发出,并以确定性 id 保证同一消息至多排队一次(幂等)。
 * Engine 把 `reply` 路由到这里;Tickets 请求 accept 携带的确认,Assignments 请求撤回被替换的问题。
 */
export class Replies extends EnginePart {
  /**
   * 按 purpose 的规则把一条消息排到其渠道:确认与答复发往人的消息被写下的地方,attention 发往
   * 提出该问题的消息处(否则发往工单发起的会话),结果发往工单发起的会话(`result` 仅允许
   * `ready`/`completed`/`merged`/`dropped` 的工单)。每条消息至多排队一次(幂等)。确认——即使
   * 已排过队——都记录该工单的 worker 接手了那条消息。
   * @throws UserError 当工单或 trigger 未知,或 purpose 的规则拒绝它——例如未就绪工单的 result。
   */
  reply(request: ReplyRequest): Reply {
    return request.purpose === 'acknowledgement' ? this.acknowledge(request) : this.answer(request)
  }
  /**
   * 把 accept 携带的确认回执排到开启工单的消息被写下的地方——该消息有渠道、且是人写的才发。
   */
  acknowledgeAccepted(ticketId: string, trigger: Trigger, text: string): void {
    if (trigger.channel && trigger.human) this.options.outbox.send({ id: key('ack', trigger.id), channel: trigger.channel, text, kind: 'acknowledgement', ticketId })
  }
  /** 从 outbox 撤回工单给人的问题,除非它已发出。 */
  withdrawAttention(attentionId: string): void { this.options.outbox.withdraw(key('attention-reply', attentionId)) }
  private acknowledge(request: Extract<ReplyRequest, { purpose: 'acknowledgement' }>): Reply {
    const ticket = this.require(request.ticketId)
    if (!liveTicket(ticket)) throw new UserError('ackEnded')
    const trigger = this.repo.triggers.get(request.triggerId)
    if (!trigger) throw new UserError('unknownTrigger')
    // 仅为上下文而跟随的线程只读,不可承接确认。
    if (!this.reaches(ticket, trigger, false)) throw new UserError('notReached')
    if (!trigger.channel) throw new UserError('ackNoChannel')
    const id = key('ack', trigger.id)
    const existing = this.options.outbox.status(id)
    if (!existing && !trigger.human) throw new UserError('ackNotPerson')
    // 保留自动的、或最先排队的那条确认。
    if (!existing) this.options.outbox.send({ id, channel: trigger.channel, text: request.text, kind: 'acknowledgement', ticketId: ticket.id })
    this.takeUp(ticket.id, trigger.id)
    return { id, status: this.options.outbox.status(id) ?? 'pending', reused: existing !== undefined }
  }
  private answer(request: Exclude<ReplyRequest, { purpose: 'acknowledgement' }>): Reply {
    const trigger = request.triggerId ? this.repo.triggers.get(request.triggerId) : undefined
    if (request.triggerId && !trigger) throw new UserError('unknownTrigger')
    const ticket = request.ticketId ? this.require(request.ticketId)
      : trigger ? this.repo.tickets.list().find(item => this.reaches(item, trigger)) : undefined
    if (request.purpose === 'result') {
      const outcome = ticket && ticketOutcome(ticket)
      const reported = !!ticket && liveTicket(ticket) && latestAssignment(ticket)?.report?.state === 'ready'
      const ready = outcome === 'merged' || outcome === 'completed' || outcome === 'dropped' || reported
      if (!ticket || !ready) throw new UserError('notReady')
    }
    const attention = request.purpose === 'attention' ? ticket?.attention : undefined
    // attention 回执必须与工单当前开放的问题文本一致。
    if (request.purpose === 'attention' && (!attention || attention.question !== request.question)) throw new UserError('notAttention')
    if (request.purpose === 'answer' && !trigger?.human) throw new UserError('notQuestion')
    const id = attention ? key('attention-reply', attention.id) : key('reply', trigger?.id ?? ticket?.id ?? '', request.text)
    const existing = this.options.outbox.status(id)
    const ready = !ticket || !trigger || ticket.answers?.includes(trigger.id)
    if (request.purpose === 'answer' && !ready && !existing) throw new UserError('noAnswer')
    const asker = attention?.triggerId ? this.repo.triggers.get(attention.triggerId) : undefined
    // answer 的渠道必在(上文 notQuestion 已保证 trigger 为人的消息);attention 结果发往提问消息处,否则工单发起会话。
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const channel: ChannelRef | undefined = request.purpose === 'answer' ? trigger!.channel : asker?.channel ?? (ticket ? this.sourceChannel(ticket) : undefined)
    if (!channel) throw new UserError('noChannel')
    this.options.outbox.send({ id, channel, text: request.text, kind: 'reply', ...ticket ? { ticketId: ticket.id } : {} })
    if (request.purpose === 'answer' && ticket && trigger && ticket.answers?.includes(trigger.id)) {
      ticket.answers = ticket.answers.filter(item => item !== trigger.id)
      this.repo.tickets.save(ticket)
    }
    return { id, status: this.options.outbox.status(id) ?? 'pending', reused: existing !== undefined }
  }
  /** 工单发起的会话:其 origin Trigger 的渠道,否则其第一个渠道。 */
  private sourceChannel(ticket: Ticket): ChannelRef | undefined { return this.source(ticket)?.channel ?? ticket.channels[0] }
}
