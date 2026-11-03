import { afterEach, describe, expect, it } from 'vitest'
import {
  buildApprovalCard, createChannelsService, createEmailChannelAdapter, createFeishuChannelAdapter,
  createOfflineCardTransport, type ApprovalAnswer, type InboundDelivery, type SessionPort,
  type WebhookGatewayHandle,
} from '../src/index.ts'

class RecordingPort implements SessionPort {
  readonly deliveries: InboundDelivery[] = []
  readonly approvals: ApprovalAnswer[] = []

  async deliverInbound(delivery: InboundDelivery): Promise<void> {
    this.deliveries.push(delivery)
  }

  async answerApproval(answer: ApprovalAnswer): Promise<void> {
    this.approvals.push(answer)
  }
}

describe('createChannelsService:组合根端到端(唯一 ID 服务形态)', () => {
  const handles: WebhookGatewayHandle[] = []
  const closers: Array<() => void> = []

  afterEach(async () => {
    await Promise.all(handles.splice(0).map(handle => handle.close()))
    for (const close of closers.splice(0)) close()
  })

  it('绑定收敛 + 一次性令牌 + 网关审批路由 + 出站卡片全链路', async () => {
    const feishuTransport = createOfflineCardTransport()
    const service = createChannelsService({
      adapters: [createFeishuChannelAdapter({ transport: feishuTransport })],
    })
    closers.push((): void => {
      service.close()
    })
    expect(service.id).toBe('@basis/channels')
    expect(service.adapters.get('feishu/card')?.channelType).toBe('feishu')

    // 三渠道收敛同一会话(12 号 §7.8)
    service.bindings.bind('feishu', 'fs-a', 'sess-main')
    service.bindings.bind('email', 'boss@x.com', 'sess-main')
    service.bindings.bind('wechat', 'wx-a', 'sess-main')
    expect(service.bindings.sessionBindings('sess-main')).toHaveLength(3)

    // 审批:双令牌签发 → 审批卡片出站(统一载荷)→ 飞书回调点击 → 应答回传
    const port = new RecordingPort()
    const handle = await service.startWebhookGateway({
      sessionPort: port,
      secrets: { feishu: { secret: 'e2e-secret' } },
    })
    handles.push(handle)

    const pair = service.tokens.issuePair({ approvalRequestId: 'apr-e2e', sessionId: 'sess-main' })
    const card = buildApprovalCard({
      approvalRequestId: 'apr-e2e',
      channel: 'feishu/card',
      title: '端到端审批',
      body: '全链路验证',
      approvalBaseUrl: handle.url.toString().replace(/\/$/, ''),
      actions: [
        { label: '批准', decision: 'approve', token: pair.approve.token },
        { label: '拒绝', decision: 'reject', token: pair.reject.token },
      ],
    })
    await service.adapters.get('feishu/card')?.sendCard(card, 'fs-a')
    expect(feishuTransport.sent).toHaveLength(1)

    const approve = await fetch(new URL(`/approval/${pair.approve.token}`, handle.url))
    expect(approve.status).toBe(202)
    expect(port.approvals).toMatchObject([{ approvalRequestId: 'apr-e2e', decision: 'approve', via: 'email' }])
    // 单次有效:同一令牌重放 → 410,不再产生第二条应答
    const replay = await fetch(new URL(`/approval/${pair.approve.token}`, handle.url))
    expect(replay.status).toBe(410)
    expect(port.approvals).toHaveLength(1)
  })

  it('适配器注册表:同实例幂等、不同实例抢同 ID 拒绝', () => {
    const service = createChannelsService({})
    closers.push((): void => {
      service.close()
    })
    const email = createEmailChannelAdapter({
      imap: { fetchUnseen: () => Promise.resolve([]), markSeen: () => Promise.resolve() },
      smtp: { sendMail: () => Promise.resolve({}) },
      fromAddress: 'bot@x.com',
    })
    service.adapters.register(email)
    expect(service.adapters.list().map(entry => entry.id)).toEqual(['email/imap-smtp'])
    expect(() => {
      service.adapters.register(email)
    }).not.toThrow()
    const imposter = { ...email, sendCard: email.sendCard.bind(email) }
    expect(() => {
      service.adapters.register(imposter)
    }).toThrow(/适配器 ID 冲突/)
    expect(service.adapters.get('email/imap-smtp')).toBe(email)
  })
})
