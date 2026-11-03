/**
 * reflector / curator 单测:模型调用全部注入 mock(绝不真实调用)。
 * 断言:同根因 ≥2 才立项 / 环境类分流不立项 / 模型失败启发回落 / 起草双路。
 */
import { describe, expect, it } from 'vitest'
import {
  applyDeltas, clusterSignals, curateSkillDelta, heuristicLabel, MAST_PATTERNS, reflect,
} from '../src/index.ts'
import type { ModelCaller, SignalLike, SkillDoc } from '../src/index.ts'
import { DEMO_SKILL_MD, SKILL_REL } from './helpers.ts'
import { parseSkillDoc } from '../src/index.ts'

// ── mock 工厂 ───────────────────────────────────────────────────────────────

interface MockCall { route: string; system?: string | undefined }

function mockCaller(response: () => string): ModelCaller & { calls: MockCall[] } {
  const calls: MockCall[] = []
  return {
    calls,
    async call(input) {
      calls.push({ route: `${input.route.provider}/${input.route.model}`, system: input.system?.slice(0, 20) })
      return response()
    },
  }
}

function signal(id: number, summary: string, trajectoryHash?: string, kind = 'feedback_low'): SignalLike {
  return {
    id,
    ts: 1000 + id,
    packId: '@evodemo/pack',
    kind,
    ref: `ref-${id}`,
    payload: {
      summary,
      tags: ['demo'],
      ...(trajectoryHash !== undefined ? { trajectoryHash } : {}),
    },
  }
}

describe('聚类与打标', () => {
  it('trajectory_hash 优先聚类;缺失回落 kind+归一化摘要签名', () => {
    const clusters = clusterSignals([
      signal(1, '预算变更未走审批', 'traj-A'),
      signal(2, '预算变更未走审批(重试)', 'traj-A'),
      signal(3, '交付物缺终态断言'),
      signal(4, '交付物缺终态断言'),
      signal(5, '完全另一件事', 'traj-B'),
    ])
    const byCount = new Map(clusters.map(c => [c.key, c.count]))
    expect(byCount.get('traj:traj-A')).toBe(2)
    expect(byCount.get('sig:feedback_low:交付物缺终态断言')).toBe(2)
    expect(byCount.get('traj:traj-B')).toBe(1)
    expect(clusters[0]?.count).toBe(2) // count 降序
  })

  it('MAST rubric:3 类 14 模式;关键词启发命中', () => {
    const categories = new Set(MAST_PATTERNS.map(p => p.category))
    expect(categories).toEqual(new Set(['spec-defect', 'agent-mismatch', 'verification-missing']))
    expect(MAST_PATTERNS).toHaveLength(14)
    const labelled = heuristicLabel(clusterSignals([signal(1, '幻觉:引用了不存在的知识')])[0]!)
    expect(labelled.mast.code).toBe('F5')
    const none = heuristicLabel(clusterSignals([signal(1, 'zzz')])[0]!)
    expect(none.mast.code).toBe('F1') // 零命中保守归规范含糊
  })
})

describe('reflect:重复度阈值与归因分流', () => {
  it('同根因 ≥2 才立项:单次簇被拒(below-repeat-threshold)', async () => {
    const once = await reflect([signal(1, '预算变更未走审批', 'traj-A')])
    expect(once.candidates).toHaveLength(0)
    expect(once.rejected.map(r => r.reason)).toContain('below-repeat-threshold')

    const twice = await reflect([
      signal(1, '预算变更未走审批', 'traj-A'),
      signal(2, '预算变更未走审批(重试)', 'traj-A'),
    ])
    expect(twice.candidates).toHaveLength(1)
    expect(twice.candidates[0]?.analysis.cluster.count).toBe(2)
  })

  it('mock caller 打标:模型输出 F5/knowledge-missing,走配置路由(非默认)', async () => {
    const caller = mockCaller(() => JSON.stringify({ mast: 'F5', root_cause: 'knowledge-missing', rationale: '缺预算变更处置知识' }))
    const report = await reflect(
      [signal(1, 'x', 'traj-A'), signal(2, 'y', 'traj-A')],
      {
        caller,
        routes: { reflector: { provider: 'deepseek', model: 'deepseek-pro' } },
      },
    )
    expect(report.modelCalls).toBe(1)
    expect(report.candidates[0]?.analysis.mast.code).toBe('F5')
    expect(report.candidates[0]?.analysis.rootCause).toBe('knowledge-missing')
    expect(report.candidates[0]?.analysis.labelSource).toBe('model')
    expect(caller.calls[0]?.route).toBe('deepseek/deepseek-pro') // 可配置路由真实生效
  })

  it('环境类分流:environment-broken → 不立项(先归因再写入)', async () => {
    const caller = mockCaller(() => JSON.stringify({ mast: 'F13', root_cause: 'environment-broken', rationale: '沙箱坏了' }))
    const report = await reflect([signal(1, 'x', 'traj-E'), signal(2, 'y', 'traj-E')], { caller })
    expect(report.candidates).toHaveLength(0)
    expect(report.rejected.map(r => r.reason)).toContain('no-proposal-env')
    expect(report.rejected[0]?.analysis.rationale).toBe('沙箱坏了')
  })

  it('模型失败/输出非法 → 启发式回落,流水线不崩', async () => {
    const broken = mockCaller(() => {
      throw new Error('mock 网络错误')
    })
    const report = await reflect([signal(1, '幻觉引用', 'traj-F'), signal(2, '幻觉引用', 'traj-F')], { caller: broken })
    expect(report.candidates).toHaveLength(1)
    const candidate = report.candidates[0]
    expect(candidate?.analysis.labelSource).toBe('heuristic')
    expect(candidate?.analysis.modelError).toContain('mock 网络错误')

    const garbage = mockCaller(() => '这不是 JSON')
    const report2 = await reflect([signal(3, '幻觉引用', 'traj-G'), signal(4, '幻觉引用', 'traj-G')], { caller: garbage })
    expect(report2.candidates[0]?.analysis.labelSource).toBe('heuristic')
  })

  it('caller 缺省:纯启发式,零模型调用', async () => {
    const report = await reflect([signal(1, '幻觉引用', 'traj-H'), signal(2, '幻觉引用', 'traj-H')])
    expect(report.modelCalls).toBe(0)
    expect(report.candidates[0]?.analysis.mast.code).toBe('F5')
  })
})

describe('curator:起草', () => {
  const doc = parseOfDemo()

  it('mock curator:add_entry 起草,origin 记信号血缘', async () => {
    const report = await reflect([
      signal(11, '预算变更未走审批', 'traj-A'),
      signal(12, '预算变更未走审批', 'traj-A'),
    ], { caller: mockCaller(() => JSON.stringify({ mast: 'F5', root_cause: 'knowledge-missing', rationale: 'r' })) })
    const candidate = report.candidates[0]
    expect(candidate).toBeDefined()
    if (candidate === undefined) return
    const caller = mockCaller(() => JSON.stringify({ action: 'add_entry', body: '预算变更先走 R3 审批。', rationale: '补处置知识' }))
    const proposal = await curateSkillDelta(candidate, { caller, date: '2026-11-03', doc, skillPath: SKILL_REL })
    expect(proposal.draftSource).toBe('model')
    expect(proposal.deltas[0]).toMatchObject({ type: 'add_entry', origin: '11+12' })
    expect(proposal.signalIds).toEqual(['11', '12'])
    expect(proposal.mastLabel).toBe('F5')
    expect(proposal.skillPath).toBe(SKILL_REL)
  })

  it('mock curator:bump_counter 限本 skill 活跃条目', async () => {
    const candidate = (await reflect([
      signal(11, '预算变更未走审批', 'traj-A'),
      signal(12, '预算变更未走审批', 'traj-A'),
    ], { caller: mockCaller(() => JSON.stringify({ mast: 'F5', root_cause: 'knowledge-missing' })) })).candidates[0]
    expect(candidate).toBeDefined()
    if (candidate === undefined) return
    const bumpCaller = mockCaller(() => JSON.stringify({ action: 'bump_counter', id: 'S-core-workflow-001' }))
    const proposal = await curateSkillDelta(candidate, { caller: bumpCaller, date: '2026-11-03', doc, skillPath: SKILL_REL })
    expect(proposal.deltas[0]).toMatchObject({ type: 'bump_counter', id: 'S-core-workflow-001', counter: 'helpful' })

    const badIdCaller = mockCaller(() => JSON.stringify({ action: 'bump_counter', id: 'S-other-999' }))
    const fallback = await curateSkillDelta(candidate, { caller: badIdCaller, date: '2026-11-03', doc, skillPath: SKILL_REL })
    expect(fallback.draftSource).toBe('template') // 非法 id → 模板回落
    expect(fallback.modelError).toContain('S-other-999')
  })

  it('caller 缺省:模板起草(add_entry),产物可被 applyDeltas 成功应用', async () => {
    const candidate = (await reflect([
      signal(21, '预算变更未走审批', 'traj-T'),
      signal(22, '预算变更未走审批', 'traj-T'),
    ])).candidates[0]
    expect(candidate).toBeDefined()
    if (candidate === undefined) return
    const proposal = await curateSkillDelta(candidate, { date: '2026-11-03', doc, skillPath: SKILL_REL })
    expect(proposal.draftSource).toBe('template')
    expect(proposal.deltas[0]?.type).toBe('add_entry')
    // 模板提案是可直接应用的完整 delta(离线降级路径可用)
    const applied = applyDeltas(doc, proposal.deltas)
    expect(applied.ok).toBe(true)
  })
})

function parseOfDemo(): SkillDoc {
  const parsed = parseSkillDoc(DEMO_SKILL_MD)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.doc
}
