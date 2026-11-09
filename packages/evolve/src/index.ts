/**
 * @eterna/evolve —— L1 受控自进化引擎(T10;设计 09/10 号文档)。
 *
 * 模块地图:
 * 1. entry.ts:SKILL.md 条目解析器(ACE 条目化,packctl SKILL0xx 同口径);
 * 2. deltas.ts:五种 delta 纯函数(add/update/bump/deprecate/merge);
 * 3. ledger.ts:sqlite 进化账本(proposal→verification→release→effect lineage,
 *    status 流转 proposed/verified/approved/released/superseded/rolled_back);
 * 4. models.ts + reflector.ts + curator.ts:可配置模型角色(reflector/curator/reviewer,
 *    默认 deepseek-flash,单测全 mock 绝不真实调用)+ MAST 3类14模式打标
 *    + 同根因 ≥2 重复度阈值 + delta 起草(模型/模板双路);
 * 5. aievo.ts + gates.ts:G0(@eterna/packctl lint 库函数)/ G1(@eterna/evals replay
 *    库函数)/ G2(aievo-cli 包装,退出码 0/1/2,未接入降级跳过);
 * 6. audit.ts:prompt-audit 扫描器(引用缺失/helpful-harmful 计数低下/高相似合并);
 * 7. pipeline.ts:信号→反思→提案→门禁→账本的闭环编排。
 *
 * Cordis 纪律:纯函数层无旁路全局;sqlite 句柄显式持有、close 为构造之逆;
 * 组合层以 EVOLVE_SERVICE_ID(注册表+唯一 ID)provide,可交换。
 * DSH seam:模型调用经 ModelCaller(dshLlmModelCaller 适配 ctx.llm.stream,
 * 类型钉住见 tests/types.seam-pin.ts)。
 */
export { ARCHIVE_HEADING, activeEntries, archivedEntries, cloneDoc, nextEntryId, pairEntries, parseSkillDoc, renderSkillDoc, scanAnchorSpans } from './entry.ts'
export type { AnchorSpan, EvoEntryMeta, ParseResult, SkillDoc, SkillEntry } from './entry.ts'
export { applyDelta, applyDeltas } from './deltas.ts'
export type {
  AddEntryOp, BumpCounterOp, DeltaResult, DeprecateEntryOp, MergeEntriesOp, SkillDelta, UpdateEntryOp,
} from './deltas.ts'
export { DEFAULT_MODEL_ROUTES, dshLlmModelCaller, parseJsonLoose, resolveRoutes } from './models.ts'
export type { DshChunkLike, DshLlmLike, ModelCaller, ModelMessage, ModelRole, ModelRoute, ModelRoutes } from './models.ts'
export { clusterKeyOf, clusterSignals, heuristicLabel, MAST_PATTERNS, reflect } from './reflector.ts'
export type {
  ClusterAnalysis, MastCategory, MastPattern, ReflectOptions, ReflectorCandidate, ReflectorReport,
  RootCause, SignalCluster, SignalLike,
} from './reflector.ts'
export { curateSkillDelta } from './curator.ts'
export type { CurateOptions, EvolutionProposal } from './curator.ts'
export { buildAievoCommand, runAievoGates } from './aievo.ts'
export type { AievoExit, AievoGateConfig, AievoGateResult, AievoRunner, AievoTaskConfig, AievoTaskResult } from './aievo.ts'
export { runGate0, runGate1, runGates } from './gates.ts'
export type { Gate0Result, Gate1Result, GatesOptions, GatesResult } from './gates.ts'
export { diceSimilarity, promptAudit, referencedFiles } from './audit.ts'
export type { AuditFinding, AuditOptions, AuditProposal, PromptAuditReport } from './audit.ts'
export { approveAndRelease, effectOf, processProposal, runEvolutionCycle } from './pipeline.ts'
export type { CycleOptions, CycleResult, ProposalOutcome } from './pipeline.ts'
export { LedgerStore, LedgerTransitionError } from './ledger.ts'
export type {
  EffectRecord, LedgerKind, LedgerProposalInput, LedgerQuery, LedgerRecord, LedgerStatus,
  ReleaseRecord, VerificationReport,
} from './ledger.ts'

import { runEvolutionCycle } from './pipeline.ts'
import type { CycleOptions, CycleResult } from './pipeline.ts'
import { promptAudit } from './audit.ts'
import type { AuditOptions, PromptAuditReport } from './audit.ts'
import type { ModelCaller, ModelRoutes } from './models.ts'
import type { AievoGateConfig } from './aievo.ts'
import { LedgerStore } from './ledger.ts'

/** 组合层注册 ctx.evolve 服务时的唯一 ID(注册表 + 唯一 ID 形态,provide 可交换)。 */
export const EVOLVE_SERVICE_ID = '@eterna/evolve'

/** 进化引擎组合门:reflector/curator/gates/audit/ledger 的默认装配。 */
export interface Evolution {
  readonly id: typeof EVOLVE_SERVICE_ID
  readonly ledger: LedgerStore
  /** 一个完整进化周期(信号 → 提案 → 门禁 → 账本)。 */
  cycle(options: Omit<CycleOptions, 'ledger'>): Promise<CycleResult>
  /** 月度 prompt-audit(设计 10 §7)。 */
  audit(packRoot: string, options?: AuditOptions): PromptAuditReport
  /** 释放(effect 逆:关账本)。 */
  dispose(): void
}

export interface EvolutionOptions {
  /** 账本 sqlite 路径(文件或 ':memory:')。 */
  readonly ledger: string
  readonly caller?: ModelCaller
  readonly routes?: ModelRoutes
  readonly aievo?: AievoGateConfig
  readonly now?: () => number
}

/** 组装进化门(纯对象组合;dispose 为构造的逆)。 */
export function createEvolution(options: EvolutionOptions): Evolution {
  const ledger = new LedgerStore(options.ledger, { ...(options.now !== undefined && { now: options.now }) })
  const id = EVOLVE_SERVICE_ID
  return {
    id,
    ledger,
    cycle: cycleOptions => runEvolutionCycle({ ...cycleOptions, ledger }),
    audit: (packRoot, auditOptions) => promptAudit(packRoot, auditOptions),
    dispose: () => {
      ledger.close()
    },
  }
}
