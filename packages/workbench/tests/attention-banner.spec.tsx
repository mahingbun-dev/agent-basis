/**
 * Attention 站内横幅验收(38 号 T7 门禁【预定名】:超集字段/单问断言;视觉
 * 对照 = 原型二 docs/prototypes/02-attention-card.html 形态一 + 超时升级
 * 三阶段逐字)。payload 断言钉 interact card.ts 管线超集(A-1:buildApprovalCard
 * 构造,不另起管线);单问断言钉 24 号 §2.1 行为律 3(A-4)。渲染测试仿
 * packages/panel 现有模式:受控纯组件直调 + 元素树断言(render-tree.tsx)。
 */
import { describe, expect, it } from 'vitest'
import { cardToQuestionItems } from '@eterna/interact/card'
import { AttentionBanner } from '../src/client/AttentionBanner.tsx'
import { attentionStageMeta, formatCountdown, formatWaited } from '../src/project/attention.ts'
import { initialMockSnapshot } from '../src/stream/mock-source.ts'
import { zh } from '../src/client/locales.ts'
import { byAttr, find1, rawText, render, textOf } from './render-tree.tsx'

const t = (key: string): string => zh[key as keyof typeof zh] ?? key
const card = initialMockSnapshot().attention!
const banner = render(
  <AttentionBanner
    card={card}
    arm="none"
    onArm={() => {}}
    onApprove={() => {}}
    onReject={() => {}}
    rejectReason=""
    onRejectReasonChange={() => {}}
    supplementOpen={false}
    onSupplementToggle={() => {}}
    supplementText=""
    onSupplementChange={() => {}}
    onSupplementSubmit={() => {}}
    onOpenConversation={() => {}}
    t={t}
  />,
)

/** 阶段夹具(原型二「超时升级三阶段」数值:常规 160 分 / 临近 48 分 / 已超时 12 分)。 */
function bannerAtStage(stage: 'normal' | 'urgent' | 'escalated'): ReturnType<typeof render> {
  return render(
    <AttentionBanner
      card={{ ...card, stage, remainingMinutes: stage === 'escalated' ? -12 : stage === 'urgent' ? 48 : 160 }}
      arm="none"
      onArm={() => {}}
      onApprove={() => {}}
      onReject={() => {}}
      rejectReason=""
      onRejectReasonChange={() => {}}
      supplementOpen={false}
      onSupplementToggle={() => {}}
      supplementText=""
      onSupplementChange={() => {}}
      onSupplementSubmit={() => {}}
      onOpenConversation={() => {}}
      t={t}
    />,
  )
}

describe('A-1 card.ts 管线超集(24 号 §5.2;B7 不另起渲染管线)', () => {
  it('payload 经 buildApprovalCard 构造:五必备字段齐全(将发生什么/为什么/影响面/回滚性/命中规则)', () => {
    expect(card.card.whatWillHappen.summary).toContain('API vendor.pay_order')
    expect(card.card.why.summary).toContain('SOP 条目:付款审批(预付款)')
    expect(card.card.impact.externalSystems).toHaveLength(1)
    expect(card.card.impact.externalSystems[0]).toEqual({ system: '支付网关', object: '供应商 QY-2201 · 预付款 ¥48,000（单据 BJ-0971）' })
    expect(card.card.impact.summary).toBe('外部系统 支付网关:供应商 QY-2201 · 预付款 ¥48,000（单据 BJ-0971）')
    expect(card.card.rollback.statement).toContain('不可逆')
    expect(card.card.matchedRule).toEqual({ ruleId: 'pay.prepay', grade: 'R3', reason: '资金红线：单笔预付款 > ¥20,000（hitl.yaml pay.prepay）' })
    // 渲染好的卡片正文(renderedDetail)分段齐全
    expect(card.card.renderedDetail).toContain('## 将发生什么')
    expect(card.card.renderedDetail).toContain('## 命中规则')
    expect(card.card.renderedDetail).toContain('## R3 附加控制')
  })

  it('R3 附加控制(escalateTo/冷静期/二次确认)原样保留(24 号 §7.2 审批人行)', () => {
    expect(card.card.r3).toEqual({ escalateTo: ['王琳'], coolingPeriodSec: 600, doubleConfirm: true })
    expect(card.card.renderedDetail).toContain('- 升级给:王琳')
    expect(card.card.renderedDetail).toContain('- 冷静期:600 秒')
    expect(card.card.renderedDetail).toContain('- 二次确认:需要')
  })

  it('管线主问仍在(官方 user-questions 载荷可渲染;M4 应答路由走 cardToQuestionItems)', () => {
    const items = cardToQuestionItems(card.card)
    expect(items[0]!.intent?.kind).toBe('approval')
    expect(items[0]!.question).toContain('是否允许执行 vendor.pay_order?')
    // R3 doubleConfirm 同卡第二问仍在管线内(card.ts:220-227)
    expect(items).toHaveLength(2)
  })
})

describe('A-4 单问(24 号 §2.1 行为律 3「一次只问一个具体的结构化问题」)', () => {
  it('横幅渲染恰好一个主问(attn-q 唯一,原型二逐字)', () => {
    const questions = byAttr(banner, 'data-eterna-workbench', 'attn-q')
    expect(questions).toHaveLength(1)
    expect(textOf(questions[0]!)).toBe('向供应商 QY-2201 支付预付款 ¥48,000，是否批准？')
  })

  it('不一次抛多个问题:横幅面不出现管线第二问(二次确认问题),R3 双确认走两击确认', () => {
    expect(rawText(banner)).not.toContain('二次确认:已知悉影响面与回滚性')
    expect(find1(banner, 'data-eterna-workbench-attention-action', 'approve').attrs['data-eterna-workbench-armed']).toBeUndefined()
  })

  it('一次仅驻留一张待答卡:快照 attention 为单卡(无卡数组),健康态零节点', () => {
    expect(initialMockSnapshot().attention?.ticketId).toBe('T-a21f')
    const none = render(
      <AttentionBanner
        card={undefined}
        arm="none"
        onArm={() => {}}
        onApprove={() => {}}
        onReject={() => {}}
        rejectReason=""
        onRejectReasonChange={() => {}}
        supplementOpen={false}
        onSupplementToggle={() => {}}
        supplementText=""
        onSupplementChange={() => {}}
        onSupplementSubmit={() => {}}
        onOpenConversation={() => {}}
        t={t}
      />,
    )
    expect(rawText(none)).toBe('')
    expect(byAttr(none, 'data-eterna-workbench', 'attn-banner')).toHaveLength(0)
  })

  it('答复前不可关闭:横幅无关闭/消卡入口(负向断言)', () => {
    expect(rawText(banner)).not.toContain('关闭')
    expect(rawText(banner)).not.toContain('消卡')
    expect(byAttr(banner, 'data-eterna-workbench-attention-action', 'close')).toHaveLength(0)
    expect(byAttr(banner, 'data-eterna-workbench-attention-action', 'dismiss')).toHaveLength(0)
  })
})

describe('横幅渲染(原型二形态一逐字)', () => {
  it('徽标行:需要你拍板(warn)+ 工单号(mono)+ 资金红线 R3(danger)+ 倒计时(剩余 2 小时 40 分)', () => {
    const badges = byAttr(banner, 'data-eterna-workbench', 'badge')
    expect(textOf(badges[0]!)).toBe('需要你拍板')
    expect(textOf(badges[1]!)).toBe('T-a21f')
    expect(badges[1]!.attrs['data-eterna-workbench-seg-mono']).toBe('true')
    expect(textOf(badges[2]!)).toBe('资金红线 R3')
    expect(badges[2]!.attrs['data-eterna-workbench-tone']).toBe('danger')
    const countdown = find1(banner, 'data-eterna-workbench', 'countdown')
    expect(textOf(countdown)).toBe('剩余 2 小时 40 分')
    expect(countdown.attrs['data-eterna-workbench-countdown']).toBe('normal')
  })

  it('meta 行:发起人/渠道/已等待/Mandate 逐字;上下文行逐字', () => {
    expect(textOf(find1(banner, 'data-eterna-workbench', 'attn-meta'))).toBe(
      '发起人：陈默 渠道：飞书群「采购三部」 已等待：1 小时 20 分 Mandate：v3 · L2 委派',
    )
    expect(textOf(find1(banner, 'data-eterna-workbench', 'attn-context'))).toBe(
      '预算校验通过（单据 BJ-0971）；命中 hitl.yaml 红线 pay.prepay > 20000；R3 冷静期 10 分钟已过半。',
    )
  })

  it('三动作 + 回原对话(批准=实心主操作/补充说明=描边/拒绝=破坏性低权重文字)', () => {
    const approve = find1(banner, 'data-eterna-workbench-attention-action', 'approve')
    expect(textOf(approve)).toBe('批准（R3 需二次确认）')
    const supplement = find1(banner, 'data-eterna-workbench-attention-action', 'supplement')
    expect(textOf(supplement)).toBe('补充说明')
    expect(supplement.attrs['aria-expanded']).toBe('false')
    const reject = find1(banner, 'data-eterna-workbench-attention-action', 'reject')
    expect(textOf(reject)).toBe('拒绝（需一句理由）')
    const conversation = find1(banner, 'data-eterna-workbench-attention-action', 'conversation')
    expect(textOf(conversation)).toBe('回原对话')
    // 未展开态无输入行
    expect(byAttr(banner, 'data-eterna-workbench', 'supplement-input')).toHaveLength(0)
    expect(byAttr(banner, 'data-eterna-workbench', 'reject-row')).toHaveLength(0)
  })

  it('超时升级提示(attn-escalate 逐字;升级不撤销工单,24 号 §7.6)', () => {
    expect(textOf(find1(banner, 'data-eterna-workbench', 'attn-escalate'))).toBe(
      '超时升级：4 小时未答复将通知主管王琳（飞书 + 邮件）；升级不撤销工单，你的答复仍有效。',
    )
  })
})

describe('A-3 三动作交互态(两击确认,frontend-style §1-4;禁用原生 confirm)', () => {
  it('批准臂态:armed → 文案转「再次点击确认批准」+ 臂环标记(第二击由壳放行)', () => {
    const armed = render(
      <AttentionBanner
        card={card}
        arm="approve"
        onArm={() => {}}
        onApprove={() => {}}
        onReject={() => {}}
        rejectReason=""
        onRejectReasonChange={() => {}}
        supplementOpen={false}
        onSupplementToggle={() => {}}
        supplementText=""
        onSupplementChange={() => {}}
        onSupplementSubmit={() => {}}
        onOpenConversation={() => {}}
        t={t}
      />,
    )
    const approve = find1(armed, 'data-eterna-workbench-attention-action', 'approve')
    expect(textOf(approve)).toBe('再次点击确认批准')
    expect(approve.attrs['data-eterna-workbench-armed']).toBe('true')
    expect(rawText(armed)).not.toContain('confirm(')
  })

  it('拒绝臂态:armed → 文案转「确认拒绝」+ 一句理由输入出现(必填)', () => {
    const armed = render(
      <AttentionBanner
        card={card}
        arm="reject"
        onArm={() => {}}
        onApprove={() => {}}
        onReject={() => {}}
        rejectReason=""
        onRejectReasonChange={() => {}}
        supplementOpen={false}
        onSupplementToggle={() => {}}
        supplementText=""
        onSupplementChange={() => {}}
        onSupplementSubmit={() => {}}
        onOpenConversation={() => {}}
        t={t}
      />,
    )
    const reject = find1(armed, 'data-eterna-workbench-attention-action', 'reject')
    expect(textOf(reject)).toBe('确认拒绝')
    expect(reject.attrs['data-eterna-workbench-armed']).toBe('true')
    const input = find1(armed, 'data-eterna-workbench', 'reject-input')
    expect(input.attrs['placeholder']).toBe('一句话理由（必填）')
  })

  it('补充说明展开态:输入(结构化追问,答复回到原对话)+ 提交说明', () => {
    const open = render(
      <AttentionBanner
        card={card}
        arm="none"
        onArm={() => {}}
        onApprove={() => {}}
        onReject={() => {}}
        rejectReason=""
        onRejectReasonChange={() => {}}
        supplementOpen
        onSupplementToggle={() => {}}
        supplementText="B 供应商换算后再比一次"
        onSupplementChange={() => {}}
        onSupplementSubmit={() => {}}
        onOpenConversation={() => {}}
        t={t}
      />,
    )
    const supplement = find1(open, 'data-eterna-workbench-attention-action', 'supplement')
    expect(supplement.attrs['aria-expanded']).toBe('true')
    expect(find1(open, 'data-eterna-workbench', 'supplement-input').attrs['placeholder']).toBe('结构化追问，答复回到原对话')
    expect(textOf(find1(open, 'data-eterna-workbench-attention-action', 'supplement-submit'))).toBe('提交说明')
  })
})

describe('超时升级三阶段(原型二「超时升级三阶段」;升级只加通知人、不撤销工单)', () => {
  it('阶段 1 常规:倒计时 warn 常规态,无阶段徽标', () => {
    const normal = bannerAtStage('normal')
    expect(find1(normal, 'data-eterna-workbench', 'countdown').attrs['data-eterna-workbench-countdown']).toBe('normal')
    expect(byAttr(normal, 'data-eterna-workbench', 'badge').map(textOf)).not.toContain('阶段 2 · 临近超时')
    expect(byAttr(normal, 'data-eterna-workbench', 'badge').map(textOf)).not.toContain('阶段 3 · 已升级')
    expect(attentionStageMeta('normal').badge).toBeUndefined()
  })

  it('阶段 2 临近超时:countdown urgent(warn 实底)+ warn 徽标「阶段 2 · 临近超时」', () => {
    const urgent = bannerAtStage('urgent')
    const countdown = find1(urgent, 'data-eterna-workbench', 'countdown')
    expect(countdown.attrs['data-eterna-workbench-countdown']).toBe('urgent')
    expect(textOf(countdown)).toBe('剩余 48 分钟')
    expect(find1(urgent, 'data-eterna-workbench', 'attn-banner').attrs['data-eterna-workbench-stage']).toBe('urgent')
    expect(byAttr(urgent, 'data-eterna-workbench', 'badge').map(textOf)).toContain('阶段 2 · 临近超时')
    expect(attentionStageMeta('urgent').tone).toBe('warn')
  })

  it('阶段 3 已升级:countdown escalated(danger 实底「已超时 12 分钟」)+ danger 徽标', () => {
    const escalated = bannerAtStage('escalated')
    const countdown = find1(escalated, 'data-eterna-workbench', 'countdown')
    expect(countdown.attrs['data-eterna-workbench-countdown']).toBe('escalated')
    expect(textOf(countdown)).toBe('已超时 12 分钟')
    expect(byAttr(escalated, 'data-eterna-workbench', 'badge').map(textOf)).toContain('阶段 3 · 已升级')
    expect(find1(escalated, 'data-eterna-workbench', 'attn-banner').attrs['data-eterna-workbench-stage']).toBe('escalated')
    expect(attentionStageMeta('escalated').tone).toBe('danger')
    // 升级不撤销工单:卡片保留可答复(三动作仍在)
    expect(byAttr(escalated, 'data-eterna-workbench-attention-action', 'approve')).toHaveLength(1)
    expect(textOf(escalated)).toContain('升级不撤销工单，你的答复仍有效')
  })

  it('倒计时/等待格式化(分钟数 → 原型二文案)', () => {
    expect(formatCountdown(160)).toBe('剩余 2 小时 40 分')
    expect(formatCountdown(48)).toBe('剩余 48 分钟')
    expect(formatCountdown(-12)).toBe('已超时 12 分钟')
    expect(formatCountdown(120)).toBe('剩余 2 小时')
    expect(formatWaited(80)).toBe('1 小时 20 分')
    expect(formatWaited(60)).toBe('1 小时')
    expect(formatWaited(6)).toBe('6 分钟')
  })
})
