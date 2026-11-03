/**
 * @basis/interact —— L1 人机交互质量插件(策略纯函数层 + DSH seam 适配形态)。
 *
 * 五个模块(设计文档 08 §6、12 §3、14 号 T3):
 * 1. hitl.ts:hitl.yaml 加载与校验(R0-R3 分档、on_no_answer 挂起策略、R3 专属控制),fail-closed;
 * 2. presets.ts:R0-R3 → DSH permission-presets 配置产物生成器(分档逻辑在插件,执行在内核);
 * 3. card.ts:富上下文审批卡片 payload(将发生什么/为什么/影响面/回滚性/命中规则 + R3 附加),
 *    可渲染为官方 user-questions 载荷(intent approval 分支);
 * 4. ask.ts:同 turn 提问合并包装器(一卡 ≤3 问,禁挤牙膏式逐个问) + 合并率统计;
 * 5. negative.ts:审批负信号事件(被拒/被修改)发布接口,供 observe 消费。
 *
 * Cordis 纪律:本包是策略纯函数层(不触碰 ctx 全局);实例态(提问缓冲、负信号订阅与快照)
 * 全部挂在 createInteract() 产物上,组合层以 `ctx.interact` 服务(注册表 + INTERACT_SERVICE_ID
 * 唯一 ID)形态 provide,可交换;配逆 = disposeInteract()(flush 未发卡片 + 清空信号快照)。
 * seam 编译期钉住见 tests/types.seam-pin.ts。
 */
import { TurnQuestionMerger } from './ask.ts'
import { buildApprovalCard, cardToQuestionItems } from './card.ts'
import { InteractConfigError } from './errors.ts'
import { HitlPolicy } from './hitl.ts'
import { ApprovalSignalBus } from './negative.ts'
import { generatePresetArtifact } from './presets.ts'
import type { TurnQuestionMergerOptions } from './ask.ts'
import type { ApprovalCard, ApprovalCardInput, CardQuestionOptions } from './card.ts'
import type { ApprovalSignalBusOptions } from './negative.ts'
import type { GradeDecision, HitlDocument } from './hitl.ts'
import type { GeneratePresetOptions, PermissionPresetArtifact } from './presets.ts'
import type { ToolCallLike } from './types.ts'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'

export { TurnQuestionMerger, mergeQuestionDrafts, validateDraft, MAX_QUESTIONS_PER_CARD } from './ask.ts'
export type {
  AskMergeStats, AskUserQuestionPayload, MergeResult, MergedCard, QuestionDraft, TurnFlushResult,
  TurnQuestionMergerOptions,
} from './ask.ts'
export { buildApprovalCard, cardToQuestionItems, PARAMS_PREVIEW_LIMIT } from './card.ts'
export type {
  ApprovalCard, ApprovalCardInput, CardAction, CardExternalImpact, CardFileImpact, CardImpact, CardMatchedRule,
  CardQuestionOptions, CardR3Controls, CardRollback, CardWhy,
} from './card.ts'
export { InteractConfigError, isRecord } from './errors.ts'
export { HitlPolicy } from './hitl.ts'
export type { GradeDecision, HitlDocument, HitlRule } from './hitl.ts'
export { ApprovalSignalBus } from './negative.ts'
export type {
  ApprovalNegativeKind, ApprovalNegativeListener, ApprovalNegativeSignal, ApprovalSignalBusOptions,
  ApprovalSignalMeta,
} from './negative.ts'
export {
  generatePresetArtifact, renderPresetYaml, GRADE_PRESET_BUNDLES, RESERVED_PRESET_NAMES,
} from './presets.ts'
export type { GeneratePresetOptions, PermissionPresetArtifact } from './presets.ts'
export { RISK_GRADES, globToRegExp, matchAnyGlob, matchGlob, stableStringify } from './types.ts'
export type { NoAnswerStrategy, RiskGrade, ToolCallLike } from './types.ts'
export type { AskUserQuestionItem, AskUserQuestionOption } from '@deepseek-ai/dsh-user-questions'

/** 组合层注册 ctx.interact 服务时的唯一 ID(注册表 + 唯一 ID 形态,provide 可交换)。 */
export const INTERACT_SERVICE_ID = '@basis/interact'

/** 组合后的交互服务面:hitl 分档 + 预设产物 + 富卡片 + 提问合并 + 负信号。 */
export interface Interact {
  readonly id: typeof INTERACT_SERVICE_ID
  /** hitl 策略(分档裁决入口)。 */
  readonly hitl: HitlPolicy
  /** 由 hitl 生成的 permission-presets 配置产物(启动时一次性生成)。 */
  readonly presetArtifact: PermissionPresetArtifact
  /** 同 turn 提问合并包装器。 */
  readonly ask: TurnQuestionMerger
  /** 审批负信号总线(observe 消费)。 */
  readonly signals: ApprovalSignalBus
  /** 分档裁决便捷入口(HitlPolicy.gradeFor)。 */
  gradeFor(call: ToolCallLike): GradeDecision
  /** 富审批卡片构造便捷入口。 */
  buildApprovalCard(input: ApprovalCardInput): ApprovalCard
  /** 卡片 → 官方 user-questions 载荷便捷入口。 */
  cardToQuestionItems(card: ApprovalCard, options?: CardQuestionOptions): AskUserQuestionItem[]
}

export interface InteractOptions {
  /** hitl.yaml 全文(与 hitl 二选一)。 */
  readonly hitlYaml?: string
  /** 已解析的 hitl 文档(与 hitlYaml 二选一;会经校验器复检)。 */
  readonly hitl?: HitlDocument
  /** 提问合并器选项(单卡上限/flush 回调)。 */
  readonly ask?: TurnQuestionMergerOptions
  /** 负信号总线选项(时钟注入/缓冲上限)。 */
  readonly signals?: ApprovalSignalBusOptions
  /** 预设名前缀;默认 'basis'。 */
  readonly presetNamePrefix?: string
}

/** 组装交互服务实例(纯对象 + 实例态缓冲,无隐藏全局)。 */
export function createInteract(options: InteractOptions): Interact {
  const source = options.hitlYaml ?? options.hitl
  if (source === undefined) {
    throw new InteractConfigError('createInteract 需要 hitlYaml 或 hitl 二者之一')
  }
  const hitl = typeof source === 'string' ? HitlPolicy.parse(source) : HitlPolicy.load(toRawHitl(source))
  const presetOptions: GeneratePresetOptions = {
    ...(options.presetNamePrefix !== undefined && { namePrefix: options.presetNamePrefix }),
  }
  const presetArtifact = generatePresetArtifact(hitl.document, presetOptions)
  const id = INTERACT_SERVICE_ID
  return {
    id,
    hitl,
    presetArtifact,
    ask: new TurnQuestionMerger(options.ask),
    signals: new ApprovalSignalBus(options.signals),
    gradeFor: (call: ToolCallLike): GradeDecision => hitl.gradeFor(call),
    buildApprovalCard,
    cardToQuestionItems,
  }
}

/** 服务配逆:flush 未发的提问卡(经 onFlush 正常发出而非静默丢弃)+ 清空负信号快照;供组合层 dispose 调用。 */
export function disposeInteract(interact: Interact): void {
  interact.ask.flush()
  interact.signals.clear()
}

/**
 * 已解析文档喂 HitlPolicy.load 前,先转回 YAML 键形态再过一遍校验器
 * (校验器是唯一权威;构造路径来源的文档同样不允许绕过 fail-closed 检查)。
 */
function toRawHitl(doc: HitlDocument): unknown {
  return {
    ...(doc.pack !== undefined && { pack: doc.pack }),
    default_grade: doc.defaultGrade,
    on_no_answer: doc.onNoAnswer,
    rules: doc.rules.map(rule => ({
      id: rule.id,
      grade: rule.grade,
      tools: [...rule.tools],
      ...(rule.argsContains !== undefined && { args_contains: [...rule.argsContains] }),
      ...(rule.reason !== '' && { reason: rule.reason }),
      ...(rule.onNoAnswer !== 'suspend' && { on_no_answer: rule.onNoAnswer }),
      ...(rule.escalateTo.length > 0 && { escalate_to: [...rule.escalateTo] }),
      ...(rule.coolingPeriodSec > 0 && { cooling_period_sec: rule.coolingPeriodSec }),
      ...(rule.doubleConfirm && { double_confirm: rule.doubleConfirm }),
    })),
  }
}
