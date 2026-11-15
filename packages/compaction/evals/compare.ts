/**
 * C8a 摘要模型对比(纯函数层):多模型 golden sweep 产物 → 聚合统计 → 对比报告
 * (召回/误报/结构/耗时/费用列)。与 runner/gateway 解耦:只消费
 * CaseRunResult + GatewayCallRecord,网络与 CLI 在 compare-entry.ts。
 *
 * 费用口径:内网 liteLLM 网关不暴露单价(/models 无 pricing、响应无 cost),
 * 费用列以 token 为代理(prompt+completion,reasoning 单列)——模型间相对消耗,
 * 非货币成本;报告里如实声明。
 *
 * 两段式产出:先 `--run` 全量 sweep(落 raw JSON 到 .cache/),后人工撰写结论,
 * 用 `--from-json <raw>` + `--conclusions-file` 重建最终报告——结论与数字必然
 * 来自同一次 sweep(raw 往返后报告逐字节一致,tests/evals-compare.spec.ts 钉死)。
 *
 * @module @eterna/compaction/evals/compare
 */

import type { CaseRunResult } from './runner.ts'
import type { GatewayCallRecord } from './gateway.ts'
import type { ScoreResult } from './score.ts'

/** 单模型一次 sweep 的输入(模型级失败时 records 为空、error 记原因)。 */
export interface ModelRunInput {
  readonly model: string
  readonly maxTokens: number
  readonly records: ReadonlyArray<{ run: CaseRunResult; calls: readonly GatewayCallRecord[] }>
  readonly error?: string
}

/** 对比报告的完整输入。 */
export interface CompareReportInput {
  readonly generatedAt: string
  readonly maxTokens: number
  /** 网关描述(不含地址与密钥)。 */
  readonly gateway: string
  /** 判定矩阵与分母用的规范用例清单(与 golden 目录序一致)。 */
  readonly caseIds: readonly string[]
  readonly models: readonly ModelRunInput[]
  /** 人工撰写的结论与建议默认档(markdown 行,嵌入报告尾部)。 */
  readonly conclusions?: readonly string[]
}

/** 单模型聚合统计(报告行 + 失分明细的数据源)。 */
export interface ModelAggregate {
  readonly model: string
  readonly maxTokens: number
  /** 模型级失败原因(网关不可达等);有 run 产物时缺省。 */
  readonly runError?: string
  /** 有 run 产物的用例数(模型级失败为 0)。 */
  readonly caseCount: number
  readonly passedCount: number
  readonly belowCount: number
  readonly errorCount: number
  /** 五组召回的累计 hit/total(run 级 error 用例不计入分母)。 */
  readonly recall: {
    readonly userVerbatim: readonly [number, number]
    readonly filePaths: readonly [number, number]
    readonly errorStrings: readonly [number, number]
    readonly commands: readonly [number, number]
    readonly decisions: readonly [number, number]
  }
  /** 误报直接证据:mustNotAppear 命中累计。 */
  readonly mustNotAppearHits: number
  /** 误报待复核:unverified bullet 累计。 */
  readonly unverifiedBullets: number
  /** 结构齐备的用例数。 */
  readonly structureComplete: number
  /** 有 ratio 产出的用例的压缩比均值(shadowed/framed)。 */
  readonly meanCompactionRatio?: number
  readonly elapsedMs: number
  readonly callCount: number
  readonly promptTokens?: number
  readonly completionTokens?: number
  readonly reasoningTokens?: number
}

const RECALL_KEYS = ['userVerbatim', 'filePaths', 'errorStrings', 'commands'] as const

/** 五组召回累计(run 级 error 用例不进分母;decisions 走 rows)。 */
function sumRecall(scored: readonly ScoreResult[]): ModelAggregate['recall'] {
  const empty: [number, number] = [0, 0]
  const sums = {
    userVerbatim: [...empty],
    filePaths: [...empty],
    errorStrings: [...empty],
    commands: [...empty],
    decisions: [...empty],
  } as Record<keyof ModelAggregate['recall'], [number, number]>
  for (const score of scored) {
    for (const key of RECALL_KEYS) {
      sums[key][0] += score.recall[key].hitCount
      sums[key][1] += score.recall[key].items.length
    }
    sums.decisions[0] += score.decisions.passedCount
    sums.decisions[1] += score.decisions.rows.length
  }
  return {
    userVerbatim: [...sums.userVerbatim],
    filePaths: [...sums.filePaths],
    errorStrings: [...sums.errorStrings],
    commands: [...sums.commands],
    decisions: [...sums.decisions],
  } as ModelAggregate['recall']
}

/** 聚合单模型 sweep 产物:全量求和/计数,零分母防 NaN。 */
export function aggregateModelRun(input: ModelRunInput): ModelAggregate {
  const scored: ScoreResult[] = []
  let passedCount = 0
  let belowCount = 0
  let errorCount = 0
  let mustNotAppearHits = 0
  let unverifiedBullets = 0
  let structureComplete = 0
  let elapsedMs = 0
  let callCount = 0
  let promptTokens: number | undefined
  let completionTokens: number | undefined
  let reasoningTokens: number | undefined
  const ratios: number[] = []

  for (const { run, calls } of input.records) {
    if (run.ok && run.score !== undefined) {
      scored.push(run.score)
      if (run.score.passed) passedCount += 1
      else belowCount += 1
      mustNotAppearHits += run.score.mustNotAppearHits.length
      unverifiedBullets += run.score.unverified.length
      if (run.score.structure.complete) structureComplete += 1
      const ratio = run.score.compaction.ratio
      if (ratio !== undefined) ratios.push(ratio)
    } else {
      errorCount += 1
    }
    for (const call of calls) {
      elapsedMs += call.elapsedMs
      callCount += 1
      if (call.promptTokens !== undefined) promptTokens = (promptTokens ?? 0) + call.promptTokens
      if (call.completionTokens !== undefined) completionTokens = (completionTokens ?? 0) + call.completionTokens
      if (call.reasoningTokens !== undefined) reasoningTokens = (reasoningTokens ?? 0) + call.reasoningTokens
    }
  }

  return {
    model: input.model,
    maxTokens: input.maxTokens,
    ...(input.error === undefined ? {} : { runError: input.error }),
    caseCount: input.records.length,
    passedCount,
    belowCount,
    errorCount,
    recall: sumRecall(scored),
    mustNotAppearHits,
    unverifiedBullets,
    structureComplete,
    ...(ratios.length === 0 ? {} : { meanCompactionRatio: ratios.reduce((a, b) => a + b, 0) / ratios.length }),
    elapsedMs,
    callCount,
    ...(promptTokens === undefined ? {} : { promptTokens }),
    ...(completionTokens === undefined ? {} : { completionTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
  }
}

// ---------------------------------------------------------------------------
// 报告生成
// ---------------------------------------------------------------------------

/** 千分位整数( locale 无关,保证报告逐字节可复现)。 */
function formatInt(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

/** 召回单元格:五组累计 `hit/total`,中点分隔。 */
function recallCell(agg: ModelAggregate): string {
  const r = agg.recall
  return [r.userVerbatim, r.filePaths, r.errorStrings, r.commands, r.decisions]
    .map(([hit, total]) => `${hit}/${total}`)
    .join(' · ')
}

/** 费用单元格:`prompt+completion tok(reasoning n)`;无 usage → '—'。 */
function costCell(agg: ModelAggregate): string {
  if (agg.promptTokens === undefined && agg.completionTokens === undefined) return '—'
  const base = `${formatInt(agg.promptTokens ?? 0)}+${formatInt(agg.completionTokens ?? 0)} tok`
  return agg.reasoningTokens === undefined ? base : `${base}(reasoning ${formatInt(agg.reasoningTokens)})`
}

/** 耗时单元格:`合计 / 均值(按有产出的用例数)`;无调用 → '—'。 */
function elapsedCell(agg: ModelAggregate, denominator: number): string {
  if (agg.callCount === 0) return '—'
  const mean = denominator > 0 ? agg.elapsedMs / denominator : agg.elapsedMs
  return `${formatSeconds(agg.elapsedMs)} / ${formatSeconds(mean)}`
}

/** 判定矩阵单元格。 */
function matrixCell(caseId: string, input: ModelRunInput): string {
  const record = input.records.find(entry => entry.run.caseId === caseId)
  if (record === undefined) return '—'
  if (!record.run.ok) return '💥'
  return record.run.score?.passed === true ? '✅' : '❌'
}

/** 判定矩阵的行(单用例跨模型)。 */
function matrixRows(caseId: string, models: readonly ModelRunInput[]): string {
  return `| ${caseId} | ${models.map(model => matrixCell(caseId, model)).join(' | ')} |`
}

/** 逐模型失分明细小节(below-threshold 的 violations 与 run error 逐条)。 */
function modelDetailSection(agg: ModelAggregate, input: ModelRunInput): string {
  const lines: string[] = []
  lines.push(`### ${input.error === undefined ? agg.model : `💥 ${agg.model}`}`)
  lines.push('')
  lines.push(
    `- LLM 调用 ${agg.callCount} 次;耗时 ${formatSeconds(agg.elapsedMs)};费用 ${costCell(agg)}`
    + `${agg.meanCompactionRatio === undefined ? '' : `;压缩比均值 ${agg.meanCompactionRatio.toFixed(1)}×`}`,
  )
  if (input.error !== undefined) {
    lines.push(`- 模型级失败:${input.error}`)
    lines.push('')
    return lines.join('\n')
  }
  const losses: string[] = []
  for (const { run } of input.records) {
    if (!run.ok) {
      losses.push(`- ${run.caseId}(run error):${run.error ?? 'unknown'}`)
      continue
    }
    if (run.score !== undefined && !run.score.passed) {
      losses.push(`- ${run.caseId}(below-threshold):${run.score.violations.join(' ; ') || '(no violations recorded)'}`)
    }
  }
  lines.push(losses.length === 0 ? '- 无失分用例' : '- 失分/错误:')
  for (const loss of losses) lines.push(loss)
  lines.push('')
  return lines.join('\n')
}

/**
 * 构建 C8a 对比报告:头部口径声明 → 五列对比表 → 判定矩阵 → 失分明细 →
 * [人工结论] → 方法节。纯函数;不含任何网关地址与密钥。
 */
export function buildModelComparisonReport(input: CompareReportInput): string {
  const aggregates = input.models.map(aggregateModelRun)
  const lines: string[] = []

  lines.push(`# 摘要模型对比报告(C8a,${input.generatedAt.slice(0, 10)})`)
  lines.push('')
  lines.push(`- 生成时间:${input.generatedAt}`)
  lines.push(`- 候选:${input.models.length} 个(max_tokens ${input.maxTokens};经 ${input.gateway} 直连,OpenAI 兼容 chat/completions):${input.models.map(model => `\`${model.model}\``).join('、')}`)
  lines.push(`- 基线:\`deepseek-flash\` 为会话当前模型档(profiles/eterna-embed base 树 model:66;eterna-web 未落 summarizationProvider/Model 键,C8b 待 21 号 Q1 拍板),其余为低成本/高质量候选`)
  lines.push(`- 门槛:首版基线(同 golden 基线报告):userVerbatim 100% / filePaths·errorStrings·commands ≥90% / decisions ≥80% / 标题齐备 100%;mustNotAppear 零命中;unverified 只提示不判死`)
  lines.push(`- 费用口径:内网网关不暴露单价,费用列以 token 为代理(prompt+completion;reasoning 单列)——模型间相对消耗,非货币成本`)
  lines.push('')

  lines.push('## 模型对比(召回/误报/结构/耗时/费用)')
  lines.push('')
  lines.push('| 模型 | 达标 | 召回(userVerbatim·filePaths·errorStrings·commands·decisions) | 误报(必不现/unverified) | 结构 | 压缩比均值 | 耗时(合计/均) | 费用(prompt+completion,reasoning) |')
  lines.push('|---|---|---|---|---|---|---|---|')
  for (const agg of aggregates) {
    const total = input.caseIds.length
    lines.push([
      `${input.models.find(model => model.model === agg.model)?.error === undefined ? '' : '💥 '}${agg.model}`,
      `${agg.passedCount}/${total}(${agg.belowCount} below,${agg.errorCount} error)`,
      recallCell(agg),
      `${agg.mustNotAppearHits} / ${agg.unverifiedBullets}`,
      `${agg.structureComplete}/${total}`,
      agg.meanCompactionRatio === undefined ? '—' : `${agg.meanCompactionRatio.toFixed(1)}×`,
      elapsedCell(agg, total),
      costCell(agg),
    ].map(cell => cell.replace(/\|/g, '\\|')).join(' | ').replace(/^/, '| ') + ' |')
  }
  lines.push('')

  lines.push('## 用例 × 模型判定矩阵')
  lines.push('')
  lines.push(`| 用例 | ${input.models.map(model => model.model).join(' | ')} |`)
  lines.push(`|---|${input.models.map(() => '---').join('|')}|`)
  for (const caseId of input.caseIds) lines.push(matrixRows(caseId, input.models))
  lines.push('')

  lines.push('## 逐模型失分明细')
  lines.push('')
  for (const [index, agg] of aggregates.entries()) {
    lines.push(modelDetailSection(agg, input.models[index]!))
  }

  if (input.conclusions !== undefined && input.conclusions.length > 0) {
    lines.push(...input.conclusions)
    if ((input.conclusions[input.conclusions.length - 1] ?? '').length > 0) lines.push('')
  }

  lines.push('## 方法与口径')
  lines.push('')
  lines.push(`- 每候选全量重跑 ${input.caseIds.length} 个 golden 用例(runGoldenCase 走真实 compactSurfaceRegion 事务,评分器同 golden 基线);候选清单来自网关 /models(勘察 S'-2),CLI \`--models\` 可收窄。`)
  lines.push('- 摘要生成有抽样随机性(生产同款,不设 temperature),逐次数值有波动;模型间对比与回归以同一次 sweep 的全量重跑为准,不比较跨 sweep 单次小差异。')
  lines.push('- 回归纪律:COMPACTION_INSTRUCTION/阈值/模板变更与后续模型对比,按 evals/README 全量重跑并附报告。')
  lines.push('')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// raw JSON 往返(两段式产出:先落 raw,后补结论重建)
// ---------------------------------------------------------------------------

/** raw JSON 非法。 */
export class CompareRawError extends Error {
  override name = 'CompareRawError'
}

/** 序列化 sweep 产物(含结论;落 .cache/ 或 --raw-json-out)。 */
export function serializeCompareRaw(input: CompareReportInput): string {
  return JSON.stringify(input, null, 2)
}

/** 非空字符串断言,返回违规文案。 */
function requireString(value: unknown, path: string): string[] {
  return typeof value === 'string' && value.length > 0 ? [] : [`${path} must be a non-empty string`]
}

/** 非空字符串数组断言。 */
function requireStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) return [`${path} must be an array`]
  return value.every(item => typeof item === 'string') ? [] : [`${path} items must be strings`]
}

/**
 * 解析并校验 raw JSON(最低限度结构校验——写入方是同仓 compare-entry,深校验
 * 由评分器/事务自身保证)。违规聚合进一条 CompareRawError。
 */
export function parseCompareRaw(text: string): CompareReportInput {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new CompareRawError(`compare raw JSON: invalid JSON(${(error as Error).message})`)
  }
  const violations: string[] = []
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CompareRawError('compare raw JSON must be an object')
  }
  const record = parsed as Record<string, unknown>
  violations.push(...requireString(record.generatedAt, 'generatedAt'))
  if (typeof record.maxTokens !== 'number' || !Number.isInteger(record.maxTokens) || record.maxTokens <= 0) {
    violations.push('maxTokens must be a positive integer')
  }
  violations.push(...requireString(record.gateway, 'gateway'))
  if (!Array.isArray(record.caseIds) || record.caseIds.length === 0 || !record.caseIds.every(id => typeof id === 'string' && id.length > 0)) {
    violations.push('caseIds must be a non-empty array of strings')
  }
  if (!Array.isArray(record.models)) {
    violations.push('models must be an array')
  } else {
    for (const [index, model] of record.models.entries()) {
      if (typeof model !== 'object' || model === null || Array.isArray(model)) {
        violations.push(`models[${index}] must be an object`)
        continue
      }
      const entry = model as Record<string, unknown>
      violations.push(...requireString(entry.model, `models[${index}].model`))
      if (typeof entry.maxTokens !== 'number') violations.push(`models[${index}].maxTokens must be a number`)
      if (!Array.isArray(entry.records)) {
        violations.push(`models[${index}].records must be an array`)
      } else {
        for (const [rIndex, item] of entry.records.entries()) {
          if (typeof item !== 'object' || item === null || Array.isArray(item)) {
            violations.push(`models[${index}].records[${rIndex}] must be an object with run and calls`)
            continue
          }
          const pair = item as Record<string, unknown>
          if (typeof pair.run !== 'object' || pair.run === null) violations.push(`models[${index}].records[${rIndex}].run must be an object`)
          if (!Array.isArray(pair.calls)) violations.push(`models[${index}].records[${rIndex}].calls must be an array`)
        }
      }
      if (entry.error !== undefined && typeof entry.error !== 'string') violations.push(`models[${index}].error must be a string`)
    }
  }
  if (record.conclusions !== undefined) violations.push(...requireStringArray(record.conclusions, 'conclusions'))
  if (violations.length > 0) throw new CompareRawError(`compare raw JSON: ${violations.join('; ')}`)

  return {
    generatedAt: record.generatedAt as string,
    maxTokens: record.maxTokens as number,
    gateway: record.gateway as string,
    caseIds: record.caseIds as string[],
    models: (record.models as Array<Record<string, unknown>>).map(entry => ({
      model: entry.model as string,
      maxTokens: entry.maxTokens as number,
      records: (entry.records as Array<Record<string, unknown>>).map(item => ({
        run: item.run as CaseRunResult,
        calls: item.calls as GatewayCallRecord[],
      })),
      ...(entry.error === undefined ? {} : { error: entry.error as string }),
    })),
    ...(record.conclusions === undefined ? {} : { conclusions: record.conclusions as string[] }),
  }
}
