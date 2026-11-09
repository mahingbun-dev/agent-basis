/**
 * fixture skill 端到端(任务 T10 验收口径):
 * 制造失败信号(observe SignalStore)→ 提案 delta(reflector+curator 全 mock)
 * → mock 门禁通过(G0/G1 真跑,G2 注入 runner)→ 账本 release 记录
 * → deprecate 后解析器不再输出该条目(归档保留供溯源)+ 账本 supersession。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { SignalStore } from '@eterna/observe'
import {
  activeEntries, applyDeltas, approveAndRelease, archivedEntries, createEvolution, effectOf,
  EVOLVE_SERVICE_ID, parseSkillDoc, renderSkillDoc, runEvolutionCycle, runGate0,
} from '../src/index.ts'
import type { ModelCaller } from '../src/index.ts'
import { makeDemoPack, rmPack, SKILL_REL } from './helpers.ts'
import type { DemoPack } from './helpers.ts'

let demo: DemoPack
let workRoot: string
let ledgerPath = ''

beforeAll(async () => {
  demo = await makeDemoPack()
  workRoot = await fs.mkdtemp(path.join(path.dirname(demo.rootDir), 'eterna-evolve-e2e-'))
  ledgerPath = path.join(workRoot, 'ledger.db')
})

afterAll(async () => {
  await rmPack(demo)
  await fs.rm(workRoot, { recursive: true, force: true })
})

/** mock caller:第 1 次调用 = reflecter 打标,第 2 次 = curator 起草(绝不真实调用)。 */
function e2eMockCaller(): ModelCaller & { calls: number } {
  let calls = 0
  return {
    get calls() {
      return calls
    },
    async call(input) {
      calls += 1
      if (calls === 1) {
        expect(input.route).toEqual({ provider: 'deepseek', model: 'deepseek-flash' }) // 默认路由
        return JSON.stringify({ mast: 'F5', root_cause: 'knowledge-missing', rationale: '缺「预算变更走 R3 审批」处置知识' })
      }
      return JSON.stringify({
        action: 'add_entry',
        body: '预算变更(追加/削减 ≥10%)先走 R3 审批拿到书面确认,再调整方案与合同金额。',
        rationale: '两次失败同因:预算变更被静默执行',
      })
    },
  }
}

describe('端到端:失败信号 → 提案 → 门禁 → release → deprecate', () => {
  const caller = e2eMockCaller()
  const store = new SignalStore(':memory:')

  it('① 制造失败信号:两条同轨迹 feedback_low(observe SignalStore,(kind,ref) 去重)', () => {
    const first = store.enqueue({
      packId: '@evodemo/pack',
      kind: 'feedback_low',
      ref: 'feedback:msg-101',
      payload: { summary: '预算变更未走审批直接改了方案', tags: ['budget', 'approval'], trajectoryHash: 'traj-budget-r3' },
    })
    const second = store.enqueue({
      packId: '@evodemo/pack',
      kind: 'feedback_low',
      ref: 'feedback:msg-118',
      payload: { summary: '预算变更未走审批直接改了方案(再次发生)', tags: ['budget', 'approval'], trajectoryHash: 'traj-budget-r3' },
    })
    const replayed = store.enqueue({
      packId: '@evodemo/pack',
      kind: 'feedback_low',
      ref: 'feedback:msg-101', // 同 (kind, ref) 重放
      payload: { summary: '重放不产生重复信号', tags: [], trajectoryHash: 'traj-budget-r3' },
    })
    expect(first.reason).toBe('enqueued')
    expect(second.reason).toBe('enqueued')
    expect(replayed.reason).toBe('duplicate')
    expect(store.count()).toBe(2)
  })

  let outcomeAppliedText = ''
  let ledgerId = 0

  it('②③④ 进化周期:reflect(≥2 立项)→ curate(add_entry)→ gates(G0/G1 真跑 + G2 mock 0)→ 账本 verified', async () => {
    const { LedgerStore } = await import('../src/index.ts')
    const ledger = new LedgerStore(ledgerPath)
    const result = await runEvolutionCycle({
      packDir: demo.packDir,
      packId: '@evodemo/pack',
      skillPath: SKILL_REL,
      signals: [...store.list()],
      date: '2026-11-03',
      caller,
      ledger,
      gateOutDir: path.join(workRoot, 'gates'),
      aievo: {
        baseUrl: 'https://aievo.example',
        tasks: { release: { name: 'task-release-gate' }, admission: { name: 'task-admission-gate' }, heldout: { name: 'task-heldout-gate' } },
        // G2 mock:门禁注入(真实执行可降级跳过;此处验证「mock 门禁通过」路径)
        runner: async () => ({ code: 0, stdout: 'gates all pass', stderr: '' }),
      },
    })
    ledger.close()

    // reflect:同根因 ≥2 才立项,恰好 1 个候选
    expect(result.reflector.candidates).toHaveLength(1)
    expect(result.reflector.candidates[0]?.analysis.mast.code).toBe('F5')
    expect(result.reflector.candidates[0]?.analysis.cluster.count).toBe(2)
    expect(result.reflector.modelCalls).toBe(1)

    // curate:add_entry 提案,血缘 = 两条信号 id
    expect(result.outcomes).toHaveLength(1)
    const outcome = result.outcomes[0]
    expect(outcome).toBeDefined()
    if (outcome === undefined) return
    expect(outcome.proposal.deltas[0]?.type).toBe('add_entry')
    expect(outcome.proposal.signalIds).toHaveLength(2)

    // gates:G0 packctl lint + G1 evals replay 真跑通过;G2 mock 全 0
    expect(outcome.gates?.verdict, outcome.gates?.g0.detail).toBe('pass')
    expect(outcome.gates?.g0.pass).toBe(true)
    expect(outcome.gates?.g1.pass).toBe(true)
    expect(outcome.gates?.g1.total).toBe(1)
    expect(outcome.gates?.g2.verdict).toBe('pass')

    // 应用产物存在,账本 verified 待人审
    expect(outcome.appliedText).toBeDefined()
    expect(outcome.ledgerStatus).toBe('verified')
    outcomeAppliedText = outcome.appliedText ?? ''
    ledgerId = outcome.ledgerId
    expect(caller.calls).toBe(2) // reflector 1 次 + curator 1 次,全程 mock
  })

  it('⑤ 发布落盘:写回 SKILL.md 后 G0 原样通过;解析器输出新条目', async () => {
    const skillPath = path.join(demo.packDir, SKILL_REL)
    await fs.writeFile(skillPath, outcomeAppliedText, 'utf8')
    expect(runGate0(demo.packDir).pass).toBe(true) // delta 后的 pack 仍零 error
    const parsed = parseSkillDoc(outcomeAppliedText)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const ids = activeEntries(parsed.doc).map(e => e.meta.id)
    expect(ids).toContain('S-core-workflow-003')
    const added = parsed.doc.entries.find(e => e.meta.id === 'S-core-workflow-003')
    expect(added?.body).toContain('R3 审批')
    expect(added?.meta.origin).toBe('1+2') // 信号 id 血缘
  })

  it('⑥ 账本 release:approved → released + effect 回填(lineage 完整)', async () => {
    const { LedgerStore } = await import('../src/index.ts')
    const ledger = new LedgerStore(ledgerPath)
    const released = approveAndRelease(ledger, ledgerId, {
      fromVersion: '0.1.0',
      toVersion: '0.1.1',
      tag: '@evodemo/pack-0.1.1',
      approver: 'sme-sunny',
    })
    expect(released.status).toBe('released')
    expect(released.release?.tag).toBe('@evodemo/pack-0.1.1')
    expect(released.release?.approver).toBe('sme-sunny')
    expect(released.verification?.g0.pass).toBe(true)
    expect(released.verification?.g2.detail).toContain('三层门禁')

    const withEffect = effectOf(ledger, ledgerId, {
      beforeMetrics: { golden_pass_rate: 0.8 },
      afterMetrics: { golden_pass_rate: 0.95 },
      reviewedAt: '2026-11-10',
    })
    expect(withEffect.effect?.afterMetrics['golden_pass_rate']).toBe(0.95)
    expect(ledger.lineage('@evodemo/pack').map(r => r.status)).toContain('released')
    ledger.close()
  })

  it('⑦ deprecate:新条目移入归档节,解析器不再输出(active 排除);账本 supersession 链', async () => {
    const skillPath = path.join(demo.packDir, SKILL_REL)
    const current = parseSkillDoc(await fs.readFile(skillPath, 'utf8'))
    expect(current.ok).toBe(true)
    if (!current.ok) return

    const deprecated = applyDeltas(current.doc, [{
      type: 'deprecate_entry',
      id: 'S-core-workflow-003',
      date: '2026-12-01',
      reason: 'prompt-audit:harmful≥3',
    }])
    expect(deprecated.ok).toBe(true)
    if (!deprecated.ok) return
    const deprecatedText = renderSkillDoc(deprecated.doc)
    await fs.writeFile(skillPath, deprecatedText, 'utf8')

    // 解析器不再输出该条目(active);归档保留正文供溯源;G0 仍过
    const reparsed = parseSkillDoc(deprecatedText)
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return
    expect(activeEntries(reparsed.doc).map(e => e.meta.id)).not.toContain('S-core-workflow-003')
    expect(activeEntries(reparsed.doc).map(e => e.meta.id)).toEqual(['S-core-workflow-001', 'S-core-workflow-002'])
    expect(archivedEntries(reparsed.doc).map(e => e.meta.id)).toEqual(['S-core-workflow-003'])
    expect(deprecatedText).toContain('R3 审批') // 物理保留
    expect(runGate0(demo.packDir).pass).toBe(true)

    // 账本侧:deprecate 提案立项,旧 release 记录被 superseded
    const { LedgerStore } = await import('../src/index.ts')
    const ledger = new LedgerStore(ledgerPath)
    const deprecateRecord = ledger.propose({
      pack: '@evodemo/pack',
      kind: 'skill',
      signalIds: ['audit:core-workflow:S-core-workflow-003:low-signal'],
      mastLabel: 'F14',
      proposalRef: `${SKILL_REL}:[deprecate_entry S-core-workflow-003] —— prompt-audit harmful≥3`,
    })
    const superseded = ledger.markSuperseded(ledgerId, deprecateRecord.id)
    expect(superseded.status).toBe('superseded')
    expect(superseded.supersededBy).toBe(deprecateRecord.id)
    const lineage = ledger.lineage('@evodemo/pack')
    expect(lineage.map(r => r.status)).toEqual(['superseded', 'proposed'])
    ledger.close()
  })
})

describe('组合门 createEvolution', () => {
  it('注册表 + 唯一 ID 形态;audit 转发;dispose 关账本', async () => {
    const evolution = createEvolution({ ledger: ':memory:' })
    expect(evolution.id).toBe(EVOLVE_SERVICE_ID)
    const report = evolution.audit(demo.packDir, { now: new Date('2026-11-03T00:00:00Z') })
    expect(report.packRoot).toBe(demo.packDir)
    expect(evolution.ledger.closed).toBe(false)
    evolution.dispose()
    expect(evolution.ledger.closed).toBe(true)
  })
})
