/**
 * 工单阶段分类全量用例:ticketStage / canRetry。
 *
 * 设计依据:35 号 A3 验收门禁(「阶段表逐行断言,34 §4-A stage 行」);34 号 §4-A stage 行
 * 「阶段表逐行对齐 docs/003 规则(第一匹配行胜出)」;SA docs/003-execution.md「Ticket stages」表。
 * 用例形态承接 SA tests/stage.spec.ts(SA/src/core 同源),fixture 按 34 §2.1 增必填 realm。
 */
import { describe, expect, it } from 'vitest'
import { canRetry, ticketStage, type Assignment, type ReportState, type Ticket } from '../src/index.ts'

const assignment = (overrides: Partial<Assignment> = {}): Assignment => ({ id: 'a', state: 'running', createdAt: '', ...overrides })
const reported = (state: ReportState, overrides: Partial<Assignment> = {}): Assignment => assignment({ report: { state, summary: '', at: '' }, ...overrides })
const ticket = (overrides: Partial<Ticket> = {}): Ticket => ({ id: 't', title: 'x', decisionId: 'd', realm: 'tenant-a',
  mandate: { strength: 'explicit', policyVersion: 'v', realm: 'tenant-a', basis: { via: 'listed' }, actor: { source: 'feishu', id: 'ou' }, scope: '' },
  channels: [], assignments: [assignment()], inputs: [], undelivered: [], createdAt: '', updatedAt: '', origin: { triggerId: 'x', triggerIds: ['x'] }, ...overrides })
const attention = { id: 'q', question: '?' }
/** 报告之后到达工单的一条人消息。 */
const answered = { inputs: [{ id: 'i', kind: 'trigger' as const, triggerId: 'e', at: 'later', human: true as const }] }
const reportedAt = (state: ReportState) => reported(state, { report: { state, summary: '', at: 'earlier' } })
const ended = { at: '', by: 'executor' as const, reason: 'closed', outcome: 'closed' as const }

// docs/003 表的行序;同时命中多行的工单取第一匹配行。
describe('ticketStage', () => {
  it.each([
    ['一条未送达的 Input(投递失败)', ticket({ delivery: { error: 'offline', at: '' } }), { stage: 'person', action: 'delivery' }],
    ['delivery 先于 answer 与 review', ticket({ delivery: { error: 'offline', at: '' }, attention, assignments: [reported('ready')] }), { stage: 'person', action: 'delivery' }],
    ['一个 Attention', ticket({ attention }), { stage: 'person', action: 'answer' }],
    ['answer 先于 review', ticket({ attention, assignments: [reported('ready')] }), { stage: 'person', action: 'answer' }],
    ['answer 先于失败报告', ticket({ attention, assignments: [reported('failed')] }), { stage: 'person', action: 'answer' }],
    ['一条 ready 报告', ticket({ assignments: [reported('ready')] }), { stage: 'person', action: 'review' }],
    ['已结束 Assignment 的 ready 报告', ticket({ assignments: [reported('ready', { state: 'ended' })] }), { stage: 'person', action: 'review' }],
    ['一条 blocked 报告', ticket({ assignments: [reported('blocked')] }), { stage: 'person', action: 'blocked' }],
    ['一条 failed 报告', ticket({ assignments: [reported('failed')] }), { stage: 'person', action: 'failed' }],
    ['blocked 报告之后有人答复', ticket({ ...answered, assignments: [reportedAt('blocked')] }), { stage: 'working' }],
    ['没有 Assignment', ticket({ assignments: [] }), { stage: 'working', action: 'queued' }],
    ['一个 pending Assignment', ticket({ assignments: [reported('failed', { state: 'ended' }), assignment({ state: 'pending' })] }), { stage: 'working', action: 'queued' }],
    ['一条 waiting 报告', ticket({ assignments: [reported('waiting')] }), { stage: 'idle' }],
    ['一个已结束的 Assignment', ticket({ assignments: [assignment({ state: 'ended' })] }), { stage: 'idle' }],
    ['一个运行中的 Assignment', ticket(), { stage: 'working' }],
    ['一条 progress 报告', ticket({ assignments: [reported('progress')] }), { stage: 'working' }],
    ['已结束的工单(ended 压过一切)', ticket({ ended, attention, assignments: [reported('failed')] }), { stage: 'ended' }],
  ])('%s', (_name, value, stage) => { expect(ticketStage(value)).toEqual(stage) })
})

describe('canRetry', () => {
  it.each([
    ['失败的开放工单', true, ticket({ assignments: [reported('failed')] })],
    ['blocked 的开放工单', true, ticket({ assignments: [reported('blocked')] })],
    ['失败且同时在等答复的工单', true, ticket({ attention, assignments: [reported('failed')] })],
    ['blocked 且 Input 未送达的工单', true, ticket({ delivery: { error: 'offline', at: '' }, assignments: [reported('blocked')] })],
    ['失败但已结束的工单', false, ticket({ ended, assignments: [reported('failed')] })],
    ['已被重试、新 Assignment 为 pending 的工单', false, ticket({ assignments: [reported('failed', { state: 'ended' }), assignment({ state: 'pending' })] })],
    ['ready 的工单', false, ticket({ assignments: [reported('ready')] })],
    ['运行中的工单', false, ticket()],
    ['没有 Assignment 的工单', false, ticket({ assignments: [] })],
    // worker 已拿到人的消息(阶段也这么说),重试只会打断它。
    ['失败后有人答复的工单', false, ticket({ ...answered, assignments: [reportedAt('failed')] })],
    // 除非那条消息投递失败:新 Assignment 重启 worker 并带上该消息。
    ['失败且其人答复投递失败的工单', true,
      ticket({ ...answered, delivery: { error: 'offline', at: '' }, assignments: [reportedAt('failed')] })],
    ['Input 无法投递的工作中工单', true, ticket({ delivery: { error: 'offline', at: '' } })],
    ['Input 无法投递但已结束的工单', false, ticket({ ended, delivery: { error: 'offline', at: '' } })],
  ])('%s: %s', (_name, expected, value) => { expect(canRetry(value)).toBe(expected) })
  it('在每个可由新 Assignment 解救的 person 阶段都提供重试', () => {
    const delivery = ticket({ ...answered, delivery: { error: 'offline', at: '' }, assignments: [reportedAt('failed')] })
    expect(ticketStage(delivery)).toEqual({ stage: 'person', action: 'delivery' })
    expect(canRetry(delivery)).toBe(true)
  })
})
