/**
 * channels webhook 公共面(access 侧登记点)单测:
 * 路由登记契约(prefix /channels/api)、逐请求 reflect 机会读(晚挂载/卸载后 503)、
 * 转发与失败兜底(500 JSON / headersSent 已发则 destroy)。
 * 网关行为语义(HMAC/401/404/410/202)在 channels 包与 glue 装配单测,此处不复制。
 */
import { describe, expect, it, vi } from 'vitest'
import { CHANNELS_WEBHOOK_PATH_PREFIX, registerChannelsWebhook } from '../src/channels-webhook.ts'

interface RegisteredRoute {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  readonly handler: (req: unknown, res: unknown) => void | Promise<void>
}

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

interface MockRes {
  headersSent: boolean
  writeHead: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}

function makeRes(): MockRes {
  return { headersSent: false, writeHead: vi.fn(), end: vi.fn(), destroy: vi.fn() }
}

describe('channels webhook 公共面登记', () => {
  it('prefix 路由登记在 /channels/api;disposer 摘除(装卸无残留)', () => {
    const webServer = new FakeWebServer()
    const dispose = registerChannelsWebhook(webServer, { get: () => undefined })
    expect(webServer.routes).toHaveLength(1)
    expect(webServer.routes[0]).toMatchObject({ kind: 'prefix', path: CHANNELS_WEBHOOK_PATH_PREFIX })
    expect(CHANNELS_WEBHOOK_PATH_PREFIX).toBe('/channels/api')
    dispose()
    expect(webServer.routes).toHaveLength(0)
  })

  it('网关在场 → 原样转发 (req, res)(数据面契约在 channels 包,此处只搬运)', async () => {
    const webServer = new FakeWebServer()
    const handle = vi.fn().mockResolvedValue(undefined)
    const gateway = { handle }
    registerChannelsWebhook(webServer, { get: key => (key === 'channels' ? { gateway } : undefined) })
    const req = { url: '/channels/api/webhook/feishu' }
    const res = makeRes()
    await webServer.routes[0]?.handler(req, res)
    expect(handle).toHaveBeenCalledTimes(1)
    expect(handle).toHaveBeenCalledWith(req, res)
    expect(res.writeHead).not.toHaveBeenCalled()
  })

  it('服务缺席/网关缺席 → 503 fail-closed(明示未挂载,不冒充 unknown-channel)', async () => {
    const webServer = new FakeWebServer()
    registerChannelsWebhook(webServer, { get: () => undefined })
    const res = makeRes()
    await webServer.routes[0]?.handler({}, res)
    expect(res.writeHead).toHaveBeenCalledWith(503, { 'content-type': 'application/json; charset=utf-8' })
    expect(res.end.mock.calls[0]?.[0]).toContain('channels webhook 网关未挂载')

    const res2 = makeRes()
    registerChannelsWebhook(webServer, { get: () => ({ gateway: undefined }) })
    await webServer.routes[1]?.handler({}, res2)
    expect(res2.writeHead).toHaveBeenCalledWith(503, expect.anything())
  })

  it('管线异常 → 500 JSON 兜底;响应已开始则 destroy(不裸抛不重写头)', async () => {
    const webServer = new FakeWebServer()
    registerChannelsWebhook(webServer, {
      get: () => ({ gateway: { handle: () => Promise.reject(new Error('session port down')) } }),
    })
    const res = makeRes()
    await webServer.routes[0]?.handler({}, res)
    expect(res.writeHead).toHaveBeenCalledWith(500, { 'content-type': 'application/json; charset=utf-8' })
    expect(res.end.mock.calls[0]?.[0]).toContain('session port down')

    const res2 = makeRes()
    res2.headersSent = true
    await webServer.routes[0]?.handler({}, res2)
    expect(res2.destroy).toHaveBeenCalledTimes(1)
    expect(res2.writeHead).not.toHaveBeenCalled()
  })
})
