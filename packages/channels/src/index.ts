/**
 * @eterna/channels —— L1 通道插件(策略与接口层)。
 *
 * 六个模块:
 * 1. binding.ts:渠道绑定存储(channel_user_id↔session_id↔渠道类型,sqlite;
 *    多渠道收敛同一会话,同身份 re-bind 即移绑续接)。
 * 2. token.ts:一次性审批令牌(签发绑定 approval 请求 ID+过期;校验单次有效
 *    防重放;revokeAll 作废)—— 邮件审批防伪造核心(12 号 §7.7)。
 * 3. webhook.ts:入站网关(极简 http server:HMAC 验签→投递绑定 session;
 *    /approval/:token 邮件令牌点击路由)。
 * 4. cards.ts:出站卡片中立 schema + 飞书/钉钉渲染 + 发送接口;
 *    所有出站审批卡片统一携带审批按钮动作载荷。
 * 5. email.ts:邮箱适配器接口(IMAP 收/SMTP 发,nodemailer 类型钉住不真连;
 *    正文"同意"字样永不放行)。
 * 6. wechat.ts:微信三路径适配器接口(腾讯官方插件/企微智能机器人/微信客服)
 *    + 注册表;实现说明见 docs/wechat-three-paths.md。
 *
 * Cordis 纪律:本包不触碰 ctx 全局;组合层把 createChannelsService() 的产物以
 * `ctx.channels` 服务(注册表 + CHANNELS_SERVICE_ID 唯一 ID)形态 provide,
 * 可交换、可配逆(binding/token 存储与 gateway 句柄都带显式 close)。
 * seam 编译期钉住见 tests/types.seam-pin.ts(nodemailer Transporter、
 * dsh storage-domain KvTable)。
 */
import { DatabaseSync } from 'node:sqlite'
import { ChannelBindingStore } from './binding.ts'
import { ApprovalTokenService, type ApprovalTokenServiceOptions } from './token.ts'
import { WebhookGateway, type WebhookGatewayHandle, type WebhookSecretTable } from './webhook.ts'
import { createAdapterRegistry, type ChannelAdapter, type ChannelAdapterRegistry, type SessionPort } from './types.ts'

export { ChannelBindingStore, bindingKey } from './binding.ts'
export type { BindOutcome, ChannelBindingRecord, ChannelBindingStoreOptions } from './binding.ts'
export { ApprovalTokenService, hashApprovalToken } from './token.ts'
export type {
  ApprovalTokenGrant, ApprovalTokenIssueInput, ApprovalTokenRedemption, ApprovalTokenServiceOptions,
} from './token.ts'
export { WebhookGateway } from './webhook.ts'
export type {
  WebhookChannelSecret, WebhookEnvelope, WebhookGatewayHandle, WebhookGatewayOptions, WebhookSecretTable,
} from './webhook.ts'
export {
  buildApprovalCard, cardApprovalPayload, ChannelsCardError, createDingTalkChannelAdapter,
  createFeishuChannelAdapter, createOfflineCardTransport, renderDingTalkCard, renderFeishuCard,
  validateOutboundCard,
} from './cards.ts'
export type {
  BuildApprovalCardInput, CardActionInput, CardTransport, DingTalkAdapterOptions, DingTalkCardPayload,
  FeishuAdapterOptions, FeishuCardButton, FeishuCardElement, FeishuCardPayload, OfflineCardTransport,
} from './cards.ts'
export {
  approvalLink, buildApprovalEmail, createEmailChannelAdapter, FREE_TEXT_CONSENT_PATTERN, parseEmailApproval,
} from './email.ts'
export type {
  EmailAdapterOptions, EmailApprovalIntent, EmailChannelAdapter, EmailRawMessage, ImapMailSource,
  SmtpTransportLike,
} from './email.ts'
export {
  createDefaultWeChatRegistry, createTencentOfficialAdapter, createWeChatAdapterRegistry, createWeChatCsAdapter,
  createWeComSmartBotAdapter, renderWeChatText, WECHAT_PATHS,
} from './wechat.ts'
export type {
  TencentOfficialTransport, WeChatAdapterFactory, WeChatAdapterCapabilities, WeChatAdapterRegistry,
  WeChatChannelAdapter, WeChatCsTransport, WeChatPathId, WeComSmartBotTransport,
} from './wechat.ts'
export { createAdapterRegistry } from './types.ts'
export type {
  ApprovalAction, ApprovalActionPayload, ApprovalAnswer, ApprovalDecision, ChannelAdapter, ChannelAdapterRegistry,
  ChannelType, DeliveryReceipt, InboundDelivery, InboundMessage, OutboundCard, OutboundCardKind, SessionPort,
} from './types.ts'

/** 组合层注册 ctx.channels 服务时的唯一 ID(注册表 + 唯一 ID,provide 可交换)。 */
export const CHANNELS_SERVICE_ID = '@eterna/channels'

export interface ChannelsService {
  readonly id: typeof CHANNELS_SERVICE_ID
  readonly bindings: ChannelBindingStore
  readonly tokens: ApprovalTokenService
  readonly adapters: ChannelAdapterRegistry
  /**
   * 启动入站网关;返回句柄的 close() 即配逆(Cordis effect 逆闭包)。
   * 审批令牌路由(/approval/:token)与 approval_click 信封自动接通 tokens 服务。
   */
  startWebhookGateway(options: {
    readonly sessionPort: SessionPort
    readonly secrets: WebhookSecretTable
    readonly host?: string
    readonly port?: number
    readonly pathPrefix?: string
  }): Promise<WebhookGatewayHandle>
}

export interface ChannelsServiceOptions {
  /** sqlite 库文件路径;缺省 ':memory:'(测试/演示;生产给磁盘路径)。 */
  readonly dbPath?: string
  readonly adapters?: readonly ChannelAdapter[]
  readonly tokenOptions?: ApprovalTokenServiceOptions
  readonly now?: () => Date
}

/** 组装通道服务(纯对象,无隐藏全局;显式 close 收口存储)。 */
export function createChannelsService(options: ChannelsServiceOptions = {}): ChannelsService & { close(): void } {
  const db = new DatabaseSync(options.dbPath ?? ':memory:')
  const now = options.now ?? ((): Date => new Date())
  const bindings = new ChannelBindingStore(db, { now })
  const tokens = new ApprovalTokenService(db, {
    ...options.tokenOptions,
    now: options.tokenOptions?.now ?? ((): number => now().getTime()),
  })
  const adapters = createAdapterRegistry()
  for (const adapter of options.adapters ?? []) adapters.register(adapter)
  return {
    id: CHANNELS_SERVICE_ID,
    bindings,
    tokens,
    adapters,
    async startWebhookGateway(gatewayOptions): Promise<WebhookGatewayHandle> {
      const gateway = new WebhookGateway({
        bindings,
        tokens,
        sessionPort: gatewayOptions.sessionPort,
        secrets: gatewayOptions.secrets,
        ...(gatewayOptions.host !== undefined && { host: gatewayOptions.host }),
        ...(gatewayOptions.port !== undefined && { port: gatewayOptions.port }),
        ...(gatewayOptions.pathPrefix !== undefined && { pathPrefix: gatewayOptions.pathPrefix }),
      })
      return gateway.start()
    },
    close(): void {
      db.close()
    },
  }
}
