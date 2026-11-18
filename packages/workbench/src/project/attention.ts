/**
 * Attention 卡投影(38 号 T7/A-1~A-7:站内横幅形态,interact card.ts 管线
 * **超集**——payload 构造走 packages/interact/src/card.ts buildApprovalCard,
 * 不另起管线(B7);附加面 = 单问(24 号 §2.1 行为律 3)/三动作(批准/拒绝/
 * 补充说明,24 号 §7.2 审批人行)/超时升级提示(24 号 §7.6:升级只加通知人、
 * 不撤销工单)。视觉与文案 = 原型 02(docs/prototypes/02-attention-card.html)
 * 逐字。纯函数:格式化与组装不改写 card.ts 产物(只读超集)。
 */
import { buildApprovalCard, cardToQuestionItems } from '@eterna/interact/card'
import type { ApprovalCard } from '@eterna/interact/card'
import type { AttentionCardSnapshot } from '../types.ts'

/** 升级阶段静态面单行(徽标可选;阶段阈值未拍板,M3 为数据字段)。 */
interface AttentionStageMetaEntry {
  readonly stage: AttentionCardSnapshot['stage']
  /** 阶段徽标(阶段 2/3 在 attn-top 显示;阶段 1 无徽标,仅倒计时)。 */
  readonly badge?: string
  /** 徽标语义色(临近超时 warn / 已升级 danger,语义色配文字)。 */
  readonly tone?: 'warn' | 'danger'
  /** 阶段说明(原型 02 state-card desc 逐字;横幅副行用)。 */
  readonly note: string
}

/** 常规阶段(阶段 1;未知取值的回落面)。 */
const NORMAL_STAGE: AttentionStageMetaEntry = { stage: 'normal', note: '正常倒计时；横幅常规态，不打扰提醒。' }

/** 升级阶段静态面(原型 02「超时升级三阶段」)。 */
export const ATTENTION_STAGE_META: readonly AttentionStageMetaEntry[] = [
  NORMAL_STAGE,
  { stage: 'urgent', badge: '阶段 2 · 临近超时', tone: 'warn', note: '横幅转 warn 强调态（边框加粗）；每日提醒一次，不刷屏。' },
  { stage: 'escalated', badge: '阶段 3 · 已升级', tone: 'danger', note: '已通知主管王琳（飞书 + 邮件）；卡片保留，你的答复仍有效。' },
]

/** 升级阶段静态面(按阶段取;未知阶段回落常规)。 */
export function attentionStageMeta(stage: AttentionCardSnapshot['stage'] | undefined): AttentionStageMetaEntry {
  for (const meta of ATTENTION_STAGE_META) {
    if (meta.stage === stage) return meta
  }
  return NORMAL_STAGE
}

/** 分钟数 → 倒计时文案(原型 02 逐字口径:剩余 2 小时 40 分 / 剩余 48 分钟 /
 * 已超时 12 分钟;负值 = 已超时)。 */
export function formatCountdown(remainingMinutes: number): string {
  if (remainingMinutes < 0) return `已超时 ${String(-remainingMinutes)} 分钟`
  if (remainingMinutes < 60) return `剩余 ${String(remainingMinutes)} 分钟`
  const hours = Math.floor(remainingMinutes / 60)
  const minutes = remainingMinutes % 60
  return minutes === 0 ? `剩余 ${String(hours)} 小时` : `剩余 ${String(hours)} 小时 ${String(minutes)} 分`
}

/** 分钟数 → 已等待文案(原型 02「已等待：1 小时 20 分」)。 */
export function formatWaited(waitedMinutes: number): string {
  const hours = Math.floor(waitedMinutes / 60)
  const minutes = waitedMinutes % 60
  if (hours === 0) return `${String(waitedMinutes)} 分钟`
  return minutes === 0 ? `${String(hours)} 小时` : `${String(hours)} 小时 ${String(minutes)} 分`
}

/** buildApprovalCard 的 Attention 输入面(mock 阶段由 mock-source 供给原型 02
 * 逐字字段;M4 由 EngineForPeople/interact 管线的真实审批卡供给)。 */
export interface AttentionCardInput {
  readonly ticketId: string
  readonly question: string
  readonly riskLabel: string
  readonly originator: string
  readonly channel: string
  readonly mandateNote: string
  readonly contextNote: string
  readonly waitedMinutes: number
  readonly remainingMinutes: number
  readonly stage: AttentionCardSnapshot['stage']
  readonly escalateNote: string
  readonly conversationNote: string
  /** card.ts 管线五必备字段 + R3 附加(原样透传,不另起管线)。 */
  readonly cardInput: Parameters<typeof buildApprovalCard>[0]
}

/**
 * 组装 Attention 卡快照:cardInput 经 buildApprovalCard 构造(card.ts 管线,
 * fail-closed 校验在管线内),并校验 Attention 场景取严单问——cardToQuestionItems
 * 主问存在(escalation.ts:248 同款「Attention 单问(只带主问)」,24 号 §2.1
 * 行为律 3;R3 二次确认仍为同卡第二问,不在横幅展开,批准两击确认承载)。
 */
export function buildAttentionCard(input: AttentionCardInput): AttentionCardSnapshot {
  const card: ApprovalCard = buildApprovalCard(input.cardInput)
  const mainQuestion = cardToQuestionItems(card)[0]
  if (mainQuestion === undefined) {
    throw new Error('Attention 卡渲染不出主问(cardToQuestionItems 返回空)')
  }
  return {
    ticketId: input.ticketId,
    question: input.question,
    riskLabel: input.riskLabel,
    // card.ts 管线 fail-closed 校验 grade 只允许 R2|R3(card.ts:142),此处收窄成立
    grade: card.matchedRule.grade === 'R3' ? 'R3' : 'R2',
    originator: input.originator,
    channel: input.channel,
    mandateNote: input.mandateNote,
    contextNote: input.contextNote,
    waitedMinutes: input.waitedMinutes,
    remainingMinutes: input.remainingMinutes,
    stage: input.stage,
    escalateNote: input.escalateNote,
    conversationNote: input.conversationNote,
    card,
  }
}
