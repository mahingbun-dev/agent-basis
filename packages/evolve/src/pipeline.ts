/**
 * 进化流水线编排(信号 → 反思 → 提案 → 门禁 → 账本流转)。
 *
 * runEvolutionCycle 是 Phase 1/2 的可复用闭环体:
 *  1. reflect:信号聚类 → MAST 打标 → 同根因 ≥ repeatThreshold 才立项;
 *  2. curate:候选簇 → skill delta 提案(模型/模板双路);
 *  3. gates:G0 packctl lint → G1 evals replay → G2 aievo(可降级);
 *  4. ledger:propose → (门禁过)verified;approved → released 是显式人审动作。
 *
 * 发布落盘(写回 SKILL.md)由调用方决定:本模块返回 appliedText,人审合并动作
 * 在外层(interact 审批 / PR 式);approveAndRelease/effectOf 是账本流转的
 * 显式助手(stable 只读 + PR 式人审点,设计 10 §6)。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { curateSkillDelta } from './curator.ts'
import type { EvolutionProposal } from './curator.ts'
import { applyDeltas } from './deltas.ts'
import { parseSkillDoc, renderSkillDoc } from './entry.ts'
import type { SkillDoc } from './entry.ts'
import { runGates } from './gates.ts'
import type { GatesResult } from './gates.ts'
import type { AievoGateConfig } from './aievo.ts'
import { LedgerStore } from './ledger.ts'
import type { EffectRecord, LedgerRecord, ReleaseRecord, VerificationReport } from './ledger.ts'
import type { ModelCaller, ModelRoutes } from './models.ts'
import { reflect } from './reflector.ts'
import type { ReflectorReport, SignalLike } from './reflector.ts'

/** 单个提案的完整处置结果。 */
export interface ProposalOutcome {
  readonly proposal: EvolutionProposal
  readonly gates: GatesResult | undefined
  /** 门禁通过且 delta 成功应用后的 SKILL.md 全文(未过门禁/应用失败为 undefined)。 */
  readonly appliedText: string | undefined
  /** 账本记录 id(提案落账必有;门禁失败时记录停留在 proposed)。 */
  readonly ledgerId: number
  readonly ledgerStatus: LedgerRecord['status']
  /** 应用失败原因(delta 校验失败;fail-closed 不落半成品)。 */
  readonly applyError?: string
}

export interface CycleResult {
  readonly reflector: ReflectorReport
  readonly outcomes: readonly ProposalOutcome[]
}

export interface CycleOptions {
  /** 进化对象 pack 根目录(gates 与 skill 路径锚点)。 */
  readonly packDir: string
  readonly packId: string
  /** 目标 SKILL.md(相对 packDir)。 */
  readonly skillPath: string
  readonly signals: readonly SignalLike[]
  readonly date: string
  /** 同根因 ≥N 次才立项(默认 2)。 */
  readonly repeatThreshold?: number
  readonly caller?: ModelCaller
  readonly routes?: ModelRoutes
  /** G1 产物目录。 */
  readonly gateOutDir: string
  /** G2 配置(缺省未接入 → 降级跳过)。 */
  readonly aievo?: AievoGateConfig
  /** 账本(缺省 ':memory:' 一次性账本;持久化由组合层传入文件路径实例)。 */
  readonly ledger?: LedgerStore
}

/** 跑一个进化周期(信号集 → 提案集 → 门禁 → 账本);单提案失败不拖垮整周期。 */
export async function runEvolutionCycle(options: CycleOptions): Promise<CycleResult> {
  const reflection = await reflect(options.signals, {
    ...(options.repeatThreshold !== undefined ? { repeatThreshold: options.repeatThreshold } : {}),
    ...(options.caller !== undefined ? { caller: options.caller } : {}),
    ...(options.routes !== undefined ? { routes: options.routes } : {}),
  })

  const doc = readSkillDoc(options.packDir, options.skillPath)
  const outcomes: ProposalOutcome[] = []
  for (const candidate of reflection.candidates) {
    const proposal = await curateSkillDelta(candidate, {
      ...(options.caller !== undefined ? { caller: options.caller } : {}),
      ...(options.routes !== undefined ? { routes: options.routes } : {}),
      date: options.date,
      doc,
      skillPath: options.skillPath,
    })
    outcomes.push(await processProposal(proposal, doc, options))
  }
  return { reflector: reflection, outcomes }
}

/** 单提案:落账(proposed)→ 门禁 → 过则应用 delta 并 verified(待人审)。 */
export async function processProposal(
  proposal: EvolutionProposal,
  doc: SkillDoc,
  options: Pick<CycleOptions, 'packDir' | 'gateOutDir' | 'aievo' | 'ledger'>,
): Promise<ProposalOutcome> {
  const ledger = options.ledger ?? new LedgerStore(':memory:')
  const record = ledger.propose({
    pack: proposal.packId,
    kind: 'skill',
    signalIds: proposal.signalIds,
    mastLabel: proposal.mastLabel,
    proposalRef: `${proposal.skillPath}:${JSON.stringify(proposal.deltas)} —— ${proposal.rationale}`,
  })

  const gates = await runGates({
    packDir: options.packDir,
    outDir: options.gateOutDir,
    ...(options.aievo !== undefined ? { aievo: options.aievo } : {}),
  })
  if (gates.verdict !== 'pass') {
    return { proposal, gates, appliedText: undefined, ledgerId: record.id, ledgerStatus: record.status }
  }

  const applied = applyDeltas(doc, proposal.deltas)
  if (!applied.ok) {
    return {
      proposal,
      gates,
      appliedText: undefined,
      ledgerId: record.id,
      ledgerStatus: record.status,
      applyError: applied.error,
    }
  }
  ledger.markVerified(record.id, gates.verification)
  return {
    proposal,
    gates,
    appliedText: renderSkillDoc(applied.doc),
    ledgerId: record.id,
    ledgerStatus: ledger.get(record.id)?.status ?? 'verified',
  }
}

// ── 账本流转助手(verified → approved → released → effect;pipeline 之上的显式人审动作)──

export function approveAndRelease(ledger: LedgerStore, ledgerId: number, release: ReleaseRecord): LedgerRecord {
  ledger.markApproved(ledgerId)
  return ledger.markReleased(ledgerId, release)
}

export function effectOf(ledger: LedgerStore, ledgerId: number, effect: EffectRecord): LedgerRecord {
  return ledger.recordEffect(ledgerId, effect)
}

function readSkillDoc(packDir: string, skillPath: string): SkillDoc {
  const text = readFileSync(join(packDir, skillPath), 'utf8')
  const parsed = parseSkillDoc(text)
  if (!parsed.ok) throw new Error(`[evolve] ${skillPath} 解析失败:${parsed.error}`)
  return parsed.doc
}

export type { VerificationReport }
