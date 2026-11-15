/**
 * golden 报告生成(C4):CaseRunResult + gateway 观测 → 入库 markdown。
 * 纯函数;报告里只出现模型名/时延/token 数,不出现任何网关地址与密钥。
 *
 * @module @eterna/compaction/evals/report
 */

import type { CaseRunResult, GoldenCase } from './runner.ts'
import type { GatewayCallRecord } from './gateway.ts'
import type { ScoreResult } from './score.ts'

/** 一次 script 运行的输入。 */
export interface GoldenRunInput {
  /** 生成时间(ISO 8601)。 */
  readonly generatedAt: string
  /** 摘要模型(如 deepseek-flash)。 */
  readonly model: string
  readonly maxTokens: number
  /** 网关描述(不含地址与密钥,如 "liteLLM gateway(内网,.secrets/)")。 */
  readonly gateway: string
  /** 用例运行产物(顺序与 golden 目录序一致)。 */
  readonly records: Array<{ case: GoldenCase; run: CaseRunResult; calls: readonly GatewayCallRecord[] }>
}

/** 百分比格式(1 位小数)。 */
function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}

/** 召回组的表格行。 */
function recallLine(score: ScoreResult): string {
  const groups = [score.recall.userVerbatim, score.recall.filePaths, score.recall.errorStrings, score.recall.commands]
  return groups
    .map(group => `${group.name} ${group.hitCount}/${group.items.length} (${pct(group.recall)}${group.passed ? '' : ` ❌ < ${pct(group.min)}`})`)
    .join(' · ')
}

/** 单用例小节。 */
function caseSection(record: GoldenRunInput['records'][number]): string {
  const { case: goldenCase, run, calls } = record
  const lines: string[] = []
  lines.push(`### ${goldenCase.id}`)
  lines.push('')
  lines.push(`- 会话:${goldenCase.replay.surfaceSeqs.length} 个 surface 节点 / ${goldenCase.events.length} 行事件;遮蔽价 ${run.shadowedTokens ?? '—'} token`)
  if (run.ok) {
    lines.push(`- 压缩:checkpoint ${run.framedTokens} token,压缩比 ${run.score?.compaction.ratio === undefined ? '—' : `${run.score.compaction.ratio.toFixed(1)}×`};摘要调用 ${run.summaryCalls} 次${run.retryErrors.length > 0 ? `(recover 重试 ${run.retryErrors.length} 次:${run.retryErrors.join(' | ')})` : ''}`)
    const score = run.score!
    lines.push(`- 召回:${recallLine(score)}`)
    lines.push(`- decisions:${score.decisions.passedCount}/${score.decisions.rows.length} (${pct(score.decisions.ratio)})${score.decisions.passed ? '' : ` ❌ < ${pct(score.decisions.min)}`}`)
    lines.push(`- 结构:${score.structure.complete ? '8 段齐备' : `缺段 ❌ ${score.structure.missing.join(', ')}`}`)
    lines.push(`- mustNotAppear:${score.mustNotAppearHits.length === 0 ? '零命中' : `命中 ❌ ${score.mustNotAppearHits.join(' | ')}`}`)
    if (score.negatedHits.length > 0) lines.push(`- mustNotAppear 否定性引用(合法,披露):${score.negatedHits.join(' | ')}`)
    lines.push(`- unverified bullets(提示复核,不判死):${score.unverified.length === 0 ? '0' : ''}`)
    if (score.unverified.length > 0) {
      for (const bullet of score.unverified) lines.push(`  - [${bullet.section}] ${bullet.text}`)
    }
    const missing = [
      ...score.recall.userVerbatim.missing.map(item => `userVerbatim: ${item}`),
      ...score.recall.filePaths.missing.map(item => `filePaths: ${item}`),
      ...score.recall.errorStrings.missing.map(item => `errorStrings: ${item}`),
      ...score.recall.commands.missing.map(item => `commands: ${item}`),
    ]
    if (missing.length > 0) {
      lines.push(`- 未命中明细(${missing.length}):`)
      for (const item of missing) lines.push(`  - ${item}`)
    }
  } else {
    lines.push(`- ❌ 运行失败:${run.error ?? 'unknown'}`)
    if (run.retryErrors.length > 0) lines.push(`- recover 重试(${run.retryErrors.length}):${run.retryErrors.join(' | ')}`)
  }
  const elapsed = calls.reduce((total, call) => total + call.elapsedMs, 0)
  const tokens = calls.reduce((total, call) => total + (call.completionTokens ?? 0), 0)
  const reasoning = calls.reduce((total, call) => total + (call.reasoningTokens ?? 0), 0)
  lines.push(`- LLM 观测:耗时 ${(elapsed / 1000).toFixed(1)}s;completion ${tokens} token(reasoning ${reasoning})${calls.some(call => call.error !== undefined) ? `;调用错误:${calls.filter(call => call.error !== undefined).map(call => call.error).join(' | ')}` : ''}`)
  lines.push('')
  if (run.summaryText !== undefined) {
    lines.push('<details><summary>落盘的 checkpoint 摘要全文</summary>')
    lines.push('')
    lines.push('```markdown')
    lines.push(run.summaryText)
    lines.push('```')
    lines.push('')
    lines.push('</details>')
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * 构建入库报告(表格 + 每用例小节 + 门槛汇总)。
 * @param input - 运行输入(含 model/maxTokens/gateway 描述与逐用例产物)。
 * @returns 完整 markdown 文本。
 */
export function buildReportMarkdown(input: GoldenRunInput): string {
  const lines: string[] = []
  lines.push(`# golden 基线报告(${input.generatedAt.slice(0, 10)})`)
  lines.push('')
  lines.push(`- 生成时间:${input.generatedAt}`)
  lines.push(`- 摘要模型:\`${input.model}\`(max_tokens ${input.maxTokens};经 ${input.gateway} 直连,OpenAI 兼容 chat/completions)`)
  lines.push(`- 门槛(首版基线,22 号 §3-C4):userVerbatim 100% / filePaths·errorStrings·commands ≥90% / decisions ≥80% / 标题齐备 100%;mustNotAppear 零命中;unverified 只提示不判死`)
  lines.push(`- 用例:${input.records.length}(golden/ 目录序;--case 可过滤)`)
  lines.push('')
  lines.push('## 汇总')
  lines.push('')
  lines.push('| 用例 | 结果 | userVerbatim | filePaths | errorStrings | commands | decisions | 结构 | mustNotAppear | 压缩比 | 耗时 |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|')
  for (const { run, calls } of input.records) {
    const score = run.score
    const elapsed = calls.reduce((total, call) => total + call.elapsedMs, 0)
    lines.push([
      run.caseId,
      run.ok ? (score?.passed === true ? '✅ pass' : '❌ below-threshold') : '❌ error',
      score ? `${score.recall.userVerbatim.hitCount}/${score.recall.userVerbatim.items.length}` : '—',
      score ? `${score.recall.filePaths.hitCount}/${score.recall.filePaths.items.length}` : '—',
      score ? `${score.recall.errorStrings.hitCount}/${score.recall.errorStrings.items.length}` : '—',
      score ? `${score.recall.commands.hitCount}/${score.recall.commands.items.length}` : '—',
      score ? `${score.decisions.passedCount}/${score.decisions.rows.length}` : '—',
      score ? (score.structure.complete ? '齐备' : '缺段') : '—',
      score ? (score.mustNotAppearHits.length === 0 ? '0' : score.mustNotAppearHits.join('|')) : '—',
      score?.compaction.ratio === undefined ? '—' : `${score.compaction.ratio.toFixed(1)}×`,
      `${(elapsed / 1000).toFixed(1)}s`,
    ].join(' | '))
  }
  lines.push('')
  const passedCount = input.records.filter(record => record.run.ok && record.run.score?.passed === true).length
  lines.push(`**判定:${passedCount}/${input.records.length} 用例达到首版基线门槛。**`)
  lines.push('')
  lines.push('## 逐用例明细')
  lines.push('')
  for (const record of input.records) lines.push(caseSection(record))
  return lines.join('\n')
}
