/**
 * MemoryRepositories 用例(35 号 A3 memory 件;34 §2.1 memory 行「测试与临时实例用」)。
 *
 * 承 SA tests/store.spec.ts 的内存半边,语义原样:
 * - 「reads the working sets alone, in SQLite as in memory, and follows each save」(store.spec.ts:48-74)
 *   ——工单/线程工作集(open/active)判定与跟随;
 * - 「lists in the same order in SQLite and in memory, and undoes a failed nested transaction alone in both」
 *   (store.spec.ts:220-247)——排序语义与嵌套事务回滚;
 * 另按 SA src/core/memory.ts 头注不变量补克隆隔离与整表回滚用例(存取两侧克隆、五表快照回滚)。
 * SQLite Store 侧对照属 35 号 A11(tests/store.spec.ts),此处只测内存实现。
 * realm:模型拍板增加的必填字段(34 §2.1,Mandate/Ticket)在本 spec 的工厂里以 'test-realm' 落值;
 * Trigger/ThreadRef 不带 realm(同条拍板)。
 */
import { describe, expect, it } from 'vitest'
import { MemoryRepositories } from '../src/core/memory.ts'
import type { Repositories } from '../src/core/ports.ts'
import type { Assignment, Decision, Thread, Ticket, Trigger, TriggerDisposition } from '../src/core/model.ts'

const ticket = (id: string, state: 'open' | 'ended', assignments: Pick<Assignment, 'state'>[], undelivered: string[] = []): Ticket => ({
  id, title: id, decisionId: '', realm: 'test-realm',
  mandate: { strength: 'explicit', policyVersion: '', basis: { via: 'listed' }, actor: { source: 'x', id: '' }, scope: '', realm: 'test-realm' },
  channels: [], assignments: assignments.map((item, index) => ({ id: `${id}-${index}`, createdAt: '', ...item })), inputs: [],
  ...state === 'ended' ? { ended: { at: '', by: 'executor' as const, reason: 'closed', outcome: 'closed' as const } } : {},
  undelivered, createdAt: '', updatedAt: '', origin: { triggerId: '', triggerIds: [] } })
const thread = (id: string, source: string, fields: Partial<Thread> = {}): Thread =>
  ({ key: `${source}:${id}`, ref: { source, id }, createdAt: '', subscriptions: [], correlated: [], pending: [], meta: {}, ...fields })
const decision = (id: string): Decision => ({ id, evalId: '', threadKey: 'github:1', triggerIds: [], policyVersion: '', at: id, kind: 'ignore', reason: [],
  strength: 'explicit' })
const trigger = (id: string): Trigger => ({ id, source: 'feishu', threads: [{ source: 'feishu', id: 'oc_1' }], actor: { source: 'feishu', id: 'u' },
  human: true, at: '2026-11-17T00:00:00Z', text: id, meta: {} })
const ids = (items: { id?: string; key?: string }[]) => items.map(item => item.id ?? item.key).sort()
const order = (items: { id?: string; key?: string }[]) => items.map(item => item.id ?? item.key)

describe('MemoryRepositories(SA store.spec 内存半边 + memory.ts 不变量)', () => {
  it('tickets.open 只含未结束工单(running/queued),已结束的(waking/done)除外', () => {
    const repo = new MemoryRepositories()
    repo.tickets.save(ticket('running', 'open', [{ state: 'running' }]))
    repo.tickets.save(ticket('queued', 'open', [{ state: 'ended' }, { state: 'pending' }]))
    repo.tickets.save(ticket('waking', 'ended', [{ state: 'ended' }], ['input']))
    repo.tickets.save(ticket('done', 'ended', [{ state: 'ended' }]))
    expect(ids(repo.tickets.open())).toEqual(['queued', 'running'])
  })

  it('tickets.active 含最新 Assignment 为 pending/running 的与带未交付输入的,无 Assignment 活动的除外', () => {
    const repo = new MemoryRepositories()
    repo.tickets.save(ticket('running', 'open', [{ state: 'running' }]))
    repo.tickets.save(ticket('queued', 'open', [{ state: 'ended' }, { state: 'pending' }]))
    repo.tickets.save(ticket('waking', 'ended', [{ state: 'ended' }], ['input']))
    repo.tickets.save(ticket('done', 'ended', [{ state: 'ended' }]))
    expect(ids(repo.tickets.active())).toEqual(['queued', 'running', 'waking'])
  })

  it('tickets.active 按「最新 Assignment」判定:已结束 Assignment 之后再排队的 pending(重试/恢复形态)计入', () => {
    const repo = new MemoryRepositories()
    repo.tickets.save(ticket('queued', 'open', [{ state: 'ended' }, { state: 'pending' }]))
    expect(ids(repo.tickets.active())).toEqual(['queued'])
  })

  it('已结束工单带未交付输入计 active 不计 open(等下一次 pass 唤醒的恢复路径)', () => {
    const repo = new MemoryRepositories()
    repo.tickets.save(ticket('waking', 'ended', [{ state: 'ended' }], ['input']))
    expect(ids(repo.tickets.open())).toEqual([])
    expect(ids(repo.tickets.active())).toEqual(['waking'])
  })

  it('threads.active 只含 pending 非空或 evaluating 存在的线程;仅订阅与空线程不算', () => {
    const repo = new MemoryRepositories()
    repo.threads.save(thread('1', 'github', { pending: ['a'] }))
    repo.threads.save(thread('2', 'github', { subscriptions: ['running'], evaluating: { id: 'e', threadKey: 'github:2', triggerIds: ['b'], strength: 'explicit',
      actor: { source: 'github', id: 'alice' }, basis: { via: 'followup' }, policyVersion: '', startedAt: '', deadline: '' } }))
    repo.threads.save(thread('oc:om', 'feishu', { subscriptions: ['done'] }))
    repo.threads.save(thread('3', 'github'))
    expect(ids(repo.threads.active())).toEqual(['github:1', 'github:2'])
  })

  it('工作集跟随每次 save:工单结束、线程清空 pending 后即时退出', () => {
    const repo = new MemoryRepositories()
    repo.tickets.save(ticket('running', 'open', [{ state: 'running' }]))
    repo.tickets.save(ticket('queued', 'open', [{ state: 'ended' }, { state: 'pending' }]))
    repo.tickets.save(ticket('waking', 'ended', [{ state: 'ended' }], ['input']))
    repo.threads.save(thread('1', 'github', { pending: ['a'] }))
    repo.threads.save(thread('2', 'github', { subscriptions: ['running'], evaluating: { id: 'e', threadKey: 'github:2', triggerIds: ['b'], strength: 'explicit',
      actor: { source: 'github', id: 'alice' }, basis: { via: 'followup' }, policyVersion: '', startedAt: '', deadline: '' } }))
    expect(ids(repo.tickets.open())).toEqual(['queued', 'running'])
    expect(ids(repo.tickets.active())).toEqual(['queued', 'running', 'waking'])
    expect(ids(repo.threads.active())).toEqual(['github:1', 'github:2'])
    repo.tickets.save(ticket('running', 'ended', [{ state: 'ended' }]))
    repo.threads.save(thread('1', 'github'))
    expect(ids(repo.tickets.open())).toEqual(['queued'])
    expect(ids(repo.tickets.active())).toEqual(['queued', 'waking'])
    expect(ids(repo.threads.active())).toEqual(['github:2'])
  })

  it('tickets.list 最新在前;重复 save 保位(重存只改内容不动位置)', () => {
    const repo = new MemoryRepositories()
    repo.tickets.save(ticket('first', 'open', [{ state: 'running' }]))
    repo.tickets.save(ticket('second', 'ended', [{ state: 'ended' }]))
    repo.tickets.save(ticket('third', 'open', [{ state: 'pending' }]))
    repo.tickets.save({ ...repo.tickets.get('first')!, title: 'again' })
    expect(order(repo.tickets.list())).toEqual(['third', 'second', 'first'])
    expect(repo.tickets.get('first')!.title).toBe('again')
    expect(order(repo.tickets.open())).toEqual(['third', 'first'])
    expect(order(repo.tickets.active())).toEqual(['third', 'first'])
  })

  it('threads.list 与 decisions.byThread 按保存序返回;byThread 只含该线程', () => {
    const repo = new MemoryRepositories()
    repo.threads.save(thread('1', 'github', { pending: ['a'] }))
    repo.threads.save(thread('2', 'github'))
    repo.threads.save(thread('3', 'github', { pending: ['b'] }))
    repo.decisions.save(decision('d2'))
    repo.decisions.save(decision('d1'))
    repo.decisions.save({ ...decision('other'), threadKey: 'feishu:oc_1' })
    expect(order(repo.threads.list())).toEqual(['github:1', 'github:2', 'github:3'])
    expect(order(repo.threads.active())).toEqual(['github:1', 'github:3'])
    expect(order(repo.decisions.byThread('github:1'))).toEqual(['d2', 'd1'])
  })

  it('嵌套 atomic 失败只回滚内层:外层事务继续,内层写入消失、外层写入保留', () => {
    const repo = new MemoryRepositories()
    repo.tickets.save(ticket('first', 'open', [{ state: 'running' }]))
    repo.atomic(() => {
      repo.tickets.save(ticket('outer', 'open', []))
      expect(() => repo.atomic(() => { repo.tickets.save(ticket('inner', 'open', [])); throw new Error('boom') })).toThrow('boom')
    })
    expect(order(repo.tickets.list())).toEqual(['outer', 'first'])
  })

  it('外层 atomic 抛错回滚五张表全部写入(triggers/dispositions/threads/tickets/decisions)', () => {
    const repo = new MemoryRepositories()
    repo.tickets.save(ticket('kept', 'open', [{ state: 'running' }]))
    expect(() => repo.atomic(() => {
      repo.triggers.save(trigger('t'))
      repo.triggers.saveDisposition('t', { fanout: ['kept'], at: '' })
      repo.threads.save(thread('1', 'github', { pending: ['t'] }))
      repo.tickets.save(ticket('rolled', 'open', []))
      repo.decisions.save(decision('d'))
      throw new Error('boom')
    })).toThrow('boom')
    expect(repo.triggers.get('t')).toBeUndefined()
    expect(repo.triggers.disposition('t')).toBeUndefined()
    expect(repo.threads.get('github:1')).toBeUndefined()
    expect(repo.tickets.get('rolled')).toBeUndefined()
    expect(repo.decisions.get('d')).toBeUndefined()
    // 事务前的写入保留
    expect(repo.tickets.get('kept')!.title).toBe('kept')
  })

  it('读侧克隆隔离:改动 get 返回的对象不影响库内状态', () => {
    const repo = new MemoryRepositories()
    repo.tickets.save(ticket('t', 'open', [{ state: 'running' }]))
    repo.threads.save(thread('1', 'github', { pending: ['a'] }))
    repo.triggers.save(trigger('g'))
    repo.decisions.save(decision('d'))
    const gotTicket = repo.tickets.get('t')!
    gotTicket.title = 'mutated'
    gotTicket.undelivered.push('x')
    const gotThread = repo.threads.get('github:1')!
    gotThread.pending.push('b')
    const gotTrigger = repo.triggers.get('g')!
    gotTrigger.text = 'mutated'
    const gotDecision = repo.decisions.get('d')!
    gotDecision.kind = 'accept'
    expect(repo.tickets.get('t')!.title).toBe('t')
    expect(repo.tickets.get('t')!.undelivered).toEqual([])
    expect(repo.threads.get('github:1')!.pending).toEqual(['a'])
    expect(repo.triggers.get('g')!.text).toBe('g')
    expect(repo.decisions.get('d')!.kind).toBe('ignore')
  })

  it('写侧克隆隔离:save 之后改动调用方手里的对象不影响库内状态', () => {
    const repo = new MemoryRepositories()
    const saved = ticket('t', 'open', [{ state: 'running' }])
    repo.tickets.save(saved)
    saved.title = 'mutated'
    const savedThread = thread('1', 'github', { pending: ['a'] })
    repo.threads.save(savedThread)
    savedThread.pending.push('b')
    const savedTrigger = trigger('g')
    repo.triggers.save(savedTrigger)
    savedTrigger.text = 'mutated'
    expect(repo.tickets.get('t')!.title).toBe('t')
    expect(repo.threads.get('github:1')!.pending).toEqual(['a'])
    expect(repo.triggers.get('g')!.text).toBe('g')
  })

  it('disposition:未保存返回 undefined;saveDisposition 后可读回且两侧克隆隔离', () => {
    const repo = new MemoryRepositories()
    expect(repo.triggers.disposition('t')).toBeUndefined()
    const value: TriggerDisposition = { fanout: ['t1'], at: '', handbacks: [{ ticketId: 't1', reason: 'r', at: '' }] }
    repo.triggers.saveDisposition('t', value)
    value.fanout.push('t2')
    const read = repo.triggers.disposition('t')!
    read.fanout.push('t3')
    expect(repo.triggers.disposition('t')!.fanout).toEqual(['t1'])
  })

  it('未保存的 ticket/thread/decision get 均返回 undefined', () => {
    const repo = new MemoryRepositories()
    expect(repo.tickets.get('none')).toBeUndefined()
    expect(repo.threads.get('github:none')).toBeUndefined()
    expect(repo.decisions.get('none')).toBeUndefined()
    expect(repo.triggers.get('none')).toBeUndefined()
    expect(repo.decisions.byThread('github:none')).toEqual([])
  })

  it('Repositories 契约面:atomic 返回工作单元的返回值,MemoryRepositories 可当 Repositories 使用', () => {
    const repo: Repositories = new MemoryRepositories()
    const value = repo.atomic(() => { repo.tickets.save(ticket('t', 'open', [{ state: 'running' }])); return 'done' })
    expect(value).toBe('done')
    expect(ids(repo.tickets.active())).toEqual(['t'])
  })
})
