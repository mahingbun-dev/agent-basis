/**
 * 全局蒸馏 Phase B(18 号 §8 三阶段之二;M-M4):从 Phase A 报告的 ≥K 簇起草
 * **脱敏 pack 候选 delta**,走既有 G0–G2 门禁进 quarantine,SME 人审签发。
 *
 * 复用面(evolve 库本体,不改其语义):
 * - 起草:add_entry 单一 delta(ACE 条目化;模型/模板双路——模型不可用回落
 *   确定性模板,与 evolve curator 同纪律;提示词为蒸馏专用口径:输入是跨用户
 *   共性簇(已掩码),不是 evolve 的失败簇——mastLabel 缺省 F1 如实标注回落);
 * - 门禁:runGates(G0 packctl lint → G1 evals replay → G2 aievo 未接入自动
 *   degraded 跳过且账本明示)对候选目录整包跑;
 * - 探针(fail-closed,VerificationReport.probe):本地确定性三查——PII 残留
 *   (BuiltinPiiGuard 同源模式)/ 租户残留(参与账号名、路径、DSH_HOME 字面)/
 *   注入模式(「忽略之前指令」类);任一命中 probe=fail,签发面拒绝放行;
 * - 账本:LedgerStore(propose → verified → approved → released);**签发是显式
 *   人审动作**(approveAndRelease 语义),拒绝不改账本状态(meta 记 decision)。
 *
 * 落盘(DSH_HOME 语义隔离目录,不经任何 agent 上下文):
 * - pack/       蒸馏候选包骨架(首次自动生成,可整包过 G0 lint 的最小 pack);
 * - candidates/<id>/  每候选一份完整包拷贝(quarantine;delta 应用后的全文);
 * - ledger.sqlite3    进化账本(与 evolve 同构,血缘到簇);
 * - release/<id>.skill.md  签发产物(人工 PR 合入正式 pack 仓库的原料)。
 *
 * 发布纪律(18 §8/09 号原文):候选入库即走 pack 通道 = **人工 git 动作**;
 * 本模块只产签发产物,绝不写仓库 packs/。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyDeltas, LedgerStore, parseJsonLoose, parseSkillDoc, renderSkillDoc, runGates,
} from '@eterna/evolve'
import type { EvolutionProposal, ModelCaller, SkillDoc, VerificationReport } from '@eterna/evolve'
import {
  createDistillTask, distillMaskText, distillRootOf, readLatestDistillReport,
} from './distill.ts'
import { BuiltinPiiGuard } from './pii.ts'
import type { DistillAccountRef, DistillCluster, DistillPiiScanner, DistillReport } from './distill.ts'
import type { ConsolidationLogger, ConsolidationSnapshot, ConsolidationTask, ConsolidationTaskResult } from './consolidation.ts'

/** 候选目标 pack 名(PACK003 scoped 形态;quarantine 命名空间,非生产 pack)。 */
export const DISTILL_PACK_ID = '@distilled/pack'

/** 候选包内 SKILL.md 相对路径(ACE 条目化落点)。 */
export const DISTILL_SKILL_PATH = 'skills/distilled-behaviors/SKILL.md'

/** 单次运行起草候选上限(LLM 成本合并;簇再多也只起草前 3,余簇留报告面)。 */
export const MAX_CANDIDATES_PER_RUN = 3

/** 候选包骨架标记文件存在即视为已初始化(幂等重建面 = 删目录)。 */
const PACK_BASE_MARKER = 'package.json'

// ---------- 候选包骨架(可整包过 G0 lint 的最小 pack) ----------

const BASE_PACKAGE_JSON = {
  name: DISTILL_PACK_ID,
  private: true,
  version: '0.1.0',
  description: '全局蒸馏候选包(quarantine;签发后人工合入正式 pack 仓库)',
  dsh: {
    manifestVersion: 1,
    bundle: {
      patch: './cordis.patch.yml',
    },
  },
}

const BASE_PROFILE_YAML = [
  '# 蒸馏候选包 profile(07 号模板最小面;lint PACK010 口径)。',
  `name: '${DISTILL_PACK_ID}'`,
  'extends:',
  '  - dsh-base',
  'bundles:',
  `  - '${DISTILL_PACK_ID}'`,
  '',
].join('\n')

const BASE_CORDIS_PATCH_YAML = [
  '# 蒸馏候选包 cordis patch(quarantine 占位;发布走人工 PR,不经本文件装载)。',
  'services: {}',
  '',
].join('\n')

const BASE_PERSONA_MD = [
  '# 蒸馏候选包',
  '',
  '跨用户蒸馏沉淀的共性行为指令候选(SME 人审签发后人工合入正式领域包)。',
  '本 persona 是 quarantine 骨架,不参与生产装载。',
  '',
].join('\n')

const BASE_HITL_YAML = [
  '# 蒸馏候选包 HITL(审批面占位;YAML 映射形态,lint 结构口径)。',
  'approvals: {}',
  '',
].join('\n')

const BASE_THRESHOLD_YAML = [
  '# 蒸馏候选包门禁阈值(07 号文档 §3 口径;release 段为 PACK007 最小阈值集)。',
  'smoke:',
  '  subset: 1',
  '  timeout_min: 5',
  '  verification_pass_rate_min: 0.8',
  'release:',
  '  verification_pass_rate_min: 0.85',
  '  trajectory_match_rate_min: 0.8',
  '  judge_score_min: 4.0',
  '',
].join('\n')

const BASE_GOLDEN_YAML = [
  '# 蒸馏候选包 G1 冒烟 golden(replay 适配器吃 fixtures 物化文件断言)。',
  'id: distill-smoke',
  'description: 蒸馏候选包加载冒烟(fixture 物化 out/smoke.md 后断言可读)',
  'category: 冒烟',
  'tags: [smoke]',
  'user_input: |',
  '  加载蒸馏候选包,读取行为集并写出冒烟文件(回放模式,不调真实模型)。',
  'final_state:',
  '  - file_assert: { path: out/smoke.md, contains: 蒸馏 }',
  '',
].join('\n')

const BASE_FIXTURE_JSONL = [
  JSON.stringify({
    type: 'user/message',
    seq: 1,
    time: 0,
    data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '读取蒸馏行为集并写出冒烟文件。' }] },
  }),
  JSON.stringify({
    type: 'plugin:eterna-evals/workspace',
    seq: 2,
    time: 1,
    data: { files: { 'out/smoke.md': '蒸馏候选包冒烟内容(回放 fixture)' } },
  }),
  '',
].join('\n')

const BASE_SKILL_MD = [
  '---',
  'name: distilled-behaviors',
  'description: 跨用户蒸馏沉淀的共性行为指令(全局蒸馏候选包;人审签发后人工合入正式领域包)',
  'metadata:',
  '  evo:',
  '    entries: []',
  '---',
  '',
  '# 蒸馏行为集',
  '',
  '跨用户聚合产出的共性模式候选。条目由全局蒸馏 Phase B 起草、G0–G2 门禁与',
  '本地探针把关,SME 人审签发后人工合入正式 pack 仓库(PR 式)。',
  '',
].join('\n')

/**
 * 确保候选包骨架在场(首次自动生成;幂等)。骨架必须能整包过 G0 lint——
 * distill-curate.spec 以「生成的候选目录 runGates 通过」钉住此约定。
 */
export function prepareDistillPackBase(baseDir: string): string {
  if (existsSync(join(baseDir, PACK_BASE_MARKER))) return baseDir
  mkdirSync(baseDir, { recursive: true })
  writeFileSync(join(baseDir, 'package.json'), JSON.stringify(BASE_PACKAGE_JSON, null, 2) + '\n')
  writeFileSync(join(baseDir, 'profile.yml'), BASE_PROFILE_YAML)
  writeFileSync(join(baseDir, 'cordis.patch.yml'), BASE_CORDIS_PATCH_YAML)
  writeFileSync(join(baseDir, 'persona.md'), BASE_PERSONA_MD)
  writeFileSync(join(baseDir, 'hitl.yaml'), BASE_HITL_YAML)
  for (const dir of [
    'skills/distilled-behaviors', 'tools', 'knowledge', 'policies',
    'evals/validators', 'evals/trajectories', 'evals/golden', 'fixtures',
  ]) {
    mkdirSync(join(baseDir, dir), { recursive: true })
  }
  writeFileSync(join(baseDir, 'evals/threshold.yml'), BASE_THRESHOLD_YAML)
  writeFileSync(join(baseDir, 'evals/golden/distill-smoke.yaml'), BASE_GOLDEN_YAML)
  writeFileSync(join(baseDir, 'fixtures/distill-smoke.jsonl'), BASE_FIXTURE_JSONL)
  writeFileSync(join(baseDir, DISTILL_SKILL_PATH), BASE_SKILL_MD)
  return baseDir
}

// ---------- 探针(fail-closed;VerificationReport.probe 的填充源) ----------

/** 注入模式探针(候选正文禁「夺权/越权改指令」类措辞;大小写不敏感)。 */
const INJECTION_PATTERNS: readonly { readonly probeId: string; readonly pattern: RegExp }[] = [
  { probeId: 'injection-ignore-instructions', pattern: /忽(?:略|视)(?:之前|以上|上述|先前|前面)?(?:的)?(?:所有)?(?:系统)?(?:提示词|指令|规则)|ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?/iu },
  { probeId: 'injection-system-prompt', pattern: /(?:展示|输出|透露|泄露)(?:你的)?(?:系统提示词?|system prompt)|reveal\s+(?:your\s+)?system\s+prompt/iu },
  { probeId: 'injection-role-override', pattern: /(?:你现在|从现在起)(?:是|成为)(?:一个)?(?:无(?:任何)?限制|不受约束)(?:的)?(?:AI|模型|助手)|you\s+are\s+now\s+(?:an?\s+)?(?:unrestricted|uncensored)/iu },
]

/** 路径/环境残留探针(18 §8 风险表「残留检测:路径/人名/租户标识」的本地口径)。 */
const RESIDUE_PATH_PATTERNS: readonly { readonly probeId: string; readonly pattern: RegExp }[] = [
  { probeId: 'residue-abs-path', pattern: /\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+/u },
  { probeId: 'residue-dsh-env', pattern: /DSH_HOME|ETERNA_TENANT_ROOT|workspaces\//u },
]

export interface DistillProbeResult {
  readonly status: 'pass' | 'fail'
  readonly findings: readonly { readonly probeId: string; readonly detail: string }[]
}

/**
 * 候选正文三查(任一命中即 fail;fail-closed,签发面拒绝放行):
 * 1. PII 残留(BuiltinPiiGuard 四类通用模式,与写入库同源);
 * 2. 租户残留:参与账号名字面 + 路径/环境标识(跨用户通道不得携带租户信息);
 * 3. 注入模式:候选是「给未来 agent 读的行为指令」,不得携带指令夺权措辞。
 */
export function runDistillProbes(skillText: string, participantAccounts: readonly string[], pii?: DistillPiiScanner): DistillProbeResult {
  const findings: { probeId: string; detail: string }[] = []
  const excerptOf = (index: number, length: number): string =>
    distillMaskText(skillText.slice(Math.max(0, index - 10), index + length + 10))
  // 1. PII 残留
  for (const finding of (pii ?? new BuiltinPiiGuard()).scan(skillText)) {
    findings.push({ probeId: 'probe-pii-residue', detail: excerptOf(finding.start, finding.end - finding.start) })
  }
  // 2. 租户残留(账号名字面,大小写不敏感)
  for (const account of participantAccounts) {
    if (account.length === 0) continue
    const at = skillText.toLowerCase().indexOf(account.toLowerCase())
    if (at >= 0) {
      findings.push({ probeId: 'probe-tenant-residue', detail: excerptOf(at, account.length) })
    }
  }
  for (const rule of RESIDUE_PATH_PATTERNS) {
    const match = rule.pattern.exec(skillText)
    if (match !== null) {
      findings.push({ probeId: rule.probeId, detail: excerptOf(match.index, match[0].length) })
    }
  }
  // 3. 注入模式
  for (const rule of INJECTION_PATTERNS) {
    const match = rule.pattern.exec(skillText)
    if (match !== null) {
      findings.push({ probeId: rule.probeId, detail: excerptOf(match.index, match[0].length) })
    }
  }
  return findings.length === 0 ? { status: 'pass', findings: [] } : { status: 'fail', findings }
}

// ---------- 起草(模型/模板双路;蒸馏专用提示词) ----------

const DISTILL_CURATOR_PROMPT = `你是全局蒸馏流水线的候选起草器(curator)。
输入是一个跨用户共享模式簇(JSON,全部字段已脱敏):多个账号的已批准记忆中
反复出现的共性模式。请把它蒸馏成一条给未来 agent 读的**通用行为指令**,
输出严格 JSON 之一:
{ "action": "add_entry", "body": "新条目正文(可执行的行为指令,2-5 行,结论先行)", "rationale": "一句话动机" }
{ "action": "skip", "reason": "簇无蒸馏价值的原因(如样例过于琐碎/互相矛盾)" }
起草纪律:
- 只产 add_entry;正文必须**去用户特色**(不含任何人名/账号/路径/联系方式);
- 正文是通用行为指令,不是用户画像,不复述样例原文;
- 簇内样例互相矛盾或语义过弱时诚实地选 skip。`

/** 模板回落正文(确定性;与 evolve curator 模板同纪律)。 */
function draftTemplateBody(cluster: DistillCluster): string {
  const tokens = cluster.sharedTokens.length > 0 ? cluster.sharedTokens.join('、') : cluster.label
  return [
    `- 跨用户共性模式(${cluster.userCount} 个独立账号命中):${tokens}`,
    '- 处置口径:同类场景先比对本条;模式详情与计数见全局蒸馏报告(admin 只读面可溯)。',
    '- (模板起草:本条正文由 curator 模型改写后过门禁与人审合并。)',
  ].join('\n')
}

/** add_entry delta 的正文提取(delta 集合恒为单元素 add_entry;防御收窄)。 */
function addEntryBodyOf(proposal: EvolutionProposal): string {
  const delta = proposal.deltas[0]
  return delta !== undefined && delta.type === 'add_entry' ? delta.body : ''
}

/**
 * 单簇起草:模型路径输出 add_entry/skip;模型不可用或输出非法回落模板(与
 * evolve curator 双路纪律一致);skip = 本簇无蒸馏价值,不建候选目录。
 */
export async function draftDistillProposal(options: {
  readonly cluster: DistillCluster
  readonly doc: SkillDoc
  readonly candidateId: string
  readonly date: string
  readonly caller?: ModelCaller
  readonly route?: { readonly provider: string; readonly model: string }
}): Promise<EvolutionProposal | null> {
  const fallback = (): EvolutionProposal => ({
    packId: DISTILL_PACK_ID,
    skillPath: DISTILL_SKILL_PATH,
    deltas: [{
      type: 'add_entry',
      body: draftTemplateBody(options.cluster),
      origin: `distill:${options.candidateId}`,
      date: options.date,
    }],
    rationale: `模板起草:跨用户簇(${options.cluster.userCount} 账号),来源 ${options.candidateId}`,
    signalIds: [`distill:${options.candidateId}`],
    mastLabel: 'F1',
    draftSource: 'template',
  })
  if (options.caller === undefined || options.route === undefined) return fallback()
  try {
    const raw = await options.caller.call({
      route: options.route,
      system: DISTILL_CURATOR_PROMPT,
      json: true,
      messages: [{
        role: 'user',
        content: JSON.stringify({
          pattern_label: options.cluster.label,
          shared_tokens: options.cluster.sharedTokens,
          user_count: options.cluster.userCount,
          kind_counts: options.cluster.kindCounts,
          domain_counts: options.cluster.domainCounts,
          examples: options.cluster.examples,
          existing_entries: options.doc.entries.map(entry => ({
            id: entry.meta.id,
            body: entry.body.slice(0, 400),
            deprecated: entry.deprecated,
          })),
        }),
      }],
    })
    const parsed = parseJsonLoose(raw)
    if (typeof parsed !== 'object' || parsed === null) throw new Error('模型输出不是 JSON 对象')
    const row = parsed as Record<string, unknown>
    if (row['action'] === 'skip') {
      return null
    }
    if (row['action'] !== 'add_entry') {
      throw new Error(`模型输出的 action "${String(row['action'])}" 非法(add_entry|skip)`)
    }
    const body = typeof row['body'] === 'string' ? row['body'] : ''
    if (body.trim().length === 0) throw new Error('add_entry 缺 body')
    return {
      packId: DISTILL_PACK_ID,
      skillPath: DISTILL_SKILL_PATH,
      deltas: [{
        type: 'add_entry',
        body,
        origin: `distill:${options.candidateId}`,
        date: options.date,
      }],
      rationale: typeof row['rationale'] === 'string' && row['rationale'].length > 0
        ? row['rationale']
        : `跨用户簇(${options.cluster.userCount} 账号),来源 ${options.candidateId}`,
      signalIds: [`distill:${options.candidateId}`],
      mastLabel: 'F1',
      draftSource: 'model',
    }
  } catch {
    return fallback()
  }
}

// ---------- 候选目录(meta.json 形态与读写) ----------

/** 候选门禁与探针摘要(meta.json gate 段;admin 候选区的数据源)。 */
export interface DistillCandidateGateSummary {
  readonly verdict: 'pass' | 'fail'
  readonly g0Pass: boolean
  readonly g0Detail: string
  readonly g1Pass: boolean
  readonly g1Detail: string
  readonly g2Detail: string
  readonly g2Skipped: boolean
  readonly probe: 'pass' | 'fail' | 'not-run'
  readonly probeFindings: readonly { readonly probeId: string; readonly detail: string }[]
}

/** 候选决策记录(拒绝不改账本状态,meta 记 decision——账本无 rejected 态)。 */
export interface DistillCandidateDecision {
  readonly action: 'released' | 'rejected'
  readonly at: number
  readonly operator: string
  /** released 时签发产物相对路径(release/<id>.skill.md)。 */
  readonly artifact?: string
}

/** 候选 meta.json 形态(quarantine 目录的自描述;admin 候选区直读)。 */
export interface DistillCandidateMeta {
  readonly id: string
  readonly ledgerId: number
  readonly createdAt: number
  readonly mastLabel: string
  readonly rationale: string
  readonly draftSource: 'model' | 'template'
  readonly cluster: {
    readonly label: string
    readonly userCount: number
    readonly accounts: readonly string[]
    readonly sharedTokens: readonly string[]
    readonly examples: readonly string[]
  }
  readonly body: string
  readonly appliedOk: boolean
  readonly applyError?: string
  readonly gate: DistillCandidateGateSummary
  readonly decision: DistillCandidateDecision | null
}

function candidatesDirOf(outputDir: string): string {
  return join(outputDir, 'candidates')
}

function candidateDirOf(outputDir: string, id: string): string {
  return join(candidatesDirOf(outputDir), id)
}

function candidateSkillPath(outputDir: string, id: string): string {
  return join(candidateDirOf(outputDir, id), DISTILL_SKILL_PATH)
}

function writeCandidateMeta(outputDir: string, meta: DistillCandidateMeta): void {
  writeFileSync(join(candidateDirOf(outputDir, meta.id), 'meta.json'), JSON.stringify(meta, null, 2))
}

/** 读单个候选 meta(缺席/损坏 → null)。 */
export function readDistillCandidateMeta(outputDir: string, id: string): DistillCandidateMeta | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(candidateDirOf(outputDir, id), 'meta.json'), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as { id?: unknown; ledgerId?: unknown }
    if (typeof record.id !== 'string' || typeof record.ledgerId !== 'number') return null
    return parsed as DistillCandidateMeta
  } catch {
    return null
  }
}

function utcDateOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

// ---------- Phase B 主流程(报告 → 起草 → 门禁 → 账本) ----------

export interface DistillCurateOutcome {
  /** 实际创建候选目录数(skip/簇不足不计)。 */
  readonly drafted: number
  /** 门禁+探针全过(ledger verified,待人审签发)的候选数。 */
  readonly verified: number
  readonly detail: string
}

/**
 * Phase B 主体:读最新 Phase A 报告,对前 MAX_CANDIDATES_PER_RUN 个 ≥K 簇
 * 逐一「拷骨架 → 起草 add_entry → 应用渲染 → 整包门禁 → 三查探针 → 落账」。
 * 门禁或探针未过的候选停在 quarantine(proposed + meta 如实记录),绝不静默
 * 丢弃;单候选失败不中断其余(evolve pipeline 同纪律)。
 */
export async function curateDistillCandidates(options: {
  readonly report: DistillReport
  readonly outputDir: string
  readonly caller?: ModelCaller
  readonly route?: { readonly provider: string; readonly model: string }
  readonly ledger: LedgerStore
  readonly pii?: DistillPiiScanner
  readonly signal: AbortSignal
  readonly logger?: ConsolidationLogger
  readonly now?: () => number
}): Promise<DistillCurateOutcome> {
  const now = options.now ?? ((): number => Date.now())
  const date = utcDateOf(now())
  const baseDir = prepareDistillPackBase(join(options.outputDir, 'pack'))
  // 账本父目录(候选目录由 cpSync 惰性创建——skip 路径不留空目录)。
  mkdirSync(options.outputDir, { recursive: true })
  const clusters = options.report.clusters.slice(0, MAX_CANDIDATES_PER_RUN)
  let drafted = 0
  let verified = 0
  const notes: string[] = []
  for (const [index, cluster] of clusters.entries()) {
    if (options.signal.aborted) break
    const candidateId = `d${now().toString(36)}-${index + 1}`
    try {
      const outcome = await curateOneCandidate({
        cluster,
        candidateId,
        baseDir,
        outputDir: options.outputDir,
        ledger: options.ledger,
        date,
        now,
        ...(options.caller !== undefined && { caller: options.caller }),
        ...(options.route !== undefined && { route: options.route }),
        ...(options.pii !== undefined && { pii: options.pii }),
      })
      drafted += 1
      if (outcome.ledgerVerified) verified += 1
      notes.push(`${candidateId}:${outcome.ledgerVerified ? 'verified' : outcome.gate.verdict === 'pass' ? 'probe-fail' : 'gates-fail'}`)
    } catch (error) {
      notes.push(`${candidateId}:error(${error instanceof Error ? error.message : String(error)})`)
    }
  }
  const detail = `蒸馏候选起草:${drafted} 起/${verified} verified(${notes.join(' ')})`
  options.logger?.info?.(`[memory] ${detail}`)
  return { drafted, verified, detail }
}

/** 单候选全流程(起草 → 拷贝 → 应用 → 门禁 → 探针 → 落账 + meta)。 */
async function curateOneCandidate(options: {
  readonly cluster: DistillCluster
  readonly candidateId: string
  readonly baseDir: string
  readonly outputDir: string
  readonly caller?: ModelCaller
  readonly route?: { readonly provider: string; readonly model: string }
  readonly ledger: LedgerStore
  readonly pii?: DistillPiiScanner
  readonly date: string
  readonly now: () => number
}): Promise<{ readonly ledgerVerified: boolean; readonly gate: DistillCandidateGateSummary }> {
  // 先起草后拷贝:模型诚实 skip(或起草失败)不留残目录。
  const docResult = parseSkillDoc(readFileSync(join(options.baseDir, DISTILL_SKILL_PATH), 'utf8'))
  if (!docResult.ok) {
    throw new Error(`候选骨架 SKILL.md 解析失败:${docResult.error}`)
  }
  const proposal = await draftDistillProposal({
    cluster: options.cluster,
    doc: docResult.doc,
    candidateId: options.candidateId,
    date: options.date,
    ...(options.caller !== undefined && { caller: options.caller }),
    ...(options.route !== undefined && { route: options.route }),
  })
  if (proposal === null) {
    throw new Error('curator 判定本簇无蒸馏价值(skip)')
  }
  const candidateDir = candidateDirOf(options.outputDir, options.candidateId)
  cpSync(options.baseDir, candidateDir, { recursive: true })
  const applied = applyDeltas(docResult.doc, proposal.deltas)
  const metaCluster = {
    label: options.cluster.label,
    userCount: options.cluster.userCount,
    accounts: options.cluster.accounts,
    sharedTokens: options.cluster.sharedTokens,
    examples: options.cluster.examples,
  }
  const record = options.ledger.propose({
    pack: proposal.packId,
    kind: 'skill',
    signalIds: proposal.signalIds,
    mastLabel: proposal.mastLabel,
    proposalRef: `${proposal.skillPath}:${JSON.stringify(proposal.deltas)} —— ${proposal.rationale}`,
  })
  if (!applied.ok) {
    // fail-closed:应用失败不落半成品——目录保留 meta 供排查,门禁不跑。
    const gate: DistillCandidateGateSummary = {
      verdict: 'fail', g0Pass: false, g0Detail: 'delta 应用失败,G0 短路',
      g1Pass: false, g1Detail: 'delta 应用失败,G1 短路',
      g2Detail: 'delta 应用失败,G2 短路', g2Skipped: false,
      probe: 'not-run', probeFindings: [],
    }
    writeCandidateMeta(options.outputDir, {
      id: options.candidateId, ledgerId: record.id, createdAt: options.now(),
      mastLabel: proposal.mastLabel, rationale: proposal.rationale, draftSource: proposal.draftSource,
      cluster: metaCluster, body: addEntryBodyOf(proposal),
      appliedOk: false, applyError: applied.error,
      gate, decision: null,
    })
    return { ledgerVerified: false, gate }
  }
  writeFileSync(candidateSkillPath(options.outputDir, options.candidateId), renderSkillDoc(applied.doc))
  writeFileSync(join(candidateDir, 'proposal.json'), JSON.stringify(proposal, null, 2))
  // 整包门禁(G0 lint → G1 replay 冒烟 → G2 未接入自动 degraded 跳过)。
  const gatesOutDir = join(candidateDir, 'evals', 'gate-out')
  mkdirSync(gatesOutDir, { recursive: true })
  const gates = await runGates({ packDir: candidateDir, outDir: gatesOutDir })
  // 三查探针(fail-closed):对**应用后的最终正文**查,而非起草输入。
  const probes = runDistillProbes(
    readFileSync(candidateSkillPath(options.outputDir, options.candidateId), 'utf8'),
    options.cluster.accounts,
    options.pii,
  )
  const verified = gates.verdict === 'pass' && probes.status === 'pass'
  const verification: VerificationReport = { ...gates.verification, probe: probes.status }
  if (verified) {
    options.ledger.markVerified(record.id, verification)
  }
  const gate: DistillCandidateGateSummary = {
    verdict: gates.verdict,
    g0Pass: gates.verification.g0.pass,
    g0Detail: gates.verification.g0.detail,
    g1Pass: gates.verification.g1.pass,
    g1Detail: gates.verification.g1.detail,
    g2Detail: gates.verification.g2.detail,
    g2Skipped: gates.verification.g2.skipped ?? false,
    probe: probes.status,
    probeFindings: probes.findings,
  }
  writeCandidateMeta(options.outputDir, {
    id: options.candidateId, ledgerId: record.id, createdAt: options.now(),
    mastLabel: proposal.mastLabel, rationale: proposal.rationale, draftSource: proposal.draftSource,
    cluster: metaCluster,
    body: addEntryBodyOf(proposal),
    appliedOk: true,
    gate, decision: null,
  })
  return { ledgerVerified: verified, gate }
}

// ---------- SME 人审(签发 = 显式人审动作;拒绝只记 meta) ----------

/**
 * 签发(approveAndRelease 语义):候选必须 ledger verified 且**探针复检通过**
 * (TOCTOU 防线:起草后目录可能被改动;签发时对最终正文再跑一遍三查)。
 * 产物 = release/<id>.skill.md(人工 PR 合入正式 pack 仓库的原料);本函数
 * **绝不写仓库 packs/**(发布纪律:人审合并在外层 PR 式)。
 */
export function releaseDistillCandidate(options: {
  readonly outputDir: string
  readonly id: string
  readonly approver: string
  readonly pii?: DistillPiiScanner
  readonly now?: () => number
}): DistillCandidateMeta {
  const now = options.now ?? ((): number => Date.now())
  const meta = readDistillCandidateMeta(options.outputDir, options.id)
  if (meta === null) throw new Error(`候选 ${options.id} 不存在或 meta 损坏`)
  if (meta.decision !== null) throw new Error(`候选 ${options.id} 已有决策(${meta.decision.action}),不可重复签发`)
  mkdirSync(options.outputDir, { recursive: true })
  const ledger = new LedgerStore(join(options.outputDir, 'ledger.sqlite3'))
  const record = ledger.get(meta.ledgerId)
  if (record === undefined || record.status !== 'verified') {
    throw new Error(`候选 ${options.id} 账本状态非 verified(现:${record?.status ?? '缺失'}),禁止签发`)
  }
  const probes = runDistillProbes(
    readFileSync(candidateSkillPath(options.outputDir, options.id), 'utf8'),
    meta.cluster.accounts,
    options.pii,
  )
  if (probes.status !== 'pass') {
    throw new Error(`候选 ${options.id} 探针复检未过(fail-closed),禁止签发:${probes.findings.map(finding => finding.probeId).join(',')}`)
  }
  ledger.markApproved(meta.ledgerId)
  ledger.markReleased(meta.ledgerId, {
    fromVersion: '0.1.0',
    toVersion: '0.1.1',
    tag: `distill-${options.id}`,
    approver: options.approver,
  })
  const releaseDir = join(options.outputDir, 'release')
  mkdirSync(releaseDir, { recursive: true })
  const artifactRel = `release/${options.id}.skill.md`
  writeFileSync(join(options.outputDir, artifactRel), readFileSync(candidateSkillPath(options.outputDir, options.id), 'utf8'))
  const next: DistillCandidateMeta = {
    ...meta,
    gate: { ...meta.gate, probe: probes.status, probeFindings: probes.findings },
    decision: { action: 'released', at: now(), operator: options.approver, artifact: artifactRel },
  }
  writeCandidateMeta(options.outputDir, next)
  return next
}

/** 拒绝:SME 人审否决——账本状态不变(无 rejected 态),meta 记 decision。 */
export function rejectDistillCandidate(options: {
  readonly outputDir: string
  readonly id: string
  readonly operator: string
  readonly now?: () => number
}): DistillCandidateMeta {
  const now = options.now ?? ((): number => Date.now())
  const meta = readDistillCandidateMeta(options.outputDir, options.id)
  if (meta === null) throw new Error(`候选 ${options.id} 不存在或 meta 损坏`)
  if (meta.decision !== null) throw new Error(`候选 ${options.id} 已有决策(${meta.decision.action})`)
  const next: DistillCandidateMeta = {
    ...meta,
    decision: { action: 'rejected', at: now(), operator: options.operator },
  }
  writeCandidateMeta(options.outputDir, next)
  return next
}

/**
 * 候选清单(admin 候选区数据面):扫 candidates 目录下各候选的 meta.json,
 * join 账本状态。默认排除已拒绝(decision.action==='rejected')——
 * includeRejected 显式带出。
 */
export function listDistillCandidates(options: {
  readonly outputDir: string
  readonly ledger: LedgerStore
  readonly includeRejected?: boolean
}): readonly { readonly meta: DistillCandidateMeta; readonly ledgerStatus: string }[] {
  const dir = candidatesDirOf(options.outputDir)
  if (!existsSync(dir)) return []
  const out: { meta: DistillCandidateMeta; ledgerStatus: string }[] = []
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  for (const name of names) {
    const meta = readDistillCandidateMeta(options.outputDir, name)
    if (meta === null) continue
    if (meta.decision?.action === 'rejected' && options.includeRejected !== true) continue
    const status = options.ledger.get(meta.ledgerId)?.status ?? 'unknown'
    out.push({ meta, ledgerStatus: status })
  }
  out.sort((a, b) => b.meta.createdAt - a.meta.createdAt)
  return out
}

// ---------- 组合任务(Phase A 报告 → Phase B 起草;glue 调度 seam) ----------

/** createDistillJob 入参(glue 注入;测试注临时目录与 mock caller)。 */
export interface DistillJobOptions {
  /** 全量账号遍历面(蒸馏轻只读,不走 Dream 的 >20 日分片)。 */
  readonly accounts: () => readonly DistillAccountRef[]
  /** 部署门(每次执行现读;关 → Phase A/B 都跳过,游标照常推进)。 */
  readonly enabled: () => boolean
  readonly minUsers?: number
  /** 产物目录(缺省 distillRootOf())。 */
  readonly outputDir?: string
  /**
   * curator 调用面(懒解析;网络/目录失败返回 undefined → 模板回落,与
   * evolve curator 双路纪律一致)。缺省 undefined = 恒模板路径(离线可跑)。
   */
  readonly resolveCaller?: () => Promise<{
    readonly route: { readonly provider: string; readonly model: string }
    readonly caller: ModelCaller
  } | undefined>
  readonly pii?: DistillPiiScanner
  readonly logger?: ConsolidationLogger
  readonly now?: () => number
}

/**
 * 蒸馏组合任务(SessionEndConsolidator 的 distillTask seam):Phase A 聚合
 * 报告 → 有 ≥K 簇 → Phase B 起草候选(账本落 outputDir/ledger.sqlite3)。
 * 账本实例每跑开关一次(sqlite 短连接;与 Dream 的 per-account meta 同款生命周期)。
 */
export function createDistillJob(options: DistillJobOptions): ConsolidationTask {
  const outputDir = options.outputDir ?? distillRootOf()
  const now = options.now ?? ((): number => Date.now())
  const phaseA = createDistillTask({
    accounts: options.accounts,
    enabled: options.enabled,
    outputDir,
    now,
    ...(options.minUsers !== undefined && { minUsers: options.minUsers }),
    ...(options.pii !== undefined && { pii: options.pii }),
    ...(options.logger !== undefined && { logger: options.logger }),
  })
  return async (snapshot: ConsolidationSnapshot, signal: AbortSignal): Promise<ConsolidationTaskResult> => {
    const result = await phaseA(snapshot, signal)
    if (signal.aborted || !options.enabled() || result.kind !== 'ran') return result
    const report = readLatestDistillReport(outputDir)
    if (report === null || report.clusters.length === 0) return result
    const callerFace = options.resolveCaller === undefined ? undefined : await options.resolveCaller()
    mkdirSync(outputDir, { recursive: true })
    const ledger = new LedgerStore(join(outputDir, 'ledger.sqlite3'))
    try {
      const curate = await curateDistillCandidates({
        report,
        outputDir,
        ledger,
        signal,
        now,
        ...(callerFace !== undefined && { caller: callerFace.caller, route: callerFace.route }),
        ...(options.pii !== undefined && { pii: options.pii }),
        ...(options.logger !== undefined && { logger: options.logger }),
      })
      return { kind: 'ran', detail: `${result.detail};${curate.detail}` }
    } finally {
      ledger.close()
    }
  }
}
