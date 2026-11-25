/**
 * sessions.jsonl 生成:一行一个 case 的会话评测记录,字段对齐 ai-evo
 * 会话数据集(user_input / answer / tags + 结果与指标),可直接导入。
 */
import type { PackRunResult } from './types.ts'

export function sessionsLines(result: PackRunResult): string[] {
  return result.results.map(item => JSON.stringify({
    case_id: item.caseData.id,
    user_input: item.caseData.user_input,
    answer: item.caseData.answer ?? null,
    tags: item.caseData.tags,
    status: item.status,
    adapter: item.adapterId,
    final_answer: item.finalAnswerText,
    metrics: {
      turns: item.metrics.turns,
      steps: item.metrics.steps,
      tool_calls: item.metrics.toolCalls,
      total_tokens: item.metrics.totalTokens,
      approval_asks: item.metrics.approvalAsks,
      event_count: item.metrics.eventCount,
    },
    failures: item.failures.map(failure => ({ category: failure.category, message: failure.message })),
    ...item.sessionEval === undefined ? {} : {
      session_eval: {
        verdict: item.sessionEval.rules.verdict,
        cost_usd: item.sessionEval.rules.costUsd,
        metrics_version: item.sessionEval.metricsVersion,
        rules: item.sessionEval.rules.metrics.map(metric => ({
          key: metric.key,
          name: metric.name,
          category: metric.category,
          status: metric.status,
          value: metric.value,
          display: metric.display,
          pass: metric.pass,
        })),
        business: item.sessionEval.business,
        skipped: item.sessionEval.skipped,
      },
    },
    ...item.sessionEvalError === undefined ? {} : { session_eval_error: item.sessionEvalError },
    session_ref: item.sessionRef,
    duration_ms: item.durationMs,
    recorded_at: result.startedAt,
  }))
}
