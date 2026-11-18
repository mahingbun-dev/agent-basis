/**
 * 领域事件多播与只读读数面(38 号 T15 数据面;24a 裁决 dwfq-843ec077-1 口径
 * 「数据面经 tasks 提供」;30 号 §3 服务端行「订阅面 = Engine DomainEvents」):
 * - ctx.tasks.subscribe():DomainEvents 多播(每事件逐订阅方一次)、退订闭包、
 *   dispose 退订全部;装配位 onEvent 先于订阅方到达(既有接口位语义不变);
 * - 订阅方异常不外溢:Engine 在事务内同步回调 emit(core/part.ts),订阅方炸
 *   不得破内核事务(横切不拥有业务状态,24 号 §5.3-5/6);
 * - ctx.tasks.snapshot()/query():只读快照与 SELECT-only 查询面(写语句拒绝
 *   fail-closed——写路径唯一经 Engine 事务,34 号 §2.1 单写者)。
 *
 * 装配形态承 plugin-boot.spec(临时租户根 + fixtures/host 触发器;不依赖真实宿主)。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createTasks } from '../src/plugin.ts'
import type { TasksRuntime } from '../src/plugin.ts'
import { MEMBER, SOURCE, humanTrigger } from './fixtures/host.ts'
import type { DomainEvent, ScopeResult, SourceScope } from '../src/core/index.ts'
import type { TasksOptions } from '../src/plugin.ts'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'tasks-domain-events-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

/** test Source 的监听范围端口(fixture host.ts 同款)。 */
const testScope: SourceScope = {
  scope: ({ source }): ScopeResult =>
    source === SOURCE ? { listened: true, observed: true, row: 'main' } : { listened: false, reason: 'not_listened' },
}

/** 以临时租户根装配(长 pass 周期:手动 pass 驱动)。 */
const boot = (overrides: Partial<TasksOptions> = {}): TasksRuntime =>
  createTasks({ tenantRoot: root, realm: 'alice', passIntervalMs: 3_600_000, ...overrides })

/** realm 内名单(fixture 同款口径):test Source 上的人消息成为显式请求。 */
const allowMember = (runtime: TasksRuntime): void => {
  runtime.store.saveSettings({ policy: { sources: { [SOURCE]: { allowed: [{ id: MEMBER, name: 'Alice' }] } } } })
}

/** 开一张工单并返回 ticketId(触发→Eval→显式 accept,R3 四要素齐备)。 */
const openTicket = (runtime: TasksRuntime, triggerId: string): string => {
  allowMember(runtime)
  const trigger = humanTrigger(triggerId, '@bot 做点事')
  expect(runtime.engine.receive(trigger)).toBe('stored')
  runtime.pass()
  // A19 后 assessor 为 MasterAssessor:候选经 Engine 的 candidate 面读取(deliver 未注入时不投递、不计时)
  const candidate = runtime.engine.candidate(trigger.id)
  expect(candidate).toBeDefined()
  runtime.engine.candidateDelivered(candidate!.evalId)
  const decision = runtime.engine.decide(trigger.id, {
    kind: 'accept',
    title: '做点事',
    scope: 'Do the work.',
    reason: 'explicit request',
    delegation: {
      objective: 'Do it.',
      outputFormat: 'A summary.',
      toolGuidance: 'Use the read tools.',
      taskBoundaries: 'Only the request.',
    },
  })
  return decision.ticketId!
}

it('subscribe 多播:每事件逐订阅方一次;退订闭包生效;onEvent 装配位先达', () => {
  const onEventSeen: DomainEvent[] = []
  const runtime = boot({ scope: testScope, onEvent: (event) => { onEventSeen.push(event) } })
  const first: DomainEvent[] = []
  const second: DomainEvent[] = []
  const unsubscribeFirst = runtime.subscribe((event) => { first.push(event) })
  runtime.subscribe((event) => { second.push(event) })

  runtime.engine.receive(humanTrigger('1', '@bot 你好'))
  // trigger.received 在 receive 事务内同步发出(intake.ts);order: onEvent → 订阅方
  expect(onEventSeen.map(event => event.type)).toContain('trigger.received')
  expect(first.map(event => event.type)).toContain('trigger.received')
  expect(second.map(event => event.type)).toContain('trigger.received')
  expect(first).toHaveLength(onEventSeen.length) // 订阅方与装配位同扇出

  unsubscribeFirst()
  runtime.engine.receive(humanTrigger('2', '@bot 再来'))
  expect(first).toHaveLength(onEventSeen.length - 1) // 退订后不再到达
  expect(second.at(-1)?.type).toBe('trigger.received')
  runtime.dispose()
})

it('订阅方异常不外溢:Engine 事务内回调炸不破内核;后续订阅方照常到达', () => {
  const runtime = boot({ scope: testScope })
  const seen: DomainEvent[] = []
  runtime.subscribe(() => { throw new Error('订阅方炸') })
  runtime.subscribe((event) => { seen.push(event) })
  expect(() => runtime.engine.receive(humanTrigger('1', '@bot 你好'))).not.toThrow()
  // 触发器照常落库(事务未破):幂等重复投递返回 duplicate
  expect(runtime.engine.receive(humanTrigger('1', '@bot 你好'))).toBe('duplicate')
  expect(seen.map(event => event.type)).toContain('trigger.received')
  runtime.dispose()
})

it('dispose 退订全部;关停后 subscribe/snapshot/query 面停用', () => {
  const runtime = boot()
  const seen: DomainEvent[] = []
  runtime.subscribe((event) => { seen.push(event) })
  runtime.dispose()
  expect(() => runtime.subscribe(() => {})).toThrow('已关停')
  expect(() => runtime.snapshot()).toThrow('已关停')
  expect(() => runtime.query('SELECT 1')).toThrow('已关停')
  // 关停前订阅方不再收到事件(dispose 已清空)
  expect(seen).toHaveLength(0)
})

it('snapshot 只读快照面:realm/工单/线程领域态随引擎实况', () => {
  const runtime = boot({ scope: testScope })
  expect(runtime.snapshot().realm).toBe('alice')
  expect(runtime.snapshot().tickets).toHaveLength(0)
  const ticketId = openTicket(runtime, '1')
  const view = runtime.snapshot()
  expect(view.tickets.map(ticket => ticket.id)).toContain(ticketId)
  expect(view.tickets.find(ticket => ticket.id === ticketId)?.realm).toBe('alice')
  // 线程面:建票即订阅 origin 线程(thread.subscribed)
  expect(view.threads.some(thread => (thread.subscriptions ?? []).includes(ticketId))).toBe(true)
  runtime.dispose()
})

it('query 只读查询面:SELECT 可用;非 SELECT 拒绝(fail-closed)', () => {
  const runtime = boot()
  const rows = runtime.query('SELECT COUNT(*) AS n FROM ticket') as { n: unknown }[]
  expect(Number(rows[0]?.n ?? 0)).toBe(0)
  expect(() => runtime.query('INSERT INTO ticket (id) VALUES (1)')).toThrow('只读')
  expect(() => runtime.query('  delete from ticket')).toThrow('只读')
  expect(() => runtime.query('UPDATE ticket SET id = 1')).toThrow('只读')
  runtime.dispose()
})
