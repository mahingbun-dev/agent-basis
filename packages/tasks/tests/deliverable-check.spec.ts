/**
 * R2 分层门禁(35 号 A15 验收门禁;33 号 §1.3 G2-A4① 全条;24a A2 拍板分层):
 * - deliverable 结构校验**每单必跑**(纯程序,缺段不 ready):不过即 `failed('gate:structure')`,
 *   ready 不经未校验路径落库(worker 自述作废,24 §5.5-R2);
 * - 金集 replay **仅发布门禁与高风险抽样**触发:抽样判定 = Mandate basis.rules ∩
 *   settings.gates.highRiskRules(hitl.yaml R3 红线规则,26 §4.1);replay 面经端口注入
 *   (glue 适配 @eterna/evolve gates),未接线如实报 not-wired。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { EngineForExecutor, Ticket } from '../src/core/index.ts'
import {
  DEFAULT_DELIVERABLE_SPEC, GATE_CONTRACT_CLAUSE, GATE_STRUCTURE_REASON, TicketGates, UNWIRED_REPLAY_GATE,
  checkDeliverable, formatFindings, sampleReplay,
} from '../src/executor/gates.ts'
import { TICKET_FILES } from '../src/executor/workspace.ts'

describe('checkDeliverable:结构校验纯函数(每单必跑,缺段不 ready)', () => {
  it('内置默认 deliverable = R4 三产物(progress/决策/evidence)', () => {
    expect(DEFAULT_DELIVERABLE_SPEC.files.map(file => file.file)).toEqual([...Object.values(TICKET_FILES)])
  })

  it('缺文件/空文件/缺段逐条报违例;齐备即过(空违例数组)', () => {
    const spec = { files: [
      { file: 'report.md', sections: ['风险等级', '法条出处'] },
      { file: 'evidence.md' },
    ] }
    const read = (file: string): string | undefined =>
      file === 'report.md' ? '# 报告\n## 风险等级\n中\n' : file === 'evidence.md' ? '  \n\t ' : undefined
    expect(checkDeliverable(read, spec)).toEqual([
      { file: 'report.md', problem: 'section', section: '法条出处' },
      { file: 'evidence.md', problem: 'empty' },
    ])
    const full = (file: string): string | undefined =>
      file === 'report.md' ? '## 风险等级\n中\n## 法条出处\n§1\n' : 'proof'
    expect(checkDeliverable(full, spec)).toEqual([])
  })

  it('formatFindings 输出逐条可执行的缺什么文本', () => {
    expect(formatFindings([
      { file: 'progress.md', problem: 'missing' },
      { file: 'report.md', problem: 'section', section: '结论' },
    ])).toBe('progress.md is missing; report.md lacks the required section "结论"')
  })
})

/** fake Engine 的 report 面:记录调用并返回工单桩。 */
function fakeEngine() {
  const calls: { state: string; summary: string }[] = []
  const ticket = { id: 't-1' } as ReturnType<EngineForExecutor['report']>
  const engine = { report: vi.fn((_ticketId: string, report: { state: string; summary: string }) => {
    calls.push({ state: report.state, summary: report.summary })
    return ticket
  }) }
  return { engine: engine as unknown as Pick<EngineForExecutor, 'report'>, calls, ticket }
}

describe('TicketGates.report:ready 是唯一被拦的报告(24 §5.5-R2 worker 自述作废)', () => {
  it('ready + 缺产物 → 不落 ready,记 failed(gate:structure),摘要列缺什么', async () => {
    const gates = new TicketGates()
    const fake = fakeEngine()
    const result = await gates.report('t-1', { state: 'ready', summary: 'all done!' },
      { engine: fake.engine, workspaceDir: '/nonexistent' })
    expect(result).toMatchObject({ gated: true, passed: false })
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0]!.state).toBe('failed')
    expect(fake.calls[0]!.summary).toContain(GATE_STRUCTURE_REASON)
    expect(fake.calls[0]!.summary).toContain('progress.md is missing')
    // worker 的自述不出现在落库摘要:门禁判定替代自述。
    expect(fake.calls[0]!.summary).not.toContain('all done')
  })

  it('ready + 产物齐备(R4 三文件落盘)→ ready 原样落库(过门禁的 ready 才计数)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tasks-gate-'))
    try {
      const directory = join(root, '.ticket', 't-1')
      mkdirSync(directory, { recursive: true })
      for (const file of Object.values(TICKET_FILES)) writeFileSync(join(directory, file), '## 进展\nok\n', 'utf8')
      const gates = new TicketGates()
      const fake = fakeEngine()
      const result = await gates.report('t-1', { state: 'ready', summary: 'done' },
        { engine: fake.engine, workspaceDir: root })
      expect(result).toMatchObject({ gated: true, passed: true })
      expect(fake.calls).toEqual([{ state: 'ready', summary: 'done' }])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('非 ready 报告不设门,原样落库(门禁只判 ready;每单必跑指每个 ready 都过检)', async () => {
    const gates = new TicketGates()
    const fake = fakeEngine()
    const result = await gates.report('t-1', { state: 'progress', summary: 'halfway' },
      { engine: fake.engine, workspaceDir: '/nonexistent' })
    expect(result).toMatchObject({ gated: false })
    expect(fake.calls).toEqual([{ state: 'progress', summary: 'halfway' }])
  })

  it('自定义 spec(领域包 deliverable 段覆盖;26 §4.1 类型 seam)生效', async () => {
    const gates = new TicketGates({ spec: { files: [{ file: 'opinion.md', sections: ['风险等级'] }] } })
    const fake = fakeEngine()
    const result = await gates.report('t-1', { state: 'ready', summary: 'x' }, { engine: fake.engine, workspaceDir: '/nonexistent' })
    expect(result).toMatchObject({ gated: true, passed: false })
    expect(fake.calls[0]!.summary).toContain('opinion.md is missing')
  })
})

describe('金集 replay 抽样:仅高风险命中触发(24a A2;G2-A4②)', () => {
  const ticket = (rules?: string[]): Pick<Ticket, 'mandate'> => ({ mandate: {
    strength: 'explicit', policyVersion: 'v1', realm: 'r', actor: { source: 's', id: 'u' }, scope: 'x',
    basis: rules ? { via: 'admission', cell: 'listedUnaddressed', rules } : { via: 'addressed', addressed: 'mention' },
  } })

  it('Mandate basis.rules 命中高风险规则即抽中;未命中/无规则不抽', () => {
    expect(sampleReplay(ticket(['r-contract-r3']), ['r-contract-r3'])).toBe(true)
    expect(sampleReplay(ticket(['r-normal']), ['r-contract-r3'])).toBe(false)
    expect(sampleReplay(ticket(undefined), ['r-contract-r3'])).toBe(false)
    expect(sampleReplay(ticket(['r-normal']), [])).toBe(false)
  })

  it('TicketGates.replayOnce:抽中才调适配器;未抽样返回 undefined(不误报)', async () => {
    const replay = { run: vi.fn(async () => ({ pass: true, detail: 'replay 30 条全过' })) }
    const gates = new TicketGates({ highRiskRules: ['r3'], replay })
    await expect(gates.replayOnce(ticket(['r3']), 'packs/legal')).resolves.toEqual({ pass: true, detail: 'replay 30 条全过' })
    expect(replay.run).toHaveBeenCalledWith({ packDir: 'packs/legal' })
    await expect(gates.replayOnce(ticket(['r1']), 'packs/legal')).resolves.toBeUndefined()
    expect(replay.run).toHaveBeenCalledTimes(1)
  })

  it('UNWIRED_REPLAY_GATE 如实报未接线(不静默放行、不误报失败)', async () => {
    const verdict = await UNWIRED_REPLAY_GATE.run({ packDir: 'p' })
    expect(verdict.pass).toBe(false)
    expect(verdict.detail).toContain('not wired')
  })

  it('执行契约条款写明 ready 由门禁判定、replay 属发布门禁与高风险抽样(G2-A4 契约要求)', () => {
    expect(GATE_CONTRACT_CLAUSE).toContain('readiness is validated, not self-reported')
    expect(GATE_CONTRACT_CLAUSE).toContain('release gate')
    expect(GATE_CONTRACT_CLAUSE).toContain('sampled high-risk')
    expect(GATE_CONTRACT_CLAUSE).toContain(GATE_STRUCTURE_REASON)
  })
})
