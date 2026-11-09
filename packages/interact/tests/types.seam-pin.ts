/**
 * DSH seam 编译期钉住(只被 tsc --noEmit 消费;vitest include 只收 *.spec.ts,不运行本文件)。
 *
 * 目的(设计文档 08 §8 风险 1:DSH pre-stable,所有 L1 插件的适配面要在 CI 里用接口
 * 冒烟测试钉住):本文件用**已发布的 @deepseek-ai/dsh-user-questions / dsh-user-approval /
 * dsh-permission-presets / dsh-sandbox(均与 deepseek-harness 同为 0.2.2-alpha.2)类型**断言
 * interact 包的产物与官方 seam 双向兼容——DSH 升级破坏 seam 形态时,
 * `pnpm --filter @eterna/interact run verify` 的 tsc 阶段即失败。
 *
 * 依据(deepseek-harness,只读):
 * - packages/interaction/user-questions/src/types.ts(AskUserQuestionItem/Intent approval 分支、
 *   AskUserQuestionRequestEvent、'user-questions/request' waterfall)
 * - packages/interaction/user-approval/src/types.ts(ApprovalOutcome、'approval/request' waterfall)
 * - packages/interaction/permission-presets(PresetSpec、presets/defaultPreset 配置、保留名 custom/auto)
 * - packages/sandbox/sandbox/src/index.ts:30(SandboxMode = 'read-only'|'workspace-write'|'danger-full-access')
 */
import type { Events } from '@deepseek-ai/cordis'
import { validateDraft } from '../src/index.ts'
import type { ApprovalSignalBus, PermissionPresetArtifact, TurnQuestionMerger } from '../src/index.ts'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { PresetSpec } from '@deepseek-ai/dsh-permission-presets'
import type {
  AskUserQuestionAnswer, AskUserQuestionItem,
} from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionRequestEvent } from '@deepseek-ai/dsh-user-questions/types'

// 触发 dsh 包对 cordis Events 的 augmentation('user-questions/request' / 'approval/request')。
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-user-approval'

declare const merger: TurnQuestionMerger
declare const bus: ApprovalSignalBus
declare const artifact: PermissionPresetArtifact

/**
 * 钉住 ①:合并器产出的卡即官方 ask_user_question 工具调用载荷——
 * flush 结果的 questions 可直接作为 AskUserQuestionRequestEvent.questions 发给
 * ctx.userQuestions.ask()(组合层零形态转换)。
 */
export function pinMergedPayloadFeedsUserQuestions(flushedQuestions: readonly AskUserQuestionItem[]): AskUserQuestionRequestEvent {
  return { questions: [...flushedQuestions] }
}

/** 钉住 ①b:合并器产出的每一项满足官方 AskUserQuestionItem(卡片 intent approval 分支在内)。 */
export function pinCardItemIsOfficial(): AskUserQuestionItem | undefined {
  return merger.flush()?.payloads[0]?.questions[0]
}

/** 钉住 ②:官方事件面的问题项能被本包草稿校验器复检(官方形态 ⊇ 本包约束,双向兼容)。 */
export function pinOfficialQuestionsRevalidate(request: AskUserQuestionRequestEvent): void {
  for (const item of request.questions) {
    validateDraft(item)
  }
}

/**
 * 钉住 ③:interact 可作为 dsh `approval/request` waterfall 应答器——
 * 官方 ApprovalOutcome 直接喂 recordOutcome 翻译负信号(被拒),应答器整体返回官方结局词汇。
 */
export const pinApprovalAnswerer: Events['approval/request'] = async (req, next) => {
  const outcome: ApprovalOutcome = await next()
  bus.recordOutcome(outcome, {
    toolName: req.toolName,
    grade: 'R2',
    ...(req.reason !== undefined && { reason: req.reason }),
  })
  return outcome
}

/**
 * 钉住 ④:预设产物 config 满足 permission-presets 插件行配置面——
 * presets 是 Record<string, PresetSpec>(sandbox+approval 双旋钮 + 可选呈现),defaultPreset 为表内键。
 */
export const pinPresetArtifactConfig: { presets: Record<string, PresetSpec>; defaultPreset: string } = {
  presets: { ...artifact.config.presets },
  defaultPreset: artifact.config.defaultPreset,
}

/** 钉住 ④b:档→旋钮映射的取值落在官方 SandboxMode 词汇内。 */
export const pinSandboxVocabulary: readonly SandboxMode[] = ['read-only', 'workspace-write', 'danger-full-access']

/** 钉住 ⑤:官方答案形态(AskUserQuestionAnswer)可被组合层原样回传,本包不改答案协议。 */
export function pinAnswerPassthrough(answer: AskUserQuestionAnswer): AskUserQuestionAnswer {
  return answer
}
