/**
 * R3 审批门(T7.1):保存/回滚/导入三类写操作全走 @eterna/interact 富审批卡
 * (计划书 §3「二次确认即审批留痕」)。
 *
 * 两段式协议:
 *  - request():校验通过后构造 R3 卡(ruleId eterna.prompt-studio.persona-write,
 *    doubleConfirm 产生同卡第二问),登记唯一在途审批并返回 approvalId;
 *  - confirm(approvalId, approved, echo):应答与在途请求不匹配(approvalId 未知、
 *    内容/乐观锁与请求时不一致)一律拒执行(TOCTOU 防线:第二段必须复述同一 content)。
 *
 * 卡片载荷经 buildApprovalCard(fail-closed 校验)+ cardToQuestionItems(官方
 * user-questions intent-approval 载荷,T7.2 客户端直接渲染)。
 */
import { buildApprovalCard, cardToQuestionItems } from '@eterna/interact'
import type { ApprovalCard, AskUserQuestionItem } from '@eterna/interact'
import { randomUUID } from 'node:crypto'
import { byteLength } from './checksum.ts'
import type { WriteKind } from './types.ts'

/** R3 命中规则 id(hitl 规则外的基座自带高危面:改 system prompt 影响所有新会话)。 */
export const PERSONA_WRITE_RULE_ID = 'eterna.prompt-studio.persona-write'

/** 在途审批载荷(第二段必须复述这些值,confirm 校验一致)。 */
export interface PendingWritePayload {
  readonly content: string
  readonly baseVersionId: string | null
  readonly versionId: string | null
  readonly summary: string
  readonly author: string
}

export interface PendingWrite {
  readonly approvalId: string
  readonly kind: WriteKind
  readonly createdAt: number
  readonly payload: PendingWritePayload
  readonly card: ApprovalCard
  readonly questionItems: readonly AskUserQuestionItem[]
}

export interface ApprovalGateOptions {
  readonly now?: () => number
  /** 在途审批有效期(默认 10 分钟;过期后 confirm 报 unknown,须重新发起)。 */
  readonly ttlMs?: number
  readonly idFactory?: () => string
}

/** 审批卡 diff 摘要与影响文件由调用方传入(本门只管登记与匹配)。 */
export interface CardFacts {
  readonly patchPath: string
  readonly diffSummary: string
  readonly subjectName: string
}

export type ConfirmOutcome =
  | { readonly outcome: 'approved'; readonly pending: PendingWrite }
  | { readonly outcome: 'declined'; readonly approvalId: string }
  | { readonly outcome: 'unknown'; readonly approvalId: string }
  | { readonly outcome: 'mismatch'; readonly approvalId: string; readonly reason: string }

export class ApprovalGate {
  readonly #now: () => number
  readonly #ttlMs: number
  readonly #idFactory: () => string
  #pending: PendingWrite | null = null

  constructor(options: ApprovalGateOptions = {}) {
    this.#now = options.now ?? (() => Date.now())
    this.#ttlMs = options.ttlMs ?? 600_000
    this.#idFactory = options.idFactory ?? (() => `ap-${randomUUID()}`)
  }

  /** 当前在途(可能已过期;过期视为不存在)。 */
  peek(): PendingWrite | null {
    const pending = this.#pending
    if (pending === null) return null
    if (this.#now() - pending.createdAt > this.#ttlMs) {
      this.#pending = null
      return null
    }
    return pending
  }

  /** 登记一次写审批(同刻只允许一张在途卡:单写者语义;新请求顶替旧请求)。 */
  request(kind: WriteKind, payload: PendingWritePayload, facts: CardFacts): PendingWrite {
    const now = this.#now()
    const card = buildApprovalCard({
      action: {
        kind: 'api',
        name: `loopPrompt/prompt-${kind}`,
        params: {
          bytes: byteLength(payload.content),
          summary: payload.summary,
          ...(payload.versionId !== null && { rollbackTo: payload.versionId }),
        },
      },
      why: {
        source: 'user',
        name: facts.subjectName,
        entry: `R3 · ${PERSONA_WRITE_RULE_ID}(修改 system prompt persona 段)`,
      },
      impact: {
        files: [{ path: facts.patchPath, diffSummary: facts.diffSummary }],
        externalSystems: [],
      },
      rollback: {
        reversible: true,
        inverseOf: 'loopPrompt/prompt-rollback(写前最新版本已入版本库)',
        note: '版本只增不删:本次写入以新版本追加,可随时回滚到写前版本',
      },
      matchedRule: {
        ruleId: PERSONA_WRITE_RULE_ID,
        grade: 'R3',
        reason: 'system prompt persona 段影响所有新会话的前缀与 KV-cache 命中',
      },
      r3: { escalateTo: [], coolingPeriodSec: 0, doubleConfirm: true },
    })
    const pending: PendingWrite = {
      approvalId: this.#idFactory(),
      kind,
      createdAt: now,
      payload,
      card,
      questionItems: cardToQuestionItems(card, { id: `approve:${PERSONA_WRITE_RULE_ID}` }),
    }
    this.#pending = pending
    return pending
  }

  /**
   * 审批应答:approved=true 且复述内容与请求一致 → 放行(取走在途);
   * 显式拒绝 → declined;id 未知/过期 → unknown;复述不一致 → mismatch。
   */
  confirm(
    approvalId: string,
    approved: boolean,
    echo: { content: string; baseVersionId: string | null; versionId: string | null },
  ): ConfirmOutcome {
    const pending = this.peek()
    if (pending === null || pending.approvalId !== approvalId) {
      return { outcome: 'unknown', approvalId }
    }
    if (!approved) {
      this.#pending = null
      return { outcome: 'declined', approvalId }
    }
    if (pending.payload.content !== echo.content) {
      return { outcome: 'mismatch', approvalId, reason: 'content 与审批请求时不一致(须原样复述)' }
    }
    if (pending.payload.baseVersionId !== echo.baseVersionId) {
      return { outcome: 'mismatch', approvalId, reason: 'baseVersionId 与审批请求时不一致(并发修改嫌疑)' }
    }
    if (pending.payload.versionId !== echo.versionId) {
      return { outcome: 'mismatch', approvalId, reason: 'versionId 与审批请求时不一致' }
    }
    this.#pending = null
    return { outcome: 'approved', pending }
  }

  /** 丢弃在途(不产生应答;供流程异常收尾,审计由调用方记)。 */
  cancel(): PendingWrite | null {
    const pending = this.#pending
    this.#pending = null
    return pending
  }
}
