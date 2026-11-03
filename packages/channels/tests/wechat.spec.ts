import { describe, expect, it } from 'vitest'
import {
  buildApprovalCard, createDefaultWeChatRegistry, createTencentOfficialAdapter,
  createWeChatAdapterRegistry, createWeChatCsAdapter, createWeComSmartBotAdapter, renderWeChatText,
  type TencentOfficialTransport, type WeChatCsTransport, type WeComSmartBotTransport,
} from '../src/index.ts'

const BASE = 'https://gw.example.com'

class FakeTencentTransport implements TencentOfficialTransport {
  readonly texts: { to: string; text: string }[] = []

  async sendText(toUser: string, text: string): Promise<void> {
    this.texts.push({ to: toUser, text })
  }

  async sendMedia(toUser: string, mediaId: string): Promise<void> {
    this.texts.push({ to: toUser, text: `[media:${mediaId}]` })
  }

  async qrLogin(): Promise<{ readonly qrUrl: string; readonly accountExternalId: string }> {
    return { qrUrl: 'https://login.example/qr/abc', accountExternalId: 'wx-official-42' }
  }
}

class FakeWeComTransport implements WeComSmartBotTransport {
  readonly verifyCalls: { raw: string; sig: string }[] = []

  async sendText(_toUser: string, _text: string): Promise<void> {}

  async verifyCallback(rawBody: Buffer, msgSignature: string, _timestamp: string, _nonce: string): Promise<boolean> {
    this.verifyCalls.push({ raw: rawBody.toString('utf8'), sig: msgSignature })
    return msgSignature === 'good-sig'
  }
}

class FakeCsTransport implements WeChatCsTransport {
  async sendText(_toUser: string, _text: string): Promise<void> {}

  async syncMessages(cursor?: string): Promise<{
    readonly messages: readonly { readonly fromUser: string; readonly text: string; readonly msgId: string }[]
    readonly nextCursor?: string
  }> {
    return {
      messages: [{ fromUser: 'wx_cs_customer_1', text: '你好,咨询一下档期', msgId: 'cs-1' }],
      ...(cursor === undefined && { nextCursor: 'cursor-2' }),
    }
  }
}

function approvalCard(channel: string) {
  return buildApprovalCard({
    approvalRequestId: 'apr-wx-1',
    channel,
    title: '确认供应商合同',
    body: '金额 ¥48,000,见附件。',
    approvalBaseUrl: BASE,
    actions: [
      { label: '批准', decision: 'approve', token: 'wxtok-a' },
      { label: '拒绝', decision: 'reject', token: 'wxtok-r' },
    ],
  })
}

describe('微信三路径适配器接口(12 号 §7.6)', () => {
  it('① 腾讯官方插件:QR 登录 + 私信文本;能力矩阵标个人实验', async () => {
    const transport = new FakeTencentTransport()
    const adapter = createTencentOfficialAdapter({ transport, approvalBaseUrl: BASE })
    expect(adapter.id).toBe('wechat/tencent-official')
    expect(adapter.channelType).toBe('wechat')
    expect(adapter.capabilities).toMatchObject({ login: 'qr', media: true, freeContact: false, compliance: 'personal-experimental' })
    const login = await adapter.login()
    expect(login.accountExternalId).toBe('wx-official-42')
    await adapter.sendCard(approvalCard('wechat/tencent-official'), 'wx-official-42')
    expect(transport.texts).toHaveLength(1)
    const text = transport.texts[0]?.text ?? ''
    expect(text).toContain('确认供应商合同')
    expect(text).toContain(`${BASE}/approval/wxtok-a`)
    expect(text).toContain(`${BASE}/approval/wxtok-r`)
  })

  it('② 企微智能机器人:回调验签委托 transport(API 模式)', async () => {
    const transport = new FakeWeComTransport()
    const adapter = createWeComSmartBotAdapter({ transport, approvalBaseUrl: BASE })
    expect(adapter.path).toBe('wechat/wecom-smart-bot')
    expect(adapter.capabilities.compliance).toBe('official')
    expect(await adapter.verifyCallback(Buffer.from('{}'), 'good-sig', '1', 'n')).toBe(true)
    expect(await adapter.verifyCallback(Buffer.from('{}'), 'bad-sig', '1', 'n')).toBe(false)
    expect(transport.verifyCalls).toHaveLength(2)
  })

  it('③ 微信客服:免加好友 + 消息同步透传', async () => {
    const transport = new FakeCsTransport()
    const adapter = createWeChatCsAdapter({ transport, approvalBaseUrl: BASE })
    expect(adapter.path).toBe('wechat/wechat-cs')
    expect(adapter.capabilities.freeContact).toBe(true)
    expect(adapter.capabilities.compliance).toBe('official-production')
    const batch = await adapter.syncMessages()
    expect(batch.messages[0]?.fromUser).toBe('wx_cs_customer_1')
    expect(batch.nextCursor).toBe('cursor-2')
  })

  it('renderWeChatText:非审批卡片无审批链接段', () => {
    const text = renderWeChatText({ kind: 'progress', title: '进度', body: '3/5 完成' }, { approvalBaseUrl: BASE })
    expect(text).not.toContain('/approval/')
  })
})

describe('微信路径注册表(唯一 ID,provide 可交换)', () => {
  it('默认注册表只收三条官方/半官方路径', () => {
    const registry = createDefaultWeChatRegistry({
      tencentOfficial: { transport: new FakeTencentTransport() },
      wecomSmartBot: { transport: new FakeWeComTransport() },
      wechatCs: { transport: new FakeCsTransport() },
    })
    expect([...registry.knownPaths()].sort()).toEqual([
      'wechat/tencent-official', 'wechat/wechat-cs', 'wechat/wecom-smart-bot',
    ])
    const adapter = registry.create('wechat/wechat-cs', { approvalBaseUrl: BASE })
    expect(adapter.id).toBe('wechat/wechat-cs')
  })

  it('空注册表 create 未知路径 → 拒绝', () => {
    const registry = createWeChatAdapterRegistry()
    expect(() => registry.create('wechat/tencent-official', { approvalBaseUrl: BASE })).toThrow(/未知微信路径/)
  })

  it('未提供 transport 的路径不入默认注册表', () => {
    const registry = createDefaultWeChatRegistry({})
    expect(registry.knownPaths()).toEqual([])
  })
})
