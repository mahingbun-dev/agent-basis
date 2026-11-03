import type { SendMailOptions } from 'nodemailer'
import { describe, expect, it } from 'vitest'
import {
  approvalLink, buildApprovalCard, buildApprovalEmail, createEmailChannelAdapter,
  FREE_TEXT_CONSENT_PATTERN, parseEmailApproval,
  type DeliveryReceipt, type EmailRawMessage, type ImapMailSource, type SmtpTransportLike,
} from '../src/index.ts'

const BASE = 'https://gw.example.com'

/** SendMailOptions.text/html 可能是 Buffer 等非字符串形态;窄化为纯文本再断言。 */
function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  return ''
}

function approvalCardForMail() {
  return buildApprovalCard({
    approvalRequestId: 'apr-mail-9',
    channel: 'email/imap-smtp',
    title: '向客户发送报价单',
    body: '附件为最终报价,发送至 client@example.com。',
    approvalBaseUrl: BASE,
    actions: [
      { label: '批准发送', decision: 'approve', token: 'mailtok-approve-9' },
      { label: '拒绝', decision: 'reject', token: 'mailtok-reject-9' },
    ],
  })
}

class FakeImap implements ImapMailSource {
  readonly seen: string[] = []
  private queue: EmailRawMessage[]

  constructor(queue: EmailRawMessage[]) {
    this.queue = [...queue]
  }

  async fetchUnseen(): Promise<readonly EmailRawMessage[]> {
    const batch = this.queue
    this.queue = []
    return batch
  }

  async markSeen(messageId: string): Promise<void> {
    this.seen.push(messageId)
  }
}

class FakeSmtp implements SmtpTransportLike {
  readonly sent: SendMailOptions[] = []

  async sendMail(mail: SendMailOptions): Promise<{ readonly messageId?: string }> {
    this.sent.push(mail)
    return { messageId: `<smtp-${this.sent.length}@example.com>` }
  }
}

describe('邮箱适配器:审批邮件构建与防伪造解析', () => {
  it('buildApprovalEmail:html+text 双通道,每枚令牌一条单次链接', () => {
    const mail = buildApprovalEmail(approvalCardForMail(), { from: 'bot@x.com', to: 'boss@x.com', approvalBaseUrl: BASE })
    expect(mail.subject).toBe('[审批] 向客户发送报价单')
    expect(asText(mail.text)).toContain(`${BASE}/approval/mailtok-approve-9`)
    expect(asText(mail.text)).toContain(`${BASE}/approval/mailtok-reject-9`)
    expect(asText(mail.html)).toContain(`href="${approvalLink(BASE, 'mailtok-approve-9')}"`)
    expect(asText(mail.html)).toContain(`href="${approvalLink(BASE, 'mailtok-reject-9')}"`)
  })

  it('防伪造红线:正文只有"同意"字样、无令牌链接 → 不产生审批回执', () => {
    const reply: EmailRawMessage = {
      messageId: 'm1',
      from: 'boss@x.com',
      subject: 'Re: [审批] 向客户发送报价单',
      textBody: '同意,发吧。',
      receivedAt: new Date().toISOString(),
    }
    expect(parseEmailApproval(reply)).toEqual({ kind: 'none' })
    // 该邮件会被审计告警"像是想审批但没点链接",但绝不构成决定
    expect(FREE_TEXT_CONSENT_PATTERN.test(reply.textBody)).toBe(true)
  })

  it('合法回执:仅从审批链接提取一次性令牌(链接优先于正文语义)', () => {
    const reply: EmailRawMessage = {
      messageId: 'm2',
      from: 'boss@x.com',
      subject: 'Re: [审批]',
      textBody: '同意',
      htmlBody: `<p>我同意</p><a href="${BASE}/approval/mailtok-approve-9">批准发送</a>`,
      receivedAt: new Date().toISOString(),
    }
    expect(parseEmailApproval(reply)).toEqual({ kind: 'token', token: 'mailtok-approve-9' })
  })

  it('文本正文里的令牌链接同样可提取(纯文本邮件客户端)', () => {
    const reply: EmailRawMessage = {
      messageId: 'm3',
      from: 'boss@x.com',
      subject: 'Re: [审批]',
      textBody: `拒绝这条:\n${BASE}/approval/mailtok-reject-9`,
      receivedAt: new Date().toISOString(),
    }
    expect(parseEmailApproval(reply)).toEqual({ kind: 'token', token: 'mailtok-reject-9' })
  })
})

describe('邮箱适配器:IMAP 收 / SMTP 发(注入假传输,不真连)', () => {
  it('pollInbound:未读 → InboundMessage(带渠道身份),顺手标记已读', async () => {
    const imap = new FakeImap([
      {
        messageId: 'in-1',
        from: 'alice@example.com',
        subject: '会议纪要',
        textBody: '请跟进场地合同。',
        receivedAt: '2026-11-03T08:00:00.000Z',
      },
    ])
    const smtp = new FakeSmtp()
    const adapter = createEmailChannelAdapter({ imap, smtp, fromAddress: 'bot@x.com' })
    const messages = await adapter.pollInbound()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      channelType: 'email',
      channelUserId: 'alice@example.com',
      messageId: 'in-1',
      occurredAt: '2026-11-03T08:00:00.000Z',
    })
    expect(messages[0]?.text).toContain('请跟进场地合同。')
    expect(imap.seen).toEqual(['in-1'])
    // 再拉:已无未读
    expect(await adapter.pollInbound()).toEqual([])
  })

  it('smtpSend:SendMailOptions 原样到 transport(类型即 nodemailer 形态)', async () => {
    const smtp = new FakeSmtp()
    const adapter = createEmailChannelAdapter({ imap: new FakeImap([]), smtp, fromAddress: 'bot@x.com' })
    const receipt: DeliveryReceipt = await adapter.smtpSend({ to: 'a@b.com', subject: 'hi', text: 'body' })
    expect(receipt.delivered).toBe(true)
    expect(receipt.messageId).toBe('<smtp-1@example.com>')
    expect(smtp.sent[0]).toMatchObject({ to: 'a@b.com', subject: 'hi' })
  })

  it('sendCard:审批卡片经邮件出站,正文携带统一审批动作载荷链接', async () => {
    const smtp = new FakeSmtp()
    const adapter = createEmailChannelAdapter({ imap: new FakeImap([]), smtp, fromAddress: 'bot@x.com' })
    await adapter.sendCard(approvalCardForMail(), 'boss@x.com')
    expect(smtp.sent).toHaveLength(1)
    const mail = smtp.sent[0]
    expect(mail?.to).toBe('boss@x.com')
    expect(asText(mail?.text)).toContain('/approval/mailtok-approve-9')
    expect(asText(mail?.text)).toContain('/approval/mailtok-reject-9')
  })
})
