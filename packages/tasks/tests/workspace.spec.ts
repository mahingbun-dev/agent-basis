/**
 * R4 工单工作区布局(35 号 A15 验收门禁;34 §4-E workspace 行;24 §5.5-R4 原文)。
 *
 * 判据:worktree 断言删除(SA 旧 workspace.spec 的 worktree 命名断言不再存在)、
 * `.ticket/<id>/` 布局断言(24 §5.5-R4 原文目录名;34 号 §2.4 的 `.tickets/` 变体是
 * 笔误,35 号 §12-11 勘误口径,不得回潜)、R4 三类产物路径与主 Session 读文件面的
 * 路径钳制(读文件不读消息;越界拒绝)。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ticketExecution } from '../src/executor/dsh.ts'
import { GATE_CONTRACT_CLAUSE } from '../src/executor/gates.ts'
import { TICKETS_DIR, TICKET_FILES, readTicketFile, ticketDir, ticketFile } from '../src/executor/workspace.ts'
import type { AssessmentOutcome, Mandate, Ticket } from '../src/core/index.ts'
import type { Settings } from '../src/policy/settings.ts'

const WORKSPACE = '/tenant-root/alice'

describe('R4 布局:`.ticket/<id>/`(24 §5.5-R4 原文)', () => {
  it('目录名是 `.ticket` 一级目录(不是 `.tickets` 变体;35 号 §12-11)', () => {
    expect(TICKETS_DIR).toBe('.ticket')
    expect(ticketDir(WORKSPACE, 't-1')).toBe(join(WORKSPACE, '.ticket', 't-1'))
  })

  it('R4 三类产物路径:progress/决策/evidence 落文件(24 §5.5-R4)', () => {
    expect(TICKET_FILES.progress).toBe('progress.md')
    expect(TICKET_FILES.decision).toBe('decision.md')
    expect(TICKET_FILES.evidence).toBe('evidence.md')
    expect(ticketFile(WORKSPACE, 't-1', 'progress')).toBe(join(WORKSPACE, '.ticket', 't-1', 'progress.md'))
    expect(ticketFile(WORKSPACE, 't-1', 'decision')).toBe(join(WORKSPACE, '.ticket', 't-1', 'decision.md'))
    expect(ticketFile(WORKSPACE, 't-1', 'evidence')).toBe(join(WORKSPACE, '.ticket', 't-1', 'evidence.md'))
  })
})

/** 最小 accept 工单与 outcome(ticketExecution 的输入面)。 */
const mandate: Mandate = { strength: 'explicit', policyVersion: 'v1', realm: 'alice',
  basis: { via: 'addressed', addressed: 'mention' }, actor: { source: 'test', id: 'u-1' }, scope: 'Do the work.' }
const ticket: Ticket = { id: 't-9', title: 'Fix it', decisionId: 'd-1', realm: 'alice', mandate, channels: [],
  assignments: [], inputs: [], undelivered: [], createdAt: '2026-11-18T00:00:00Z', updatedAt: '2026-11-18T00:00:00Z',
  origin: { triggerId: '1', triggerIds: ['1'] } }
const accept = (overrides: Partial<Extract<AssessmentOutcome, { kind: 'accept' }>> = {}): Extract<AssessmentOutcome, { kind: 'accept' }> => ({
  kind: 'accept', title: 'Fix it', scope: 'Do the work.', reason: 'explicit request',
  delegation: { objective: 'o', outputFormat: 'f', toolGuidance: 't', taskBoundaries: 'b' },
  ...overrides,
})
const settings = (): Settings => ({ paused: false, sources: {}, policy: { rules: [], sources: {} },
  eval: { mode: 'observe', timeoutSeconds: 120, model: null }, executor: { model: null, maxWorkers: 3, directory: '', prepare: '', blockedCommands: [] },
  budget: { caps: { simple: {}, compare: {}, complex: {} } }, gates: { highRiskRules: [] } })

describe('ticketExecution:Execution 元数据(A14 去 worktree + A15 契约 + A17 effort)', () => {
  it('name 即工单 id、目录为 `.ticket/<id>/`,无 worktree 痕迹', () => {
    const execution = ticketExecution(ticket, accept(), settings(), WORKSPACE)
    expect(execution.name).toBe('t-9')
    expect(execution.directory).toBe(join(WORKSPACE, '.ticket', 't-9'))
    expect(execution.directory.toLowerCase()).not.toContain('worktree')
  })

  it('执行契约含 R2 门禁条款(「ready=门禁通过」写进 Mandate 执行契约;G2-A4)', () => {
    const execution = ticketExecution(ticket, accept(), settings(), WORKSPACE)
    expect(execution.assignment).toContain(GATE_CONTRACT_CLAUSE)
  })

  it('A17:accept 固化的 effort 档位进契约文本与 Execution.effort;缺席不带档', () => {
    const withEffort = ticketExecution(ticket, accept({ effort: 'compare' }), settings(), WORKSPACE)
    expect(withEffort.effort).toBe('compare')
    expect(withEffort.assignment).toContain('Effort tier: compare (subagent budget: 2–4 subagents)')
    const without = ticketExecution(ticket, accept(), settings(), WORKSPACE)
    expect(without.effort).toBeUndefined()
    expect(without.assignment).not.toContain('Effort tier:')
  })
})

describe('主 Session 读文件面(readTicketFile;24 §5.5-R4「读文件而非读消息」)', () => {
  it('读工单目录内文件内容;缺文件 undefined', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tasks-ws-'))
    try {
      const directory = ticketDir(root, 't-1')
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, 'evidence.md'), 'proof line\n', 'utf8')
      expect(await readTicketFile(root, 't-1', 'evidence.md')).toBe('proof line\n')
      expect(await readTicketFile(root, 't-1', 'absent.md')).toBeUndefined()
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('路径钳制:越出工单目录的读取拒绝(目录穿越不静默)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tasks-ws-'))
    try {
      mkdirSync(ticketDir(root, 't-1'), { recursive: true })
      writeFileSync(join(root, 'outside.md'), 'secret', 'utf8')
      await expect(readTicketFile(root, 't-1', '../outside.md')).rejects.toThrow(/escapes the ticket directory/)
      await expect(readTicketFile(root, 't-1', '..')).rejects.toThrow(/escapes the ticket directory/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
