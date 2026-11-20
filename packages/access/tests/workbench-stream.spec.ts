/**
 * 工作台实时流桥门禁(38 号 O-5/G2-C4 的 access 侧;铁律 T2 路由面独占——唯一
 * 登记点在本包 plugin.ts):登录会话守卫(401/405)、hub 缺席与未就绪 503
 * fail-closed、SSE 响应头(no-store,AGENTS.md 交互纪律)、装载时序(先订阅后
 * 首帧——快照/续传两分支)、增量转发与断连退订。
 * 真实 store+session(临时目录),hub 为受控假件(载荷语义归 workbench,桥零领域知识)。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AccessAuditEvent } from '../src/audit.ts'
import { SessionService } from '../src/session.ts'
import { createStreamBridgeHandler, WORKBENCH_STREAM_SERVICE_KEY, type PluginStreamHub } from '../src/stream.ts'
import { WORKBENCH_STREAM_ENDPOINT } from '../src/tenant.ts'
import { UserStore } from '../src/store.ts'

const SNAPSHOT_FRAME = 'id: 1\nevent: workbench\ndata: {"kind":"snapshot","seq":1,"snapshot":{}}\n\n'
const DELTA_FRAME = 'id: 2\nevent: workbench\ndata: {"kind":"tickets-updated","seq":2,"tickets":[]}\n\n'

/** 受控 live hub 假件(记录订阅/退订与续传参数;载荷为两帧固定文本)。 */
interface FakeHub extends PluginStreamHub {
  readonly subscribed: ((frame: string) => void)[]
  readonly replayIds: number[]
  readonly unsubCount: () => number
  push(frame: string): void
}

function fakeHub(overrides: Partial<PluginStreamHub> = {}): FakeHub {
  const subscribed: ((frame: string) => void)[] = []
  const replayIds: number[] = []
  let unsubscribed = 0
  const hub = {
    subscribed,
    replayIds,
    unsubCount: () => unsubscribed,
    push(frame: string) { for (const onFrame of subscribed) onFrame(frame) },
    ready: () => true,
    snapshotFrame: () => SNAPSHOT_FRAME,
    replayFrames: (lastEventId: number) => { replayIds.push(lastEventId); return [DELTA_FRAME] },
    subscribe: (onFrame: (frame: string) => void) => {
      subscribed.push(onFrame)
      return () => { unsubscribed += 1 }
    },
    ...overrides,
  }
  return hub
}

describe('工作台实时流桥(access 登记面)', () => {
  let dir: string
  let store: UserStore
  let session: SessionService
  let auditEvents: AccessAuditEvent[]
  let cookie: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-access-stream-'))
    store = new UserStore(join(dir, 'users.db'))
    session = new SessionService(Buffer.from('test-secret-test-secret-test-s'))
    auditEvents = []
    const user = store.createUserWithSuffix({ account: 'wb-user', password: 'Test-only-pass-9', role: 'user' }).user
    const token = session.issue({ userId: user.id, passwordVersion: user.passwordVersion })
    cookie = session.setCookieHeader(token).split(';')[0] ?? ''
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const deps = (hub: PluginStreamHub | undefined) => ({
    store,
    session,
    reflect: { get: (name: string) => name === WORKBENCH_STREAM_SERVICE_KEY ? hub : undefined },
    audit: (event: AccessAuditEvent) => { auditEvents.push(event) },
  })

  /**
   * 起一个只挂本桥的最小 HTTP 服务,返回首个响应块(SSE 流不读尽——连接保持打开,
   * 读到首块即断开以触发服务端退订清理)。
   */
  const serve = async (hub: PluginStreamHub | undefined, requestHeaders: Record<string, string> = {}, method = 'GET'): Promise<{ status: number; headers: Record<string, string>; body: string; close(): Promise<void> }> => {
    const server = createServer((req, res) => { createStreamBridgeHandler(deps(hub))(req, res) })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const { port } = server.address() as AddressInfo
    const controller = new AbortController()
    const close = (): Promise<void> => {
      server.closeAllConnections()
      return new Promise((resolve) => { server.close(() => { resolve() }) })
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}${WORKBENCH_STREAM_ENDPOINT}`, {
        method, headers: requestHeaders, signal: controller.signal,
      })
      const headers: Record<string, string> = {}
      response.headers.forEach((value, name) => { headers[name] = value })
      const reader = response.body!.getReader()
      const first = await reader.read()
      const body = first.done ? '' : new TextDecoder().decode(first.value)
      controller.abort()
      return { status: response.status, headers, body, close }
    } catch (error) {
      await close()
      throw error
    }
  }

  it('守卫面:非 GET 405;未登录/会话失效 401(中文文案)', async () => {
    const hub = fakeHub()
    const denied = await serve(hub, {}, 'POST')
    expect(denied.status).toBe(405)
    expect(denied.body).toContain('仅支持 GET')
    await denied.close()

    const anonymous = await serve(hub)
    expect(anonymous.status).toBe(401)
    expect(anonymous.body).toContain('未登录')
    await anonymous.close()

    const stale = await serve(hub, { cookie: 'eterna_session=forged' })
    expect(stale.status).toBe(401)
    await stale.close()
  })

  it('fail-closed:hub 缺席或未就绪 503(装配竞态/插件停用不给假流)', async () => {
    const missing = await serve(undefined, { cookie })
    expect(missing.status).toBe(503)
    expect(missing.body).toContain('未就绪')
    await missing.close()

    const notReady = await serve(fakeHub({ ready: () => false }), { cookie })
    expect(notReady.status).toBe(503)
    await notReady.close()
  })

  it('装载:200 SSE 头(no-store)+ 先订阅后快照;Last-Event-ID 走续传分支', async () => {
    const hub = fakeHub()
    const ok = await serve(hub, { cookie })
    try {
      expect(ok.status).toBe(200)
      expect(ok.headers['content-type']).toContain('text/event-stream')
      expect(ok.headers['cache-control']).toContain('no-store')
      // 时序契约:先订阅(subscribe 已被调用)再写首帧(快照帧在响应体)
      expect(hub.subscribed.length).toBe(1)
      expect(ok.body.startsWith(SNAPSHOT_FRAME)).toBe(true)
    } finally {
      await ok.close()
    }

    const resume = await serve(hub, { cookie, 'last-event-id': '2' })
    try {
      expect(resume.status).toBe(200)
      expect(hub.replayIds).toEqual([2])
      expect(resume.body).toContain(DELTA_FRAME.trimEnd())
    } finally {
      await resume.close()
    }
  })

  it('增量转发与断连退订:订阅方推帧到响应流;连接关闭即退订', async () => {
    const hub = fakeHub()
    const server = createServer((req, res) => { createStreamBridgeHandler(deps(hub))(req, res) })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const { port } = server.address() as AddressInfo
    const controller = new AbortController()
    const response = await fetch(`http://127.0.0.1:${port}${WORKBENCH_STREAM_ENDPOINT}`, {
      headers: { cookie }, signal: controller.signal,
    })
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe(SNAPSHOT_FRAME)
    // 订阅通道推帧 → 响应流到达
    const pending = reader.read()
    hub.push(DELTA_FRAME)
    const second = await pending
    expect(new TextDecoder().decode(second.value)).toBe(DELTA_FRAME)
    // 断连 → 退订(hub 假件的退订闭包被调用)
    expect(hub.unsubCount()).toBe(0)
    controller.abort()
    await new Promise<void>((resolve) => { setTimeout(resolve, 50) })
    expect(hub.unsubCount()).toBe(1)
    void reader
    await new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => { resolve() }) })
  })

  it('端点路径单一事实源:桥常量与守卫清单登记行一致(G2-C4)', () => {
    expect(WORKBENCH_STREAM_ENDPOINT).toBe('/workbench/api/stream')
    expect(WORKBENCH_STREAM_SERVICE_KEY).toBe('eternaWorkbenchStream')
  })
})
