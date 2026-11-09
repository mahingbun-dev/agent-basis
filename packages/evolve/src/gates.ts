/**
 * G0/G1/G2 验证流水线编排器(设计 10 §5:生成器/评估器异构的门禁链)。
 *
 * - G0 lint(@eterna/packctl lintPack 库函数调用):Cordis 纪律 / SKILL.md 结构 /
 *   条目锚点完整 —— delta 应用后的 pack 必须零 error 才过;
 * - G1 本地 replay(@eterna/evals runPack 库函数调用,adapterId=replay):
 *   golden smoke 子集回放,全部 case pass 且零加载错误才过;
 * - G2 ai-evo 三层门禁(aievo-cli 包装):release/admission/heldout 逐任务
 *   exit 0 才过;未接入(baseUrl 空)→ 整体降级跳过(degraded),不阻塞本地闭环
 *   (真实执行可降级跳过 —— 任务 T10 口径;接入后 fail-closed)。
 *
 * verdict 语义:
 * - pass:G0+G1 过且 G2 pass 或 degraded(G2 skipped 在账本 verification 里明示);
 * - fail:任一硬门失败。
 */
import { lintPack } from '@eterna/packctl'
import { runPack } from '@eterna/evals'
import { runAievoGates } from './aievo.ts'
import type { AievoGateConfig, AievoGateResult } from './aievo.ts'
import type { VerificationReport } from './ledger.ts'

export interface Gate0Result {
  readonly pass: boolean
  /** error findings(含 code/path/message;warnings 不阻断,仅记录)。 */
  readonly errors: readonly { readonly code: string; readonly path: string; readonly message: string }[]
  readonly warningCount: number
  readonly detail: string
}

export interface Gate1Result {
  readonly pass: boolean
  readonly total: number
  readonly failed: readonly { readonly id: string; readonly message: string }[]
  readonly loadErrors: readonly string[]
  readonly reportPath: string
  readonly detail: string
}

export interface GatesResult {
  readonly g0: Gate0Result
  readonly g1: Gate1Result
  readonly g2: AievoGateResult
  readonly verdict: 'pass' | 'fail'
  /** 账本落账用的 verification 报告(probe 门禁未接入时 not-run,如实记录)。 */
  readonly verification: VerificationReport
}

export interface GatesOptions {
  readonly packDir: string
  /** G1 golden 子集 tag(设计 10 §1 gates.local.subset,默认 smoke)。 */
  readonly subset?: string
  /** G1 产物目录(report.md / sessions.jsonl)。 */
  readonly outDir: string
  readonly aievo?: AievoGateConfig
}

/** 顺序跑 G0 → G1 → G2(G0 不过直接短路,后面门禁不浪费)。 */
export async function runGates(options: GatesOptions): Promise<GatesResult> {
  const g0 = runGate0(options.packDir)
  if (!g0.pass) {
    const g2: AievoGateResult = { tasks: [], verdict: 'degraded' }
    return {
      g0,
      g1: { pass: false, total: 0, failed: [], loadErrors: [], reportPath: '', detail: 'G0 未通过,G1 短路' },
      g2,
      verdict: 'fail',
      verification: toVerification(g0, undefined, g2),
    }
  }
  const g1 = await runGate1(options.packDir, options.subset ?? 'smoke', options.outDir)
  const g2 = await runAievoGates(options.aievo ?? disconnectedAievo())
  const g2Pass = g2.verdict !== 'fail'
  return {
    g0,
    g1,
    g2,
    verdict: g1.pass && g2Pass ? 'pass' : 'fail',
    verification: toVerification(g0, g1, g2),
  }
}

/** G0:packctl lint 库函数调用(零 error 才过;warning 只计数)。 */
export function runGate0(packDir: string): Gate0Result {
  const result = lintPack(packDir)
  const errors = result.findings
    .filter(f => f.severity === 'error')
    .map(f => ({ code: f.code, path: f.path, message: f.message }))
  const warningCount = result.findings.filter(f => f.severity !== 'error').length
  return {
    pass: errors.length === 0,
    errors,
    warningCount,
    detail: errors.length === 0
      ? `packctl lint 通过(0 error / ${warningCount} warning)`
      : `packctl lint ${errors.length} error:${errors.slice(0, 3).map(e => `${e.code}@${e.path}`).join('; ')}${errors.length > 3 ? ' …' : ''}`,
  }
}

/**
 * packctl 06 模板要求 `evals/threshold.yml` 必须存在(PACK004),但它不是 golden
 * case;@eterna/evals 的 loader 会把 evals/ 顶层全部 *.yml 当 case 加载并产生
 * loadError(T4 loader 与 T5 模板的目录约定缝隙)。G1 显式豁免这一个模板必需文件,
 * 其余 loadError 全阻断(不静默吞错)。
 */
const NON_CASE_TEMPLATE_FILES: readonly string[] = ['evals/threshold.yml']

/** G1:evals replay 库函数调用(golden 子集全 pass 且零阻断性加载错误才过)。 */
export async function runGate1(packDir: string, subset: string, outDir: string): Promise<Gate1Result> {
  const report = await runPack({ packDir, adapterId: 'replay', subset, outDir })
  const failed = report.results
    .filter(r => r.status !== 'pass')
    .flatMap(r => r.failures.map(f => ({ id: r.caseData.id, message: `[${f.category}] ${f.message}` })))
  const blocking = report.loadErrors.filter(e => !NON_CASE_TEMPLATE_FILES.some(t => e.file.endsWith(t)))
  const ignored = report.loadErrors.length - blocking.length
  const loadErrors = blocking.map(e => e.message)
  const pass = failed.length === 0 && loadErrors.length === 0 && report.results.length > 0
  return {
    pass,
    total: report.results.length,
    failed,
    loadErrors,
    reportPath: `${outDir}/report.md`,
    detail: pass
      ? `replay ${report.results.length} 条全过(${subset} 子集${ignored > 0 ? `;豁免非 case 模板文件加载告警 ${ignored} 个` : ''})`
      : `replay ${failed.length}/${report.results.length} 失败${loadErrors.length > 0 ? `;加载错误 ${loadErrors.length}` : ''}${report.results.length === 0 ? `;${subset} 子集为空(至少 1 条)` : ''}`,
  }
}

function disconnectedAievo(): AievoGateConfig {
  return {
    tasks: {
      release: { name: 'task-release-gate' },
      admission: { name: 'task-admission-gate' },
      heldout: { name: 'task-heldout-gate' },
    },
  }
}

function toVerification(g0: Gate0Result, g1: Gate1Result | undefined, g2: AievoGateResult): VerificationReport {
  const g2Skipped = g2.tasks.length === 0 || g2.tasks.every(t => t.status === 'skipped')
  return {
    g0: { pass: g0.pass, detail: g0.detail },
    g1: {
      pass: g1?.pass ?? false,
      detail: g1?.detail ?? 'G0 未通过,G1 短路未跑',
    },
    g2: {
      pass: g2.verdict === 'pass' || g2.verdict === 'degraded',
      detail: g2.verdict === 'pass'
        ? 'ai-evo 三层门禁(release/admission/heldout)全过'
        : g2.verdict === 'degraded'
          ? 'ai-evo 未接入,三层门禁降级跳过(接入后自动生效,fail-closed)'
          : `ai-evo 门禁失败:${g2.tasks.map(t => `${t.gate}:${t.status}`).join(', ')}`,
      ...(g2Skipped && g2.verdict === 'degraded' ? { skipped: true } : {}),
    },
    probe: 'not-run',
  }
}
