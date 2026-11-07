/**
 * R3 审批门与审计单测:
 * - 审批卡经 @basis/interact buildApprovalCard(R3 grade + doubleConfirm 第二问);
 * - confirm 匹配/拒绝/未知/复述不一致(mismatch);TTL 过期;新请求顶替旧请求;
 * - 审计:governance 服务在场走它;缺席走兜底 FileAuditSink(NDJSON,含
 *   operator/versionId/at——G5 口径)。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryAuditSink } from '@basis/governance'
import { ApprovalGate, PERSONA_WRITE_RULE_ID } from '../src/approval.ts'
import { StudioAudit } from '../src/audit.ts'
import type { GovernanceAuditLike } from '../src/audit.ts'
import type { WriteKind } from '../src/types.ts'

const FACTS = {
  patchPath: '/home/.dsh/profiles/t7-studio/cordis.patch.yml',
  diffSummary: '+3/-12 行',
  subjectName: 'system prompt persona 段(编辑)',
}

function payload(content = '新 persona 文本'): { content: string; baseVersionId: string | null; versionId: string | null; summary: string; author: string } {
  return { content, baseVersionId: null, versionId: null, summary: '编辑', author: 'alice' }
}

describe('ApprovalGate(R3 审批门)', () => {
  it('request 产出 R3 卡 + doubleConfirm 第二问 + 官方 user-questions 载荷', () => {
    const gate = new ApprovalGate()
    const pending = gate.request('save', payload(), FACTS)
    expect(pending.approvalId).toMatch(/^ap-/)
    expect(pending.kind).toBe('save')
    expect(pending.card.matchedRule.grade).toBe('R3')
    expect(pending.card.matchedRule.ruleId).toBe(PERSONA_WRITE_RULE_ID)
    expect(pending.card.rollback.reversible).toBe(true)
    expect(pending.card.impact.files[0]?.path).toBe(FACTS.patchPath)
    expect(pending.card.impact.files[0]?.diffSummary).toBe('+3/-12 行')
    expect(pending.questionItems).toHaveLength(2) // 主问 + R3 二次确认
    expect(pending.questionItems[0]?.intent?.kind).toBe('approval')
    expect(pending.questionItems[1]?.header).toBe('R3 二次确认')
  })

  it('confirm(approved) 放行且取走在途;复述一致才通过', () => {
    const gate = new ApprovalGate()
    const pending = gate.request('save', payload('内容X'), FACTS)
    const outcome = gate.confirm(pending.approvalId, true, { content: '内容X', baseVersionId: null, versionId: null })
    expect(outcome.outcome).toBe('approved')
    expect(gate.peek()).toBeNull()
  })

  it('复述不一致 → mismatch(不取走在途,可重试)', () => {
    const gate = new ApprovalGate()
    const pending = gate.request('save', payload('内容X'), FACTS)
    const mismatch = gate.confirm(pending.approvalId, true, { content: '内容Y', baseVersionId: null, versionId: null })
    expect(mismatch.outcome).toBe('mismatch')
    expect(gate.peek()?.approvalId).toBe(pending.approvalId)
  })

  it('显式拒绝 → declined 且清空在途', () => {
    const gate = new ApprovalGate()
    const pending = gate.request('rollback', payload(), { ...FACTS, subjectName: '回滚' })
    const outcome = gate.confirm(pending.approvalId, false, { content: payload().content, baseVersionId: null, versionId: null })
    expect(outcome.outcome).toBe('declined')
    expect(gate.peek()).toBeNull()
  })

  it('未知 approvalId / 过期 TTL → unknown', () => {
    let now = 1_000_000
    const gate = new ApprovalGate({ now: () => now, ttlMs: 1000 })
    const pending = gate.request('import', payload(), FACTS)
    now += 2000
    expect(gate.peek()).toBeNull()
    expect(gate.confirm(pending.approvalId, true, { content: payload().content, baseVersionId: null, versionId: null }).outcome).toBe('unknown')
    expect(gate.confirm('ap-none', true, { content: 'x', baseVersionId: null, versionId: null }).outcome).toBe('unknown')
  })

  it('新请求顶替旧请求(单写者:同刻只一张在途卡)', () => {
    const gate = new ApprovalGate()
    const first = gate.request('save', payload('第一版'), FACTS)
    const second = gate.request('save', payload('第二版'), FACTS)
    expect(second.approvalId).not.toBe(first.approvalId)
    expect(gate.confirm(first.approvalId, true, { content: '第一版', baseVersionId: null, versionId: null }).outcome).toBe('unknown')
    expect(gate.confirm(second.approvalId, true, { content: '第二版', baseVersionId: null, versionId: null }).outcome).toBe('approved')
  })

  it('cancel 丢弃在途', () => {
    const gate = new ApprovalGate()
    gate.request('save', payload(), FACTS)
    expect(gate.cancel() !== null).toBe(true)
    expect(gate.peek()).toBeNull()
  })
})

describe('StudioAudit(审计留痕)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'basis-prompt-studio-audit-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('governance 服务缺席 → 兜底 FileAuditSink NDJSON(含 action/operator/versionId/at)', async () => {
    const filePath = join(dir, 'audit.jsonl')
    const memory = new MemoryAuditSink()
    const audit = new StudioAudit({ fallbackFilePath: filePath, memorySink: memory })
    audit.write('prompt-save.committed', { operator: 'alice', versionId: 'v-000001-abc', versionSeq: 1 })
    audit.write('prompt-save.approval-requested', { operator: 'alice', approvalId: 'ap-1' })
    await audit.flush()
    const lines = readFileSync(filePath, 'utf8').split('\n').filter(line => line.trim().length > 0)
    expect(lines).toHaveLength(2)
    const first = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>
    expect(first['kind']).toBe('governance')
    expect(first['at']).toMatch(/^\d{4}-\d{2}-\d{2}T/u)
    const detail = first['detail'] as Record<string, unknown>
    expect(detail['system']).toBe('basis-prompt-studio')
    expect(detail['action']).toBe('prompt-save.committed')
    expect(detail['operator']).toBe('alice')
    expect(detail['versionId']).toBe('v-000001-abc')
    expect(memory.records).toHaveLength(2)
  })

  it('governance 服务在场 → 走其 reportGovernance,兜底文件不写', async () => {
    const filePath = join(dir, 'audit.jsonl')
    const reported: Readonly<Record<string, unknown>>[] = []
    const governance: GovernanceAuditLike = {
      audit: { reportGovernance: (detail) => { reported.push(detail); return [] } },
    }
    const audit = new StudioAudit({ fallbackFilePath: filePath, resolveGovernance: () => governance })
    audit.write('prompt-rollback.committed', { operator: 'bob', versionId: 'v-2' })
    await audit.flush()
    expect(reported).toHaveLength(1)
    expect(reported[0]?.['action']).toBe('prompt-rollback.committed')
    expect(() => readFileSync(filePath, 'utf8')).toThrow()
  })

  it('governance 服务缺席但 audit 子面缺席(glue 半挂载)→ 仍走兜底', async () => {
    const filePath = join(dir, 'audit.jsonl')
    const audit = new StudioAudit({ fallbackFilePath: filePath, resolveGovernance: () => ({}) })
    audit.write('prompt-import.rejected', { operator: 'web', issues: ['校验和不符'] })
    await audit.flush()
    const lines = readFileSync(filePath, 'utf8').split('\n').filter(line => line.trim().length > 0)
    expect(lines).toHaveLength(1)
  })
})

describe('WriteKind 全集(三类写操作全走 R3)', () => {
  it('save/rollback/import 都能出卡且 kind 回填', () => {
    const kinds: WriteKind[] = ['save', 'rollback', 'import']
    for (const kind of kinds) {
      const gate = new ApprovalGate()
      const pending = gate.request(kind, payload(), FACTS)
      expect(pending.kind).toBe(kind)
      expect(pending.card.matchedRule.grade).toBe('R3')
    }
  })
})
