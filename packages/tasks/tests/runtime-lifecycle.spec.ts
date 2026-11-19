/**
 * 模拟宿主 runtime 集成用例:一张工单在模拟 DSH 宿主里的全生命周期
 * (35 号 A14/A22 的集成面;34 号 §4-E「模拟宿主驱动 runtime 级用例」)。
 *
 * 走通:trigger 摄取 → Eval(假 assessor)→ accept(R3 四要素)→ 工单开出
 * (realm 落库、R4 `.ticket/<id>/` 工作区、`worker-<ticketId>` session 建在租户
 * 工作区)→ launch 投递首条 assignment 消息 → 人的后续消息 input 逐条投递与 readAt →
 * worker 报告 ready → 工单 completed;以及:已结束工单被人的消息恢复(resumed)、
 * 人 stop 撤回 Mandate 后 worker session 被取消且什么都收不到。
 * A16 plugin 装配(plugin-boot)不属本文件;此处为 executor+sessions 接线的 runtime 集成。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { humanTrigger, startHost, type Host } from './fixtures/host.ts'

/** 解析投递文本为 JSON 载荷(typed,免 any 逃逸)。 */
const payload = (text: string): Record<string, unknown> => JSON.parse(text) as Record<string, unknown>

let h: Host
beforeEach(async () => { h = await startHost() })
afterEach(async () => { await h.stop() })

/** 某会话收到的投递记录(按 mode 过滤)。 */
const sent = (host: Host, sessionId: string, mode: 'queue' | 'steer' | 'inject') =>
  host.deliveries.mock.calls.map(([call]) => call).filter(call => call.sessionId === sessionId && call.mode === mode)

it('走通一张工单全生命周期:trigger→Eval→accept→launch→投递→ready→completed', async () => {
  const trigger = humanTrigger('1', '@bot 修复登录回归')
  const { ticket, sessionId } = await h.accept(trigger)

  // 工单与 Mandate 都落在 realm(24a A1「realm 进内核模型」)
  expect(ticket.realm).toBe(h.REALM)
  expect(ticket.mandate.realm).toBe(h.REALM)
  // Execution:R4 目录 `<租户工作区>/.ticket/<id>/`,name 即工单 id(A14 去 worktree)
  expect(ticket.execution).toMatchObject({ name: ticket.id, directory: join(h.store.workspaceDir, '.ticket', ticket.id) })
  expect(existsSync(ticket.execution!.directory)).toBe(true)
  // worker session 建在租户 realm 工作区内(A22),id 约定 worker-<ticketId>
  expect(h.agents.get(sessionId)?.cwd).toBe(ticket.execution!.directory)
  // assignment 已启动,首条 assignment 消息(queue)带工单与发起 trigger 卡
  expect(h.store.tickets.get(ticket.id)?.assignments.at(-1)).toMatchObject({ state: 'running' })
  const assignment = sent(h, sessionId, 'queue').at(-1)
  expect(assignment).toBeDefined()
  expect(payload(assignment!.text)).toMatchObject({
    ticket_id: ticket.id, title: ticket.title, trigger: { trigger_id: trigger.id, from: 'u-alice' },
  })
  // 领域事件链:trigger.received → eval.started → decision.recorded → ticket.created → assignment.started
  expect(h.emitted.map(event => event.type)).toEqual(
    expect.arrayContaining(['trigger.received', 'eval.started', 'decision.recorded', 'ticket.created', 'assignment.started']),
  )

  // 人的后续消息到达同线程:作为 input 逐条投递(steer)给运行中的 worker
  const followup = humanTrigger('2', '补充:记得补测试', { threads: [{ source: 'test', id: 'thread-1' }] })
  h.engine.receive(followup)
  await h.settle()
  const steered = sent(h, sessionId, 'steer').at(-1)
  expect(steered).toBeDefined()
  expect(payload(steered!.text)).toMatchObject({ trigger_id: followup.id, from: 'u-alice', thread: 'test:thread-1' })
  expect(h.store.tickets.get(ticket.id)?.undelivered).toEqual([])

  // worker 的 session 把它纳入步骤后,才记为已读(readAt)
  const input = h.store.tickets.get(ticket.id)!.inputs.find(item => item.kind === 'trigger' && item.triggerId === followup.id)
  expect(input && input.kind === 'trigger' ? input.readAt : 'unset').toBeNull()
  h.step(sessionId)
  await vi.waitFor(() => {
    const read = h.store.tickets.get(ticket.id)!.inputs.find(item => item.kind === 'trigger' && item.triggerId === followup.id)
    expect(read && read.kind === 'trigger' ? read.readAt : undefined).toBeTruthy()
  })

  // worker 报告 ready:无跟随线程,工单以 completed 结束(24 号 §2.3-5 六态)
  h.say(sessionId, '修复完成,见工作区补丁。')
  h.engine.report(ticket.id, { state: 'ready', summary: 'fixed the regression' })
  await vi.waitFor(() => {
    expect(h.store.tickets.get(ticket.id)?.ended).toMatchObject({ by: 'executor', outcome: 'completed' })
  })
  // 结束事件载荷带 realm(35 号表②-2:记忆整固与冲突指标按 realm 归账)
  const ended = h.emitted.find(event => event.type === 'ticket.ended')
  expect(ended && ended.type === 'ticket.ended' ? ended.data : undefined).toMatchObject({ ticketId: ticket.id, realm: h.REALM })
})

it('已结束工单被人的后续消息恢复:resumed 注记先行投递,同 Mandate 另起 assignment', async () => {
  const { ticket, sessionId } = await h.accept(humanTrigger('1', '@bot 修一个'))
  h.engine.report(ticket.id, { state: 'ready', summary: 'done' })
  await vi.waitFor(() => { expect(h.store.tickets.get(ticket.id)?.ended?.outcome).toBe('completed') })
  h.idle(sessionId)

  const again = humanTrigger('2', '又发现一个相关的错', { threads: [{ source: 'test', id: 'thread-1' }] })
  h.engine.receive(again)
  await h.settle()

  // 工单在原 Mandate 下恢复(无新 Eval/Decision),新 assignment 的 launch 只说新的一轮
  const resumed = h.store.tickets.get(ticket.id)!
  expect(resumed.ended).toBeUndefined()
  expect(resumed.assignments.length).toBe(2)
  expect(resumed.assignments.at(-1)).toMatchObject({ state: 'running' })
  expect(h.emitted.some(event => event.type === 'ticket.resumed')).toBe(true)
  const second = sent(h, sessionId, 'queue').at(-1)
  expect(payload(second!.text)).toMatchObject({ ticket_id: ticket.id, assignment: 2 })
  // resumed 注记先于等待中的消息投递(steer),且 trigger input 纳入步骤后记为已读
  const steered = sent(h, sessionId, 'steer')
  expect(steered.at(-2)?.text).toContain('This ticket ended earlier')
  expect(payload(steered.at(-1)!.text)).toMatchObject({ trigger_id: again.id })
  h.step(sessionId)
  await vi.waitFor(() => {
    const read = h.store.tickets.get(ticket.id)!.inputs.find(item => item.kind === 'trigger' && item.triggerId === again.id)
    expect(read && read.kind === 'trigger' ? read.readAt : undefined).toBeTruthy()
  })
})

it('人 stop 撤回 Mandate:worker 回合被取消、inbox 清空,此后同线程的消息不再投给它', async () => {
  const { ticket, sessionId } = await h.accept(humanTrigger('1', '@bot 修一个'))
  const agent = h.agents.get(sessionId)!

  h.engine.stopTicket(ticket.id, '不要了')
  await vi.waitFor(() => { expect(h.store.tickets.get(ticket.id)?.ended).toMatchObject({ by: 'human', outcome: 'stopped' }) })
  // cancel 已发出(回合结束、inbox 不保留)
  await vi.waitFor(() => { expect(agent.cancel).toHaveBeenCalled() })
  await vi.waitFor(() => { expect(agent.status).toBe('idle') })
  expect([...agent.inbox.nextTurn, ...agent.inbox.nextStep]).toEqual([])

  // 此后同线程的人消息不恢复、不投递:进了新 Eval(被 stop 的工单什么都收不到)
  const before = h.deliveries.mock.calls.length
  const later = humanTrigger('2', '还在吗', { threads: [{ source: 'test', id: 'thread-1' }] })
  h.engine.receive(later)
  h.pass()
  await h.settle()
  expect(h.store.tickets.get(ticket.id)?.ended).toMatchObject({ outcome: 'stopped' })
  expect(h.deliveries.mock.calls.length).toBe(before)
  expect(h.requested.some(candidate => candidate.triggers.some(item => item.id === later.id))).toBe(true)
})
