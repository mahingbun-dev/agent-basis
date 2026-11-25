/**
 * 运行器:loadPackCases → 过滤(subset=tag / 单 case)→ 逐 case 起适配器 →
 * answer/trajectory/budget/final_state 四组断言 → CaseResult 汇总 → 落盘
 * report.md + sessions.jsonl + events/<case-id>.jsonl(原始事件流完整另存,
 * 供 ai-evo 转换等下游消费)。单 case 的 harness 失败被捕获为该 case 的
 * 失败明细(分类 harness),不拖垮整包(设计文档 14 §4 韧性规则)。
 */
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { scoreReplayEvents } from '@eterna/session-eval/replay'
import type { ReplayScore } from '@eterna/session-eval/replay'
import { loadPackCases } from './schema.ts'
import { summarize } from './events.ts'
import { assertAnswer, assertBudget } from './budget.ts'
import { assertFinalState } from './finalState.ts'
import { assertTrajectory } from './trajectory.ts'
import { renderReport } from './report.ts'
import { sessionsLines } from './sessions.ts'
import { ensureBuiltinAdapters, getAdapter } from './adapters/registry.ts'
import type { AcpAdapterOptions } from './adapters/acp.ts'
import type { CaseResult, FailureDetail, GoldenCase, PackRunResult, SessionEventLike } from './types.ts'

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
  /**
   * 会话评测规则分(56 号 P2-3d):开启后每个 case 的事件流按在线评分口径再算一遍,
   * 结果写入 CaseResult.sessionEval / sessions.jsonl / report.md。
   * `metricsYaml` = 业务指标文件原文(与线上 metrics.yaml 同格式;缺省只算内置规则)。
   */
  readonly sessionEval?: { readonly metricsYaml?: string }
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
  let events: readonly SessionEventLike[] = []
  try {
    const adapter = getAdapter(adapterId)
    const run = await adapter.run({ caseData, packDir: options.packDir, workspaceDir })
    sessionRef = run.sessionRef
    finalAnswerText = run.finalAnswerText
    notes = run.notes ?? []
    events = run.events
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
  // 会话评测规则分:与在线 snapshot 同一套纯函数;评分失败只单列原因,不改本包 pass/fail。
  let sessionEval: ReplayScore | undefined
  let sessionEvalError: string | undefined
  if (options.sessionEval !== undefined) {
    if (events.length === 0) {
      sessionEvalError = '没有会话事件可评。'
    } else {
      const reply = scoreReplayEvents({
        sessionId: caseData.id,
        events,
        ...options.sessionEval.metricsYaml === undefined ? {} : { metricsYaml: options.sessionEval.metricsYaml },
      })
      if (reply.ok) sessionEval = reply.score
      else sessionEvalError = reply.error
    }
  }
  return {
    caseData,
    adapterId,
    status: failures.length === 0 ? 'pass' : 'fail',
    failures,
    sessionRef,
    metrics,
    events,
    finalAnswerText,
    durationMs: Date.now() - startMs,
    notes,
    ...sessionEval === undefined ? {} : { sessionEval },
    ...sessionEvalError === undefined ? {} : { sessionEvalError },
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
  // 运行口径清单(F3 复审联动的 F2 修复):pack 内容 + 适配器 + subset 的 sha256 指纹。
  // 同 pack 同 adapter 的两次确定性回放逐 case 同源,diff 恒 0 by construction——指纹让
  // scripts/diff-pass-rate.mjs 能识别这种恒真对比并拒绝判定(退出码 3「门禁未武装」),
  // 路由金集压缩态回放腿(真实压缩态重放器)就位前后用同一把尺。
  await writeFile(path.join(outDir, 'run.json'), `${JSON.stringify({
    packDir: result.packDir,
    adapterId: result.adapterId,
    ...(result.subset === undefined ? {} : { subset: result.subset }),
    startedAt: result.startedAt,
    fingerprint: packFingerprint(result.packDir, result.adapterId, result.subset),
  }, null, 2)}\n`, 'utf8')
  // 原始事件流完整另存(一行一事件,与 driver NDJSON 的 event 包同形):T4 转换与
  // 失败复盘的直接对象,harness 失败(无事件)的 case 也落空文件以保齐全集。
  const eventsDir = path.join(outDir, 'events')
  await mkdir(eventsDir, { recursive: true })
  for (const item of result.results) {
    const body = item.events.map(event => JSON.stringify(event)).join('\n')
    await writeFile(path.join(eventsDir, `${item.caseData.id}.jsonl`), `${body}\n`, 'utf8')
  }
}

/**
 * 运行口径指纹:sha256(adapterId ⊕ subset ⊕ pack 逐文件相对路径与内容)。
 * pack 目录内全部文件(evals/*.yaml + fixtures/*.jsonl)按相对路径排序后逐个入哈希——
 * 判例增补/fixture 改写即变指纹;同内容同口径的两跑指纹一致(恒真对比的可识别前提)。
 */
function packFingerprint(packDir: string, adapterId: string, subset?: string): string {
  const hash = createHash('sha256')
  hash.update(`adapter=${adapterId}\n`)
  hash.update(`subset=${subset ?? ''}\n`)
  // pack 目录不可读(pack 目录不存在等错误路径,loadErrors 语义)→ fail-soft:以
  // 「pack-unreadable」标记入哈希——同错误路径的两跑指纹仍一致,恒真对比识别不破。
  let files: string[] = []
  try {
    const walk = (dir: string, prefix: string): string[] => {
      const entries: string[] = []
      for (const name of readdirSync(dir).sort()) {
        const full = path.join(dir, name)
        const rel = prefix.length === 0 ? name : `${prefix}/${name}`
        if (statSync(full).isDirectory()) entries.push(...walk(full, rel))
        else entries.push(rel)
      }
      return entries
    }
    files = walk(packDir, '')
  } catch {
    hash.update('pack-unreadable\n')
    return hash.digest('hex')
  }
  for (const rel of files) {
    hash.update(`${rel}\n`)
    hash.update(readFileSync(path.join(packDir, rel)))
    hash.update('\n')
  }
  return hash.digest('hex')
}
