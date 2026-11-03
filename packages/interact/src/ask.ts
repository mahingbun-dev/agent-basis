/**
 * 提问合并包装器(设计文档 08 §6.3「合并提问」、12 §3.3:
 * 「一次 turn 内多个 ask_user_question 合并为一张多问题卡片(上限 3 问),禁止挤牙膏式逐个问」)。
 *
 * 两层:
 * - 纯函数 `mergeQuestionDrafts()`:同一 turn 收到的多批问题草稿 → 最少张数的卡,
 *   每张 ≤ maxPerCard(默认 3)问,顺序保持;同 turn 内重复 id 去重(保留首个,后续丢弃并记录)——
 *   DSH 要求一次调用内 id 唯一(answer 按 id 回路由),重复即「挤牙膏式重问」;
 * - 状态包装器 `TurnQuestionMerger`:按 turn 归并缓冲,turn 切换自动 flush 上一 turn;
 *   产出即 `ask_user_question` 工具调用参数形态({ questions: [...] },官方 AskUserQuestionItem),
 *   并累计合并率统计(questionsIn/cardsOut/interruptionsSaved,供 observe 的「question 合并率」指标消费,
 *   设计文档 08 §6.4)。
 *
 * 草稿校验 fail-closed:id/question 非空、选项 label 非空;非法载荷抛 InteractConfigError
 * (模型产出的坏问题应显式失败,而不是静默改写)。
 */
import { InteractConfigError, isRecord } from './errors.ts'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'

/** 单卡问题上限(设计文档 08 §6.3:上限 3 问)。 */
export const MAX_QUESTIONS_PER_CARD = 3

/** 提问草稿:AskUserQuestionItem 的输入子集(id/question 必填,其余可选)。 */
export type QuestionDraft = AskUserQuestionItem

/** 一张合并卡:即 ask_user_question 工具调用的 questions 载荷(≤ maxPerCard 问)。 */
export type MergedCard = AskUserQuestionItem[]

/** 纯函数合并结果。 */
export interface MergeResult {
  /** 合并后的卡(每张 ≤ maxPerCard 问,按提交顺序)。 */
  readonly cards: readonly MergedCard[]
  /** 同 turn 内被去重丢弃的重复问题 id(保留首个)。 */
  readonly droppedDuplicateIds: readonly string[]
}

/** turn 维度 flush 结果。 */
export interface TurnFlushResult {
  readonly turnId: number
  /** 每元素即一次 ask_user_question 工具调用参数({ questions })。 */
  readonly payloads: readonly AskUserQuestionPayload[]
  readonly cardCount: number
  readonly questionCount: number
  readonly droppedDuplicateIds: readonly string[]
}

/** ask_user_question 工具调用参数形态(dsh-repo packages/interaction/tool-ask-user/README.md:46-60)。 */
export interface AskUserQuestionPayload {
  readonly questions: readonly AskUserQuestionItem[]
}

/** 合并统计(进 observe 的交互质量指标)。 */
export interface AskMergeStats {
  /** 收到的 add 次数(模型想问的次数)。 */
  readonly asksIn: number
  /** 收到的问题总数(去重前)。 */
  readonly questionsIn: number
  /** 实际发出的卡数。 */
  readonly cardsOut: number
  /** 去重丢弃的问题数。 */
  readonly duplicatesDropped: number
  /** 少打的卡数 = asksIn - cardsOut(负值表示单批超上限被拆分)。 */
  readonly interruptionsSaved: number
  /** 合并率 = 1 - cardsOut/asksIn(asksIn=0 时为 0)。 */
  readonly mergeRate: number
}

/**
 * 纯合并:多批草稿 → 最少张数的卡,每张 ≤ maxPerCard 问,提交顺序保持。
 * 同一 turn 内重复 id:保留首个,后续丢弃并计入 droppedDuplicateIds。
 */
export function mergeQuestionDrafts(
  batches: readonly (readonly QuestionDraft[])[],
  maxPerCard: number = MAX_QUESTIONS_PER_CARD,
): MergeResult {
  if (!Number.isInteger(maxPerCard) || maxPerCard <= 0) {
    throw new InteractConfigError(`maxPerCard 必须是正整数,收到 ${maxPerCard}`)
  }
  const droppedDuplicateIds: string[] = []
  const seenIds = new Set<string>()
  const unique: QuestionDraft[] = []
  for (const batch of batches) {
    for (const draft of batch) {
      validateDraft(draft)
      if (seenIds.has(draft.id)) {
        droppedDuplicateIds.push(draft.id)
        continue
      }
      seenIds.add(draft.id)
      unique.push(draft)
    }
  }
  const cards: MergedCard[] = []
  for (let index = 0; index < unique.length; index += maxPerCard) {
    cards.push(unique.slice(index, index + maxPerCard))
  }
  return { cards, droppedDuplicateIds }
}

/** 单个草稿结构校验(fail-closed;参数按不可信输入校验,unknown 而非已声明类型)。 */
export function validateDraft(draft: unknown): void {
  const issues: string[] = []
  if (!isRecord(draft)) {
    throw new InteractConfigError('问题草稿必须是对象')
  }
  if (typeof draft.id !== 'string' || draft.id === '') issues.push('id 必须是非空字符串')
  if (typeof draft.question !== 'string' || draft.question === '') issues.push('question 必须是非空字符串')
  if (draft.options !== undefined) {
    if (!Array.isArray(draft.options) || draft.options.length === 0) {
      issues.push('options 必须是非空列表(无选项请省略该字段)')
    } else {
      draft.options.forEach((option, index) => {
        if (!isRecord(option) || typeof option.label !== 'string' || option.label === '') {
          issues.push(`options[${index}].label 必须是非空字符串`)
        }
      })
    }
  }
  if (draft.multiSelect !== undefined && typeof draft.multiSelect !== 'boolean') {
    issues.push('multiSelect 必须是布尔值')
  }
  if (issues.length > 0) throw new InteractConfigError(`问题草稿校验失败(id=${String(draft.id)})`, issues)
}

export interface TurnQuestionMergerOptions {
  /** 单卡问题上限;默认 MAX_QUESTIONS_PER_CARD(3)。 */
  readonly maxPerCard?: number
  /** flush 时的回调(组合层在此真正发起 ask_user_question / ctx.userQuestions.ask)。 */
  readonly onFlush?: (result: TurnFlushResult) => void
}

/**
 * 同 turn 提问合并包装器:add 缓冲进当前 turn,turn 切换时自动 flush 上一 turn;
 * flush 把缓冲合并为最少张数的卡并以 { questions } 载荷形态产出。
 */
export class TurnQuestionMerger {
  private readonly maxPerCard: number
  private readonly onFlush: ((result: TurnFlushResult) => void) | undefined
  private currentTurnId: number | undefined
  private currentBatches: (readonly QuestionDraft[])[] = []
  private readonly statsAcc = { asksIn: 0, questionsIn: 0, cardsOut: 0, duplicatesDropped: 0 }

  constructor(options: TurnQuestionMergerOptions = {}) {
    this.maxPerCard = options.maxPerCard ?? MAX_QUESTIONS_PER_CARD
    this.onFlush = options.onFlush
  }

  /**
   * 向指定 turn 追加一批问题草稿。
   * 若上一缓冲属于别的 turn:自动 flush 它并**返回其结果**(调用方应把返回值当作被顶替 turn 的卡片发出);
   * 同 turn 或无缓冲时返回 undefined(本批已入缓冲,等待该 turn 结束 flush)。
   */
  add(turnId: number, drafts: readonly QuestionDraft[]): TurnFlushResult | undefined {
    if (this.currentTurnId !== undefined && this.currentTurnId !== turnId) {
      const flushed = this.flushCurrent()
      this.currentTurnId = turnId
      this.currentBatches = [drafts]
      this.statsAcc.asksIn += 1
      this.statsAcc.questionsIn += drafts.length
      return flushed
    }
    this.currentTurnId = turnId
    this.currentBatches.push(drafts)
    this.statsAcc.asksIn += 1
    this.statsAcc.questionsIn += drafts.length
    return undefined
  }

  /** flush 当前缓冲(空缓冲返回 undefined);不指定 turnId 则 flush 任何在缓冲的 turn。 */
  flush(turnId?: number): TurnFlushResult | undefined {
    if (this.currentTurnId === undefined) return undefined
    if (turnId !== undefined && this.currentTurnId !== turnId) return undefined
    return this.flushCurrent()
  }

  /** 当前是否有未 flush 的缓冲。 */
  get pendingTurnId(): number | undefined {
    return this.currentTurnId
  }

  /** 累计合并统计(observe 消费)。 */
  stats(): AskMergeStats {
    const { asksIn, questionsIn, cardsOut, duplicatesDropped } = this.statsAcc
    return {
      asksIn,
      questionsIn,
      cardsOut,
      duplicatesDropped,
      interruptionsSaved: asksIn - cardsOut,
      mergeRate: asksIn > 0 ? 1 - cardsOut / asksIn : 0,
    }
  }

  private flushCurrent(): TurnFlushResult | undefined {
    const turnId = this.currentTurnId
    if (turnId === undefined || this.currentBatches.length === 0) {
      this.currentTurnId = undefined
      this.currentBatches = []
      return undefined
    }
    const merged = mergeQuestionDrafts(this.currentBatches, this.maxPerCard)
    const result: TurnFlushResult = {
      turnId,
      payloads: merged.cards.map(card => ({ questions: card })),
      cardCount: merged.cards.length,
      questionCount: merged.cards.reduce((sum, card) => sum + card.length, 0),
      droppedDuplicateIds: merged.droppedDuplicateIds,
    }
    this.statsAcc.cardsOut += result.cardCount
    this.statsAcc.duplicatesDropped += result.droppedDuplicateIds.length
    this.currentTurnId = undefined
    this.currentBatches = []
    this.onFlush?.(result)
    return result
  }
}
