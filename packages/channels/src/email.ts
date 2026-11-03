/**
 * 邮箱适配器接口(IMAP 收 / SMTP 发)。transport 用 nodemailer 的类型定义钉住,
 * 但**不真连**:SMTP 传输名义类型 SmtpTransportLike 是 nodemailer `Transporter`
 * 的结构子集(seam 钉住见 tests/types.seam-pin.ts);IMAP 收件源是本地最小接口
 * ImapMailSource,真实 IMAP 客户端由组合层注入。需运行时联调项见包 README。
 *
 * 12 号文档 §7.7 防伪造红线:**禁止解析正文"同意"字样放行**。唯一合法的邮件
 * 审批回执是审批链接里的一次性令牌 —— parseEmailApproval 只从链接提取令牌,
 * 正文里的自由文本(同意/approve/批准)永远不产生审批决定。
 */
import type { SendMailOptions } from 'nodemailer'
import type { ChannelAdapter, DeliveryReceipt, InboundMessage, OutboundCard } from './types.ts'
import { cardApprovalPayload, validateOutboundCard } from './cards.ts'

/** SMTP 传输层(nodemailer `Transporter` 的结构子集;组合层注入真实连接)。 */
export interface SmtpTransportLike {
  sendMail(mail: SendMailOptions): Promise<{ readonly messageId?: string }>
}

/** IMAP 原始邮件(本地最小接口;真实客户端由组合层注入)。 */
export interface EmailRawMessage {
  readonly messageId: string
  readonly from: string
  readonly subject: string
  readonly textBody: string
  readonly htmlBody?: string
  readonly receivedAt: string
}

/** IMAP 收件源:拉取未读 + 标记已读(组合层注入真实 IMAP 会话)。 */
export interface ImapMailSource {
  fetchUnseen(): Promise<readonly EmailRawMessage[]>
  markSeen(messageId: string): Promise<void>
}

export interface EmailChannelAdapter extends ChannelAdapter {
  readonly id: 'email/imap-smtp'
  readonly channelType: 'email'
  /** 拉取未读并归一为入站消息(顺手标记已读;绝不解析正文语义)。 */
  pollInbound(): Promise<readonly InboundMessage[]>
  /** 直发邮件(审批卡片之外的普通出站)。 */
  smtpSend(mail: SendMailOptions): Promise<DeliveryReceipt>
}

export interface EmailAdapterOptions {
  readonly imap: ImapMailSource
  readonly smtp: SmtpTransportLike
  readonly fromAddress: string
}

export function createEmailChannelAdapter(options: EmailAdapterOptions): EmailChannelAdapter {
  const adapter: EmailChannelAdapter = {
    id: 'email/imap-smtp',
    channelType: 'email',
    async pollInbound(): Promise<readonly InboundMessage[]> {
      const unseen = await options.imap.fetchUnseen()
      const messages: InboundMessage[] = []
      for (const mail of unseen) {
        messages.push({
          channelType: 'email',
          channelUserId: mail.from,
          text: mail.subject.length > 0 ? `${mail.subject}\n${mail.textBody}` : mail.textBody,
          messageId: mail.messageId,
          occurredAt: mail.receivedAt,
        })
        await options.imap.markSeen(mail.messageId)
      }
      return messages
    },
    async smtpSend(mail: SendMailOptions): Promise<DeliveryReceipt> {
      const result = await options.smtp.sendMail(mail)
      return { delivered: true, ...(result.messageId !== undefined && { messageId: result.messageId }) }
    },
    async sendCard(card: OutboundCard, recipient: string): Promise<DeliveryReceipt> {
      const mail = buildCardEmail(card, { from: options.fromAddress, to: recipient })
      return adapter.smtpSend(mail)
    },
  }
  return adapter
}

/** 审批链接的 URL 形态:{base}/approval/{token}(GET,点击即单次消费)。 */
export function approvalLink(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, '')}/approval/${token}`
}

/**
 * 审批邮件构建:html + text 双通道,每枚令牌一个链接,统一携带审批动作载荷。
 */
export function buildApprovalEmail(
  card: OutboundCard,
  options: { readonly from: string; readonly to: string; readonly approvalBaseUrl: string },
): SendMailOptions {
  validateOutboundCard(card)
  const approval = cardApprovalPayload(card)
  if (approval === undefined) throw new Error('[channels] 非审批卡片走 buildApprovalEmail')
  const lines: string[] = [card.body, '', '—— 审批操作(链接单次有效,过期作废)——']
  const htmlParts: string[] = [`<p>${escapeHtml(card.body)}</p>`, '<hr>', '<p>审批操作(链接单次有效,过期作废):</p><ul>']
  for (const action of approval.actions) {
    const url = action.url ?? approvalLink(options.approvalBaseUrl, action.token)
    lines.push(`- ${action.label}: ${url}`)
    htmlParts.push(`<li><a href="${url}">${escapeHtml(action.label)}</a></li>`)
  }
  htmlParts.push('</ul>')
  return {
    from: options.from,
    to: options.to,
    subject: `[审批] ${card.title}`,
    text: lines.join('\n'),
    html: htmlParts.join(''),
  }
}

function buildCardEmail(card: OutboundCard, route: { readonly from: string; readonly to: string }): SendMailOptions {
  validateOutboundCard(card)
  const approval = cardApprovalPayload(card)
  if (approval === undefined) {
    return { from: route.from, to: route.to, subject: card.title, text: card.body }
  }
  const lines = [card.body]
  for (const action of approval.actions) {
    const url = action.url
    lines.push(`- ${action.label}${url === undefined ? '' : `: ${url}`}`)
  }
  return { from: route.from, to: route.to, subject: `[${card.kind}] ${card.title}`, text: lines.join('\n') }
}

/**
 * 邮件审批回执解析:只认审批链接里的一次性令牌。
 * 返回 'none' 表示本邮件不构成审批回执 —— 包括正文只有"同意/批准/approve"
 * 等自由文本的情形(防伪造红线:自由文本永远不放行)。
 */
export type EmailApprovalIntent =
  | { readonly kind: 'token'; readonly token: string }
  | { readonly kind: 'none' }

const APPROVAL_LINK_PATTERN = /\/approval\/([A-Za-z0-9_-]{16,})/g

export function parseEmailApproval(mail: EmailRawMessage): EmailApprovalIntent {
  const haystacks = [mail.textBody, mail.htmlBody ?? '']
  for (const haystack of haystacks) {
    for (const match of haystack.matchAll(APPROVAL_LINK_PATTERN)) {
      const token = match[1]
      if (token !== undefined) return { kind: 'token', token }
    }
  }
  return { kind: 'none' }
}

/** 自由文本同意词(仅用于审计告警"该邮件像是想审批但没点链接",不产生决定)。 */
export const FREE_TEXT_CONSENT_PATTERN = /(同意|批准|approv(e|ed)|allow)/i

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
