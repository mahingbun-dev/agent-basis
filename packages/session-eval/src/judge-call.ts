/**
 * 裁判调用编排(56 号 §5.2/§5.4):冻结提示词 → 一次性直调 → 严格校验 → 三态评分。
 *
 * 与 memory 的 `runCuratorOneShot` **同管道形状但不同实现**:那支是 Tier1 包内导出,
 * 本包不 import 它(Tier1 之间不互依赖;且它的错误文案/上限是提取场景的)。
 * 模型调用经 {@link JudgeLlmPort} 结构面注入——测试用假件,宿主半边接 `ctx.llm`。
 *
 * 失败口径:
 * - 输出不合契约 → `error`(不重试,理由带校验原因);
 * - 调用失败(网络/限流/截断)→ `error`(理由带模型错误摘要);
 * - 模型判 na → `not_applicable`(不进分母,不伪造通过)。
 */
import type { JudgeStatus } from './judge-types.ts'
import type { JudgeMetricDef } from './judge-metrics.ts'
import { judgeSystemPrompt } from './judge-metrics.ts'
import type { JudgeInput } from './judge-input.ts'
import { renderJudgeUserText } from './judge-input.ts'
import { JUDGE_MAX_TOKENS, JUDGE_RATIONALE_MAX, type JudgeRoute } from './judge-types.ts'
import { parseJudgeOutput, verdictToScore } from './judge-parse.ts'

/** 一次裁判直调的端口(结构面;宿主实现接 ctx.llm,测试注入假件). */
export interface JudgeLlmPort {
  call(input: {
    readonly route: JudgeRoute
    readonly system: string
    readonly user: string
    readonly maxTokens: number
    readonly signal?: AbortSignal
  }): Promise<JudgeCallResponse>
}

/** 端口返回(文本 + 用量 + 耗时;用量缺失不影响判定). */
export interface JudgeCallResponse {
  readonly text: string
  readonly tokens?: number
  readonly latencyMs?: number
}

/** 一次裁判执行的结果(编排层据此落库). */
export interface JudgeRunResult {
  readonly status: Exclude<JudgeStatus, 'sampled_out' | 'pending'>
  readonly value: boolean | null
  readonly rationale: string
  readonly latencyMs: number
  readonly tokens?: number
}

/**
 * 执行一次裁判。
 * @param metric - 内置裁判指标(提示词冻结在包内).
 * @param input - 会话裁判输入(任务 + 逐轮摘要).
 * @param route - 裁判路由.
 * @param llm - 直调端口.
 * @param options - 目标轮(过程类)与取消信号.
 * @returns 三态结果;任何异常都被收敛成 `error`(不抛给队列).
 */
export async function runJudge(
  metric: JudgeMetricDef,
  input: JudgeInput,
  route: JudgeRoute,
  llm: JudgeLlmPort,
  options: { readonly turn?: number; readonly signal?: AbortSignal } = {},
): Promise<JudgeRunResult> {
  const started = performance.now()
  try {
    const response = await llm.call({
      route,
      system: judgeSystemPrompt(metric),
      user: renderJudgeUserText(input, metric.scope, options.turn),
      maxTokens: JUDGE_MAX_TOKENS,
      ...options.signal === undefined ? {} : { signal: options.signal },
    })
    const parsed = parseJudgeOutput(response.text)
    const mapped = verdictToScore(parsed.verdict)
    return {
      status: mapped.status,
      value: mapped.value,
      rationale: parsed.rationale,
      latencyMs: Math.round(response.latencyMs ?? performance.now() - started),
      ...response.tokens === undefined ? {} : { tokens: response.tokens },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const rationale = clipRationale(message)
    return {
      status: 'error',
      value: null,
      rationale,
      latencyMs: Math.round(performance.now() - started),
    }
  }
}

/** 错误摘要进理由位(限长,不泄漏调用栈). */
function clipRationale(text: string): string {
  const compact = text.replace(/\s+/gu, ' ').trim()
  return compact.length <= JUDGE_RATIONALE_MAX ? compact : `${compact.slice(0, JUDGE_RATIONALE_MAX - 1)}…`
}
