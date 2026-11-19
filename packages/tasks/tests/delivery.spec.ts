/**
 * 工单 Inputs 的投递面:逐条投递、readAt 记录、deliverFailed 上票、blocked/failed
 * 压自动输入(35 号 A22 验收门禁;34 号 §4-D delivery 行)。
 *
 * 走 DshExecutor 的 `delivery` effect + Sessions 的 steer/queue 投递,在模拟 DSH 宿主
 * fixture 上驱动;与 tests/runtime-lifecycle.spec.ts 的全生命周期互补,此处聚焦投递
 * 语义本身。
 */
import { expect, it, vi } from 'vitest'
import { humanTrigger, startHost } from './fixtures/host.ts'

/** 解析投递文本为 JSON 载荷(typed,免 any 逃逸)。 */
const payload = (text: string): Record<string, unknown> => JSON.parse(text) as Record<string, unknown>

/** 某工单的某条 trigger input(读字段用)。 */
const inputOf = (h: Awaited<ReturnType<typeof startHost>>, ticketId: string, triggerId: string) =>
  h.store.tickets.get(ticketId)?.inputs.find(item => item.kind === 'trigger' && item.triggerId === triggerId)

it('到达同线程的多条人消息逐条按序投递,每条投递前重读工单状态', async () => {
  const h = await startHost()
  try {
    const { ticket, sessionId } = await h.accept(humanTrigger('1', '@bot 修一'))
    const second = humanTrigger('2', '先改这个', { threads: [{ source: 'test', id: 'thread-1' }] })
    const third = humanTrigger('3', '再补这个', { threads: [{ source: 'test', id: 'thread-1' }] })
    h.engine.receive(second)
    h.engine.receive(third)
    await h.settle()
    // 逐条(undelivered 从头 drain)、按到达序;投完即空
    const steered = h.deliveries.mock.calls.map(([call]) => call)
      .filter(call => call.sessionId === sessionId && call.mode === 'steer').map(call => payload(call.text).trigger_id)
    expect(steered).toEqual([second.id, third.id])
    expect(h.store.tickets.get(ticket.id)?.undelivered).toEqual([])
    // 每条都已记 deliveredTo 运行中的 assignment
    const assignment = h.store.tickets.get(ticket.id)!.assignments[0]!
    for (const trigger of [second, third]) {
      const input = inputOf(h, ticket.id, trigger.id)
      expect(input && input.kind === 'trigger' ? input.deliveredTo : undefined).toBe(assignment.id)
    }
  }
  finally { await h.stop() }
})

it('steer 进来的消息被 session 纳入步骤才记 readAt;被取消截断的领取不算读', async () => {
  const h = await startHost()
  try {
    const { ticket, sessionId } = await h.accept(humanTrigger('1', '@bot 修一'))
    const readAt = (id: string): string | null | undefined => {
      const item = inputOf(h, ticket.id, id)
      return item?.kind === 'trigger' ? item.readAt : undefined
    }
    const first = humanTrigger('2', '补充要求', { threads: [{ source: 'test', id: 'thread-1' }] })
    h.engine.receive(first)
    await h.settle()
    // 已投递、尚未读:readAt 为 null(等待在 session 里)
    expect(readAt(first.id)).toBeNull()
    // 被截断的领取:消息被 claim 却没进历史——它既不被丢弃也不再发出,永不算读
    h.claim(sessionId)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(readAt(first.id)).toBeNull()
    // 后到的另一条真正纳入步骤后记为已读
    const second = humanTrigger('3', '再补一条', { threads: [{ source: 'test', id: 'thread-1' }] })
    h.engine.receive(second)
    await h.settle()
    h.step(sessionId)
    await vi.waitFor(() => { expect(readAt(second.id)).toBeTruthy() })
    expect(readAt(first.id)).toBeNull()
  }
  finally { await h.stop() }
})

it('投递失败上票(deliveryFailed):工单记失败原因,重试成功后清除', async () => {
  vi.useFakeTimers()
  const h = await startHost()
  try {
    const { ticket, sessionId } = await h.accept(humanTrigger('1', '@bot 修一'))
    const followup = humanTrigger('2', '补充', { threads: [{ source: 'test', id: 'thread-1' }] })
    h.engine.receive(followup)
    await h.settle()
    const agent = h.agents.get(sessionId)!
    // 两条都让 steer 失败:投递在工单上记 delivery 错误并经 effect 重试
    const original = agent.steer.getMockImplementation()
    agent.steer.mockImplementation(() => { throw new Error('session busy') })
    const retrying = humanTrigger('3', '再补', { threads: [{ source: 'test', id: 'thread-1' }] })
    h.engine.receive(retrying)
    await h.effects.idle('delivery')
    const failed = h.store.tickets.get(ticket.id)
    expect(failed?.delivery?.error).toContain('session busy')
    // 恢复投递:默认重试延迟(2000ms)后同一条重投成功,delivery 记录清除
    agent.steer.mockImplementation(original!)
    await vi.advanceTimersByTimeAsync(2_000)
    await h.settle()
    await vi.waitFor(() => { expect(h.store.tickets.get(ticket.id)?.delivery).toBeUndefined() })
    const steered = h.deliveries.mock.calls.map(([call]) => call)
      .filter(call => call.sessionId === sessionId && call.mode === 'steer').map(call => payload(call.text).trigger_id)
    expect(steered).toContain(retrying.id)
    expect(h.store.tickets.get(ticket.id)?.undelivered).toEqual([])
  }
  finally { vi.useRealTimers(); await h.stop() }
})

it('blocked/failed 压住自动输入:bot 消息不投给等人的 worker,人的消息解锁投递', async () => {
  const h = await startHost()
  try {
    const { ticket, sessionId } = await h.accept(humanTrigger('1', '@bot 修一'))
    h.engine.report(ticket.id, { state: 'blocked', summary: '需要提供测试账号' })
    // 等人的工单(waitsForPerson):bot 的自动消息被扣住,不进投递
    const bot = { ...humanTrigger('2', 'CI: build failed', { threads: [{ source: 'test', id: 'thread-1' }] }), human: false, addressed: undefined }
    h.engine.receive(bot as never)
    h.pass()
    await h.settle()
    const steered = () => h.deliveries.mock.calls.map(([call]) => call)
      .filter(call => call.sessionId === sessionId && call.mode === 'steer').map(call => payload(call.text).trigger_id)
    expect(steered()).toEqual([])
    const botInput = inputOf(h, ticket.id, bot.id)
    expect(botInput?.kind === 'trigger' ? botInput.human : true).toBeFalsy()
    // 人的消息解除封锁并投递给 worker
    const person = humanTrigger('3', '账号是 a/b', { threads: [{ source: 'test', id: 'thread-1' }] })
    h.engine.receive(person)
    h.pass()
    await h.settle()
    expect(steered()).toEqual([person.id])
    expect(h.store.tickets.get(ticket.id)?.undelivered).toEqual([])
  }
  finally { await h.stop() }
})
