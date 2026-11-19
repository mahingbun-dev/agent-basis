/**
 * 工作台会话区角色标记验收(2026-11-19 会话级 super 标记):
 * - workbenchSessions 投影:mock fixture 非空回退、主控行置首、queued 工单无执行行、
 *   worker 行 id = `worker-<ticketId>`(tasks executor/dsh.ts:42 同一约定);
 * - TaskSidebar 渲染:主控/执行 chip 文案与结构化锚点,普通会话无 chip。
 */
import { describe, expect, it } from 'vitest'
import { workbenchSessions, MASTER_SESSION_ROW } from '../src/project/sessions.ts'
import { TaskSidebar } from '../src/client/TaskSidebar.tsx'
import { zh } from '../src/client/locales.ts'
import type { WorkbenchTicket } from '../src/types.ts'
import { byAttr, find1, render, textOf } from './render-tree.tsx'

const t = (key: string): string => zh[key as keyof typeof zh] ?? key

function ticket(id: string, column: WorkbenchTicket['column']): WorkbenchTicket {
  return { id, title: `工单 ${id}`, column, metaLine: [], owner: 'alice' }
}

describe('workbenchSessions 投影', () => {
  it('mock fixture 非空时原样回退(渲染测试行为不变)', () => {
    const mock = [{ id: 'sess-1', title: '采购报价对比', channel: '飞书群' }]
    expect(workbenchSessions({ sessions: mock, tickets: [ticket('T-1', 'working')], masterSessionId: 'orchestrator-alice' })).toBe(mock)
  })

  it('live 空会话 + 主会话 id → 主控行置首', () => {
    const rows = workbenchSessions({
      sessions: [],
      tickets: [ticket('T-1', 'working')],
      masterSessionId: 'orchestrator-alice',
    })
    expect(rows).toEqual([
      { id: 'orchestrator-alice', ...MASTER_SESSION_ROW, role: 'orchestrator' },
      { id: 'worker-T-1', title: '工单 T-1', channel: 'T-1', role: 'worker' },
    ])
  })

  it('主会话未引导 → 无主控行,只列执行行', () => {
    const rows = workbenchSessions({ sessions: [], tickets: [ticket('T-9', 'person')] })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('worker-T-9')
    expect(rows[0]?.role).toBe('worker')
  })

  it('queued 工单尚无 worker 会话 → 不出执行行;working/person/idle 均出', () => {
    const rows = workbenchSessions({
      sessions: [],
      tickets: [ticket('T-q', 'queued'), ticket('T-w', 'working'), ticket('T-p', 'person'), ticket('T-i', 'idle')],
    })
    expect(rows.map(row => row.id)).toEqual(['worker-T-w', 'worker-T-p', 'worker-T-i'])
  })

  it('无主会话、无工单 → 空表', () => {
    expect(workbenchSessions({ sessions: [], tickets: [] })).toEqual([])
  })
})

describe('TaskSidebar 角色 chip', () => {
  const rows = workbenchSessions({
    sessions: [],
    tickets: [ticket('T-1', 'working')],
    masterSessionId: 'orchestrator-alice',
  })
  const tree = render(
    <TaskSidebar
      sessions={rows}
      tickets={[]}
      activeSessionId="orchestrator-alice"
      onSessionSelect={() => {}}
      activeTicketId=""
      onTicketSelect={() => {}}
      t={t}
    />,
  )

  it('主控行渲染「主控」chip(orchestrator 锚点)', () => {
    const chips = byAttr(tree, 'data-eterna-workbench', 'session-role')
    expect(chips.map(chip => chip.attrs['data-eterna-workbench-role'])).toEqual(['orchestrator', 'worker'])
    expect(chips.map(textOf)).toEqual(['主控', '执行'])
  })

  it('执行行 id 与 chip 文案同源', () => {
    const workerRow = find1(tree, 'data-eterna-workbench-session', 'worker-T-1')
    expect(workerRow.attrs['data-eterna-workbench-session']).toBe('worker-T-1')
  })
})