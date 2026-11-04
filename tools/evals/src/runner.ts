/**
 * 运行器:loadPackCases → 过滤(subset=tag / 单 case)→ 逐 case 起适配器 →
 * answer/trajectory/budget/final_state 四组断言 → CaseResult 汇总 → 落盘
 * report.md + sessions.jsonl。单 case 的 harness 失败被捕获为该 case 的
 * 失败明细(分类 harness),不拖垮整包(设计文档 14 §4 韧性规则)。
 */
import * as path from 'node:path'
import { loadPackCases } from './schema.ts'
import { summarize } from './events.ts'
import { assertAnswer, assertBudget } from './budget.ts'
import { assertFinalState } from './finalState.ts'
import { assertTrajectory } from './trajectory.ts'
import { renderReport } from './report.ts'
import { sessionsLines } from './sessions.ts'
import { ensureBuiltinAdapters, getAdapter } from './adapters/registry.ts'
import type { AcpAdapterOptions } from './adapters/acp.ts'
import type { CaseResult, FailureDetail, GoldenCase, PackRunResult } from './types.ts'

export interface RunPackOptions {
  readonly packDir: string
  /** 强制指定适配器;缺省用 case.adapter ?? 'replay'。 */
  readonly adapterId?: string
  /** 按 tag 过滤(--subset smoke)。 */
  readonly subset?: string
  /** 只跑一个 case(--case id)。 */
  readonly caseId?: string
  /** 产物目录;report.md / sessions.jsonl / workspaces/ 写到这里。 */
  readonly outDir: string
  readonly acpOptions?: AcpAdapterOptions
}

export async function runPack(options: RunPackOptions): Promise<PackRunResult> {
  ensureBuiltinAdapters(options.acpOptions === undefined ? undefined : { acp: options.acpOptions })
  const startedMs = Date.now()
  const startedAt = new Date(startedMs).toISOString()
  const { cases, loadErrors } = await loadPackCases(options.packDir)
  const selected = cases.filter((caseData) => {
    if (options.caseId !== undefined) return caseData.id === options.caseId
    if (options.subset !== undefined) return caseData.tags.includes(options.subset)
    return true
  })
  const results: CaseResult[] = []
  for (const caseData of selected) {
    results.push(await runCase(caseData, options))
  }
  const packResult: PackRunResult = {
    packDir: path.resolve(options.packDir),
    adapterId: options.adapterId ?? 'auto',
    ...(options.subset === undefined ? {} : { subset: options.subset }),
    startedAt,
    durationMs: Date.now() - startedMs,
    results,
    loadErrors,
  }
  await writeArtifacts(packResult, options.outDir)
  return packResult
}

async function runCase(caseData: GoldenCase, options: RunPackOptions): Promise<CaseResult> {
  const adapterId = options.adapterId ?? caseData.adapter ?? 'replay'
  const workspaceDir = path.join(options.outDir, 'workspaces', caseData.id)
  const startMs = Date.now()
  await resetDir(workspaceDir)
  let sessionRef = ''
  let finalAnswerText = ''
  let notes: readonly string[] = []
  let failures: FailureDetail[] = []
  let metrics = { turns: 0, steps: 0, toolCalls: [] as string[], totalTokens: 0, approvalAsks: 0, eventCount: 0 }
  try {
    const adapter = getAdapter(adapterId)
    const run = await adapter.run({ caseData, packDir: options.packDir, workspaceDir })
    sessionRef = run.sessionRef
    finalAnswerText = run.finalAnswerText
    notes = run.notes ?? []
    const summary = summarize(run.events)
    metrics = {
      turns: summary.turns,
      steps: summary.steps,
      toolCalls: summary.toolCalls.map(call => call.name),
      totalTokens: summary.totalTokens,
      approvalAsks: summary.approvalsAsked.length,
      eventCount: summary.eventCount,
    }
    failures = [
      ...assertAnswer(caseData.answer, finalAnswerText),
      ...assertTrajectory(caseData.trajectory, summary),
      ...assertBudget(caseData.budget, summary),
      ...await assertFinalState(caseData.final_state, summary, workspaceDir),
    ]
  } catch (cause) {
    failures = [{ category: 'harness', message: cause instanceof Error ? cause.message : String(cause) }]
  }
  return {
    caseData,
    adapterId,
    status: failures.length === 0 ? 'pass' : 'fail',
    failures,
    sessionRef,
    metrics,
    finalAnswerText,
    durationMs: Date.now() - startMs,
    notes,
  }
}

async function resetDir(dir: string): Promise<void> {
  const { mkdir, rm } = await import('node:fs/promises')
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
}

async function writeArtifacts(result: PackRunResult, outDir: string): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(outDir, { recursive: true })
  await writeFile(path.join(outDir, 'report.md'), renderReport(result), 'utf8')
  await writeFile(path.join(outDir, 'sessions.jsonl'), `${sessionsLines(result).join('\n')}\n`, 'utf8')
}
