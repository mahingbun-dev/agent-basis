/**
 * LLM judge 层(22 号 §3-C4 规划项,2026-11-16):decisions 的语义等价判定与
 * mustNotAppear 的"复述 vs 否定性引用"复核。
 *
 * 为什么需要:C2 prompt 迭代后摘要保用户原语言(中文),确定性评分器的英文
 * evidence token 匹配系统性失灵,ASCII 实体通道又受 LLM 逐轮措辞方差影响
 * (数字锚点时有时无)——纯语义等价判定("决策是否在场,允许改写/翻译")本质
 * 需要理解,启发式两轮校准后已明确停止打补丁(防过拟合 sweep 样本,见
 * evals/reports/2026-11-15 评分器校准记录)。
 *
 * 分层纪律:score.ts 保持纯确定性函数不动;judge 结果作为覆盖层经
 * `applyJudgeVerdicts`(纯函数)合并——decisions 组 passed = 确定性通道 ∨
 * judge.covered;mustNotAppear 的否定性引用判定以 judge 复核覆盖启发式
 * (启发式仍先行:命中无否定词才交 judge,确定性可判的不花 LLM)。
 * LLM 调用器注入(同 gateway 形态),本模块零网络依赖、可测。
 *
 * @module @eterna/compaction/evals/judge
 */

import type { ScoreResult } from './score.ts'
import type { FactsSchema } from './facts.ts'

/** 判别任务冻结 prompt(system;英文——判别输出为 JSON,与摘要语言无关)。 */
export const JUDGE_SYSTEM_PROMPT = [
  'You are an evaluation judge for conversation-compaction summaries. You check whether a summary preserves the decisions made in a conversation. You output ONLY a JSON object.',
  '',
  'Task 1 — decisions: For each decision (given as claim + evidence from the source conversation), decide whether the SUMMARY conveys the same decision.',
  '- covered=true when the summary preserves the decision\'s outcome, its key parameters (numbers, identifiers, paths, actor constraints), and its rationale — paraphrase and translation are allowed (a Chinese summary covering an English evidence counts when the decision itself is intact).',
  '- covered=false when the summary omits the decision, changes its outcome, or loses a key parameter without which the decision can no longer be acted on.',
  'Task 2 — mustNotAppear: For each needle that literally appears in the summary, decide whether the summary RESTATES it as an accepted fact or instruction (restatement=true), or merely references it in a negated, quoted, or rejected context (restatement=false). Example: "预算基线 150000 不变,草稿的放宽数字一律不算数" references the needle while rejecting it → restatement=false.',
  '',
  'Respond with ONLY a JSON object, no markdown fence, matching exactly:',
  '{"decisions":[{"index":0,"covered":true,"reasoning":"one short sentence"}],"mustNotAppear":[{"needle":"verbatim needle","restatement":false,"reasoning":"one short sentence"}]}',
  'The mustNotAppear array must contain one entry per needle given, even when the needle does not appear in the summary (restatement=false, reasoning "absent").',
].join('\n')

/** judge 输出的一条 decision 判定。 */
export interface JudgeDecisionVerdict {
  readonly index: number
  readonly covered: boolean
  readonly reasoning: string
}

/** judge 输出的一条 mustNotAppear 判定。 */
export interface JudgeNeedleVerdict {
  readonly needle: string
  readonly restatement: boolean
  readonly reasoning: string
}

/** judge 判定全集(parseJudgeVerdict 的产出)。 */
export interface JudgeVerdict {
  readonly decisions: readonly JudgeDecisionVerdict[]
  readonly mustNotAppear: readonly JudgeNeedleVerdict[]
}

/** LLM 调用器注入面(输入组装好的 messages,返回模型文本)。 */
export type JudgeCaller = (messages: ReadonlyArray<{ role: 'system' | 'user'; content: string }>) => Promise<string>

/** 组装 judge 的 user 消息(摘要 + 待判定清单;纯函数,spec 钉关键段)。 */
export function buildJudgeMessages(summaryText: string, facts: FactsSchema): Array<{ role: 'system' | 'user'; content: string }> {
  const decisions = facts.decisions
    .map((decision, index) => `[${index}] claim: ${decision.claim}\n    evidence: ${decision.evidence}`)
    .join('\n')
  const needles = (facts.mustNotAppear ?? [])
    .map(needle => `- ${needle}`)
    .join('\n')
  const user = [
    'SUMMARY:',
    '<<<',
    summaryText,
    '>>>',
    '',
    'DECISIONS to judge:',
    decisions,
    '',
    'MUST-NOT-APPEAR needles to judge (for each, check whether it literally appears in the SUMMARY and whether that appearance is a restatement):',
    needles.length > 0 ? needles : '(none)',
  ].join('\n')
  return [
    { role: 'system', content: JUDGE_SYSTEM_PROMPT },
    { role: 'user', content: user },
  ]
}

/** 从模型文本提取 JSON 对象(容忍 ```json 围栏与前后散文;找不到即抛)。 */
function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced !== null ? fenced[1]! : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error(`judge output has no JSON object: ${text.slice(0, 120)}`)
  return JSON.parse(candidate.slice(start, end + 1)) as unknown
}

/** 解析并校验 judge 输出(结构/索引越界/字段类型 fail-loud——判别结果不宽容)。 */
export function parseJudgeVerdict(text: string, facts: FactsSchema): JudgeVerdict {
  const raw = extractJsonObject(text) as Record<string, unknown>
  if (!Array.isArray(raw.decisions)) throw new Error('judge output missing decisions array')
  if (!Array.isArray(raw.mustNotAppear)) throw new Error('judge output missing mustNotAppear array')
  const decisions = raw.decisions.map((entry, position) => {
    const record = entry as Record<string, unknown>
    const index = record.index
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= facts.decisions.length) {
      throw new Error(`judge decision[${position}] index out of range: ${String(index)}`)
    }
    if (typeof record.covered !== 'boolean') throw new Error(`judge decision[${index}] covered must be boolean`)
    return {
      index,
      covered: record.covered,
      reasoning: typeof record.reasoning === 'string' ? record.reasoning : '',
    }
  })
  const needles = facts.mustNotAppear ?? []
  const mustNotAppear = raw.mustNotAppear.map((entry, position) => {
    const record = entry as Record<string, unknown>
    const needle = record.needle
    if (typeof needle !== 'string' || !needles.includes(needle)) {
      throw new Error(`judge mustNotAppear[${position}] needle unknown: ${String(needle)}`)
    }
    if (typeof record.restatement !== 'boolean') throw new Error(`judge mustNotAppear[${position}] restatement must be boolean`)
    return { needle, restatement: record.restatement, reasoning: typeof record.reasoning === 'string' ? record.reasoning : '' }
  })
  return { decisions, mustNotAppear }
}

/**
 * 把 judge 判定合并进确定性评分结果(纯函数;不改 score.ts):
 * - decisions:row.passed |= judge.covered(covered 时 matchedVia='judge'——
 *   确定性已过的保持原通道标记;passedCount/ratio/violations 重算);
 * - mustNotAppear:judge restatement=false 的命中从 mustNotAppearHits 移入
 *   negatedHits(否定性引用合法);restatement=true 保持违规;
 *   未命中 needle 不动。judge 覆盖不改变 userVerbatim 等机械组。
 */
export function applyJudgeVerdicts(result: ScoreResult, verdict: JudgeVerdict): ScoreResult {
  const coveredByIndex = new Map(verdict.decisions.map(entry => [entry.index, entry]))
  const decisionRows = result.decisions.rows.map((row, index) => {
    const judge = coveredByIndex.get(index)
    if (judge === undefined || !judge.covered || row.passed) return row
    return { ...row, matchedVia: 'judge' as const, passed: true }
  })
  const passedCount = decisionRows.filter(row => row.passed).length
  const ratio = decisionRows.length === 0 ? 1 : passedCount / decisionRows.length
  const decisionsPassed = ratio >= result.decisions.min
  const restatementFree = new Set(verdict.mustNotAppear.filter(entry => !entry.restatement).map(entry => entry.needle))
  const promotedNegated = result.mustNotAppearHits.filter(needle => restatementFree.has(needle))
  const mustNotAppearHits = result.mustNotAppearHits.filter(needle => !restatementFree.has(needle))
  // violations 重写:旧 mustNotAppear/decisions 行整体作废,按合并后状态重算;
  // 其余机械组行原样保留。
  const rewrittenViolations = result.violations
    .filter(line => !line.startsWith('mustNotAppear hit(s):') && !line.startsWith('decisions '))
  if (mustNotAppearHits.length > 0) {
    rewrittenViolations.push(`mustNotAppear hit(s): ${mustNotAppearHits.join(' | ')}`)
  }
  if (!decisionsPassed) {
    rewrittenViolations.push(
      `decisions ${(ratio * 100).toFixed(1)}% < ${(result.decisions.min * 100).toFixed(0)}% `
      + `(${decisionRows.filter(row => !row.passed).map(row => `"${row.claim}"`).join(', ')})`,
    )
  }
  return {
    ...result,
    decisions: {
      rows: decisionRows,
      passedCount,
      ratio,
      min: result.decisions.min,
      passed: decisionsPassed,
    },
    mustNotAppearHits,
    negatedHits: [...result.negatedHits, ...promotedNegated],
    passed: rewrittenViolations.length === 0,
    violations: rewrittenViolations,
  }
}

/**
 * 网关 judge 工厂(照 gateway.ts 的直连形态;单发 chat,无 tools/stream)。
 * judge 模型独立于摘要模型可配——判别任务建议强模型,但首版与 sweep 同网关。
 */
export function createGatewayJudge(config: {
  baseUrl: string
  apiKey: string
  model: string
  maxTokens?: number
  timeoutMs?: number
}): { judge: JudgeCaller } {
  const judge: JudgeCaller = async (messages) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 300_000)
    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model: config.model, max_tokens: config.maxTokens ?? 4096, messages }),
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(`judge HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)
      }
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }
      if (payload.error !== undefined) throw new Error(`judge error: ${payload.error.message ?? 'unknown'}`)
      const content = payload.choices?.[0]?.message?.content ?? ''
      if (content.length === 0) throw new Error('judge returned empty content')
      return content
    } finally {
      clearTimeout(timeout)
    }
  }
  return { judge }
}

/** 单用例 judge 流程(组装→调用→解析;script-entry 与测试共用)。 */
export async function judgeGoldenCase(
  judge: JudgeCaller,
  summaryText: string,
  facts: FactsSchema,
): Promise<JudgeVerdict> {
  const messages = buildJudgeMessages(summaryText, facts)
  const text = await judge(messages)
  return parseJudgeVerdict(text, facts)
}
