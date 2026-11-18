/**
 * channels 事件 → Trigger 归一化面(35 号 A21 验收门禁;34 号 §4-F 承接表
 * 「sources.spec.ts → channel-adapter.spec.ts」判据原文:channels 事件→Trigger 归一化、
 * scope 过滤 filtered、幂等 id 派生(27 号 §3.3 情况 C);34 §4-F「registry.spec 并入
 * channel-adapter:注册面由 channels 侧承担(39-E2),其守护的 scope 过滤/幂等 id
 * 并入本文件判据」)。
 *
 * 走 Engine 内核假件 harness(MemoryRepositories + 真 Engine,34 §4-A 假件模式):
 * channels 侧以已交付的 39-E2 面(webhookSourceKind 归一化 + githubPrSourceKind
 * 生命周期钩子)产出中立 Trigger/转发,适配器(ChannelTriggerAdapter)重派幂等 id 后
 * 送 EngineForSources。附两侧纯函数同构看护(channels trigger.ts 头注的「漂移即接线
 * 断裂」契约的运行时半边;编译期半边在 src/sources/port.ts 的同构钉住类型)。
 */
import { expect, it } from 'vitest'
import { githubPrSourceKind, threadRefFromKey, webhookSourceKind, key as channelsKey } from '@eterna/channels'
import type { InboundMessage, ThreadTarget } from '@eterna/channels'
import { key, threadKey } from '../src/core/index.ts'
import { accepted, engineHarness } from './fixtures/engine.ts'
import { ChannelTriggerAdapter, normalizeChannelTrigger, threadRefOf } from '../src/sources/channel-adapter.ts'
import type { Trigger as ChannelsTrigger } from '@eterna/channels'

/** 一条 webhook 渠道消息(E3 信封形状;39 §3-E2 webhookSourceKind 消费面)。 */
const webhookMessage = (overrides: Partial<InboundMessage> = {}): InboundMessage => ({
  channelType: 'webhook', channelUserId: 'u-9', text: '请修复登录回归', messageId: 'm-1',
  occurredAt: '2026-09-23T00:00:01Z', ...overrides,
})

/** 仿 channels 网关(E3 message 分支)构造一条已归一化的中立 Trigger。 */
const webhookTrigger = (message: InboundMessage, binding?: ThreadTarget): ChannelsTrigger =>
  webhookSourceKind.normalizeMessage(message, binding)

it('channels 事件→Trigger 归一化:channel_user 收敛身份透传为 actor,主线程取绑定 thread,入 Engine 落库(stored)', () => {
  const h = engineHarness()
  const adapter = new ChannelTriggerAdapter({ engine: h.engine })
  const binding: ThreadTarget = { threadKey: 'feishu:thread-9' }
  const disposition = adapter.receive(webhookTrigger(webhookMessage(), binding))
  expect(disposition).toBe('stored')
  // 幂等 id 以 tasks key() 按稳定内容重派(源、渠道身份、主线程、渠道消息 id、文本;
  // 不含到达时刻):与 channels 自产 id 分键,两侧算法漂移不影响 intake 判重。
  const expectedId = key('tasks/channel-trigger', 'webhook', 'u-9', 'feishu:thread-9', 'm-1', '请修复登录回归')
  const stored = h.repo.triggers.get(expectedId)
  // channel_user 收敛身份(27 号 §3.3 情况 A 的归一化防线):(渠道类型, 渠道身份) 原样
  expect(stored?.actor).toEqual({ source: 'webhook', id: 'u-9' })
  // 主线程 = 绑定解析出的 thread(多渠道收敛同一 thread 的落点);整秒时间戳归一 ISO
  expect(stored?.threads).toEqual([{ source: 'feishu', id: 'thread-9' }])
  expect(stored?.at).toBe('2026-09-23T00:00:01.000Z')
  expect(stored?.human).toBe(true)
  expect(stored?.text).toBe('请修复登录回归')
  // 只写地址(结果回发起渠道的回信面,34 §3 ChannelRef)与 Source 原生 meta 保留
  expect(stored?.channel).toEqual({ source: 'webhook', thread: 'feishu:thread-9', address: { channelUserId: 'u-9' } })
  expect(stored?.meta).toMatchObject({ messageId: 'm-1' })
})

it('幂等 id 派生(27 号 §3.3 情况 C):同一事件重放得同一 id→duplicate 收敛一单;内容不同得新 id', () => {
  const h = engineHarness()
  const adapter = new ChannelTriggerAdapter({ engine: h.engine })
  const binding: ThreadTarget = { threadKey: 'feishu:thread-9' }
  const trigger = webhookTrigger(webhookMessage(), binding)
  const tasksId = normalizeChannelTrigger(trigger).id
  expect(adapter.receive(trigger)).toBe('stored')
  // webhook 重试/事件重放:同一内容第二次到达(到达时刻不同也不参与派生)
  const replay = webhookTrigger(webhookMessage({ occurredAt: '2026-09-23T00:05:00Z' }), binding)
  expect(adapter.receive(replay)).toBe('duplicate')
  // intake 幂等三态的库面:同一 tasks id 只有那条 Trigger(get 命中即唯一;重复投递不重记)
  expect(h.repo.triggers.get(tasksId)?.id).toBe(tasksId)
  // 内容不同(文本变)= 新事件,不得撞 id
  const other = webhookTrigger(webhookMessage({ text: '换一个问题', messageId: 'm-2' }), binding)
  expect(adapter.receive(other)).toBe('stored')
  expect(other.id === trigger.id).toBe(false)
  // 归一化纯函数本身:相等输入恒产相等 id,与接收侧解耦
  expect(normalizeChannelTrigger(trigger).id).toBe(normalizeChannelTrigger(webhookTrigger(webhookMessage(), binding)).id)
})

it('scope 过滤 filtered:未监听源的 Trigger 记 filtered 落库、不进 Eval(经适配器原样透传)', () => {
  // harness 的 scope:meta.blocked 即不监听(intake.ts:37-40 的 filtered 落库路径)。
  const h = engineHarness()
  const adapter = new ChannelTriggerAdapter({ engine: h.engine })
  const blocked = webhookTrigger(webhookMessage({ channelUserId: 'u-stranger' }), { threadKey: 'feishu:thread-x' })
  const trigger = normalizeChannelTrigger({ ...blocked, meta: { ...blocked.meta, blocked: true } })
  const disposition = adapter.receive(trigger)
  expect(disposition).toBe('filtered')
  // filtered 落库(intake 语义):Trigger 与 disposition 都在,但不进 Eval(无候选请求)
  expect(h.repo.triggers.get(trigger.id)?.id).toBe(trigger.id)
  expect(h.repo.triggers.disposition(trigger.id)?.filtered).toMatchObject({ code: 'chat not allowed' })
  // 不进 Eval:assessor 的候选请求为零(Eval 只为被监听的 trigger 排队)
  expect(h.request).not.toHaveBeenCalled()
})

it('PR 生命周期扩展钩子(24a A5):opened→bindThread(own) 落绑定,merge→threadClosed 随线程收尾', () => {
  const h = engineHarness()
  const adapter = new ChannelTriggerAdapter({ engine: h.engine })
  const decision = accepted(h, '1', 't1')
  const ticketId = decision.ticketId!
  // github-pr 钩子(channels 39-E2 样例):opened + ticket_id → bindThread(own=true)
  const forwards = githubPrSourceKind.lifecycleEvents!({ action: 'opened', ticket_id: ticketId, pull_request: { number: 7 } })
  expect(forwards).toEqual([{ type: 'bindThread', ticketId, threadKey: 'github:pr-7', own: true }])
  for (const forward of forwards) {
    if (forward.type === 'bindThread') adapter.bindThread(forward.ticketId, forward.threadKey, forward.own)
    else adapter.threadClosed(forward.threadKey, forward.outcome, forward.at)
  }
  const followed = h.repo.tickets.get(ticketId)
  expect(followed?.follows).toMatchObject([{ thread: 'github:pr-7', own: true }])
  // 工单的活没干完前,merge 只记关闭不收尾(unfinished 门)
  h.engine.report(ticketId, { state: 'ready', summary: '修复完成' })
  const merged = githubPrSourceKind.lifecycleEvents!({ action: 'closed', pull_request: { number: 7, merged: true, merged_at: '2026-09-23T01:00:00Z' } })
  expect(merged).toEqual([{ type: 'threadClosed', threadKey: 'github:pr-7', outcome: 'merged', at: '2026-09-23T01:00:00Z' }])
  for (const forward of merged) {
    if (forward.type === 'bindThread') adapter.bindThread(forward.ticketId, forward.threadKey, forward.own)
    else adapter.threadClosed(forward.threadKey, forward.outcome, forward.at)
  }
  const ended = h.repo.tickets.get(ticketId)
  expect(ended?.ended).toMatchObject({ by: 'executor', outcome: 'merged' })
  // 非 merge 的关闭:outcome=closed(「GitHub PR merge→threadClosed」的 outcome 区分面)
  const decision2 = accepted(h, '2', 't2')
  const forwards2 = githubPrSourceKind.lifecycleEvents!({ action: 'opened', ticket_id: decision2.ticketId, pull_request: { number: 8 } })
  for (const forward of forwards2) {
    if (forward.type === 'bindThread') adapter.bindThread(forward.ticketId, forward.threadKey, forward.own)
    else adapter.threadClosed(forward.threadKey, forward.outcome, forward.at)
  }
  h.engine.report(decision2.ticketId!, { state: 'ready', summary: '完成' })
  const closed = githubPrSourceKind.lifecycleEvents!({ action: 'closed', pull_request: { number: 8, merged: false, closed_at: '2026-09-23T02:00:00Z' } })
  for (const forward of closed) {
    if (forward.type === 'bindThread') adapter.bindThread(forward.ticketId, forward.threadKey, forward.own)
    else adapter.threadClosed(forward.threadKey, forward.outcome, forward.at)
  }
  expect(h.repo.tickets.get(decision2.ticketId!)?.ended).toMatchObject({ outcome: 'closed' })
})

it('两侧纯函数同构看护(channels trigger.ts 头注契约):key/threadKey/threadRefFromKey 解析与 tasks 侧一致', () => {
  // 幂等键算法同构:同一内容元组两侧恒产同一 id(「两侧 key() 算法漂移 = intake 判重
  // 失效」的运行时看护;任务侧入站 id 已自持,本断言护的是契约面不静默漂移)
  expect(channelsKey('channels/webhook', 'webhook', 'u-9', 'm-1', 'text')).toBe(key('channels/webhook', 'webhook', 'u-9', 'm-1', 'text'))
  // 规范线程键同构:`${source}:${id}`
  expect(threadKey({ source: 'feishu', id: 'thread-9' })).toBe('feishu:thread-9')
  // 生命周期转发键解析同构:channels threadRefFromKey 与 tasks threadRefOf 对同一键
  // 产出同一 ThreadRef(退化键以各自 fallback 承载,规范键恒一致)
  expect(threadRefOf('github:pr-7')).toEqual(threadRefFromKey('github:pr-7', 'github'))
  expect(threadRefOf('feishu:thread-9')).toEqual(threadRefFromKey('feishu:thread-9', 'feishu'))
})
