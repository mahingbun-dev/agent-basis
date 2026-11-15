/**
 * run-compare.mjs 的入口逻辑(C8a;由 evals/run-compare.mjs 用 esbuild 打包后
 * 动态 import——与 run-golden.mjs 同因:summarizer.ts 含参数属性,node strip-only
 * 擦除不能直载)。
 *
 * CLI:`node packages/compaction/evals/run-compare.mjs [--models a,b,c]
 *   [--cases id,id] [--max-tokens n] [--out path] [--raw-json-out path]
 *   [--from-json path] [--conclusions-file path] [--no-fail]`
 *
 * 两段式产出(报告数字与结论必须同源):
 * 1. sweep:默认对网关 /models 全量候选逐模型跑全部 golden 用例(runGoldenCase
 *    真实 region 事务),产物落 raw JSON(--raw-json-out,缺省 evals/.cache/
 *    compare-raw-<ts>.json,gitignored)并生成数据报告(--out,缺省
 *    evals/reports/<date>-summary-model.md);
 * 2. 重建:人工撰写结论(建议默认档)存临时 md 后,`--from-json <raw>
 *    --conclusions-file <md>` 从同一次 sweep 重建最终报告(不重跑,数字不变)。
 *
 * 凭据:运行时读 .secrets/(同 run-golden),不写 argv/日志/报告。
 * 退出码:任何 run 级/模型级错误即 1(below-threshold 是合法对比数据,不算失败);
 * --no-fail 只影响退出码。
 *
 * @module @eterna/compaction/evals/compare-entry
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { aggregateModelRun, buildModelComparisonReport, parseCompareRaw, serializeCompareRaw } from './compare.ts'
import type { CompareReportInput, ModelRunInput } from './compare.ts'
import { createGatewaySummarizer } from './gateway.ts'
import { listGoldenCases, loadGoldenCase, runGoldenCase } from './runner.ts'

/** 命令行参数(run-compare.mjs 解析后传入)。 */
export interface CompareArgs {
  /** repo 根(run-compare.mjs 依自身 URL 计算)。 */
  repoRoot: string
  /** 逗号分隔候选模型;缺省 = 网关 /models 全量。 */
  models?: string
  /** 逗号分隔用例 id;缺省 = golden 目录全量。 */
  cases?: string
  maxTokens?: number
  out?: string
  rawJsonOut?: string
  fromJson?: string
  conclusionsFile?: string
  noFail?: boolean
}

export interface CompareOutcome {
  readonly reportPath: string
  readonly rawJsonPath?: string
  readonly ok: boolean
  readonly summary: string
}

/** 从 .secrets 读凭据文件(去尾部换行;缺失即抛,不回退、不打印内容)。 */
function readSecret(repoRoot: string, name: string): string {
  const path = join(repoRoot, '.secrets', name)
  try {
    const content = readFileSync(path, 'utf8').trim()
    if (content.length === 0) throw new Error('empty file')
    return content
  } catch (error: unknown) {
    throw new Error(`missing/unreadable .secrets/${name}(${(error as Error).message}); C8a 模型对比需要 liteLLM 网关凭据`)
  }
}

/** 查网关 /models 拿候选清单(报错不含地址与密钥)。 */
async function listGatewayModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = await response.json() as { data?: Array<{ id?: string }> }
    const ids = (payload.data ?? []).map(entry => entry.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
    if (ids.length === 0) throw new Error('empty model list')
    return ids
  } catch (error: unknown) {
    throw new Error(`gateway /models 不可达(${error instanceof Error ? error.message : String(error)})`)
  } finally {
    clearTimeout(timeout)
  }
}

/** 读结论文件(人工撰写;缺文件即抛,避免静默产出无结论报告)。 */
function readConclusions(path: string | undefined): string[] | undefined {
  if (path === undefined) return undefined
  const text = readFileSync(path, 'utf8')
  if (text.trim().length === 0) throw new Error(`conclusions file is empty: ${path}`)
  return text.replace(/\s+$/, '').split('\n')
}

function splitList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined
  const items = value.split(',').map(item => item.trim()).filter(item => item.length > 0)
  return items.length === 0 ? undefined : items
}

export async function main(args: CompareArgs): Promise<CompareOutcome> {
  const packageDir = join(args.repoRoot, 'packages', 'compaction')
  const evalsDir = join(packageDir, 'evals')
  const goldenDir = join(evalsDir, 'golden')
  const maxTokens = args.maxTokens ?? 8192
  const generatedAt = new Date().toISOString()

  // 重建路径:raw JSON + 结论 → 最终报告(不触网、不重跑)。
  if (args.fromJson !== undefined) {
    const input = parseCompareRaw(readFileSync(resolve(args.fromJson), 'utf8'))
    const conclusions = readConclusions(args.conclusionsFile)
    const report = buildModelComparisonReport({ ...input, ...(conclusions === undefined ? {} : { conclusions }) })
    const outPath = args.out === undefined
      ? join(evalsDir, 'reports', `${generatedAt.slice(0, 10)}-summary-model.md`)
      : resolve(args.out)
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, report)
    const passedTotal = input.models.reduce((sum, model) => sum + aggregateModelRun(model).passedCount, 0)
    return {
      reportPath: outPath,
      ok: true,
      summary: `已从 ${args.fromJson} 重建报告(${input.models.length} 候选 / ${input.caseIds.length} 用例 / 达标 ${passedTotal} 用例次;${conclusions === undefined ? '无结论节' : '含结论'}):${outPath}`,
    }
  }

  // sweep 路径:逐模型全量跑 golden。
  const baseUrl = readSecret(args.repoRoot, 'litellm-base-url.txt')
  const apiKey = readSecret(args.repoRoot, 'litellm-master-key.txt')

  const available = await listGatewayModels(baseUrl, apiKey)
  const requestedModels = splitList(args.models) ?? available
  for (const model of requestedModels) {
    if (!available.includes(model)) {
      throw new Error(`unknown model "${model}"; gateway offers: ${available.join(', ')}`)
    }
  }

  const allCaseIds = listGoldenCases(goldenDir)
  const caseIds = splitList(args.cases) ?? allCaseIds
  for (const id of caseIds) {
    if (!allCaseIds.includes(id)) {
      throw new Error(`unknown case "${id}"; available: ${allCaseIds.join(', ')}`)
    }
  }

  const models: ModelRunInput[] = []
  for (const model of requestedModels) {
    const { summarize, calls } = createGatewaySummarizer({ baseUrl, apiKey, model, maxTokens })
    const records: ModelRunInput['records'] = []
    let modelError: string | undefined
    try {
      for (const id of caseIds) {
        // 每次运行全新装载:region 事务会替换 surface,用例不可跨运行复用
        // (与 tests/evals-golden.spec.ts 的 loadCase 同一纪律)。
        const goldenCase = loadGoldenCase(join(goldenDir, id), id)
        process.stdout.write(`[run-compare] ${model} × ${id}: summarizing (max_tokens ${maxTokens}) ...\n`)
        const run = await runGoldenCase(goldenCase, summarize)
        records.push({ run, calls })
        const verdict = run.ok ? (run.score?.passed === true ? 'PASS' : 'BELOW-THRESHOLD') : 'ERROR'
        process.stdout.write(`[run-compare] ${model} × ${id}: ${verdict}${run.error === undefined ? '' : ` — ${run.error}`}\n`)
      }
    } catch (error: unknown) {
      // 单模型崩溃(网关整体不可达等)不拖垮其余候选:记模型级失败继续。
      modelError = error instanceof Error ? error.message : String(error)
      process.stdout.write(`[run-compare] ${model}: model-level failure — ${modelError}\n`)
    }
    models.push({ model, maxTokens, records, ...(modelError === undefined ? {} : { error: modelError }) })
  }

  const rawInput: CompareReportInput = {
    generatedAt,
    maxTokens,
    gateway: 'liteLLM gateway(内网;base URL 与 key 见 .secrets/,不入库)',
    caseIds,
    models,
  }
  const rawJsonPath = args.rawJsonOut === undefined
    ? join(evalsDir, '.cache', `compare-raw-${Date.now()}.json`)
    : resolve(args.rawJsonOut)
  mkdirSync(dirname(rawJsonPath), { recursive: true })
  writeFileSync(rawJsonPath, serializeCompareRaw(rawInput))

  const report = buildModelComparisonReport(rawInput)
  const outPath = args.out === undefined
    ? join(evalsDir, 'reports', `${generatedAt.slice(0, 10)}-summary-model.md`)
    : resolve(args.out)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, report)

  const modelFailures = models.filter(model => model.error !== undefined).length
  const runFailures = models.reduce((sum, model) => sum + model.records.filter(({ run }) => !run.ok).length, 0)
  const passedTotal = models.reduce((sum, model) => sum + model.records.filter(({ run }) => run.ok && run.score?.passed === true).length, 0)
  return {
    reportPath: outPath,
    rawJsonPath,
    ok: (modelFailures === 0 && runFailures === 0) || args.noFail === true,
    summary: `${models.length} 候选 × ${caseIds.length} 用例:达标 ${passedTotal} 用例次,run 错误 ${runFailures},模型级失败 ${modelFailures};raw JSON:${rawJsonPath};报告:${outPath}`,
  }
}
