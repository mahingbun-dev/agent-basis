/**
 * T1 守卫矩阵(G1/G2 补全,2026-11-11):8 端点 × {本人/他人/未登录} = 24 例。
 * 沿 tenant.spec.ts 基座(真实 UserStore+SessionService+记录器替身)。
 * 断言双面:HTTP status + 响应体(拒绝帧中文文案)——杜绝「200 体内藏拒绝」漏判。
 * 特殊语义:session/list 按 owner 过滤结果集(非全拒);session/events 按 address 判定;
 * workspacePathApplications 按 path 钳制。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionService } from '../src/session.ts'
import { UserStore } from '../src/store.ts'
import { registerTenantGuards, type TenantFetchRegistry } from '../src/tenant.ts'

interface RecordedCall {
  readonly service: string
  readonly method: string
  readonly params: unknown[]
}

const SESSION_ENDPOINTS = [
  'state', 'projections', 'selectModel', 'updateQueue', 'wait',
] as const

describe('T1 守卫矩阵:session 补全端点 × 三身份', () => {
  let dir: string
  let store: UserStore
  let session: SessionService
  let calls: RecordedCall[]
  let routes: Map<string, { fetch: (request: Request) => Promise<Response> }>
  let aliceId: number
  let bobId: number
  let root: string
  let aliceSessionId: string
  let bobSessionId: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-guard-matrix-'))
    store = new UserStore(join(dir, 'users.db'))
    calls = []
    routes = new Map()
    session = new SessionService(Buffer.from('tenant-secret-tenant-secret-000'))
    root = join(dir, 'workspaces')
    const alice = store.createUserWithSuffix({ account: 'alice', password: 'password8' })
    const bob = store.createUserWithSuffix({ account: 'bob', password: 'password8' })
    aliceId = alice.user.id
    bobId = bob.user.id
    const reflect = { get: (key: string): unknown => (services as Record<string, Record<string, (...args: unknown[]) => unknown>>)[key] }
    const services = {
      sessionController: {
        create: (request: unknown) => {
          calls.push({ service: 'sessionController', method: 'create', params: [request] })
          return { sessionId: `s-${calls.length}` }
        },
        // 五个通用归属端点的桩(载荷透传即放行证据)
        state: (request: unknown) => { calls.push({ service: 'sessionController', method: 'state', params: [request] }); return { state: 1 } },
        projections: (request: unknown) => { calls.push({ service: 'sessionController', method: 'projections', params: [request] }); return { projections: {} } },
        selectModel: (request: unknown) => { calls.push({ service: 'sessionController', method: 'selectModel', params: [request] }); return { selected: true } },
        updateQueue: (request: unknown) => { calls.push({ service: 'sessionController', method: 'updateQueue', params: [request] }); return { queue: [] } },
        wait: (request: unknown, signal: unknown) => {
          if (!(signal instanceof AbortSignal)) throw new TypeError('signal missing')
          calls.push({ service: 'sessionController', method: 'wait', params: [request, signal] })
          return { idle: true }
        },
        // events:SessionPageRequest {address:{kind,sessionId|parentSessionId}}
        events: (request: unknown) => { calls.push({ service: 'sessionController', method: 'events', params: [request] }); return { messages: [] } },
        // list:SessionListValue {items:[...]}
        list: () => {
          calls.push({ service: 'sessionController', method: 'list', params: [] })
          return { items: [
            { sessionId: 's-alice-1', updatedAt: 1 },
            { sessionId: 's-alice-sub', parentSessionId: 's-alice-1', origin: 'subagent', updatedAt: 2 },
            { sessionId: 's-bob-1', updatedAt: 3 },
            { sessionId: 's-orphan', updatedAt: 4 },
          ] }
        },
        workspacePathApplications: (request: unknown) => { calls.push({ service: 'sessionController', method: 'workspacePathApplications', params: [request] }); return { applications: [] } },
      },
    }
    const registry: TenantFetchRegistry = {
      register: (route) => { routes.set(route.path, route); return () => Promise.resolve() },
    }
    registerTenantGuards({ store, session, reflect, tenantRoot: root, audit: () => {} }, { fetch: registry })
    aliceSessionId = 's-alice-1'
    bobSessionId = 's-bob-1'
    store.recordSession(aliceSessionId, aliceId, null)
    store.recordSession(bobSessionId, bobId, null)
    // subagent 子会话不入账本(随父判定);s-orphan 完全不入账本
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function cookieFor(userId: number): string {
    const user = store.getUserById(userId)
    return `eterna_session=${session.issue({ userId, passwordVersion: user?.passwordVersion ?? 1 })}`
  }

  async function call(path: string, account: 'alice' | 'bob' | undefined, payloadArgs: Record<string, unknown>) {
    const handler = routes.get(path)
    if (handler === undefined) throw new Error(`route not registered: ${path}`)
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (account !== undefined) headers.cookie = cookieFor(account === 'alice' ? aliceId : bobId)
    const response = await handler.fetch(new Request(`http://app.local${path}`, {
      method: 'POST', headers,
      body: JSON.stringify({ type: 'client-request', rpcId: 't1', method: path.slice(5), payload: { args: payloadArgs } }),
    }))
    const text = await response.text()
    let result: Record<string, unknown> | undefined
    try { result = JSON.parse(text) as Record<string, unknown> } catch { result = undefined }
    return { status: response.status, result }
  }

  const denyBody = (r: { result?: Record<string, unknown> | undefined }) => {
    expect((r.result?.result as { error?: { code?: string; message?: string } })?.error).toMatchObject({ code: 'tenant/denied' })
  }

  // ── 通用归属五端点 × 3 身份 = 15 例 ──
  for (const ep of SESSION_ENDPOINTS) {
    it(`${ep}: 本人放行(直调桩)`, async () => {
      const r = await call(`/api/session/${ep}`, 'alice', { request: { sessionId: aliceSessionId } })
      expect(r.result?.result).toMatchObject({ ok: true })
      expect(calls.some(c => c.method === ep && c.params[0] !== undefined)).toBe(true)
    })
    it(`${ep}: 他人 sessionId → 拒绝帧(中文文案)+零直调`, async () => {
      const r = await call(`/api/session/${ep}`, 'bob', { request: { sessionId: aliceSessionId } })
      expect(r.status).toBe(200)
      denyBody(r)
      expect((r.result?.result as { error?: { message?: string } }).error?.message).toContain('不属于你')
      expect(calls.filter(c => c.method === ep)).toHaveLength(0)
    })
    it(`${ep}: 未登录 → tenant/unauthenticated`, async () => {
      const r = await call(`/api/session/${ep}`, undefined, { request: { sessionId: aliceSessionId } })
      expect((r.result?.result as { error?: { code?: string } }).error?.code).toBe('tenant/unauthenticated')
    })
  }

  // ── events × 3 = 3 例(address 形态) ──
  it('events: 本人 address.sessionId 放行', async () => {
    const r = await call('/api/session/events', 'alice', { request: { address: { kind: 'session', sessionId: aliceSessionId } } })
    expect(r.result?.result).toMatchObject({ ok: true })
  })
  it('events: 他人 address.sessionId → 拒绝帧+审计', async () => {
    const r = await call('/api/session/events', 'bob', { request: { address: { kind: 'session', sessionId: aliceSessionId } } })
    denyBody(r)
    expect((r.result?.result as { error?: { message?: string } }).error?.message).toContain('不属于你')
  })
  it('events: subagent 形态按父归属——本人父放行,他人父拒绝', async () => {
    const own = await call('/api/session/events', 'alice', { request: { address: { kind: 'subagent', parentSessionId: aliceSessionId, childSessionId: 's-alice-sub', mode: 'one-shot' } } })
    expect(own.result?.result).toMatchObject({ ok: true })
    const steal = await call('/api/session/events', 'bob', { request: { address: { kind: 'subagent', parentSessionId: aliceSessionId, childSessionId: 's-alice-sub', mode: 'one-shot' } } })
    denyBody(steal)
  })

  // ── list 结果集过滤 × 3 = 3 例 ──
  it('list: 本人视图只含自己+自己的子代理;他人与孤儿条目剔除', async () => {
    const r = await call('/api/session/list', 'alice', {})
    const value = (r.result?.result as { value?: { items?: Array<{ sessionId: string }> } })?.value
    const ids = (value?.items ?? []).map(i => i.sessionId).sort()
    expect(ids).toEqual(['s-alice-1', 's-alice-sub'])
  })
  it('list: bob 视图只见自己的会话;alice 会话出现次数=0', async () => {
    const r = await call('/api/session/list', 'bob', {})
    const value = (r.result?.result as { value?: { items?: Array<{ sessionId: string }> } })?.value
    const ids = (value?.items ?? []).map(i => i.sessionId)
    expect(ids).toEqual(['s-bob-1'])
    expect(JSON.stringify(ids)).not.toContain('s-alice')
  })
  it('list: 未登录 → tenant/unauthenticated', async () => {
    const r = await call('/api/session/list', undefined, {})
    expect((r.result?.result as { error?: { code?: string } })?.error?.code).toBe('tenant/unauthenticated')
  })

  // ── workspacePathApplications × 3 = 3 例(path 钳制) ──
  it('workspacePathApplications: 用户根内 path 放行', async () => {
    const r = await call('/api/session/workspacePathApplications', 'alice', { request: { path: join(root, 'alice') } })
    expect(r.result?.result).toMatchObject({ ok: true })
  })
  it('workspacePathApplications: 根外 path → 拒绝帧', async () => {
    const r = await call('/api/session/workspacePathApplications', 'alice', { request: { path: join(root, 'bob') } })
    denyBody(r)
    expect(calls.filter(c => c.method === 'workspacePathApplications')).toHaveLength(0)
  })
  it('workspacePathApplications: 未登录 → tenant/unauthenticated', async () => {
    const r = await call('/api/session/workspacePathApplications', undefined, { request: { path: join(root, 'alice') } })
    expect((r.result?.result as { error?: { code?: string } })?.error?.code).toBe('tenant/unauthenticated')
  })
})
