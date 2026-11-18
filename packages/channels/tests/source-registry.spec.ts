import { describe, expect, it } from 'vitest'
import {
  applyLifecycleForwards, createSourceRegistry, githubPrSourceKind, key, threadKey, threadRefFromKey,
  webhookSourceKind, type InboundMessage, type ReceiveDisposition, type Trigger, type TriggerSink,
} from '../src/index.ts'

/** 记录型 sink 桩(幂等三态按内容派生 id 判重——模拟 tasks 侧 Engine.receive 语义)。 */
class RecordingSink implements TriggerSink {
  readonly received: Trigger[] = []
  bindThreadCalls: Array<{ ticketId: string; threadKey: string; own: boolean }> = []
  threadClosedCalls: Array<{ threadKey: string; outcome: 'merged' | 'closed'; at: string }> = []

  receive(trigger: Trigger): ReceiveDisposition {
    const seen = this.received.some(existing => existing.id === trigger.id)
    this.received.push(trigger)
    return seen ? 'duplicate' : 'stored'
  }

  bindThread(ticketId: string, threadKey: string, own: boolean): unknown {
    this.bindThreadCalls.push({ ticketId, threadKey, own })
    return undefined
  }

  threadClosed(threadKey: string, outcome: 'merged' | 'closed', at: string): void {
    this.threadClosedCalls.push({ threadKey, outcome, at })
  }
}

describe('SourceRegistry:注册面(39 号 E2 验收①)', () => {
  it('注册/查询/列举;同实例幂等,不同实例抢同 ID 抛错', () => {
    const registry = createSourceRegistry([webhookSourceKind])
    expect(registry.list().map(kind => kind.id)).toEqual(['webhook'])
    expect(registry.get('webhook')).toBe(webhookSourceKind)
    registry.register(webhookSourceKind) // 同实例幂等
    expect(() => {
      registry.register({ ...webhookSourceKind, normalizeMessage: webhookSourceKind.normalizeMessage.bind(webhookSourceKind) })
    }).toThrow(/Source kind ID 冲突/)
    expect(() => {
      registry.deliverMessage('nope', { channelType: 'webhook', channelUserId: 'u', text: 'x' }, undefined, new RecordingSink())
    }).toThrow(/未注册的 Source kind/)
  })
})

describe('webhook kind 归一化:信封 → Trigger(trigger.ts 中立契约,与 tasks core 同构)', () => {
  it('② channel_user 透传为 actor;threads[0] 为绑定 thread;幂等 id 内容派生且不含到达时刻', () => {
    const trigger = webhookSourceKind.normalizeMessage(
      { channelType: 'feishu', channelUserId: 'fs-u1', text: '把发布会日程排一下', messageId: 'msg-1', occurredAt: '2026-11-17T08:00:00Z' },
      { threadKey: 'web:conv-9' },
    )
    // channel_user 透传(情况 A 归一化防线)
    expect(trigger.actor).toEqual({ source: 'feishu', id: 'fs-u1' })
    // 绑定 thread 解析为 ThreadRef(规范键 source:id,trigger.ts threadKey)
    const primary = trigger.threads[0]
    expect(primary).toEqual({ source: 'web', id: 'conv-9' })
    if (primary !== undefined) expect(threadKey(primary)).toBe('web:conv-9')
    // 只写地址声明(结果回到发起渠道)
    expect(trigger.channel).toEqual({ source: 'feishu', thread: 'web:conv-9', address: { channelUserId: 'fs-u1' } })
    expect(trigger.human).toBe(true)
    expect(trigger.text).toBe('把发布会日程排一下')
    expect(trigger.at).toBe('2026-11-17T08:00:00.000Z')
    // 幂等 id:同内容(含 messageId)稳定,与到达时刻无关——重放收敛为同一 id
    const replay = webhookSourceKind.normalizeMessage(
      { channelType: 'feishu', channelUserId: 'fs-u1', text: '把发布会日程排一下', messageId: 'msg-1', occurredAt: '2026-11-17T09:30:00Z' },
      { threadKey: 'web:conv-9' },
    )
    expect(replay.id).toBe(trigger.id)
    expect(trigger.id).toBe(key('channels/webhook', 'feishu', 'fs-u1', 'msg-1', '把发布会日程排一下'))
    // 内容不同 → id 不同
    const other = webhookSourceKind.normalizeMessage(
      { channelType: 'feishu', channelUserId: 'fs-u1', text: '另一件事', messageId: 'msg-2' },
      { threadKey: 'web:conv-9' },
    )
    expect(other.id).not.toBe(trigger.id)
  })

  it('无 thread 绑定:以渠道原生会话(channel_user 对话)承载主线程不变量;不声明 channel 地址', () => {
    const trigger = webhookSourceKind.normalizeMessage(
      { channelType: 'wecom', channelUserId: 'wx-a', text: 'hi' },
      undefined,
    )
    expect(trigger.threads).toEqual([{ source: 'wecom', id: 'wx-a' }])
    expect(trigger.channel).toBeUndefined()
  })

  it('threadRefFromKey:规范键按首个冒号拆分;无冒号 opaque 值以渠道为 source', () => {
    expect(threadRefFromKey('web:conv-42', 'feishu')).toEqual({ source: 'web', id: 'conv-42' })
    expect(threadRefFromKey('opaque-thread-1', 'feishu')).toEqual({ source: 'feishu', id: 'opaque-thread-1' })
  })
})

describe('PR 生命周期扩展钩子(39 号 E2 验收③)', () => {
  it('merge 事件 → threadClosed(threadKey, merged, at) 转发到 sink', () => {
    const registry = createSourceRegistry([githubPrSourceKind])
    const sink = new RecordingSink()
    const forwards = registry.deliverLifecycle('github-pr', {
      action: 'closed',
      pull_request: { number: 7, merged: true, merged_at: '2026-11-17T10:00:00Z' },
    }, sink)
    expect([...forwards]).toEqual([{ type: 'threadClosed', threadKey: 'github:pr-7', outcome: 'merged', at: '2026-11-17T10:00:00Z' }])
    expect(sink.threadClosedCalls).toEqual([{ threadKey: 'github:pr-7', outcome: 'merged', at: '2026-11-17T10:00:00Z' }])
  })

  it('未合并关闭 → closed;opened + ticket_id → bindThread(own=true);缺字段不转发', () => {
    const sink = new RecordingSink()
    applyLifecycleForwards(githubPrSourceKind.lifecycleEvents?.({
      action: 'closed', pull_request: { number: 8, merged: false, closed_at: '2026-11-17T11:00:00Z' },
    }) ?? [], sink)
    expect(sink.threadClosedCalls).toEqual([{ threadKey: 'github:pr-8', outcome: 'closed', at: '2026-11-17T11:00:00Z' }])

    applyLifecycleForwards(githubPrSourceKind.lifecycleEvents?.({
      action: 'opened', ticket_id: 't-100', pull_request: { number: 9 },
    }) ?? [], sink)
    expect(sink.bindThreadCalls).toEqual([{ ticketId: 't-100', threadKey: 'github:pr-9', own: true }])

    expect(githubPrSourceKind.lifecycleEvents?.({ action: 'opened', pull_request: { number: 10 } }) ?? []).toEqual([])
    expect(githubPrSourceKind.lifecycleEvents?.({ action: 'reopened' }) ?? []).toEqual([])
  })

  it('github-pr 源不承载 message 归一化(仅生命周期钩子)', () => {
    expect(() => {
      githubPrSourceKind.normalizeMessage({ channelType: 'webhook', channelUserId: 'u', text: 'x' }, undefined)
    }).toThrow(/不承载 message 归一化/)
  })
})

describe('TriggerSink 三态原样透传(39 号 E2 验收④,情况 C 的 channels 半边)', () => {
  it('桩返回 duplicate 时注册面原样透传,不产生第二次投递副作用', () => {
    const registry = createSourceRegistry([webhookSourceKind])
    const sink = new RecordingSink()
    const message: InboundMessage = { channelType: 'feishu', channelUserId: 'fs-u1', text: '同一件事', messageId: 'msg-dup' }
    expect(registry.deliverMessage('webhook', message, { threadKey: 'web:conv-9' }, sink)).toBe('stored')
    expect(registry.deliverMessage('webhook', message, { threadKey: 'web:conv-9' }, sink)).toBe('duplicate')
    // sink 被调用两次,但「存单」副作用只发生一次(幂等归 tasks,channels 断言副作用面)
    expect(sink.received).toHaveLength(2)
    expect(new Set(sink.received.map(trigger => trigger.id)).size).toBe(1)
  })
})
