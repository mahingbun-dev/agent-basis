/**
 * WorkerSlots 与 executor 并发:重叠 launch/delivery/唤醒下槽位不超 max、人插队 +1、
 * 唤醒先于新 launch;插队计数暴露 observe(35 号 A14 验收门禁;34 号 §4-E
 * concurrency 行 =G2-A4 同文件族;27 号 §3.1-4/§3.2-④/§5-2)。
 */
import { describe, expect, it, vi } from 'vitest'
import { Later } from '../src/effects/effects.ts'
import { WorkerSlots } from '../src/executor/slots.ts'
import { humanTrigger, startHost } from './fixtures/host.ts'

// 纯单元:槽位记账、launch 容量、人插队 +1 与 Later。
describe('WorkerSlots 纯函数面', () => {
  it('槽数与 launch 容量:启动预留计入 used、非 launch 唤醒占掉 launch 容量', () => {
    const slots = new WorkerSlots(() => ['a'], () => 2)
    expect(slots.used()).toBe(1)
    expect(slots.launches()).toBe(1)
    // 启动预留计入 used:第二个槽被 launch 预留占住
    slots.reserve('b', 'launch')
    expect(slots.used()).toBe(2)
    slots.free('b')
    // 一个 wake 预留占掉新 launch 的容量(唤醒优先于新 launch)
    slots.reserve('c', 'wake')
    expect(slots.launches()).toBe(0)
  })
  it('槽满抛 Later;人的消息可插队 +1 槽并计数,普通唤醒不能', () => {
    const slots = new WorkerSlots(() => ['a'], () => 1)
    expect(() => { slots.reserve('b', 'launch') }).toThrow(Later)
    expect(() => { slots.reserve('b', 'wake') }).toThrow(Later)
    // 人插队:used()=1 已达 max(),仍经 +1 槽占住——这一次数入插队计数(D2)
    expect(slots.personBarges()).toBe(0)
    slots.reserve('b', 'person')
    expect(slots.used()).toBe(2)
    expect(slots.personBarges()).toBe(1)
    // 第二次人的插队不再有槽(+1 只有一个)
    expect(() => { slots.reserve('c', 'person') }).toThrow(Later)
    expect(slots.personBarges()).toBe(1)
    // 已持启动槽的重复 reserve 幂等
    slots.reserve('b', 'person')
    expect(slots.personBarges()).toBe(1)
    // 有空闲槽时的人唤醒不算插队
    const spare = new WorkerSlots(() => ['a'], () => 2)
    spare.reserve('b', 'person')
    expect(spare.personBarges()).toBe(0)
  })
})

/** executor 集成:重叠 launch 下并发受 maxWorkers 限制,槽空出来按队列序续启。 */
it('三个重叠 launch 只有两个并发:第三个等槽,worker 空闲后按队列序启动', async () => {
  const h = await startHost()
  try {
    const settings = h.store.settings()
    h.store.saveSettings({ ...settings, executor: { ...settings.executor, maxWorkers: 2 } })
    // gate 摁住前两次 worker session 的创建:两个 launch 并发挂起,第三个不得启动
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let created = 0
    // A22 的 session seam 已迁至 sessionPorts.controller(fixture 的 sessionController):
    // worker session 的创建经它,launch 并发门摁这里。
    const original = h.sessionController.create.getMockImplementation()!
    h.sessionController.create.mockImplementation(
      async (options: { sessionId?: string; workspaceId?: string; cwd?: string; agentPreset?: string }) => {
        created += 1
        if (created <= 2) await gate
        return await original(options)
      })
    const acceptNow = (id: string): string => {
      const trigger = humanTrigger(id, `@bot 修 ${id}`)
      h.engine.receive(trigger)
      h.pass()
      const candidate = h.requested.at(-1)!
      h.engine.candidateDelivered(candidate.evalId)
      const decision = h.engine.decide(candidate.triggers[0]!.id, {
        kind: 'accept', title: `Fix ${id}`, scope: 'Do the work.', reason: 'explicit request',
        delegation: { objective: 'o', outputFormat: 'f', toolGuidance: 't', taskBoundaries: 'b' },
      })
      return decision.ticketId!
    }
    const first = acceptNow('1'), second = acceptNow('2'), third = acceptNow('3')
    await vi.waitFor(() => { expect(h.sessionController.create).toHaveBeenCalledTimes(2) })
    // 第三个 launch 尚未启动:其 worker session 不存在,effect 行在等
    expect(h.agents.has(`worker-${third}`)).toBe(false)
    expect(h.effects.pending('launch', h.store.tickets.get(third)!.assignments[0]!.id)).toBe(true)
    release()
    await vi.waitFor(() => {
      expect(h.store.tickets.get(first)!.assignments[0]).toMatchObject({ state: 'running' })
      expect(h.store.tickets.get(second)!.assignments[0]).toMatchObject({ state: 'running' })
    })
    // 两槽已满:第三个仍等(并发不超 max)
    await Promise.resolve()
    expect(h.agents.has(`worker-${third}`)).toBe(false)
    // 一个 worker 空闲(无后台工作,槽释放)后,第三个按队列序启动
    h.idle(`worker-${first}`)
    await vi.waitFor(() => { expect(h.agents.has(`worker-${third}`)).toBe(true) })
    await h.settle()
    expect(h.store.tickets.get(third)!.assignments[0]).toMatchObject({ state: 'running' })
  }
  finally { await h.stop() }
})

/** executor 集成:槽满时人的消息经 +1 槽唤醒其 worker,新 launch 仍等着;插队计数暴露。 */
it('人插队 +1:槽满时人的消息唤醒其 worker,新 launch 继续等,插队计数为 1', async () => {
  const h = await startHost()
  try {
    const settings = h.store.settings()
    h.store.saveSettings({ ...settings, executor: { ...settings.executor, maxWorkers: 2 } })
    const acceptNow = async (id: string): Promise<string> => {
      const trigger = humanTrigger(id, `@bot 修 ${id}`)
      h.engine.receive(trigger)
      h.pass()
      const candidate = h.requested.at(-1)!
      h.engine.candidateDelivered(candidate.evalId)
      const decision = h.engine.decide(candidate.triggers[0]!.id, {
        kind: 'accept', title: `Fix ${id}`, scope: 'Do the work.', reason: 'explicit request',
        delegation: { objective: 'o', outputFormat: 'f', toolGuidance: 't', taskBoundaries: 'b' },
      })
      await h.settle()
      return decision.ticketId!
    }
    const first = await acceptNow('1'), second = await acceptNow('2')
    // worker-1 的回合安静结束(无后台工作):其槽释放;worker-2 仍跑着
    h.idle(`worker-${first}`)
    await vi.waitFor(() => {
      const report = h.store.tickets.get(first)!.assignments.at(-1)?.report
      expect(report?.state).toBe('waiting')
    })
    // 收紧并发到 1:现在唯一槽被 worker-2 占满
    h.store.saveSettings({ ...h.store.settings(), executor: { ...h.store.settings().executor, maxWorkers: 1 } })
    // 第三个工单被接受:无 launch 容量,worker 不得启动
    const third = await acceptNow('3')
    expect(h.agents.has(`worker-${third}`)).toBe(false)
    expect(h.executor.personBarges()).toBe(0)
    // 人的消息到达 idle 的 worker-1:经 +1 槽插队唤醒投递;新 launch(worker-3)仍等
    h.engine.receive(humanTrigger('4', '一做得怎样了', { threads: [{ source: 'test', id: 'thread-1' }] }))
    await h.settle()
    const steer = h.deliveries.mock.calls.map(([call]) => call)
      .filter(call => call.sessionId === `worker-${first}` && call.mode === 'steer').at(-1)
    expect(steer).toBeDefined()
    expect(h.executor.personBarges()).toBe(1)
    expect(h.agents.has(`worker-${third}`)).toBe(false)
    // 两槽重新空出来(被人消息唤醒的 worker-1 也结束其回合)后,新 launch 才启动
    h.idle(`worker-${second}`)
    h.idle(`worker-${first}`)
    await vi.waitFor(() => { expect(h.agents.has(`worker-${third}`)).toBe(true) })
  }
  finally { await h.stop() }
})
