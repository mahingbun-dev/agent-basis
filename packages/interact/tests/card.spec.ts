/** 富审批卡片 payload 构造器测试(卡片字段完整,设计文档 08 §6.2 五必备字段 + R3 附加)。 */
import { describe, expect, it } from 'vitest'
import { PARAMS_PREVIEW_LIMIT, buildApprovalCard, cardToQuestionItems } from '../src/index.ts'
import type { ApprovalCardInput } from '../src/index.ts'

const R2_INPUT: ApprovalCardInput = {
  action: { kind: 'api', name: 'vendor.pay_order', params: { orderId: 'PO-2026-001', amount: 48000 } },
  why: { source: 'sop', name: '预算变更流程', entry: '§4.2 对外付款', goldenCase: 'pay-redline-001' },
  impact: {
    files: [{ path: 'budget/2026-annual.xlsx', diffSummary: '+2/-1 机动费用行' }],
    externalSystems: [{ system: '支付网关', object: '订单 PO-2026-001 ¥48,000' }],
  },
  rollback: { reversible: false },
  matchedRule: { ruleId: 'payment-redline', grade: 'R2', reason: '对外发射需确认' },
}

const R3_INPUT: ApprovalCardInput = {
  action: { kind: 'command', name: 'bash', params: { cmd: 'vendor-cli sign --contract ct-99 --seal company' } },
  why: { source: 'skill', name: '合同签署助手' },
  impact: { externalSystems: [{ system: '电子签平台', object: '合同 ct-99(具法务效力)' }] },
  rollback: { reversible: true, inverseOf: 'contract_void', note: '签署后 24h 内可撤回' },
  matchedRule: { ruleId: 'contract-sign', grade: 'R3', reason: '法务效力动作' },
  r3: { escalateTo: ['legal-lead'], coolingPeriodSec: 300, doubleConfirm: true },
}

describe('buildApprovalCard 卡片字段完整', () => {
  it('五必备字段全部在场:将发生什么/为什么/影响面/回滚性/命中规则', () => {
    const card = buildApprovalCard(R2_INPUT)
    expect(card.whatWillHappen.name).toBe('vendor.pay_order')
    expect(card.whatWillHappen.paramsPreview).toContain('PO-2026-001')
    expect(card.whatWillHappen.summary).toContain('API vendor.pay_order')
    expect(card.why.source).toBe('sop')
    expect(card.why.summary).toContain('预算变更流程')
    expect(card.impact.files).toHaveLength(1)
    expect(card.impact.externalSystems).toHaveLength(1)
    expect(card.impact.summary).toContain('budget/2026-annual.xlsx')
    expect(card.impact.summary).toContain('支付网关')
    expect(card.rollback.statement).toContain('不可逆')
    expect(card.matchedRule.ruleId).toBe('payment-redline')
    expect(card.matchedRule.grade).toBe('R2')
  })

  it('renderedDetail 五段标题齐全,内容含命令/API+参数、SOP、diff、规则依据', () => {
    const detail = buildApprovalCard(R2_INPUT).renderedDetail
    for (const section of ['## 将发生什么', '## 为什么', '## 影响面', '## 回滚性', '## 命中规则']) {
      expect(detail).toContain(section)
    }
    expect(detail).toContain('vendor.pay_order')
    expect(detail).toContain('PO-2026-001')
    expect(detail).toContain('§4.2 对外付款')
    expect(detail).toContain('pay-redline-001')
    expect(detail).toContain('+2/-1')
    expect(detail).toContain('payment-redline')
  })

  it('回滚性:有逆闭包则明示逆操作,不可逆则明示「不可逆」', () => {
    const reversible = buildApprovalCard(R3_INPUT)
    expect(reversible.rollback.statement).toContain('可回滚')
    expect(reversible.rollback.statement).toContain('contract_void')
    const irreversible = buildApprovalCard(R2_INPUT)
    expect(irreversible.rollback.statement).toContain('不可逆')
    expect(irreversible.rollback.statement).not.toContain('可回滚')
  })

  it('超长参数折叠:超过上限截断并标记总长度', () => {
    const long = 'x'.repeat(PARAMS_PREVIEW_LIMIT + 500)
    const card = buildApprovalCard({ ...R2_INPUT, action: { kind: 'api', name: 'a', params: { blob: long } } })
    expect(card.whatWillHappen.paramsPreview.length).toBeLessThanOrEqual(PARAMS_PREVIEW_LIMIT + 100)
    expect(card.whatWillHappen.paramsPreview).toContain('超长已折叠')
    // 稳定串化 {"blob":"xxx..."} = 键包装 12 字符 + 原文
    expect(card.whatWillHappen.paramsPreview).toContain(`共 ${PARAMS_PREVIEW_LIMIT + 500 + '{"blob":""}'.length} 字符`)
  })

  it('R3 附加控制字段呈现(升级对象/冷静期/二次确认)', () => {
    const card = buildApprovalCard(R3_INPUT)
    expect(card.r3?.escalateTo).toEqual(['legal-lead'])
    expect(card.r3?.coolingPeriodSec).toBe(300)
    expect(card.r3?.doubleConfirm).toBe(true)
    expect(card.renderedDetail).toContain('## R3 附加控制')
    expect(card.renderedDetail).toContain('legal-lead')
    expect(card.renderedDetail).toContain('300 秒')
  })

  it('校验 fail-closed:R0/R1 档、空影响面、R2 卡带 r3、空 id 均拒绝', () => {
    expect(() => buildApprovalCard({ ...R2_INPUT, matchedRule: { ruleId: 'x', grade: 'R0', reason: '' } })).toThrow(/R2\|R3/)
    expect(() => buildApprovalCard({ ...R2_INPUT, impact: {} })).toThrow(/影响面/)
    expect(() => buildApprovalCard({ ...R2_INPUT, r3: { escalateTo: [], coolingPeriodSec: 0, doubleConfirm: false } })).toThrow(/R3/)
    expect(() => buildApprovalCard({ ...R2_INPUT, matchedRule: { ruleId: '', grade: 'R2', reason: '' } })).toThrow(/ruleId/)
  })
})

describe('cardToQuestionItems → 官方 user-questions 载荷', () => {
  it('R2 卡 → 1 问,intent approval 分支,选项恰覆盖 approve/reject,单选无自由文本', () => {
    const items = cardToQuestionItems(buildApprovalCard(R2_INPUT))
    expect(items).toHaveLength(1)
    const main = items[0]
    expect(main?.id).toBe('approve:payment-redline')
    expect(main?.header).toBe('R2 确认')
    expect(main?.detail).toContain('## 命中规则')
    const labels = main?.options?.map(option => option.label)
    expect(labels).toEqual(['允许执行一次', '拒绝'])
    expect(main?.multiSelect).toBeUndefined()
    expect(main?.intent?.kind).toBe('approval')
    if (main?.intent?.kind === 'approval') {
      expect(main.intent.approve).toBe('允许执行一次')
      expect(main.intent.reject).toBe('拒绝')
      expect(main.intent.subject?.name).toBe('预算变更流程')
    }
  })

  it('R3 二次确认 → 同卡 2 问(≤3 上限内),第二问为复核确认', () => {
    const items = cardToQuestionItems(buildApprovalCard(R3_INPUT))
    expect(items).toHaveLength(2)
    expect(items[0]?.header).toBe('R3 高危审批')
    expect(items[1]?.id).toBe('approve:contract-sign:confirm')
    expect(items[1]?.question).toContain('二次确认')
    expect(items.length).toBeLessThanOrEqual(3)
  })

  it('自定义按钮文案传递且 intent 与选项一致', () => {
    const items = cardToQuestionItems(buildApprovalCard(R2_INPUT), { approveLabel: '批准', rejectLabel: '否决', id: 'c1' })
    const main = items[0]
    expect(main?.options?.map(option => option.label)).toEqual(['批准', '否决'])
    if (main?.intent?.kind === 'approval') {
      expect(main.intent.approve).toBe('批准')
      expect(main.intent.reject).toBe('否决')
    }
  })
})
