import { createHmac } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ApprovalTokenService, ChannelBindingStore, WebhookGateway,
  type ApprovalAnswer, type InboundDelivery, type SessionPort, type WebhookGatewayHandle,
} from '../src/index.ts'

const SECRETS = {
  feishu: { secret: 'feishu-topsecret' },
  wecom: { secret: 'wecom-topsecret' },
} as const

class RecordingSessionPort implements SessionPort {
  readonly deliveries: InboundDelivery[] = []
  readonly approvals: ApprovalAnswer[] = []

  async deliverInbound(delivery: InboundDelivery): Promise<void> {
    this.deliveries.push(delivery)
  }

  async answerApproval(answer: ApprovalAnswer): Promise<void> {
    this.approvals.push(answer)
  }
}

describe('WebhookGateway:验签 → 投递到绑定 session(真实 http server)', () => {
  let bindings: ChannelBindingStore
  let tokens: ApprovalTokenService
  let port: RecordingSessionPort
  let handle: WebhookGatewayHandle

  beforeEach(async () => {
    const db = new DatabaseSync(':memory:')
    bindings = new ChannelBindingStore(db)
    tokens = new ApprovalTokenService(db)
    port = new RecordingSessionPort()
    bindings.bind('feishu', 'fs-user-1', 'sess-web-1')
    const gateway = new WebhookGateway({ bindings, tokens, sessionPort: port, secrets: SECRETS })
    handle = await gateway.start()
  })

  afterEach(async () => {
    await handle.close()
  })

  const signFeishu = (raw: string): string =>
    'sha256=' + createHmac('sha256', SECRETS.feishu.secret).update(raw, 'utf8').digest('hex')

  const post = async (path: string, body: string, headers: Record<string, string>): Promise<Response> =>
    fetch(new URL(path, handle.url), { method: 'POST', headers, body })

  it('验签通过 → 按绑定投递到 session', async () => {
    const raw = JSON.stringify({ type: 'message', channelUserId: 'fs-user-1', text: '把发布会日程排一下' })
    const response = await post('/webhook/feishu', raw, { 'x-dsh-signature': signFeishu(raw) })
    expect(response.status).toBe(202)
    const body = JSON.parse(await response.text()) as { sessionId?: string }
    expect(body.sessionId).toBe('sess-web-1')
    expect(port.deliveries).toHaveLength(1)
    expect(port.deliveries[0]).toMatchObject({
      sessionId: 'sess-web-1',
      channelType: 'feishu',
      channelUserId: 'fs-user-1',
      text: '把发布会日程排一下',
    })
  })

  it('验签失败(错误密钥签名)→ 401 拒绝且不投递', async () => {
    const raw = JSON.stringify({ type: 'message', channelUserId: 'fs-user-1', text: 'hi' })
    const badSignature = 'sha256=' + createHmac('sha256', 'wrong-secret').update(raw, 'utf8').digest('hex')
    const response = await post('/webhook/feishu', raw, { 'x-dsh-signature': badSignature })
    expect(response.status).toBe(401)
    expect(port.deliveries).toHaveLength(0)
  })

  it('验签失败(签名后篡改 body)→ 401 拒绝', async () => {
    const signedRaw = JSON.stringify({ type: 'message', channelUserId: 'fs-user-1', text: '原文本' })
    const tampered = JSON.stringify({ type: 'message', channelUserId: 'fs-user-1', text: '篡改文本' })
    const response = await post('/webhook/feishu', tampered, { 'x-dsh-signature': signFeishu(signedRaw) })
    expect(response.status).toBe(401)
    expect(port.deliveries).toHaveLength(0)
  })

  it('缺签名头 → 401 拒绝', async () => {
    const raw = JSON.stringify({ type: 'message', channelUserId: 'fs-user-1', text: 'hi' })
    const response = await post('/webhook/feishu', raw, {})
    expect(response.status).toBe(401)
    expect(port.deliveries).toHaveLength(0)
  })

  it('未知渠道(未配置密钥)→ 404;非法 JSON → 400;GET → 405', async () => {
    const raw = 'not-json'
    expect((await post('/webhook/dingtalk', raw, { 'x-dsh-signature': 'x' })).status).toBe(404)
    const bad = 'not-json'
    expect((await post('/webhook/feishu', bad, { 'x-dsh-signature': signFeishu(bad) })).status).toBe(400)
    expect((await fetch(new URL('/webhook/feishu', handle.url))).status).toBe(405)
  })

  it('验签通过但未绑定会话 → 404 unknown-binding,不投递', async () => {
    const raw = JSON.stringify({ type: 'message', channelUserId: 'fs-stranger', text: 'hi' })
    const response = await post('/webhook/feishu', raw, { 'x-dsh-signature': signFeishu(raw) })
    expect(response.status).toBe(404)
    const body = JSON.parse(await response.text()) as { error?: string }
    expect(body.error).toBe('unknown-binding')
    expect(port.deliveries).toHaveLength(0)
  })

  it('approval_click 信封:消费一次性令牌 → 应答回传;重放 → 410', async () => {
    const grant = tokens.issue({ approvalRequestId: 'apr-web-1', sessionId: 'sess-web-1', decision: 'approve', ttlMs: 60_000 })
    const raw = JSON.stringify({ type: 'approval_click', token: grant.token })
    const first = await post('/webhook/feishu', raw, { 'x-dsh-signature': signFeishu(raw) })
    expect(first.status).toBe(202)
    expect(port.approvals).toMatchObject([
      { approvalRequestId: 'apr-web-1', sessionId: 'sess-web-1', decision: 'approve', via: 'feishu' },
    ])
    const replay = await post('/webhook/feishu', raw, { 'x-dsh-signature': signFeishu(raw) })
    expect(replay.status).toBe(410)
    expect(port.approvals).toHaveLength(1)
  })

  it('邮件审批链接 GET /approval/:token:首次 202 应答;再次 410;未知 404', async () => {
    const grant = tokens.issue({ approvalRequestId: 'apr-mail-1', sessionId: 'sess-web-1', decision: 'approve', ttlMs: 60_000 })
    const first = await fetch(new URL(`/approval/${grant.token}`, handle.url))
    expect(first.status).toBe(202)
    expect(port.approvals).toMatchObject([{ decision: 'approve', via: 'email' }])
    const replay = await fetch(new URL(`/approval/${grant.token}`, handle.url))
    expect(replay.status).toBe(410)
    const unknown = await fetch(new URL('/approval/definitely-unknown-token-value', handle.url))
    expect(unknown.status).toBe(404)
    expect(port.approvals).toHaveLength(1)
  })

  it('过期的邮件令牌 → 410 Gone', async () => {
    let now = 10_000
    const clockTokens = new ApprovalTokenService(new DatabaseSync(':memory:'), { now: () => now })
    const grant = clockTokens.issue({ approvalRequestId: 'apr-mail-2', sessionId: 'sess-web-1', decision: 'reject', ttlMs: 1_000 })
    now += 2_000
    const gateway = new WebhookGateway({ bindings, tokens: clockTokens, sessionPort: port, secrets: SECRETS })
    const mailHandle = await gateway.start()
    try {
      const response = await fetch(new URL(`/approval/${grant.token}`, mailHandle.url))
      expect(response.status).toBe(410)
      const body = JSON.parse(await response.text()) as { error?: string }
      expect(body.error).toBe('expired')
      expect(port.approvals).toHaveLength(0)
    } finally {
      await mailHandle.close()
    }
  })
})

describe('WebhookGateway:body 上限', () => {
  it('超过 maxBodyBytes → 413 拒绝', async () => {
    const db = new DatabaseSync(':memory:')
    const bindings = new ChannelBindingStore(db)
    const gateway = new WebhookGateway({
      bindings,
      tokens: new ApprovalTokenService(db),
      sessionPort: new RecordingSessionPort(),
      secrets: SECRETS,
      maxBodyBytes: 16,
    })
    const handle = await gateway.start()
    try {
      const raw = JSON.stringify({ type: 'message', channelUserId: 'x', text: 'x'.repeat(200) })
      const response = await fetch(new URL('/webhook/feishu', handle.url), {
        method: 'POST',
        headers: { 'x-dsh-signature': 'sha256=00' },
        body: raw,
      })
      expect(response.status).toBe(413)
    } finally {
      await handle.close()
    }
  })
})
