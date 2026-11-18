/**
 * channels 投递面自派生用例(★A1 回执接线验收;41-M4 判据「reply effect 经 channels 结算」):
 * - (i) 假 channels world(结构面齐备)+ Engine/replies 入队 receipt → effects 结算 → status='sent';
 * - (ii) bindings 无绑定 → channelAllowed=false → 落 dropped channelIgnored(不出站);
 * - (iii) 服务缺席 → 惰性面逐调用按 UNWIRED 语义行事,回执恒 pending 无错误(Later 不计失败);
 * - (iv) send 抛 channelGone 类 → 落 dropped channelGone;transient 类原样上抛走退避重试(不落 dropped);
 * - (v) 时序:派生时点服务未 provide(boot 时序常态)→ 服务后到即接上(Later 重试吸收)。
 *
 * 结构端口纪律(34 号 §1):tasks 不 import 宿主服务实例——ctx 以 reflect.provide 挂
 * channels 服务束(结构同构 glue ChannelsWorld:@eterna/channels 真件 + cards 纯函数面),
 * 消费走 channelsDeliveryFromContext 的结构面;组卡产物经离线传输器记录(不出网络)。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  ChannelsDeliveryError, buildReplyCard, classifyDeliveryFailure, createChannelsService,
  createFeishuChannelAdapter, createOfflineCardTransport, validateOutboundCard,
} from '@eterna/channels'
import type { ChannelAdapter, ChannelBindingStore, OfflineCardTransport } from '@eterna/channels'
import { channelsDeliveryFromContext } from '../src/effects/channels-delivery.ts'
import { createTasks } from '../src/plugin.ts'
import type { ChannelsDelivery, Receipt, TasksRuntime } from '../src/index.ts'
import { SOURCE, humanTrigger } from './fixtures/host.ts'
import type { Reply, ScopeResult, SourceScope, Trigger } from '../src/core/index.ts'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'tasks-channels-delivery-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

const testScope: SourceScope = {
  scope: ({ source }): ScopeResult =>
    source === SOURCE ? { listened: true, observed: true, row: 'main' } : { listened: false, reason: 'not_listened' },
}

/** 渠道 trigger(带回信地址:channel.source=feishu 对齐适配器注册的 channelType,channels source.ts:100 同形)。 */
const channelTrigger = (id: string, text: string): Trigger => humanTrigger(id, text, {
  channel: { source: 'feishu', thread: 'tasks:thread-1', address: { channelUserId: 'fs-user-1' } },
})

/** 飞书回执(outbox.send 的 Receipt 形;直接投递面单测用)。 */
const receiptOf = (id: string): Receipt => ({
  id, channel: { source: 'feishu', thread: 'tasks:thread-1', address: { channelUserId: 'fs-user-1' } },
  text: `text of ${id}`, kind: 'reply', status: 'pending',
})

interface WorldMount {
  readonly delivery: ChannelsDelivery
  readonly bindings: ChannelBindingStore
  readonly transport: OfflineCardTransport
}

/**
 * 假 channels world(结构端口齐备):@eterna/channels 真件服务束 + cards 纯函数面
 * (glue createChannelsCardsFace 同构转发),经 ctx.reflect.provide 挂 'channels' 服务名。
 * adapter 缺省为飞书离线适配器(传输记录发送,不出网络);传入即替换(gone 类用例)。
 */
function mountChannelsWorld(ctx: Context, adapter?: ChannelAdapter): WorldMount {
  const service = createChannelsService()
  const transport = createOfflineCardTransport()
  service.adapters.register(adapter ?? createFeishuChannelAdapter({ transport }))
  ctx.reflect.provide('channels', {
    id: service.id,
    bindings: service.bindings,
    tokens: service.tokens,
    adapters: service.adapters,
    sources: service.sources,
    cards: { buildReplyCard, validateOutboundCard, classifyDeliveryFailure },
  })
  return { delivery: channelsDeliveryFromContext(ctx)!, bindings: service.bindings, transport }
}

/** 装配(显式注入派生面;长 pass 周期,手动驱动)。 */
const boot = (delivery: ChannelsDelivery): TasksRuntime => createTasks({
  tenantRoot: root, realm: 'alice', passIntervalMs: 3_600_000, scope: testScope, channels: delivery,
})

/** 入队一条 answer 回执:trigger 落库 → Engine.reply 走 Replies → Outbox 原子入队(返回排队面)。 */
const enqueueAnswer = (runtime: TasksRuntime, id = '1'): Reply => {
  const trigger = channelTrigger(id, '@bot 修复登录回归')
  expect(runtime.engine.receive(trigger)).toBe('stored')
  return runtime.engine.reply({ purpose: 'answer', triggerId: trigger.id, text: '已安排修复,稍后回报' })
}

it('(i) 回执经 channels 结算:组卡→适配器出站→status=sent(A1 验收主判据,41-M4)', async () => {
  const ctx = new Context()
  const { delivery, bindings, transport } = mountChannelsWorld(ctx)
  bindings.bindThread('feishu', 'fs-user-1', 'tasks:thread-1')
  const runtime = boot(delivery)
  try {
    const reply = enqueueAnswer(runtime)
    expect(reply.status).toBe('pending')
    await runtime.effects.idle('reply')
    // 结算面:回执已 sent,卡片经真件渲染管线送达适配器(收件人=绑定渠道身份,标题=回执文案)
    expect(runtime.store.receipts.get(reply.id)?.status).toBe('sent')
    expect(transport.sent).toHaveLength(1)
    expect(transport.sent[0]?.recipient).toBe('fs-user-1')
    // 飞书互动卡载荷的结构断言面(渲染管线产物,webhook 出站前的原生形态)
    const payload = transport.sent[0]?.payload as {
      card?: {
        header?: { title?: { content?: string } }
        elements?: readonly { text?: { content?: string } }[]
      }
    }
    expect(payload.card?.header?.title?.content).toBe('任务回复')
    expect(JSON.stringify(payload.card?.elements)).toContain('已安排修复,稍后回报')
  } finally { runtime.dispose() }
})

it('(ii) bindings 无绑定:channelAllowed=false → 落 dropped channelIgnored,不出站不丢账', async () => {
  const ctx = new Context()
  const { delivery, transport } = mountChannelsWorld(ctx)
  const runtime = boot(delivery)
  try {
    const reply = enqueueAnswer(runtime)
    await runtime.effects.idle('reply')
    const receipt = runtime.store.receipts.get(reply.id)
    expect(receipt?.status).toBe('dropped')
    expect(receipt?.dropped?.reason).toBe('channelIgnored')
    expect(transport.sent).toHaveLength(0)
  } finally { runtime.dispose() }
})

it('(iii) 服务缺席:惰性面逐调用按 UNWIRED 语义行事,回执恒 pending 无错误(Later 不计失败)', async () => {
  const ctx = new Context() // 裸宿主:不挂 channels 服务
  const delivery = channelsDeliveryFromContext(ctx)
  // 缺席仍派生(boot 时序常态,头注口径);派生面每次调用现读,缺席即 UNWIRED 语义。
  expect(delivery).toBeDefined()
  expect(delivery!.available('feishu')).toBe(false)
  expect(delivery!.channelAllowed({ source: 'feishu', thread: 'tasks:thread-1', address: { channelUserId: 'fs-user-1' } })).toBe(false)
  await expect(delivery!.send(receiptOf('m0'))).resolves.toBe('waiting')
  // 全链口径:createTasks 显式注入该面 → reply effect 以 Later 挂起,回执不落 dropped、健康不置 error。
  const runtime = boot(delivery!)
  try {
    const reply = enqueueAnswer(runtime)
    await runtime.effects.idle('reply')
    expect(runtime.store.receipts.get(reply.id)?.status).toBe('pending')
    expect(runtime.effects.pending('reply', reply.id)).toBe(true)
    expect(runtime.health().components.reply?.state).toBe('ready')
  } finally { runtime.dispose() }
})

it('(iv) send 抛 channelGone 类 → 落 dropped channelGone;transient 类原样上抛走退避重试', async () => {
  const ctx = new Context()
  const { delivery, bindings } = mountChannelsWorld(ctx, {
    id: 'feishu/gone', channelType: 'feishu',
    sendCard: async () => { throw new ChannelsDeliveryError('目标会话已消失', 'channelGone') },
  })
  bindings.bindThread('feishu', 'fs-user-1', 'tasks:thread-1')
  const runtime = boot(delivery)
  try {
    const reply = enqueueAnswer(runtime)
    await runtime.effects.idle('reply')
    const receipt = runtime.store.receipts.get(reply.id)
    expect(receipt?.status).toBe('dropped')
    expect(receipt?.dropped?.reason).toBe('channelGone')
  } finally { runtime.dispose() }

  // 未标记错误(transient)原样上抛:effects 记失败退避重试,回执保持 pending、不落 dropped。
  const transientCtx = new Context()
  const transient = mountChannelsWorld(transientCtx, {
    id: 'feishu/flaky', channelType: 'feishu',
    sendCard: async () => { throw new Error('网络抖动') },
  })
  transient.bindings.bindThread('feishu', 'fs-user-1', 'tasks:thread-1')
  const transientRuntime = boot(transient.delivery)
  try {
    // 同租户 root 上二次开库(首个 runtime 的库文件保留):换 trigger id 避开幂等收敛。
    const reply = enqueueAnswer(transientRuntime, '2')
    await transientRuntime.effects.idle('reply')
    expect(transientRuntime.store.receipts.get(reply.id)?.status).toBe('pending')
    expect(transientRuntime.effects.pending('reply', reply.id)).toBe(true)
  } finally { transientRuntime.dispose() }
})

it('(v) 挂载时序:派生时点服务未 provide → 服务后到即接上(Later 重试吸收,boot 一次性执行不回补)', async () => {
  const ctx = new Context()
  const delivery = channelsDeliveryFromContext(ctx) // 服务未 provide(boot 时点常态)
  expect(delivery).toBeDefined()
  const { transport, bindings } = mountChannelsWorld(ctx) // 服务后到(迟于派生)
  bindings.bindThread('feishu', 'fs-user-1', 'tasks:thread-1')
  const runtime = boot(delivery!)
  try {
    const reply = enqueueAnswer(runtime)
    await runtime.effects.idle('reply')
    // 派生面逐调用现读:服务 provide 后的下一次派发即经 channels 真实结算。
    expect(runtime.store.receipts.get(reply.id)?.status).toBe('sent')
    expect(transport.sent).toHaveLength(1)
  } finally { runtime.dispose() }
})
