import { describe, expect, it } from 'vitest'
import {
  buildApprovalCard, cardApprovalPayload, ChannelsCardError, createDingTalkChannelAdapter,
  createFeishuChannelAdapter, createOfflineCardTransport, renderDingTalkCard, renderFeishuCard,
  validateOutboundCard, type OutboundCard,
} from '../src/index.ts'

const BASE = 'https://gw.example.com'

function approvalCard(): OutboundCard {
  return buildApprovalCard({
    approvalRequestId: 'apr-card-1',
    channel: 'feishu/card',
    title: '发布活动通知邮件',
    body: '将向 1200 名参会者发送确认邮件,内容见附件 diff。',
    approvalBaseUrl: BASE,
    actions: [
      { label: '批准', decision: 'approve', token: 'tok-approve-1' },
      { label: '拒绝', decision: 'reject', token: 'tok-reject-1' },
    ],
  })
}

describe('出站卡片:统一携带审批按钮动作载荷', () => {
  it('buildApprovalCard 装配完整载荷(approve+reject、URL、请求 ID)', () => {
    const card = approvalCard()
    expect(card.kind).toBe('approval')
    const payload = cardApprovalPayload(card)
    expect(payload?.approvalRequestId).toBe('apr-card-1')
    expect(payload?.channel).toBe('feishu/card')
    const decisions = payload?.actions.map(action => action.decision)
    expect(decisions).toContain('approve')
    expect(decisions).toContain('reject')
    const approve = payload?.actions.find(action => action.decision === 'approve')
    expect(approve?.url).toBe(`${BASE}/approval/tok-approve-1`)
  })

  it('缺 reject 动作 / 令牌重复 / 空请求 ID → 构建 即拒绝', () => {
    expect(() => buildApprovalCard({
      approvalRequestId: 'apr-x', channel: 'c', title: 't', body: 'b',
      actions: [{ label: '批准', decision: 'approve', token: 'tok' }],
    })).toThrow(ChannelsCardError)
    expect(() => buildApprovalCard({
      approvalRequestId: 'apr-x', channel: 'c', title: 't', body: 'b',
      actions: [
        { label: '批准', decision: 'approve', token: 'same' },
        { label: '拒绝', decision: 'reject', token: 'same' },
      ],
    })).toThrow(ChannelsCardError)
    expect(() => buildApprovalCard({
      approvalRequestId: '', channel: 'c', title: 't', body: 'b',
      actions: [
        { label: '批准', decision: 'approve', token: 'a' },
        { label: '拒绝', decision: 'reject', token: 'b' },
      ],
    })).toThrow(ChannelsCardError)
  })

  it('validateOutboundCard:审批卡片缺载荷 → 拒绝;进度卡片无需载荷', () => {
    const broken: OutboundCard = { kind: 'approval', title: 't', body: 'b' }
    expect(() => {
      validateOutboundCard(broken)
    }).toThrow(ChannelsCardError)
    const progress: OutboundCard = { kind: 'progress', title: '进度', body: '已完成 3/5' }
    expect(() => {
      validateOutboundCard(progress)
    }).not.toThrow()
    expect(cardApprovalPayload(progress)).toBeUndefined()
  })
})

describe('飞书卡片渲染', () => {
  it('审批按钮 value 内嵌统一动作载荷(approve=primary / reject=danger)', () => {
    const payload = renderFeishuCard(approvalCard())
    expect(payload.msg_type).toBe('interactive')
    const actionElement = payload.card.elements.find(element => 'actions' in element)
    expect(actionElement).toBeDefined()
    const buttons = actionElement?.actions ?? []
    expect(buttons).toHaveLength(2)
    const approveButton = buttons.find(button => button.value.dshAction === 'approve')
    const rejectButton = buttons.find(button => button.value.dshAction === 'reject')
    expect(approveButton?.type).toBe('primary')
    expect(rejectButton?.type).toBe('danger')
    const embedded = approveButton?.value.dshApproval
    expect(embedded).toBeDefined()
    expect(embedded?.approvalRequestId).toBe('apr-card-1')
    expect(embedded?.actions.map(action => action.token).sort()).toEqual(['tok-approve-1', 'tok-reject-1'])
  })

  it('审批卡片缺载荷 → 渲染 即拒绝', () => {
    expect(() => renderFeishuCard({ kind: 'approval', title: 't', body: 'b' })).toThrow(ChannelsCardError)
  })

  it('发送接口:feishu 适配器经注入传输层出站,载荷保真', async () => {
    const transport = createOfflineCardTransport()
    const adapter = createFeishuChannelAdapter({ transport })
    const receipt = await adapter.sendCard(approvalCard(), 'fs-user-1')
    expect(receipt.delivered).toBe(true)
    expect(transport.sent).toHaveLength(1)
    expect(transport.sent[0]?.recipient).toBe('fs-user-1')
    const payload = transport.sent[0]?.payload as ReturnType<typeof renderFeishuCard>
    expect(payload.card.header.title.content).toBe('发布活动通知邮件')
  })
})

describe('钉钉卡片渲染', () => {
  it('审批按钮为 actionURL,指向一次性令牌网关', () => {
    const payload = renderDingTalkCard(approvalCard(), { approvalBaseUrl: BASE })
    expect(payload.msgtype).toBe('actionCard')
    expect(payload.actionCard.btns.map(btn => btn.actionURL).sort()).toEqual([
      `${BASE}/approval/tok-approve-1`,
      `${BASE}/approval/tok-reject-1`,
    ])
    expect(payload.actionCard.text).toContain('发布活动通知邮件')
  })

  it('发送接口:dingtalk 适配器出站', async () => {
    const transport = createOfflineCardTransport()
    const adapter = createDingTalkChannelAdapter({ transport, approvalBaseUrl: BASE })
    await adapter.sendCard(approvalCard(), 'dt-user-2')
    const payload = transport.sent[0]?.payload as ReturnType<typeof renderDingTalkCard>
    expect(payload.actionCard.btns).toHaveLength(2)
  })

  it('approvalBaseUrl 为空 → 渲染拒绝(钉钉按钮必须有真实回调地址)', () => {
    const card = buildApprovalCard({
      approvalRequestId: 'apr-no-url', channel: 'dingtalk/card', title: 't', body: 'b',
      actions: [
        { label: '批准', decision: 'approve', token: 'a1' },
        { label: '拒绝', decision: 'reject', token: 'r1' },
      ],
    })
    expect(() => renderDingTalkCard(card, { approvalBaseUrl: '' })).toThrow(ChannelsCardError)
  })
})
