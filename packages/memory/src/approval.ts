/**
 * 记忆审批卡片与评审审计包装(M-M2 T9,19 号 §4-T9.2 + 勘察 S2 结论)。
 *
 * 送达链路结论(S2,2026-11-13 实测):官方 `conversation.approval.card` 与
 * user-questions 消费面所在的 dsh-client-ui-approval / dsh-client-ui-user-questions
 * 两个 client 包**未打进 dsh-web-frontend 0.2.2-rc.1 发行包**(发行包 JS 内
 * 'approval' 字符串 0 命中),官方卡片送达需宿主级发行包改造——非本仓最小接入
 * 可解。故 M-M2 采 19 号 §4-T9.3 退路:**类型复用,不投官方通道**——
 * pending 产生时组 @eterna/interact 的 ApprovalCardInput,经 buildApprovalCard
 * fail-closed 校验并渲染 detail(卡片事实进审计账本 proposal 行,19 号 T9.4),
 * 送达 = 面板审批队列(panel snapshot pending 列表 + eternaPanel/review 裁决)。
 *
 * 官方通道一行切换面(S2 结论 3,预留不启用):memoryApprovalAskRequest 把卡片
 * 经 cardToQuestionItems 渲染为官方 user-questions 载荷(Action=记住/跳过,
 * 选项恰覆盖 approve/reject)——上游发行包纳入两个 client 包后,在提取执行体
 * 组卡处改为 `ctx.userQuestions.ask(memoryApprovalAskRequest(card, id))` 即完成
 * 切换(形态零转换;interact tests/types.seam-pin.ts:41-43 已钉 flush 产物可
 * 直接作为 AskUserQuestionRequestEvent.questions,本包 seam-pin ⑥ 同款钉住)。
 *
 * 卡片字段映射(19 号 §4-T9.2 原文口径):
 * - 标题「从本次会话学到…」→ why.name(卡面主体;cardToQuestionItems 的
 *   intent.subject.name 同源)与 subjectName;
 * - Why=出处会话摘要 → why.entry(摘要文本经 PiiGuard 回退,见 buildSessionDigest);
 * - Action=记住/跳过 → memoryApprovalAskRequest 的 approve/reject 按钮文案;
 * - 影响面 = 记忆库文件(待审行键清单),回滚 = 评审拒绝(软失效)。
 */
import { buildApprovalCard, cardToQuestionItems } from '@eterna/interact'
import type { ApprovalCard, ApprovalCardInput, AskUserQuestionItem } from '@eterna/interact'
import type { MemoryAuditLedger } from './audit.ts'
import type { EntityRecord, EntityReviewDecision } from './entity-store.ts'
import type { PiiGuard } from './pii.ts'
import type { Memory } from './memory.ts'

/** 卡片标题(19 号 §4-T9.2 原文:标题「从本次会话学到…」)。 */
export const MEMORY_REVIEW_CARD_TITLE = '从本次会话学到…'

/** Action 文案:批准=记住 / 拒绝=跳过(19 号 §4-T9.2 原文)。 */
export const MEMORY_APPROVE_LABEL = '记住'
export const MEMORY_REJECT_LABEL = '跳过'

/** 命中规则 id(卡片 matchedRule;审批档依据 08 号 §5.4)。 */
export const MEMORY_REVIEW_RULE_ID = 'memory.consolidation-review'

/** 卡片风险档:R2(需确认;R3 是资金/法务级,记忆审批不适用)。 */
export const MEMORY_REVIEW_GRADE = 'R2' as const

/** 出处会话摘要截断上限(卡片不整段塞入会话原文;超长截断加标记)。 */
export const MEMORY_CARD_DIGEST_MAX_CHARS = 80

/** PII 命中时的摘要回退文案(摘要缺席 ≠ 摘要违规:违规内容一个字都不外带)。 */
export const MEMORY_DIGEST_PII_FALLBACK = '会话内容含敏感信息,摘要省略(详情见出处会话)'

/** 摘要缺席(会话快照无文本)时的占位。 */
export const MEMORY_DIGEST_ABSENT = '(出处会话无文本摘要)'

/** 待审条目的卡片视图(来自 writeEntity 落库结果,字段均已过 PII 写入闸)。 */
export interface MemoryPendingItemView {
  readonly id: number
  readonly subject: string
  readonly key: string
  /** 一句话摘要(空摘要给空串;卡片正文用 key 标识条目)。 */
  readonly summary: string
}

/** buildMemoryApprovalCard 的输入(组卡事实;19 号 §4-T9.2)。 */
export interface MemoryApprovalCardSpec {
  /** 出处会话 id(provenance;进卡片参数与 question id)。 */
  readonly sessionId: string
  /** 出处轮次引用(如 `turn:7`)。 */
  readonly turnRef: string
  /** 出处会话摘要(Why;须经 buildSessionDigest 的 PII 回退,不直接透传原文)。 */
  readonly sessionDigest: string
  /** 待审条目(≥1;空集在组卡前置拒绝——没有待审行就没有卡片)。 */
  readonly items: readonly MemoryPendingItemView[]
  /** 记忆库展示路径(影响面文件;缺省 '.eterna/memory.sqlite3')。 */
  readonly storeLabel?: string
}

/** 摘要按字符截断(UTF-16 单位;尾字符是高代理项时丢弃,不碎字形)。 */
export function truncateDigest(text: string, maxChars: number = MEMORY_CARD_DIGEST_MAX_CHARS): string {
  if (text.length <= maxChars) return text
  let cut = text.slice(0, maxChars)
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
  return `${cut}…`
}

/**
 * 出处会话摘要(Why 位):会话快照首行剥 `[用户] `/`[助手] ` 前缀后截断——
 * 原文未经 PII 闸,先过 PiiGuard(fail-closed:命中即回退占位文案,原文字节
 * 不外带;assertClean 抛出的任何错误同路径处理,摘要是装饰位不值得赌)。
 * 空快照给 MEMORY_DIGEST_ABSENT 占位。
 */
export function buildSessionDigest(transcript: string, pii: PiiGuard): string {
  const firstLine = transcript.split('\n').find(line => line.trim().length > 0) ?? ''
  const digest = truncateDigest(firstLine.replace(/^\[(?:用户|助手)\]\s*/u, '').trim())
  if (digest.length === 0) return MEMORY_DIGEST_ABSENT
  try {
    pii.assertClean(digest, 'memory:approval-card-digest')
    return digest
  } catch {
    return MEMORY_DIGEST_PII_FALLBACK
  }
}

/**
 * 组记忆审批卡片(19 号 §4-T9.2):映射为 interact ApprovalCardInput 后经
 * buildApprovalCard fail-closed 校验并渲染 renderedDetail——结构不合法抛
 * InteractConfigError(与工具审批卡片同一条 fail-closed 纪律,绝不降级出卡)。
 * items 为空在组卡前置拒绝(没有待审行就没有卡片,不空转校验器)。
 */
export function buildMemoryApprovalCard(spec: MemoryApprovalCardSpec): ApprovalCard {
  if (spec.items.length === 0) {
    throw new RangeError('[memory] 审批卡片至少要有一条待审记忆(无待审行不组卡)')
  }
  const keys = spec.items.map(item => item.key)
  const input: ApprovalCardInput = {
    action: {
      kind: 'api',
      name: 'memory.review',
      params: { sessionId: spec.sessionId, turnRef: spec.turnRef, ids: spec.items.map(item => item.id), keys },
    },
    why: {
      source: 'user',
      name: MEMORY_REVIEW_CARD_TITLE,
      entry: `出处会话摘要:${spec.sessionDigest}`,
    },
    impact: {
      files: [{
        path: spec.storeLabel ?? '.eterna/memory.sqlite3',
        diffSummary: `待审记忆 ${spec.items.length} 条:${keys.join('、')}`,
      }],
    },
    rollback: {
      reversible: true,
      inverseOf: '评审拒绝(软失效)',
      note: '批准后仍可随时拒绝(软失效)或用 memory_forget 物理删除',
    },
    matchedRule: {
      ruleId: MEMORY_REVIEW_RULE_ID,
      grade: MEMORY_REVIEW_GRADE,
      reason: '整固/摘要提案默认待审:user 层与 semantic/procedural 记忆需人工批准才生效(08 号 §5.4 审批档)',
    },
    subjectName: MEMORY_REVIEW_CARD_TITLE,
  }
  return buildApprovalCard(input)
}

/**
 * 官方通道一行切换面(S2 结论 3,预留不启用):卡片 → 官方 user-questions
 * 载荷(Action=记住/跳过;1 问,选项恰覆盖 approve/reject)。返回值形态与
 * `ctx.userQuestions.ask({ ...request, wait: { callId } })` 的请求体零转换
 * (本包 tests/types.seam-pin.ts 钉住 ⑥;questions 为可变数组,与官方
 * AskUserQuestionRequestEvent.questions 同型,interact pin ① 同款)——
 * M-M2 不投递,送达走面板审批队列。
 */
export function memoryApprovalAskRequest(card: ApprovalCard, questionId: string): { questions: AskUserQuestionItem[] } {
  return {
    questions: cardToQuestionItems(card, {
      id: questionId,
      approveLabel: MEMORY_APPROVE_LABEL,
      rejectLabel: MEMORY_REJECT_LABEL,
    }),
  }
}

/**
 * review 审计包装(T9 账本接线):把 Memory.review 的每次**落定**(行存在)
 * 记一行 `review` 事件到账本;行不存在(已处理/越界 id)没有裁决发生,不记。
 * 其余成员原样透传(展开 + 方法箭头保 this 绑定);账本写入失败 fail-open
 * (账本自身 warn,不反噬裁决)。glue 层以包装后的实例对外(provide/@eterna/memory)
 * 并穿线给 attachMemory——面板裁决、未来官方通道裁决共用同一条审计路径。
 */
export function withReviewAudit(memory: Memory, ledger: MemoryAuditLedger): Memory {
  return {
    ...memory,
    review(id: number, decision: EntityReviewDecision): EntityRecord | null {
      const record = memory.review(id, decision)
      if (record !== null) {
        ledger.recordReview({ id, decision, subject: record.subject, key: record.key })
      }
      return record
    },
  }
}
