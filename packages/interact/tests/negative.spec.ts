/** 审批负信号事件发布接口测试(被拒/被修改,设计文档 09 号「审批被拒/被改是最高质量的负信号」)。 */
import { describe, expect, it } from 'vitest'
import { ApprovalSignalBus } from '../src/index.ts'
import type { ApprovalNegativeSignal } from '../src/index.ts'

const META = { toolName: 'pay_order', grade: 'R3' as const, ruleId: 'payment-redline', turnId: 4 }

describe('ApprovalSignalBus 发布与订阅', () => {
  it('publish rejected:订阅者按发布序收到完整信号字段', () => {
    const bus = new ApprovalSignalBus({ now: () => 1_700_000_000_000 })
    const received: ApprovalNegativeSignal[] = []
    bus.subscribe(signal => received.push(signal))
    const signal = bus.publish('rejected', { ...META, agentId: 'agent-1', reason: '金额超预算' })
    expect(signal).toEqual({
      kind: 'rejected',
      toolName: 'pay_order',
      grade: 'R3',
      ruleId: 'payment-redline',
      turnId: 4,
      agentId: 'agent-1',
      reason: '金额超预算',
      time: 1_700_000_000_000,
    })
    expect(received).toEqual([signal])
  })

  it('recordOutcome:DSH 结局翻译——rejected 发布,allowed-once/cancelled/unavailable 不发布', () => {
    const bus = new ApprovalSignalBus()
    const received: ApprovalNegativeSignal[] = []
    bus.subscribe(signal => received.push(signal))
    expect(bus.recordOutcome('allowed-once', META)).toBeUndefined()
    expect(bus.recordOutcome('cancelled', META)).toBeUndefined()
    expect(bus.recordOutcome('unavailable', META)).toBeUndefined()
    expect(received).toHaveLength(0)
    const signal = bus.recordOutcome('rejected', META)
    expect(signal?.kind).toBe('rejected')
    expect(received).toHaveLength(1)
  })

  it('recordModification:R2 产出被用户改写 → modified 信号', () => {
    const bus = new ApprovalSignalBus()
    const received: ApprovalNegativeSignal[] = []
    bus.subscribe(signal => received.push(signal))
    const signal = bus.recordModification({ toolName: 'write_file', grade: 'R2', reason: '用户改写了预算合计行' })
    expect(signal.kind).toBe('modified')
    expect(received[0]?.toolName).toBe('write_file')
    expect(received[0]?.reason).toContain('预算合计行')
  })

  it('监听器抛错被隔离:不中断扇出、不拖垮发布方', () => {
    const bus = new ApprovalSignalBus()
    const ok: ApprovalNegativeSignal[] = []
    bus.subscribe(() => {
      throw new Error('bad consumer')
    })
    bus.subscribe(signal => ok.push(signal))
    expect(() => bus.publish('rejected', META)).not.toThrow()
    expect(ok).toHaveLength(1)
  })

  it('退订生效;recent 快照与 count 反映缓冲;clear 清空', () => {
    const bus = new ApprovalSignalBus()
    const received: ApprovalNegativeSignal[] = []
    const unsubscribe = bus.subscribe(signal => received.push(signal))
    bus.publish('rejected', META)
    unsubscribe()
    bus.publish('rejected', META)
    expect(received).toHaveLength(1)
    expect(bus.count).toBe(2)
    expect(bus.recent().map(signal => signal.kind)).toEqual(['rejected', 'rejected'])
    expect(bus.recent(1)).toHaveLength(1)
    bus.clear()
    expect(bus.count).toBe(0)
  })

  it('环形缓冲上限:超出 bufferLimit 丢最旧', () => {
    const bus = new ApprovalSignalBus({ bufferLimit: 3 })
    for (let index = 0; index < 5; index += 1) {
      bus.publish('rejected', { toolName: `t${index}`, grade: 'R2' })
    }
    expect(bus.count).toBe(3)
    expect(bus.recent().map(signal => signal.toolName)).toEqual(['t2', 't3', 't4'])
  })

  it('时钟注入:time 缺省取 now(),显式 time 优先', () => {
    let tick = 100
    const bus = new ApprovalSignalBus({ now: () => tick })
    const a = bus.publish('rejected', META)
    tick = 200
    const b = bus.publish('rejected', META)
    const c = bus.publish('rejected', { ...META, time: 999 })
    expect(a.time).toBe(100)
    expect(b.time).toBe(200)
    expect(c.time).toBe(999)
  })
})

describe('createInteract 组合面(负信号 + 提问 + 分档联动)', () => {
  it('组合实例的 signals/ask 可用,disposeInteract 清缓冲', async () => {
    const { createInteract, disposeInteract } = await import('../src/index.ts')
    const interact = createInteract({
      hitlYaml: 'default_grade: R2\nrules:\n  - { id: pay, grade: R3, tools: ["pay_*"] }\n',
    })
    const decision = interact.gradeFor({ name: 'pay_order', arguments: { memo: 'x' } })
    expect(decision.grade).toBe('R3')
    interact.ask.add(1, [{ id: 'q1', question: '确认?' }])
    interact.signals.recordOutcome('rejected', { toolName: 'pay_order', grade: decision.grade })
    expect(interact.signals.count).toBe(1)
    expect(interact.ask.pendingTurnId).toBe(1)
    disposeInteract(interact)
    expect(interact.signals.count).toBe(0)
    expect(interact.ask.pendingTurnId).toBeUndefined()
    expect(interact.presetArtifact.config.defaultPreset).toBe('basis-r2-confirm')
  })

  it('hitlYaml/hitl 均缺 → InteractConfigError', async () => {
    const { createInteract, InteractConfigError } = await import('../src/index.ts')
    expect(() => createInteract({})).toThrow(InteractConfigError)
  })
})
