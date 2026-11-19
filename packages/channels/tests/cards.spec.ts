import { describe, expect, it } from 'vitest'
import {
  buildApprovalCard, buildReplyCard, cardApprovalPayload, ChannelsCardError, ChannelsDeliveryError,
  classifyDeliveryFailure, createDingTalkChannelAdapter, createFeishuChannelAdapter,
  createOfflineCardTransport, renderDingTalkCard, renderFeishuCard, renderReportLines,
  validateOutboundCard, type OutboundCard, type ReportState,
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

describe('Outbox reply 出站:purpose → 卡片映射(39 号 E7)', () => {
  it('attention purpose → kind=approval,走审批载荷强校验路径(载荷契约同 E4)', () => {
    const card = buildReplyCard({
      purpose: 'attention',
      title: '需要你批准',
      approval: {
        approvalRequestId: 'apr-reply-1',
        channel: 'feishu/card',
        title: '需要你批准',
        body: '将向 1200 名参会者发送确认邮件。',
        approvalBaseUrl: BASE,
        actions: [
          { label: '批准', decision: 'approve', token: 'tok-appr' },
          { label: '拒绝', decision: 'reject', token: 'tok-rej' },
        ],
      },
    })
    expect(card).toBeDefined()
    expect(card?.kind).toBe('approval')
    // 39 号 E7 验收②:attention 组卡走 validateOutboundCard 既有强校验路径
    expect(() => {
      if (card !== undefined) validateOutboundCard(card)
    }).not.toThrow()
    const payload = card !== undefined ? cardApprovalPayload(card) : undefined
    expect(payload?.approvalRequestId).toBe('apr-reply-1')
    const decisions = payload?.actions.map(action => action.decision) ?? []
    expect(decisions).toContain('approve')
    expect(decisions).toContain('reject')
  })

  it('attention 缺审批载荷输入 → 组卡即拒绝(fail-closed)', () => {
    expect(() => buildReplyCard({ purpose: 'attention', title: 't' })).toThrow(ChannelsCardError)
  })

  it('ack/answer → kind=delivery(不扩枚举),正文即 body', () => {
    for (const purpose of ['ack', 'answer'] as const) {
      const card = buildReplyCard({ purpose, title: '已收到', body: 'T-9c81 已开始处理。' })
      expect(card?.kind).toBe('delivery')
      expect(card?.body).toBe('T-9c81 已开始处理。')
      expect(card?.metadata).toBeUndefined()
    }
  })

  it('result → kind=delivery,六态进 metadata 与文案(renderReportLines 承载)', () => {
    const card = buildReplyCard({
      purpose: 'result',
      title: '工单 T-9c81 结果',
      report: { state: 'ready', summary: '发布会日程草案已就绪' },
    })
    expect(card?.kind).toBe('delivery')
    expect(card?.metadata?.reportState).toBe('ready')
    expect(card?.body).toContain('结果已就绪')
    expect(card?.body).toContain('摘要:发布会日程草案已就绪')
  })

  it('working 类中间态(progress/waiting)不产生出站卡 → undefined(进度不进 IM)', () => {
    for (const state of ['progress', 'waiting'] as const) {
      const card = buildReplyCard({
        purpose: 'result',
        title: '工单 T-9c81',
        report: { state, summary: '中间态不应出站' },
      })
      expect(card).toBeUndefined()
    }
  })
})

describe('报告六态渲染 renderReportLines(39 号 E7 验收①;枚举与 24 号 §2.3-5 逐一对应)', () => {
  it('六态逐态断言:状态行文案 + 摘要行', () => {
    const expectations: ReadonlyArray<readonly [ReportState, string]> = [
      ['progress', '进行中:工作在进行'],
      ['waiting', '等待中:worker 在等一条消息'],
      ['ready', '就绪:结果已就绪'],
      ['blocked', '受阻:需要人行动才能解锁'],
      ['failed', '失败:需要人行动才能恢复'],
      ['dropped', '已放弃:无事可做'],
    ]
    for (const [state, line] of expectations) {
      expect(renderReportLines(state, '做完了')).toBe(`${line}\n摘要:做完了`)
    }
  })

  it('摘要为空时只有状态行', () => {
    expect(renderReportLines('failed', '')).toBe('失败:需要人行动才能恢复')
  })
})

describe('投递错误分类 classifyDeliveryFailure(39 号 E7 验收③:三分支)', () => {
  it('channelIgnored / channelGone 显式标记原样归类;未标记错误一律 transient', () => {
    expect(classifyDeliveryFailure(new ChannelsDeliveryError('渠道明确拒绝', 'channelIgnored'))).toBe('channelIgnored')
    expect(classifyDeliveryFailure(new ChannelsDeliveryError('会话已不存在', 'channelGone'))).toBe('channelGone')
    expect(classifyDeliveryFailure(new Error('ECONNRESET'))).toBe('transient')
    expect(classifyDeliveryFailure('不是错误对象的值')).toBe('transient')
  })

  it('ChannelsDeliveryError 消息带 [channels] 前缀(与包内错误风格一致)', () => {
    expect(new ChannelsDeliveryError('x', 'channelGone').message).toBe('[channels] x')
  })
})
