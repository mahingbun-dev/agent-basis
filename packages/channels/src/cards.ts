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

/* --------------- Outbox reply 出站 + 报告六态渲染(39 号 E7) --------------- */

/**
 * 工单报告六态(39 号 §3-E7;枚举权威=24 号 §2.3-机制 5)。31 号 §2.2 铁律 1
 * 「Tier1 永不 import Tier2」下在本包内部声明,与 @eterna/tasks core model.ts 的
 * `ReportState` 逐态同构、语义同一(tasks 侧适配本面),两侧不得单侧增删态值。
 */
export type ReportState = 'progress' | 'waiting' | 'ready' | 'blocked' | 'failed' | 'dropped'

/**
 * 工单报告六态文案(39 号 §3-E7;枚举=24 号 §2.3-5)。状态语义逐态对齐 tasks
 * model 的权威注释(model.ts「工作在进行/其 worker 在等一条 Trigger/结果就绪/
 * 需要人行动才能解锁或恢复/无事可做」),文案仅描述状态、不加设计外语义
 * (「半成品标为半成品,失败报为失败」,24 号 §2.1 行为律 5)。
 */
const REPORT_STATE_LINES: Record<ReportState, string> = {
  progress: '进行中:工作在进行',
  waiting: '等待中:worker 在等一条消息',
  ready: '就绪:结果已就绪',
  blocked: '受阻:需要人行动才能解锁',
  failed: '失败:需要人行动才能恢复',
  dropped: '已放弃:无事可做',
}

/**
 * 六态 → 中文文案行(进卡片 body;39 号 §3-E7 落点原文)。
 * 返回形态:首行状态、次行摘要(summary 非空时)——Outbox 结果/摘要卡的渠道端渲染。
 */
export function renderReportLines(state: ReportState, summary: string): string {
  const lines = [REPORT_STATE_LINES[state]]
  if (summary.length > 0) lines.push(`摘要:${summary}`)
  return lines.join('\n')
}

/** 投递失败的归类(39 号 E7;「channelIgnored/channelGone 落 dropped」,34 号 §4-C)。 */
export type DeliveryFailureKind = 'channelIgnored' | 'channelGone' | 'transient'

/**
 * 带显式归类标记的投递错误:适配器对「渠道侧明确拒绝/忽略」(channelIgnored)与
 * 「渠道/会话已消失」(channelGone)抛出;两者在 tasks 侧落 dropped(不重试);
 * 一切未显式标记的错误(网络抖动等)一律 transient(可重试,归 effects 退避)。
 */
export class ChannelsDeliveryError extends Error {
  readonly failureKind: Exclude<DeliveryFailureKind, 'transient'>

  constructor(message: string, failureKind: Exclude<DeliveryFailureKind, 'transient'>) {
    super(`[channels] ${message}`)
    this.failureKind = failureKind
  }
}

/**
 * 投递错误分类(39 号 §3-E7 落点原文):只认 ChannelsDeliveryError 上的显式标记,
 * 未标记错误归 'transient'——落 dropped 的记账在 tasks 侧,channels 只提供分类面。
 */
export function classifyDeliveryFailure(error: unknown): DeliveryFailureKind {
  if (error instanceof ChannelsDeliveryError) return error.failureKind
  return 'transient'
}

/** Outbox 回执消息的四种 purpose(34 号 §2.1 replies 行:ack/answer/result/attention)。 */
export type ReplyPurpose = 'ack' | 'answer' | 'result' | 'attention'

/** result purpose 携带的工单报告(六态 + 摘要;进文案与 metadata)。 */
export interface ReplyReportInput {
  readonly state: ReportState
  readonly summary: string
}

/**
 * Outbox 回执 → 出站卡片的组卡入参:
 * - purpose=attention:必须携带 approval(BuildApprovalCardInput,载荷契约同 E4——
 *   approve/reject 各一枚一次性令牌,buildApprovalCard 强制装配);
 * - purpose=result:携带 report(六态经 renderReportLines 进文案,并落 metadata.reportState);
 * - purpose=ack/answer:正文即 body。
 */
export interface ReplyCardInput {
  readonly purpose: ReplyPurpose
  readonly title: string
  readonly body?: string
  readonly report?: ReplyReportInput
  readonly approval?: BuildApprovalCardInput
}

/**
 * Outbox `reply` 投递器的渠道端组卡(39 号 E7 渲染映射;34 号 §5-channels「Outbox
 * reply 投递器经 channels 适配器出站——结果回到发起渠道」的 channels 半边):
 * - attention → kind='approval'(载荷契约同 E4,validateOutboundCard 强校验路径);
 * - ack/answer/result → kind='delivery'(不扩 OutboundCardKind 枚举,types.ts 既有三值);
 * - working 类中间态(progress/waiting)不产生出站卡 → 返回 undefined
 *   (「进度不进 IM」,24 号 §7.6;replies 无 progress purpose,34 号 §2.1)。
 * 组卡产物过 validateOutboundCard 自检(title/载荷 fail-closed)。
 */
export function buildReplyCard(input: ReplyCardInput): OutboundCard | undefined {
  // working 类中间态不出站:出站只发生在 purpose 存在时(终/卡态经 result/attention 承载)。
  if (input.report !== undefined && (input.report.state === 'progress' || input.report.state === 'waiting')) {
    return undefined
  }
  if (input.purpose === 'attention') {
    if (input.approval === undefined) {
      throw new ChannelsCardError('attention 回执必须携带审批载荷输入(approve/reject 各一枚令牌)')
    }
    const card = buildApprovalCard(input.approval)
    validateOutboundCard(card)
    return card
  }
  const body = input.report !== undefined
    ? renderReportLines(input.report.state, input.report.summary)
    : input.body ?? ''
  const card: OutboundCard = {
    kind: 'delivery',
    title: input.title,
    body,
    ...(input.report !== undefined && { metadata: { reportState: input.report.state } }),
  }
  validateOutboundCard(card)
  return card
}
