/**
 * 进化账本单测:状态机全链流转 / 非法迁移 fail-closed / effect 回填 / lineage 血缘。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { LedgerStore, LedgerTransitionError } from '../src/index.ts'
import type { VerificationReport } from '../src/index.ts'

let dbPath = ''
let store: LedgerStore
let clock = 1_000

const verification: VerificationReport = {
  g0: { pass: true, detail: 'packctl lint 通过' },
  g1: { pass: true, detail: 'replay 2 条全过' },
  g2: { pass: true, detail: 'ai-evo 三层门禁全过' },
  probe: 'pass',
}

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'basis-evolve-ledger-'))
  dbPath = path.join(dir, 'ledger.db')
  store = new LedgerStore(dbPath, { now: () => clock })
})

afterAll(async () => {
  store.close()
  await fs.rm(path.dirname(dbPath), { recursive: true, force: true })
})

describe('状态流转', () => {
  it('propose → verified → approved → released 全链 + 字段落账', () => {
    const record = store.propose({
      pack: '@evodemo/pack',
      kind: 'skill',
      signalIds: ['12', '13'],
      mastLabel: 'F5',
      proposalRef: 'skills/core-workflow/SKILL.md:[add_entry] —— 演示提案',
    })
    expect(record.status).toBe('proposed')
    expect(record.signalIds).toEqual(['12', '13'])
    expect(record.mastLabel).toBe('F5')

    clock += 10
    const verified = store.markVerified(record.id, verification)
    expect(verified.status).toBe('verified')
    expect(verified.verification?.g0.pass).toBe(true)
    expect(verified.verification?.probe).toBe('pass')
    expect(verified.updatedAt).toBe(clock)

    clock += 10
    const approved = store.markApproved(record.id)
    expect(approved.status).toBe('approved')

    clock += 10
    const released = store.markReleased(record.id, {
      fromVersion: '0.1.0',
      toVersion: '0.1.1',
      tag: '@evodemo/pack-0.1.1',
      approver: 'sunny',
    })
    expect(released.status).toBe('released')
    expect(released.release).toEqual({ fromVersion: '0.1.0', toVersion: '0.1.1', tag: '@evodemo/pack-0.1.1', approver: 'sunny' })
  })

  it('released → rolled_back(回滚是状态迁移不是删除)', () => {
    const record = store.propose({ pack: '@evodemo/pack', kind: 'rule', signalIds: ['1'], mastLabel: 'F2', proposalRef: 'rule-x' })
    store.markVerified(record.id, { ...verification, g1: { pass: true, detail: 'ok' } })
    store.markApproved(record.id)
    store.markReleased(record.id, { fromVersion: '0.1.1', toVersion: '0.2.0', tag: 't', approver: 'a' })
    const rolled = store.markRolledBack(record.id)
    expect(rolled.status).toBe('rolled_back')
    // 终态不可再迁移
    expect(() => store.markSuperseded(record.id, 1)).toThrow(LedgerTransitionError)
  })

  it('supersession 链:旧提案被新提案取代,supersededBy 指向取代者', () => {
    const older = store.propose({ pack: '@evodemo/pack', kind: 'skill', signalIds: ['5'], mastLabel: 'F1', proposalRef: 'old' })
    const newer = store.propose({ pack: '@evodemo/pack', kind: 'skill', signalIds: ['6'], mastLabel: 'F1', proposalRef: 'new' })
    const superseded = store.markSuperseded(older.id, newer.id)
    expect(superseded.status).toBe('superseded')
    expect(superseded.supersededBy).toBe(newer.id)
    expect(() => store.markSuperseded(older.id, 9999)).toThrow(/不存在/)
  })

  it('非法迁移 fail-closed:跳步 / 终态外迁 / rolled_back 非 released 来源', () => {
    const fresh = store.propose({ pack: '@evodemo/pack', kind: 'memory', signalIds: [], mastLabel: 'F4', proposalRef: 'x' })
    expect(() => store.markReleased(fresh.id, { fromVersion: '0', toVersion: '1', tag: 't', approver: 'a' })).toThrow(LedgerTransitionError)
    expect(() => store.markRolledBack(fresh.id)).toThrow(LedgerTransitionError)
    const v = store.propose({ pack: '@evodemo/pack', kind: 'knowledge', signalIds: [], mastLabel: 'F3', proposalRef: 'y' })
    store.markVerified(v.id, verification)
    expect(() => store.markVerified(v.id, verification)).toThrow(LedgerTransitionError)
  })

  it('effect 回填:仅 released 开放;before/after 指标完整落账', () => {
    const record = store.propose({ pack: '@evodemo/pack', kind: 'skill', signalIds: ['7'], mastLabel: 'F5', proposalRef: 'z' })
    store.markVerified(record.id, verification)
    store.markApproved(record.id)
    store.markReleased(record.id, { fromVersion: '0.1.0', toVersion: '0.1.2', tag: 't2', approver: 'b' })
    clock += 100
    const effect = store.recordEffect(record.id, {
      beforeMetrics: { pass_rate: 0.8, interrupt_rate: 0.05 },
      afterMetrics: { pass_rate: 0.9, interrupt_rate: 0.03 },
      reviewedAt: '2026-11-10',
    })
    expect(effect.effect?.afterMetrics['pass_rate']).toBe(0.9)
    expect(effect.effect?.reviewedAt).toBe('2026-11-10')
    expect(() => store.recordEffect(999999, { beforeMetrics: {}, afterMetrics: {}, reviewedAt: 'x' })).toThrow(/不存在/)
  })
})

describe('lineage 与查询', () => {
  it('lineage(pack) 时间序全量;status/kind 过滤;close 幂等', () => {
    const all = store.lineage('@evodemo/pack')
    expect(all.length).toBeGreaterThanOrEqual(6)
    expect(all.map(r => r.status)).toContain('released')
    expect(store.list({ pack: '@evodemo/pack', status: 'superseded' }).every(r => r.status === 'superseded')).toBe(true)
    expect(store.list({ kind: 'rule' }).length).toBeGreaterThanOrEqual(1)
    store.close()
    store.close()
    expect(store.closed).toBe(true)
    // 重开验证持久化(文件库跨实例可读)
    const reopened = new LedgerStore(dbPath)
    expect(reopened.lineage('@evodemo/pack').length).toBe(all.length)
    reopened.close()
  })
})
