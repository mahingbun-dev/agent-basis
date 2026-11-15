/**
 * golden 用例装载与运行(C4):golden/<case>/ 目录 → 真实 region 压缩事务 →
 * 摘要文本 → scoreSummary。
 *
 * 运行走 `compactSurfaceRegion` 全真的确定性层:estimate meter + 注入的
 * summarize 依赖(测试注入脚本式 fake 摘要;script 注入 gateway 直连的真实
 * LLM),recover 钩子给一次重试预算——空壳/结构违规摘要被 InvalidSummaryError
 * 拒绝后重试(C3 的 golden 注入用例),失败则原样重抛。
 *
 * @module @eterna/compaction/evals/runner
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { compactSurfaceRegion } from '../src/basic/region.ts'
import { frameSummary, summaryToText } from '../src/basic/summarizer.ts'
import type { SummarizationInput, SummaryResult } from '../src/basic/summarizer.ts'
import type { SessionSeq as SessionSeqType } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { validateFacts } from './facts.ts'
import type { FactsSchema } from './facts.ts'
import { parseSessionJsonl, replaySession, createEstimateMeter } from './replay.ts'
import type { SessionEventLine } from './replay.ts'
import { scoreSummary } from './score.ts'
import type { ScoreResult } from './score.ts'

/** 一个装载完成的 golden 用例。 */
export interface GoldenCase {
  readonly id: string
  readonly dir: string
  readonly facts: FactsSchema
  /** golden 自带的期望摘要(确定性层的 fake 摘要 + 回归对照)。 */
  readonly expectedSummary: string
  /** 可选:空壳摘要注入样本(C3 用例);存在即确定性层先注入再重试。 */
  readonly hollowSummary?: string
  readonly events: readonly SessionEventLine[]
  readonly replay: ReturnType<typeof replaySession>
}

/** 注入给 region 的 summarize 依赖签名(与 RegionDependencies.summarize 一致)。 */
export type CaseSummarizer = (
  input: SummarizationInput,
  agent: Agent,
  signal?: AbortSignal,
) => Promise<SummaryResult>

/** 一次用例运行的完整产物。 */
export interface CaseRunResult {
  readonly caseId: string
  readonly ok: boolean
  /** 提交的摘要正文(8 段,未 framed)。 */
  readonly summaryText?: string
  /** 失败时的人读错误(recover 预算耗尽后的重抛或事务失败)。 */
  readonly error?: string
  /** recover 重试预算内被拒绝并重试的错误串(如 invalid-summary: …)。 */
  readonly retryErrors: readonly string[]
  readonly summaryCalls: number
  readonly shadowedTokens?: number
  readonly framedTokens?: number
  readonly score?: ScoreResult
}

/** 列出 golden 目录下的用例 id(字典序)。 */
export function listGoldenCases(goldenDir: string): string[] {
  return readdirSync(goldenDir)
    .filter(name => statSync(`${goldenDir}/${name}`).isDirectory())
    .sort()
}

/**
 * 装载一个 golden 用例:session.jsonl(格式校验+回放)、facts.json(schema 校验)、
 * expected-summary.md,可选 hollow-summary.md。
 * @param dir - golden/<case>/ 目录绝对路径。
 * @param id - 用例 id(缺省取目录名)。
 * @throws {SessionFormatError} 会话格式错误;{@link FactsValidationError} facts 非法。
 */
export function loadGoldenCase(dir: string, id?: string): GoldenCase {
  const base = dir.split('/').pop() ?? dir
  const caseId = id ?? base
  const events = parseSessionJsonl(readFileSync(`${dir}/session.jsonl`, 'utf8'), `${caseId}/session.jsonl`)
  const facts = validateFacts(JSON.parse(readFileSync(`${dir}/facts.json`, 'utf8')))
  const expectedSummary = readFileSync(`${dir}/expected-summary.md`, 'utf8').trim()
  let hollowSummary: string | undefined
  try {
    hollowSummary = readFileSync(`${dir}/hollow-summary.md`, 'utf8').trim()
  } catch {
    // 无注入样本的常规用例。
  }
  return { id: caseId, dir, facts, expectedSummary, ...(hollowSummary === undefined ? {} : { hollowSummary }), events, replay: replaySession(events, `golden-${caseId}`) }
}

/**
 * 对一个 golden 用例跑真实压缩事务:全 surface 选段(用例首尾节点)→
 * compactSurfaceRegion(estimate meter + 注入 summarize + 一次重试预算的 recover)
 * → 摘要文本 + framed 价 + scoreSummary。
 *
 * 事务与生产同源:结构校验(C3)、shrink 校验、start/summary/end 事件事务全部生效;
 * owner=null(回放会话 turn 已闭合)、stability='whole-surface'(运行中无并发变更)。
 *
 * @param goldenCase - 装载后的用例。
 * @param summarize - 注入的摘要实现(测试=脚本 fake;script=gateway 直连)。
 * @param options - retries:recover 重试预算(默认 1;0=生产无监听者语义)。
 */
export async function runGoldenCase(
  goldenCase: GoldenCase,
  summarize: CaseSummarizer,
  options: { retries?: number } = {},
): Promise<CaseRunResult> {
  const retries = options.retries ?? 1
  const meter = createEstimateMeter()
  const session = goldenCase.replay.session
  const agent = {
    id: session.id,
    session,
    options: { provider: 'golden', model: 'golden' },
  } as unknown as Agent
  const retryErrors: string[] = []
  let summaryCalls = 0
  const deps = {
    meter,
    summarize: async (input: SummarizationInput, runAgent: Agent, signal?: AbortSignal): Promise<SummaryResult> => {
      summaryCalls += 1
      return summarize(input, runAgent, signal)
    },
    recover: (error: unknown): boolean => {
      if (retryErrors.length < retries) {
        retryErrors.push(error instanceof Error ? error.message : String(error))
        return true
      }
      return false
    },
  }

  const surfaceSeqs = goldenCase.replay.surfaceSeqs
  const start: SessionSeqType | undefined = surfaceSeqs[0]
  const end: SessionSeqType | undefined = surfaceSeqs[surfaceSeqs.length - 1]
  if (start === undefined || end === undefined) {
    return { caseId: goldenCase.id, ok: false, error: 'golden session has no surface events', retryErrors, summaryCalls }
  }

  try {
    const result = await compactSurfaceRegion(
      deps as unknown as Parameters<typeof compactSurfaceRegion>[0],
      session,
      start,
      end,
      agent,
      { owner: null, stability: 'whole-surface' },
    )
    const summaryText = summaryToText(result.summary)
    const framedTokens = meter.estimateMessage(createUserMessage({
      content: frameSummary(result.summary),
      source: compactCheckpointSource(result.compactionId),
    }))
    const shadowedTokens = result.shadowedTokenCount
    return {
      caseId: goldenCase.id,
      ok: true,
      summaryText,
      retryErrors,
      summaryCalls,
      shadowedTokens,
      framedTokens,
      score: scoreSummary(summaryText, goldenCase.facts, { shadowedTokens, framedTokens }),
    }
  } catch (error: unknown) {
    const session0: Session = session
    return {
      caseId: goldenCase.id,
      ok: false,
      error: errorText(error),
      retryErrors,
      summaryCalls,
      // 失败路径 surface 由事务保证不替换。
      shadowedTokens: meter.measure(session0).totalTokens,
    }
  }
}

/** 人读错误串:带 cause 链(owner=null 的事务会把底层错误包进 ManualCompactionError)。 */
function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause = (error as Error & { cause?: unknown }).cause
  return cause === undefined ? error.message : `${error.message} (cause: ${errorText(cause)})`
}
