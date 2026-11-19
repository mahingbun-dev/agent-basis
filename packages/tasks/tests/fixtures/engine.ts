/**
 * Engine 内核假件 harness(34 §4-A「core-engine 的假件模式」;35 号 A27 具名门禁 spec 共用)。
 *
 * 与 tests/core-engine.spec.ts 的 harness 同构(MemoryRepositories + 假 Policy/Assessor/
 * Executor/Outbox),抽取为共享 fixture 供 G2 具名门禁文件(idempotency/eval-delegation/
 * mandate-policy/attention 等)复用——断言面各自独立,假件模式一处维护。
 * ★realm(A5/A6):注入 realmOf,Trigger 的 meta.realm 可覆盖缺省租户。
 */
import { vi } from 'vitest'
import { Engine, MemoryRepositories } from '../../src/index.ts'
import type {
  Assignment, Candidate, EngineOptions, Executor, Outcome, OutboundMessage, Outbox, Policy, Trigger,
} from '../../src/index.ts'

export const REALM = 'tenant-a'
export const MEMBER = { source: 'chat', id: 'alice' }
export const GUEST = { source: 'chat', id: 'guest' }
/** R3 委派四要素(35 号 A7):具名 spec 的 accept 一律带齐;缺要素用例单独构造。 */
export const DELEGATION = { objective: '修复登录页在移动端的崩溃', outputFormat: 'Git 补丁', toolGuidance: '仓库内编辑器与测试', taskBoundaries: '不改依赖与公共 API' }

export function trigger(id: string, overrides: Partial<Trigger> = {}): Trigger {
  return { id, source: 'chat', threads: [{ source: 'chat', id: 't1' }], actor: MEMBER, human: true,
    at: `2026-09-23T00:00:${id.padStart(2, '0')}Z`, text: `message ${id}`, channel: { source: 'chat', thread: 't1', address: { message: id } },
    meta: {}, ...overrides }
}

export interface EngineHooks {
  emit?: (event: { type: string; data: Record<string, unknown> }) => void
  prepareTicket?: EngineOptions['prepareTicket']
}

export function engineHarness(policyOverrides: Partial<Policy> = {}, { emit, prepareTicket }: EngineHooks = {}) {
  const repo = new MemoryRepositories()
  const outbox: OutboundMessage[] = []
  const withdrawn: string[] = []
  const requests: Candidate[] = []
  const request = vi.fn((candidate: Candidate) => { requests.push(candidate) })
  const release = vi.fn()
  const assessor = { request, release }
  const launches: [Parameters<Executor['start']>[0], Parameters<Executor['start']>[1]][] = []
  const deliveries = new Set<string>()
  /** Executor 已交给运行中 Assignment 的 Inputs,形如 [工单 id, Input id]。 */
  const delivered: [string, string][] = []
  const start = vi.fn((ticket: Parameters<Executor['start']>[0], assignment: Parameters<Executor['start']>[1]) => { launches.push([ticket, assignment]) })
  const deliver = vi.fn((ticket: Parameters<Executor['deliver']>[0]) => { deliveries.add(ticket.id) })
  const stop = vi.fn()
  const executor: Executor = { start, deliver, stop }
  let version = 'v1', paused = false
  const policy: Policy = {
    get version() { return version }, get paused() { return paused }, evalTimeoutMs: 60_000,
    gate: (t, thread) => !t.human ? { admissible: false, reason: 'not human' }
      : t.actor.id === 'alice' ? { admissible: true, strength: 'explicit', basis: { via: 'listed' } }
        : thread.subscriptions.length ? { admissible: true, strength: 'inferred', basis: { via: 'followup' } } : { admissible: false, reason: 'not a member' },
    revalidate: () => version !== 'revoked',
    admitsInferred: rules => rules.length > 0,
    ...policyOverrides,
  }
  let clock = 0
  const scope: EngineOptions['scope'] = { scope: t => t.meta.blocked ? { listened: false, reason: 'chat not allowed' } : { listened: true, observed: false } }
  const queued: Outbox = {
    send: (message) => { if (!outbox.some(item => item.id === message.id)) outbox.push(message) },
    status: id => outbox.some(item => item.id === id) ? 'pending' : undefined,
    withdraw: (id) => { withdrawn.push(id) },
  }
  const engine = new Engine({ repo, scope, policy: () => policy, assessor, executor, outbox: queued,
    realmOf: t => (typeof t.meta.realm === 'string' ? t.meta.realm : REALM),
    ...emit ? { emit } : {}, ...prepareTicket ? { prepareTicket } : {},
    now: () => new Date(Date.UTC(2026, 8, 23, 0, 0, clock)).toISOString() })
  /** 模拟 Executor 启动排队的 Assignment(除非 launch=false)并投递工单等待中的 Inputs。 */
  function settle({ launch = true } = {}) {
    for (;;) {
      const next = launch ? launches.shift() : undefined
      if (next) { engine.assignmentStarted(next[0].id, next[1].id); continue }
      const [ticketId] = deliveries
      if (ticketId === undefined) return
      deliveries.delete(ticketId)
      const ticket = repo.tickets.get(ticketId)
      const assignment: Assignment | undefined = ticket?.assignments.find(item => item.state === 'running')
      if (!ticket || ticket.ended || !assignment) continue
      for (const inputId of ticket.undelivered) {
        delivered.push([ticketId, inputId]); engine.inputsDelivered(ticketId, assignment.id, [inputId])
      }
    }
  }
  const pump = (): void => { engine.evaluateDue(); settle() }
  const decide = (candidate: Candidate, outcome: Outcome) =>
    engine.decide(candidate.triggers[0]!.id, { ...outcome, evalId: candidate.evalId })
  return { repo, engine, outbox, withdrawn, requests, executor, delivered, settle, pump, decide,
    start, deliver, stop, request, release,
    setVersion: (value: string) => { version = value }, setPaused: (value: boolean) => { paused = value },
    tick: (seconds: number) => { clock += seconds } }
}

/** 建一张已 accept 并 settle 的工单:trigger `id`(默认 '1')落在线程 `thread`(默认 't1')。 */
export function accepted(h: ReturnType<typeof engineHarness>, id = '1', thread = 't1') {
  h.engine.receive(trigger(id, { threads: [{ source: 'chat', id: thread }] })); h.pump()
  const decision = h.decide(h.requests.at(-1)!, { kind: 'accept', title: 'Fix', scope: 'small', reason: 'requested', acknowledgement: 'ok', delegation: DELEGATION })
  h.settle()
  return decision
}
