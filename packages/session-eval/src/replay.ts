/**
 * 金集回放评分(56 号 §5.7 P2-3d / §9.7):把 **dsh-evals 回放出来的会话事件流**
 * 按本插件的评分口径算一遍,供离线金集与在线会话使用同一套断言语义。
 *
 * 分层:
 * - **内置规则层**:直接复用 `aggregateSessionMetrics` + `projectTrajectory` +
 *   `evaluateRules`(与在线 `snapshot` 同一实现,不另写一套);
 * - **业务规则层**:读取与线上 `metrics.yaml` 同格式的文件,只执行确定性规则
 *   (`trajectory.approval_flow` / `answer.not_contains` / `budget`);裁判型与
 *   逐轮口径条目**跳过并列出原因**——离线回放没有模型、也没有目标轮。
 *
 * 纯函数:不碰 DSH_HOME、不写评分库、不调用模型;事件流的外来字段一律 fail-closed。
 */
import { aggregateSessionMetrics } from '@eterna/observe'
import { buildBusinessRuleFacts, isBusinessRuleMetric, runBusinessRule } from './business-rules.ts'
import { parseBusinessMetrics } from './business-yaml.ts'
import { evaluateRules } from './metrics.ts'
import { projectTrajectory } from './trajectory.ts'
import type { SessionEventLike, EvalIssue, EvalVerdict, MetricScore } from './types.ts'

/** 业务规则回放结果(字段与在线评分行同口径:三态 + 通过判定 + 中文理由). */
export interface ReplayBusinessScore {
  readonly key: string
  readonly name: string
  readonly category: 'outcome' | 'process'
  readonly scope: 'session' | 'turn'
  /** ok / not_applicable / error(离线无调用失败,error 只可能来自定义形态). */
  readonly status: 'ok' | 'not_applicable' | 'error'
  readonly value: boolean | null
  readonly display: string
  readonly rationale: string
}

/** 被跳过的业务指标与原因(不静默丢弃). */
export interface ReplaySkippedMetric {
  readonly key: string
  readonly reason: string
}

/** 一次回放评分的完整产物. */
export interface ReplayScore {
  /** 内置确定性规则(与在线快照同一结构). */
  readonly rules: {
    readonly metrics: readonly MetricScore[]
    readonly issues: readonly EvalIssue[]
    readonly verdict: EvalVerdict
    readonly costUsd: number | null
  }
  /** 业务规则指标(按 metrics.yaml 文件顺序). */
  readonly business: readonly ReplayBusinessScore[]
  /** 跳过的业务指标(裁判型/逐轮/停用)与原因. */
  readonly skipped: readonly ReplaySkippedMetric[]
  /** metrics.yaml 文件版本(未提供文件时为 null). */
  readonly metricsVersion: number | null
}

/** 评分回复(失败给中文原因;不抛异常). */
export type ReplayScoreReply =
  | { readonly ok: true; readonly score: ReplayScore }
  | { readonly ok: false; readonly error: string }

/** 评分输入. */
export interface ReplayScoreInput {
  readonly sessionId: string
  readonly events: readonly SessionEventLike[]
  /** 业务指标 YAML 原文(缺省 = 只算内置规则). */
  readonly metricsYaml?: string
}

/** 业务指标的展示值(三态,不把「不适用」伪装成未过). */
function businessDisplay(status: ReplayBusinessScore['status'], value: boolean | null): string {
  if (status === 'not_applicable') return '不适用'
  if (status === 'error') return '出错'
  return value === true ? '通过' : '未过'
}

/** 跳过原因文案(不可离线执行的三种形态). */
const BLOCKER_REASON = {
  disabled: '已停用',
  turn: '逐轮口径（回放只算整条会话）',
  judge: '裁判型（回放无模型）',
} as const

/**
 * 对一个会话事件流按会话评测口径打分。
 * @param input - 会话 id、事件流(DSH SessionEvent 形状)与可选业务指标 YAML.
 * @returns 内置规则 + 业务规则结果;事件为空或 YAML 非法时如实报错.
 */
export function scoreReplayEvents(input: ReplayScoreInput): ReplayScoreReply {
  if (input.events.length === 0) return { ok: false, error: '没有会话事件可评。' }
  try {
    const aggregate = aggregateSessionMetrics(input.events)
    const trajectory = projectTrajectory(input.sessionId, input.events)
    const evaluation = evaluateRules({ aggregate, trajectory })

    const business: ReplayBusinessScore[] = []
    const skipped: ReplaySkippedMetric[] = []
    let metricsVersion: number | null = null
    if (input.metricsYaml !== undefined) {
      const parsed = parseBusinessMetrics(input.metricsYaml)
      if (!parsed.ok) return { ok: false, error: parsed.error }
      metricsVersion = parsed.file.version
      const facts = buildBusinessRuleFacts(input.events)
      for (const metric of parsed.file.metrics) {
        if (!metric.enabled) {
          skipped.push({ key: metric.key, reason: BLOCKER_REASON.disabled })
          continue
        }
        if (metric.scope === 'turn') {
          skipped.push({ key: metric.key, reason: BLOCKER_REASON.turn })
          continue
        }
        if (!isBusinessRuleMetric(metric)) {
          skipped.push({ key: metric.key, reason: BLOCKER_REASON.judge })
          continue
        }
        const result = runBusinessRule(metric, facts)
        const status = result.status === 'ok' || result.status === 'not_applicable' || result.status === 'error'
          ? result.status
          : 'error'
        business.push({
          key: metric.key,
          name: metric.name,
          category: metric.category,
          scope: metric.scope,
          status,
          value: status === 'ok' ? result.value : null,
          display: businessDisplay(status, result.value),
          rationale: result.rationale,
        })
      }
    }

    return {
      ok: true,
      score: {
        rules: {
          metrics: evaluation.metrics,
          issues: evaluation.issues,
          verdict: evaluation.verdict,
          costUsd: evaluation.costUsd,
        },
        business,
        skipped,
        metricsVersion,
      },
    }
  } catch {
    return { ok: false, error: '规则求值失败（事件流形态异常）。' }
  }
}

/** metrics.yaml 预校验结果(CLI 在起跑前给出用法错误,而不是逐 case 重复报错). */
export type ReplayMetricsValidation =
  | { readonly ok: true; readonly version: number; readonly count: number }
  | { readonly ok: false; readonly error: string }

/**
 * 预校验业务指标 YAML(与评分同一解析器,保证「验过就能跑」).
 * @param text - 文件原文.
 * @returns 文件版本与条目数,或中文原因.
 */
export function validateReplayMetrics(text: string): ReplayMetricsValidation {
  const parsed = parseBusinessMetrics(text)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  return { ok: true, version: parsed.file.version, count: parsed.file.metrics.length }
}
