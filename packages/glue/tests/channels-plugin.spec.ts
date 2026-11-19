/**
 * channels 插件装配单测(39 号 §3-E8;形态照抄 governance-plugin.spec 的 fake ctx 模式)。
 *
 * 覆盖:ctx.channels 服务 provide(bindings/tokens/adapters/sources/cards/gateway 面)、
 * webhook 经 access 公共面转发器端到端(路由面登记于 access,24a 裁决口径;本 spec
 * 用同形转发器镜像驱动:reflect 机会读 + 503/500 兜底,转发原样委托
 * WebhookGateway.handle)、
 * HMAC 验签与状态码契约沿用 channels 包语义(401/404/202/410;网关全集见
 * packages/channels/tests/webhook.spec.ts)、thread 绑定优先走 TriggerSink(E3 幂等
 * 副作用计数)、邮件令牌点击路由(/channels/api/approval/:token)、cards 渲染器装配、
 * sessionPort 缺席 = 网关缺席、卸载逆闭包(路由/服务两面归零)。
 */
import { createHmac } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  ApprovalTokenService, ChannelBindingStore, ChannelsCardError, WebhookGateway,
  type InboundDelivery, type ReceiveDisposition, type SessionPort, type TriggerSink,
} from '@eterna/channels'
import { CHANNELS_PLUGIN_SERVICE_ID, defineChannelsPlugin } from '../src/plugins/channels-plugin.ts'
import type { ChannelsWorld } from '../src/plugins/channels-plugin.ts'
import { makeFakeContext } from './fake-context.ts'

const tempDirs: string[] = []
const closers: (() => void)[] = []

afterEach(() => {
  for (const close of closers.splice(0)) close()
  for (const dir of tempDirs.splice(0)) void rm(dir, { recursive: true, force: true })
})

interface RegisteredRoute {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  readonly handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** 宿主 webServer 假体:捕获 register 路由(access AccessWebServer 的结构子集)。 */
class FakeWebServer {
  readonly routes: RegisteredRoute[] = []

  register(route: RegisteredRoute): () => void {
    this.routes.push(route)
    return () => {
      const index = this.routes.indexOf(route)
      if (index >= 0) this.routes.splice(index, 1)
    }
  }
}

/** 会话投递端口假体(记录 deliverInbound / answerApproval 调用)。 */
class RecordingSessionPort implements SessionPort {
  readonly deliveries: InboundDelivery[] = []
  readonly approvals: { approvalRequestId: string; decision: string }[] = []

  async deliverInbound(delivery: InboundDelivery): Promise<void> {
    this.deliveries.push(delivery)
  }

  async answerApproval(answer: { approvalRequestId: string; sessionId: string; decision: 'approve' | 'reject'; via: string }): Promise<void> {
    this.approvals.push({ approvalRequestId: answer.approvalRequestId, decision: answer.decision })
  }
}

/** Trigger 的结构子集(只取本 spec 断言用字段;glue 不依赖 @eterna/tasks)。 */
interface TriggerLike {
  readonly id: string
  readonly source: string
  readonly actor: { readonly source: string; readonly id: string }
  readonly human: boolean
  readonly text: string
}

/** TriggerSink 桩:首投 stored、同 id 重投 duplicate(模拟 tasks Engine.receive 幂等)。 */
class StubSink implements TriggerSink {
  readonly received: TriggerLike[] = []
  storedCount = 0

  receive(trigger: TriggerLike): ReceiveDisposition {
    const duplicate = this.received.some(existing => existing.id === trigger.id)
    this.received.push(trigger)
    if (!duplicate) this.storedCount += 1
    return duplicate ? 'duplicate' : 'stored'
  }

  bindThread(): unknown {
    return undefined
  }

  threadClosed(): void {
    // message 路径不触发生命周期转发
  }
}

interface MountResult {
  readonly harness: ReturnType<typeof makeFakeContext>
  readonly webServer: FakeWebServer
  readonly world: ChannelsWorld
  readonly sessionPort: RecordingSessionPort
  readonly sink: StubSink
}

/** 挂载 channels 插件(临时库 + 全量网关配置;inject 回调在 apply 内同步触发)。 */
async function mountChannels(): Promise<MountResult> {
  const dir = await mkdtemp(join(tmpdir(), 'eterna-glue-channels-'))
  tempDirs.push(dir)
  const sessionPort = new RecordingSessionPort()
  const sink = new StubSink()
  const webServer = new FakeWebServer()
  const harness = makeFakeContext()
  harness.provide('webServer', webServer)
  const plugin = defineChannelsPlugin({
    dbPath: join(dir, 'channels.sqlite3'),
    secrets: { feishu: { secret: 'feishu-topsecret' } },
    sessionPort,
    sink,
  })
  closers.push(plugin.apply(harness.fake as unknown as Context))
  registerAccessMirrorForwarder(webServer, harness)
  const world = harness.service(CHANNELS_PLUGIN_SERVICE_ID) as ChannelsWorld
  return { harness, webServer, world, sessionPort, sink }
}

/**
 * access 公共面转发器镜像(packages/access/src/channels-webhook.ts 同形):
 * 路由面登记在 access,本 spec 以同款逐请求 reflect 机会读 + 503/500 兜底驱动
 * gateway 行为测试——access 侧契约由其自有单测钉住,两侧漂移即红。
 */
function registerAccessMirrorForwarder(webServer: FakeWebServer, harness: ReturnType<typeof makeFakeContext>): void {
  webServer.register({
    kind: 'prefix',
    path: '/channels/api',
    handler: (req, res) => {
      const world = harness.service(CHANNELS_PLUGIN_SERVICE_ID) as ChannelsWorld | undefined
      const gateway = world?.gateway
      if (gateway === undefined) {
        res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: 'unavailable', detail: 'channels webhook 网关未挂载(eterna-channels 插件未启用或 sessionPort 未配置)' }))
        return
      }
      gateway.handle(req, res).catch((error: unknown) => {
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: 'internal', detail: error instanceof Error ? error.message : String(error) }))
        } else {
          res.destroy()
        }
      })
    },
  })
}

/** 手工挂载(装载形态自定;sessionPort 缺席/卸载断言用)。 */
function mountRaw(webServer: FakeWebServer, config: Parameters<typeof defineChannelsPlugin>[0]): {
  harness: ReturnType<typeof makeFakeContext>
  disposer: () => void
} {
  const harness = makeFakeContext()
  harness.provide('webServer', webServer)
  const disposer = defineChannelsPlugin(config).apply(harness.fake as unknown as Context)
  return { harness, disposer }
}

/** 把捕获的 prefix 路由桥到真 http server(fetch 走完整原始路径,与宿主 webServer 同形)。 */
async function listenRoutes(webServer: FakeWebServer): Promise<string> {
  const server: Server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://local').pathname
    for (const route of webServer.routes) {
      if (route.kind === 'prefix' && pathname.startsWith(route.path)) {
        void route.handler(req, res)
        return
      }
    }
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'not-found' }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  closers.push(() => {
    server.closeAllConnections()
    server.close(() => {})
  })
  return `http://127.0.0.1:${port}`
}

function signFeishu(raw: string): string {
  return 'sha256=' + createHmac('sha256', 'feishu-topsecret').update(raw, 'utf8').digest('hex')
}

describe('channels 插件:ctx.channels 服务 provide', () => {
  it('provide("channels") 带 bindings/tokens/adapters/sources/cards/gateway 面;id 溯源 channels 包', async () => {
    const { harness, world } = await mountChannels()
    expect(harness.services()).toContain(CHANNELS_PLUGIN_SERVICE_ID)
    expect(world.id).toBe('@eterna/channels')
    expect(world.bindings).toBeInstanceOf(ChannelBindingStore)
    expect(world.tokens).toBeInstanceOf(ApprovalTokenService)
    expect(world.adapters.list()).toEqual([])
    expect(world.sources.get('webhook')).toBeDefined()
    expect('buildApprovalCard' in world.cards).toBe(true)
    expect(world.gateway).toBeInstanceOf(WebhookGateway)
    expect('startWebhookGateway' in world).toBe(true)
  })

  it('cards 渲染器:审批卡双令牌载荷装配 + 六态文案行(包管线原样转发,不吞强校验)', async () => {
    const { world } = await mountChannels()
    const card = world.cards.buildApprovalCard({
      approvalRequestId: 'req-1',
      channel: 'feishu/card',
      title: '高危动作待审批',
      body: '将执行部署',
      actions: [
        { label: '允许执行一次', decision: 'approve', token: 'tok-approve' },
        { label: '拒绝', decision: 'reject', token: 'tok-reject' },
      ],
    })
    expect(card.approval?.actions.map(action => action.decision)).toEqual(['approve', 'reject'])
    world.cards.validateOutboundCard(card)
    expect(world.cards.renderReportLines('ready', '发布完成')).toBe('就绪:结果已就绪\n摘要:发布完成')
    expect(() => world.cards.buildReplyCard({ purpose: 'attention', title: '缺载荷' })).toThrow(ChannelsCardError)
  })
})

describe('channels 插件:tasks 投递面消费的结构端口(★A1 双包对接面)', () => {
  // tasks 侧 channelsDeliveryFromContext(packages/tasks/src/effects/channels-delivery.ts)按
  // 本结构面消费 ctx.channels 服务(34 号 §1 端口注入):面缺任一成员即不派生、回执回落
  // UNWIRED 挂起——双包对接面被两侧测试钉住(glue 钉「面存在」,tasks tests/channels-
  // delivery.spec.ts 钉「面消费语义」)。
  it('world 满足适配器消费的结构面:adapters.list/get、cards.buildReplyCard/validateOutboundCard/classifyDeliveryFailure、bindings.resolveThread 在场', async () => {
    const { world } = await mountChannels()
    expect(typeof world.adapters.list).toBe('function')
    expect(typeof world.adapters.get).toBe('function')
    expect(typeof world.cards.buildReplyCard).toBe('function')
    expect(typeof world.cards.validateOutboundCard).toBe('function')
    expect(typeof world.cards.classifyDeliveryFailure).toBe('function')
    expect(typeof world.bindings.resolveThread).toBe('function')
    // 面可用性冒烟(Outbox reply 的组卡/归类/绑定解析三路径)
    const card = world.cards.buildReplyCard({ purpose: 'answer', title: '任务回复', body: 'hi' })
    expect(card).toBeDefined()
    world.cards.validateOutboundCard(card!)
    expect(world.cards.classifyDeliveryFailure(new Error('boom'))).toBe('transient')
    expect(world.adapters.list()).toEqual([])
    expect(world.adapters.get('feishu/card')).toBeUndefined()
    world.bindings.bindThread('feishu', 'fs-user-1', 'tasks:t-1')
    expect(world.bindings.resolveThread('feishu', 'fs-user-1')?.threadKey).toBe('tasks:t-1')
  })
})

describe('channels 插件:webhook 经 access 公共面转发器端到端', () => {
  it('prefix 路由注册在 /channels/api;HMAC 验签通过 → session 回退投递 202(channels 包语义)', async () => {
    const { webServer, world, sessionPort } = await mountChannels()
    expect(webServer.routes).toHaveLength(1)
    expect(webServer.routes[0]).toMatchObject({ kind: 'prefix', path: '/channels/api' })
    const base = await listenRoutes(webServer)
    world.bindings.bind('feishu', 'fs-user-1', 'sess-web-1')
    const raw = JSON.stringify({ type: 'message', channelUserId: 'fs-user-1', text: '把发布会日程排一下' })
    const response = await fetch(new URL('/channels/api/webhook/feishu', base), {
      method: 'POST',
      headers: { 'x-dsh-signature': signFeishu(raw) },
      body: raw,
    })
    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({ accepted: true, sessionId: 'sess-web-1' })
    expect(sessionPort.deliveries).toHaveLength(1)
  })

  it('验签失败 401、未知渠道 404(状态码契约留在 gateway 单一实现)', async () => {
    const { webServer, world, sessionPort } = await mountChannels()
    const base = await listenRoutes(webServer)
    world.bindings.bind('feishu', 'fs-user-1', 'sess-web-1')
    const raw = JSON.stringify({ type: 'message', channelUserId: 'fs-user-1', text: 'hi' })
    const badSignature = await fetch(new URL('/channels/api/webhook/feishu', base), {
      method: 'POST',
      headers: { 'x-dsh-signature': 'sha256=' + createHmac('sha256', 'wrong-secret').update(raw, 'utf8').digest('hex') },
      body: raw,
    })
    expect(badSignature.status).toBe(401)
    const unknownChannel = await fetch(new URL('/channels/api/webhook/slack', base), {
      method: 'POST',
      headers: { 'x-dsh-signature': signFeishu(raw) },
      body: raw,
    })
    expect(unknownChannel.status).toBe(404)
    expect(sessionPort.deliveries).toHaveLength(0)
  })

  it('thread 绑定优先走 TriggerSink(E3:202 disposition 透传;重放不重复记副作用)', async () => {
    const { webServer, world, sink } = await mountChannels()
    const base = await listenRoutes(webServer)
    world.bindings.bindThread('feishu', 'fs-user-1', 'tasks:t-1')
    const raw = JSON.stringify({ type: 'message', channelUserId: 'fs-user-1', text: '追问一下', messageId: 'm-1' })
    const post = (): Promise<Response> => fetch(new URL('/channels/api/webhook/feishu', base), {
      method: 'POST',
      headers: { 'x-dsh-signature': signFeishu(raw) },
      body: raw,
    })
    const first = await post()
    expect(first.status).toBe(202)
    expect(await first.json()).toMatchObject({ accepted: true, disposition: 'stored' })
    const replay = await post()
    expect(await replay.json()).toMatchObject({ disposition: 'duplicate' })
    // 幂等归 tasks 侧:重放第二次,sink 的 stored 副作用计数不增
    expect(sink.storedCount).toBe(1)
    expect(sink.received[0]).toMatchObject({
      source: 'feishu',
      actor: { source: 'feishu', id: 'fs-user-1' },
      human: true,
      text: '追问一下',
    })
  })

  it('邮件令牌点击路由:/channels/api/approval/:token 一次性有效(E4 应答回收半边)', async () => {
    const { webServer, world, sessionPort } = await mountChannels()
    const base = await listenRoutes(webServer)
    const grant = world.tokens.issuePair({ approvalRequestId: 'req-1', sessionId: 'sess-web-1' })
    const first = await fetch(new URL(`/channels/api/approval/${grant.approve.token}`, base))
    expect(first.status).toBe(202)
    expect(await first.json()).toMatchObject({ accepted: true, approvalRequestId: 'req-1' })
    // 单次有效:同令牌重放 410 already-used
    const replay = await fetch(new URL(`/channels/api/approval/${grant.approve.token}`, base))
    expect(replay.status).toBe(410)
    expect(sessionPort.approvals).toEqual([{ approvalRequestId: 'req-1', decision: 'approve' }])
  })
})

describe('channels 插件:sessionPort 缺席与卸载逆闭包', () => {
  it('sessionPort 缺席 = 网关缺席(插件不自注册路由);绑定存储/令牌/渲染器照常在场', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eterna-glue-channels-'))
    tempDirs.push(dir)
    const webServer = new FakeWebServer()
    const { harness } = mountRaw(webServer, {
      dbPath: join(dir, 'channels.sqlite3'),
      secrets: { feishu: { secret: 'feishu-topsecret' } },
    })
    const world = harness.service(CHANNELS_PLUGIN_SERVICE_ID) as ChannelsWorld
    expect(world.gateway).toBeUndefined()
    expect(webServer.routes).toHaveLength(0)
    expect(world.bindings).toBeInstanceOf(ChannelBindingStore)
    expect('buildApprovalCard' in world.cards).toBe(true)
  })

  it('卸载撤服务;转发器视角网关消失(503 fail-closed;库随 service.close 收口)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eterna-glue-channels-'))
    tempDirs.push(dir)
    const webServer = new FakeWebServer()
    const { harness, disposer } = mountRaw(webServer, {
      dbPath: join(dir, 'channels.sqlite3'),
      secrets: { feishu: { secret: 'feishu-topsecret' } },
      sessionPort: new RecordingSessionPort(),
    })
    registerAccessMirrorForwarder(webServer, harness)
    expect(harness.services()).toContain(CHANNELS_PLUGIN_SERVICE_ID)
    expect(webServer.routes).toHaveLength(1)

    disposer()
    expect(harness.services()).not.toContain(CHANNELS_PLUGIN_SERVICE_ID)
    // 路由面(access 登记)仍在,但网关随 provide 撤销 → 转发器 503 fail-closed
    const res = { headersSent: false, writeHead: vi.fn(), end: vi.fn(), destroy: vi.fn() }
    void webServer.routes[0]?.handler({} as never, res as never)
    expect(res.writeHead).toHaveBeenCalledWith(503, { 'content-type': 'application/json; charset=utf-8' })
  })
})
