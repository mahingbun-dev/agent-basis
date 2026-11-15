/**
 * run-golden.mjs 的入口逻辑(C4;由 scripts/run-golden.mjs 用 esbuild 打包后
 * 动态 import——summarizer.ts 含参数属性,node strip-only 擦除不能直载)。
 *
 * CLI:`node packages/compaction/scripts/run-golden.mjs [--model <model>]
 *   [--case <id>] [--max-tokens <n>] [--out <path>] [--no-fail]`
 *
 * 流程:读 .secrets(litellm-base-url/litellm-master-key,不进 argv/日志)→
 * 逐用例 loadGoldenCase → createGatewaySummarizer(真实 LLM)→ runGoldenCase(全真
 * region 事务)→ scoreSummary → buildReportMarkdown → 写 reports/。退出码:有
 * 用例失败或低于门槛即 1(--no-fail 只影响退出码,报告照写)。
 *
 * @module @eterna/compaction/evals/script-entry
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createGatewaySummarizer } from './gateway.ts'
import { applyJudgeVerdicts, createGatewayJudge, judgeGoldenCase } from './judge.ts'
import { buildReportMarkdown } from './report.ts'
import { loadGoldenCase, listGoldenCases, runGoldenCase } from './runner.ts'

/** 命令行参数(run-golden.mjs 解析后传入)。 */
export interface ScriptArgs {
  /** repo 根(run-golden.mjs 依自身 URL 计算)。 */
  repoRoot: string
  model?: string
  caseId?: string
  maxTokens?: number
  out?: string
  noFail?: boolean
  /** 启用 LLM judge 层(decisions 语义判定 + mustNotAppear 复核;需网关凭据)。 */
  judge?: boolean
  /** judge 模型(缺省与摘要模型同档;判别任务可配强模型)。 */
  judgeModel?: string
}

/** 从 .secrets 读凭据文件(去尾部换行;缺失即抛,不回退、不打印内容)。 */
function readSecret(repoRoot: string, name: string): string {
  const path = join(repoRoot, '.secrets', name)
  try {
    const content = readFileSync(path, 'utf8').trim()
    if (content.length === 0) throw new Error('empty file')
    return content
  } catch (error: unknown) {
    throw new Error(`missing/unreadable .secrets/${name}(${(error as Error).message}); golden LLM 直连需要 liteLLM 网关凭据`)
  }
}

export interface ScriptOutcome {
  readonly reportPath: string
  readonly ok: boolean
  readonly summary: string
}

export async function main(args: ScriptArgs): Promise<ScriptOutcome> {
  const packageDir = join(args.repoRoot, 'packages', 'compaction')
  const evalsDir = join(packageDir, 'evals')
  const goldenDir = join(evalsDir, 'golden')
  const model = args.model ?? 'deepseek-flash'
  const maxTokens = args.maxTokens ?? 8192

  const baseUrl = readSecret(args.repoRoot, 'litellm-base-url.txt')
  const apiKey = readSecret(args.repoRoot, 'litellm-master-key.txt')

  const caseIds = args.caseId === undefined
    ? listGoldenCases(goldenDir)
    : [args.caseId]
  for (const id of caseIds) {
    if (!listGoldenCases(goldenDir).includes(id)) {
      throw new Error(`unknown case "${id}"; available: ${listGoldenCases(goldenDir).join(', ')}`)
    }
  }

  const records: Array<Parameters<typeof buildReportMarkdown>[0]['records'][number]> = []
  const judgeModel = args.judgeModel ?? model
  const { judge } = args.judge === true
    ? createGatewayJudge({ baseUrl, apiKey, model: judgeModel })
    : { judge: undefined }
  for (const id of caseIds) {
    const goldenCase = loadGoldenCase(join(goldenDir, id), id)
    const { summarize, calls } = createGatewaySummarizer({ baseUrl, apiKey, model, maxTokens })
    process.stdout.write(`[run-golden] ${id}: summarizing with ${model} (max_tokens ${maxTokens}) ...\n`)
    const run = await runGoldenCase(goldenCase, summarize)
    // judge 覆盖层(22 号 §3-C4):仅对确定性未达标的用例调用(达标不花 LLM)。
    // decisions 语义判定 + mustNotAppear 复核;合并后 verdict 按 merged 判定。
    if (judge !== undefined && run.ok && run.score !== undefined && run.score.passed !== true
      && run.summaryText !== undefined) {
      process.stdout.write(`[run-golden] ${id}: judge reviewing with ${judgeModel} ...\n`)
      const judgeVerdict = await judgeGoldenCase(judge, run.summaryText, goldenCase.facts)
      run.score = applyJudgeVerdicts(run.score, judgeVerdict)
      process.stdout.write(`[run-golden] ${id}: judge merged → ${run.score.passed ? 'PASS' : 'BELOW-THRESHOLD'}\n`)
    }
    records.push({ case: goldenCase, run, calls })
    const verdict = run.ok
      ? run.score?.passed === true ? 'PASS' : 'BELOW-THRESHOLD'
      : 'ERROR'
    process.stdout.write(`[run-golden] ${id}: ${verdict}${run.error === undefined ? '' : ` — ${run.error}`}\n`)
  }

  const report = buildReportMarkdown({
    generatedAt: new Date().toISOString(),
    model,
    maxTokens,
    gateway: `liteLLM gateway(内网;base URL 与 key 见 .secrets/,不入库)${args.judge === true ? `;judge=${judgeModel}` : ''}`,
    records,
  })
  const outPath = args.out === undefined
    ? join(evalsDir, 'reports', `${new Date().toISOString().slice(0, 10)}-golden-${model}.md`)
    : resolve(args.out)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, report)

  const ok = records.every(record => record.run.ok && record.run.score?.passed === true)
  const passedCount = records.filter(record => record.run.ok && record.run.score?.passed === true).length
  return {
    reportPath: outPath,
    ok: ok || args.noFail === true,
    summary: `${passedCount}/${records.length} 用例达门槛;报告:${outPath}`,
  }
}
