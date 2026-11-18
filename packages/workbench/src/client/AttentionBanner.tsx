/**
 * Attention 卡站内横幅(38 号 T7:client/AttentionBanner.tsx;A-1~A-7,视觉 =
 * 原型二 docs/prototypes/02-attention-card.html 形态一逐字)。payload 为
 * interact card.ts 管线超集(project/attention.ts 组装,buildApprovalCard
 * 构造,不另起管线);本组件只渲染超集面:
 * - 单问(A-4,24 号 §2.1 行为律 3):一次仅驻留一张待答卡、答复前不可关闭
 *   (无关闭钮,负向断言进 attention-banner.spec.ts);
 * - 三动作(A-3,24 号 §7.2 审批人行):批准 = 主操作实心 + R3 二次确认
 *   (两击确认,frontend-style §1-4;禁用原生 confirm)/补充说明 = 次操作
 *   描边(结构化追问,答复回到原对话)/拒绝 = 破坏性低权重文字 + 两击确认
 *   + 一句理由;
 * - 超时升级提示(24 号 §7.6:升级只加通知人、不撤销工单):倒计时三阶段
 *   (常规/临近超时 warn/已升级 danger,原型二「超时升级三阶段」)。
 * 受控纯组件(无 hook):两击臂态、拒绝理由、补充说明展开态与草稿由
 * WorkbenchPage 状态壳持有。
 */
import type { ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'
import { attentionStageMeta, formatCountdown, formatWaited } from '../project/attention.ts'
import type { AttentionCardSnapshot } from '../types.ts'

export interface AttentionBannerProps {
  /** 驻留卡(快照 attention 节;undefined = 健康态不占版面,30 号 §1)。 */
  readonly card: AttentionCardSnapshot | undefined
  /** 两击确认臂态(none/approve/reject;shell 持有)。 */
  readonly arm: 'none' | 'approve' | 'reject'
  /** 第一次点击臂起;armed 期间再点同一动作 = 二次确认放行(壳判定)。 */
  readonly onArm: (target: 'approve' | 'reject') => void
  /** 二次确认放行回调(批准走 card.ts 管线 approve 语义,M4 经 EngineForPeople)。 */
  readonly onApprove: () => void
  readonly onReject: () => void
  /** 拒绝理由(一句理由,臂起 reject 时出现;A-3)。 */
  readonly rejectReason: string
  readonly onRejectReasonChange: (text: string) => void
  /** 补充说明展开态与草稿(结构化追问,答复回到原对话)。 */
  readonly supplementOpen: boolean
  readonly onSupplementToggle: () => void
  readonly supplementText: string
  readonly onSupplementChange: (text: string) => void
  readonly onSupplementSubmit: () => void
  /** 回原对话(M4 跳原对话;原型二 ghost 链接)。 */
  readonly onOpenConversation: () => void
  /** 语言键。 */
  readonly t: (key: string) => string
}

/** Attention 横幅(原型二 attn-banner:warn 左缘 3px 徽标行 + 单问 + meta +
 * 上下文 + 三动作 + 超时升级提示;健康态不占版面)。 */
export function AttentionBanner({ card, arm, onArm, onApprove, onReject, rejectReason, onRejectReasonChange, supplementOpen, onSupplementToggle, supplementText, onSupplementChange, onSupplementSubmit, onOpenConversation, t }: AttentionBannerProps): ReactElement {
  if (card === undefined) {
    // 健康态不占版面(30 号 §1/G-1):无驻留卡渲染零节点
    return <></>
  }
  const stage = attentionStageMeta(card.stage)
  const approveArmed = arm === 'approve'
  const rejectArmed = arm === 'reject'
  return (
    <section
      data-eterna-workbench="attn-banner"
      data-eterna-workbench-attention={card.ticketId}
      data-eterna-workbench-stage={card.stage}
      role="alert"
      aria-label={t('attention.bannerLabel')}
    >
      <div data-eterna-workbench="attn-top">
        <span data-eterna-workbench="badge" data-eterna-workbench-tone="warn">
          <Icon name="bell" size={14} />{t('attention.needDecision')}
        </span>
        <span data-eterna-workbench="badge" data-eterna-workbench-tone="muted" data-eterna-workbench-seg-mono="true">{card.ticketId}</span>
        <span data-eterna-workbench="badge" data-eterna-workbench-tone="danger">{card.riskLabel}</span>
        {stage.badge !== undefined && (
          <span data-eterna-workbench="badge" data-eterna-workbench-tone={stage.tone}>
            <Icon name="bell" size={14} />{stage.badge}
          </span>
        )}
        <span data-eterna-workbench="countdown" data-eterna-workbench-countdown={card.stage}>
          <Icon name="clock" size={14} />
          <span data-eterna-workbench-num="true">{formatCountdown(card.remainingMinutes)}</span>
        </span>
      </div>
      <h2 data-eterna-workbench="attn-q" id="wb-attn-q">{card.question}</h2>
      <p data-eterna-workbench="attn-meta">
        <span>{`${t('attention.originator')}${card.originator}`}</span>
        <span>{`${t('attention.channel')}${card.channel}`}</span>
        <span>{`${t('attention.waited')}${formatWaited(card.waitedMinutes)}`}</span>
        <span>{card.mandateNote}</span>
      </p>
      <p data-eterna-workbench="attn-context">{card.contextNote}</p>
      <div data-eterna-workbench="attn-actions">
        <button
          type="button"
          data-eterna-workbench="attn-btn"
          data-eterna-workbench-attention-action="approve"
          data-eterna-workbench-armed={approveArmed ? 'true' : undefined}
          onClick={() => { if (approveArmed) onApprove(); else onArm('approve') }}
        >
          <Icon name="check" size={16} />
          {approveArmed ? t('attention.approveConfirm') : card.grade === 'R3' ? t('attention.approveR3') : t('attention.approve')}
        </button>
        <button
          type="button"
          data-eterna-workbench="attn-btn-secondary"
          data-eterna-workbench-attention-action="supplement"
          data-eterna-workbench-open={supplementOpen ? 'true' : undefined}
          aria-expanded={supplementOpen}
          onClick={onSupplementToggle}
        >
          <Icon name="comment" size={16} />{t('attention.supplement')}
        </button>
        <button
          type="button"
          data-eterna-workbench="attn-btn-danger"
          data-eterna-workbench-attention-action="reject"
          data-eterna-workbench-armed={rejectArmed ? 'true' : undefined}
          onClick={() => { if (rejectArmed) onReject(); else onArm('reject') }}
        >
          <Icon name="close" size={16} />{rejectArmed ? t('attention.rejectConfirm') : t('attention.reject')}
        </button>
        <button
          type="button"
          data-eterna-workbench="attn-btn-ghost"
          data-eterna-workbench-attention-action="conversation"
          onClick={onOpenConversation}
        >
          {card.conversationNote}<Icon name="arrow-right" size={16} />
        </button>
      </div>
      {rejectArmed && (
        <div data-eterna-workbench="reject-row">
          <label data-eterna-workbench="visually-hidden" htmlFor="wb-reject-reason">{t('attention.reasonLabel')}</label>
          <input
            id="wb-reject-reason"
            type="text"
            data-eterna-workbench="reject-input"
            placeholder={t('attention.reasonPlaceholder')}
            value={rejectReason}
            onChange={event => { onRejectReasonChange(event.currentTarget.value) }}
          />
        </div>
      )}
      {supplementOpen && (
        <div data-eterna-workbench="reply-row">
          <label data-eterna-workbench="visually-hidden" htmlFor="wb-supplement-input">{t('attention.supplementLabel')}</label>
          <input
            id="wb-supplement-input"
            type="text"
            data-eterna-workbench="supplement-input"
            placeholder={t('attention.supplementPlaceholder')}
            value={supplementText}
            onChange={event => { onSupplementChange(event.currentTarget.value) }}
          />
          <button
            type="button"
            data-eterna-workbench="attn-btn"
            data-eterna-workbench-attention-action="supplement-submit"
            onClick={onSupplementSubmit}
          >
            <Icon name="check" size={16} />{t('attention.supplementSubmit')}
          </button>
        </div>
      )}
      <p data-eterna-workbench="attn-escalate"><Icon name="clock" size={16} />{card.escalateNote}</p>
    </section>
  )
}
