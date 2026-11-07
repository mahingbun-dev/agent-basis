/**
 * 提示词工坊视图的注入状态与两段式写链路类型(T7.2 UI 义务,见
 * docs/dev/t7-prompt-studio.md §3):渲染 R3 卡 + questionItems → 回显重发 →
 * committed 后按 effectiveNote 提示。
 */
import type {
  LoopPromptSnapshot, PromptGetResult, PromptSaveResult, PromptVersionRecord,
  VersionsResult, WriteApprovalView, WriteKind,
} from '../types.ts'

/** 卡片载荷类型从线上封套派生(客户端不直接依赖 @basis/interact)。 */
export type ApprovalCard = WriteApprovalView['card']
export type AskUserQuestionItem = WriteApprovalView['questionItems'][number]

/** 工坊数据态(裸 observable 源的快照值;hooks 份额 → useStudio)。 */
export type StudioState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | {
    readonly status: 'ready'
    readonly snapshot: LoopPromptSnapshot
    readonly promptGet: PromptGetResult
    readonly versions: VersionsResult
  }

/** 第二段回显载荷:确认回路必须原样复述(TOCTOU 防线由宿主 ApprovalGate 校验)。 */
export interface WriteEcho {
  /** prompt-save:同一 content;prompt-rollback:目标 versionId;prompt-import:同一 pack。 */
  readonly content?: string
  readonly versionId?: string
  readonly baseVersionId?: string | null
  readonly summary?: string
  readonly author?: string
  /** prompt-import 两段式:第二段原样回传同一导出包(宿主按 checksum 复验)。 */
  readonly pack?: unknown
}

/** 在途审批(第一段 approval-required 的返回;组件渲染卡与双问后回发)。 */
export interface PendingApproval {
  readonly endpoint: 'loopPrompt/prompt-save' | 'loopPrompt/prompt-rollback' | 'loopPrompt/prompt-import'
  readonly approvalId: string
  readonly kind: WriteKind
  readonly card: ApprovalCard
  readonly questionItems: readonly AskUserQuestionItem[]
  readonly echo: WriteEcho
}

/** 写链路终态(就地展示:committed/rejected/declined/mismatch + issues)。 */
export interface WriteOutcomeView {
  readonly kind: WriteKind
  readonly status: string
  readonly issues?: readonly string[]
  readonly version?: PromptVersionRecord
  readonly effectiveNote?: string
  readonly message?: string
}

/** 由写端点返回值归一出终态视图(save/rollback/import 共形态)。 */
export function writeOutcomeFrom(
  kind: WriteKind,
  result: PromptSaveResult,
): WriteOutcomeView {
  return {
    kind,
    status: result.status,
    ...(result.issues !== undefined && { issues: result.issues }),
    ...(result.version !== undefined && { version: result.version }),
    effectiveNote: result.effectiveNote,
  }
}
