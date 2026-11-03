/**
 * answer 断言(期望答案 vs 最终助手文本)与 budget 断言(轮数 / token)。
 * answer 本地无裁判模型,只做确定性匹配:contains 子串或 match 正则
 * (ai-evo 平台侧才有 LLM 裁判;本地 runner 的口径写进 README)。
 */
import type { SessionSummary } from './events.ts'
import type { AnswerAssert, BudgetAssert, FailureDetail } from './types.ts'

export function assertAnswer(spec: AnswerAssert | undefined, finalAnswerText: string): FailureDetail[] {
  if (spec === undefined) return []
  const haystack = spec.ignore_case === true ? finalAnswerText.toLowerCase() : finalAnswerText
  if (spec.contains !== undefined) {
    const needle = spec.ignore_case === true ? spec.contains.toLowerCase() : spec.contains
    if (!haystack.includes(needle)) {
      return [{ category: 'answer', message: `answer: 最终回答未包含 ${JSON.stringify(spec.contains)},实际: ${truncate(finalAnswerText)}` }]
    }
  }
  if (spec.match !== undefined) {
    const flags = spec.ignore_case === true ? 'i' : ''
    if (!new RegExp(spec.match, flags).test(haystack)) {
      return [{ category: 'answer', message: `answer: 最终回答不匹配正则 /${spec.match}/${flags},实际: ${truncate(finalAnswerText)}` }]
    }
  }
  return []
}

function truncate(text: string): string {
  const snippet = text.slice(0, 120)
  return text.length > 120 ? `${snippet}…` : snippet
}

export function assertBudget(spec: BudgetAssert | undefined, summary: SessionSummary): FailureDetail[] {
  if (spec === undefined) return []
  const problems: string[] = []
  if (spec.max_turns !== undefined && summary.turns > spec.max_turns) {
    problems.push(`budget: 实际 ${summary.turns} 轮 > max_turns ${spec.max_turns}`)
  }
  if (spec.max_tokens !== undefined && summary.totalTokens > spec.max_tokens) {
    problems.push(`budget: 实际 ${summary.totalTokens} tokens > max_tokens ${spec.max_tokens}`)
  }
  return problems.map(message => ({ category: 'budget' as const, message }))
}
