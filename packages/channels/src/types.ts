/**
 * @basis/channels 公共类型:通道标识、入站消息、会话接口、审批动作载荷、出站卡片。
 *
 * 会话接口(SessionPort)是本地最小形态,组合层桥接到 DSH 的 acp seam
 * (../dsh-repo packages/acp/acp/src/index.ts:361 `session/prompt`、:171
 * `client.session.requestPermission`):deliverInbound 对应 session/prompt 追加
 * 一条用户消息;answerApproval 对应远程应答 permission prompt(one-shot)。
 * seam 钉住见 tests/types.seam-pin.ts。
 */

/** 支持的渠道类型(webhook 网关按它路由验签密钥)。 */
export type ChannelType = 'email' | 'wechat' | 'wecom' | 'feishu' | 'dingtalk' | 'webhook'

/** 审批决定(令牌在签发时即与决定绑定,防止"批准令牌被当拒绝用")。 */
export type ApprovalDecision = 'approve' | 'reject'

/** 渠道侧入站消息(未绑定会话前)。 */
export interface InboundMessage {
  readonly channelType: ChannelType
  readonly channelUserId: string
  readonly text: string
  readonly messageId?: string
  /** ISO-8601;缺省由网关补当前时间。 */
  readonly occurredAt?: string
}

/** 已解析到会话的投递单元(deliverInbound 的载荷)。 */
export interface InboundDelivery extends InboundMessage {
  readonly sessionId: string
}

/** 远程审批应答(answerApproval 的载荷;对应 acp request_permission 的一次性应答)。 */
export interface ApprovalAnswer {
  readonly approvalRequestId: string
  readonly sessionId: string
  readonly decision: ApprovalDecision
  readonly via: ChannelType
}

/**
 * 会话接口:入站消息投递 + 审批应答回传。
 * 真实实现由组合层提供(桥接 DSH acp / api gateway);本包测试用假实现。
 */
export interface SessionPort {
  deliverInbound(delivery: InboundDelivery): Promise<void>
  answerApproval(answer: ApprovalAnswer): Promise<void>
}

/**
 * 审批按钮动作载荷 —— 所有出站审批卡片统一携带。
 * 结构在飞书(button.value)/钉钉(actionURL)/邮件(链接)/微信(文本链接)四种
 * 渲染形态中保持同构:approvalRequestId + channel + 每个决定一枚一次性令牌。
 */
export interface ApprovalActionPayload {
  readonly approvalRequestId: string
  /** 出站渠道适配器 ID(如 'feishu/card'),回执时用于归因。 */
  readonly channel: string
  /** 至少含 approve 与 reject 各一枚动作;token 即一次性审批令牌。 */
  readonly actions: readonly ApprovalAction[]
}

export interface ApprovalAction {
  readonly label: string
  readonly decision: ApprovalDecision
  /** 一次性审批令牌(32 字节随机,base64url)。 */
  readonly token: string
  /** 可点 URL(渲染需要 URL 的渠道时由 approvalBaseUrl 生成)。 */
  readonly url?: string
}

export type OutboundCardKind = 'approval' | 'progress' | 'delivery'

/** 中立出站卡片 schema;kind=approval 时必须携带 approval 载荷(cards.ts 强校验)。 */
export interface OutboundCard {
  readonly kind: OutboundCardKind
  readonly title: string
  readonly body: string
  readonly approval?: ApprovalActionPayload
  readonly metadata?: Readonly<Record<string, string>>
}

export interface DeliveryReceipt {
  readonly delivered: true
  readonly messageId?: string
}

/** 通道适配器公共面(注册表 + 唯一 ID 形态,Cordis provide 可交换)。 */
export interface ChannelAdapter {
  /** 唯一 ID,如 'feishu/card'、'email/imap-smtp'、'wechat/tencent-official'。 */
  readonly id: string
  readonly channelType: ChannelType
  sendCard(card: OutboundCard, recipient: string): Promise<DeliveryReceipt>
}

/** 适配器注册表:唯一 ID → 适配器实例;组合层以 ctx.channels provide。 */
export interface ChannelAdapterRegistry {
  register(adapter: ChannelAdapter): void
  get(id: string): ChannelAdapter | undefined
  list(): readonly { readonly id: string; readonly channelType: ChannelType }[]
}

export function createAdapterRegistry(): ChannelAdapterRegistry {
  const adapters = new Map<string, ChannelAdapter>()
  return {
    register(adapter: ChannelAdapter): void {
      if (adapter.id.length === 0) throw new Error('[channels] adapter id 不能为空')
      const existing = adapters.get(adapter.id)
      if (existing !== undefined && existing !== adapter) {
        throw new Error(`[channels] 适配器 ID 冲突: ${adapter.id}`)
      }
      adapters.set(adapter.id, adapter)
    },
    get(id: string): ChannelAdapter | undefined {
      return adapters.get(id)
    },
    list(): readonly { readonly id: string; readonly channelType: ChannelType }[] {
      return [...adapters.values()].map(adapter => ({ id: adapter.id, channelType: adapter.channelType }))
    },
  }
}
