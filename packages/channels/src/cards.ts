/**
 * 出站卡片:中立 schema + 飞书/钉钉卡片渲染 + 发送接口。
 *
 * 12 号文档 §7.5:飞书/钉钉双向(卡片出站+回调入站)+ 远程审批,"交互卡片按钮=
 * 审批应答"。契约:**所有出站审批卡片统一携带审批按钮动作载荷**
 * (ApprovalActionPayload:approvalRequestId + channel + approve/reject 各一枚
 * 一次性令牌)—— buildApprovalCard 强制装配,validateOutboundCard 强校验,
 * 渲染器(飞书 button.value / 钉钉 actionURL)原样内嵌。
 *
 * 发送接口不真连:传输层 CardTransport 由组合层注入(offline 传输器供测试/演示)。
 */
import type {
  ApprovalActionPayload, ApprovalDecision, ChannelAdapter, DeliveryReceipt, OutboundCard,
} from './types.ts'

export class ChannelsCardError extends Error {
  constructor(message: string) {
    super(`[channels] ${message}`)
  }
}

/** 中立卡片动作(构建入参形态;token 为一次性审批令牌)。 */
export interface CardActionInput {
  readonly label: string
  readonly decision: ApprovalDecision
  readonly token: string
}

export interface BuildApprovalCardInput {
  readonly approvalRequestId: string
  /** 出站渠道适配器 ID(载荷归因)。 */
  readonly channel: string
  readonly title: string
  readonly body: string
  /** 至少含 approve 与 reject 各一枚。 */
  readonly actions: readonly CardActionInput[]
  /** URL 型渠道(钉钉/邮件/微信)渲染时补链接;与 approvalBaseUrl 拼接。 */
  readonly approvalBaseUrl?: string
  readonly metadata?: Readonly<Record<string, string>>
}

function approvalUrl(base: string | undefined, token: string): string | undefined {
  if (base === undefined) return undefined
  return `${base.replace(/\/$/, '')}/approval/${token}`
}

/**
 * 构建审批卡片:统一装配 ApprovalActionPayload。
 * 校验:approvalRequestId 非空;actions 覆盖 approve+reject;token 唯一。
 */
export function buildApprovalCard(input: BuildApprovalCardInput): OutboundCard {
  if (input.approvalRequestId.length === 0) throw new ChannelsCardError('approvalRequestId 不能为空')
  const decisions = new Set(input.actions.map(action => action.decision))
  if (!decisions.has('approve') || !decisions.has('reject')) {
    throw new ChannelsCardError('审批卡片必须同时提供 approve 与 reject 动作')
  }
  const tokens = input.actions.map(action => action.token)
  if (new Set(tokens).size !== tokens.length) throw new ChannelsCardError('动作令牌必须唯一')
  if (tokens.some(token => token.length === 0)) throw new ChannelsCardError('动作令牌不能为空')
  const payload: ApprovalActionPayload = {
    approvalRequestId: input.approvalRequestId,
    channel: input.channel,
    actions: input.actions.map((action) => {
      const url = approvalUrl(input.approvalBaseUrl, action.token)
      return {
        label: action.label,
        decision: action.decision,
        token: action.token,
        ...(url !== undefined && { url }),
      }
    }),
  }
  return {
    kind: 'approval',
    title: input.title,
    body: input.body,
    approval: payload,
    ...(input.metadata !== undefined && { metadata: input.metadata }),
  }
}

/** 出站卡片强校验:kind=approval 必携带完整审批载荷(approve+reject 齐备)。 */
export function validateOutboundCard(card: OutboundCard): void {
  if (card.title.length === 0) throw new ChannelsCardError('卡片标题不能为空')
  if (card.kind !== 'approval') return
  const approval = card.approval
  if (approval === undefined) throw new ChannelsCardError('审批卡片缺少审批动作载荷')
  if (approval.approvalRequestId.length === 0) throw new ChannelsCardError('审批载荷缺 approvalRequestId')
  const decisions = new Set(approval.actions.map(action => action.decision))
  if (!decisions.has('approve') || !decisions.has('reject')) {
    throw new ChannelsCardError('审批载荷必须同时含 approve 与 reject 动作')
  }
}

/** 卡片载荷的统一提取(渲染与审计共用;无载荷时 undefined)。 */
export function cardApprovalPayload(card: OutboundCard): ApprovalActionPayload | undefined {
  validateOutboundCard(card)
  return card.approval
}

/* ------------------------------- 飞书(lark) ------------------------------- */

export interface FeishuCardButton {
  readonly tag: 'button'
  readonly text: { readonly tag: 'plain_text'; readonly content: string }
  readonly type: 'primary' | 'danger' | 'default'
  /** 按钮回调 value:统一内嵌审批动作载荷(平台回调原样带回)。 */
  readonly value: { readonly dshApproval: ApprovalActionPayload; readonly dshAction: ApprovalDecision }
}

export type FeishuCardElement =
  | { readonly tag: 'div'; readonly text: { readonly tag: 'lark_md'; readonly content: string } }
  | { readonly tag: 'hr' }
  | { readonly tag: 'action'; readonly actions: readonly FeishuCardButton[] }

export interface FeishuCardPayload {
  readonly msg_type: 'interactive'
  readonly card: {
    readonly config: { readonly wide_screen_mode: boolean }
    readonly header: { readonly template: 'blue' | 'orange'; readonly title: { readonly tag: 'plain_text'; readonly content: string } }
    readonly elements: readonly FeishuCardElement[]
  }
}

/** 渲染飞书互动卡片;审批按钮 value 内嵌统一动作载荷。 */
export function renderFeishuCard(card: OutboundCard): FeishuCardPayload {
  validateOutboundCard(card)
  const approval = card.approval
  const elements: FeishuCardElement[] = [
    { tag: 'div', text: { tag: 'lark_md', content: card.body } },
  ]
  if (approval !== undefined) {
    elements.push({ tag: 'hr' })
    elements.push({
      tag: 'action',
      actions: approval.actions.map(action => ({
        tag: 'button' as const,
        text: { tag: 'plain_text' as const, content: action.label },
        type: action.decision === 'approve' ? ('primary' as const) : ('danger' as const),
        value: { dshApproval: approval, dshAction: action.decision },
      })),
    })
  }
  return {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: card.kind === 'approval' ? 'orange' : 'blue',
        title: { tag: 'plain_text', content: card.title },
      },
      elements,
    },
  }
}

/* -------------------------------- 钉钉 -------------------------------- */

export interface DingTalkCardPayload {
  readonly msgtype: 'actionCard'
  readonly actionCard: {
    readonly title: string
    readonly text: string
    readonly btnOrientation: '0'
    readonly btns: readonly { readonly title: string; readonly actionURL: string }[]
  }
}

/** 渲染钉钉 actionCard;审批按钮为 URL 型(走 /approval/:token 一次性令牌)。 */
export function renderDingTalkCard(card: OutboundCard, options: { readonly approvalBaseUrl: string }): DingTalkCardPayload {
  validateOutboundCard(card)
  if (options.approvalBaseUrl.length === 0) throw new ChannelsCardError('approvalBaseUrl 不能为空')
  const approval = card.approval
  const btns: { title: string; actionURL: string }[] = []
  if (approval !== undefined) {
    for (const action of approval.actions) {
      const url = action.url ?? approvalUrl(options.approvalBaseUrl, action.token)
      if (url === undefined) throw new ChannelsCardError('钉钉审批动作必须有 URL(approvalBaseUrl)')
      btns.push({ title: action.label, actionURL: url })
    }
  }
  if (btns.length === 0) btns.push({ title: '查看详情', actionURL: options.approvalBaseUrl })
  return {
    msgtype: 'actionCard',
    actionCard: {
      title: card.title,
      text: `### ${card.title}\n\n${card.body}`,
      btnOrientation: '0',
      btns,
    },
  }
}

/* ------------------------------ 发送接口层 ------------------------------ */

/** 卡片传输层:把渠道原生 payload 发出去(组合层注入真实实现;不真连)。 */
export type CardTransport = (payload: unknown, recipient: string) => Promise<void>

/** offline 传输器:记录发送(测试/演示;无网络副作用)。 */
export interface OfflineCardTransport extends CardTransport {
  readonly sent: readonly { readonly payload: unknown; readonly recipient: string }[]
}

export function createOfflineCardTransport(): OfflineCardTransport {
  const sent: { payload: unknown; recipient: string }[] = []
  const transport = (payload: unknown, recipient: string): Promise<void> => {
    sent.push({ payload, recipient })
    return Promise.resolve()
  }
  return Object.assign(transport, { sent })
}

export interface FeishuAdapterOptions {
  readonly transport: CardTransport
}

/** 飞书发送适配器(id='feishu/card');发送前强校验统一审批载荷。 */
export function createFeishuChannelAdapter(options: FeishuAdapterOptions): ChannelAdapter {
  return {
    id: 'feishu/card',
    channelType: 'feishu',
    async sendCard(card: OutboundCard, recipient: string): Promise<DeliveryReceipt> {
      const payload = renderFeishuCard(card)
      await options.transport(payload, recipient)
      return { delivered: true }
    },
  }
}

export interface DingTalkAdapterOptions {
  readonly transport: CardTransport
  readonly approvalBaseUrl: string
}

/** 钉钉发送适配器(id='dingtalk/card');审批按钮 URL 指向一次性令牌网关。 */
export function createDingTalkChannelAdapter(options: DingTalkAdapterOptions): ChannelAdapter {
  return {
    id: 'dingtalk/card',
    channelType: 'dingtalk',
    async sendCard(card: OutboundCard, recipient: string): Promise<DeliveryReceipt> {
      const payload = renderDingTalkCard(card, { approvalBaseUrl: options.approvalBaseUrl })
      await options.transport(payload, recipient)
      return { delivered: true }
    },
  }
}
