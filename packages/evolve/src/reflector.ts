/**
 * reflector 反思归因 job(设计 10 §3;09 §1 阶段②「先归因,再决定写入」)。
 *
 * 输入:窗口期内 evolve_signal(observe 形态)+ 会话摘要;
 * 步骤:
 *  1. 聚类去重 —— 按 trajectory_hash(缺省回落 kind+归一化摘要签名)聚类同一失败模式;
 *  2. MAST 打标 —— 3 类 14 模式 rubric(spec 缺陷 / agent 间失配 / 验证缺失,可扩行业自定义),
 *     标签由 reflector 模型给出(mock 单测注入);模型不可用/输出非法 → 启发式关键词回落;
 *  3. 重复度统计 —— 同一 (失败模式) 计数 ≥ repeatThreshold(默认 2,同根因 ≥2 才立项,
 *     Cursor/Anthropic 准则:一次性意外不沉淀)才产出候选提案;
 *  4. 归因分流(Devin 口诀)—— 环境坏/上下文跑偏 → 建议「重启+全量指令」,不生成提案。
 *
 * 模型调用全部经 ModelCaller(可配置路由,默认 deepseek-flash;单测全部 mock,绝不真实调用)。
 */
import { parseJsonLoose, resolveRoutes } from './models.ts'
import type { ModelCaller, ModelRoute, ModelRoutes } from './models.ts'

/** observe evolve_signal 的消费子集(结构兼容 @basis/observe 的 EvolveSignal)。 */
export interface SignalLike {
  readonly id: number | string
  readonly ts: number
  readonly packId: string
  readonly kind: string
  readonly ref: string
  readonly payload: {
    readonly summary: string
    readonly tags: readonly string[]
    readonly trajectoryHash?: string
  }
}

/** MAST 三类(设计 10 §3 的落地口径:spec 缺陷 / agent 间失配 / 验证缺失)。 */
export type MastCategory = 'spec-defect' | 'agent-mismatch' | 'verification-missing'

/** MAST 14 模式 rubric(3 类;F 编号对齐 MAST 论文口径,语义用于提示词与回落启发)。 */
export interface MastPattern {
  readonly code: string
  readonly category: MastCategory
  readonly label: string
  /** 回落启发:信号 summary/tags 命中任一关键词 → 该模式候选(模型不可用时的确定性兜底)。 */
  readonly keywords: readonly string[]
}

export const MAST_PATTERNS: readonly MastPattern[] = [
  // ── spec-defect:规范缺陷(Specification & Integration)──────────────────
  { code: 'F1', category: 'spec-defect', label: '规范含糊(specification ambiguities)', keywords: ['含糊', '歧义', '不明确', 'ambiguous', 'underspecified'] },
  { code: 'F2', category: 'spec-defect', label: '规范违背(specification compliance)', keywords: ['违背', '不合规', '违反', 'compliance', '违规'] },
  { code: 'F3', category: 'spec-defect', label: '集成协调失效(integration & coordination)', keywords: ['集成', '协调', '对接失败', 'integration', 'coordination'] },
  { code: 'F7', category: 'spec-defect', label: '优先级/范围失控(task prioritization & scope)', keywords: ['超范围', '范围失控', '优先级', 'scope', 'prioritization'] },
  // ── agent-mismatch:agent 间失配(Inter/Intra-agent + Identity)───────────
  { code: 'F4', category: 'agent-mismatch', label: '逻辑错误(logical errors)', keywords: ['逻辑', '算错', '推断', 'logical', 'reasoning'] },
  { code: 'F5', category: 'agent-mismatch', label: '模型知识缺口(model knowledge gap)', keywords: ['不知道', '知识缺', '没查到', 'knowledge', 'hallucination', '幻觉'] },
  { code: 'F6', category: 'agent-mismatch', label: '因果误判(false cause-effect)', keywords: ['因果', '误判', '错归因', 'cause'] },
  { code: 'F8', category: 'agent-mismatch', label: '身份误述(identity misrepresentation)', keywords: ['身份', '冒充', 'identity'] },
  { code: 'F9', category: 'agent-mismatch', label: '偏好/价值失配(preference misalignment)', keywords: ['偏好', '用户不满', '风格', 'preference'] },
  { code: 'F10', category: 'agent-mismatch', label: '目标劫持(objective hijacking)', keywords: ['劫持', '跑偏', '偏题', 'hijack'] },
  // ── verification-missing:验证缺失(Verification & Accountability)────────
  { code: 'F11', category: 'verification-missing', label: '视界互懂失败(horizon intercomprehension)', keywords: ['上下文丢失', '跨会话', 'horizon'] },
  { code: 'F12', category: 'verification-missing', label: '虚构行为(confabulation)', keywords: ['虚构', '编造', 'confabulation', '捏造'] },
  { code: 'F13', category: 'verification-missing', label: '关键参数无知(critical parameter ignorance)', keywords: ['参数', '配置错', 'parameter'] },
  { code: 'F14', category: 'verification-missing', label: '自相矛盾(self-contradiction)', keywords: ['矛盾', '前后不一', 'contradiction'] },
]

/** 归因结论(Devin 口诀的分流落点;环境类不进提案)。 */
export type RootCause =
  | 'knowledge-missing' // 知识缺 → curator 出 skill/knowledge delta
  | 'process-wrong' // 流程错 → skill 步骤修正
  | 'tool-gap' // 工具差 → 领域工具补齐(L2 范畴,提案里只记录)
  | 'spec-unclear' // 规范不清 → golden/persona 层修正
  | 'environment-broken' // 环境坏 → 重启+全量指令,不生成提案
  | 'context-drift' // 上下文跑偏 → 重启+全量指令,不生成提案

/** 单个信号簇(同一失败模式的聚合)。 */
export interface SignalCluster {
  /** 聚类键:trajectory_hash 或 kind+归一化摘要签名。 */
  readonly key: string
  readonly signals: readonly SignalLike[]
  readonly count: number
  readonly kinds: readonly string[]
  /** 簇内最早/最晚信号 ts。 */
  readonly firstTs: number
  readonly lastTs: number
}

/** reflector 对单个簇的归因产物。 */
export interface ClusterAnalysis {
  readonly cluster: SignalCluster
  /** MAST 打标(模型或回落启发给出的 code;非法值归 F1 并在 notes 说明)。 */
  readonly mast: MastPattern
  readonly rootCause: RootCause
  /** 模型归因一句话(进账本 mast_label 与周报)。 */
  readonly rationale: string
  /** 打标来源:模型 or 回落启发(审计用)。 */
  readonly labelSource: 'model' | 'heuristic'
  readonly modelError?: string
}

export interface ReflectorCandidate {
  readonly analysis: ClusterAnalysis
  /** 建议提案对象(进化对象矩阵 09 §3:默认 skill 正文 delta)。 */
  readonly suggestKind: 'skill' | 'knowledge' | 'rule' | 'memory'
  readonly packId: string
}

export interface ReflectorReport {
  /** 过重复度阈值的簇(交 curator 起草)。 */
  readonly candidates: readonly ReflectorCandidate[]
  /** 未过阈值/环境类被分流的簇(周报呈现,不立项)。 */
  readonly rejected: readonly { readonly analysis: ClusterAnalysis; readonly reason: 'below-repeat-threshold' | 'no-proposal-env' }[]
  /** reflector 模型调用情况(mock/真实调用审计)。 */
  readonly modelCalls: number
}

export interface ReflectOptions {
  /** 同一失败模式 ≥N 次才立项(默认 2;设计 10 §1 trigger.repeatThreshold)。 */
  readonly repeatThreshold?: number
  /** 模型调用接口;缺省不调模型(纯启发式回落 —— 测试与离线降级用)。 */
  readonly caller?: ModelCaller
  /** 模型角色路由覆写(缺省 deepseek-flash;reflector 角色在此消费)。 */
  readonly routes?: ModelRoutes
  readonly now?: () => number
}

// ── 聚类(纯函数)──────────────────────────────────────────────────────────

/** 聚类键:trajectory_hash 优先;缺失回落 kind + 归一化摘要(小写/去空白/截断)。 */
export function clusterKeyOf(signal: SignalLike): string {
  const hash = signal.payload.trajectoryHash
  if (hash !== undefined && hash.length > 0) return `traj:${hash}`
  return `sig:${signal.kind}:${normalizeSummary(signal.payload.summary)}`
}

function normalizeSummary(summary: string): string {
  return summary.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80)
}

/** 簇内信号排序聚合成簇(count 降序)。 */
export function clusterSignals(signals: readonly SignalLike[]): readonly SignalCluster[] {
  const groups = new Map<string, SignalLike[]>()
  for (const signal of signals) {
    const key = clusterKeyOf(signal)
    const bucket = groups.get(key)
    if (bucket === undefined) groups.set(key, [signal])
    else bucket.push(signal)
  }
  return [...groups.entries()]
    .map(([key, bucket]) => ({
      key,
      signals: [...bucket].sort((a, b) => a.ts - b.ts),
      count: bucket.length,
      kinds: [...new Set(bucket.map(s => s.kind))],
      firstTs: bucket[0]?.ts ?? 0,
      lastTs: bucket[bucket.length - 1]?.ts ?? 0,
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

// ── 打标回落(确定性启发;模型不可用时保证流水线可降级运行)──────────────

/** 关键词启发打标:summary+tags 命中模式关键词;零命中归 F1(规范含糊,保守)。 */
export function heuristicLabel(cluster: SignalCluster): { mast: MastPattern; rationale: string } {
  const text = cluster.signals
    .map(s => `${s.payload.summary} ${s.payload.tags.join(' ')}`)
    .join('\n')
    .toLowerCase()
  for (const pattern of MAST_PATTERNS) {
    if (pattern.keywords.some(kw => text.includes(kw.toLowerCase()))) {
      return { mast: pattern, rationale: `启发式打标:命中关键词(${pattern.code} ${pattern.label})` }
    }
  }
  const fallback = MAST_PATTERNS.find(p => p.code === 'F1')
  if (fallback === undefined) throw new Error('[evolve] MAST rubric 缺 F1(内部错误)')
  return { mast: fallback, rationale: '启发式打标:零关键词命中,保守归 F1 规范含糊' }
}

// ── reflect 主流程 ─────────────────────────────────────────────────────────

/** 反思一个窗口期信号集:聚类 → 打标 → 重复度阈值 → 归因分流。 */
export async function reflect(signals: readonly SignalLike[], options: ReflectOptions = {}): Promise<ReflectorReport> {
  const threshold = options.repeatThreshold ?? 2
  const caller = options.caller
  const route = resolveRoutes(options.routes).reflector
  const candidates: ReflectorCandidate[] = []
  const rejected: { analysis: ClusterAnalysis; reason: 'below-repeat-threshold' | 'no-proposal-env' }[] = []
  let modelCalls = 0

  for (const cluster of clusterSignals(signals)) {
    const outcome = caller !== undefined
      ? await analyzeWithModel(cluster, caller, route)
      : heuristicOutcome(cluster)
    modelCalls += outcome.modelCallCount
    const analysis = outcome.result
    if (analysis.rootCause === 'environment-broken' || analysis.rootCause === 'context-drift') {
      // Devin 口诀:环境坏/上下文偏 → 重启+全量指令,不生成知识提案(09 §1)。
      rejected.push({ analysis, reason: 'no-proposal-env' })
      continue
    }
    if (cluster.count < threshold) {
      rejected.push({ analysis, reason: 'below-repeat-threshold' })
      continue
    }
    candidates.push({
      analysis,
      suggestKind: suggestKindOf(analysis.rootCause),
      packId: cluster.signals[0]?.packId ?? '',
    })
  }
  return { candidates, rejected, modelCalls }
}

interface AnalysisOutcome {
  readonly result: ClusterAnalysis
  readonly modelCallCount: number
}

async function analyzeWithModel(cluster: SignalCluster, caller: ModelCaller, route: ModelRoute): Promise<AnalysisOutcome> {
  try {
    const raw = await caller.call({
      route,
      system: REFLECTOR_SYSTEM_PROMPT,
      json: true,
      messages: [{
        role: 'user',
        content: JSON.stringify({
          cluster_key: cluster.key,
          count: cluster.count,
          kinds: cluster.kinds,
          summaries: cluster.signals.map(s => s.payload.summary),
          tags: cluster.signals.flatMap(s => [...s.payload.tags]),
        }),
      }],
    })
    const parsed = parseJsonLoose(raw)
    if (typeof parsed !== 'object' || parsed === null) throw new Error('模型输出不是 JSON 对象')
    const row = parsed as Record<string, unknown>
    const mast = MAST_PATTERNS.find(p => p.code === row['mast'])
    if (mast === undefined) throw new Error(`模型输出的 mast "${String(row['mast'])}" 不在 rubric F1-F14`)
    const rootCause = ROOT_CAUSES.find(r => r === row['root_cause'])
    if (rootCause === undefined) throw new Error(`模型输出的 root_cause "${String(row['root_cause'])}" 非法`)
    return {
      modelCallCount: 1,
      result: {
        cluster,
        mast,
        rootCause,
        rationale: typeof row['rationale'] === 'string' && row['rationale'].length > 0
          ? row['rationale']
          : `模型打标:${mast.code} ${mast.label}`,
        labelSource: 'model',
      },
    }
  } catch (cause) {
    // 模型失败不拖垮流水线:确定性启发回落,标记 labelSource=heuristic 供审计。
    const fallback = heuristicOutcome(cluster)
    return {
      modelCallCount: 1,
      result: { ...fallback.result, labelSource: 'heuristic', modelError: cause instanceof Error ? cause.message : String(cause) },
    }
  }
}

function heuristicOutcome(cluster: SignalCluster): AnalysisOutcome {
  const { mast, rationale } = heuristicLabel(cluster)
  return {
    modelCallCount: 0,
    result: {
      cluster,
      mast,
      rootCause: rootCauseOfCategory(mast.category),
      rationale,
      labelSource: 'heuristic',
    },
  }
}

const ROOT_CAUSES: readonly RootCause[] = [
  'knowledge-missing', 'process-wrong', 'tool-gap', 'spec-unclear', 'environment-broken', 'context-drift',
]

function rootCauseOfCategory(category: MastCategory): RootCause {
  switch (category) {
    case 'spec-defect': return 'spec-unclear'
    case 'agent-mismatch': return 'knowledge-missing'
    case 'verification-missing': return 'process-wrong'
  }
}

function suggestKindOf(cause: RootCause): ReflectorCandidate['suggestKind'] {
  switch (cause) {
    case 'knowledge-missing': return 'skill'
    case 'process-wrong': return 'skill'
    case 'spec-unclear': return 'rule'
    case 'tool-gap': return 'knowledge'
    case 'environment-broken': return 'skill' // 已在上方分流,不会到达
    case 'context-drift': return 'skill' // 已在上方分流,不会到达
  }
}

const REFLECTOR_SYSTEM_PROMPT = `你是 agent 自进化流水线的反思归因器(reflector)。
输入是一个失败信号簇(JSON)。请输出严格 JSON:
{ "mast": "F1"…"F14", "root_cause": "knowledge-missing|process-wrong|tool-gap|spec-unclear|environment-broken|context-drift", "rationale": "一句话归因" }
MAST 三类 14 模式:
- spec-defect(规范缺陷): F1 规范含糊 / F2 规范违背 / F3 集成协调失效 / F7 优先级范围失控
- agent-mismatch(agent 间失配): F4 逻辑错误 / F5 模型知识缺口 / F6 因果误判 / F8 身份误述 / F9 偏好失配 / F10 目标劫持
- verification-missing(验证缺失): F11 视界互懂失败 / F12 虚构行为 / F13 关键参数无知 / F14 自相矛盾
归因纪律(先归因再写入):失败源于环境坏/上下文跑偏时,root_cause 必须给 environment-broken/context-drift(正确动作是重启+全量指令,不是沉淀知识)。`
