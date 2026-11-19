/**
 * 客户端 RPC 信封契约(2026-11-18 事故回归)。
 *
 * 事故:我的插件/共享工具分区用裸 body POST,服务端 unpack() 判 400
 * `invalid client-request message` → 浏览器里分区永不渲染(用户「发现不了、
 * 管理不了」)。根因是客户端信封只在组件内私有实现、无任何测试覆盖;所有
 * 路由测试与 E2E 都手写信封直打 HTTP,恰好绕过缺陷。
 *
 * 本测试锁死信封形状:缺 type/rpcId/payload.args 任何一项即失败。
 */
import { describe, expect, it, vi } from 'vitest'
import { postRpc } from '../src/client/rpc.ts'

interface CapturedBody { type?: unknown; rpcId?: unknown; method?: unknown; payload?: { args?: unknown } }

function stubFetch(result: unknown, status = 200): CapturedBody[] {
  const captured: CapturedBody[] = []
  vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
    // postRpc 恒发 JSON 字符串 body;此处断言其形状,非通用 BodyInit 读取。
    const text: string = typeof init.body === 'string' ? init.body : '{}'
    captured.push(JSON.parse(text) as CapturedBody)
    return Promise.resolve(new Response(JSON.stringify(result), { status, headers: { 'content-type': 'application/json' } }))
  })
  return captured
}

describe('postRpc 信封', () => {
  it('发上游 typert 同构 client-request 信封(缺任一项服务端即 400)', async () => {
    const captured = stubFetch({ result: { ok: true, value: { items: [] } } })
    await postRpc('/api/my-plugins/list')
    expect(captured).toHaveLength(1)
    const body = captured[0]
    expect(body?.type).toBe('client-request')
    expect(typeof body?.rpcId).toBe('string')
    expect((body?.rpcId as string).length).toBeGreaterThan(0)
    expect(body?.method).toBe('my-plugins/list')
    expect(body?.payload?.args).toStrictEqual({})
    vi.unstubAllGlobals()
  })

  it('args 原样透传(路由读 args.request.*)', async () => {
    const captured = stubFetch({ result: { ok: true, value: { pluginId: 'user:a:hello' } } })
    await postRpc('/api/my-plugins/enable', { request: { pluginId: 'user:a:hello' } })
    expect(captured[0]?.payload?.args).toStrictEqual({ request: { pluginId: 'user:a:hello' } })
    vi.unstubAllGlobals()
  })

  it('解析 ok 帧返回值', async () => {
    stubFetch({ result: { ok: true, value: { items: [{ pluginId: 'user:a:hello' }] } } })
    const r = await postRpc<{ items: Array<{ pluginId: string }> }>('/api/my-plugins/list')
    expect(r.ok).toBe(true)
    expect(r.value?.items[0]?.pluginId).toBe('user:a:hello')
    vi.unstubAllGlobals()
  })

  it('失败帧带出服务端 message(不再是「请求失败(400)」这类空话)', async () => {
    stubFetch({ result: { ok: false, error: { code: 'tenant/denied', message: '插件不存在或不属于你', details: {} } } })
    const r = await postRpc('/api/my-plugins/enable', { request: { pluginId: 'user:b:x' } })
    expect(r.ok).toBe(false)
    expect(r.error?.message).toBe('插件不存在或不属于你')
    vi.unstubAllGlobals()
  })

  it('非 JSON 响应(400 纯文本)按失败返回而不抛', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('invalid client-request message', { status: 400 })))
    const r = await postRpc('/api/my-plugins/list')
    expect(r.ok).toBe(false)
    vi.unstubAllGlobals()
  })
})
