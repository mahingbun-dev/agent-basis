/**
 * curator:提案起草器(设计 10 §4;09 §1 阶段③)。
 *
 * 输入 reflector 的候选簇,产出 skill delta 提案(ACE 条目化操作列表,非重写):
 * - 无关条目(全新失败模式)→ add_entry(条目正文由 curator 模型蒸馏失败轨迹;
 *   模型不可用 → 确定性模板回落,保证离线/降级可跑);
 * - 已有相关条目 → update_entry(改写)或 bump_counter(命中即加分);
 * - 血缘 origin 记录来源信号 id(账本与条目 meta 双侧可溯)。
 *
 * 模型调用统一走 ModelCaller(curator 角色路由可配置,默认 deepseek-flash;
 * 单测全部注入 mock,绝不真实调用)。起草产物是「提案」,必须过 G0/G1/G2 门禁
 * 与人审才落盘(gates.ts + pipeline.ts)。
 */
import { parseJsonLoose, resolveRoutes } from './models.ts'
import type { ModelCaller, ModelRoutes } from './models.ts'
import type { ReflectorCandidate } from './reflector.ts'
import type { SkillDelta } from './deltas.ts'
import type { SkillDoc } from './entry.ts'

/** 一份进化提案(curator 产物;进账本的是它的序列化描述)。 */
export interface EvolutionProposal {
  readonly packId: string
  /** 目标 SKILL.md 相对 pack 根路径(如 skills/core-workflow/SKILL.md)。 */
  readonly skillPath: string
  readonly deltas: readonly SkillDelta[]
  /** 一句话动机(账本 proposalRef 的人读部分)。 */
  readonly rationale: string
  /** 血缘:触发信号 id(observe evolve_signal.id)。 */
  readonly signalIds: readonly string[]
  /** MAST 标签(reflector 归因,账本 mast_label)。 */
  readonly mastLabel: string
  /** 起草来源:模型 or 模板回落(审计)。 */
  readonly draftSource: 'model' | 'template'
  readonly modelError?: string
}

export interface CurateOptions {
  /** curator 模型调用接口;缺省纯模板起草(降级/测试)。 */
  readonly caller?: ModelCaller
  readonly routes?: ModelRoutes
  readonly date: string
  /** 目标 skill 文档(curator 读现有条目决定 add 还是 update/bump)。 */
  readonly doc: SkillDoc
  readonly skillPath: string
}

/** 起草一个候选簇的 skill delta 提案(ACE 操作列表)。 */
export async function curateSkillDelta(
  candidate: ReflectorCandidate,
  options: CurateOptions,
): Promise<EvolutionProposal> {
  const route = resolveRoutes(options.routes).curator
  const signalIds = candidate.analysis.cluster.signals.map(s => String(s.id))
  const origin = signalIds.join('+')
  const fallback = draftTemplate(candidate, origin, options.date)
  if (options.caller === undefined) {
    return { ...fallback, skillPath: options.skillPath, signalIds, mastLabel: candidate.analysis.mast.code }
  }
  try {
    const raw = await options.caller.call({
      route,
      system: CURATOR_SYSTEM_PROMPT,
      json: true,
      messages: [{
        role: 'user',
        content: JSON.stringify({
          skill: options.doc.name,
          rationale: candidate.analysis.rationale,
          mast: candidate.analysis.mast.code,
          root_cause: candidate.analysis.rootCause,
          failure_summaries: candidate.analysis.cluster.signals.map(s => s.payload.summary),
          existing_entries: options.doc.entries.map(e => ({ id: e.meta.id, body: e.body.slice(0, 400), deprecated: e.deprecated })),
        }),
      }],
    })
    const parsed = parseJsonLoose(raw)
    if (typeof parsed !== 'object' || parsed === null) throw new Error('模型输出不是 JSON 对象')
    const row = parsed as Record<string, unknown>
    const action = row['action']
    if (action === 'add_entry') {
      const body = typeof row['body'] === 'string' ? row['body'] : ''
      if (body.trim().length === 0) throw new Error('add_entry 缺 body')
      return {
        packId: candidate.packId,
        skillPath: options.skillPath,
        deltas: [{ type: 'add_entry', body, origin, date: options.date }],
        rationale: typeof row['rationale'] === 'string' && row['rationale'].length > 0
          ? row['rationale']
          : candidate.analysis.rationale,
        signalIds,
        mastLabel: candidate.analysis.mast.code,
        draftSource: 'model',
      }
    }
    if (action === 'update_entry' || action === 'bump_counter') {
      const id = typeof row['id'] === 'string' ? row['id'] : ''
      const existing = options.doc.entries.find(e => e.meta.id === id && !e.deprecated)
      if (existing === undefined) throw new Error(`${action} 的 id "${id}" 不是本 skill 的活跃条目`)
      if (action === 'bump_counter') {
        return {
          packId: candidate.packId,
          skillPath: options.skillPath,
          deltas: [{ type: 'bump_counter', id, counter: 'helpful', date: options.date }],
          rationale: `条目 ${id} 再次命中同类场景,helpful+1`,
          signalIds,
          mastLabel: candidate.analysis.mast.code,
          draftSource: 'model',
        }
      }
      const body = typeof row['body'] === 'string' ? row['body'] : ''
      if (body.trim().length === 0) throw new Error('update_entry 缺 body')
      return {
        packId: candidate.packId,
        skillPath: options.skillPath,
        deltas: [{ type: 'update_entry', id, body, date: options.date }],
        rationale: typeof row['rationale'] === 'string' && row['rationale'].length > 0
          ? row['rationale']
          : candidate.analysis.rationale,
        signalIds,
        mastLabel: candidate.analysis.mast.code,
        draftSource: 'model',
      }
    }
    throw new Error(`模型输出的 action "${String(action)}" 非法(add_entry|update_entry|bump_counter)`)
  } catch (cause) {
    return {
      ...fallback,
      skillPath: options.skillPath,
      signalIds,
      mastLabel: candidate.analysis.mast.code,
      modelError: cause instanceof Error ? cause.message : String(cause),
    }
  }
}

/** 模板起草(确定性回落):add_entry,正文 = 失败摘要蒸馏的保守模板。 */
function draftTemplate(candidate: ReflectorCandidate, origin: string, date: string): Omit<EvolutionProposal, 'signalIds' | 'mastLabel' | 'skillPath'> {
  const first = candidate.analysis.cluster.signals[0]?.payload.summary ?? ''
  return {
    packId: candidate.packId,
    deltas: [{
      type: 'add_entry',
      body: [
        `- ${candidate.analysis.mast.label}:${first}`,
        `- 处置口径(${candidate.analysis.rootCause}):按 ${candidate.analysis.mast.code} 归因处置;同类场景先核对本条再执行。`,
        '- (模板起草:本条正文由 curator 模型改写后过 G0/G1/G2 门禁与人审合并。)',
      ].join('\n'),
      origin,
      date,
    }],
    rationale: `模板起草:${candidate.analysis.mast.code} ${candidate.analysis.mast.label},来源 ${origin}`,
    draftSource: 'template',
  }
}

const CURATOR_SYSTEM_PROMPT = `你是 agent 自进化流水线的提案起草器(curator)。
输入是一个失败簇的归因结论(JSON)。请输出严格 JSON 之一:
{ "action": "add_entry", "body": "新条目正文(可执行的行为指令,2-5 行)", "rationale": "一句话动机" }
{ "action": "update_entry", "id": "S-xxx-nnn", "body": "改写后的完整正文", "rationale": "..." }
{ "action": "bump_counter", "id": "S-xxx-nnn" }
起草纪律:
- 只许增量 delta,禁止重写整个 skill(单体重写会 context collapse);
- 正文是给未来 agent 读的行为指令:结论先行、可执行、不复述失败故事;
- 已有高度相关活跃条目时优先 update/bump,不重复 add(语义去重)。`
