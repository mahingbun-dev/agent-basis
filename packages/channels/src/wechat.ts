/**
 * 微信三路径适配器接口(12 号文档 §7.6)+ 注册表。
 *
 * 三条官方/半官方路径(实现说明见 docs/wechat-three-paths.md):
 * ① wechat/tencent-official —— 腾讯微信团队官方维护的微信插件
 *    (OpenClaw 生态 `@tencent-weixin/openclaw-weixin`,QR 登录个人微信,
 *    私信+媒体;个人号首选)。
 * ② wechat/wecom-smart-bot —— 企微智能机器人 API 模式(2026-03 官方,
 *    回调+API 收发)。
 * ③ wechat/wechat-cs —— 微信客服 API(个人微信用户免加好友咨询,
 *    合规生产首选)。
 *
 * 社区 iPad/Gewe 协议仅限试点(封号风险),不入本注册表。
 * 三条路径各自的最小传输层接口在本文件声明(不绑定任何 SDK,真实实现由组合层
 * 注入,需运行时联调);卡片出站统一携带审批动作载荷(链接形态,微信无互动卡片)。
 */
import type { ChannelAdapter, DeliveryReceipt, OutboundCard } from './types.ts'
import { cardApprovalPayload, validateOutboundCard } from './cards.ts'

export type WeChatPathId = 'wechat/tencent-official' | 'wechat/wecom-smart-bot' | 'wechat/wechat-cs'

export const WECHAT_PATHS: readonly WeChatPathId[] = [
  'wechat/tencent-official',
  'wechat/wecom-smart-bot',
  'wechat/wechat-cs',
]

/** 路径能力矩阵(选路依据,与 docs/wechat-three-paths.md 对齐)。 */
export interface WeChatAdapterCapabilities {
  readonly login: 'qr' | 'corp' | 'service-account'
  readonly directMessage: boolean
  readonly media: boolean
  /** 免加好友即可触达(客服 API 特性)。 */
  readonly freeContact: boolean
  readonly compliance: 'personal-experimental' | 'official' | 'official-production'
}

export interface WeChatChannelAdapter extends ChannelAdapter {
  readonly channelType: 'wechat'
  readonly path: WeChatPathId
  readonly capabilities: WeChatAdapterCapabilities
}

/* ---------------- ① 腾讯官方插件(个人微信,QR 登录) ---------------- */

/** 最小传输层:与 OpenClaw 微信插件网关的收发面(组合层注入真实网关客户端)。 */
export interface TencentOfficialTransport {
  sendText(toUser: string, text: string): Promise<void>
  sendMedia?(toUser: string, mediaId: string): Promise<void>
  /** 扫码登录,返回二维码与账号外部 ID。 */
  qrLogin(): Promise<{ readonly qrUrl: string; readonly accountExternalId: string }>
}

/* ---------------- ② 企微智能机器人 API 模式 ---------------- */

/** 最小传输层:API 发送 + 回调验签(企微回调 msg_signature 语义)。 */
export interface WeComSmartBotTransport {
  sendText(toUser: string, text: string): Promise<void>
  /** 企微回调验签(sha1(sort(token, timestamp, nonce, encrypt_msg))语义)。 */
  verifyCallback(rawBody: Buffer, msgSignature: string, timestamp: string, nonce: string): Promise<boolean>
}

/* ---------------- ③ 微信客服 API ---------------- */

/** 最小传输层:客服消息同步 + 发送(组合层注入微信客服 API 客户端)。 */
export interface WeChatCsTransport {
  sendText(toUser: string, text: string): Promise<void>
  syncMessages(cursor?: string): Promise<{
    readonly messages: readonly { readonly fromUser: string; readonly text: string; readonly msgId: string }[]
    readonly nextCursor?: string
  }>
}

/** 微信卡片出站形态:文本消息(标题+正文+审批链接,统一携带审批动作载荷)。 */
export function renderWeChatText(card: OutboundCard, options: { readonly approvalBaseUrl: string }): string {
  validateOutboundCard(card)
  const approval = cardApprovalPayload(card)
  const lines = [card.title, '', card.body]
  if (approval !== undefined) {
    lines.push('', '—— 审批操作(链接单次有效)——')
    for (const action of approval.actions) {
      const url = action.url ?? `${options.approvalBaseUrl.replace(/\/$/, '')}/approval/${action.token}`
      lines.push(`${action.label}: ${url}`)
    }
  }
  return lines.join('\n')
}

function createWeChatAdapter(config: {
  readonly path: WeChatPathId
  readonly capabilities: WeChatAdapterCapabilities
  readonly sendText: (toUser: string, text: string) => Promise<void>
  readonly approvalBaseUrl: string
}): WeChatChannelAdapter {
  return {
    id: config.path,
    channelType: 'wechat',
    path: config.path,
    capabilities: config.capabilities,
    async sendCard(card: OutboundCard, recipient: string): Promise<DeliveryReceipt> {
      await config.sendText(recipient, renderWeChatText(card, { approvalBaseUrl: config.approvalBaseUrl }))
      return { delivered: true }
    },
  }
}

export function createTencentOfficialAdapter(options: {
  readonly transport: TencentOfficialTransport
  readonly approvalBaseUrl: string
}): WeChatChannelAdapter & { login(): Promise<{ readonly qrUrl: string; readonly accountExternalId: string }> } {
  const adapter = createWeChatAdapter({
    path: 'wechat/tencent-official',
    capabilities: {
      login: 'qr',
      directMessage: true,
      media: options.transport.sendMedia !== undefined,
      freeContact: false,
      compliance: 'personal-experimental',
    },
    sendText: options.transport.sendText.bind(options.transport),
    approvalBaseUrl: options.approvalBaseUrl,
  })
  return {
    ...adapter,
    login: () => options.transport.qrLogin(),
  }
}

export function createWeComSmartBotAdapter(options: {
  readonly transport: WeComSmartBotTransport
  readonly approvalBaseUrl: string
}): WeChatChannelAdapter & {
  verifyCallback(rawBody: Buffer, msgSignature: string, timestamp: string, nonce: string): Promise<boolean>
} {
  const adapter = createWeChatAdapter({
    path: 'wechat/wecom-smart-bot',
    capabilities: {
      login: 'corp',
      directMessage: true,
      media: false,
      freeContact: false,
      compliance: 'official',
    },
    sendText: options.transport.sendText.bind(options.transport),
    approvalBaseUrl: options.approvalBaseUrl,
  })
  return {
    ...adapter,
    verifyCallback: (rawBody, msgSignature, timestamp, nonce) =>
      options.transport.verifyCallback(rawBody, msgSignature, timestamp, nonce),
  }
}

export function createWeChatCsAdapter(options: {
  readonly transport: WeChatCsTransport
  readonly approvalBaseUrl: string
}): WeChatChannelAdapter & {
  syncMessages(cursor?: string): ReturnType<WeChatCsTransport['syncMessages']>
} {
  const adapter = createWeChatAdapter({
    path: 'wechat/wechat-cs',
    capabilities: {
      login: 'service-account',
      directMessage: true,
      media: false,
      freeContact: true,
      compliance: 'official-production',
    },
    sendText: options.transport.sendText.bind(options.transport),
    approvalBaseUrl: options.approvalBaseUrl,
  })
  return {
    ...adapter,
    syncMessages: (cursor?: string) => options.transport.syncMessages(cursor),
  }
}

/* ---------------- 注册表(唯一 ID,provide 可交换) ---------------- */

export type WeChatAdapterFactory = (deps: {
  readonly approvalBaseUrl: string
}) => WeChatChannelAdapter

export interface WeChatAdapterRegistry {
  register(path: WeChatPathId, factory: WeChatAdapterFactory): void
  create(path: WeChatPathId, deps: { readonly approvalBaseUrl: string }): WeChatChannelAdapter
  knownPaths(): readonly WeChatPathId[]
}

export function createWeChatAdapterRegistry(): WeChatAdapterRegistry {
  const factories = new Map<WeChatPathId, WeChatAdapterFactory>()
  return {
    register(path: WeChatPathId, factory: WeChatAdapterFactory): void {
      factories.set(path, factory)
    },
    create(path: WeChatPathId, deps: { readonly approvalBaseUrl: string }): WeChatChannelAdapter {
      const factory = factories.get(path)
      if (factory === undefined) {
        throw new Error(`[channels] 未知微信路径: ${path}(已知: ${[...factories.keys()].join(', ')})`)
      }
      return factory(deps)
    },
    knownPaths(): readonly WeChatPathId[] {
      return [...factories.keys()]
    },
  }
}

/** 预注册三条官方/半官方路径的注册表(社区协议路径不入表)。 */
export function createDefaultWeChatRegistry(options: {
  readonly tencentOfficial?: { readonly transport: TencentOfficialTransport }
  readonly wecomSmartBot?: { readonly transport: WeComSmartBotTransport }
  readonly wechatCs?: { readonly transport: WeChatCsTransport }
}): WeChatAdapterRegistry {
  const registry = createWeChatAdapterRegistry()
  if (options.tencentOfficial !== undefined) {
    const transport = options.tencentOfficial.transport
    registry.register('wechat/tencent-official', ({ approvalBaseUrl }) =>
      createTencentOfficialAdapter({ transport, approvalBaseUrl }))
  }
  if (options.wecomSmartBot !== undefined) {
    const transport = options.wecomSmartBot.transport
    registry.register('wechat/wecom-smart-bot', ({ approvalBaseUrl }) =>
      createWeComSmartBotAdapter({ transport, approvalBaseUrl }))
  }
  if (options.wechatCs !== undefined) {
    const transport = options.wechatCs.transport
    registry.register('wechat/wechat-cs', ({ approvalBaseUrl }) =>
      createWeChatCsAdapter({ transport, approvalBaseUrl }))
  }
  return registry
}
